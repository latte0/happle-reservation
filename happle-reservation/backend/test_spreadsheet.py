#!/usr/bin/env python3
"""
Google Spreadsheet 接続テストスクリプト
サービスアカウントでスプレッドシートに書き込めるかテストします
"""

import os
import sys
from datetime import datetime

# 環境変数を読み込み
from dotenv import load_dotenv
load_dotenv()

try:
    import gspread
    from google.oauth2.service_account import Credentials
except ImportError:
    print("❌ gspread または google-auth がインストールされていません")
    print("   pip install gspread google-auth を実行してください")
    sys.exit(1)

# 設定
SPREADSHEET_ID = os.environ.get("GOOGLE_SPREADSHEET_ID", "1tp2PuI1Qne7sUxZhV_o96yu7OmI14laGo32xlGsBUsc")
SHEET_NAME = os.environ.get("GOOGLE_SHEET_NAME", "予約履歴")
CREDENTIALS_FILE = os.path.join(os.path.dirname(__file__), "asmy-483410-b42feb85af6e.json")

# ヘッダー行
HEADERS = [
    "記録日時",
    "ステータス",
    "予約ID",
    "お客様名",
    "メールアドレス",
    "電話番号",
    "店舗名",
    "予約日",
    "予約時間",
    "施術コース",
    "担当スタッフ",
    "エラーコード",
    "エラーメッセージ"
]


def main():
    print("=" * 60)
    print("Google Spreadsheet 接続テスト")
    print("=" * 60)
    
    # 1. 認証情報の確認
    print("\n📁 認証情報の確認...")
    if not os.path.exists(CREDENTIALS_FILE):
        print(f"❌ 認証ファイルが見つかりません: {CREDENTIALS_FILE}")
        sys.exit(1)
    print(f"✅ 認証ファイル: {CREDENTIALS_FILE}")
    
    # 2. スプレッドシートIDの確認
    print(f"\n📊 スプレッドシートID: {SPREADSHEET_ID}")
    print(f"📄 シート名: {SHEET_NAME}")
    
    # 3. 認証
    print("\n🔐 Google APIに認証中...")
    try:
        scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]
        credentials = Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=scopes)
        client = gspread.authorize(credentials)
        print("✅ 認証成功")
    except Exception as e:
        print(f"❌ 認証失敗: {e}")
        sys.exit(1)
    
    # 4. スプレッドシートを開く
    print("\n📖 スプレッドシートを開いています...")
    try:
        spreadsheet = client.open_by_key(SPREADSHEET_ID)
        print(f"✅ スプレッドシートを開きました: {spreadsheet.title}")
    except gspread.exceptions.SpreadsheetNotFound:
        print("❌ スプレッドシートが見つかりません")
        print("   スプレッドシートIDを確認してください")
        sys.exit(1)
    except gspread.exceptions.APIError as e:
        if "403" in str(e):
            print("❌ アクセス権限がありません")
            print("   スプレッドシートをサービスアカウントと共有してください:")
            print("   → asmy-282@asmy-483410.iam.gserviceaccount.com を「編集者」として追加")
        else:
            print(f"❌ APIエラー: {e}")
        sys.exit(1)
    
    # 5. ワークシートを取得または作成
    print(f"\n📋 ワークシート '{SHEET_NAME}' を確認中...")
    try:
        worksheet = spreadsheet.worksheet(SHEET_NAME)
        print(f"✅ ワークシート '{SHEET_NAME}' が見つかりました")
    except gspread.exceptions.WorksheetNotFound:
        print(f"📝 ワークシート '{SHEET_NAME}' を作成します...")
        worksheet = spreadsheet.add_worksheet(title=SHEET_NAME, rows=1000, cols=15)
        print(f"✅ ワークシート '{SHEET_NAME}' を作成しました")
    
    # 6. ヘッダー行を設定
    print("\n📝 ヘッダー行を設定中...")
    try:
        # 現在の1行目を取得
        current_row1 = worksheet.row_values(1)
        
        if current_row1 == HEADERS:
            print("✅ ヘッダー行はすでに設定されています")
        elif not current_row1 or all(cell == "" for cell in current_row1):
            # 空の場合はヘッダーを設定
            worksheet.update('A1', [HEADERS])
            print("✅ ヘッダー行を設定しました")
        else:
            print(f"⚠️ 1行目にデータがあります: {current_row1[:3]}...")
            user_input = input("ヘッダーで上書きしますか？ (y/N): ")
            if user_input.lower() == 'y':
                worksheet.update('A1', [HEADERS])
                print("✅ ヘッダー行を上書きしました")
            else:
                print("⏭️ スキップしました")
    except Exception as e:
        print(f"❌ ヘッダー設定失敗: {e}")
        sys.exit(1)
    
    # 7. テストデータを書き込み
    print("\n🧪 テストデータを書き込み中...")
    try:
        test_row = [
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "テスト",
            "TEST-001",
            "テスト太郎",
            "test@example.com",
            "090-0000-0000",
            "テスト店舗",
            "2024-01-01",
            "10:00",
            "テストコース",
            "テストスタッフ",
            "",
            "これはテストデータです（削除してOK）"
        ]
        
        worksheet.append_row(test_row, value_input_option='USER_ENTERED')
        print("✅ テストデータを書き込みました")
    except Exception as e:
        print(f"❌ 書き込み失敗: {e}")
        sys.exit(1)
    
    # 8. 完了
    print("\n" + "=" * 60)
    print("🎉 すべてのテストが成功しました！")
    print("=" * 60)
    print(f"\nスプレッドシートを確認してください:")
    print(f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit")
    print("\n※ テスト行は手動で削除してください")


if __name__ == "__main__":
    main()






