"""
Happle Reservation Backend API

hacomono APIを使用した予約システムのバックエンドAPI
"""

import os
import json
import logging
import hashlib
from datetime import datetime, timedelta
from functools import wraps
from pathlib import Path
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import boto3
from botocore.exceptions import ClientError

from hacomono_client import (
    HacomonoClient,
    HacomonoAPIError,
    AuthenticationError,
    RateLimitError
)

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Flask アプリケーション
app = Flask(__name__)
app.json.ensure_ascii = False  # 日本語をUnicodeエスケープしない

# CORS設定
CORS(app, 
     origins=os.environ.get("CORS_ORIGINS", "*").split(","),
     supports_credentials=True,
     allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])

# hacomono クライアント（遅延初期化）
_hacomono_client = None


def get_hacomono_client() -> HacomonoClient:
    """hacomonoクライアントを取得（シングルトン）"""
    global _hacomono_client
    if _hacomono_client is None:
        _hacomono_client = HacomonoClient.from_env()
    return _hacomono_client


# キャッシュ: スタッフのスタジオ紐付け情報
_instructor_studio_map_cache = None
_instructor_studio_map_cache_time = None
INSTRUCTOR_CACHE_TTL_SECONDS = 60  # 60秒間キャッシュ


def get_cached_instructor_studio_map(client: HacomonoClient) -> dict:
    """スタッフのスタジオ紐付け情報をキャッシュ付きで取得
    
    並列リクエストでのレート制限を回避するため、60秒間キャッシュする
    """
    global _instructor_studio_map_cache, _instructor_studio_map_cache_time
    
    now = datetime.now()
    
    # キャッシュが有効ならそれを返す
    if (_instructor_studio_map_cache is not None and 
        _instructor_studio_map_cache_time is not None and
        (now - _instructor_studio_map_cache_time).total_seconds() < INSTRUCTOR_CACHE_TTL_SECONDS):
        logger.debug("Using cached instructor studio map")
        return _instructor_studio_map_cache
    
    # 新規取得（リトライ付き）
    instructor_studio_map = {}
    max_retries = 3
    
    for attempt in range(max_retries):
        try:
            instructors_response = client.get_instructors({"is_active": True})
            instructors_list = instructors_response.get("data", {}).get("instructors", {}).get("list", [])
            for instructor in instructors_list:
                instructor_id = instructor.get("id")
                instructor_studio_ids = instructor.get("studio_ids", [])
                instructor_studio_map[instructor_id] = instructor_studio_ids
            
            # キャッシュを更新
            _instructor_studio_map_cache = instructor_studio_map
            _instructor_studio_map_cache_time = now
            logger.info(f"Loaded instructor studio map (attempt {attempt + 1}): {instructor_studio_map}")
            return instructor_studio_map
        except Exception as e:
            logger.warning(f"Failed to get instructor studio map (attempt {attempt + 1}): {e}")
            if attempt < max_retries - 1:
                import time
                time.sleep(0.5)  # リトライ前に少し待機
    
    # 全てのリトライが失敗した場合、キャッシュがあればそれを返す
    if _instructor_studio_map_cache is not None:
        logger.warning("Using stale cache for instructor studio map")
        return _instructor_studio_map_cache
    
    return instructor_studio_map


def handle_errors(f):
    """エラーハンドリングデコレータ"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except AuthenticationError as e:
            logger.error(f"Authentication error: {e}")
            return jsonify({"error": "Authentication failed", "message": str(e)}), 401
        except RateLimitError as e:
            logger.warning(f"Rate limit exceeded: {e}")
            return jsonify({"error": "Rate limit exceeded", "retry_after": e.retry_after}), 429
        except HacomonoAPIError as e:
            logger.error(f"hacomono API error: {e}")
            return jsonify({"error": "API error", "message": str(e)}), e.status_code or 500
        except Exception as e:
            logger.exception(f"Unexpected error: {e}")
            return jsonify({"error": "Internal server error", "message": str(e)}), 500
    return decorated_function


# ==================== セキュリティ: 認証ハッシュ ====================

# ハッシュ生成用のシークレットソルト（環境変数から取得、なければデフォルト）
VERIFICATION_SALT = os.environ.get("VERIFICATION_SALT", "happle-reservation-secret-salt-2024")


def generate_verification_hash(email: str, phone: str) -> str:
    """メールアドレスと電話番号から認証用ハッシュを生成
    
    Args:
        email: メールアドレス
        phone: 電話番号
        
    Returns:
        SHA256ハッシュの先頭16文字（URLに含めやすい長さ）
    """
    # 正規化: 小文字化、スペース・ハイフン除去
    normalized_email = email.lower().strip()
    normalized_phone = phone.replace("-", "").replace(" ", "").strip()
    
    # ソルト付きでハッシュ生成
    data = f"{normalized_email}:{normalized_phone}:{VERIFICATION_SALT}"
    hash_value = hashlib.sha256(data.encode('utf-8')).hexdigest()
    
    # 先頭16文字を返す（URLに含めやすい長さ）
    return hash_value[:16]


def verify_hash(email: str, phone: str, provided_hash: str) -> bool:
    """提供されたハッシュが正しいか検証
    
    Args:
        email: メールアドレス
        phone: 電話番号
        provided_hash: URLから取得したハッシュ
        
    Returns:
        ハッシュが一致すればTrue
    """
    expected_hash = generate_verification_hash(email, phone)
    return expected_hash == provided_hash


# ==================== 予約日時バリデーション ====================

# 予約可能な時間範囲（環境変数で設定可能）
RESERVATION_MIN_MINUTES_AHEAD = int(os.environ.get("RESERVATION_MIN_MINUTES_AHEAD", "30"))  # 最低30分後から
RESERVATION_MAX_DAYS_AHEAD = int(os.environ.get("RESERVATION_MAX_DAYS_AHEAD", "14"))  # 最大14日後まで


def validate_reservation_datetime(reservation_datetime: datetime) -> tuple[bool, str]:
    """予約日時が有効範囲内かチェック
    
    Args:
        reservation_datetime: 予約日時（datetime型）
        
    Returns:
        (is_valid, error_message) のタプル
    """
    now = datetime.now()
    
    # 最低30分後以降かチェック
    min_datetime = now + timedelta(minutes=RESERVATION_MIN_MINUTES_AHEAD)
    if reservation_datetime < min_datetime:
        return False, f"予約は{RESERVATION_MIN_MINUTES_AHEAD}分後以降の時間を選択してください"
    
    # 最大14日後以内かチェック
    max_datetime = now + timedelta(days=RESERVATION_MAX_DAYS_AHEAD)
    if reservation_datetime > max_datetime:
        return False, f"予約は{RESERVATION_MAX_DAYS_AHEAD}日後までの日付を選択してください"
    
    return True, ""


# ==================== 店舗情報ヘルパー ====================

def get_studio_attr(studio_data: dict, key: str) -> str:
    """店舗のattrsから指定キーの値を取得"""
    attrs = studio_data.get("attrs", [])
    for attr in attrs:
        if attr.get("key") == key:
            return attr.get("value", "")
    return ""


def get_studio_contact_info(studio_data: dict, overrides: dict) -> dict:
    """店舗連絡先情報を取得（パラメータ優先、なければhacomonoからフォールバック）
    
    Args:
        studio_data: hacomonoから取得した店舗データ
        overrides: URLパラメータから渡された上書き値
    
    Returns:
        店舗連絡先情報のdict
    """
    zip1 = studio_data.get("zip_code1", "")
    zip2 = studio_data.get("zip_code2", "")
    
    # hacomonoの住所フィールドを結合
    hacomono_address = " ".join(filter(None, [
        studio_data.get("prefecture", ""),
        studio_data.get("address1", ""),
        studio_data.get("address2", ""),
        studio_data.get("address3", "")
    ]))
    
    return {
        "zip": overrides.get("studio_zip") or (f"{zip1}-{zip2}" if zip1 and zip2 else (zip1 or "")),
        "address": overrides.get("studio_address") or hacomono_address,
        "tel": overrides.get("studio_tel") or studio_data.get("tel", ""),
        "url": overrides.get("studio_url") or get_studio_attr(studio_data, "studio_url"),
        "email": overrides.get("studio_email") or get_studio_attr(studio_data, "studio_email"),
        "line_url": overrides.get("line_url") or get_studio_attr(studio_data, "line_url")
    }


def _generate_studio_footer(studio_name: str, contact_info: dict = None, fallback_address: str = "", fallback_tel: str = "") -> str:
    """メール末尾の店舗情報フッターを生成
    
    Args:
        studio_name: 店舗名
        contact_info: get_studio_contact_infoで取得した連絡先情報
        fallback_address: フォールバック用住所（後方互換）
        fallback_tel: フォールバック用電話番号（後方互換）
    
    Returns:
        フォーマットされた店舗情報フッター
    """
    lines = ["=============================", f"■{studio_name}"]
    
    if contact_info:
        # 新しい形式: contact_infoを使用
        if contact_info.get("zip") or contact_info.get("address"):
            zip_code = contact_info.get("zip", "")
            address = contact_info.get("address", "")
            if zip_code:
                lines.append(f"住所: 〒{zip_code}")
                if address:
                    lines.append(address)
            elif address:
                lines.append(f"住所: {address}")
        
        if contact_info.get("tel"):
            lines.append(f"TEL: {contact_info['tel']}")
        
        if contact_info.get("url"):
            lines.append(f"URL: {contact_info['url']}")
        
        if contact_info.get("email"):
            lines.append(f"メールアドレス: {contact_info['email']}")
    else:
        # 後方互換: 旧パラメータを使用
        if fallback_address:
            lines.append(f"住所: {fallback_address}")
        if fallback_tel:
            lines.append(f"TEL: {fallback_tel}")
    
    lines.append("=============================")
    return "\n".join(lines)


# ==================== SES設定 ====================

def load_ses_config_from_terraform():
    """terraformのtfstateからSES設定を読み込む
    
    環境変数が設定されていない場合のフォールバックとして使用
    """
    tfstate_path = Path(__file__).parent.parent / "terraform" / "terraform.tfstate"
    
    if not tfstate_path.exists():
        logger.warning(f"terraform.tfstate not found at {tfstate_path}")
        return None
    
    try:
        with open(tfstate_path, "r") as f:
            tfstate = json.load(f)
        
        outputs = tfstate.get("outputs", {})
        
        # SES SMTP認証情報を取得
        access_key = outputs.get("ses_smtp_user_access_key", {}).get("value")
        
        # secret_keyはtfstateのresources内から取得
        secret_key = None
        smtp_password = None
        for resource in tfstate.get("resources", []):
            if resource.get("type") == "aws_iam_access_key" and resource.get("name") == "ses_user_key":
                instances = resource.get("instances", [])
                if instances:
                    secret_key = instances[0].get("attributes", {}).get("secret")
                    smtp_password = instances[0].get("attributes", {}).get("ses_smtp_password_v4")
                break
        
        return {
            "aws_access_key_id": access_key,
            "aws_secret_access_key": secret_key,
            "smtp_password": smtp_password,
            "region": "ap-northeast-1",
            "domain": "reserve-now.jp",
            "mail_from_domain": "mail.reserve-now.jp"
        }
    except Exception as e:
        logger.error(f"Failed to load SES config from terraform: {e}")
        return None


def get_ses_config():
    """SES設定を取得（環境変数優先、なければterraformから読み込み）"""
    # 環境変数から取得
    aws_access_key = os.environ.get("AWS_ACCESS_KEY_ID") or os.environ.get("SES_ACCESS_KEY_ID")
    aws_secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY") or os.environ.get("SES_SECRET_ACCESS_KEY")
    ses_region = os.environ.get("SES_REGION", "ap-northeast-1")
    ses_domain = os.environ.get("SES_DOMAIN", "reserve-now.jp")
    ses_from_email = os.environ.get("SES_FROM_EMAIL", "noreply@reserve-now.jp")
    
    if aws_access_key and aws_secret_key:
        return {
            "aws_access_key_id": aws_access_key,
            "aws_secret_access_key": aws_secret_key,
            "region": ses_region,
            "domain": ses_domain,
            "from_email": ses_from_email
        }
    
    # terraformから読み込み
    tf_config = load_ses_config_from_terraform()
    if tf_config:
        tf_config["from_email"] = f"noreply@{tf_config['domain']}"
        return tf_config
    
    return None


# SESクライアント（遅延初期化）
_ses_client = None


def get_ses_client():
    """SESクライアントを取得（シングルトン）"""
    global _ses_client
    
    if _ses_client is not None:
        return _ses_client
    
    config = get_ses_config()
    if not config:
        logger.warning("SES config not available, email sending will be disabled")
        return None
    
    try:
        _ses_client = boto3.client(
            'ses',
            region_name=config.get("region", "ap-northeast-1"),
            aws_access_key_id=config.get("aws_access_key_id"),
            aws_secret_access_key=config.get("aws_secret_access_key")
        )
        logger.info("SES client initialized successfully")
        return _ses_client
    except Exception as e:
        logger.error(f"Failed to initialize SES client: {e}")
        return None


def send_email_via_ses(
    to_email: str,
    subject: str,
    body_text: str,
    from_email: str = None
) -> dict:
    """SESを使用してメール送信
    
    Args:
        to_email: 送信先メールアドレス
        subject: 件名
        body_text: 本文（テキスト）
        from_email: 送信元メールアドレス（省略時は設定から取得）
    
    Returns:
        dict: {"success": bool, "message_id": str or None, "error": str or None}
    """
    client = get_ses_client()
    config = get_ses_config()
    
    if not client or not config:
        return {
            "success": False,
            "message_id": None,
            "error": "SES client not configured"
        }
    
    sender = from_email or config.get("from_email", "noreply@reserve-now.jp")
    
    try:
        response = client.send_email(
            Source=sender,
            Destination={
                'ToAddresses': [to_email]
            },
            Message={
                'Subject': {
                    'Data': subject,
                    'Charset': 'UTF-8'
                },
                'Body': {
                    'Text': {
                        'Data': body_text,
                        'Charset': 'UTF-8'
                    }
                }
            }
        )
        
        message_id = response.get('MessageId')
        logger.info(f"Email sent successfully via SES: message_id={message_id}, to={to_email}")
        
        return {
            "success": True,
            "message_id": message_id,
            "error": None
        }
    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        logger.error(f"SES send_email failed: {error_code} - {error_message}")
        
        return {
            "success": False,
            "message_id": None,
            "error": f"{error_code}: {error_message}"
        }
    except Exception as e:
        logger.error(f"Unexpected error sending email via SES: {e}")
        
        return {
            "success": False,
            "message_id": None,
            "error": str(e)
        }


# ==================== メール送信 ====================

# メール保存ディレクトリ（ログ用）
EMAILS_DIR = Path(__file__).parent / "logs" / "emails"
EMAILS_DIR.mkdir(parents=True, exist_ok=True)


def send_reservation_email(
    reservation_id: int,
    member_id: int,
    guest_name: str,
    guest_email: str,
    guest_phone: str,
    studio_name: str,
    studio_address: str = "",
    studio_tel: str = "",
    program_name: str = "",
    reservation_date: str = "",
    reservation_time: str = "",
    duration_minutes: int = 0,
    price: int = 0,
    line_url: str = "",
    base_url: str = "",
    studio_contact_info: dict = None
):
    """予約完了メールを送信（SES使用）+ Slack通知
    
    Args:
        reservation_id: 予約ID
        member_id: メンバーID（キャンセル時に必要）
        guest_name: ゲスト名
        guest_email: メールアドレス
        guest_phone: 電話番号
        studio_name: 店舗名
        studio_address: 店舗住所（後方互換用、studio_contact_info優先）
        studio_tel: 店舗電話番号（後方互換用、studio_contact_info優先）
        program_name: メニュー名
        reservation_date: 予約日
        reservation_time: 予約時間
        duration_minutes: 所要時間（分）
        price: 料金
        line_url: LINE URL（空の場合はLINE関連セクションを除外）
        base_url: 予約確認用ベースURL
        studio_contact_info: 店舗連絡先情報（get_studio_contact_infoで取得）
    
    Returns:
        dict: メール送信結果 {"success": bool, "message_id": str, "error": str}
    """
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    
    # 認証用ハッシュを生成
    verify_hash = generate_verification_hash(guest_email, guest_phone)
    
    # 予約確認URL（member_id + ハッシュを含める、LINE URLがあれば追加）
    detail_url_base = f"{base_url}/reservation-detail?reservation_id={reservation_id}&member_id={member_id}&verify={verify_hash}" if base_url else f"/reservation-detail?reservation_id={reservation_id}&member_id={member_id}&verify={verify_hash}"
    if line_url:
        from urllib.parse import quote
        detail_url = f"{detail_url_base}&line_url={quote(line_url, safe='')}"
    else:
        detail_url = detail_url_base
    
    # LINE URLがある場合のみLINE関連セクションを含める
    if line_url:
        line_section = f"""
【重要】
公式LINEにフルネームをお送りいただきますと、ご予約完了となります。

▼公式LINE
{line_url}

※下記内容をご確認の上、友だち追加をお願いします。
※LINEをお持ちでない方は空メールをお送りくださいませ。
※2日以内にご返信がない場合は自動キャンセルさせていただきますのでご了承ください

"""
        cancel_line_note = "◆キャンセルはご予約日の前日18時までにLINEにてご連絡くださいませ。"
    else:
        line_section = ""
        cancel_line_note = "◆キャンセルはご予約日の前日18時までにご連絡くださいませ。"
    
    email_content = f"""{guest_name}　様

この度は「{studio_name}」にご予約いただき誠にありがとうございます。
今回のご予約内容は以下のとおりです。

----------------------------------

■予約日時
{reservation_date} {reservation_time}

■お客様名
{guest_name}

■店舗名
{studio_name}

■施術コース
{program_name} {f"¥{price:,}" if price else ""}

■所要時間
{duration_minutes}分

■電話番号
{guest_phone}

■予約確認URL
{detail_url}
{line_section}
【当日の注意事項について】
 ・持病がある方に関しては施術によっては医師の同意書が必要になります。
・妊娠中の方の施術はお断りさせていただいております。
・未成年の方は親権者同伴以外の場合、施術不可となります。
・生理中でも施術は可能です。
・お支払いはクレジットカードのみとなります。(カード番号が必要になります)
・初回お試しは全店舗を通して、お一人様一回までとなっております。2回目のご利用の方は通常料金でのご案内となります。

【キャンセルについて】
{cancel_line_note}
◆無断キャンセルの場合は正規の施術代をご負担いただきます。また、次回よりご予約がお取りいただけなくなる場合がございます。
◆前日18時以降のキャンセルやご変更は直前キャンセル料2200円を銀行振り込みにてご請求させていただきます。

お願いばかりで申し訳ございませんが、一部ルールをお守りいただけない方がいらっしゃいますので予めご了承くださいませ。

当日お会いできるのを楽しみにしております。

{_generate_studio_footer(studio_name, studio_contact_info, studio_address, studio_tel)}
"""
    
    # 1. ファイルに保存（ログ用）
    filename = f"{reservation_id}_{timestamp}.txt"
    filepath = EMAILS_DIR / filename
    
    try:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(email_content)
        logger.info(f"Email content saved to: {filepath}")
    except Exception as e:
        logger.error(f"Failed to save email content: {e}")
    
    # 2. SESでメール送信
    subject = f"【予約確認】{studio_name} - {reservation_date} {reservation_time}"
    email_result = send_email_via_ses(
        to_email=guest_email,
        subject=subject,
        body_text=email_content
    )
    
    # 3. Slackにメール内容と送信結果を通知
    try:
        send_email_log_to_slack(
            reservation_id=reservation_id,
            guest_email=guest_email,
            guest_name=guest_name,
            studio_name=studio_name,
            email_content=email_content,
            email_result=email_result,
            reservation_date=reservation_date,
            reservation_time=reservation_time
        )
    except Exception as e:
        logger.error(f"Failed to send email log to Slack: {e}")
    
    return email_result


# 後方互換性のためのエイリアス
def send_reservation_email_mock(*args, **kwargs):
    """後方互換性のためのエイリアス（実際のメール送信に転送）"""
    return send_reservation_email(*args, **kwargs)


# ==================== Slack通知 ====================

def send_slack_notification(
    status: str,  # "success" or "error"
    reservation_id: int = None,
    guest_name: str = "",
    guest_email: str = "",
    guest_phone: str = "",
    studio_name: str = "",
    reservation_date: str = "",
    reservation_time: str = "",
    program_name: str = "",
    instructor_names: str = "",  # スタッフ名（カンマ区切り）
    error_message: str = "",
    error_code: str = ""
):
    """Slackに予約通知を送信
    
    Args:
        status: "success" または "error"
        reservation_id: 予約ID
        guest_name: ゲスト名
        guest_email: メールアドレス
        guest_phone: 電話番号
        studio_name: 店舗名
        reservation_date: 予約日
        reservation_time: 予約時間
        program_name: 施術コース名
        error_message: エラーメッセージ（エラー時）
        error_code: エラーコード（エラー時）
    """
    webhook_url = os.environ.get("SLACK_WEBHOOK_URL")
    
    logger.info(f"Slack notification called: status={status}, reservation_id={reservation_id}, guest_name={guest_name}")
    
    if not webhook_url:
        logger.warning("SLACK_WEBHOOK_URL is not set, skipping Slack notification")
        return
    
    logger.info(f"SLACK_WEBHOOK_URL is set, sending notification to Slack")
    
    try:
        if status == "success":
            color = "good"  # 緑色
            title = "✅ 予約成功"
            fields = [
                {
                    "title": "予約ID",
                    "value": str(reservation_id) if reservation_id else "N/A",
                    "short": True
                },
                {
                    "title": "お客様名",
                    "value": guest_name or "N/A",
                    "short": True
                },
                {
                    "title": "メールアドレス",
                    "value": guest_email or "N/A",
                    "short": True
                },
                {
                    "title": "電話番号",
                    "value": guest_phone or "N/A",
                    "short": True
                },
                {
                    "title": "店舗名",
                    "value": studio_name or "N/A",
                    "short": True
                },
                {
                    "title": "予約日時",
                    "value": f"{reservation_date} {reservation_time}" if reservation_date and reservation_time else "N/A",
                    "short": True
                },
                {
                    "title": "施術コース",
                    "value": program_name or "N/A",
                    "short": False
                }
            ]
        else:  # error
            color = "danger"  # 赤色
            title = "❌ 予約失敗"
            fields = [
                {
                    "title": "エラーコード",
                    "value": error_code or "N/A",
                    "short": True
                },
                {
                    "title": "エラーメッセージ",
                    "value": error_message or "N/A",
                    "short": False
                },
                {
                    "title": "お客様名",
                    "value": guest_name or "N/A",
                    "short": True
                },
                {
                    "title": "メールアドレス",
                    "value": guest_email or "N/A",
                    "short": True
                },
                {
                    "title": "電話番号",
                    "value": guest_phone or "N/A",
                    "short": True
                },
                {
                    "title": "店舗名",
                    "value": studio_name or "N/A",
                    "short": True
                }
            ]
        
        # フォールバック用のテキストサマリーを生成
        if status == "success":
            text_summary = f"✅ 予約成功 - 予約ID: {reservation_id}, お客様: {guest_name}, 店舗: {studio_name}, 日時: {reservation_date} {reservation_time}"
        else:
            text_summary = f"❌ 予約失敗 - エラーコード: {error_code}, エラー: {error_message}, お客様: {guest_name}"
        
        payload = {
            "text": text_summary,  # フォールバック用のテキスト
            "attachments": [
                {
                    "color": color,
                    "title": title,
                    "fields": fields,
                    "footer": "Happle Reservation System",
                    "ts": int(datetime.now().timestamp())
                }
            ]
        }
        
        logger.info(f"Sending Slack notification payload: {json.dumps(payload, ensure_ascii=False)}")
        response = requests.post(
            webhook_url,
            json=payload,
            timeout=5
        )
        response.raise_for_status()
        logger.info(f"Slack notification sent successfully (status: {status}, response_status: {response.status_code})")
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to send Slack notification: {e}, response: {getattr(e, 'response', None)}")
        if hasattr(e, 'response') and e.response is not None:
            logger.error(f"Response status: {e.response.status_code}, body: {e.response.text}")
    except Exception as e:
        logger.error(f"Unexpected error sending Slack notification: {e}", exc_info=True)


def send_email_log_to_slack(
    reservation_id: int,
    guest_email: str,
    guest_name: str,
    studio_name: str,
    email_content: str,
    email_result: dict,
    reservation_date: str = "",
    reservation_time: str = ""
):
    """メール送信結果とメール内容をSlackに通知
    
    Args:
        reservation_id: 予約ID
        guest_email: 送信先メールアドレス
        guest_name: ゲスト名
        studio_name: 店舗名
        email_content: メール本文
        email_result: send_email_via_sesの戻り値 {"success": bool, "message_id": str, "error": str}
        reservation_date: 予約日
        reservation_time: 予約時間
    """
    webhook_url = os.environ.get("SLACK_WEBHOOK_URL")
    
    if not webhook_url:
        logger.warning("SLACK_WEBHOOK_URL is not set, skipping email log notification")
        return
    
    try:
        if email_result.get("success"):
            color = "#36a64f"  # 緑色
            status_emoji = "✅"
            status_text = "送信成功"
            message_id_text = f"Message ID: `{email_result.get('message_id')}`"
        else:
            color = "#ff0000"  # 赤色
            status_emoji = "❌"
            status_text = "送信失敗"
            message_id_text = f"エラー: {email_result.get('error', '不明なエラー')}"
        
        # メール内容を適度な長さに切り詰め（Slackの制限対策）
        email_preview = email_content[:2000] + "..." if len(email_content) > 2000 else email_content
        
        payload = {
            "text": f"{status_emoji} 予約確認メール {status_text}",
            "attachments": [
                {
                    "color": color,
                    "title": f"📧 予約確認メール {status_text}",
                    "fields": [
                        {
                            "title": "予約ID",
                            "value": str(reservation_id),
                            "short": True
                        },
                        {
                            "title": "送信先",
                            "value": guest_email,
                            "short": True
                        },
                        {
                            "title": "お客様名",
                            "value": guest_name,
                            "short": True
                        },
                        {
                            "title": "店舗名",
                            "value": studio_name,
                            "short": True
                        },
                        {
                            "title": "予約日時",
                            "value": f"{reservation_date} {reservation_time}" if reservation_date else "N/A",
                            "short": True
                        },
                        {
                            "title": "送信結果",
                            "value": message_id_text,
                            "short": False
                        }
                    ],
                    "footer": "Happle Reservation - Email Service",
                    "ts": int(datetime.now().timestamp())
                },
                {
                    "color": "#0066cc",
                    "title": "📝 メール内容",
                    "text": f"```\n{email_preview}\n```",
                    "mrkdwn_in": ["text"]
                }
            ]
        }
        
        response = requests.post(webhook_url, json=payload, timeout=10)
        response.raise_for_status()
        logger.info(f"Email log notification sent to Slack for reservation {reservation_id}")
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to send email log to Slack: {e}")
    except Exception as e:
        logger.error(f"Unexpected error sending email log to Slack: {e}")


# ==================== ヘルスチェック ====================

@app.route("/api/health", methods=["GET"])
def health_check():
    """ヘルスチェック"""
    return jsonify({"status": "ok", "timestamp": datetime.utcnow().isoformat()})


# ==================== 店舗 API ====================

@app.route("/api/studios", methods=["GET"])
@handle_errors
def get_studios():
    """店舗一覧を取得"""
    client = get_hacomono_client()
    
    query = {"is_active": True}
    response = client.get_studios(query)
    
    studios = response.get("data", {}).get("studios", {}).get("list", [])
    
    # 必要な情報のみ抽出
    result = []
    for studio in studios:
        result.append({
            "id": studio.get("id"),
            "name": studio.get("name"),
            "code": studio.get("code"),
            "address": f"{studio.get('prefecture', '')} {studio.get('address1', '')} {studio.get('address2', '')}".strip(),
            "tel": studio.get("tel"),
            "business_hours": studio.get("business_hours")
        })
    
    return jsonify({"studios": result})


@app.route("/api/studios/<int:studio_id>", methods=["GET"])
@handle_errors
def get_studio(studio_id: int):
    """店舗詳細を取得"""
    client = get_hacomono_client()
    response = client.get_studio(studio_id)
    
    studio = response.get("data", {}).get("studio", {})
    
    return jsonify({
        "studio": {
            "id": studio.get("id"),
            "name": studio.get("name"),
            "code": studio.get("code"),
            "address": f"{studio.get('prefecture', '')} {studio.get('address1', '')} {studio.get('address2', '')}".strip(),
            "tel": studio.get("tel"),
            "business_hours": studio.get("business_hours")
        }
    })


# ==================== スタッフ API ====================

@app.route("/api/instructors", methods=["GET"])
@handle_errors
def get_instructors():
    """スタッフ一覧を取得（スタジオルームへの紐付け情報含む）"""
    client = get_hacomono_client()
    
    studio_id = request.args.get("studio_id", type=int)
    
    query = {"is_active": True}
    if studio_id:
        query["studio_id"] = studio_id
    
    response = client.get_instructors(query)
    
    instructors = response.get("data", {}).get("instructors", {}).get("list", [])
    
    result = []
    for instructor in instructors:
        result.append({
            "id": instructor.get("id"),
            "name": instructor.get("name"),
            "code": instructor.get("code"),
            "studio_ids": instructor.get("studio_ids", []),
            "studio_room_ids": instructor.get("studio_room_ids", []),  # 予約カテゴリへの紐付け
            "program_ids": instructor.get("program_ids", []),  # プログラムへの紐付け
            "selectable_studio_room_details": instructor.get("selectable_studio_room_details", []),
            "is_hide_from_member_site": instructor.get("is_hide_from_member_site", False),
        })
    
    return jsonify({"instructors": result})


# ==================== プログラム API ====================

@app.route("/api/programs", methods=["GET"])
@handle_errors
def get_programs():
    """プログラム一覧を取得"""
    client = get_hacomono_client()
    
    studio_id = request.args.get("studio_id", type=int)
    
    query = {"is_active": True}
    if studio_id:
        query["studio_id"] = studio_id
    
    response = client.get_programs(query)
    
    programs = response.get("data", {}).get("programs", {}).get("list", [])
    
    # 必要な情報のみ抽出
    result = []
    for program in programs:
        result.append({
            "id": program.get("id"),
            "name": program.get("name"),
            "code": program.get("code"),
            "description": program.get("description"),
            "duration": program.get("duration"),
            "capacity": program.get("capacity"),
            "price": program.get("price"),
            "thumbnail": program.get("thumbnail_code"),
            # 自由枠予約用の設定
            "service_minutes": program.get("service_minutes"),  # コースの所要時間（分）
            "max_service_minutes": program.get("max_service_minutes"),  # 最大延長時間
            "reservable_to_minutes": program.get("reservable_to_minutes"),  # 予約締切（開始X分前まで）
            "before_interval_minutes": program.get("before_interval_minutes"),  # 開始前ブロック時間
            "after_interval_minutes": program.get("after_interval_minutes"),  # 終了後ブロック時間
            "selectable_instructor_details": program.get("selectable_instructor_details"),  # 選択可能スタッフ詳細
            "selectable_resource_details": program.get("selectable_resource_details"),  # 選択可能設備詳細
        })
    
    return jsonify({"programs": result})


@app.route("/api/programs/<int:program_id>", methods=["GET"])
@handle_errors
def get_program(program_id: int):
    """プログラム詳細を取得"""
    client = get_hacomono_client()
    response = client.get_program(program_id)
    
    program = response.get("data", {}).get("program", {})
    
    return jsonify({
        "program": {
            "id": program.get("id"),
            "name": program.get("name"),
            "code": program.get("code"),
            "description": program.get("description"),
            "duration": program.get("duration"),
            "capacity": program.get("capacity"),
            "price": program.get("price")
        }
    })


@app.route("/api/instructors/available", methods=["GET"])
@handle_errors
def get_available_instructors():
    """指定日時の空いているスタッフを取得（自由枠予約用）"""
    client = get_hacomono_client()
    
    studio_room_id = request.args.get("studio_room_id", type=int)
    date = request.args.get("date")  # YYYY-MM-DD
    start_time = request.args.get("start_time")  # HH:mm:ss
    duration_minutes = request.args.get("duration_minutes", type=int, default=30)
    
    if not studio_room_id or not date or not start_time:
        return jsonify({"error": "Missing required parameters: studio_room_id, date, start_time"}), 400
    
    try:
        # choice/scheduleからスタッフ情報を取得
        schedule_response = client.get_choice_schedule(studio_room_id, date)
        schedule = schedule_response.get("data", {}).get("schedule", {})
        
        # 利用可能なスタッフを取得
        shift_instructors = schedule.get("shift_instructor", [])
        reserved_instructors = schedule.get("reservation_assign_instructor", [])
        
        # 開始日時を構築
        start_datetime = datetime.strptime(f"{date} {start_time}", "%Y-%m-%d %H:%M:%S")
        end_datetime = start_datetime + timedelta(minutes=duration_minutes)
        
        # 予約済みのスタッフIDを取得（時間が重なっているもの）
        # 休憩ブロック（reservation_typeがBREAKやBLOCKなど）も予約不可として扱う
        reserved_instructor_ids = set()
        for reserved in reserved_instructors:
            try:
                reserved_start_str = reserved.get("start_at", "")
                reserved_end_str = reserved.get("end_at", "")
                if not reserved_start_str or not reserved_end_str:
                    continue
                reserved_start = datetime.fromisoformat(reserved_start_str.replace("Z", "+00:00"))
                reserved_end = datetime.fromisoformat(reserved_end_str.replace("Z", "+00:00"))
                # 時間が重なっているかチェック
                # 休憩ブロック（reservation_typeがBREAK、BLOCK、RESTなど）も予約不可として扱う
                reservation_type = reserved.get("reservation_type", "").upper()
                is_block = reservation_type in ["BREAK", "BLOCK", "REST", "休憩", "ブロック"]
                if start_datetime < reserved_end and end_datetime > reserved_start:
                    reserved_instructor_ids.add(reserved.get("entity_id"))
            except Exception as e:
                logger.warning(f"Failed to parse reserved instructor time: {e}")
                continue
        
        # 空いているスタッフを抽出
        available_instructors = []
        for instructor in shift_instructors:
            instructor_id = instructor.get("instructor_id")
            try:
                instructor_start_str = instructor.get("start_at", "")
                instructor_end_str = instructor.get("end_at", "")
                if not instructor_start_str or not instructor_end_str:
                    continue
                instructor_start = datetime.fromisoformat(instructor_start_str.replace("Z", "+00:00"))
                instructor_end = datetime.fromisoformat(instructor_end_str.replace("Z", "+00:00"))
                
                # シフト時間内で、予約が入っていないスタッフ
                if (instructor_start <= start_datetime < instructor_end and 
                    instructor_id not in reserved_instructor_ids):
                    available_instructors.append({
                        "id": instructor_id,
                        "start_at": instructor.get("start_at"),
                        "end_at": instructor.get("end_at")
                    })
            except Exception as e:
                logger.warning(f"Failed to parse instructor time: {e}")
                continue
        
        return jsonify({
            "available_instructors": available_instructors,
            "total_count": len(available_instructors)
        })
    except HacomonoAPIError as e:
        logger.error(f"Failed to get available instructors: {e}")
        return jsonify({"error": "Failed to get available instructors", "message": str(e)}), 400


# ==================== スケジュール API ====================

# 予約可能なスペースIDのキャッシュ（space_detailsにnoフィールドがあるスペース）
_reservable_space_ids_cache = None

def _get_reservable_space_ids(client):
    """予約可能なスペースIDを取得（space_detailsにnoフィールドがあるもの）"""
    global _reservable_space_ids_cache
    
    if _reservable_space_ids_cache is not None:
        return _reservable_space_ids_cache
    
    try:
        response = client.get("/master/studio-room-spaces")
        spaces = response.get("data", {}).get("studio_room_spaces", {}).get("list", [])
        
        reservable_ids = set()
        for space in spaces:
            space_details = space.get("space_details", [])
            # space_detailsにnoフィールドがあるかチェック
            has_no = any(detail.get("no") is not None for detail in space_details)
            if has_no:
                reservable_ids.add(space.get("id"))
                logger.debug(f"Reservable space: ID={space.get('id')} name={space.get('name')}")
        
        _reservable_space_ids_cache = reservable_ids
        logger.info(f"Found {len(reservable_ids)} reservable spaces: {reservable_ids}")
        return reservable_ids
    except Exception as e:
        logger.warning(f"Failed to get reservable spaces: {e}, using fallback")
        return {3}  # フォールバック


def _parse_lessons(lessons, studio_id=None, program_id=None, reservable_space_ids=None, 
                    space_capacities=None, reservation_counts=None):
    """レッスンデータを解析して整形
    
    Args:
        space_capacities: {space_id: capacity} スペースIDごとの席数
        reservation_counts: {lesson_id: count} レッスンIDごとの予約数
    """
    result = []
    for lesson in lessons:
        # studio_idフィルタ
        if studio_id and lesson.get("studio_id") != studio_id:
            continue
        
        # program_idフィルタ
        if program_id and lesson.get("program_id") != program_id:
            continue
        
        # 予約可能なスペースのみフィルタ（space_detailsにnoフィールドがあるスペース）
        space_id = lesson.get("studio_room_space_id")
        if reservable_space_ids:
            if space_id and space_id not in reservable_space_ids:
                continue
        
        # スペース情報からcapacityを取得
        if space_capacities and space_id in space_capacities:
            capacity = space_capacities[space_id]
        else:
            capacity = lesson.get("capacity") or lesson.get("max_num") or 5
        
        # 予約一覧から予約数を取得
        lesson_id = lesson.get("id")
        if reservation_counts and lesson_id in reservation_counts:
            reserved = reservation_counts[lesson_id]
        else:
            reserved = lesson.get("reserved_count") or lesson.get("reserved_num") or 0
        
        result.append({
            "id": lesson_id,
            "studio_id": lesson.get("studio_id"),
            "program_id": lesson.get("program_id"),
            "program_name": lesson.get("program", {}).get("name") if isinstance(lesson.get("program"), dict) else None,
            "instructor_id": lesson.get("instructor_id"),
            "instructor_name": lesson.get("instructor", {}).get("name") if isinstance(lesson.get("instructor"), dict) else None,
            "start_at": lesson.get("start_at"),
            "end_at": lesson.get("end_at"),
            "capacity": capacity,
            "reserved_count": reserved,
            "available": max(0, capacity - reserved),
            "is_reservable": lesson.get("is_reservable", True) and (capacity - reserved) > 0
        })
    
    # 日付順でソート
    result.sort(key=lambda x: x.get("start_at", ""))
    return result


@app.route("/api/schedule/all", methods=["GET"])
@handle_errors
def get_schedule_all():
    """全レッスンスケジュールを取得（フィルタリングなし - テスト用）"""
    client = get_hacomono_client()
    
    studio_id = request.args.get("studio_id", type=int)
    program_id = request.args.get("program_id", type=int)
    
    # 予約可能なスペースIDを取得
    reservable_space_ids = _get_reservable_space_ids(client)
    
    response = client.get_studio_lessons(None)
    lessons = response.get("data", {}).get("studio_lessons", {}).get("list", [])
    
    result = _parse_lessons(lessons, studio_id, program_id, reservable_space_ids)
    
    return jsonify({
        "schedule": result,
        "total_count": len(result),
        "reservable_space_ids": list(reservable_space_ids),
        "note": "予約可能なスペース（space_detailsにnoフィールドあり）のレッスンのみ表示"
    })


def _get_space_capacities(client) -> dict:
    """スペースIDごとの席数を取得"""
    try:
        response = client.get_studio_room_spaces()
        spaces = response.get("data", {}).get("studio_room_spaces", {}).get("list", [])
        
        capacities = {}
        for space in spaces:
            space_id = space.get("id")
            space_details = space.get("space_details", [])
            # noフィールドがあるdetailの数がcapacity
            valid_details = [d for d in space_details if d.get("no") is not None]
            if valid_details:
                capacities[space_id] = len(valid_details)
        
        return capacities
    except Exception as e:
        logger.warning(f"Failed to get space capacities: {e}")
        return {}


def _get_reservation_counts(client, lesson_ids: list) -> dict:
    """レッスンIDごとの予約数を取得"""
    if not lesson_ids:
        return {}
    
    try:
        # 予約一覧を取得（status=2: 確定済み のみカウント）
        response = client.get("/reservation/reservations")
        reservations = response.get("data", {}).get("reservations", {}).get("list", [])
        
        counts = {}
        for r in reservations:
            lesson_id = r.get("studio_lesson_id")
            status = r.get("status")
            # status 2=確定, 3=完了 を予約済みとしてカウント
            if lesson_id and status in [2, 3]:
                if lesson_id in lesson_ids:
                    counts[lesson_id] = counts.get(lesson_id, 0) + 1
        
        return counts
    except Exception as e:
        logger.warning(f"Failed to get reservation counts: {e}")
        return {}


@app.route("/api/schedule", methods=["GET"])
@handle_errors
def get_schedule():
    """レッスンスケジュールを取得（日付フィルタリングあり）"""
    client = get_hacomono_client()
    
    studio_id = request.args.get("studio_id", type=int)
    program_id = request.args.get("program_id", type=int)
    start_date = request.args.get("start_date")  # YYYY-MM-DD
    end_date = request.args.get("end_date")  # YYYY-MM-DD
    
    # デフォルトは今日から14日間
    if not start_date:
        start_date = datetime.now().strftime("%Y-%m-%d")
    if not end_date:
        end_date = (datetime.now() + timedelta(days=14)).strftime("%Y-%m-%d")
    
    # 予約可能なスペースIDとcapacityを取得
    reservable_space_ids = _get_reservable_space_ids(client)
    space_capacities = _get_space_capacities(client)
    
    # hacomono APIのdate_from/date_toクエリを使用
    query = {}
    if studio_id:
        query["studio_id"] = studio_id
    
    response = client.get_studio_lessons(
        query=query if query else None,
        date_from=start_date,
        date_to=end_date
    )
    lessons = response.get("data", {}).get("studio_lessons", {}).get("list", [])
    
    # レッスンIDのリストを作成
    lesson_ids = [l.get("id") for l in lessons if l.get("id")]
    
    # 予約数を取得
    reservation_counts = _get_reservation_counts(client, lesson_ids)
    
    result = _parse_lessons(lessons, studio_id, program_id, reservable_space_ids,
                            space_capacities, reservation_counts)
    
    return jsonify({
        "schedule": result,
        "filter": {
            "start_date": start_date,
            "end_date": end_date,
            "studio_id": studio_id,
            "program_id": program_id
        },
        "reservable_space_ids": list(reservable_space_ids)
    })


# ==================== 予約 API ====================

def _parse_hacomono_error(error: HacomonoAPIError) -> dict:
    """hacomonoエラーをユーザーフレンドリーなメッセージに変換"""
    # response_bodyからエラーコードを抽出
    error_str = str(error)
    response_body = getattr(error, 'response_body', '') or ''
    
    # response_bodyも含めて検索対象にする
    search_text = f"{error_str} {response_body}"
    
    # よくあるエラーコードと日本語メッセージの対応
    error_messages = {
        "RSV_000309": "この時間帯は予約できません。営業時間外または予約可能期間外です。",
        "RSV_000308": "スタッフが設定されていないか、選択したスタッフが無効です。",
        "RSV_000304": "この時間帯は予約できません。営業時間外または予約枠が満席の可能性があります。",
        "RSV_000008": "この席は既に予約されています。別の時間帯を選択してください。",
        "RSV_000005": "予約に必要なチケットがありません。",
        "RSV_000001": "この枠は既に予約で埋まっています。",
        "CMN_000051": "必要な情報が不足しています。",
        "CMN_000025": "電話番号が正しくありません。ハイフンなしの半角数字11桁で入力してください（例: 09012345678）。",
        "CMN_000022": "このメールアドレスは既に使用されています。",
        "CMN_000001": "システムエラーが発生しました。スペースの席設定（no）が正しくない可能性があります。",
    }
    
    for code, message in error_messages.items():
        if code in search_text:
            return {"error_code": code, "user_message": message, "detail": response_body or error_str}
    
    # エラーコードが見つからない場合、response_bodyからメッセージを抽出
    try:
        import json
        body_json = json.loads(response_body)
        if body_json.get("errors"):
            api_message = body_json["errors"][0].get("message", "")
            if api_message:
                return {"error_code": "UNKNOWN", "user_message": api_message, "detail": response_body}
    except:
        pass
    
    return {"error_code": "UNKNOWN", "user_message": "予約処理中にエラーが発生しました。", "detail": response_body or error_str}


def _create_guest_member(client, guest_name: str, guest_email: str, guest_phone: str, 
                         guest_name_kana: str = "", guest_note: str = "",
                         gender: int = 2, birthday: str = "2000-01-01", studio_id: int = 2,
                         ticket_id: int = 5):
    """ゲストメンバーを作成（または既存メンバーを使用）し、チケットを付与
    
    Args:
        gender: 性別（1: 男性, 2: 女性）デフォルト: 2（女性）
        ticket_id: 付与するチケットID（デフォルト: 5 = Web予約用チケット）
    """
    import secrets
    import string
    
    member_id = None
    
    # まず、メールアドレスで既存メンバーを検索
    try:
        search_response = client.get_members({"keyword": guest_email})
        members = search_response.get("data", {}).get("members", {}).get("list", [])
        for member in members:
            if member.get("mail_address") == guest_email:
                member_id = member.get("id")
                logger.info(f"Found existing member: ID={member_id}, email={guest_email}")
                break
    except Exception as e:
        logger.warning(f"Failed to search for existing member: {e}")
    
    # 既存メンバーが見つからない場合は新規作成
    if not member_id:
        # 名前を姓名に分割
        name_parts = guest_name.split()
        if len(name_parts) >= 2:
            last_name = name_parts[0]
            first_name = " ".join(name_parts[1:])
        else:
            last_name = guest_name
            first_name = guest_name  # 名前が1つの場合は両方に設定
        
        # フリガナも分割
        kana_parts = guest_name_kana.split() if guest_name_kana else []
        if len(kana_parts) >= 2:
            last_name_kana = kana_parts[0]
            first_name_kana = " ".join(kana_parts[1:])
        else:
            last_name_kana = guest_name_kana or None
            first_name_kana = guest_name_kana or None
        
        # ランダムパスワードを生成
        random_password = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(12)) + "!A1"
        
        member_data = {
            "last_name": last_name,
            "first_name": first_name,
            "last_name_kana": last_name_kana,
            "first_name_kana": first_name_kana,
            "mail_address": guest_email,
            "tel": guest_phone,
            "plain_password": random_password,
            "gender": gender,
            "birthday": birthday,
            "studio_id": studio_id,
            "note": f"Web予約ゲスト: {guest_note}"
        }
        
        # メンバーを作成
        member_response = client.create_member(member_data)
        member_id = member_response.get("data", {}).get("member", {}).get("id")
        
        if not member_id:
            raise ValueError("メンバーの作成に失敗しました")
        
        logger.info(f"Created new member ID: {member_id}")
    
    # 2. チケットを付与（指定されたチケットID、またはデフォルトのWeb予約用チケット）
    try:
        ticket_response = client.grant_ticket_to_member(member_id, ticket_id=ticket_id, num=1)
        member_ticket_id = ticket_response.get("data", {}).get("member_ticket", {}).get("id")
        logger.info(f"Granted ticket {ticket_id}, member_ticket_id: {member_ticket_id}")
    except HacomonoAPIError as e:
        # チケット付与に失敗した場合も続行（既存チケットがあるかも）
        logger.warning(f"Failed to grant ticket {ticket_id}: {e}")
        member_ticket_id = None
    
    return member_id, member_ticket_id


@app.route("/api/reservations", methods=["POST"])
@handle_errors
def create_reservation():
    """固定枠予約を作成（ゲスト予約）"""
    client = get_hacomono_client()
    data = request.get_json()
    
    # 必須パラメータの検証
    required_fields = ["studio_lesson_id", "guest_name", "guest_email", "guest_phone"]
    for field in required_fields:
        if not data.get(field):
            return jsonify({
                "success": False,
                "error": f"入力が不足しています: {field}",
                "error_code": "VALIDATION_ERROR"
            }), 400
    
    studio_lesson_id = data["studio_lesson_id"]
    
    # 0. レッスンの日時を取得して予約可能範囲をチェック、プログラムIDも取得
    lesson_program_id = None
    try:
        lesson_check = client.get_studio_lesson(studio_lesson_id)
        lesson_data = lesson_check.get("data", {}).get("studio_lesson", {})
        lesson_start_at = lesson_data.get("start_at")
        lesson_program_id = lesson_data.get("program_id")
        
        if lesson_start_at:
            # ISO形式をdatetimeに変換
            lesson_datetime = datetime.fromisoformat(lesson_start_at.replace("Z", "+00:00")).replace(tzinfo=None)
            is_valid, error_msg = validate_reservation_datetime(lesson_datetime)
            if not is_valid:
                return jsonify({
                    "success": False,
                    "error": error_msg,
                    "error_code": "DATETIME_OUT_OF_RANGE"
                }), 400
    except Exception as e:
        logger.warning(f"Failed to validate lesson datetime: {e}")
        # 日時チェックに失敗しても続行（後のAPIで弾かれる）
    
    # 1. プログラムに紐づくチケットIDを取得
    DEFAULT_TICKET_ID = 5  # Web予約用デフォルトチケット
    ticket_id_to_grant = DEFAULT_TICKET_ID
    
    if lesson_program_id:
        try:
            program_response = client.get_program(lesson_program_id)
            program = program_response.get("data", {}).get("program", {})
            
            # プログラムに紐づくチケットIDを取得（ticket_ids, consumable_ticket_ids などを確認）
            program_ticket_ids = program.get("ticket_ids") or program.get("consumable_ticket_ids") or []
            logger.info(f"Fixed slot program {lesson_program_id} ticket-related fields: ticket_ids={program.get('ticket_ids')}, consumable_ticket_ids={program.get('consumable_ticket_ids')}")
            
            if program_ticket_ids and len(program_ticket_ids) > 0:
                ticket_id_to_grant = program_ticket_ids[0]
                logger.info(f"Using program-linked ticket ID: {ticket_id_to_grant}")
            else:
                logger.info(f"No program-linked ticket found, using default: {ticket_id_to_grant}")
        except Exception as e:
            logger.warning(f"Failed to get program info for ticket: {e}")
    
    # 2. ゲストメンバーを作成してチケットを付与
    try:
        member_id, member_ticket_id = _create_guest_member(
            client=client,
            guest_name=data["guest_name"],
            guest_email=data["guest_email"],
            guest_phone=data["guest_phone"],
            guest_name_kana=data.get("guest_name_kana", ""),
            guest_note=data.get("guest_note", ""),
            gender=data.get("gender", 2),  # デフォルト: 女性
            birthday=data.get("birthday", "2000-01-01"),
            studio_id=data.get("studio_id", 2),
            ticket_id=ticket_id_to_grant
        )
    except HacomonoAPIError as e:
        error_info = _parse_hacomono_error(e)
        logger.error(f"Failed to create member: {e}")
        logger.error(f"Member creation API response body: {e.response_body}")
        
        # Slack通知（エラー）
        send_slack_notification(
            status="error",
            guest_name=data.get("guest_name", ""),
            guest_email=data.get("guest_email", ""),
            guest_phone=data.get("guest_phone", ""),
            studio_name="",
            error_message=error_info["user_message"],
            error_code=error_info["error_code"]
        )
        
        return jsonify({
            "success": False,
            "error": "ゲスト情報の登録に失敗しました",
            "error_code": error_info["error_code"],
            "message": error_info["user_message"],
            "detail": error_info["detail"]
        }), 400
    except ValueError as e:
        # Slack通知（エラー）
        send_slack_notification(
            status="error",
            guest_name=data.get("guest_name", ""),
            guest_email=data.get("guest_email", ""),
            guest_phone=data.get("guest_phone", ""),
            studio_name="",
            error_message=str(e),
            error_code="MEMBER_CREATE_ERROR"
        )
        
        return jsonify({
            "success": False,
            "error": str(e),
            "error_code": "MEMBER_CREATE_ERROR"
        }), 400
    
    # 2. レッスン情報を取得して空き席を決定
    space_no = None
    space_has_valid_no = False
    available_seats = []
    studio_room_space_id = None
    
    try:
        lesson_response = client.get_studio_lesson(studio_lesson_id)
        lesson = lesson_response.get("data", {}).get("studio_lesson", {})
        studio_room_space_id = lesson.get("studio_room_space_id")
        logger.info(f"Lesson info: id={studio_lesson_id}, space_id={studio_room_space_id}, is_selectable_space={lesson.get('is_selectable_space')}")
        
        # スペース情報を直接取得
        if studio_room_space_id:
            try:
                space_response = client.get_studio_room_space(studio_room_space_id)
                space = space_response.get("data", {}).get("studio_room_space", {})
                
                space_details = space.get("space_details", [])
                logger.info(f"Space {studio_room_space_id} details: {space_details}")
                
                # 全ての席番号を取得
                all_seats = []
                for detail in space_details:
                    no_val = detail.get("no")
                    if no_val is not None:
                        all_seats.append(int(no_val))
                        space_has_valid_no = True
                
                if all_seats:
                    # このレッスンの予約済み席を取得
                    reserved_seats = set()
                    try:
                        reservations_response = client.get("/reservation/reservations", 
                            params={"query": json.dumps({"studio_lesson_id": studio_lesson_id})})
                        reservations = reservations_response.get("data", {}).get("reservations", {}).get("list", [])
                        for r in reservations:
                            # status 2=確定, 3=完了 を予約済みとしてカウント
                            if r.get("status") in [2, 3]:
                                reserved_no = r.get("no")
                                if reserved_no:
                                    reserved_seats.add(int(reserved_no))
                        logger.info(f"Reserved seats for lesson {studio_lesson_id}: {reserved_seats}")
                    except Exception as e:
                        logger.warning(f"Failed to get reservations: {e}")
                    
                    # 空き席を計算
                    available_seats = [s for s in all_seats if s not in reserved_seats]
                    logger.info(f"Available seats: {available_seats}")
                    
                    if available_seats:
                        space_no = str(available_seats[0])  # 最初の空き席を使用
                    else:
                        # 満席
                        # Slack通知（エラー）
                        send_slack_notification(
                            status="error",
                            guest_name=data.get("guest_name", ""),
                            guest_email=data.get("guest_email", ""),
                            guest_phone=data.get("guest_phone", ""),
                            studio_name="",
                            error_message="選択されたレッスンは満席です。別の時間帯を選択してください。",
                            error_code="RSV_000008"
                        )
                        
                        return jsonify({
                            "success": False,
                            "error": "この時間帯は満席です",
                            "error_code": "RSV_000008",
                            "message": "選択されたレッスンは満席です。別の時間帯を選択してください。"
                        }), 400
                
                # noがない場合、no_labelはフォールバックとして使用
                if not space_has_valid_no:
                    for detail in space_details:
                        no_label = detail.get("no_label")
                        if no_label:
                            space_no = str(no_label)
                            logger.warning(f"Space {studio_room_space_id} has no_label but no 'no' field - may fail reservation")
                            break
                
                logger.info(f"Using seat no={space_no} for reservation")
            except Exception as e:
                logger.warning(f"Failed to get space details: {e}")
        
        # フロントエンドから指定された場合はそちらを優先
        if data.get("space_no"):
            space_no = data.get("space_no")
            space_has_valid_no = True
            
    except HacomonoAPIError as e:
        logger.warning(f"Failed to get lesson info: {e}")
        space_no = data.get("space_no")
        if space_no:
            space_has_valid_no = True
    
    # スペースに有効なnoがない場合はエラー
    if not space_no or not space_has_valid_no:
        logger.error(f"Space {studio_room_space_id} does not have valid 'no' field in space_details")
        
        # Slack通知（エラー）
        send_slack_notification(
            status="error",
            guest_name=data.get("guest_name", ""),
            guest_email=data.get("guest_email", ""),
            guest_phone=data.get("guest_phone", ""),
            studio_name="",
            error_message="スペースの席設定（no）が正しくありません。管理画面でスペースの席を正しく設定してください。",
            error_code="SPACE_NO_MISSING"
        )
        
        return jsonify({
            "success": False,
            "error": "このレッスン枠は予約できません",
            "error_code": "SPACE_NO_MISSING",
            "message": "スペースの席設定（no）が正しくありません。管理画面でスペースの席を正しく設定してください。",
            "detail": f"space_id={studio_room_space_id} has no valid 'no' field in space_details"
        }), 400
    
    # 3. 予約を作成
    reservation_data = {
        "member_id": member_id,
        "studio_lesson_id": studio_lesson_id,
        "no": space_no
    }
    
    if member_ticket_id:
        reservation_data["member_ticket_id"] = member_ticket_id
    
    try:
        logger.info(f"Creating fixed reservation with data: {reservation_data}")
        reservation_response = client.create_reservation(reservation_data)
        reservation = reservation_response.get("data", {}).get("reservation", {})
        logger.info(f"Fixed reservation created: {reservation.get('id')}")
    except HacomonoAPIError as e:
        error_info = _parse_hacomono_error(e)
        logger.error(f"Failed to create reservation: {e}")
        logger.error(f"API response body: {e.response_body}")
        
        # Slack通知（エラー）
        send_slack_notification(
            status="error",
            guest_name=data.get("guest_name", ""),
            guest_email=data.get("guest_email", ""),
            guest_phone=data.get("guest_phone", ""),
            studio_name="",
            error_message=error_info["user_message"],
            error_code=error_info["error_code"]
        )
        
        return jsonify({
            "success": False,
            "error": "予約の作成に失敗しました",
            "error_code": error_info["error_code"],
            "message": error_info["user_message"],
            "detail": error_info["detail"]
        }), 400
    
    # 4. 予約確認メールを送信（モック）
    reservation_id = reservation.get("id")
    try:
        # レッスン情報から詳細を取得
        lesson_response = client.get_studio_lesson(studio_lesson_id)
        lesson_data = lesson_response.get("data", {}).get("studio_lesson", {})
        
        # 日時のフォーマット
        start_at = lesson_data.get("start_at", "")
        end_at = lesson_data.get("end_at", "")
        reservation_date = ""
        reservation_time = ""
        duration_minutes = 0
        
        if start_at:
            try:
                start_dt = datetime.fromisoformat(start_at.replace("Z", "+00:00"))
                reservation_date = start_dt.strftime("%Y-%m-%d(%a)")
                reservation_time = start_dt.strftime("%H:%M")
                if end_at:
                    end_dt = datetime.fromisoformat(end_at.replace("Z", "+00:00"))
                    duration_minutes = int((end_dt - start_dt).total_seconds() / 60)
            except:
                pass
        
        # 店舗情報を取得
        studio_id = data.get("studio_id", 2)
        studio_name = ""
        studio_address = ""
        studio_tel = ""
        studio_data = {}
        try:
            studio_response = client.get_studio(studio_id)
            studio_data = studio_response.get("data", {}).get("studio", {})
            studio_name = studio_data.get("name", "")
            studio_address = studio_data.get("address", "")
            studio_tel = studio_data.get("tel", "")
        except:
            pass
        
        # 店舗連絡先情報を取得（パラメータ優先、なければhacomonoからフォールバック）
        contact_overrides = {
            "studio_zip": data.get("studio_zip"),
            "studio_address": data.get("studio_address"),
            "studio_tel": data.get("studio_tel"),
            "studio_url": data.get("studio_url"),
            "studio_email": data.get("studio_email"),
            "line_url": data.get("line_url")
        }
        studio_contact_info = get_studio_contact_info(studio_data, contact_overrides)
        
        # プログラム情報を取得
        program_id = lesson_data.get("program_id")
        program_name = ""
        price = 0
        if program_id:
            try:
                program_response = client.get_program(program_id)
                program_data = program_response.get("data", {}).get("program", {})
                program_name = program_data.get("name", "")
                price = program_data.get("price", 0)
            except:
                pass
        
        # メール送信モック
        base_url = request.headers.get("Origin", "")
        line_url = studio_contact_info.get("line_url", "")
        send_reservation_email_mock(
            reservation_id=reservation_id,
            member_id=member_id,
            guest_name=data["guest_name"],
            guest_email=data["guest_email"],
            guest_phone=data["guest_phone"],
            studio_name=studio_name,
            studio_address=studio_address,
            studio_tel=studio_tel,
            program_name=program_name,
            reservation_date=reservation_date,
            reservation_time=reservation_time,
            duration_minutes=duration_minutes,
            price=price,
            line_url=line_url,
            base_url=base_url,
            studio_contact_info=studio_contact_info
        )
    except Exception as e:
        logger.warning(f"Failed to send email mock: {e}")
    
    # 認証用ハッシュを生成（フロントエンドに返す）
    verify_hash_value = generate_verification_hash(data["guest_email"], data["guest_phone"])
    
    # 店舗連絡先情報からLINE URLを取得（レスポンスに含める）
    line_url = studio_contact_info.get("line_url", "") if 'studio_contact_info' in locals() else data.get("line_url", "")
    
    # Slack通知（成功）
    send_slack_notification(
        status="success",
        reservation_id=reservation_id,
        guest_name=data.get("guest_name", ""),
        guest_email=data.get("guest_email", ""),
        guest_phone=data.get("guest_phone", ""),
        studio_name=studio_name,
        reservation_date=reservation_date,
        reservation_time=reservation_time,
        program_name=program_name
    )
    
    return jsonify({
        "success": True,
        "reservation": {
            "id": reservation_id,
            "member_id": member_id,
            "studio_lesson_id": studio_lesson_id,
            "status": reservation.get("status"),
            "created_at": reservation.get("created_at")
        },
        "verify": verify_hash_value,
        "line_url": line_url,
        "message": "予約が完了しました"
    }), 201


@app.route("/api/reservations/<int:reservation_id>", methods=["GET"])
@handle_errors
def get_reservation(reservation_id: int):
    """予約詳細を取得（拡張版）
    
    セキュリティのため、member_id + verifyハッシュで認証
    """
    client = get_hacomono_client()
    
    # 認証パラメータを取得
    provided_member_id = request.args.get("member_id", type=int)
    provided_verify = request.args.get("verify")
    
    if not provided_member_id or not provided_verify:
        return jsonify({
            "error": "認証情報が不足しています",
            "message": "正しいリンクからアクセスしてください"
        }), 400
    
    response = client.get_reservation(reservation_id)
    
    reservation = response.get("data", {}).get("reservation", {})
    
    # 予約のmember_idと一致するか確認
    actual_member_id = reservation.get("member_id")
    if actual_member_id != provided_member_id:
        logger.warning(f"Member ID mismatch for reservation {reservation_id}: provided={provided_member_id}, actual={actual_member_id}")
        return jsonify({
            "error": "認証に失敗しました",
            "message": "正しいリンクからアクセスしてください"
        }), 403
    
    # 予約ステータスの日本語変換
    status_map = {
        1: "仮予約",
        2: "確定",
        3: "完了",
        4: "キャンセル",
        5: "無断キャンセル"
    }
    status = reservation.get("status")
    status_label = status_map.get(status, "不明")
    
    # 関連情報を取得
    member_info = {}
    studio_info = {}
    program_info = {}
    lesson_info = {}
    
    # メンバー情報を取得してハッシュを検証
    member_id = reservation.get("member_id")
    if member_id:
        try:
            member_response = client.get_member(member_id)
            member_data = member_response.get("data", {}).get("member", {})
            member_email = member_data.get("mail_address", "")
            member_phone = member_data.get("tel", "")
            
            # ハッシュ検証
            if not verify_hash(member_email, member_phone, provided_verify):
                logger.warning(f"Hash verification failed for reservation {reservation_id}, member {member_id}")
                return jsonify({
                    "error": "認証に失敗しました",
                    "message": "正しいリンクからアクセスしてください"
                }), 403
            
            member_info = {
                "id": member_id,
                "name": f"{member_data.get('last_name', '')} {member_data.get('first_name', '')}".strip(),
                "name_kana": f"{member_data.get('last_name_kana', '')} {member_data.get('first_name_kana', '')}".strip(),
                "email": member_email,
                "phone": member_phone
            }
        except Exception as e:
            logger.warning(f"Failed to get member info: {e}")
            return jsonify({
                "error": "認証処理中にエラーが発生しました",
                "message": "時間をおいて再度お試しください"
            }), 500
    
    # レッスン情報（固定枠の場合）
    studio_lesson_id = reservation.get("studio_lesson_id")
    if studio_lesson_id:
        try:
            lesson_response = client.get_studio_lesson(studio_lesson_id)
            lesson_data = lesson_response.get("data", {}).get("studio_lesson", {})
            lesson_info = {
                "id": studio_lesson_id,
                "date": lesson_data.get("date"),
                "start_at": lesson_data.get("start_at"),
                "end_at": lesson_data.get("end_at"),
                "program_id": lesson_data.get("program_id"),
                "studio_id": lesson_data.get("studio_id")
            }
            
            # プログラム情報
            program_id = lesson_data.get("program_id")
            if program_id:
                try:
                    program_response = client.get_program(program_id)
                    program_data = program_response.get("data", {}).get("program", {})
                    program_info = {
                        "id": program_id,
                        "name": program_data.get("name", ""),
                        "description": program_data.get("description", ""),
                        "duration": program_data.get("duration", 0),
                        "price": program_data.get("price", 0)
                    }
                except Exception as e:
                    logger.warning(f"Failed to get program info: {e}")
            
            # 店舗情報
            studio_id = lesson_data.get("studio_id")
            if studio_id:
                try:
                    studio_response = client.get_studio(studio_id)
                    studio_data = studio_response.get("data", {}).get("studio", {})
                    studio_info = {
                        "id": studio_id,
                        "name": studio_data.get("name", ""),
                        "code": studio_data.get("code", ""),
                        "address": studio_data.get("address", ""),
                        "tel": studio_data.get("tel", "")
                    }
                except Exception as e:
                    logger.warning(f"Failed to get studio info: {e}")
        except Exception as e:
            logger.warning(f"Failed to get lesson info: {e}")
    
    # 自由枠予約の場合（studio_room_idがある）
    studio_room_id = reservation.get("studio_room_id")
    if studio_room_id and not studio_lesson_id:
        try:
            # スタジオルーム情報から店舗IDを取得
            room_response = client.get_studio_room(studio_room_id)
            room_data = room_response.get("data", {}).get("studio_room", {})
            studio_id = room_data.get("studio_id")
            
            if studio_id:
                studio_response = client.get_studio(studio_id)
                studio_data = studio_response.get("data", {}).get("studio", {})
                studio_info = {
                    "id": studio_id,
                    "name": studio_data.get("name", ""),
                    "code": studio_data.get("code", ""),
                    "address": studio_data.get("address", ""),
                    "tel": studio_data.get("tel", "")
                }
            
            # プログラム情報（予約に含まれている場合）
            program_id = reservation.get("program_id")
            if program_id:
                try:
                    program_response = client.get_program(program_id)
                    program_data = program_response.get("data", {}).get("program", {})
                    program_info = {
                        "id": program_id,
                        "name": program_data.get("name", ""),
                        "description": program_data.get("description", ""),
                        "duration": program_data.get("duration", 0),
                        "price": program_data.get("price", 0)
                    }
                except Exception as e:
                    logger.warning(f"Failed to get program info: {e}")
        except Exception as e:
            logger.warning(f"Failed to get room/studio info: {e}")
    
    # キャンセル可能かどうかを判定（ステータスが確定の場合のみ）
    is_cancelable = status == 2
    
    return jsonify({
        "reservation": {
            "id": reservation.get("id"),
            "member_id": member_id,
            "studio_lesson_id": studio_lesson_id,
            "studio_room_id": studio_room_id,
            "program_id": reservation.get("program_id"),
            "status": status,
            "status_label": status_label,
            "start_at": reservation.get("start_at"),
            "end_at": reservation.get("end_at"),
            "no": reservation.get("no"),
            "created_at": reservation.get("created_at"),
            "is_cancelable": is_cancelable
        },
        "member": member_info,
        "studio": studio_info,
        "program": program_info,
        "lesson": lesson_info
    })


@app.route("/api/reservations/choice", methods=["POST"])
@handle_errors
def create_choice_reservation():
    """自由枠予約を作成（ゲスト予約）"""
    client = get_hacomono_client()
    data = request.get_json()
    
    # 必須パラメータの検証
    required_fields = ["studio_room_id", "program_id", "start_at", "guest_name", "guest_email", "guest_phone"]
    for field in required_fields:
        if not data.get(field):
            return jsonify({"error": f"Missing required field: {field}"}), 400
    
    studio_room_id = data["studio_room_id"]
    program_id = data["program_id"]
    start_at = data["start_at"]  # yyyy-MM-dd HH:mm:ss.fff形式
    guest_name = data["guest_name"]
    guest_email = data["guest_email"]
    guest_phone = data["guest_phone"]
    guest_note = data.get("guest_note", "")
    
    # 0. 予約日時が有効範囲内かチェック
    try:
        # "yyyy-MM-dd HH:mm:ss.fff" 形式をパース
        reservation_datetime = datetime.strptime(start_at.split(".")[0], "%Y-%m-%d %H:%M:%S")
        is_valid, error_msg = validate_reservation_datetime(reservation_datetime)
        if not is_valid:
            return jsonify({
                "success": False,
                "error": error_msg,
                "error_code": "DATETIME_OUT_OF_RANGE"
            }), 400
    except ValueError as e:
        logger.warning(f"Failed to parse start_at: {start_at}, error: {e}")
        # パースに失敗しても続行（後のAPIで弾かれる）
    
    # 1. ゲストメンバーを作成
    name_parts = guest_name.split()
    if len(name_parts) >= 2:
        last_name = name_parts[0]
        first_name = " ".join(name_parts[1:])
    else:
        last_name = guest_name
        first_name = ""
    
    name_kana = data.get("guest_name_kana", "")
    kana_parts = name_kana.split() if name_kana else []
    if len(kana_parts) >= 2:
        last_name_kana = kana_parts[0]
        first_name_kana = " ".join(kana_parts[1:])
    else:
        last_name_kana = name_kana
        first_name_kana = ""
    
    # 1. まず既存のメンバーを検索
    member_id = None
    try:
        logger.info(f"Searching for existing member with email: {guest_email}")
        members_response = client.get_members({"mail_address": guest_email})
        members_data = members_response.get("data", {}).get("members", {})
        # APIレスポンスは {members: {list: [...], total_count: N, ...}} 形式
        if isinstance(members_data, dict):
            members_list = members_data.get("list", [])
            if members_list and len(members_list) > 0:
                member_id = members_list[0].get("id")
                logger.info(f"Found existing member ID: {member_id}")
            else:
                logger.info(f"No existing member found for email: {guest_email}")
        elif isinstance(members_data, list) and len(members_data) > 0:
            member_id = members_data[0].get("id")
            logger.info(f"Found existing member ID: {member_id}")
    except HacomonoAPIError as e:
        logger.warning(f"Failed to search members: {e}")
    except Exception as e:
        logger.warning(f"Error parsing members response: {e}")
    
    # 2. 既存メンバーがいなければ新規作成
    if not member_id:
        import secrets
        import string
        random_password = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(12)) + "!A1"
        
        member_data = {
            "last_name": last_name,
            "first_name": first_name or last_name,
            "last_name_kana": last_name_kana or None,
            "first_name_kana": first_name_kana or None,
            "mail_address": guest_email,
            "tel": guest_phone,
            "plain_password": random_password,
            "gender": data.get("gender", 2),  # デフォルト: 女性
            "birthday": data.get("birthday", "2000-01-01"),
            "studio_id": data.get("studio_id", 2),
            "note": f"Web予約ゲスト（自由枠）: {guest_note}"
        }
        
        try:
            logger.info(f"Creating member with data: {member_data}")
            member_response = client.create_member(member_data)
            member_id = member_response.get("data", {}).get("member", {}).get("id")
            logger.info(f"Created new member ID: {member_id}")
        except HacomonoAPIError as e:
            logger.error(f"Failed to create member: {e}")
            logger.error(f"Member creation API response body: {e.response_body}")
            error_info = _parse_hacomono_error(e)
            # メールアドレスが既に使用されている場合、再度検索を試みる
            if error_info["error_code"] == "CMN_000022":
                try:
                    members_response = client.get_members({"mail_address": guest_email})
                    members = members_response.get("data", {}).get("members", [])
                    if members:
                        member_id = members[0].get("id")
                        logger.info(f"Found existing member on retry ID: {member_id}")
                except HacomonoAPIError:
                    pass
            
            if not member_id:
                # Slack通知（エラー）
                send_slack_notification(
                    status="error",
                    guest_name=guest_name,
                    guest_email=guest_email,
                    guest_phone=guest_phone,
                    studio_name="",
                    error_message=error_info["user_message"],
                    error_code=error_info["error_code"]
                )
                
                return jsonify({
                    "error": "ゲスト情報の登録に失敗しました", 
                    "message": error_info["user_message"],
                    "error_code": error_info["error_code"]
                }), 400
    
    if not member_id:
        return jsonify({"error": "Failed to create guest member"}), 400
    
    # 2. プログラム情報を取得してチケットIDを確認
    program_response = client.get_program(program_id)
    program = program_response.get("data", {}).get("program", {})
    
    # プログラムに紐づくチケットIDを取得（ticket_ids, consumable_ticket_ids などを確認）
    program_ticket_ids = program.get("ticket_ids") or program.get("consumable_ticket_ids") or []
    
    # デバッグログ: プログラムのチケット関連フィールドを確認
    logger.info(f"Program {program_id} ticket-related fields: ticket_ids={program.get('ticket_ids')}, consumable_ticket_ids={program.get('consumable_ticket_ids')}")
    
    # チケットIDを決定（プログラムに紐づくチケットがあればそれを使用、なければデフォルト）
    DEFAULT_TICKET_ID = 5  # Web予約用デフォルトチケット
    if program_ticket_ids and len(program_ticket_ids) > 0:
        # プログラムに紐づくチケットがある場合は最初のものを使用
        ticket_id_to_grant = program_ticket_ids[0]
        logger.info(f"Using program-linked ticket ID: {ticket_id_to_grant}")
    else:
        # なければデフォルトのチケットIDを使用
        ticket_id_to_grant = DEFAULT_TICKET_ID
        logger.info(f"Using default ticket ID: {ticket_id_to_grant}")
    
    # 3. メンバーにチケットを付与
    try:
        ticket_response = client.grant_ticket_to_member(member_id, ticket_id=ticket_id_to_grant, num=1)
        logger.info(f"Granted ticket {ticket_id_to_grant}, member_ticket_id: {ticket_response.get('data', {}).get('member_ticket', {}).get('id')}")
    except HacomonoAPIError as e:
        logger.warning(f"Failed to grant ticket {ticket_id_to_grant}: {e}")
    
    # 4. 空いているスタッフを取得（指定されていない場合）
    instructor_ids = data.get("instructor_ids")
    if not instructor_ids:
        # 指定された日時の空いているスタッフを取得
        try:
            # start_atから日付を抽出（JSTタイムゾーンを付与）
            from zoneinfo import ZoneInfo
            jst = ZoneInfo("Asia/Tokyo")
            start_datetime = datetime.strptime(start_at, "%Y-%m-%d %H:%M:%S.%f").replace(tzinfo=jst)
            date_str = start_datetime.strftime("%Y-%m-%d")
            selectable_instructor_details = program.get("selectable_instructor_details", [])
            
            # 選択可能スタッフIDを取得（None = 全スタッフ選択可能）
            selectable_instructor_ids = None
            if selectable_instructor_details:
                first_detail = selectable_instructor_details[0]
                detail_type = first_detail.get("type")
                # ALL, RANDOM_ALL の場合は全スタッフ選択可能
                # SELECTED, FIXED, RANDOM_SELECTED の場合は指定されたスタッフのみ
                if detail_type in ["SELECTED", "FIXED", "RANDOM_SELECTED"]:
                    items = first_detail.get("items", [])
                    # items は { instructor_id, instructor_code, ... } の配列
                    selectable_instructor_ids = set(item.get("instructor_id") for item in items if item.get("instructor_id"))
                    logger.info(f"Program {program_id} has selectable instructors (type={detail_type}): {selectable_instructor_ids}")
            
            # choice/scheduleから空いているスタッフを取得
            schedule_response = client.get_choice_schedule(studio_room_id, date_str)
            schedule = schedule_response.get("data", {}).get("schedule", {})
            
            # スタジオIDを取得（スタッフのスタジオ紐付けチェック用）
            studio_room_service = schedule.get("studio_room_service", {})
            studio_id = studio_room_service.get("studio_id")
            
            # スタッフのスタジオ紐付け情報を取得
            instructor_studio_map = get_cached_instructor_studio_map(client)
            
            # 利用可能なスタッフを取得
            shift_instructors = schedule.get("shift_instructor", [])
            reserved_instructors = schedule.get("reservation_assign_instructor", [])
            
            # 予定ブロック（休憩ブロック）を取得してスタッフの予約情報に統合
            try:
                shift_slots_response = client.get_shift_slots({"studio_id": studio_id, "date": date_str})
                shift_slots_data = shift_slots_response.get("data", {}).get("shift_slots", {})
                shift_slots = shift_slots_data.get("list", []) if isinstance(shift_slots_data, dict) else shift_slots_data
                
                # 予定ブロックをスタッフと設備に分類
                resource_blocks = []
                for slot in shift_slots:
                    entity_type = slot.get("entity_type", "").upper()
                    if entity_type == "INSTRUCTOR":
                        reserved_instructors.append({
                            "entity_id": slot.get("entity_id"),
                            "start_at": slot.get("start_at"),
                            "end_at": slot.get("end_at"),
                            "reservation_type": "SHIFT_SLOT"
                        })
                    elif entity_type == "RESOURCE":
                        resource_blocks.append({
                            "entity_id": slot.get("entity_id"),
                            "start_at": slot.get("start_at"),
                            "end_at": slot.get("end_at"),
                            "reservation_type": "SHIFT_SLOT"
                        })
                logger.info(f"Fetched {len(shift_slots)} shift slots for reservation validation")
            except Exception as e:
                logger.warning(f"Failed to get shift slots for reservation validation: {e}")
            
            # プログラムの所要時間とインターバルを取得
            service_minutes = program.get("service_minutes", 30)
            before_interval = program.get("before_interval_minutes") or 0
            after_interval = program.get("after_interval_minutes") or 0
            
            # 予約したい時間帯
            proposed_end = start_datetime + timedelta(minutes=service_minutes)
            
            # 予約済みのスタッフIDを取得（インターバルを考慮）
            # 休憩ブロック（reservation_typeがBREAK、BLOCK、SHIFT_SLOTなど）も予約不可として扱う
            reserved_instructor_ids = set()
            for reserved in reserved_instructors:
                try:
                    reserved_start_str = reserved.get("start_at", "")
                    reserved_end_str = reserved.get("end_at", "")
                    if not reserved_start_str or not reserved_end_str:
                        continue
                    # ISO8601形式の日時をパース（タイムゾーン情報を処理してJSTに統一）
                    reserved_start = datetime.fromisoformat(reserved_start_str.replace("Z", "+00:00")).astimezone(jst)
                    reserved_end = datetime.fromisoformat(reserved_end_str.replace("Z", "+00:00")).astimezone(jst)
                    
                    # 休憩ブロック（SHIFT_SLOT含む）の場合はインターバルを考慮せず、そのままブロック
                    reservation_type = reserved.get("reservation_type", "").upper()
                    is_block = reservation_type in ["BREAK", "BLOCK", "REST", "SHIFT_SLOT", "休憩", "ブロック"]
                    
                    if is_block:
                        # 休憩ブロックの場合は、その時間帯をそのままブロック
                        block_start = reserved_start
                        block_end = reserved_end
                    else:
                        # 既存予約のブロック範囲（インターバル含む）
                        # before_interval: 予約開始前のブロック時間
                        # after_interval: 予約終了後のブロック時間
                        block_start = reserved_start - timedelta(minutes=before_interval)
                        block_end = reserved_end + timedelta(minutes=after_interval)
                    
                    # 予約したい時間帯がブロック範囲と重複するかチェック
                    if start_datetime < block_end and proposed_end > block_start:
                        reserved_instructor_ids.add(reserved.get("entity_id"))
                except Exception as e:
                    logger.warning(f"Failed to parse reserved instructor time: {e}")
                    continue
            
            # 空いているスタッフを抽出（スタジオ紐付け & プログラム選択可能スタッフもチェック）
            available_instructors = []
            for instructor in shift_instructors:
                instructor_id = instructor.get("instructor_id")
                try:
                    # プログラムの選択可能スタッフにいるかチェック
                    if selectable_instructor_ids is not None and instructor_id not in selectable_instructor_ids:
                        logger.debug(f"Instructor {instructor_id} not in program's selectable instructors, skipping")
                        continue
                    
                    # スタッフがスタジオに紐付けられているかチェック
                    # hacomonoのロジック: studio_idsが空 = 全店舗対応可能
                    instructor_studio_ids = instructor_studio_map.get(instructor_id, [])
                    if instructor_studio_ids and studio_id and studio_id not in instructor_studio_ids:
                        # 特定のスタジオに紐付けられているが、このスタジオではない
                        logger.debug(f"Instructor {instructor_id} not associated with studio {studio_id}, skipping")
                        continue
                    # 空配列の場合は制限なし（全店舗OK）なのでスキップしない
                    
                    instructor_start_str = instructor.get("start_at", "")
                    instructor_end_str = instructor.get("end_at", "")
                    if not instructor_start_str or not instructor_end_str:
                        continue
                    # JSTに統一して比較
                    instructor_start = datetime.fromisoformat(instructor_start_str.replace("Z", "+00:00")).astimezone(jst)
                    instructor_end = datetime.fromisoformat(instructor_end_str.replace("Z", "+00:00")).astimezone(jst)
                
                    # シフト時間内にコースが収まり、予約が入っていないスタッフ
                    if (instructor_start <= start_datetime and proposed_end <= instructor_end and 
                        instructor_id not in reserved_instructor_ids):
                        available_instructors.append(instructor_id)
                except Exception as e:
                    logger.warning(f"Failed to parse instructor time: {e}")
                    continue
            
            if available_instructors:
                instructor_ids = available_instructors[:1]  # 最初の1名を使用
                logger.info(f"Found available instructors: {available_instructors}, using: {instructor_ids}")
            else:
                # 空いているスタッフが見つからない場合はエラー
                logger.error(f"No available instructors found for studio_room_id={studio_room_id}, date={date_str}, time={start_at}")
                
                # Slack通知（エラー）
                send_slack_notification(
                    status="error",
                    guest_name=guest_name,
                    guest_email=guest_email,
                    guest_phone=guest_phone,
                    studio_name="",
                    error_message="この時間帯に対応可能なスタッフがいません。別の時間帯をお選びください。",
                    error_code="NO_AVAILABLE_INSTRUCTOR"
                )
                
                return jsonify({
                    "error": "予約の作成に失敗しました",
                    "message": "この時間帯に対応可能なスタッフがいません。別の時間帯をお選びください。",
                    "error_code": "NO_AVAILABLE_INSTRUCTOR"
                }), 400
            
            # 5. 設備の空き状況をチェック
            selectable_resource_details = program.get("selectable_resource_details", [])
            resource_id_to_use = None
            
            if selectable_resource_details:
                first_resource_detail = selectable_resource_details[0]
                resource_type = first_resource_detail.get("type")
                
                # 選択可能設備IDを取得（None = 全設備選択可能）
                selectable_resource_ids = None
                if resource_type in ["SELECTED", "FIXED", "RANDOM_SELECTED"]:
                    items = first_resource_detail.get("items", [])
                    selectable_resource_ids = set(item.get("resource_id") for item in items if item.get("resource_id"))
                    logger.info(f"Program {program_id} has selectable resources (type={resource_type}): {selectable_resource_ids}")
                
                # 設備の既存予約を取得（hacomono APIから）
                reserved_resources = list(schedule.get("reservation_assign_resource", []))
                reserved_resources.extend(resource_blocks)  # 設備の予定ブロックも追加
                
                # 予約済み設備IDを取得
                reserved_resource_ids = set()
                for reserved in reserved_resources:
                    try:
                        reserved_start_str = reserved.get("start_at", "")
                        reserved_end_str = reserved.get("end_at", "")
                        if not reserved_start_str or not reserved_end_str:
                            continue
                        reserved_start = datetime.fromisoformat(reserved_start_str.replace("Z", "+00:00")).astimezone(jst)
                        reserved_end = datetime.fromisoformat(reserved_end_str.replace("Z", "+00:00")).astimezone(jst)
                        
                        # 設備の予定ブロック（SHIFT_SLOT）の場合はインターバルを考慮せずブロック
                        reservation_type = reserved.get("reservation_type", "").upper()
                        is_block = reservation_type in ["BREAK", "BLOCK", "REST", "SHIFT_SLOT"]
                        
                        if is_block:
                            block_start = reserved_start
                            block_end = reserved_end
                        else:
                            # 設備予約のブロック範囲（インターバルなし：設備は時間ぴったりで使用）
                            block_start = reserved_start
                            block_end = reserved_end
                        
                        # 予約したい時間帯がブロック範囲と重複するかチェック
                        if start_datetime < block_end and proposed_end > block_start:
                            reserved_resource_ids.add(reserved.get("entity_id"))
                    except Exception as e:
                        logger.warning(f"Failed to parse reserved resource time: {e}")
                        continue
                
                # 空いている設備を抽出
                available_resources = []
                if selectable_resource_ids:
                    for resource_id in selectable_resource_ids:
                        if resource_id not in reserved_resource_ids:
                            available_resources.append(resource_id)
                else:
                    # ALL, RANDOM_ALL の場合は設備チェックなし
                    logger.info(f"Program {program_id} allows all resources, skipping resource availability check")
                
                if selectable_resource_ids:  # 設備が必要なプログラムの場合
                    if available_resources:
                        resource_id_to_use = available_resources[0]  # 最初の1つを使用
                        logger.info(f"Found available resources: {available_resources}, using: {resource_id_to_use}")
                    else:
                        # 空いている設備が見つからない場合はエラー
                        logger.error(f"No available resources found for studio_room_id={studio_room_id}, date={date_str}, time={start_at}")
                        
                        # Slack通知（エラー）
                        send_slack_notification(
                            status="error",
                            guest_name=guest_name,
                            guest_email=guest_email,
                            guest_phone=guest_phone,
                            studio_name="",
                            error_message="この時間帯に利用可能な設備がありません。別の時間帯をお選びください。",
                            error_code="NO_AVAILABLE_RESOURCE"
                        )
                        
                        return jsonify({
                            "error": "予約の作成に失敗しました",
                            "message": "この時間帯に利用可能な設備がありません。別の時間帯をお選びください。",
                            "error_code": "NO_AVAILABLE_RESOURCE"
                        }), 400
        except Exception as e:
            logger.warning(f"Failed to get available instructors: {e}")
            
            # Slack通知（エラー）
            send_slack_notification(
                status="error",
                guest_name=guest_name,
                guest_email=guest_email,
                guest_phone=guest_phone,
                studio_name="",
                error_message="スタッフ情報の取得に失敗しました。",
                error_code="INSTRUCTOR_FETCH_ERROR"
            )
            
            return jsonify({
                "error": "予約の作成に失敗しました",
                "message": "スタッフ情報の取得に失敗しました。",
                "error_code": "INSTRUCTOR_FETCH_ERROR"
            }), 400
    
    reservation_data = {
        "member_id": member_id,
        "studio_room_id": studio_room_id,
        "program_id": program_id,
        "ticket_id": 5,  # Web予約チケット
        "instructor_ids": instructor_ids,
        "start_at": start_at
    }
    
    # オプションパラメータ
    # 設備IDを設定（バックエンドで選んだ場合 or フロントエンドから指定された場合）
    if data.get("resource_id_set"):
        reservation_data["resource_id_set"] = data["resource_id_set"]
    elif 'resource_id_to_use' in dir() and resource_id_to_use:
        reservation_data["resource_id_set"] = [resource_id_to_use]
        logger.info(f"Setting resource_id_set from backend selection: {resource_id_to_use}")
    if data.get("reservation_note"):
        reservation_data["reservation_note"] = data["reservation_note"]
    if data.get("is_send_mail") is not None:
        reservation_data["is_send_mail"] = data["is_send_mail"]
    
    try:
        logger.info(f"Creating choice reservation with data: {reservation_data}")
        reservation_response = client.create_choice_reservation(reservation_data)
        reservation = reservation_response.get("data", {}).get("reservation", {})
        logger.info(f"Choice reservation created: {reservation.get('id')}")
    except HacomonoAPIError as e:
        logger.error(f"Failed to create choice reservation: {e}")
        logger.error(f"Choice reservation API response body: {e.response_body}")
        error_info = _parse_hacomono_error(e)
        
        # Slack通知（エラー）
        send_slack_notification(
            status="error",
            guest_name=guest_name,
            guest_email=guest_email,
            guest_phone=guest_phone,
            studio_name="",
            error_message=error_info["user_message"],
            error_code=error_info["error_code"]
        )
        
        return jsonify({
            "error": "予約の作成に失敗しました", 
            "message": error_info["user_message"],
            "error_code": error_info["error_code"],
            "detail": error_info.get("detail", str(e))
        }), 400
    
    # 4. 予約確認メールを送信（モック）
    reservation_id = reservation.get("id")
    try:
        # 日時のフォーマット
        start_at_str = reservation.get("start_at", "")
        end_at_str = reservation.get("end_at", "")
        reservation_date = ""
        reservation_time = ""
        duration_minutes = 0
        
        if start_at_str:
            try:
                start_dt = datetime.fromisoformat(start_at_str.replace("Z", "+00:00"))
                reservation_date = start_dt.strftime("%Y-%m-%d(%a)")
                reservation_time = start_dt.strftime("%H:%M")
                if end_at_str:
                    end_dt = datetime.fromisoformat(end_at_str.replace("Z", "+00:00"))
                    duration_minutes = int((end_dt - start_dt).total_seconds() / 60)
            except:
                pass
        
        # 店舗情報を取得
        studio_id = data.get("studio_id", 2)
        studio_name = ""
        studio_address = ""
        studio_tel = ""
        studio_data = {}
        try:
            studio_response = client.get_studio(studio_id)
            studio_data = studio_response.get("data", {}).get("studio", {})
            studio_name = studio_data.get("name", "")
            studio_address = studio_data.get("address", "")
            studio_tel = studio_data.get("tel", "")
        except:
            pass
        
        # 店舗連絡先情報を取得（パラメータ優先、なければhacomonoからフォールバック）
        contact_overrides = {
            "studio_zip": data.get("studio_zip"),
            "studio_address": data.get("studio_address"),
            "studio_tel": data.get("studio_tel"),
            "studio_url": data.get("studio_url"),
            "studio_email": data.get("studio_email"),
            "line_url": data.get("line_url")
        }
        studio_contact_info = get_studio_contact_info(studio_data, contact_overrides)
        
        # プログラム情報を取得
        program_name = ""
        price = 0
        try:
            program_response = client.get_program(program_id)
            program_data = program_response.get("data", {}).get("program", {})
            program_name = program_data.get("name", "")
            price = program_data.get("price", 0)
        except:
            pass
        
        # メール送信モック
        base_url = request.headers.get("Origin", "")
        line_url = studio_contact_info.get("line_url", "")
        send_reservation_email_mock(
            reservation_id=reservation_id,
            member_id=member_id,
            guest_name=guest_name,
            guest_email=guest_email,
            guest_phone=guest_phone,
            studio_name=studio_name,
            studio_address=studio_address,
            studio_tel=studio_tel,
            program_name=program_name,
            reservation_date=reservation_date,
            reservation_time=reservation_time,
            duration_minutes=duration_minutes,
            price=price,
            line_url=line_url,
            base_url=base_url,
            studio_contact_info=studio_contact_info
        )
    except Exception as e:
        logger.warning(f"Failed to send email mock: {e}")
    
    # 認証用ハッシュを生成（フロントエンドに返す）
    verify_hash_value = generate_verification_hash(guest_email, guest_phone)
    
    # 店舗連絡先情報からLINE URLを取得（レスポンスに含める）
    line_url = studio_contact_info.get("line_url", "") if 'studio_contact_info' in locals() else data.get("line_url", "")
    
    # Slack通知（成功）
    send_slack_notification(
        status="success",
        reservation_id=reservation_id,
        guest_name=guest_name,
        guest_email=guest_email,
        guest_phone=guest_phone,
        studio_name=studio_name,
        reservation_date=reservation_date,
        reservation_time=reservation_time,
        program_name=program_name
    )
    
    return jsonify({
        "success": True,
        "reservation": {
            "id": reservation_id,
            "member_id": member_id,
            "studio_room_id": studio_room_id,
            "program_id": program_id,
            "start_at": reservation.get("start_at"),
            "end_at": reservation.get("end_at"),
            "status": reservation.get("status"),
            "created_at": reservation.get("created_at")
        },
        "verify": verify_hash_value,
        "line_url": line_url,
        "message": "予約が完了しました"
    }), 201


@app.route("/api/reservations/<int:reservation_id>/cancel", methods=["POST"])
@handle_errors
def cancel_reservation(reservation_id: int):
    """予約をキャンセル
    
    セキュリティのため、member_id + verifyハッシュで認証
    hacomono APIでは member_id と reservation_ids の両方が必要
    """
    client = get_hacomono_client()
    
    data = request.get_json() or {}
    member_id = data.get("member_id")
    provided_verify = data.get("verify")
    
    if not member_id:
        return jsonify({
            "success": False,
            "error": "member_id is required",
            "message": "キャンセルにはメンバーIDが必要です"
        }), 400
    
    if not provided_verify:
        return jsonify({
            "success": False,
            "error": "verify is required",
            "message": "認証情報が不足しています"
        }), 400
    
    # メンバー情報を取得してハッシュを検証
    try:
        member_response = client.get_member(member_id)
        member_data = member_response.get("data", {}).get("member", {})
        member_email = member_data.get("mail_address", "")
        member_phone = member_data.get("tel", "")
        
        if not verify_hash(member_email, member_phone, provided_verify):
            logger.warning(f"Hash verification failed for reservation {reservation_id}, member {member_id}")
            return jsonify({
                "success": False,
                "error": "verification_failed",
                "message": "認証に失敗しました。正しいリンクからアクセスしてください。"
            }), 403
    except Exception as e:
        logger.error(f"Failed to verify member: {e}")
        return jsonify({
            "success": False,
            "error": "verification_error",
            "message": "認証処理中にエラーが発生しました"
        }), 500
    
    response = client.cancel_reservation(member_id, [reservation_id])
    
    return jsonify({
        "success": True,
        "message": "予約がキャンセルされました"
    })


# ==================== 自由枠予約 スケジュール API ====================

# 固定枠予約の前後ブロック時間（分）- 定数として設定
FIXED_SLOT_BEFORE_INTERVAL_MINUTES = 30
FIXED_SLOT_AFTER_INTERVAL_MINUTES = 30


@app.route("/api/choice-schedule", methods=["GET"])
@handle_errors
def get_choice_schedule():
    """自由枠予約スケジュールを取得（固定枠レッスン情報も含む）"""
    client = get_hacomono_client()
    
    studio_room_id = request.args.get("studio_room_id", type=int)
    studio_id = request.args.get("studio_id", type=int)
    date = request.args.get("date")  # YYYY-MM-DD
    
    if not studio_room_id:
        return jsonify({"error": "Missing required parameter: studio_room_id"}), 400
    
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")
    
    try:
        # 自由枠スケジュールを取得
        response = client.get_choice_schedule(studio_room_id, date)
        schedule = response.get("data", {}).get("schedule", {})
        
        # デバッグ: スケジュールレスポンスの構造を確認（休憩ブロック情報の有無を確認）
        logger.debug(f"Schedule response keys: {list(schedule.keys())}")
        if "reservation_assign_instructor" in schedule:
            logger.debug(f"reservation_assign_instructor count: {len(schedule.get('reservation_assign_instructor', []))}")
            # 最初の数件の予約情報をログ出力（reservation_typeを確認）
            for i, res in enumerate(schedule.get("reservation_assign_instructor", [])[:5]):
                logger.debug(f"Reservation {i}: entity_id={res.get('entity_id')}, reservation_type={res.get('reservation_type')}, start_at={res.get('start_at')}, end_at={res.get('end_at')}")
        
        # studio_idを取得（スケジュールレスポンスまたはパラメータから）
        actual_studio_id = studio_id
        if not actual_studio_id:
            studio_room = schedule.get("studio_room_service", {})
            actual_studio_id = studio_room.get("studio_id") if studio_room else None
        
        # 固定枠レッスン情報を取得
        fixed_slot_lessons = []
        fixed_slot_reservations = []
        
        if actual_studio_id:
            try:
                # 該当日の固定枠レッスンを取得
                lessons_response = client.get_studio_lessons(
                    query={"studio_id": actual_studio_id},
                    date_from=date,
                    date_to=date,
                    fetch_all=True
                )
                lessons = lessons_response.get("data", {}).get("studio_lessons", {}).get("list", [])
                
                for lesson in lessons:
                    fixed_slot_lessons.append({
                        "id": lesson.get("id"),
                        "start_at": lesson.get("start_at"),
                        "end_at": lesson.get("end_at"),
                        "instructor_id": lesson.get("instructor_id"),
                        "instructor_ids": lesson.get("instructor_ids", []),
                        "program_id": lesson.get("program_id"),
                        "studio_id": lesson.get("studio_id"),
                        "capacity": lesson.get("capacity", 0)
                    })
                    
                    # 固定枠レッスンの担当スタッフを予約として追加（前後のブロック時間を含む）
                    instructor_ids = lesson.get("instructor_ids", [])
                    if not instructor_ids and lesson.get("instructor_id"):
                        instructor_ids = [lesson.get("instructor_id")]
                    
                    for instructor_id in instructor_ids:
                        if instructor_id:
                            # 前後のインターバルを含めた時間をブロック
                            start_at_str = lesson.get("start_at")
                            end_at_str = lesson.get("end_at")
                            
                            if start_at_str and end_at_str:
                                try:
                                    start_at = datetime.fromisoformat(start_at_str.replace("Z", "+00:00"))
                                    end_at = datetime.fromisoformat(end_at_str.replace("Z", "+00:00"))
                                    
                                    # 前後のブロック時間を追加
                                    blocked_start = start_at - timedelta(minutes=FIXED_SLOT_BEFORE_INTERVAL_MINUTES)
                                    blocked_end = end_at + timedelta(minutes=FIXED_SLOT_AFTER_INTERVAL_MINUTES)
                                    
                                    fixed_slot_reservations.append({
                                        "entity_id": instructor_id,
                                        "entity_type": "INSTRUCTOR",
                                        "start_at": blocked_start.isoformat(),
                                        "end_at": blocked_end.isoformat(),
                                        "original_start_at": start_at_str,
                                        "original_end_at": end_at_str,
                                        "studio_lesson_id": lesson.get("id"),
                                        "reservation_type": "FIXED_SLOT_LESSON",
                                        "before_interval": FIXED_SLOT_BEFORE_INTERVAL_MINUTES,
                                        "after_interval": FIXED_SLOT_AFTER_INTERVAL_MINUTES
                                    })
                                except Exception as e:
                                    logger.warning(f"Failed to parse lesson time: {e}")
                
                logger.info(f"Found {len(fixed_slot_lessons)} fixed slot lessons and {len(fixed_slot_reservations)} instructor blocks for {date}")
            except Exception as e:
                logger.warning(f"Failed to get fixed slot lessons: {e}")
        
        # 予定ブロック（休憩ブロック）を取得
        shift_slots = []
        shift_slot_reservations = []
        if actual_studio_id:
            try:
                shift_slots_response = client.get_shift_slots({"studio_id": actual_studio_id, "date": date})
                shift_slots_data = shift_slots_response.get("data", {}).get("shift_slots", {})
                shift_slots = shift_slots_data.get("list", []) if isinstance(shift_slots_data, dict) else shift_slots_data
                
                # 予定ブロックをスタッフと設備に分類
                resource_shift_slot_reservations = []
                for slot in shift_slots:
                    entity_type = slot.get("entity_type", "").upper()
                    if entity_type == "INSTRUCTOR":
                        shift_slot_reservations.append({
                            "entity_id": slot.get("entity_id"),
                            "entity_type": "INSTRUCTOR",
                            "start_at": slot.get("start_at"),
                            "end_at": slot.get("end_at"),
                            "reservation_type": "SHIFT_SLOT",
                            "title": slot.get("title", ""),
                            "description": slot.get("description", "")
                        })
                    elif entity_type == "RESOURCE":
                        resource_shift_slot_reservations.append({
                            "entity_id": slot.get("entity_id"),
                            "entity_type": "RESOURCE",
                            "start_at": slot.get("start_at"),
                            "end_at": slot.get("end_at"),
                            "reservation_type": "SHIFT_SLOT",
                            "title": slot.get("title", ""),
                            "description": slot.get("description", "")
                        })
                
                logger.info(f"Found {len(shift_slots)} shift slots ({len(shift_slot_reservations)} instructor, {len(resource_shift_slot_reservations)} resource) for {date}")
            except Exception as e:
                logger.warning(f"Failed to get shift slots: {e}")
        
        # 自由枠の予約情報と固定枠のスタッフブロックと予定ブロックを統合
        all_instructor_reservations = list(schedule.get("reservation_assign_instructor", []))
        all_instructor_reservations.extend(fixed_slot_reservations)
        all_instructor_reservations.extend(shift_slot_reservations)
        
        # 設備の予約情報を統合（hacomono APIから取得 + 予定ブロック）
        all_resource_reservations = list(schedule.get("reservation_assign_resource", []))
        all_resource_reservations.extend(resource_shift_slot_reservations)
        
        # スタッフのスタジオ紐付け情報を取得（キャッシュ付き、リトライあり）
        instructor_studio_map = get_cached_instructor_studio_map(client)
        
        return jsonify({
            "schedule": {
                "date": date,
                "studio_id": actual_studio_id,  # スタジオIDも返す
                "studio_room_service": schedule.get("studio_room_service"),
                "shift": schedule.get("shift"),
                "shift_studio_business_hour": schedule.get("shift_studio_business_hour", []),
                "shift_instructor": schedule.get("shift_instructor", []),
                "reservation_assign_instructor": all_instructor_reservations,
                "reservation_assign_resource": all_resource_reservations,  # 設備の予約情報
                "fixed_slot_lessons": fixed_slot_lessons,
                "fixed_slot_interval": {
                    "before_minutes": FIXED_SLOT_BEFORE_INTERVAL_MINUTES,
                    "after_minutes": FIXED_SLOT_AFTER_INTERVAL_MINUTES
                },
                "instructor_studio_map": instructor_studio_map,  # スタッフのスタジオ紐付け
                "shift_slots": shift_slots  # 予定ブロック（休憩ブロック）
            }
        })
    except HacomonoAPIError as e:
        logger.error(f"Failed to get choice schedule: {e}")
        return jsonify({"error": "Failed to get schedule", "message": str(e)}), 400


@app.route("/api/choice-schedule-range", methods=["GET"])
@handle_errors
def get_choice_schedule_range():
    """自由枠予約スケジュールを日付範囲で一括取得（最適化版）
    
    7日分のスケジュールを1回のリクエストで取得。
    studio-lessonsは範囲全体で1回だけ取得し、instructor_studio_mapはキャッシュを使用。
    """
    client = get_hacomono_client()
    
    studio_room_id = request.args.get("studio_room_id", type=int)
    date_from = request.args.get("date_from")  # YYYY-MM-DD
    date_to = request.args.get("date_to")  # YYYY-MM-DD
    
    if not studio_room_id:
        return jsonify({"error": "Missing required parameter: studio_room_id"}), 400
    
    if not date_from:
        date_from = datetime.now().strftime("%Y-%m-%d")
    
    if not date_to:
        # date_fromから7日後をデフォルトに
        date_to = (datetime.strptime(date_from, "%Y-%m-%d") + timedelta(days=6)).strftime("%Y-%m-%d")
    
    try:
        # 日付リストを生成
        start_date = datetime.strptime(date_from, "%Y-%m-%d")
        end_date = datetime.strptime(date_to, "%Y-%m-%d")
        dates = []
        current = start_date
        while current <= end_date:
            dates.append(current.strftime("%Y-%m-%d"))
            current += timedelta(days=1)
        
        # 1. スタッフのスタジオ紐付け情報を取得（キャッシュ使用）
        instructor_studio_map = get_cached_instructor_studio_map(client)
        
        # 2. 各日付のchoice/scheduleを取得
        schedules = {}
        actual_studio_id = None
        
        for date in dates:
            try:
                response = client.get_choice_schedule(studio_room_id, date)
                schedule = response.get("data", {}).get("schedule", {})
                
                # studio_idを取得（最初の有効なレスポンスから）
                if not actual_studio_id:
                    studio_room = schedule.get("studio_room_service", {})
                    actual_studio_id = studio_room.get("studio_id") if studio_room else None
                
                schedules[date] = {
                    "studio_room_service": schedule.get("studio_room_service"),
                    "shift": schedule.get("shift"),
                    "shift_studio_business_hour": schedule.get("shift_studio_business_hour", []),
                    "shift_instructor": schedule.get("shift_instructor", []),
                    "reservation_assign_instructor": list(schedule.get("reservation_assign_instructor", []))
                }
            except Exception as e:
                logger.warning(f"Failed to get schedule for {date}: {e}")
                schedules[date] = None
        
        # 3. 固定枠レッスンを範囲全体で1回だけ取得
        fixed_slot_lessons_by_date = {date: [] for date in dates}
        fixed_slot_reservations_by_date = {date: [] for date in dates}
        
        if actual_studio_id:
            try:
                lessons_response = client.get_studio_lessons(
                    query={"studio_id": actual_studio_id},
                    date_from=date_from,
                    date_to=date_to,
                    fetch_all=True
                )
                lessons = lessons_response.get("data", {}).get("studio_lessons", {}).get("list", [])
                logger.info(f"Fetched {len(lessons)} fixed slot lessons for range {date_from} to {date_to}")
                
                for lesson in lessons:
                    start_at_str = lesson.get("start_at")
                    if not start_at_str:
                        continue
                    
                    # レッスンの日付を取得
                    lesson_date = start_at_str[:10]  # YYYY-MM-DD
                    if lesson_date not in fixed_slot_lessons_by_date:
                        continue
                    
                    fixed_slot_lessons_by_date[lesson_date].append({
                        "id": lesson.get("id"),
                        "start_at": lesson.get("start_at"),
                        "end_at": lesson.get("end_at"),
                        "instructor_id": lesson.get("instructor_id"),
                        "instructor_ids": lesson.get("instructor_ids", []),
                        "program_id": lesson.get("program_id"),
                        "studio_id": lesson.get("studio_id"),
                        "capacity": lesson.get("capacity", 0)
                    })
                    
                    # 固定枠レッスンの担当スタッフを予約として追加
                    instructor_ids = lesson.get("instructor_ids", [])
                    if not instructor_ids and lesson.get("instructor_id"):
                        instructor_ids = [lesson.get("instructor_id")]
                    
                    end_at_str = lesson.get("end_at")
                    if not end_at_str:
                        continue
                    
                    for instructor_id in instructor_ids:
                        if instructor_id:
                            try:
                                start_at = datetime.fromisoformat(start_at_str.replace("Z", "+00:00"))
                                end_at = datetime.fromisoformat(end_at_str.replace("Z", "+00:00"))
                                
                                blocked_start = start_at - timedelta(minutes=FIXED_SLOT_BEFORE_INTERVAL_MINUTES)
                                blocked_end = end_at + timedelta(minutes=FIXED_SLOT_AFTER_INTERVAL_MINUTES)
                                
                                fixed_slot_reservations_by_date[lesson_date].append({
                                    "entity_id": instructor_id,
                                    "entity_type": "INSTRUCTOR",
                                    "start_at": blocked_start.isoformat(),
                                    "end_at": blocked_end.isoformat(),
                                    "type": "FIXED_SLOT_LESSON"
                                })
                            except Exception as e:
                                logger.warning(f"Failed to parse lesson time: {e}")
            except Exception as e:
                logger.warning(f"Failed to get fixed slot lessons for range: {e}")
        
        # 4. 予定ブロック（休憩ブロック）を各日付ごとに取得
        shift_slots_by_date = {date: [] for date in dates}
        shift_slot_reservations_by_date = {date: [] for date in dates}
        resource_shift_slot_reservations_by_date = {date: [] for date in dates}
        
        if actual_studio_id:
            for date in dates:
                try:
                    shift_slots_response = client.get_shift_slots({"studio_id": actual_studio_id, "date": date})
                    shift_slots_data = shift_slots_response.get("data", {}).get("shift_slots", {})
                    shift_slots = shift_slots_data.get("list", []) if isinstance(shift_slots_data, dict) else shift_slots_data
                    shift_slots_by_date[date] = shift_slots
                    
                    # 予定ブロックをスタッフと設備に分類
                    for slot in shift_slots:
                        entity_type = slot.get("entity_type", "").upper()
                        if entity_type == "INSTRUCTOR":
                            shift_slot_reservations_by_date[date].append({
                                "entity_id": slot.get("entity_id"),
                                "entity_type": "INSTRUCTOR",
                                "start_at": slot.get("start_at"),
                                "end_at": slot.get("end_at"),
                                "reservation_type": "SHIFT_SLOT",
                                "title": slot.get("title", ""),
                                "description": slot.get("description", "")
                            })
                        elif entity_type == "RESOURCE":
                            resource_shift_slot_reservations_by_date[date].append({
                                "entity_id": slot.get("entity_id"),
                                "entity_type": "RESOURCE",
                                "start_at": slot.get("start_at"),
                                "end_at": slot.get("end_at"),
                                "reservation_type": "SHIFT_SLOT",
                                "title": slot.get("title", ""),
                                "description": slot.get("description", "")
                            })
                except Exception as e:
                    logger.warning(f"Failed to get shift slots for {date}: {e}")
        
        # 5. 結果を統合
        result_schedules = {}
        for date in dates:
            schedule = schedules.get(date)
            if schedule:
                # スタッフの予約情報に固定枠と予定ブロックを統合
                all_instructor_reservations = list(schedule.get("reservation_assign_instructor", []))
                all_instructor_reservations.extend(fixed_slot_reservations_by_date.get(date, []))
                all_instructor_reservations.extend(shift_slot_reservations_by_date.get(date, []))
                
                # 設備の予約情報に予定ブロックを統合
                all_resource_reservations = list(schedule.get("reservation_assign_resource", []))
                all_resource_reservations.extend(resource_shift_slot_reservations_by_date.get(date, []))
                
                result_schedules[date] = {
                    "date": date,
                    "studio_id": actual_studio_id,
                    "studio_room_service": schedule.get("studio_room_service"),
                    "shift": schedule.get("shift"),
                    "shift_studio_business_hour": schedule.get("shift_studio_business_hour", []),
                    "shift_instructor": schedule.get("shift_instructor", []),
                    "reservation_assign_instructor": all_instructor_reservations,
                    "reservation_assign_resource": all_resource_reservations,  # 設備の予約情報
                    "fixed_slot_lessons": fixed_slot_lessons_by_date.get(date, []),
                    "fixed_slot_interval": {
                        "before_minutes": FIXED_SLOT_BEFORE_INTERVAL_MINUTES,
                        "after_minutes": FIXED_SLOT_AFTER_INTERVAL_MINUTES
                    },
                    "instructor_studio_map": instructor_studio_map,
                    "shift_slots": shift_slots_by_date.get(date, [])
                }
            else:
                result_schedules[date] = None
        
        return jsonify({
            "schedules": result_schedules,
            "date_from": date_from,
            "date_to": date_to
        })
    except Exception as e:
        logger.error(f"Failed to get choice schedule range: {e}")
        return jsonify({"error": "Failed to get schedule range", "message": str(e)}), 500


@app.route("/api/choice-reserve-context", methods=["POST"])
@handle_errors
def get_choice_reserve_context():
    """自由枠予約コンテキストを取得（予約可否を事前確認）"""
    client = get_hacomono_client()
    
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing request body"}), 400
    
    member_id = data.get("member_id")
    studio_room_id = data.get("studio_room_id")
    program_id = data.get("program_id")
    start_at = data.get("start_at")
    instructor_ids = data.get("instructor_ids")
    
    if not all([studio_room_id, program_id, start_at]):
        return jsonify({"error": "Missing required parameters: studio_room_id, program_id, start_at"}), 400
    
    # member_idがない場合は仮のIDを使用（コンテキスト確認のみ）
    if not member_id:
        member_id = 1  # 仮のメンバーID
    
    context_data = {
        "member_id": member_id,
        "studio_room_id": studio_room_id,
        "program_id": program_id,
        "start_at": start_at
    }
    
    # instructor_idsが指定されている場合は追加
    if instructor_ids:
        context_data["instructor_ids"] = instructor_ids
    
    logger.info(f"Calling choice reserve context with: {context_data}")
    
    try:
        response = client.get_choice_reserve_context(context_data)
        logger.info(f"Choice reserve context response: {response}")
        
        context = response.get("data", {}).get("choice_reserve_context", {})
        
        # positionで予約可否を判定
        # DENY: 予約不可, TICKET: チケットで予約可能, PLAN: プランで予約可能
        position = context.get("position")
        
        # instructorsがNoneまたは空の場合は予約不可（スタッフが見つからない）
        instructors = context.get("instructors")
        has_available_instructor = instructors is not None and len(instructors) > 0 if isinstance(instructors, list) else instructors is not None
        
        # チケットで予約できる場合は予約可能とみなす（ゲスト予約時にチケットを付与するため）
        # DENYの場合でも、エラーがチケット関連のみであれば予約可能とする
        errors = context.get("errors", [])
        
        # チケット関連以外のエラーをフィルタリング
        non_ticket_errors = [e for e in errors if e.get("code") != "RSV_000005"]
        
        # 予約可否の判定
        # - instructorsがない場合は予約不可（スタッフがいない）
        # - position が TICKET または PLAN なら予約可能
        # - position が DENY でも、チケット関連以外のエラーがなければ予約可能（チケットは後で付与するため）
        if not has_available_instructor:
            is_reservable = False
            error_message = "この時間帯に対応可能なスタッフがいません。"
        elif len(non_ticket_errors) > 0:
            is_reservable = False
            error_message = non_ticket_errors[0].get("message")
        else:
            is_reservable = position in ["TICKET", "PLAN"] or (position == "DENY" and len(non_ticket_errors) == 0)
            error_message = None
        
        logger.info(f"Reservability check: position={position}, instructors={instructors}, is_reservable={is_reservable}, errors={errors}")
        
        # 予約可否の判定情報を返す
        return jsonify({
            "is_reservable": is_reservable,
            "reservable_num": context.get("reservable_num", 0),
            "max_reservable_num": context.get("max_reservable_num", 0),
            "error_message": error_message,
            "position": position,
        })
    except HacomonoAPIError as e:
        logger.error(f"Failed to get choice reserve context: {e}")
        logger.error(f"Response body: {e.response_body}")
        error_info = _parse_hacomono_error(e)
        return jsonify({
            "is_reservable": False,
            "error": error_info["user_message"],
            "error_code": error_info["error_code"]
        }), 400


@app.route("/api/studio-rooms", methods=["GET"])
@handle_errors
def get_studio_rooms():
    """スタジオルーム一覧を取得"""
    client = get_hacomono_client()
    
    studio_id = request.args.get("studio_id", type=int)
    
    query = {"is_active": True}
    if studio_id:
        query["studio_id"] = studio_id
    
    try:
        response = client.get_studio_rooms(query)
        rooms = response.get("data", {}).get("studio_rooms", {}).get("list", [])
        
        result = []
        for room in rooms:
            result.append({
                "id": room.get("id"),
                "name": room.get("name"),
                "code": room.get("code"),
                "studio_id": room.get("studio_id"),
                "reservation_type": room.get("reservation_type")  # 1=固定枠, 2=自由枠
            })
        
        return jsonify({"studio_rooms": result})
    except HacomonoAPIError as e:
        logger.error(f"Failed to get studio rooms: {e}")
        return jsonify({"error": "Failed to get studio rooms", "message": str(e)}), 400


# ==================== エラーハンドラー ====================

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500


# ==================== メイン ====================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV") == "development"
    
    logger.info(f"Starting Happle Reservation API on port {port}")
    app.run(host="0.0.0.0", port=port, debug=debug)

