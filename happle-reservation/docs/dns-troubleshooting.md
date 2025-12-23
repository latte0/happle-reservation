# DNS設定のトラブルシューティング

## 問題

DNS設定は正しく見えるが、ドメインにアクセスできない。

## 現在の状況

### Renderの設定要件

1. **`reserve-now.jp`**
   - ANAME/ALIAS レコード → `happle-reservation-frontend.onrender.com`
   - または A レコード → `216.24.57.1`

2. **`www.reserve-now.jp`**
   - CNAME レコード → `happle-reservation-frontend.onrender.com`

### 実際のDNS解決結果（2025-12-23確認）

```bash
$ dig reserve-now.jp +short
150.95.255.38  # ❌ 期待値: 216.24.57.1 または RenderのIP

$ dig www.reserve-now.jp +short
150.95.255.38  # ❌ 期待値: happle-reservation-frontend.onrender.com (CNAME)

$ dig www.reserve-now.jp ANY +noall +answer
www.reserve-now.jp.	291	IN	A	150.95.255.38  # ❌ Aレコードになっている（CNAMEであるべき）
```

### 問題点

1. **`reserve-now.jp` のAレコードが間違っている**
   - 設定値: `216.24.57.1`
   - 実際の解決: `150.95.255.38`
   - 原因: DNS設定が反映されていない、または別のレコードが優先されている

2. **`www.reserve-now.jp` がCNAMEではなくAレコードになっている**
   - 設定値: CNAME → `happle-reservation-frontend.onrender.com`
   - 実際の解決: Aレコード → `150.95.255.38`
   - 原因: CNAMEレコードが正しく設定されていない、またはAレコードが優先されている

## 解決方法

### 1. DNS設定の確認

DNS管理画面で以下を確認：

#### `reserve-now.jp` の設定
- ✅ Aレコードが `216.24.57.1` に設定されているか
- ✅ 他のAレコードが存在しないか（特に `150.95.255.38` を指すもの）
- ✅ レコードの優先順位（複数のAレコードがある場合）

#### `www.reserve-now.jp` の設定
- ✅ CNAMEレコードが `happle-reservation-frontend.onrender.com` に設定されているか
- ✅ Aレコードが存在しないか（CNAMEとAレコードは同時に存在できない）
- ✅ もしAレコードがある場合は削除する

### 2. DNS伝播の確認

DNS設定を変更した後、伝播に時間がかかることがあります：

```bash
# 複数のDNSサーバーで確認
dig reserve-now.jp @8.8.8.8 +short
dig reserve-now.jp @1.1.1.1 +short
dig reserve-now.jp @208.67.222.222 +short

# TTLを確認（キャッシュの有効期限）
dig reserve-now.jp +noall +answer | grep TTL
```

### 3. Render側の確認

1. **カスタムドメイン設定画面で「Verify」ボタンをクリック**
   - DNS設定が正しく反映されていれば、検証が成功する

2. **SSL証明書の状態を確認**
   - Renderは自動的にSSL証明書を発行するが、DNS設定が正しくないと失敗する

3. **サービスログを確認**
   - Renderのダッシュボードでエラーログを確認

### 4. 推奨される設定

#### オプションA: ANAME/ALIASレコードを使用（推奨）

```
reserve-now.jp  →  ANAME/ALIAS  →  happle-reservation-frontend.onrender.com
www.reserve-now.jp  →  CNAME  →  happle-reservation-frontend.onrender.com
```

**メリット**: RenderのIPが変わっても自動的に追従

#### オプションB: Aレコードを使用

```
reserve-now.jp  →  A  →  216.24.57.1
www.reserve-now.jp  →  CNAME  →  happle-reservation-frontend.onrender.com
```

**注意**: RenderのIPが変わった場合は手動で更新が必要

### 5. 確認コマンド

```bash
# DNS設定の確認
dig reserve-now.jp +short
dig www.reserve-now.jp +short
dig happle-reservation-frontend.onrender.com +short

# 全てのレコードを確認
dig reserve-now.jp ANY +noall +answer
dig www.reserve-now.jp ANY +noall +answer

# CNAMEの確認
dig www.reserve-now.jp CNAME +short

# 接続テスト
curl -I https://reserve-now.jp
curl -I https://www.reserve-now.jp
```

## 現在の状況（2025-12-23確認）

### 権威DNSサーバーでの確認（正しい設定）

```bash
$ dig @03.dnsv.jp reserve-now.jp ANY +noall +answer
reserve-now.jp.    3600    IN  A   216.24.57.1  # ✅ 正しい
```

**結論**: DNS設定自体は正しく、権威DNSサーバーでは正しいIP `216.24.57.1` が返っています。

### 問題: DNSキャッシュの伝播

一部のDNSサーバー（Google DNS 8.8.8.8など）では、まだ古いIP `150.95.255.38` をキャッシュしています。

```bash
$ dig @8.8.8.8 reserve-now.jp +short
150.95.255.38  # ❌ 古いキャッシュ
```

### `150.95.255.38` について

- このIPは別のサーバー（おそらく以前のサーバー）で、HTTPは応答するがHTTPSは応答しない
- DNS設定には存在しないが、DNSキャッシュに残っている
- 時間が経てば自動的に消える（TTLに従って）

## 解決方法

### 1. DNSキャッシュの伝播を待つ

DNS設定は正しいので、時間が経てば自動的に解決されます：
- TTLは3600秒（1時間）
- 最大48時間程度で世界中のDNSサーバーに伝播

### 2. 確認方法

権威DNSサーバーに直接問い合わせれば、正しい設定が確認できます：

```bash
# 権威DNSサーバーで確認（正しい設定が返る）
dig @03.dnsv.jp reserve-now.jp +short
# 期待値: 216.24.57.1

dig @04.dnsv.jp reserve-now.jp +short
# 期待値: 216.24.57.1
```

### 3. Render側での確認

1. Renderのカスタムドメイン設定画面で「Verify」ボタンをクリック
2. Renderは権威DNSサーバーに問い合わせるので、検証が成功するはずです
3. SSL証明書も自動的に発行されます

### 4. ユーザー側での対応

ユーザーが古いDNSキャッシュを見ている場合は：
- ブラウザのDNSキャッシュをクリア
- 別のDNSサーバーを使用（例: 1.1.1.1）
- 時間を置いて再度アクセス

## 次のステップ

1. ✅ DNS設定は正しい（権威DNSサーバーで確認済み）
2. ⏳ DNSキャッシュの伝播を待つ（最大48時間、通常は数時間）
3. ✅ Renderの「Verify」ボタンで検証（権威DNSサーバーに問い合わせるので成功するはず）
4. ✅ SSL証明書の発行を待つ（数分〜数時間）

