# CORSエラー解消手順

## 問題

`https://reserve-now.jp` と `https://www.reserve-now.jp` でCORSエラーが発生している。

## 原因

バックエンドのCORS設定に本番ドメインが含まれていない。

## 解決方法

### 1. Renderの環境変数を更新

バックエンドサービスの `CORS_ORIGINS` 環境変数に本番ドメインを追加する必要があります。

#### Render CLIを使用する場合

```bash
# Render CLIでログイン
render login

# バックエンドサービスの環境変数を更新
render env:set CORS_ORIGINS "https://happle-reservation-frontend.onrender.com,https://reserve-now.jp,https://www.reserve-now.jp" --service happle-reservation-backend
```

#### Render APIを使用する場合

```bash
# 環境変数を設定
export RENDER_API_KEY="your_render_api_key"
export BACKEND_ID="srv-d4tpkhumcj7s7384p62g"

# 現在の環境変数を取得
CURRENT_ENV=$(curl -s "https://api.render.com/v1/services/$BACKEND_ID/env-vars" \
  -H "Authorization: Bearer $RENDER_API_KEY" | jq -r '.[] | select(.key == "CORS_ORIGINS") | .value')

# 新しいCORS設定（既存の値に本番ドメインを追加）
NEW_CORS="https://happle-reservation-frontend.onrender.com,https://reserve-now.jp,https://www.reserve-now.jp"

# 環境変数を更新
curl -s -X PUT "https://api.render.com/v1/services/$BACKEND_ID/env-vars/CORS_ORIGINS" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"value\": \"$NEW_CORS\"}"

# デプロイをトリガー
curl -s -X POST "https://api.render.com/v1/services/$BACKEND_ID/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 2. 設定値の確認

更新後の `CORS_ORIGINS` は以下のようになります：

```
https://happle-reservation-frontend.onrender.com,https://reserve-now.jp,https://www.reserve-now.jp
```

### 3. バックエンドの再デプロイ

環境変数を更新した後、バックエンドサービスが自動的に再デプロイされます。数分待ってから確認してください。

### 4. 確認方法

ブラウザの開発者ツールで以下を確認：

1. NetworkタブでAPIリクエストを確認
2. レスポンスヘッダーに以下が含まれているか確認：
   - `Access-Control-Allow-Origin: https://reserve-now.jp` または `https://www.reserve-now.jp`
   - `Access-Control-Allow-Credentials: true`

## 注意事項

- CORS設定はカンマ区切りで複数のオリジンを指定できます
- プロトコル（`https://`）を含める必要があります
- 末尾のスラッシュは含めないでください（`https://reserve-now.jp/` は不可）
- ワイルドカード（`*`）は `supports_credentials=True` と同時に使用できません

## 参考

- [Flask-CORS Documentation](https://flask-cors.readthedocs.io/)
- [Render Environment Variables](https://render.com/docs/environment-variables)

















