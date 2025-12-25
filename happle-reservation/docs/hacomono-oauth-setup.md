# hacomono OAuth トークン設定ガイド

hacomono Admin API を使用するためのOAuth認証トークンを取得・更新する手順を説明します。

## 前提条件

- hacomono管理画面でOAuthアプリケーションが作成済みであること
- Python 3.x がインストールされていること
- `requests` ライブラリがインストールされていること

## OAuthアプリケーションの設定（hacomono管理画面）

1. hacomono管理画面にログイン
2. 設定 → 開発者向け → OAuthアプリケーション
3. 新規作成またはリダイレクトURIの追加
   - 必要なリダイレクトURI:
     - `http://localhost:3000`
     - `http://localhost:8888/callback`（スクリプト用）

## トークンの取得方法

### 方法1: スクリプトを使用（推奨）

```bash
cd happle-reservation/scripts
python generate_hacomono_tokens.py --auth
```

ブラウザが自動で開き、hacomonoにログイン後、トークンが取得されます。

### 方法2: 手動でURLを開く

1. 認可URLをブラウザで開く:

```
https://{BRAND_CODE}-admin.hacomono.jp/api/oauth/authorize?response_type=code&client_id={CLIENT_ID}&redirect_uri=http://localhost:3000&scope=openid%20openapi
```

例（asmy環境）:
```
https://asmy-admin.hacomono.jp/api/oauth/authorize?response_type=code&client_id=eDJUVA7r6EY9Vx4OYVhd3f89y0dxPVEWPdu0KCi5TXY&redirect_uri=http://localhost:3000&scope=openid%20openapi
```

2. hacomonoにログインして認証を許可

3. リダイレクトされたURLから `code` パラメータをコピー
   - 例: `http://localhost:3000/?code=XXXXXX`

4. curlでトークンを取得:

```bash
CODE="取得した認可コード"

curl -X POST "https://{BRAND_CODE}-admin.hacomono.jp/api/oauth/token" \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "authorization_code",
    "code": "'"$CODE"'",
    "redirect_uri": "http://localhost:3000",
    "client_id": "{CLIENT_ID}",
    "client_secret": "{CLIENT_SECRET}"
  }'
```

## トークンの更新（リフレッシュ）

既存のリフレッシュトークンを使って新しいアクセストークンを取得:

```bash
python generate_hacomono_tokens.py --refresh "既存のリフレッシュトークン"
```

または手動で:

```bash
curl -X POST "https://{BRAND_CODE}-admin.hacomono.jp/api/oauth/token" \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "refresh_token",
    "refresh_token": "{REFRESH_TOKEN}",
    "client_id": "{CLIENT_ID}",
    "client_secret": "{CLIENT_SECRET}"
  }'
```

## Renderへの環境変数設定

取得したトークンをRenderに設定する:

```bash
RENDER_API_KEY=$(grep "key:" ~/.render/cli.yaml | awk '{print $2}')
BACKEND_ID="srv-d4tpkhumcj7s7384p62g"

# 環境変数を取得
CURRENT_ENV=$(curl -s "https://api.render.com/v1/services/$BACKEND_ID/env-vars" \
  -H "Authorization: Bearer $RENDER_API_KEY")

# 新しい値で更新（jqで置換）
NEW_ENV=$(echo "$CURRENT_ENV" | jq \
  --arg at "新しいアクセストークン" \
  --arg rt "新しいリフレッシュトークン" '
  [.[] | .envVar] | 
  map(
    if .key == "HACOMONO_ACCESS_TOKEN" then .value = $at 
    elif .key == "HACOMONO_REFRESH_TOKEN" then .value = $rt 
    else . end
  )
')

# 更新を適用
curl -X PUT "https://api.render.com/v1/services/$BACKEND_ID/env-vars" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$NEW_ENV"

# デプロイをトリガー
curl -X POST "https://api.render.com/v1/services/$BACKEND_ID/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json"
```

## 環境変数一覧

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `HACOMONO_BRAND_CODE` | ブランドコード | `asmy` |
| `HACOMONO_ADMIN_DOMAIN` | 管理画面ドメイン | `asmy-admin.hacomono.jp` |
| `HACOMONO_CLIENT_ID` | OAuthクライアントID | `eDJUVA7r...` |
| `HACOMONO_CLIENT_SECRET` | OAuthクライアントシークレット | `8RwRTsg8...` |
| `HACOMONO_ACCESS_TOKEN` | アクセストークン | `0AEl2ppU...` |
| `HACOMONO_REFRESH_TOKEN` | リフレッシュトークン | `_d2zme7W...` |

## トラブルシューティング

### `invalid_client` エラー

- client_id がhacomonoに登録されていない
- OAuthアプリケーションが正しく作成されていない

**対処**: hacomono管理画面でOAuthアプリケーションの設定を確認

### `invalid_scope` エラー

- スコープが正しくない
- 使用可能なスコープ: `openid openapi`

**対処**: スコープを `openid%20openapi` に変更

### `invalid_grant` エラー

- 認可コードの有効期限切れ（通常10分程度）
- 認可コードが既に使用済み

**対処**: 認可フローを最初からやり直す

## 注意事項

- アクセストークンの有効期限は短い（通常2時間程度）
- リフレッシュトークンは長期間有効だが、使用すると新しいリフレッシュトークンが発行される
- 本番環境のトークンは安全に管理すること
- クライアントシークレットは絶対に公開しないこと








