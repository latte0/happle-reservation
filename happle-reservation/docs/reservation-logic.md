# 予約判定ロジック詳細ドキュメント

## 概要

本ドキュメントでは、Happle予約システムにおける予約可能判定ロジックの詳細を説明します。

## 目次

1. [予約タイプ](#予約タイプ)
2. [データ取得](#データ取得)
3. [自由枠予約の判定ロジック](#自由枠予約の判定ロジック)
4. [固定枠予約の判定ロジック](#固定枠予約の判定ロジック)
5. [フロントエンドとバックエンドの役割](#フロントエンドとバックエンドの役割)
6. [エラーハンドリング](#エラーハンドリング)

---

## 予約タイプ

### 自由枠予約（Choice Reservation）

- 顧客が自由に時間を選択できる予約方式
- システムが自動的にスタッフをアサイン
- プログラム（メニュー）の`service_minutes`に基づいて時間枠を生成

### 固定枠予約（Fixed Slot Reservation）

- 事前に設定されたレッスン枠への予約
- 枠ごとに容量（capacity）と担当スタッフが決まっている

---

## データ取得

### 使用API

| エンドポイント | 用途 | 日付範囲 |
|---------------|------|----------|
| `/api/choice-schedule-range` | 自由枠スケジュール一括取得 | ✅ 7日分一括 |
| `choice/schedule` (hacomono) | 1日分の詳細スケジュール | 単一日のみ |
| `studio-lessons` (hacomono) | 固定枠レッスン一覧 | ✅ 範囲指定可 |
| `master/instructors` (hacomono) | スタッフ一覧 | - |

### 取得データ構造

```typescript
interface ChoiceSchedule {
  date: string                          // 日付（YYYY-MM-DD）
  studio_id: number                     // スタジオID
  
  // 営業時間
  shift_studio_business_hour: Array<{
    date: string
    start_at: string                    // 営業開始時刻（ISO8601）
    end_at: string                      // 営業終了時刻（ISO8601）
    is_holiday: boolean                 // 休業日フラグ
  }>
  
  // スタッフシフト
  shift_instructor: Array<{
    instructor_id: number
    date: string
    start_at: string                    // シフト開始時刻
    end_at: string                      // シフト終了時刻
  }>
  
  // 予約済み情報
  reservation_assign_instructor: Array<{
    entity_id: number                   // スタッフID
    start_at: string
    end_at: string
    type: 'CHOICE' | 'FIXED_SLOT_LESSON'
  }>
  
  // 固定枠レッスン
  fixed_slot_lessons: Array<{
    id: number
    start_at: string
    end_at: string
    instructor_id: number
    capacity: number
    reserved_count: number
  }>
  
  // スタッフ-スタジオ紐付け
  instructor_studio_map: {
    [instructor_id: string]: number[]   // スタッフID → 紐付けスタジオID配列
  }
  
  // 固定枠インターバル設定
  fixed_slot_interval: {
    before_minutes: number              // 固定枠前のブロック時間
    after_minutes: number               // 固定枠後のブロック時間
  }
}
```

---

## 自由枠予約の判定ロジック

### 判定フロー図

```
┌─────────────────────────────────────────────────────────────────┐
│                    予約可能判定フロー                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   休業日チェック   │
                    └────────┬────────┘
                             │ is_holiday?
              ┌──── YES ─────┼───── NO ────┐
              │              │             │
              ▼              │             ▼
         【休業日】          │    ┌─────────────────┐
                             │    │ 営業時間チェック │
                             │    └────────┬────────┘
                             │             │
                             │   時間外? ──┼── 時間内
                             │      │      │      │
                             │      ▼      │      ▼
                             │  【営業外】 │  ┌─────────────────┐
                             │             │  │ 予約締切チェック │
                             │             │  └────────┬────────┘
                             │             │           │
                             │    締切後? ─┼── 締切前
                             │      │      │      │
                             │      ▼      │      ▼
                             │ 【締切過ぎ】│  ┌─────────────────┐
                             │             │  │ 予約可能期間    │
                             │             │  │ チェック        │
                             │             │  └────────┬────────┘
                             │             │           │
                             │ 期間外? ────┼── 期間内
                             │      │      │      │
                             │      ▼      │      ▼
                             │【期間外】   │  ┌─────────────────┐
                             │             │  │ スタッフシフト   │
                             │             │  │ チェック        │
                             │             │  └────────┬────────┘
                             │             │           │
                             │ シフトなし? ┼── シフトあり
                             │      │      │      │
                             │      ▼      │      ▼
                             │【スタッフ   │  ┌─────────────────┐
                             │  不在】     │  │ スタジオ紐付け   │
                             │             │  │ チェック        │
                             │             │  └────────┬────────┘
                             │             │           │
                             │ 紐付けなし? ┼── 紐付けあり
                             │      │      │      │
                             │      ▼      │      ▼
                             │【対象外     │  ┌─────────────────┐
                             │  スタッフ】 │  │ 予約済みチェック │
                             │             │  └────────┬────────┘
                             │             │           │
                             │ 全員予約済?─┼── 空きあり
                             │      │      │      │
                             │      ▼      │      ▼
                             │  【満席】   │  ┌─────────────────┐
                             │             │  │ インターバル    │
                             │             │  │ チェック        │
                             │             │  └────────┬────────┘
                             │             │           │
                             │ ブロック中? ┼── OK
                             │      │      │      │
                             │      ▼      │      ▼
                             │【間隔調整中】│  ┌─────────────────┐
                             │             │  │ 【予約可能 ◎】  │
                             │             │  └─────────────────┘
                             │
                             └─────────────────────────────────────
```

### 各判定の詳細

#### 1. 休業日チェック

```typescript
// shift_studio_business_hour の is_holiday フラグを確認
const isHoliday = businessHour?.is_holiday === true

if (isHoliday) {
  return { available: false, reason: 'holiday' }
}
```

**表示**: `-` (グレー)

---

#### 2. 営業時間チェック

```typescript
// 営業時間内かチェック
const businessStart = parseISO(businessHour.start_at)
const businessEnd = parseISO(businessHour.end_at)

// コース終了時刻も営業時間内に収まる必要がある
const slotEnd = addMinutes(slotStart, program.service_minutes)

if (slotStart < businessStart || slotEnd > businessEnd) {
  return { available: false, reason: 'outside_business_hours' }
}
```

**表示**: `-` (グレー)

---

#### 3. 予約締切チェック

```typescript
// program.reservable_to_minutes: 開始何分前まで予約可能か
const deadline = subMinutes(slotStart, program.reservable_to_minutes || 0)

if (now > deadline) {
  return { available: false, reason: 'deadline_passed' }
}
```

**表示**: `×` (赤、ツールチップ: 締切過ぎ)

---

#### 4. 予約可能期間チェック

```typescript
// 予約可能期間: 現在時刻+30分 〜 14日後
const minReservableTime = addMinutes(now, 30)
const maxReservableTime = addDays(now, 14)

if (slotStart < minReservableTime) {
  return { available: false, reason: 'too_soon' }
}
if (slotStart > maxReservableTime) {
  return { available: false, reason: 'too_late' }
}
```

**表示**: `-` (グレー)

---

#### 5. スタッフシフトチェック

```typescript
// 該当時間帯にシフトが入っているスタッフを抽出
const staffOnShift = shiftInstructors.filter(instructor => {
  const shiftStart = parseISO(instructor.start_at)
  const shiftEnd = parseISO(instructor.end_at)
  
  // スロット開始〜終了がシフト時間内に収まるか
  return slotStart >= shiftStart && slotEnd <= shiftEnd
})

if (staffOnShift.length === 0) {
  return { available: false, reason: 'no_staff_shift' }
}
```

**表示**: `-` (グレー)

---

#### 6. スタジオ紐付けチェック

```typescript
// スタッフがこのスタジオに紐付けられているかチェック
const isAssociated = (instructorId: number): boolean => {
  const studioIds = instructorStudioMap[instructorId]
  
  // 空配列 = どのスタジオにも紐付けなし = 予約不可
  if (!studioIds || studioIds.length === 0) {
    return false
  }
  
  // 現在のスタジオIDが含まれているか
  return studioIds.includes(currentStudioId)
}

const associatedStaff = staffOnShift.filter(s => isAssociated(s.instructor_id))

if (associatedStaff.length === 0) {
  return { available: false, reason: 'no_associated_staff' }
}
```

**表示**: `×` (赤)

---

#### 7. 予約済みチェック

```typescript
// 該当時間帯に既に予約が入っているスタッフを除外
const reservedStaffIds = new Set<number>()

reservations.forEach(reservation => {
  const resStart = parseISO(reservation.start_at)
  const resEnd = parseISO(reservation.end_at)
  
  // 時間が重なっているかチェック
  if (slotStart < resEnd && slotEnd > resStart) {
    reservedStaffIds.add(reservation.entity_id)
  }
})

const availableStaff = associatedStaff.filter(
  s => !reservedStaffIds.has(s.instructor_id)
)

if (availableStaff.length === 0) {
  return { available: false, reason: 'fully_booked' }
}
```

**表示**: `×` (赤、ツールチップ: 満席)

---

#### 8. インターバルチェック

```typescript
// プログラムのインターバル設定
const beforeInterval = program.before_interval_minutes || 0
const afterInterval = program.after_interval_minutes || 0

// 固定枠のインターバル設定
const fixedBeforeInterval = fixedSlotInterval.before_minutes // 30分
const fixedAfterInterval = fixedSlotInterval.after_minutes   // 30分

// 既存予約との間隔をチェック
const isBlockedByInterval = reservations.some(reservation => {
  const resStart = parseISO(reservation.start_at)
  const resEnd = parseISO(reservation.end_at)
  
  // 前後のブロック時間を計算
  let before = beforeInterval
  let after = afterInterval
  
  if (reservation.type === 'FIXED_SLOT_LESSON') {
    before = fixedBeforeInterval
    after = fixedAfterInterval
  }
  
  const blockStart = subMinutes(resStart, before)
  const blockEnd = addMinutes(resEnd, after)
  
  return slotStart < blockEnd && slotEnd > blockStart
})

if (isBlockedByInterval) {
  return { available: false, reason: 'interval_blocked' }
}
```

**表示**: `×` (オレンジ、ツールチップ: 間隔調整中)

---

### 表示ステータスまとめ

| ステータス | 記号 | 色 | 理由 |
|-----------|------|-----|------|
| 予約可能 | ◎ | 緑 | すべてのチェックを通過 |
| 満席 | × | 赤 | 空きスタッフなし |
| 間隔調整中 | × | オレンジ | インターバルでブロック |
| 締切過ぎ | × | 赤 | 予約締切時刻を過ぎた |
| 営業時間外 | - | グレー | 営業時間外 |
| 休業日 | - | グレー | 店舗休業日 |
| スタッフ不在 | - | グレー | シフトが入っていない |

---

## 固定枠予約の判定ロジック

### 判定条件

1. **レッスン枠の存在**: `studio_lessons`に該当時間のレッスンがあるか
2. **容量チェック**: `reserved_count < capacity` か
3. **予約可能フラグ**: `is_reservable === true` か
4. **予約締切**: プログラムの`reservable_to_minutes`を確認

```typescript
const isAvailable = (lesson: StudioLesson): boolean => {
  // 容量チェック
  if (lesson.reserved_count >= lesson.capacity) {
    return false
  }
  
  // 予約可能フラグ
  if (!lesson.is_reservable) {
    return false
  }
  
  // 予約締切チェック
  const deadline = subMinutes(parseISO(lesson.start_at), reservable_to_minutes)
  if (new Date() > deadline) {
    return false
  }
  
  return true
}
```

---

## フロントエンドとバックエンドの役割

### フロントエンド（カレンダー表示）

| 責務 | 説明 |
|------|------|
| スケジュール表示 | 7日分のカレンダーを生成 |
| 予約可否判定 | すべての判定ロジックを実行して ◎/× を表示 |
| ユーザー入力 | スロット選択、フォーム入力 |
| GTMイベント送信 | ファネル分析用のイベント送信 |

```typescript
// フロントエンドでの判定
const generateGrid = (schedule: ChoiceSchedule, program: Program) => {
  const slots = []
  
  for (let time = businessStart; time < businessEnd; time += interval) {
    const status = checkAvailability(time, schedule, program)
    slots.push({ time, status })
  }
  
  return slots
}
```

### バックエンド（予約実行）

| 責務 | 説明 |
|------|------|
| スタッフ自動選択 | 空いているスタッフを自動アサイン |
| 予約作成 | hacomono APIへの予約リクエスト |
| メンバー作成 | ゲストメンバーの自動作成 |
| チケット付与 | 予約に必要なチケットの自動付与 |
| エラーハンドリング | hacomonoエラーの解析と適切なメッセージ返却 |

```python
# バックエンドでのスタッフ選択ロジック
def select_instructor(schedule, start_at, studio_id):
    jst = ZoneInfo("Asia/Tokyo")
    start_datetime = datetime.strptime(start_at, "%Y-%m-%d %H:%M:%S.%f").replace(tzinfo=jst)
    
    # 予約済みスタッフを除外
    reserved_ids = get_reserved_instructor_ids(schedule, start_datetime)
    
    # スタジオに紐付いたスタッフのみ
    for instructor in schedule['shift_instructor']:
        instructor_id = instructor['instructor_id']
        
        # スタジオ紐付けチェック
        if not is_associated_with_studio(instructor_id, studio_id):
            continue
        
        # 予約済みチェック
        if instructor_id in reserved_ids:
            continue
        
        # シフト時間内チェック
        if is_within_shift(instructor, start_datetime):
            return instructor_id
    
    raise NoAvailableInstructorError()
```

---

## エラーハンドリング

### hacomonoエラーコードと対応メッセージ

| エラーコード | hacomonoメッセージ | 表示メッセージ |
|-------------|-------------------|----------------|
| `CMN_000022` | メールアドレスは既に使用されています | このメールアドレスは既に登録されています |
| `CMN_000025` | 電話番号が正しくありません | 電話番号の形式が正しくありません |
| `RSV_000304` | 指定の時間帯で予約することはできません | この時間帯は予約できません |
| `RSV_000308` | スタッフが設定されていないか無効 | 対応可能なスタッフがいません |
| `RSV_000005` | チケットが不足しています | （ゲスト予約では無視） |

### フロントエンドでのエラー表示

```typescript
try {
  await createReservation(data)
} catch (error) {
  if (error.error_code === 'CMN_000022') {
    setError('このメールアドレスは既に登録されています。別のメールアドレスをお試しください。')
  } else if (error.error_code === 'NO_AVAILABLE_INSTRUCTOR') {
    setError('この時間帯に対応可能なスタッフがいません。別の時間帯をお選びください。')
  } else {
    setError('予約処理中にエラーが発生しました。お手数ですが、運営までお問い合わせください。')
  }
}
```

---

## タイムゾーン処理

### 重要なポイント

- hacomono APIは ISO8601形式（`2025-12-20T16:00:00+09:00`）で返却
- フロントエンドからは `YYYY-MM-DD HH:MM:SS.fff` 形式で送信
- バックエンドで日本時間（JST）に統一して比較

```python
from zoneinfo import ZoneInfo

jst = ZoneInfo("Asia/Tokyo")

# フロントエンドからの時刻をJSTとして解釈
start_datetime = datetime.strptime(start_at, "%Y-%m-%d %H:%M:%S.%f").replace(tzinfo=jst)

# hacomonoからの時刻をJSTに変換して比較
reserved_start = datetime.fromisoformat(reserved_start_str.replace("Z", "+00:00")).astimezone(jst)
```

---

## キャッシュ戦略

### instructor_studio_map キャッシュ

- **TTL**: 60秒
- **理由**: スタッフのスタジオ紐付けは頻繁に変わらない
- **効果**: 7日分のスケジュール取得時、1回だけAPIコール

```python
_instructor_studio_map_cache = {"data": None, "timestamp": None}
_CACHE_TTL_SECONDS = 60

def get_cached_instructor_studio_map(client):
    now = datetime.now()
    if _instructor_studio_map_cache["data"] and \
       (now - _instructor_studio_map_cache["timestamp"]).total_seconds() < _CACHE_TTL_SECONDS:
        return _instructor_studio_map_cache["data"]
    
    # キャッシュ更新
    instructors = client.get_instructors(query={"is_active": True})
    instructor_studio_map = {
        str(inst["id"]): inst.get("studio_ids", [])
        for inst in instructors["data"]["instructors"]["list"]
    }
    
    _instructor_studio_map_cache["data"] = instructor_studio_map
    _instructor_studio_map_cache["timestamp"] = now
    
    return instructor_studio_map
```

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2025-12-18 | 初版作成 |

