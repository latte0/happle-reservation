# 広告リンク生成ツール「メニュー選択」ロジック

## 概要

広告リンク生成ツール（`/admin/link-generator`）の「メニューを選択」ドロップダウンに表示されるメニュー（プログラム）は、**hacomonoの管理画面で設定した内容**に基づいてフィルタリングされます。

---

## 用語説明

### 予約カテゴリとは

hacomonoの管理画面で **「マスタ → 予約カテゴリ」** にある設定のことです。

**1店舗に複数の予約カテゴリを作ることができます。** 例えば：

| 予約カテゴリ名 | 用途 |
|--------------|------|
| 「パーソナルトレーニング予約」 | マンツーマン施術用 |
| 「グループレッスン」 | 固定時間のクラス用 |
| 「体験予約」 | 初回体験者用 |

### 予約タイプ（CHOICE と FIXED）

各予約カテゴリには「予約タイプ」を設定します。2種類あります：

```mermaid
flowchart LR
    subgraph type[予約タイプ]
        A[CHOICE<br/>自由枠予約] 
        B[FIXED<br/>固定枠予約]
    end
    
    A --> C[お客様が好きな時間を選べる<br/>例: 10:00〜、10:30〜、11:00〜...]
    B --> D[決まった時間のレッスン<br/>例: 毎週月曜 19:00〜のヨガクラス]

    style A fill:#cce5ff
    style B fill:#e2e3e5
    style C fill:#d4edda
    style D fill:#f0f0f0
```

| 予約タイプ | 日本語名 | 説明 |
|-----------|---------|------|
| **CHOICE** | 自由枠予約 | お客様が空いている時間から自由に選んで予約できる |
| **FIXED** | 固定枠予約 | あらかじめ決まったレッスン枠に予約する |

> ⚠️ **重要**: この広告リンク生成ツールは **「自由枠予約（CHOICE）」専用** です。固定枠予約（FIXED）の予約カテゴリは対象外となります。

### 適用期間とは

予約カテゴリに設定する **「いつからいつまで予約を受け付けるか」** の期間設定です。

```mermaid
gantt
    title 適用期間の例
    dateFormat  YYYY-MM-DD
    section 予約カテゴリA
    適用期間（通常予約）      :active, a1, 2024-01-01, 2024-12-31
    section 予約カテゴリB
    適用期間（春キャンペーン） :active, b1, 2024-04-01, 2024-04-30
    section 判定
    今日（6/15）             :milestone, m1, 2024-06-15, 0d
```

| 設定項目 | 説明 | 例 |
|----------|------|-----|
| **開始日（start_date）** | この日から予約を受け付け開始 | 2024-01-01 |
| **終了日（end_date）** | この日まで予約を受け付け | 2024-12-31 |

#### 判定例

| 適用期間の設定 | 今日の日付 | 結果 |
|---------------|-----------|------|
| 2024-01-01 〜 2024-12-31 | 2024-06-15 | ✅ 期間内 → メニュー表示される |
| 2024-01-01 〜 2024-03-31 | 2024-06-15 | ❌ 期間終了 → エラー表示 |
| 2025-01-01 〜 2025-12-31 | 2024-06-15 | ❌ まだ開始前 → エラー表示 |

#### なぜ適用期間が必要？

- **キャンペーン期間限定の予約** を設定できる
- **シーズンごとの予約切り替え** ができる
- **将来の予約受付開始日** を事前に設定できる

### 確認場所

**hacomono管理画面: マスタ → 予約カテゴリ → [カテゴリを選択]**

設定画面で「予約タイプ」が「自由枠予約」になっているかを確認してください。

---

## メニュー表示のフローチャート

```mermaid
flowchart TD
    A[広告リンク生成ツールを開く] --> B[プログラム一覧を取得]
    B --> C{スタッフ & 設備が<br/>紐づいている？}
    
    C -->|No| D[❌ 表示されない]
    C -->|Yes| E[✅ 候補として保持]
    
    E --> F{店舗を選択？}
    
    F -->|未選択| G[全プログラムを表示]
    F -->|選択| H[予約カテゴリを確認]
    
    H --> I{自由枠予約の<br/>予約カテゴリがある？}
    
    I -->|No| J[⚠️ エラー<br/>予約可能なカテゴリがありません]
    I -->|Yes| K{今日が適用期間内？<br/>開始日〜終了日}
    
    K -->|No| L[⚠️ エラー<br/>予約を受け付けていない期間です]
    K -->|Yes| M{選択可能プログラム<br/>の設定は？}
    
    M -->|ALL| N[全プログラムを表示]
    M -->|SELECTED| O[指定プログラムのみ表示]
    
    O --> P{該当プログラム<br/>がある？}
    P -->|No| Q[⚠️ メッセージ<br/>選択可能なメニューがありません]
    P -->|Yes| R[フィルタされた<br/>プログラムを表示]

    style D fill:#ffcccc
    style J fill:#fff3cd
    style L fill:#fff3cd
    style Q fill:#fff3cd
    style G fill:#d4edda
    style N fill:#d4edda
    style R fill:#d4edda
```

---

## プログラムの表示条件

### 条件1: スタッフと設備の紐づけ（必須）

```mermaid
flowchart LR
    subgraph program[プログラム設定]
        A[選択可能スタッフ] --> B{設定タイプ}
        B -->|ALL / RANDOM_ALL| C[✅ OK]
        B -->|SELECTED / FIXED| D{スタッフが<br/>1人以上？}
        D -->|Yes| C
        D -->|No| E[❌ NG]
        
        F[選択可能設備] --> G{設定タイプ}
        G -->|ALL / RANDOM_ALL| H[❌ NG<br/>明示的な紐づけが必要]
        G -->|SELECTED / FIXED| I{設備が<br/>1つ以上？}
        I -->|Yes| J[✅ OK]
        I -->|No| H
    end
    
    C --> K{両方OK？}
    J --> K
    K -->|Yes| L[✅ 表示対象]
    K -->|No| M[❌ 非表示]

    style C fill:#d4edda
    style J fill:#d4edda
    style L fill:#d4edda
    style E fill:#ffcccc
    style H fill:#ffcccc
    style M fill:#ffcccc
```

### 条件2: 予約カテゴリの設定（店舗選択時）

店舗を選択すると、その店舗の **予約カテゴリ** の設定をチェックします。

```mermaid
flowchart TD
    subgraph studio_room[予約カテゴリ設定]
        A[予約タイプを確認] -->|CHOICE<br/>自由枠予約| B[✅ 対象]
        A -->|FIXED<br/>固定枠予約| C[❌ 対象外<br/>このツールでは使用不可]
        
        B --> D[適用期間チェック]
        D --> E{今日の日付が<br/>開始日〜終了日<br/>の範囲内？}
        
        E -->|Yes| F[選択可能プログラム設定]
        E -->|No| G[❌ 期間外エラー]
        
        F --> H{selectable_program_type}
        H -->|ALL| I[全プログラム表示]
        H -->|SELECTED| J[selectable_program_details<br/>のプログラムのみ]
    end

    style B fill:#d4edda
    style C fill:#ffcccc
    style G fill:#ffcccc
    style I fill:#d4edda
    style J fill:#d4edda
```

---

## hacomono管理画面での設定場所

### 1. プログラムの設定

**マスタ → プログラム → [プログラム名] → 編集**

```mermaid
flowchart LR
    subgraph hacomono[hacomono管理画面]
        A[マスタ] --> B[プログラム]
        B --> C[プログラム編集]
        C --> D[選択可能スタッフ詳細]
        C --> E[選択可能設備詳細]
    end
    
    D --> F[スタッフを紐づける]
    E --> G[設備を明示的に紐づける<br/>SELECTED または FIXED]

    style F fill:#d4edda
    style G fill:#d4edda
```

| 設定項目 | 必要な条件 |
|----------|-----------|
| **選択可能スタッフ** | スタッフが1人以上紐づいている（「全スタッフ」設定でもOK） |
| **選択可能設備** | 設備が**明示的に**紐づいている（「全設備から選択」はNG） |

### 2. 予約カテゴリの設定

**マスタ → 予約カテゴリ → [カテゴリ名] → 編集**

```mermaid
flowchart LR
    subgraph hacomono[hacomono管理画面]
        A[マスタ] --> B[予約カテゴリ]
        B --> C[カテゴリ編集]
        C --> D[予約タイプ]
        C --> E[適用期間]
        C --> F[選択可能プログラム]
    end
    
    D --> G[CHOICE: 自由枠予約]
    E --> H[開始日 〜 終了日]
    F --> I[ALL: 全プログラム<br/>SELECTED: 特定プログラム]

    style G fill:#cce5ff
    style H fill:#fff3cd
    style I fill:#d4edda
```

| 設定項目 | 説明 |
|----------|------|
| **予約タイプ** | 「自由枠予約（CHOICE）」を選択 |
| **適用期間** | いつからいつまで予約を受け付けるか（開始日・終了日） |
| **選択可能プログラム** | 「ALL」＝全プログラム / 「SELECTED」＝特定のプログラムのみ |

---

## エラーメッセージと対処法

```mermaid
flowchart TD
    subgraph errors[エラーと対処法]
        A[この店舗には予約可能な<br/>カテゴリがありません] --> A1[予約カテゴリを作成し<br/>予約タイプを「自由枠予約」に設定]
        
        B[この店舗は現在予約を<br/>受け付けていない期間です] --> B1[適用期間<br/>開始日・終了日を確認・更新]
        
        C[この店舗で選択可能な<br/>メニューがありません] --> C1[選択可能プログラムの設定を確認<br/>または対象プログラムの有効化]
        
        D[メニューが一切表示されない] --> D1[プログラムの<br/>選択可能スタッフ・設備を設定]
    end

    style A fill:#ffcccc
    style B fill:#ffcccc
    style C fill:#ffcccc
    style D fill:#ffcccc
    style A1 fill:#d4edda
    style B1 fill:#d4edda
    style C1 fill:#d4edda
    style D1 fill:#d4edda
```

| エラーメッセージ | 原因 | 対処法 |
|-----------------|------|--------|
| 「この店舗には予約可能なカテゴリがありません」 | 自由枠予約（CHOICE）の予約カテゴリがない | 予約カテゴリを作成し、予約タイプを「自由枠予約」に設定 |
| 「この店舗は現在予約を受け付けていない期間です」 | 予約カテゴリの適用期間外 | 適用期間（開始日・終了日）を確認・更新 |
| 「この店舗で選択可能なメニューがありません」 | 予約カテゴリで選択可能プログラムが設定されていない | 選択可能プログラムの設定を確認 |
| メニューが一切表示されない | プログラムにスタッフまたは設備が紐づいていない | プログラムの「選択可能スタッフ」「選択可能設備」を設定 |

---

## 関連APIドキュメント

- [hacomono API ドキュメント](https://hacomono.github.io/hacomono-documents/api-admin/index.html)
  - プログラム検索・取得
  - 予約カテゴリ検索・取得
  - 自由予約受付設定

---

## 技術的な補足

### データ取得の流れ

```mermaid
sequenceDiagram
    participant UI as 広告リンク生成ツール
    participant API as バックエンドAPI
    participant HC as hacomono API

    UI->>API: getPrograms({ filterFullyConfigured: true })
    API->>HC: GET /programs
    HC-->>API: プログラム一覧
    API-->>UI: フィルタ済みプログラム

    Note over UI: 店舗を選択

    UI->>API: getStudioRooms(studioId)
    API->>HC: GET /studio-rooms
    HC-->>API: 予約カテゴリ一覧
    API-->>UI: 自由枠予約タイプの予約カテゴリ

    UI->>API: getChoiceScheduleRange(roomId, dateFrom, dateTo)
    API->>HC: GET /choice-schedule
    HC-->>API: スケジュール情報（studio_room_service含む）
    API-->>UI: 適用期間・選択可能プログラム情報

    Note over UI: selectable_program_type に基づいてフィルタリング
```

### 主要なデータ構造

```mermaid
erDiagram
    PROGRAM ||--o{ SELECTABLE_INSTRUCTOR : has
    PROGRAM ||--o{ SELECTABLE_RESOURCE : has
    STUDIO ||--o{ STUDIO_ROOM : has
    STUDIO_ROOM ||--|| STUDIO_ROOM_SERVICE : has
    STUDIO_ROOM_SERVICE ||--o{ SELECTABLE_PROGRAM : has

    PROGRAM {
        int id
        string name
        string code
        int price
    }
    
    SELECTABLE_INSTRUCTOR {
        string type "ALL, SELECTED, FIXED, etc."
        array items "instructor_id[]"
    }
    
    SELECTABLE_RESOURCE {
        string type "ALL, SELECTED, FIXED, etc."
        array items "resource_id[]"
    }
    
    STUDIO_ROOM {
        int id
        string name
        string reservation_type "CHOICE=自由枠 / FIXED=固定枠"
    }
    
    STUDIO_ROOM_SERVICE {
        int id
        string start_date
        string end_date
        string selectable_program_type "ALL or SELECTED"
    }
    
    SELECTABLE_PROGRAM {
        int program_id
        string program_name
    }
```

