# 予約制約の仕様

## 概要

予約の空き状況判定は2箇所で行われます：
1. **予約選択画面（フロントエンド）**: カレンダー表示時の○×判定
2. **予約実行時（バックエンド）**: 実際に予約を作成する時のスタッフ選択

## 制約チェックの比較

### スタッフに関する制約

| 制約項目 | 予約選択画面（FE） | 予約実行時（BE） | 一致 |
|---------|-------------------|-----------------|------|
| 営業時間内か | ✅ | ❌（APIに任せる） | ⚠️ |
| スタッフのシフト時間内か | ✅ | ✅ | ✅ |
| スタッフがスタジオに紐付けられているか | ✅ | ✅ | ✅ |
| プログラムの選択可能スタッフか | ✅ | ✅ | ✅ |
| 既存予約と重複しないか（インターバル考慮） | ✅ | ✅ | ✅ |
| コースがシフト時間内に収まるか | ✅ | ✅ | ✅ |
| 予定ブロック（休憩ブロック）と重複しないか | ✅ | ✅ | ✅ |

### 設備（リソース）に関する制約

| 制約項目 | 予約選択画面（FE） | 予約実行時（BE） | 一致 |
|---------|-------------------|-----------------|------|
| プログラムの選択可能設備か | ✅ | ✅ | ✅ |
| 設備の既存予約と重複しないか | ✅ | ✅ | ✅ |
| 設備の予定ブロックと重複しないか | ✅ | ✅ | ✅ |

> **Note**: 設備の制約チェックが必要なのは `selectable_resource_details.type` が `SELECTED`, `FIXED`, `RANDOM_SELECTED` の場合のみです。`ALL`, `RANDOM_ALL` の場合は設備チェックをスキップします。

### ⚠️ 差異がある項目

#### 1. 営業時間チェック

フロントエンドは営業時間をチェックしますが、バックエンドは hacomono API に任せています。
これは問題ありません（hacomono API が最終的にバリデーションする）。

---

## 取得している情報

### フロントエンド（予約選択画面）

**API: `/api/choice-schedule-range`**

取得データ:
```typescript
{
  studio_room_service: {
    studio_id: number,
    schedule_nick: number  // 予約間隔（分）
  },
  shift_studio_business_hour: [{
    date: string,
    start_at: string,
    end_at: string,
    is_holiday: boolean
  }],
  shift_instructor: [{
    instructor_id: number,
    start_at: string,
    end_at: string
  }],
  reservation_assign_instructor: [{
    entity_id: number,        // instructor_id
    start_at: string,
    end_at: string,
    reservation_type?: string // CHOICE, FIXED_SLOT_LESSON, SHIFT_SLOT
  }],
  instructor_studio_map: {
    [instructor_id: string]: number[]  // スタッフが紐付けられているスタジオID一覧
  },
  shift_slots: [{             // 予定ブロック（休憩ブロック）
    entity_type: 'INSTRUCTOR' | 'RESOURCE',
    entity_id: number,
    start_at: string,
    end_at: string,
    title?: string,
    description?: string
  }],
  reservation_assign_resource: [{  // 設備の予約情報
    entity_id: number,        // resource_id
    start_at: string,
    end_at: string,
    reservation_type?: string // CHOICE, SHIFT_SLOT
  }]
}
```

**プログラム情報（事前に取得）:**
```typescript
{
  selectable_instructor_details: [{
    type: 'ALL' | 'SELECTED' | 'FIXED' | 'RANDOM_ALL' | 'RANDOM_SELECTED',
    items: [{
      instructor_id: number,
      instructor_name: string,
      ...
    }]
  }],
  selectable_resource_details: [{    // 選択可能設備詳細
    type: 'ALL' | 'SELECTED' | 'FIXED' | 'RANDOM_ALL' | 'RANDOM_SELECTED',
    items: [{
      resource_id: number,
      resource_code?: string,
      resource_name?: string
    }]
  }],
  service_minutes: number,           // コースの所要時間
  before_interval_minutes: number,   // 開始前ブロック時間
  after_interval_minutes: number,    // 終了後ブロック時間
  reservable_to_minutes: number      // 予約締切（開始X分前まで）
}
```

### バックエンド（予約実行時）

**API呼び出し:**
1. `client.get_program(program_id)` - プログラム情報
2. `client.get_choice_schedule(studio_room_id, date_str)` - スケジュール情報
3. `get_cached_instructor_studio_map(client)` - スタッフ×スタジオ紐付け情報
4. `client.get_shift_slots(query)` - 予定ブロック（休憩ブロック）情報

---

## 制約チェックの詳細フロー

### 予約選択画面（フロントエンド）

```
1. 営業時間チェック
   └─ shift_studio_business_hour から is_holiday = false の日を取得
   └─ その日の start_at 〜 end_at 内かチェック

2. 各スタッフについてループ
   │
   ├─ シフト時間チェック
   │   └─ shift_instructor の start_at 〜 end_at 内にコースが収まるか
   │
   ├─ スタジオ紐付けチェック
   │   └─ instructor_studio_map[instructor_id] に studio_id が含まれるか
   │   └─ 空配列の場合は「全店舗対応可能」として許可
   │
   ├─ プログラム選択可能スタッフチェック
   │   └─ selectable_instructor_details.type が ALL/RANDOM_ALL → 全員OK
   │   └─ SELECTED/FIXED/RANDOM_SELECTED → items の instructor_id にいるか
   │
   ├─ 予約済みチェック（インターバル考慮）
   │   └─ reservation_assign_instructor の各予約について
   │   └─ [予約開始 - before_interval] 〜 [予約終了 + after_interval] と重複するか
   │
   └─ 予定ブロック（休憩ブロック）チェック
       └─ reservation_type が SHIFT_SLOT の場合はインターバルなしでブロック

3. 1人でも空いているスタッフがいれば設備チェックへ

4. 設備チェック（プログラムが設備を必要とする場合のみ）
   │
   ├─ 選択可能設備IDを取得
   │   └─ selectable_resource_details.type が ALL/RANDOM_ALL → チェック不要
   │   └─ SELECTED/FIXED/RANDOM_SELECTED → items の resource_id を取得
   │
   ├─ 各設備についてループ
   │   └─ reservation_assign_resource と重複するか
   │   └─ 設備の予定ブロック（SHIFT_SLOT）と重複するか
   │
   └─ 1つでも空いている設備があれば「予約可能」
```

### 予約実行時（バックエンド）

```
1. プログラム情報を取得
   └─ selectable_instructor_details から選択可能スタッフIDを抽出

2. スケジュール情報を取得
   └─ choice/schedule API からシフト情報・予約情報を取得

3. スタッフ×スタジオ紐付け情報を取得
   └─ キャッシュから取得（5分間キャッシュ）

4. 各スタッフについてループ
   │
   ├─ プログラム選択可能スタッフチェック
   │   └─ selectable_instructor_ids に含まれるか（None なら全員OK）
   │
   ├─ スタジオ紐付けチェック
   │   └─ instructor_studio_ids に studio_id が含まれるか
   │   └─ 空配列の場合は「全店舗対応可能」として許可
   │
   ├─ シフト時間チェック
   │   └─ instructor_start <= start_datetime < instructor_end
   │
   ├─ 予約済みチェック（インターバル考慮）
   │   └─ 予約と重複するかチェック
   │   └─ インターバルを考慮
   │
   └─ 予定ブロック（休憩ブロック）チェック
       └─ shift_slots APIで取得したブロックと重複するか
       └─ reservation_type が SHIFT_SLOT の場合はインターバルなしでブロック

5. 空いているスタッフの最初の1名を使用

6. 設備チェック（プログラムが設備を必要とする場合のみ）
   │
   ├─ selectable_resource_details から選択可能設備IDを取得
   │   └─ type が ALL/RANDOM_ALL → チェック不要
   │   └─ SELECTED/FIXED/RANDOM_SELECTED → items の resource_id を取得
   │
   ├─ reservation_assign_resource（既存予約）を取得
   │
   ├─ 設備の予定ブロック（shift_slots で entity_type: RESOURCE）を取得
   │
   ├─ 各設備についてループ
   │   └─ 既存予約と重複するか
   │   └─ 予定ブロックと重複するか
   │
   └─ 空いている設備の最初の1つを使用（resource_id_set パラメータに設定）
```

---

## selectable_instructor_details の仕様

hacomono API から取得できるプログラムの選択可能スタッフ設定:

```json
{
  "selectable_instructor_details": [
    {
      "type": "SELECTED",
      "is_selectable": true,
      "terms": [],
      "items": [
        {
          "instructor_id": 123,
          "instructor_code": "INS001",
          "instructor_name": "田中太郎",
          "instructor_thumbnail_code": "thumb_123",
          "priority": 1
        }
      ]
    }
  ]
}
```

### type の意味

| type | 説明 | items の扱い |
|------|------|-------------|
| `ALL` | 全スタッフから選択可能 | 無視 |
| `SELECTED` | 選択候補を指定 | items のスタッフのみ |
| `FIXED` | 固定スタッフ | items のスタッフに固定 |
| `RANDOM_ALL` | 全スタッフから1名を自動選択 | 無視 |
| `RANDOM_SELECTED` | 選択候補から1名を自動選択 | items のスタッフから選択 |

---

## 予定ブロック（休憩ブロック）の仕様

hacomono API `/reservation/shift_slots` から取得できるスタッフの手動ブロック時間:

```json
{
  "shift_slots": {
    "list": [
      {
        "id": 1234,
        "shift_id": 567,
        "studio_id": 1,
        "entity_type": "INSTRUCTOR",
        "entity_id": 123,
        "entity_code": "INS001",
        "entity_name": "田中太郎",
        "date": "2025-12-23",
        "start_at": "2025-12-23T12:00:00+09:00",
        "end_at": "2025-12-23T13:00:00+09:00",
        "title": "休憩",
        "description": ""
      }
    ]
  }
}
```

### entity_type の意味

| entity_type | 説明 |
|-------------|------|
| `INSTRUCTOR` | スタッフの予定ブロック |
| `RESOURCE` | 設備の予定ブロック |

### 予定ブロックの扱い

- **フロントエンド**: `reservation_assign_instructor` に `reservation_type: "SHIFT_SLOT"` として統合
- **バックエンド**: 予約作成時に `shift_slots` を別途取得してチェック
- **インターバル**: 予定ブロックはインターバルを考慮せず、そのままブロック

---

## selectable_resource_details の仕様

プログラムに紐づく設備（リソース）の設定。スタッフと同様の構造:

```json
{
  "selectable_resource_details": [
    {
      "type": "SELECTED",
      "items": [
        {
          "resource_id": 456,
          "resource_code": "RES001",
          "resource_name": "施術室A"
        }
      ]
    }
  ]
}
```

### type の意味（スタッフと同様）

| type | 説明 | items の扱い |
|------|------|-------------|
| `ALL` | 全設備から選択可能 | 無視 |
| `SELECTED` | 選択候補を指定 | items の設備のみ |
| `FIXED` | 固定設備 | items の設備に固定 |
| `RANDOM_ALL` | 全設備から1つを自動選択 | 無視 |
| `RANDOM_SELECTED` | 選択候補から1つを自動選択 | items の設備から選択 |

### 設備の予定ブロック

設備にも予定ブロック（休憩ブロック）を設定可能です。`shift_slots` APIで `entity_type: "RESOURCE"` として取得されます。

```json
{
  "entity_type": "RESOURCE",
  "entity_id": 456,
  "entity_name": "施術室A",
  "start_at": "2025-12-23T12:00:00+09:00",
  "end_at": "2025-12-23T13:00:00+09:00",
  "title": "メンテナンス"
}
```

---

## 現在の実装状況

### ✅ 実装済み

| 機能 | 説明 |
|------|------|
| スタッフのシフト時間チェック | `shift_instructor` を使用 |
| スタッフのスタジオ紐付けチェック | `instructor_studio_map` を使用 |
| プログラムの選択可能スタッフチェック | `selectable_instructor_details` を使用 |
| 既存予約の重複チェック（インターバル考慮） | `reservation_assign_instructor` を使用 |
| 予定ブロック（休憩）チェック | `shift_slots` API を使用 |
| 固定枠レッスンのブロック | `studio_lessons` API を使用 |
| 設備の空き状況チェック | `reservation_assign_resource` を使用 |
| 設備の選択可能チェック | `selectable_resource_details` を使用 |
| 設備の予定ブロックチェック | `shift_slots`（`entity_type: RESOURCE`）を使用 |

### 設備制約の動作

1. **フロントエンド**:
   - プログラムの `selectable_resource_details.type` が `SELECTED`, `FIXED`, `RANDOM_SELECTED` の場合のみ設備チェックを実行
   - `reservation_assign_resource` で既存予約との重複を確認
   - スタッフが空いていても設備が全てブロックされていれば「×（設備使用中）」と表示

2. **バックエンド**:
   - 予約作成時に設備の空き状況をチェック
   - 空いている設備があれば `resource_id_set` パラメータに設定して予約
   - 設備がない場合はエラー「この時間帯に利用可能な設備がありません」を返す

