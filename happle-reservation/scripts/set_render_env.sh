#!/bin/bash

# Render環境変数設定スクリプト
# 使用方法: ./set_render_env.sh
#
# 事前準備:
# 1. Render APIキーを取得: https://dashboard.render.com/u/account#api-keys
# 2. RENDER_API_KEY 環境変数を設定
# 3. サービスIDを確認（ダッシュボードのURLから: /web/srv-xxxxx）

set -e

# 色付き出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== Render環境変数設定スクリプト ===${NC}"

# APIキーの確認
if [ -z "$RENDER_API_KEY" ]; then
    echo -e "${RED}エラー: RENDER_API_KEY 環境変数が設定されていません${NC}"
    echo "Render ダッシュボードでAPIキーを作成してください: https://dashboard.render.com/u/account#api-keys"
    echo "export RENDER_API_KEY='rnd_xxxxx'"
    exit 1
fi

# terraformディレクトリのパス
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TFSTATE_PATH="$SCRIPT_DIR/../terraform/terraform.tfstate"

# terraform.tfstateからSES設定を読み込む
echo -e "${YELLOW}terraform.tfstateからSES設定を読み込み中...${NC}"

if [ ! -f "$TFSTATE_PATH" ]; then
    echo -e "${RED}エラー: terraform.tfstateが見つかりません: $TFSTATE_PATH${NC}"
    exit 1
fi

# jqがインストールされているか確認
if ! command -v jq &> /dev/null; then
    echo -e "${RED}エラー: jqがインストールされていません${NC}"
    echo "brew install jq"
    exit 1
fi

# SES設定を読み込む
SES_ACCESS_KEY_ID=$(jq -r '.outputs.ses_smtp_user_access_key.value // empty' "$TFSTATE_PATH")
SES_SECRET_ACCESS_KEY=$(jq -r '.resources[] | select(.type == "aws_iam_access_key" and .name == "ses_user_key") | .instances[0].attributes.secret // empty' "$TFSTATE_PATH")

if [ -z "$SES_ACCESS_KEY_ID" ] || [ -z "$SES_SECRET_ACCESS_KEY" ]; then
    echo -e "${RED}エラー: SES設定の読み込みに失敗しました${NC}"
    exit 1
fi

echo -e "${GREEN}SES設定を読み込みました${NC}"
echo "  Access Key ID: ${SES_ACCESS_KEY_ID:0:10}..."

# Slack Webhook URLの入力
if [ -z "$SLACK_WEBHOOK_URL" ]; then
    echo ""
    echo -e "${YELLOW}Slack Webhook URLを入力してください（空欄でスキップ）:${NC}"
    read -r SLACK_WEBHOOK_URL
fi

# サービス一覧を取得
echo ""
echo -e "${YELLOW}Renderサービス一覧を取得中...${NC}"

SERVICES=$(curl -s -X GET \
    "https://api.render.com/v1/services?limit=50" \
    -H "Authorization: Bearer $RENDER_API_KEY" \
    -H "Accept: application/json")

# サービス一覧を表示
echo ""
echo "利用可能なサービス:"
echo "$SERVICES" | jq -r '.[] | "  \(.service.id): \(.service.name) (\(.service.type))"'

# バックエンドサービスIDを検索
BACKEND_SERVICE_ID=$(echo "$SERVICES" | jq -r '.[] | select(.service.name == "happle-reservation-backend") | .service.id')

if [ -z "$BACKEND_SERVICE_ID" ]; then
    echo ""
    echo -e "${YELLOW}バックエンドサービスIDを入力してください (例: srv-xxxxx):${NC}"
    read -r BACKEND_SERVICE_ID
fi

echo ""
echo -e "${GREEN}バックエンドサービスID: $BACKEND_SERVICE_ID${NC}"

# 現在の環境変数を取得
echo ""
echo -e "${YELLOW}現在の環境変数を取得中...${NC}"

CURRENT_ENV=$(curl -s -X GET \
    "https://api.render.com/v1/services/$BACKEND_SERVICE_ID/env-vars" \
    -H "Authorization: Bearer $RENDER_API_KEY" \
    -H "Accept: application/json")

echo "現在の環境変数:"
echo "$CURRENT_ENV" | jq -r '.[] | "  \(.envVar.key): \(.envVar.value // "[secret]")"'

# 新しい環境変数を構築
echo ""
echo -e "${YELLOW}環境変数を更新中...${NC}"

# 既存の環境変数をベースに新しい変数を追加
NEW_ENV=$(echo "$CURRENT_ENV" | jq '[.[] | {key: .envVar.key, value: .envVar.value}]')

# SES関連の環境変数を追加/更新
add_or_update_env() {
    local key="$1"
    local value="$2"
    NEW_ENV=$(echo "$NEW_ENV" | jq --arg key "$key" --arg value "$value" '
        if any(.[]; .key == $key) then
            map(if .key == $key then .value = $value else . end)
        else
            . + [{key: $key, value: $value}]
        end
    ')
}

add_or_update_env "SES_ACCESS_KEY_ID" "$SES_ACCESS_KEY_ID"
add_or_update_env "SES_SECRET_ACCESS_KEY" "$SES_SECRET_ACCESS_KEY"
add_or_update_env "SES_REGION" "ap-northeast-1"
add_or_update_env "SES_DOMAIN" "reserve-now.jp"
add_or_update_env "SES_FROM_EMAIL" "noreply@reserve-now.jp"

if [ -n "$SLACK_WEBHOOK_URL" ]; then
    add_or_update_env "SLACK_WEBHOOK_URL" "$SLACK_WEBHOOK_URL"
fi

echo "設定する環境変数:"
echo "$NEW_ENV" | jq -r '.[] | "  \(.key): \(.value | if length > 30 then .[0:30] + "..." else . end)"'

# 確認
echo ""
echo -e "${YELLOW}上記の環境変数を設定しますか？ (y/n)${NC}"
read -r CONFIRM

if [ "$CONFIRM" != "y" ]; then
    echo "キャンセルしました"
    exit 0
fi

# 環境変数を更新
RESPONSE=$(curl -s -X PUT \
    "https://api.render.com/v1/services/$BACKEND_SERVICE_ID/env-vars" \
    -H "Authorization: Bearer $RENDER_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$NEW_ENV")

echo ""
echo -e "${GREEN}環境変数を更新しました${NC}"
echo "$RESPONSE" | jq -r '.[] | "  \(.envVar.key): 設定完了"'

# デプロイの確認
echo ""
echo -e "${YELLOW}変更を反映するためにデプロイしますか？ (y/n)${NC}"
read -r DEPLOY_CONFIRM

if [ "$DEPLOY_CONFIRM" = "y" ]; then
    echo "デプロイを開始中..."
    DEPLOY_RESPONSE=$(curl -s -X POST \
        "https://api.render.com/v1/services/$BACKEND_SERVICE_ID/deploys" \
        -H "Authorization: Bearer $RENDER_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{}')
    
    DEPLOY_ID=$(echo "$DEPLOY_RESPONSE" | jq -r '.id')
    echo -e "${GREEN}デプロイを開始しました: $DEPLOY_ID${NC}"
    echo "Renderダッシュボードでデプロイ状況を確認してください"
else
    echo -e "${YELLOW}注意: 環境変数の変更は手動でデプロイするまで反映されません${NC}"
fi

echo ""
echo -e "${GREEN}完了しました${NC}"














