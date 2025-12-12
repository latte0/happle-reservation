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
app.json.ensure_ascii = False  # 日本語をUnicodeエスケープしない

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
    error_str = str(error)
    
    # よくあるエラーコードと日本語メッセージの対応
    error_messages = {
        "RSV_000309": "この時間帯は予約できません。営業時間外または予約可能期間外です。",
        "RSV_000308": "スタッフが設定されていないか、選択したスタッフが無効です。",
        "RSV_000008": "この席は既に予約されています。別の時間帯を選択してください。",
        "RSV_000005": "予約に必要なチケットがありません。",
        "RSV_000001": "この枠は既に予約で埋まっています。",
        "CMN_000051": "必要な情報が不足しています。",
        "CMN_000022": "このメールアドレスは既に使用されています。",
        "CMN_000001": "システムエラーが発生しました。スペースの席設定（no）が正しくない可能性があります。",
    }
    
    for code, message in error_messages.items():
        if code in error_str:
            return {"error_code": code, "user_message": message, "detail": error_str}
    
    return {"error_code": "UNKNOWN", "user_message": "予約処理中にエラーが発生しました。", "detail": error_str}


def _create_guest_member(client, guest_name: str, guest_email: str, guest_phone: str, 
                         guest_name_kana: str = "", guest_note: str = "",
                         gender: int = 1, birthday: str = "2000-01-01", studio_id: int = 2):
    """ゲストメンバーを作成（または既存メンバーを使用）し、チケットを付与"""
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
    
    # 2. チケットを付与（Web予約用チケット ID:5）
    try:
        ticket_response = client.grant_ticket_to_member(member_id, ticket_id=5, num=1)
        member_ticket_id = ticket_response.get("data", {}).get("member_ticket", {}).get("id")
        logger.info(f"Granted ticket, member_ticket_id: {member_ticket_id}")
    except HacomonoAPIError as e:
        # チケット付与に失敗した場合も続行（既存チケットがあるかも）
        logger.warning(f"Failed to grant ticket: {e}")
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
    
    # 1. ゲストメンバーを作成してチケットを付与
    try:
        member_id, member_ticket_id = _create_guest_member(
            client=client,
            guest_name=data["guest_name"],
            guest_email=data["guest_email"],
            guest_phone=data["guest_phone"],
            guest_name_kana=data.get("guest_name_kana", ""),
            guest_note=data.get("guest_note", ""),
            gender=data.get("gender", 1),
            birthday=data.get("birthday", "2000-01-01"),
            studio_id=data.get("studio_id", 2)
        )
    except HacomonoAPIError as e:
        error_info = _parse_hacomono_error(e)
        logger.error(f"Failed to create member: {e}")
        logger.error(f"Member creation API response body: {e.response_body}")
        return jsonify({
            "success": False,
            "error": "ゲスト情報の登録に失敗しました",
            "error_code": error_info["error_code"],
            "message": error_info["user_message"],
            "detail": error_info["detail"]
        }), 400
    except ValueError as e:
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
        return jsonify({
            "success": False,
            "error": "予約の作成に失敗しました",
            "error_code": error_info["error_code"],
            "message": error_info["user_message"],
            "detail": error_info["detail"]
        }), 400
    
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
        "gender": data.get("gender", 1),  # フロントエンドから取得、デフォルト1
        "birthday": data.get("birthday", "2000-01-01"),  # フロントエンドから取得、デフォルト2000-01-01
        "studio_id": data.get("studio_id", 2),
        "note": f"Web予約ゲスト（自由枠）: {guest_note}"
    }
    
    try:
        member_response = client.create_member(member_data)
        member_id = member_response.get("data", {}).get("member", {}).get("id")
    except HacomonoAPIError as e:
        logger.error(f"Failed to create member: {e}")
        return jsonify({"error": "Failed to create guest member", "message": str(e)}), 400
    
    if not member_id:
        return jsonify({"error": "Failed to create guest member"}), 400
    
    logger.info(f"Created member ID: {member_id}")
    
    # 2. メンバーにチケットを付与（Web予約用チケット ID:5）
    try:
        ticket_response = client.grant_ticket_to_member(member_id, ticket_id=5, num=1)
        logger.info(f"Granted ticket, member_ticket_id: {ticket_response.get('data', {}).get('member_ticket', {}).get('id')}")
    except HacomonoAPIError as e:
        logger.warning(f"Failed to grant ticket: {e}")
    
    # 3. 空いているスタッフを取得（指定されていない場合）
    instructor_ids = data.get("instructor_ids")
    if not instructor_ids:
        # 指定された日時の空いているスタッフを取得
        try:
            # start_atから日付を抽出
            start_datetime = datetime.strptime(start_at, "%Y-%m-%d %H:%M:%S.%f")
            date_str = start_datetime.strftime("%Y-%m-%d")
            
            # choice/scheduleから空いているスタッフを取得
            schedule_response = client.get_choice_schedule(studio_room_id, date_str)
            schedule = schedule_response.get("data", {}).get("schedule", {})
            
            # 利用可能なスタッフを取得
            shift_instructors = schedule.get("shift_instructor", [])
            reserved_instructors = schedule.get("reservation_assign_instructor", [])
            
            # 予約済みのスタッフIDを取得
            reserved_instructor_ids = set()
            for reserved in reserved_instructors:
                try:
                    reserved_start_str = reserved.get("start_at", "")
                    reserved_end_str = reserved.get("end_at", "")
                    if not reserved_start_str or not reserved_end_str:
                        continue
                    # ISO8601形式の日時をパース（タイムゾーン情報を処理）
                    reserved_start = datetime.fromisoformat(reserved_start_str.replace("Z", "+00:00"))
                    reserved_end = datetime.fromisoformat(reserved_end_str.replace("Z", "+00:00"))
                    # 時間が重なっているかチェック
                    if start_datetime < reserved_end and start_datetime + timedelta(minutes=30) > reserved_start:
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
                        available_instructors.append(instructor_id)
                except Exception as e:
                    logger.warning(f"Failed to parse instructor time: {e}")
                    continue
            
            if available_instructors:
                instructor_ids = available_instructors[:1]  # 最初の1名を使用
                logger.info(f"Found available instructors: {available_instructors}, using: {instructor_ids}")
            else:
                # 空いているスタッフが見つからない場合は、シフトがある最初のスタッフを使用
                if shift_instructors:
                    instructor_ids = [shift_instructors[0].get("instructor_id")]
                    logger.warning(f"No available instructors found, using first shift instructor: {instructor_ids}")
                else:
                    instructor_ids = [1]  # フォールバック
                    logger.warning(f"No shift instructors found, using default: {instructor_ids}")
        except Exception as e:
            logger.warning(f"Failed to get available instructors: {e}, using default")
            instructor_ids = [1]  # エラー時はデフォルト
    
    reservation_data = {
        "member_id": member_id,
        "studio_room_id": studio_room_id,
        "program_id": program_id,
        "ticket_id": 5,  # Web予約チケット
        "instructor_ids": instructor_ids,
        "start_at": start_at
    }
    
    # オプションパラメータ
    if data.get("resource_id_set"):
        reservation_data["resource_id_set"] = data["resource_id_set"]
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
        return jsonify({"error": "Failed to create reservation", "message": str(e)}), 400
    
    return jsonify({
        "success": True,
        "reservation": {
            "id": reservation.get("id"),
            "member_id": member_id,
            "studio_room_id": studio_room_id,
            "program_id": program_id,
            "start_at": reservation.get("start_at"),
            "end_at": reservation.get("end_at"),
            "status": reservation.get("status"),
            "created_at": reservation.get("created_at")
        },
        "message": "予約が完了しました"
    }), 201


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


# ==================== 自由枠予約 スケジュール API ====================

@app.route("/api/choice-schedule", methods=["GET"])
@handle_errors
def get_choice_schedule():
    """自由枠予約スケジュールを取得"""
    client = get_hacomono_client()
    
    studio_room_id = request.args.get("studio_room_id", type=int)
    date = request.args.get("date")  # YYYY-MM-DD
    
    if not studio_room_id:
        return jsonify({"error": "Missing required parameter: studio_room_id"}), 400
    
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")
    
    try:
        response = client.get_choice_schedule(studio_room_id, date)
        schedule = response.get("data", {}).get("schedule", {})
        
        return jsonify({
            "schedule": {
                "date": date,
                "studio_room_service": schedule.get("studio_room_service"),
                "shift": schedule.get("shift"),
                "shift_studio_business_hour": schedule.get("shift_studio_business_hour", []),
                "shift_instructor": schedule.get("shift_instructor", []),
                "reservation_assign_instructor": schedule.get("reservation_assign_instructor", [])
            }
        })
    except HacomonoAPIError as e:
        logger.error(f"Failed to get choice schedule: {e}")
        return jsonify({"error": "Failed to get schedule", "message": str(e)}), 400


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

