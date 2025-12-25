#!/usr/bin/env python3
"""
予約一覧取得のボトルネック調査スクリプト

各APIエンドポイントの実行時間を計測し、どこがボトルネックになっているかを特定します。
"""

import os
import sys
import time
import json
import logging
from datetime import datetime, timedelta
from functools import wraps
from typing import Callable, Any

# カレントディレクトリをパスに追加
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from hacomono_client import HacomonoClient, HacomonoAPIError

# ロギング設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 環境変数を読み込み（.envがあれば）
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


class Timer:
    """処理時間計測用のコンテキストマネージャー"""
    
    def __init__(self, name: str):
        self.name = name
        self.start_time = None
        self.end_time = None
        self.elapsed = 0
    
    def __enter__(self):
        self.start_time = time.perf_counter()
        return self
    
    def __exit__(self, *args):
        self.end_time = time.perf_counter()
        self.elapsed = self.end_time - self.start_time
        logger.info(f"⏱️  {self.name}: {self.elapsed:.3f}秒")


class BenchmarkResult:
    """ベンチマーク結果を保持するクラス"""
    
    def __init__(self):
        self.results = {}
        self.total_time = 0
    
    def add(self, name: str, elapsed: float, data_count: int = 0):
        self.results[name] = {
            "elapsed": elapsed,
            "data_count": data_count
        }
        self.total_time += elapsed
    
    def print_summary(self):
        print("\n" + "="*70)
        print("📊 ベンチマーク結果サマリー")
        print("="*70)
        
        # 時間でソート（遅い順）
        sorted_results = sorted(
            self.results.items(), 
            key=lambda x: x[1]["elapsed"], 
            reverse=True
        )
        
        for name, data in sorted_results:
            elapsed = data["elapsed"]
            percentage = (elapsed / self.total_time) * 100 if self.total_time > 0 else 0
            bar = "█" * int(percentage / 2)
            count_str = f" ({data['data_count']}件)" if data["data_count"] > 0 else ""
            print(f"{name:40} {elapsed:8.3f}秒 {percentage:5.1f}%{count_str} {bar}")
        
        print("-"*70)
        print(f"{'合計':40} {self.total_time:8.3f}秒")
        print("="*70)
        
        # ボトルネック分析
        if sorted_results:
            slowest = sorted_results[0]
            print(f"\n⚠️  ボトルネック: {slowest[0]} ({slowest[1]['elapsed']:.3f}秒)")


def benchmark_choice_schedule(client: HacomonoClient, studio_room_id: int, date: str, 
                               studio_id: int = None, program_id: int = None) -> BenchmarkResult:
    """
    自由枠スケジュール取得のベンチマーク
    
    /api/choice-schedule エンドポイントで実行される処理を個別に計測
    """
    result = BenchmarkResult()
    
    print(f"\n📅 日付: {date}, studio_room_id: {studio_room_id}")
    print("-"*50)
    
    # 1. 自由枠スケジュール取得
    with Timer("1. get_choice_schedule") as t:
        response = client.get_choice_schedule(studio_room_id, date)
        schedule = response.get("data", {}).get("schedule", {})
    result.add("1. get_choice_schedule", t.elapsed)
    
    # studio_idを取得
    if not studio_id:
        studio_room = schedule.get("studio_room_service", {})
        studio_id = studio_room.get("studio_id") if studio_room else None
    
    if not studio_id:
        logger.warning("studio_id が取得できませんでした")
        return result
    
    # 2. 固定枠レッスン取得
    with Timer("2. get_studio_lessons") as t:
        lessons_response = client.get_studio_lessons(
            query={"studio_id": studio_id},
            date_from=date,
            date_to=date,
            fetch_all=True
        )
        lessons = lessons_response.get("data", {}).get("studio_lessons", {}).get("list", [])
    result.add("2. get_studio_lessons", t.elapsed, len(lessons))
    
    # 3. 予定ブロック（休憩ブロック）取得
    with Timer("3. get_shift_slots") as t:
        shift_slots_response = client.get_shift_slots({"studio_id": studio_id, "date": date})
        shift_slots_data = shift_slots_response.get("data", {}).get("shift_slots", {})
        shift_slots = shift_slots_data.get("list", []) if isinstance(shift_slots_data, dict) else shift_slots_data
    result.add("3. get_shift_slots", t.elapsed, len(shift_slots) if shift_slots else 0)
    
    # 4. スタッフ一覧取得（instructor_studio_map用）
    with Timer("4. get_instructors") as t:
        instructors_response = client.get_instructors()
        instructors = instructors_response.get("data", {}).get("instructors", {}).get("list", [])
    result.add("4. get_instructors", t.elapsed, len(instructors))
    
    # 5. 設備情報取得
    with Timer("5. get_resources") as t:
        resources_response = client.get_resources({"studio_id": studio_id})
        resources_data = resources_response.get("data", {}).get("resources", {})
        resources = resources_data.get("list", []) if isinstance(resources_data, dict) else resources_data
    result.add("5. get_resources", t.elapsed, len(resources) if resources else 0)
    
    # 6. プログラムの予約数取得（program_idがある場合）
    if program_id:
        with Timer("6. get_reservations (program)") as t:
            reservations_response = client.get_reservations({
                "program_id": program_id,
                "date_from": date,
                "date_to": date
            })
            reservations_data = reservations_response.get("data", {}).get("reservations", {})
            if isinstance(reservations_data, dict):
                reservation_count = len(reservations_data.get("list", []))
            else:
                reservation_count = len(reservations_data) if reservations_data else 0
        result.add("6. get_reservations (program)", t.elapsed, reservation_count)
    
    return result


def benchmark_schedule(client: HacomonoClient, studio_id: int = None, 
                       start_date: str = None, end_date: str = None) -> BenchmarkResult:
    """
    固定枠スケジュール取得のベンチマーク
    
    /api/schedule エンドポイントで実行される処理を個別に計測
    """
    result = BenchmarkResult()
    
    if not start_date:
        start_date = datetime.now().strftime("%Y-%m-%d")
    if not end_date:
        end_date = (datetime.now() + timedelta(days=14)).strftime("%Y-%m-%d")
    
    print(f"\n📅 期間: {start_date} ～ {end_date}")
    print("-"*50)
    
    # 1. スペース一覧取得（予約可能なスペースID取得用）
    with Timer("1. get_studio_room_spaces") as t:
        spaces_response = client.get_studio_room_spaces()
        spaces = spaces_response.get("data", {}).get("studio_room_spaces", {}).get("list", [])
    result.add("1. get_studio_room_spaces", t.elapsed, len(spaces))
    
    # 2. レッスンスケジュール取得
    query = {"studio_id": studio_id} if studio_id else None
    with Timer("2. get_studio_lessons") as t:
        lessons_response = client.get_studio_lessons(
            query=query,
            date_from=start_date,
            date_to=end_date
        )
        lessons = lessons_response.get("data", {}).get("studio_lessons", {}).get("list", [])
    result.add("2. get_studio_lessons", t.elapsed, len(lessons))
    
    # 3. 予約数取得（レッスンIDごと）
    if lessons:
        with Timer("3. get_reservations (all)") as t:
            reservations_response = client.get("/reservation/reservations")
            reservations = reservations_response.get("data", {}).get("reservations", {}).get("list", [])
        result.add("3. get_reservations (all)", t.elapsed, len(reservations))
    
    return result


def benchmark_choice_schedule_range(client: HacomonoClient, studio_room_id: int, 
                                     date_from: str, date_to: str,
                                     program_id: int = None) -> BenchmarkResult:
    """
    日付範囲での自由枠スケジュール取得のベンチマーク（最適化版）
    
    /api/choice-schedule-range エンドポイントで実行される処理
    """
    result = BenchmarkResult()
    
    print(f"\n📅 期間: {date_from} ～ {date_to}, studio_room_id: {studio_room_id}")
    print("-"*50)
    
    # 日付リストを生成
    from datetime import date as date_type
    start = datetime.strptime(date_from, "%Y-%m-%d").date()
    end = datetime.strptime(date_to, "%Y-%m-%d").date()
    dates = []
    current = start
    while current <= end:
        dates.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    
    print(f"取得日数: {len(dates)}日")
    
    # 各日のスケジュールを個別に取得（合計時間）
    total_schedule_time = 0
    for d in dates:
        with Timer(f"  choice_schedule ({d})") as t:
            response = client.get_choice_schedule(studio_room_id, d)
        total_schedule_time += t.elapsed
    
    result.add("1. get_choice_schedule x 日数", total_schedule_time, len(dates))
    
    return result


def main():
    """メイン関数"""
    print("="*70)
    print("🔍 予約一覧取得 ボトルネック調査ツール")
    print("="*70)
    
    # 環境変数チェック
    if not os.environ.get("HACOMONO_ACCESS_TOKEN"):
        print("\n❌ エラー: HACOMONO_ACCESS_TOKEN が設定されていません")
        print("  .env ファイルを作成するか、環境変数を設定してください")
        sys.exit(1)
    
    # クライアント初期化
    try:
        client = HacomonoClient.from_env()
        print(f"\n✅ hacomono クライアント初期化完了")
        print(f"   Brand Code: {client.brand_code}")
    except Exception as e:
        print(f"\n❌ クライアント初期化エラー: {e}")
        sys.exit(1)
    
    # テスト日付
    today = datetime.now().strftime("%Y-%m-%d")
    week_later = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")
    
    # スタジオルーム一覧を取得して表示
    print("\n" + "="*70)
    print("📋 スタジオルーム一覧")
    print("="*70)
    
    rooms_response = client.get_studio_rooms()
    rooms = rooms_response.get("data", {}).get("studio_rooms", {}).get("list", [])
    
    choice_rooms = []
    for room in rooms:
        room_type = room.get("reservation_type", "FIXED")
        status = "✅" if room_type == "CHOICE" else "  "
        print(f"  {status} ID:{room.get('id'):3} | {room.get('name'):20} | タイプ: {room_type} | スタジオID: {room.get('studio_id')}")
        if room_type == "CHOICE":
            choice_rooms.append(room)
    
    # ===============================
    # ベンチマーク1: 自由枠スケジュール
    # ===============================
    print("\n" + "="*70)
    print("📋 ベンチマーク1: 自由枠スケジュール取得 (/api/choice-schedule)")
    print("="*70)
    
    # CHOICEタイプのスタジオルームを使用
    try:
        if choice_rooms:
            room = choice_rooms[0]
            studio_room_id = room.get("id")
            studio_id = room.get("studio_id")
            print(f"\n📍 使用するスタジオルーム: {room.get('name')} (ID: {studio_room_id})")
            
            result1 = benchmark_choice_schedule(client, studio_room_id, today, studio_id)
            result1.print_summary()
        else:
            print("\n⚠️ CHOICE タイプのスタジオルームが見つかりません")
            print("   固定枠スケジュールのみベンチマークを実行します")
    except HacomonoAPIError as e:
        print(f"\n❌ ベンチマーク1 APIエラー: {e}")
        print(f"   Response: {e.response_body}")
    except Exception as e:
        print(f"\n❌ ベンチマーク1 エラー: {e}")
    
    # ===============================
    # ベンチマーク2: 固定枠スケジュール
    # ===============================
    print("\n" + "="*70)
    print("📋 ベンチマーク2: 固定枠スケジュール取得 (/api/schedule)")
    print("="*70)
    
    try:
        result2 = benchmark_schedule(client, start_date=today, end_date=week_later)
        result2.print_summary()
    except Exception as e:
        print(f"\n❌ ベンチマーク2 エラー: {e}")
    
    # ===============================
    # ベンチマーク3: 日付範囲での自由枠
    # ===============================
    print("\n" + "="*70)
    print("📋 ベンチマーク3: 日付範囲で自由枠スケジュール (/api/choice-schedule-range)")
    print("="*70)
    
    try:
        if choice_rooms:
            result3 = benchmark_choice_schedule_range(
                client, studio_room_id, today, week_later
            )
            result3.print_summary()
        else:
            print("\n⚠️ CHOICE タイプのスタジオルームがないためスキップ")
    except HacomonoAPIError as e:
        print(f"\n❌ ベンチマーク3 APIエラー: {e}")
        print(f"   Response: {e.response_body}")
    except Exception as e:
        print(f"\n❌ ベンチマーク3 エラー: {e}")
    
    print("\n✅ ベンチマーク完了")


if __name__ == "__main__":
    main()

