# Render CLI & API ガイド

## 概要

Render CLIとAPIを使用してサービスの管理、環境変数の設定、デプロイのトリガーを行う方法をまとめています。

---

## Render CLIのインストール

```bash
# macOS (Homebrew)
brew install render

# その他のOS
# https://render.com/docs/cli を参照
```

---

## ログイン

```bash
render login
```

ブラウザが開き、Renderダッシュボードで認証を行います。

### ログイン状態の確認

```bash
render whoami -o json
```

### 認証情報の保存場所

ログイン後、認証情報は以下のファイルに保存されます：

```
~/.render/cli.yaml
```

**ファイル内容例:**
```yaml
version: 1
workspace: tea-xxxxx
workspace_name: Your Workspace Name
api:
    key: rnd_xxxxxxxxxxxxx  # APIキー
    expires_at: 1766653545
    host: https://api.render.com/v1/
    refreshtoken: rnd_xxxxxxxxxxxxx
dashboard_url: https://dashboard.render.com
```

---

## サービス一覧の取得

```bash
# インタラクティブモード
render services

# JSON出力（スクリプト用）
render services -o json
```

### 特定のサービスを検索

```bash
render services -o json | jq '.[] | .service | select(.name != null) | select(.name | contains("happle")) | {id, name, type}'
```

**出力例:**
```json
{
  "id": "srv-d4tpkhumcj7s7384p62g",
  "name": "happle-reservation-backend",
  "type": "web_service"
}
```

---

## 環境変数の管理（API経由）

Render CLIには環境変数を直接設定するコマンドがないため、APIを使用します。

### APIキーの取得

```bash
RENDER_API_KEY=$(grep "key:" ~/.render/cli.yaml | awk '{print $2}')
echo $RENDER_API_KEY
```

### 現在の環境変数を取得

```bash
SERVICE_ID="srv-xxxxx"

curl -s "https://api.render.com/v1/services/$SERVICE_ID/env-vars" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Accept: application/json" | jq '.[].envVar.key'
```

### 環境変数を更新（全置換）

⚠️ **注意**: このAPIは環境変数を全置換します。既存の環境変数を保持する場合は、まず取得してからマージしてください。

```bash
SERVICE_ID="srv-xxxxx"

# 現在の環境変数を取得
CURRENT_ENV=$(curl -s "https://api.render.com/v1/services/$SERVICE_ID/env-vars" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Accept: application/json")

# 既存の環境変数に新しいものを追加
NEW_ENV=$(echo "$CURRENT_ENV" | jq '
  [.[] | {key: .envVar.key, value: .envVar.value}] + [
    {key: "NEW_VAR_1", value: "value1"},
    {key: "NEW_VAR_2", value: "value2"}
  ]
')

# 環境変数を更新
curl -s -X PUT "https://api.render.com/v1/services/$SERVICE_ID/env-vars" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$NEW_ENV"
```

---

## デプロイのトリガー

### CLI経由

```bash
render deploys create --service srv-xxxxx
```

### API経由

```bash
SERVICE_ID="srv-xxxxx"

curl -s -X POST "https://api.render.com/v1/services/$SERVICE_ID/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**レスポンス例:**
```json
{
  "id": "dep-xxxxx",
  "status": "build_in_progress",
  "createdAt": "2025-12-22T07:08:06.205604Z"
}
```

---

## ログの確認

```bash
# インタラクティブモード
render logs --service srv-xxxxx

# 最新100行を取得
render logs --service srv-xxxxx -o text --tail 100
```

---

## 本プロジェクトでの使用例

### SES環境変数の一括設定

```bash
cd /Users/kazuyukijimbo/hacomono/happle-reservation

# APIキーを取得
RENDER_API_KEY=$(grep "key:" ~/.render/cli.yaml | awk '{print $2}')
BACKEND_ID="srv-d4tpkhumcj7s7384p62g"

# terraformからSES設定を取得
SES_ACCESS_KEY=$(cat terraform/terraform.tfstate | jq -r '.outputs.ses_smtp_user_access_key.value')
SES_SECRET_KEY=$(cat terraform/terraform.tfstate | jq -r '.resources[] | select(.type == "aws_iam_access_key" and .name == "ses_user_key") | .instances[0].attributes.secret')

# 現在の環境変数を取得してSES設定を追加
CURRENT_ENV=$(curl -s "https://api.render.com/v1/services/$BACKEND_ID/env-vars" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Accept: application/json")

NEW_ENV=$(echo "$CURRENT_ENV" | jq --arg ak "$SES_ACCESS_KEY" --arg sk "$SES_SECRET_KEY" '
  [.[] | {key: .envVar.key, value: .envVar.value}] + [
    {key: "SES_ACCESS_KEY_ID", value: $ak},
    {key: "SES_SECRET_ACCESS_KEY", value: $sk},
    {key: "SES_REGION", value: "ap-northeast-1"},
    {key: "SES_DOMAIN", value: "reserve-now.jp"},
    {key: "SES_FROM_EMAIL", value: "noreply@reserve-now.jp"}
  ]
')

# 環境変数を更新
curl -s -X PUT "https://api.render.com/v1/services/$BACKEND_ID/env-vars" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$NEW_ENV"

# デプロイをトリガー
curl -s -X POST "https://api.render.com/v1/services/$BACKEND_ID/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## サービスID一覧（本プロジェクト）

| サービス名 | サービスID | タイプ |
|-----------|-----------|--------|
| happle-reservation-backend | `srv-d4tpkhumcj7s7384p62g` | web_service |
| happle-reservation-frontend | `srv-d4tpkkuuk2gs73c47jh0` | web_service |

---

## 設定済み環境変数一覧（Backend）

| 変数名 | 説明 |
|--------|------|
| `PYTHON_VERSION` | Pythonバージョン |
| `FLASK_ENV` | Flask環境 (production) |
| `HACOMONO_BRAND_CODE` | hacomonoブランドコード |
| `HACOMONO_ADMIN_DOMAIN` | hacomono管理ドメイン |
| `HACOMONO_ACCESS_TOKEN` | hacomonoアクセストークン |
| `HACOMONO_REFRESH_TOKEN` | hacomonoリフレッシュトークン |
| `HACOMONO_CLIENT_ID` | hacomonoクライアントID |
| `HACOMONO_CLIENT_SECRET` | hacomonoクライアントシークレット |
| `CORS_ORIGINS` | 許可するオリジン |
| `SLACK_WEBHOOK_URL` | Slack通知用Webhook URL |
| `SES_ACCESS_KEY_ID` | AWS SESアクセスキー |
| `SES_SECRET_ACCESS_KEY` | AWS SESシークレットキー |
| `SES_REGION` | AWS SESリージョン (ap-northeast-1) |
| `SES_DOMAIN` | メール送信ドメイン (reserve-now.jp) |
| `SES_FROM_EMAIL` | 送信元メールアドレス |

---

## トラブルシューティング

### TTYエラー

```
panic: Failed to initialize interface. Use -o to specify a non-interactive output mode
```

**解決策**: `-o json` または `-o text` オプションを使用

```bash
render services -o json
```

### APIキーの期限切れ

```bash
# 再ログイン
render login
```

### デプロイが反映されない

環境変数を変更しても自動デプロイされません。手動でデプロイをトリガーしてください。

```bash
curl -s -X POST "https://api.render.com/v1/services/$SERVICE_ID/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## 参考リンク

- [Render CLI ドキュメント](https://render.com/docs/cli)
- [Render API リファレンス](https://api-docs.render.com/reference/introduction)
- [環境変数の更新API](https://api-docs.render.com/reference/update-env-vars-for-service)


