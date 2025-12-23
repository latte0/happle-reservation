# 予約制約の仕様

## 概要

予約の空き状況判定は2箇所で行われます：
1. **予約選択画面（フロントエンド）**: カレンダー表示時の○×判定
2. **予約実行時（バックエンド）**: 実際に予約を作成する時のスタッフ選択

## 制約チェックの比較

| 制約項目 | 予約選択画面（FE） | 予約実行時（BE） | 一致 |
|---------|-------------------|-----------------|------|
| 営業時間内か | ✅ | ❌（APIに任せる） | ⚠️ |
| スタッフのシフト時間内か | ✅ | ✅ | ✅ |
| スタッフがスタジオに紐付けられているか | ✅ | ✅ | ✅ |
| プログラムの選択可能スタッフか | ✅ | ✅ | ✅ |
| 既存予約と重複しないか（インターバル考慮） | ✅ | ✅ | ✅ |
| コースがシフト時間内に収まるか | ✅ | ✅ | ✅ |

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
    entity_id: number,      // instructor_id
    start_at: string,
    end_at: string
  }],
  instructor_studio_map: {
    [instructor_id: string]: number[]  // スタッフが紐付けられているスタジオID一覧
  }
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
   └─ 予約済みチェック（インターバル考慮）
       └─ reservation_assign_instructor の各予約について
       └─ [予約開始 - before_interval] 〜 [予約終了 + after_interval] と重複するか

3. 1人でも空いているスタッフがいれば「予約可能」
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
   └─ 予約済みチェック
       └─ 30分固定で重複チェック（⚠️ インターバル未考慮）

5. 空いているスタッフの最初の1名を使用
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

