#!/usr/bin/env python3
"""
hacomono OAuth トークン生成スクリプト

新しいclient_idとclient_secretを使用してアクセストークンとリフレッシュトークンを生成します。

使用方法:
1. 認可コードフロー（本番環境 - asmy）:
   python generate_hacomono_tokens.py --auth --env production

2. 認可コードフロー（開発環境 - happle）:
   python generate_hacomono_tokens.py --auth --env development

3. 既存のリフレッシュトークンでトークン更新:
   python generate_hacomono_tokens.py --refresh TOKEN --env production

4. カスタムブランドコード:
   python generate_hacomono_tokens.py --auth --brand asmy
"""

import os
import sys
import json
import argparse
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import requests

# 環境設定
ENVIRONMENTS = {
    "production": {
        "brand_code": "asmy",
        "description": "本番環境"
    },
    "development": {
        "brand_code": "happle",
        "description": "開発環境"
    }
}

# クライアント認証情報
CLIENT_ID = "eDJUVA7r6EY9Vx4OYVhd3f89y0dxPVEWPdu0KCi5TXY"
CLIENT_SECRET = "8RwRTsg8sCrlttGdCq1qxTJYnuql5F7ZxGPIRHQPe1M"

# リダイレクトURI設定
REDIRECT_URIS = {
    "script": "http://localhost:8888/callback",
    "manual": "http://localhost:3000"
}


def get_urls(brand_code: str):
    """ブランドコードからURLを生成"""
    admin_domain = f"{brand_code}-admin.hacomono.jp"
    return {
        "admin_domain": admin_domain,
        "token_url": f"https://{admin_domain}/api/oauth/token",
        "authorize_url": f"https://{admin_domain}/api/oauth/authorize"
    }


class OAuthCallbackHandler(BaseHTTPRequestHandler):
    """OAuth コールバックハンドラー"""
    
    authorization_code = None
    
    def do_GET(self):
        """コールバックを処理"""
        parsed = urlparse(self.path)
        if parsed.path == "/callback":
            query_params = parse_qs(parsed.query)
            if "code" in query_params:
                OAuthCallbackHandler.authorization_code = query_params["code"][0]
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(b"""
                <html>
                <head><title>Authorization Successful</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h1 style="color: green;">Authorization Successful!</h1>
                    <p>You can close this window and return to the terminal.</p>
                </body>
                </html>
                """)
            else:
                error = query_params.get("error", ["unknown"])[0]
                self.send_response(400)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(f"""
                <html>
                <head><title>Authorization Failed</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h1 style="color: red;">Authorization Failed</h1>
                    <p>Error: {error}</p>
                </body>
                </html>
                """.encode())
        else:
            self.send_response(404)
            self.end_headers()
    
    def log_message(self, format, *args):
        """ログを抑制"""
        pass


def authorize_flow(brand_code: str, client_id: str, client_secret: str):
    """認可コードフローでトークンを取得"""
    urls = get_urls(brand_code)
    
    print("=" * 60)
    print(f"hacomono OAuth 認可コードフロー")
    print(f"環境: {brand_code}-admin.hacomono.jp")
    print("=" * 60)
    
    # 認可URLを構築
    redirect_uri = REDIRECT_URIS["script"]
    auth_params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": "openid openapi"
    }
    
    auth_url = f"{urls['authorize_url']}?" + "&".join(f"{k}={v}" for k, v in auth_params.items())
    
    print(f"\n1. ブラウザで以下のURLを開いて認証してください:")
    print(f"\n   {auth_url}\n")
    
    # ローカルサーバーを起動
    print("2. コールバックを待機中...")
    server = HTTPServer(("localhost", 8888), OAuthCallbackHandler)
    
    # ブラウザを開く
    webbrowser.open(auth_url)
    
    # コールバックを1回だけ処理
    server.handle_request()
    
    if not OAuthCallbackHandler.authorization_code:
        print("\nエラー: 認可コードを取得できませんでした")
        return None
    
    print(f"\n3. 認可コードを取得しました")
    
    # 認可コードをトークンに交換
    print("4. アクセストークンを取得中...")
    
    token_data = {
        "grant_type": "authorization_code",
        "code": OAuthCallbackHandler.authorization_code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "client_secret": client_secret
    }
    
    response = requests.post(
        urls["token_url"],
        json=token_data,
        headers={"Content-Type": "application/json"}
    )
    
    if not response.ok:
        print(f"\nエラー: トークン取得に失敗しました")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text}")
        return None
    
    tokens = response.json()
    return tokens


def exchange_code(brand_code: str, code: str, client_id: str, client_secret: str, redirect_uri: str = None):
    """認可コードをトークンに交換"""
    urls = get_urls(brand_code)
    
    if redirect_uri is None:
        redirect_uri = REDIRECT_URIS["manual"]
    
    print("=" * 60)
    print(f"hacomono 認可コード交換")
    print(f"環境: {brand_code}-admin.hacomono.jp")
    print("=" * 60)
    
    token_data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "client_secret": client_secret
    }
    
    print(f"\nトークンエンドポイント: {urls['token_url']}")
    print(f"リダイレクトURI: {redirect_uri}")
    
    response = requests.post(
        urls["token_url"],
        json=token_data,
        headers={"Content-Type": "application/json"}
    )
    
    if not response.ok:
        print(f"\nエラー: トークン取得に失敗しました")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text}")
        return None
    
    tokens = response.json()
    return tokens


def refresh_flow(brand_code: str, refresh_token: str, client_id: str, client_secret: str):
    """リフレッシュトークンでアクセストークンを更新"""
    urls = get_urls(brand_code)
    
    print("=" * 60)
    print(f"hacomono トークン更新")
    print(f"環境: {brand_code}-admin.hacomono.jp")
    print("=" * 60)
    
    token_data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret
    }
    
    response = requests.post(
        urls["token_url"],
        json=token_data,
        headers={"Content-Type": "application/json"}
    )
    
    if not response.ok:
        print(f"\nエラー: トークン更新に失敗しました")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text}")
        return None
    
    tokens = response.json()
    return tokens


def print_tokens(tokens: dict, brand_code: str):
    """トークン情報を表示"""
    print("\n" + "=" * 60)
    print("トークン取得成功!")
    print("=" * 60)
    
    access_token = tokens.get("access_token", "N/A")
    refresh_token = tokens.get("refresh_token", "N/A")
    expires_in = tokens.get("expires_in", "N/A")
    
    print(f"\n環境: {brand_code}-admin.hacomono.jp")
    print(f"\nHACOMONO_ACCESS_TOKEN={access_token}")
    print(f"\nHACOMONO_REFRESH_TOKEN={refresh_token}")
    print(f"\n有効期限: {expires_in}秒")
    
    # JSONファイルに保存
    env_suffix = "_production" if brand_code == "asmy" else "_development"
    output_file = f"hacomono_token{env_suffix}.json"
    output_path = os.path.join(os.path.dirname(__file__), "..", "..", output_file)
    
    token_data = {
        "access_token": access_token,
        "token_type": tokens.get("token_type", "Bearer"),
        "refresh_token": refresh_token,
        "scope": tokens.get("scope", "openid openapi"),
        "created_at": tokens.get("created_at"),
        "environment": "production" if brand_code == "asmy" else "development",
        "brand_code": brand_code
    }
    
    with open(output_path, "w") as f:
        json.dump(token_data, f, indent=2)
    
    print(f"\n✅ トークンを保存しました: {output_file}")
    
    print("\n" + "-" * 60)
    print("Render環境変数設定コマンド:")
    print("-" * 60)
    print(f"""
# 以下のコマンドでRenderに設定してください:

RENDER_API_KEY=$(grep "key:" ~/.render/cli.yaml | awk '{{print $2}}')
BACKEND_ID="srv-d4tpkhumcj7s7384p62g"

# 環境変数を更新
  curl -s -X PUT "https://api.render.com/v1/services/$BACKEND_ID/env-vars" \\
    -H "Authorization: Bearer $RENDER_API_KEY" \\
    -H "Content-Type: application/json" \\
  -d '[
    {{"key": "HACOMONO_ACCESS_TOKEN", "value": "{access_token}"}},
    {{"key": "HACOMONO_REFRESH_TOKEN", "value": "{refresh_token}"}}
  ]'
""")


def print_auth_url(brand_code: str, client_id: str):
    """認可URLを表示"""
    urls = get_urls(brand_code)
    redirect_uri = REDIRECT_URIS["manual"]
    
    print("=" * 60)
    print(f"hacomono OAuth 認可URL")
    print(f"環境: {brand_code}-admin.hacomono.jp")
    print("=" * 60)
    
    auth_url = (
        f"{urls['authorize_url']}?"
        f"response_type=code&"
        f"client_id={client_id}&"
        f"redirect_uri={redirect_uri}&"
        f"scope=openid%20openapi"
    )
    
    print(f"\n以下のURLをブラウザで開いてログインしてください:\n")
    print(auth_url)
    print(f"\n認証後、リダイレクトURLから code=XXXXX の部分をコピーして、")
    print(f"以下のコマンドを実行してください:\n")
    print(f"  python generate_hacomono_tokens.py --code <CODE> --env {'production' if brand_code == 'asmy' else 'development'}")


def main():
    parser = argparse.ArgumentParser(
        description="hacomono OAuth トークン生成",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  # 本番環境（asmy）でトークン取得
  python generate_hacomono_tokens.py --auth --env production

  # 開発環境（happle）でトークン取得
  python generate_hacomono_tokens.py --auth --env development

  # カスタムブランドコード
  python generate_hacomono_tokens.py --auth --brand asmy

  # 認可URLのみ表示（ブラウザは開かない）
  python generate_hacomono_tokens.py --url --env production

  # 認可コードからトークン取得
  python generate_hacomono_tokens.py --code ABC123 --env production

  # トークン更新
  python generate_hacomono_tokens.py --refresh TOKEN --env production
"""
    )
    
    # アクション
    action_group = parser.add_mutually_exclusive_group()
    action_group.add_argument("--auth", action="store_true", 
                              help="認可コードフローで新規トークン取得（ブラウザ自動起動）")
    action_group.add_argument("--url", action="store_true",
                              help="認可URLを表示（ブラウザは開かない）")
    action_group.add_argument("--code", type=str, metavar="CODE",
                              help="認可コードをトークンに交換")
    action_group.add_argument("--refresh", type=str, metavar="TOKEN",
                              help="リフレッシュトークンでトークン更新")
    
    # 環境設定
    env_group = parser.add_mutually_exclusive_group()
    env_group.add_argument("--env", choices=["production", "development"], default="production",
                           help="環境を指定 (default: production)")
    env_group.add_argument("--brand", type=str, metavar="CODE",
                           help="ブランドコードを直接指定 (例: asmy, happle)")
    
    # オプション
    parser.add_argument("--client-id", type=str, default=CLIENT_ID,
                        help="クライアントID（デフォルト: 設定済み）")
    parser.add_argument("--client-secret", type=str, default=CLIENT_SECRET,
                        help="クライアントシークレット（デフォルト: 設定済み）")
    parser.add_argument("--redirect-uri", type=str,
                        help="リダイレクトURI（--code使用時）")
    
    args = parser.parse_args()
    
    # ブランドコードを決定
    if args.brand:
        brand_code = args.brand
    else:
        brand_code = ENVIRONMENTS[args.env]["brand_code"]
    
    tokens = None
    
    if args.auth:
        tokens = authorize_flow(brand_code, args.client_id, args.client_secret)
    elif args.url:
        print_auth_url(brand_code, args.client_id)
        return
    elif args.code:
        tokens = exchange_code(brand_code, args.code, args.client_id, args.client_secret, args.redirect_uri)
    elif args.refresh:
        tokens = refresh_flow(brand_code, args.refresh, args.client_id, args.client_secret)
    else:
        # デフォルトはヘルプ表示
        parser.print_help()
        print("\n" + "=" * 60)
        print("環境一覧:")
        print("=" * 60)
        for env_name, env_config in ENVIRONMENTS.items():
            print(f"  {env_name:12} : {env_config['brand_code']}-admin.hacomono.jp ({env_config['description']})")
        return
    
    if tokens:
        print_tokens(tokens, brand_code)


if __name__ == "__main__":
    main()
