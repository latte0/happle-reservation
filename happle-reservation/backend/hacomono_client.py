"""
hacomono API Client

hacomono Admin APIとの通信を行うクライアントクラス
"""

import os
import time
import json
import logging
import requests
from typing import Optional, Dict, Any, List
from functools import wraps

logger = logging.getLogger(__name__)


class HacomonoClient:
    """hacomono Admin API クライアント"""
    
    def __init__(
        self,
        brand_code: str,
        access_token: str,
        refresh_token: Optional[str] = None,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        admin_domain: Optional[str] = None
    ):
        self.brand_code = brand_code
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.client_id = client_id
        self.client_secret = client_secret
        self.admin_domain = admin_domain or f"{brand_code}-admin.hacomono.jp"
        
        self.base_url = f"https://{brand_code}.admin.egw.hacomono.app/api/v2"
        self.token_url = f"https://{self.admin_domain}/api/oauth/token"
        
        # Rate limiting
        self._last_request_time: Dict[str, float] = {}
        self._rate_limits = {
            "GET": 10,  # 10 requests per second
            "POST": 2,
            "PUT": 2,
            "DELETE": 2
        }
    
    @classmethod
    def from_env(cls) -> "HacomonoClient":
        """環境変数からクライアントを作成"""
        return cls(
            brand_code=os.environ.get("HACOMONO_BRAND_CODE", "happle"),
            access_token=os.environ["HACOMONO_ACCESS_TOKEN"],
            refresh_token=os.environ.get("HACOMONO_REFRESH_TOKEN"),
            client_id=os.environ.get("HACOMONO_CLIENT_ID"),
            client_secret=os.environ.get("HACOMONO_CLIENT_SECRET"),
            admin_domain=os.environ.get("HACOMONO_ADMIN_DOMAIN")
        )
    
    def _get_headers(self) -> Dict[str, str]:
        """リクエストヘッダーを取得"""
        return {
            "Authorization": f"Bearer {self.access_token}",
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/json"
        }
    
    def _rate_limit(self, method: str):
        """Rate limiting を適用"""
        now = time.time()
        key = method.upper()
        limit = self._rate_limits.get(key, 10)
        min_interval = 1.0 / limit
        
        last_time = self._last_request_time.get(key, 0)
        elapsed = now - last_time
        
        if elapsed < min_interval:
            sleep_time = min_interval - elapsed
            time.sleep(sleep_time)
        
        self._last_request_time[key] = time.time()
    
    def _handle_response(self, response: requests.Response) -> Dict[str, Any]:
        """レスポンスを処理"""
        if response.status_code == 401:
            # Token expired, try to refresh
            if self.refresh_token and self.client_id and self.client_secret:
                self._refresh_access_token()
                raise TokenRefreshedError("Token was refreshed, please retry")
            raise AuthenticationError("Access token is invalid or expired")
        
        if response.status_code == 429:
            retry_after = int(response.headers.get("retry-after", 1))
            raise RateLimitError(f"Rate limit exceeded, retry after {retry_after}s", retry_after)
        
        if not response.ok:
            raise HacomonoAPIError(
                f"API error: {response.status_code}",
                status_code=response.status_code,
                response_body=response.text
            )
        
        return response.json()
    
    def _refresh_access_token(self):
        """アクセストークンを更新"""
        if not all([self.refresh_token, self.client_id, self.client_secret]):
            raise AuthenticationError("Cannot refresh token: missing credentials")
        
        data = {
            "grant_type": "refresh_token",
            "refresh_token": self.refresh_token,
            "client_id": self.client_id,
            "client_secret": self.client_secret
        }
        
        response = requests.post(
            self.token_url,
            json=data,
            headers={"Content-Type": "application/json"}
        )
        
        if not response.ok:
            raise AuthenticationError(f"Failed to refresh token: {response.text}")
        
        token_data = response.json()
        self.access_token = token_data["access_token"]
        if "refresh_token" in token_data:
            self.refresh_token = token_data["refresh_token"]
        
        logger.info("Access token refreshed successfully")
    
    def _request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict] = None,
        data: Optional[Dict] = None,
        retry_count: int = 1
    ) -> Dict[str, Any]:
        """APIリクエストを実行"""
        self._rate_limit(method)
        
        url = f"{self.base_url}{endpoint}"
        
        try:
            response = requests.request(
                method=method,
                url=url,
                headers=self._get_headers(),
                params=params,
                json=data if data else None
            )
            return self._handle_response(response)
        except TokenRefreshedError:
            if retry_count > 0:
                return self._request(method, endpoint, params, data, retry_count - 1)
            raise
        except RateLimitError as e:
            if retry_count > 0:
                time.sleep(e.retry_after)
                return self._request(method, endpoint, params, data, retry_count - 1)
            raise
    
    def get(self, endpoint: str, params: Optional[Dict] = None) -> Dict[str, Any]:
        """GETリクエスト"""
        return self._request("GET", endpoint, params=params)
    
    def post(self, endpoint: str, data: Dict) -> Dict[str, Any]:
        """POSTリクエスト"""
        return self._request("POST", endpoint, data=data)
    
    def put(self, endpoint: str, data: Dict) -> Dict[str, Any]:
        """PUTリクエスト"""
        return self._request("PUT", endpoint, data=data)
    
    def delete(self, endpoint: str, data: Optional[Dict] = None) -> Dict[str, Any]:
        """DELETEリクエスト"""
        return self._request("DELETE", endpoint, data=data)
    
    # ==================== マスタ API ====================
    
    def get_studios(self, query: Optional[Dict] = None) -> Dict[str, Any]:
        """店舗一覧を取得"""
        params = {}
        if query:
            params["query"] = json.dumps(query)
        return self.get("/master/studios", params=params)
    
    def get_studio(self, studio_id: int) -> Dict[str, Any]:
        """店舗を取得"""
        return self.get(f"/master/studios/{studio_id}")
    
    def get_programs(self, query: Optional[Dict] = None) -> Dict[str, Any]:
        """プログラム一覧を取得"""
        params = {}
        if query:
            params["query"] = json.dumps(query)
        return self.get("/master/programs", params=params)
    
    def get_program(self, program_id: int) -> Dict[str, Any]:
        """プログラムを取得"""
        return self.get(f"/master/programs/{program_id}")
    
    def get_studio_lessons(
        self, 
        query: Optional[Dict] = None, 
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        fetch_all: bool = True
    ) -> Dict[str, Any]:
        """レッスンスケジュール一覧を取得
        
        Args:
            query: 検索クエリ
            date_from: 開始日 (YYYY-MM-DD)
            date_to: 終了日 (YYYY-MM-DD)
            fetch_all: Trueの場合、全ページを取得して結合
        """
        # クエリを構築
        q = query.copy() if query else {}
        if date_from:
            q["date_from"] = date_from
        if date_to:
            q["date_to"] = date_to
        
        params = {"length": 100}
        if q:
            params["query"] = json.dumps(q)
        
        logger.info(f"Fetching studio lessons with query: {q}")
        
        # 最初のページを取得
        result = self.get("/master/studio-lessons", params=params)
        
        if not fetch_all:
            return result
        
        # 全ページを取得
        all_lessons = result.get("data", {}).get("studio_lessons", {}).get("list", [])
        total_count = result.get("data", {}).get("studio_lessons", {}).get("total_count", 0)
        total_pages = result.get("data", {}).get("studio_lessons", {}).get("total_page", 1)
        
        logger.info(f"Studio lessons: total_count={total_count}, total_pages={total_pages}")
        
        # 2ページ目以降を取得
        for page in range(2, total_pages + 1):
            params["page"] = page
            page_result = self.get("/master/studio-lessons", params=params)
            page_lessons = page_result.get("data", {}).get("studio_lessons", {}).get("list", [])
            all_lessons.extend(page_lessons)
        
        # 結果を再構築
        result["data"]["studio_lessons"]["list"] = all_lessons
        result["data"]["studio_lessons"]["length"] = len(all_lessons)
        
        return result
    
    def get_studio_lesson(self, studio_lesson_id: int) -> Dict[str, Any]:
        """レッスンスケジュールを取得"""
        return self.get(f"/master/studio-lessons/{studio_lesson_id}")
    
    def get_instructors(self, query: Optional[Dict] = None) -> Dict[str, Any]:
        """スタッフ一覧を取得"""
        params = {}
        if query:
            params["query"] = json.dumps(query)
        return self.get("/master/instructors", params=params)
    
    def get_studio_rooms(self, query: Optional[Dict] = None) -> Dict[str, Any]:
        """スタジオルーム一覧を取得"""
        params = {}
        if query:
            params["query"] = json.dumps(query)
        return self.get("/master/studio-rooms", params=params)
    
    def get_studio_room(self, studio_room_id: int) -> Dict[str, Any]:
        """スタジオルームを取得"""
        return self.get(f"/master/studio-rooms/{studio_room_id}")
    
    def get_studio_room_spaces(self, studio_room_id: int) -> Dict[str, Any]:
        """スタジオルームのスペース一覧を取得"""
        return self.get(f"/master/studio-room-spaces/{studio_room_id}")
    
    # ==================== 会員 API ====================
    
    def get_members(self, query: Optional[Dict] = None) -> Dict[str, Any]:
        """メンバー一覧を取得"""
        params = {}
        if query:
            params["query"] = json.dumps(query)
        return self.get("/member/members", params=params)
    
    def get_member(self, member_id: int) -> Dict[str, Any]:
        """メンバーを取得"""
        return self.get(f"/member/members/{member_id}")
    
    def create_member(self, member_data: Dict) -> Dict[str, Any]:
        """メンバーを作成"""
        return self.post("/member/members", data=member_data)
    
    def update_member(self, member_id: int, member_data: Dict) -> Dict[str, Any]:
        """メンバーを更新"""
        return self.put(f"/member/members/{member_id}", data=member_data)
    
    # ==================== 予約 API ====================
    
    def get_reservations(self, query: Optional[Dict] = None) -> Dict[str, Any]:
        """予約一覧を取得"""
        params = {}
        if query:
            params["query"] = json.dumps(query)
        return self.get("/reservation/reservations", params=params)
    
    def get_reservation(self, reservation_id: int) -> Dict[str, Any]:
        """予約を取得"""
        return self.get(f"/reservation/reservations/{reservation_id}")
    
    def get_reservation_context(self, params: Dict) -> Dict[str, Any]:
        """予約詳細コンテキストを取得"""
        query_params = {"query": json.dumps(params)}
        return self.get("/reservation/reservations/context", params=query_params)
    
    def create_reservation(self, reservation_data: Dict) -> Dict[str, Any]:
        """予約を作成（固定枠レッスン予約）
        
        Args:
            reservation_data: {
                "member_id": int,
                "studio_lesson_id": int,
                "no": str,  # スペース番号（必須）
                "member_ticket_id": int (optional)
            }
        """
        return self.post("/reservation/reservations/reserve", data=reservation_data)
    
    def create_choice_reservation(self, reservation_data: Dict) -> Dict[str, Any]:
        """自由枠予約を作成
        
        Args:
            reservation_data: {
                "member_id": int,
                "studio_room_id": int,
                "program_id": int,
                "ticket_id": int,  # チケットID（必須）
                "instructor_ids": List[int],  # スタッフID（必須）
                "start_at": str,  # 開始日時（yyyy-MM-dd HH:mm:ss.fff形式）
                "contract_group_no": str (optional),
                "resource_id_set": List[Dict] (optional),
                "item_code": str (optional),
                "reservation_note": str (optional),
                "is_cash_payment": bool (optional),
                "is_send_mail": bool (optional)
            }
        """
        return self.post("/reservation/reservations/choice/reserve", data=reservation_data)
    
    def get_choice_schedule(self, studio_room_id: int, date: Optional[str] = None) -> Dict[str, Any]:
        """自由枠予約スケジュールを取得
        
        Args:
            studio_room_id: 予約カテゴリID
            date: 営業日（yyyy-MM-dd形式、未指定時は当日）
        """
        params = {"studio_room_id": studio_room_id}
        if date:
            params["query"] = json.dumps({"date": date})
        return self.get("/reservation/reservations/choice/schedule", params=params)
    
    def get_choice_reserve_context(self, context_data: Dict) -> Dict[str, Any]:
        """自由枠予約詳細コンテキストを取得
        
        Args:
            context_data: {
                "member_id": int,
                "studio_room_id": int,
                "program_id": int,
                "start_at": str (yyyy-MM-dd HH:mm:ss.fff形式)
            }
        """
        return self.post("/reservation/reservations/choice/reserve-context", data=context_data)
    
    def cancel_reservation(self, reservation_ids: List[int]) -> Dict[str, Any]:
        """予約をキャンセル"""
        return self.put("/reservation/reservations/cancel", data={"ids": reservation_ids})
    
    # ==================== チケット API ====================
    
    def get_tickets(self, query: Optional[Dict] = None) -> Dict[str, Any]:
        """チケット一覧を取得"""
        params = {}
        if query:
            params["query"] = json.dumps(query)
        return self.get("/master/tickets", params=params)
    
    def grant_ticket_to_member(self, member_id: int, ticket_id: int, num: int) -> Dict[str, Any]:
        """メンバーにチケットを付与"""
        return self.post(f"/member/members/{member_id}/tickets", data={
            "ticket_id": ticket_id,
            "num": num
        })


# ==================== 例外クラス ====================

class HacomonoAPIError(Exception):
    """hacomono API エラー"""
    def __init__(self, message: str, status_code: int = None, response_body: str = None):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body


class AuthenticationError(HacomonoAPIError):
    """認証エラー"""
    pass


class RateLimitError(HacomonoAPIError):
    """Rate Limit エラー"""
    def __init__(self, message: str, retry_after: int = 1):
        super().__init__(message)
        self.retry_after = retry_after


class TokenRefreshedError(Exception):
    """トークン更新通知"""
    pass

