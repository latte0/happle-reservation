# 予約制約の仕様

## 概要

予約の空き状況判定は2箇所で行われます：
1. **予約選択画面（フロントエンド）**: カレンダー表示時の○×判定
2. **予約実行時（バックエンド）**: 実際に予約を作成する時のスタッフ選択

## 制約チェックの比較

### 時間に関する制約

| 制約項目 | 予約選択画面（FE） | 予約実行時（BE） | 一致 |
|---------|-------------------|-----------------|------|
| 予約可能範囲（30分後以降） | ✅ | ✅ | ✅ |
| 予約可能範囲（14日後まで） | ✅ | ✅ | ✅ |
| 予約締切時間（開始X分前まで） | ✅ | ❌（APIに任せる） | ⚠️ |
| 営業時間内か | ✅ | ❌（APIに任せる） | ⚠️ |

### スタッフに関する制約

| 制約項目 | 予約選択画面（FE） | 予約実行時（BE） | 一致 |
|---------|-------------------|-----------------|------|
| スタッフのシフト時間内か | ✅ | ✅ | ✅ |
| スタッフがスタジオに紐付けられているか ※1 | ✅ | ✅ | ✅ |
| プログラムの選択可能スタッフか | ✅ | ✅ | ✅ |
| 既存予約と重複しないか（インターバル考慮） | ✅ | ✅ | ✅ |
| コースがシフト時間内に収まるか | ✅ | ✅ | ✅ |
| 予定ブロック（休憩ブロック）と重複しないか | ✅ | ✅ | ✅ |

> **※1 スタッフの店舗紐付け**: スタッフの `studio_ids` が空配列の場合は「全店舗対応可能」として扱います。特定の店舗に紐付けられている場合のみ、その店舗でのみ予約可能です。

### 設備（リソース）に関する制約

| 制約項目 | 予約選択画面（FE） | 予約実行時（BE） | 一致 |
|---------|-------------------|-----------------|------|
| プログラムの選択可能設備か | ✅ | ✅ | ✅ |
| 設備がその店舗に紐付けられているか ※2 | ✅ | ✅ | ✅ |
| 設備の同時予約可能数を超えていないか ※3 | ✅ | ✅ | ✅ |
| 設備の予定ブロックと重複しないか | ✅ | ✅ | ✅ |

> **※2 設備の店舗紐付け**: 設備は必ず1つの店舗に紐付けられます（`resource.studio_id`）。その店舗の設備のみが予約対象となります。
>
> **※3 同時予約可能数**: `resource.max_cc_reservable_num` で設定。同時間帯の予約数がこの値未満なら予約可能です。

### 制約チェックが不要な条件

| 条件 | 説明 |
|------|------|
| `selectable_resource_details.type` が `ALL` または `RANDOM_ALL` | 設備チェックをスキップ |
| `selectable_instructor_details.type` が `ALL` または `RANDOM_ALL` | 全スタッフから選択可能 |

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
0. 時間範囲チェック
   ├─ 30分後以降か → 「too_soon」
   ├─ 14日後以内か → 「too_far」
   └─ 予約締切時間（開始X分前）を過ぎていないか → 「deadline_passed」

1. 営業時間チェック
   └─ shift_studio_business_hour から is_holiday = false の日を取得
   └─ その日の start_at 〜 end_at 内にコースが収まるか → 「outside_hours」

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
   │   └─ 選択可能なスタッフがいない → 「no_selectable_staff」
   │
   ├─ 予約済みチェック（インターバル考慮）
   │   └─ reservation_assign_instructor の各予約について
   │   └─ [予約開始 - before_interval] 〜 [予約終了 + after_interval] と重複
   │   └─ 全員ブロック → 「interval_blocked」
   │
   └─ 予定ブロック（休憩ブロック）チェック
       └─ reservation_type が SHIFT_SLOT の場合はインターバルなしでブロック
       └─ 全員予約済み → 「fully_booked」

3. 1人でも空いているスタッフがいれば設備チェックへ

4. 設備チェック（プログラムが設備を必要とする場合のみ）
   │
   ├─ 選択可能設備IDを取得
   │   └─ selectable_resource_details.type が ALL/RANDOM_ALL → チェック不要
   │   └─ SELECTED/FIXED/RANDOM_SELECTED → items の resource_id を取得
   │
   ├─ 各設備についてループ
   │   ├─ 設備がこの店舗に紐づいているか（resources_info に存在するか）
   │   ├─ 予定ブロック（SHIFT_SLOT）で完全ブロックされているか
   │   ├─ 予約数が同時予約可能数（max_cc_reservable_num）未満か
   │   └─ 空きなし → 「no_available_resource」
   │
   └─ 1つでも空いている設備があれば「予約可能」（available）
```

### 予約実行時（バックエンド）

```
0. 予約日時チェック
   └─ 30分後以降 〜 14日後以内か → エラーコード「DATETIME_OUT_OF_RANGE」

1. プログラム情報を取得
   └─ selectable_instructor_details から選択可能スタッフIDを抽出
   └─ selectable_resource_details から選択可能設備IDを抽出

2. スケジュール情報を取得
   └─ choice/schedule API からシフト情報・予約情報を取得

3. スタッフ×スタジオ紐付け情報を取得
   └─ キャッシュから取得（60秒間キャッシュ）

4. 設備情報を取得
   └─ キャッシュから取得（店舗ごと、5分間キャッシュ）

5. 各スタッフについてループ
   │
   ├─ プログラム選択可能スタッフチェック
   │   └─ selectable_instructor_ids に含まれるか（None なら全員OK）
   │
   ├─ スタジオ紐付けチェック
   │   └─ instructor_studio_ids に studio_id が含まれるか
   │   └─ 空配列の場合は「全店舗対応可能」として許可
   │
   ├─ シフト時間チェック
   │   └─ instructor_start <= start_datetime かつ proposed_end <= instructor_end
   │
   ├─ 予約済みチェック（インターバル考慮）
   │   └─ 予約と重複するかチェック
   │   └─ インターバルを考慮（before_interval_minutes, after_interval_minutes）
   │
   └─ 予定ブロック（休憩ブロック）チェック
       └─ shift_slots APIで取得したブロックと重複するか
       └─ reservation_type が SHIFT_SLOT の場合はインターバルなしでブロック

6. 空いているスタッフの最初の1名を使用
   └─ いない場合 → エラーコード「NO_AVAILABLE_INSTRUCTOR」

7. 設備チェック（プログラムが設備を必要とする場合のみ）
   │
   ├─ 選択可能設備IDを取得
   │   └─ type が ALL/RANDOM_ALL → チェック不要
   │   └─ SELECTED/FIXED/RANDOM_SELECTED → items の resource_id を取得
   │
   ├─ 各設備についてループ
   │   ├─ 設備がこの店舗に紐づいているか（resources_info に存在するか）
   │   ├─ 予定ブロック（SHIFT_SLOT）で完全ブロックされているか
   │   └─ 予約数が同時予約可能数（max_cc_reservable_num）未満か
   │
   └─ 空いている設備の最初の1つを使用（resource_id_set パラメータに設定）
       └─ いない場合 → エラーコード「NO_AVAILABLE_RESOURCE」
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
      ],
      "terms": [
        {
          "start_minutes": 0,
          "end_minutes": 20
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

### terms（時間帯設定）

対象設備を割り当てる時間帯を個別に指定する設定です。例えば「前半20分・後半40分」のように分割できます。

```json
{
  "selectable_resource_details": [
    {
      "type": "SELECTED",
      "items": [{ "resource_id": 1, "resource_name": "設備A" }],
      "terms": [{ "start_minutes": 0, "end_minutes": 20 }]
    },
    {
      "type": "SELECTED",
      "items": [{ "resource_id": 2, "resource_name": "設備B" }],
      "terms": [{ "start_minutes": 20, "end_minutes": 60 }]
    }
  ]
}
```

上記の例では、60分コースで：
- 0〜20分: 設備A を使用
- 20〜60分: 設備B を使用

**予約可能判定のロジック**:
1. `selectable_resource_details` の各要素について
2. その要素の `terms` で指定された時間帯（start_minutes 〜 end_minutes）を計算
3. その時間帯で、その要素の `items` に含まれる設備のいずれかが空いているかチェック
4. 全ての要素/時間帯で空きがあれば予約可能

> **Note**: `terms` が未設定の場合は、コース全体（0 〜 service_minutes）として扱います。

### 設備の割り当てについて

設備の割り当て（resource_id_set）は **hacomono が自動で行います**。
フロントエンドやバックエンドで設備を指定する必要はありません。
terms の設定も hacomono が自動で考慮します。

### 設備のマスター情報（API: `/master/resources`）

設備には同時予約可能数などの設定があります:

```json
{
  "id": 456,
  "code": "RES001",
  "name": "施術室A",
  "studio_id": 1,
  "status": 1,
  "max_cc_reservable_num": 2,
  "max_reservable_num_at_day": 10
}
```

| フィールド | 説明 |
|-----------|------|
| `max_cc_reservable_num` | 同時予約可能数（同じ時間帯に受け入れ可能な予約数） |
| `max_reservable_num_at_day` | 1日当たりの予約上限数 |

### 設備の予定ブロック（API: `/reservation/shift_slots`）

設備にも予定ブロック（休憩ブロック）を設定可能です。`entity_type: "RESOURCE"` として取得されます:

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

> **Note**: `entity_type` は hacomono API ドキュメントで正式に定義されています:
> - `Enum: "INSTRUCTOR" "RESOURCE"`
> - `INSTRUCTOR`: スタッフ
> - `RESOURCE`: 設備

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

1. **フロントエンド（カレンダー表示時）**:
   - プログラムの `selectable_resource_details.type` が `SELECTED`, `FIXED`, `RANDOM_SELECTED` の場合のみ設備チェックを実行
   - **terms（時間帯設定）を考慮**して各時間帯で設備が空いているかチェック
   - `reservation_assign_resource` で既存予約との重複を確認
   - `resources_info.max_cc_reservable_num`（同時予約可能数）を考慮して空き判定
   - 設備がこの店舗に紐づいているかチェック（`resources_info` に存在するか）
   - 予定ブロック（SHIFT_SLOT）は完全ブロックとして扱う
   - スタッフが空いていても設備が全て満員なら「×（設備使用中）」と表示

2. **バックエンド（予約作成時）**:
   - **設備のチェックは行わない**（hacomono が自動で割り当てる）
   - terms（時間帯設定）も hacomono が自動で処理
   - `resource_id_set` パラメータは設定しない

---

## エラーコード一覧

### フロントエンド（カレンダー表示時）

| エラーコード | 表示 | 色 | 説明 |
|-------------|------|-----|------|
| `available` | ◎ | 緑 | 予約可能 |
| `holiday` | - | 薄グレー | 休業日 |
| `outside_hours` | - | グレー | 営業時間外（コースが収まらない） |
| `too_soon` | - | グレー | 予約開始前（30分後以降から予約可能） |
| `too_far` | - | グレー | 予約期限外（14日後まで） |
| `deadline_passed` | × | 黄 | 予約締切を過ぎている |
| `fully_booked` | × | 赤 | 満席（全スタッフ予約済み） |
| `interval_blocked` | × | 紫 | インターバルでブロック中 |
| `no_selectable_staff` | × | グレー | 選択可能なスタッフがいない |
| `no_available_resource` | × | オレンジ | 利用可能な設備がない |

### バックエンド（予約作成時）

| エラーコード | HTTPステータス | 説明 |
|-------------|---------------|------|
| `DATETIME_OUT_OF_RANGE` | 400 | 予約日時が有効範囲外 |
| `NO_AVAILABLE_INSTRUCTOR` | 400 | 対応可能なスタッフがいない |
| `INSTRUCTOR_FETCH_ERROR` | 400 | スタッフ情報の取得に失敗 |
| `CMN_000022` | 400 | メールアドレスが既に使用されている（hacomono API）|

> **Note**: 設備のエラー（`NO_AVAILABLE_RESOURCE`）はバックエンドでは返しません。
> 設備の割り当ては hacomono が自動で行うため、設備が足りない場合は hacomono API がエラーを返します。

