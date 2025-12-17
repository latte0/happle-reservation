# GTM計測機能 設計ガイド

## ファネル分析対応イベント一覧

| ステップ | イベント名 | タイミング | 主なデータ |
|----------|-----------|-----------|-----------|
| 1. 訪問 | (自動) page_view | ページ表示時 | URL |
| 2. メニュー選択 | `menu_select` | メニュークリック時 | program_id, program_name |
| 3. 日時選択 | `slot_select` | 時間枠クリック時 | slot_date, slot_time |
| 4. 情報入力開始 | `form_start` | 入力画面表示時 | program_id, slot_date |
| 5. 情報入力完了 | `form_submit` | 確認ボタンクリック時 | program_id, slot_date |
| 6. 予約完了 | `reservation_complete` | 予約完了時 | reservation_id, 全情報 |

### ファネル分析例（GA4）

```
訪問: 1000人 (100%)
  ↓
メニュー選択: 600人 (60%) ← 40%離脱
  ↓
日時選択: 400人 (40%) ← 20%離脱
  ↓
情報入力開始: 350人 (35%) ← 5%離脱
  ↓
情報入力完了: 300人 (30%) ← 5%離脱
  ↓
予約完了: 200人 (20%) ← 10%離脱
```

---

## 元の要望と実装状況

### 要望1: GTMタグを全ページに設置（後から一括反映）

| 項目 | 内容 |
|------|------|
| **要望** | URL発行してからタグ発行のため、後から一括反映できる仕様 |
| **実装** | ✅ 環境変数 `NEXT_PUBLIC_GTM_ID` で一括管理 |
| **変更方法** | Render管理画面で環境変数を変更 → 再デプロイで全ページに反映 |

```
# 設定例
NEXT_PUBLIC_GTM_ID=GTM-XXXXXXX
```

---

### 要望2: URLに店舗固有文字列を含める

| 項目 | 内容 |
|------|------|
| **要望** | 各URLのディレクトリに店舗単位で固有文字列が入るようにしたい |
| **実装** | ✅ URLパラメータで店舗・メニューを指定可能 |
| **管理画面** | `/admin/link-generator` でリンク生成 |

#### 対応パラメータ

| パラメータ | 説明 | 例 |
|-----------|------|-----|
| `studio_id` | 店舗ID（数値） | `2` |
| `studio_code` | 店舗コード（文字列） | `asmy_kumamoto` |
| `program_id` | メニューID | `3` |
| `utm_source` | 流入元 | `google` |
| `utm_medium` | メディア | `cpc` |
| `utm_campaign` | キャンペーン | `summer_sale` |

#### URL例

```
https://happle-reservation-frontend.onrender.com/?studio_id=2&studio_code=asmy_kumamoto&program_id=3&utm_source=google&utm_medium=cpc&utm_campaign=summer_sale
```

---

### 要望3: サンクスページに予約情報を反映

| 項目 | 内容 |
|------|------|
| **要望** | サンクスページに店舗ID、予約メニュー、その他予約情報をIDとして反映 |
| **実装** | ✅ `reservation_complete` イベントで全情報をDataLayerに送信 |

#### 送信されるデータ

```javascript
dataLayer.push({
  event: 'reservation_complete',
  
  // 予約情報
  reservation_id: '1234',
  reservation_date: '2025-12-30',
  reservation_time: '15:15',
  duration: '90',
  price: '2980',
  
  // 店舗情報
  studio_id: '2',
  studio_code: 'asmy_kumamoto',
  studio_name: 'ASMY熊本店',
  
  // メニュー情報
  program_id: '3',
  program_name: '【初回】骨膜リリースエステ',
  
  // 顧客情報
  customer_name: 'テスト',
  customer_email: 'test@example.com',
  
  // UTMパラメータ
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'summer_sale'
});
```

---

## GTM管理画面での活用方法

### 可能になること

#### 1. 店舗別のコンバージョン計測

```
トリガー条件:
  event = reservation_complete
  AND studio_id = 2

→ ASMY熊本店の予約完了のみタグ発火
```

#### 2. メニュー別のコンバージョン計測

```
トリガー条件:
  event = reservation_complete
  AND program_id = 3

→ 特定メニューの予約完了のみタグ発火
```

#### 3. 広告媒体別の計測

```
トリガー条件:
  event = reservation_complete
  AND utm_source = google

→ Google広告経由の予約のみタグ発火
```

#### 4. キャンペーン別の計測

```
トリガー条件:
  event = reservation_complete
  AND utm_campaign = summer_sale

→ 夏のセールキャンペーン経由の予約のみタグ発火
```

#### 5. 複合条件での計測

```
トリガー条件:
  event = reservation_complete
  AND studio_id = 2
  AND utm_source = google
  AND utm_campaign = summer_sale

→ 熊本店 × Google広告 × 夏セール の予約のみタグ発火
```

---

## 具体的な運用フロー

### Step 1: 広告用リンクの生成

1. `/admin/link-generator` にアクセス
2. 店舗・メニュー・UTMパラメータを設定
3. 「リンクを生成」をクリック
4. 生成されたURLを広告に設定

### Step 2: GTMでタグを設定

1. GTM管理画面でタグを作成（Google広告コンバージョン等）
2. トリガーを作成
   - イベント名: `reservation_complete`
   - 条件: 必要に応じて `studio_id`, `utm_source` 等で絞り込み
3. 公開

### Step 3: 計測開始

- ユーザーが広告リンクから予約完了
- DataLayerに全情報が送信
- GTMが条件に合致するタグのみ発火
- 各広告プラットフォームでコンバージョン計測

---

## 変数の設定（GTM側）

DataLayerの値を使用するには、GTMで変数を作成します。

| 変数名 | 変数タイプ | データレイヤー変数名 |
|--------|-----------|---------------------|
| dlv - reservation_id | データレイヤー変数 | reservation_id |
| dlv - studio_id | データレイヤー変数 | studio_id |
| dlv - studio_code | データレイヤー変数 | studio_code |
| dlv - program_id | データレイヤー変数 | program_id |
| dlv - price | データレイヤー変数 | price |
| dlv - utm_source | データレイヤー変数 | utm_source |

---

## URL一覧

| ページ | URL |
|--------|-----|
| トップ | https://happle-reservation-frontend.onrender.com/ |
| 自由枠予約 | https://happle-reservation-frontend.onrender.com/free-schedule |
| リンク生成（管理画面） | https://happle-reservation-frontend.onrender.com/admin/link-generator |
| 予約確認 | https://happle-reservation-frontend.onrender.com/reservation-detail?reservation_id=XXX |

### 広告リンク生成例

管理画面で生成されるリンクは自由枠予約画面へ直接遷移します：

```
https://happle-reservation-frontend.onrender.com/free-schedule?studio_id=2&studio_code=asmy_kumamoto&program_id=3&utm_source=google&utm_medium=cpc&utm_campaign=summer_sale
```

このリンクにアクセスすると：
- 店舗が自動選択される
- メニューが自動選択される
- UTMパラメータが予約完了まで引き継がれる

---

## イベント詳細

### menu_select（メニュー選択）

```javascript
{
  event: 'menu_select',
  program_id: 3,
  program_name: '【初回】骨膜リリースエステ',
  studio_id: 2,
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'summer_sale'
}
```

### slot_select（日時選択）

```javascript
{
  event: 'slot_select',
  slot_id: 123,                    // 固定枠の場合
  reservation_type: 'free',       // 自由枠の場合
  program_id: 3,
  program_name: '【初回】骨膜リリースエステ',
  studio_id: 2,
  slot_date: '2025-12-30',
  slot_time: '15:15',
  available_count: 5              // 固定枠の場合
}
```

### form_start（フォーム表示）

```javascript
{
  event: 'form_start',
  slot_id: 123,                    // 固定枠の場合
  studio_room_id: 456,            // 自由枠の場合
  program_id: 3,
  program_name: '【初回】骨膜リリースエステ',
  studio_id: 2,
  slot_date: '2025-12-30',
  slot_time: '15:15'
}
```

### form_submit（フォーム送信）

```javascript
{
  event: 'form_submit',
  slot_id: 123,
  program_id: 3,
  program_name: '【初回】骨膜リリースエステ',
  studio_id: 2
}
```

### reservation_complete（予約完了）

```javascript
{
  event: 'reservation_complete',
  reservation_id: '1234',
  studio_id: '2',
  studio_code: 'asmy_kumamoto',
  studio_name: 'ASMY熊本店',
  program_id: '3',
  program_name: '【初回】骨膜リリースエステ',
  reservation_date: '2025-12-30',
  reservation_time: '15:15',
  duration: '90',
  price: '2980',
  customer_name: 'テスト',
  customer_email: 'test@example.com',
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'summer_sale'
}
```

---

## まとめ

| 要望 | 実現方法 | 状態 |
|------|---------|------|
| 全ページにGTMタグ | 環境変数で一括管理 | ✅ |
| URLに店舗固有文字列 | URLパラメータ（studio_code等） | ✅ |
| サンクスページに予約情報 | DataLayerに全情報送信 | ✅ |
| タグの出し分け | GTM管理画面で条件設定 | ✅ |
| 後から一括反映 | 環境変数変更で対応 | ✅ |

**結論**: GTM IDを発行・設定するだけで、店舗別・メニュー別・広告媒体別など、あらゆる条件でのコンバージョン計測が可能になります。

