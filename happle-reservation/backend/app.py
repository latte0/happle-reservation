"""
Happle Reservation Backend API

hacomono APIを使用した予約システムのバックエンドAPI
"""

import os
import json
import logging
from datetime import datetime, timedelta
from functools import wraps

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, request, jsonify
from flask_cors import CORS

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

# CORS設定
CORS(app, origins=os.environ.get("CORS_ORIGINS", "*").split(","))

# hacomono クライアント（遅延初期化）
_hacomono_client = None


def get_hacomono_client() -> HacomonoClient:
    """hacomonoクライアントを取得（シングルトン）"""
    global _hacomono_client
    if _hacomono_client is None:
        _hacomono_client = HacomonoClient.from_env()
    return _hacomono_client


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
            "thumbnail": program.get("thumbnail_code")
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


# ==================== スケジュール API ====================

@app.route("/api/schedule", methods=["GET"])
@handle_errors
def get_schedule():
    """レッスンスケジュールを取得"""
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
    
    # hacomono APIはクエリなしで呼び出す（クエリパラメータがエラーを引き起こす）
    response = client.get_studio_lessons(None)
    
    lessons = response.get("data", {}).get("studio_lessons", {}).get("list", [])
    
    # 必要な情報のみ抽出（日付フィルタは一時的に無効化 - テスト用）
    result = []
    for lesson in lessons:
        # studio_idフィルタ
        if studio_id and lesson.get("studio_id") != studio_id:
            continue
        
        # program_idフィルタ
        if program_id and lesson.get("program_id") != program_id:
            continue
        
        capacity = lesson.get("capacity") or lesson.get("max_num") or 1
        reserved = lesson.get("reserved_count") or lesson.get("reserved_num") or 0
        
        result.append({
            "id": lesson.get("id"),
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
    
    return jsonify({"schedule": result})


# ==================== 予約 API ====================

@app.route("/api/reservations", methods=["POST"])
@handle_errors
def create_reservation():
    """予約を作成（ゲスト予約）"""
    client = get_hacomono_client()
    data = request.get_json()
    
    # 必須パラメータの検証
    required_fields = ["studio_lesson_id", "guest_name", "guest_email", "guest_phone"]
    for field in required_fields:
        if not data.get(field):
            return jsonify({"error": f"Missing required field: {field}"}), 400
    
    studio_lesson_id = data["studio_lesson_id"]
    guest_name = data["guest_name"]
    guest_email = data["guest_email"]
    guest_phone = data["guest_phone"]
    guest_note = data.get("guest_note", "")
    
    # 1. ゲストメンバーを作成（または既存を検索）
    # 注: 実際の運用ではメールアドレスで既存メンバーを検索するロジックが必要
    member_data = {
        "name": guest_name,
        "name_kana": data.get("guest_name_kana", ""),
        "mail_address": guest_email,
        "tel": guest_phone,
        "is_guest": True,
        "studio_id": data.get("studio_id", 1),  # デフォルト店舗
        "note": f"Web予約ゲスト: {guest_note}"
    }
    
    try:
        member_response = client.create_member(member_data)
        member_id = member_response.get("data", {}).get("member", {}).get("id")
    except HacomonoAPIError as e:
        # メンバー作成に失敗した場合
        logger.error(f"Failed to create member: {e}")
        return jsonify({"error": "Failed to create guest member", "message": str(e)}), 400
    
    if not member_id:
        return jsonify({"error": "Failed to create guest member"}), 400
    
    # 2. 予約を作成
    reservation_data = {
        "member_id": member_id,
        "studio_lesson_id": studio_lesson_id,
        "note": guest_note
    }
    
    try:
        reservation_response = client.create_reservation(reservation_data)
        reservation = reservation_response.get("data", {}).get("reservation", {})
    except HacomonoAPIError as e:
        logger.error(f"Failed to create reservation: {e}")
        return jsonify({"error": "Failed to create reservation", "message": str(e)}), 400
    
    return jsonify({
        "success": True,
        "reservation": {
            "id": reservation.get("id"),
            "member_id": member_id,
            "studio_lesson_id": studio_lesson_id,
            "status": reservation.get("status"),
            "created_at": reservation.get("created_at")
        },
        "message": "予約が完了しました"
    }), 201


@app.route("/api/reservations/<int:reservation_id>", methods=["GET"])
@handle_errors
def get_reservation(reservation_id: int):
    """予約詳細を取得"""
    client = get_hacomono_client()
    response = client.get_reservation(reservation_id)
    
    reservation = response.get("data", {}).get("reservation", {})
    
    return jsonify({
        "reservation": {
            "id": reservation.get("id"),
            "member_id": reservation.get("member_id"),
            "studio_lesson_id": reservation.get("studio_lesson_id"),
            "status": reservation.get("status"),
            "start_at": reservation.get("start_at"),
            "end_at": reservation.get("end_at"),
            "created_at": reservation.get("created_at")
        }
    })


@app.route("/api/reservations/<int:reservation_id>/cancel", methods=["POST"])
@handle_errors
def cancel_reservation(reservation_id: int):
    """予約をキャンセル"""
    client = get_hacomono_client()
    
    response = client.cancel_reservation([reservation_id])
    
    return jsonify({
        "success": True,
        "message": "予約がキャンセルされました"
    })


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

