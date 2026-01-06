#!/bin/bash
# ============================================
# hacomono Webhook Secret 設定スクリプト
# ============================================
# 
# 使用方法:
#   1. Render API Keyを取得: https://dashboard.render.com/u/account#api-keys
#   2. export RENDER_API_KEY='rnd_xxxxx'
#   3. ./set_webhook_secret.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SERVICE_ID="srv-d4tpkhumcj7s7384p62g"  # happle-reservation-backend
WEBHOOK_SECRET="EX9duM782dv8oKDXV6ik1bOUoIZkW8hX"

echo -e "${YELLOW}=== hacomono Webhook Secret 設定 ===${NC}"

# APIキーの確認
if [ -z "$RENDER_API_KEY" ]; then
    echo -e "${RED}エラー: RENDER_API_KEY 環境変数が設定されていません${NC}"
    echo ""
    echo "以下の手順で設定してください:"
    echo "1. https://dashboard.render.com/u/account#api-keys でAPIキーを作成"
    echo "2. export RENDER_API_KEY='rnd_xxxxx'"
    echo "3. このスクリプトを再実行"
    echo ""
    echo "または、Renderダッシュボードから直接設定:"
    echo "https://dashboard.render.com/web/$SERVICE_ID/env"
    echo ""
    echo "追加する環境変数:"
    echo "  HACOMONO_WEBHOOK_SECRET = $WEBHOOK_SECRET"
    exit 1
fi

echo -e "${GREEN}API Key: ${RENDER_API_KEY:0:10}...${NC}"
echo "Service ID: $SERVICE_ID"

# 環境変数を追加
echo ""
echo -e "${YELLOW}環境変数を追加中...${NC}"

RESPONSE=$(curl -s -X POST \
    "https://api.render.com/v1/services/$SERVICE_ID/env-vars" \
    -H "Authorization: Bearer $RENDER_API_KEY" \
    -H "Content-Type: application/json" \
    -d "[{\"key\": \"HACOMONO_WEBHOOK_SECRET\", \"value\": \"$WEBHOOK_SECRET\"}]")

echo "$RESPONSE" | jq .

# デプロイをトリガー
echo ""
echo -e "${YELLOW}デプロイをトリガーしますか？ (y/n)${NC}"
read -r CONFIRM

if [ "$CONFIRM" = "y" ]; then
    echo "デプロイを開始中..."
    DEPLOY_RESPONSE=$(curl -s -X POST \
        "https://api.render.com/v1/services/$SERVICE_ID/deploys" \
        -H "Authorization: Bearer $RENDER_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{}')
    
    echo "$DEPLOY_RESPONSE" | jq .
    echo -e "${GREEN}デプロイを開始しました${NC}"
fi

echo ""
echo -e "${GREEN}完了！${NC}"








