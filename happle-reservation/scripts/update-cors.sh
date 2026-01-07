#!/bin/bash

# CORS設定を更新するスクリプト
# 使用方法: ./scripts/update-cors.sh

set -e

# Render APIキーを取得（~/.render/cli.yamlから）
RENDER_CONFIG_FILE="$HOME/.render/cli.yaml"
if [ ! -f "$RENDER_CONFIG_FILE" ]; then
  echo "Error: Render CLI設定ファイルが見つかりません: $RENDER_CONFIG_FILE"
  echo "まず 'render login' を実行してください"
  exit 1
fi

# YAMLファイルからAPIキーを抽出（簡単な方法）
API_KEY=$(grep -A 2 "api:" "$RENDER_CONFIG_FILE" | grep "key:" | awk '{print $2}' | tr -d '"' || echo "")

if [ -z "$API_KEY" ]; then
  echo "Error: Render APIキーが見つかりません"
  echo "まず 'render login' を実行してください"
  exit 1
fi

# バックエンドサービスのID
BACKEND_ID="srv-d4tpkhumcj7s7384p62g"

# 新しいCORS設定
NEW_CORS_ORIGINS="https://happle-reservation-frontend.onrender.com,https://reserve-now.jp,https://www.reserve-now.jp"

echo "CORS設定を更新しています..."
echo "新しい設定: $NEW_CORS_ORIGINS"

# 現在の環境変数を取得
CURRENT_ENV=$(curl -s "https://api.render.com/v1/services/$BACKEND_ID/env-vars" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json")

# CORS_ORIGINSが既に存在するか確認
CORS_EXISTS=$(echo "$CURRENT_ENV" | jq -r '.[] | select(.key == "CORS_ORIGINS") | .key' || echo "")

if [ -n "$CORS_EXISTS" ]; then
  # 既存の環境変数を更新
  echo "既存のCORS_ORIGINS環境変数を更新しています..."
  RESPONSE=$(curl -s -X PUT "https://api.render.com/v1/services/$BACKEND_ID/env-vars/CORS_ORIGINS" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"value\": \"$NEW_CORS_ORIGINS\"}")
else
  # 新しい環境変数を作成
  echo "新しいCORS_ORIGINS環境変数を作成しています..."
  RESPONSE=$(curl -s -X POST "https://api.render.com/v1/services/$BACKEND_ID/env-vars" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"key\": \"CORS_ORIGINS\", \"value\": \"$NEW_CORS_ORIGINS\"}")
fi

# レスポンスを確認
if echo "$RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  echo "Error: 環境変数の更新に失敗しました"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

echo "✓ CORS設定が更新されました"

# デプロイをトリガー
echo "デプロイをトリガーしています..."
DEPLOY_RESPONSE=$(curl -s -X POST "https://api.render.com/v1/services/$BACKEND_ID/deploys" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}')

if echo "$DEPLOY_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  echo "Warning: デプロイのトリガーに失敗しました（環境変数は更新されました）"
  echo "$DEPLOY_RESPONSE" | jq '.'
else
  echo "✓ デプロイがトリガーされました"
  DEPLOY_ID=$(echo "$DEPLOY_RESPONSE" | jq -r '.id')
  echo "デプロイID: $DEPLOY_ID"
  echo "デプロイ状況: https://dashboard.render.com/web/$BACKEND_ID/deploys/$DEPLOY_ID"
fi

echo ""
echo "完了しました。数分後にCORSエラーが解消されるはずです。"




















