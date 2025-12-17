# Happle Reservation System

hacomono APIを使用した黄土韓方よもぎ蒸し Happleのオンライン予約システム

## アーキテクチャ

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Frontend     │────▶│     Backend     │────▶│  hacomono API   │
│    (Next.js)    │     │     (Flask)     │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## ディレクトリ構成

```
happle-reservation/
├── backend/              # Flask API
│   ├── app.py            # メインアプリケーション
│   ├── hacomono_client.py # hacomono API クライアント
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/             # Next.js フロントエンド
│   ├── src/
│   │   ├── app/          # App Router ページ
│   │   ├── components/   # React コンポーネント
│   │   └── lib/          # ユーティリティ
│   ├── package.json
│   └── Dockerfile
├── render.yaml           # Render Blueprint
└── README.md
```

## ローカル開発

### 前提条件

- Python 3.11+
- Node.js 20+
- hacomono API アクセストークン

### Backend セットアップ

```bash
cd backend

# 仮想環境作成
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 依存関係インストール
pip install -r requirements.txt

# 環境変数設定
cp ../.env.example .env
# .env を編集してトークンを設定

# 起動
python app.py
```

### Frontend セットアップ

```bash
cd frontend

# 依存関係インストール
npm install

# 環境変数設定
echo "NEXT_PUBLIC_API_URL=http://localhost:5000" > .env.local

# 開発サーバー起動
npm run dev
```

## Renderへのデプロイ

### 1. 環境変数の設定

Render Dashboard で以下の環境変数を設定:

**Backend:**
- `HACOMONO_ACCESS_TOKEN`: hacomono APIアクセストークン
- `HACOMONO_REFRESH_TOKEN`: hacomono APIリフレッシュトークン
- `HACOMONO_CLIENT_ID`: OAuth クライアントID
- `HACOMONO_CLIENT_SECRET`: OAuth クライアントシークレット

**Frontend:**
- `NEXT_PUBLIC_API_URL`: Backend URL (例: https://happle-reservation-backend.onrender.com)

### 2. Blueprint デプロイ

```bash
# Render Dashboard から render.yaml をインポート
# または Render CLI を使用
render blueprint apply
```

## API エンドポイント

### 店舗

- `GET /api/studios` - 店舗一覧
- `GET /api/studios/:id` - 店舗詳細

### プログラム

- `GET /api/programs` - プログラム一覧
- `GET /api/programs/:id` - プログラム詳細

### スケジュール

- `GET /api/schedule` - レッスンスケジュール
  - `studio_id`: 店舗ID (optional)
  - `program_id`: プログラムID (optional)
  - `start_date`: 開始日 (YYYY-MM-DD)
  - `end_date`: 終了日 (YYYY-MM-DD)

### 予約

- `POST /api/reservations` - 予約作成
- `GET /api/reservations/:id` - 予約詳細
- `POST /api/reservations/:id/cancel` - 予約キャンセル

## ライセンス

Private - All rights reserved



