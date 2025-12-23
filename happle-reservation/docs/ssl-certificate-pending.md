# SSL証明書発行待ちの対処法

## 現在の状況

Renderのカスタムドメイン設定画面で：
- ✅ **Domain Verified** - DNS設定は正しく検証済み
- ⏳ **Certificate Pending** - SSL証明書の発行待ち

## SSL証明書発行の流れ

Renderは自動的にLet's Encryptを使用してSSL証明書を発行します：

1. **DNS検証** ✅ 完了
   - `reserve-now.jp` のAレコードが正しく設定されている
   - Renderが権威DNSサーバーに問い合わせて検証成功

2. **SSL証明書発行** ⏳ 進行中
   - Let's EncryptのACMEチャレンジを実行
   - 通常 **数分〜数時間** かかります
   - 最大 **24時間** かかる場合もあります

## 確認方法

### 1. Renderダッシュボードで確認

- カスタムドメイン設定画面を定期的に確認
- 「Certificate Pending」から「Certificate Active」に変わるまで待つ
- エラーメッセージがないか確認

### 2. コマンドで確認

```bash
# SSL証明書の確認（証明書が発行されると成功する）
openssl s_client -connect reserve-now.jp:443 -servername reserve-now.jp < /dev/null 2>&1 | grep "peer certificate"

# HTTPS接続テスト（証明書が発行されると成功する）
curl -I https://reserve-now.jp
```

### 3. ブラウザで確認

証明書が発行されると、ブラウザで `https://reserve-now.jp` にアクセスできるようになります。

## よくある問題と対処法

### 問題1: 証明書発行に時間がかかる

**対処法**: 
- 通常は数分〜数時間で発行されます
- 最大24時間待ってください
- Renderのログでエラーがないか確認

### 問題2: DNS伝播が完了していない

**確認方法**:
```bash
# 権威DNSサーバーで確認（正しい設定が返るはず）
dig @03.dnsv.jp reserve-now.jp +short
# 期待値: 216.24.57.1
```

**対処法**:
- DNS設定は正しいので、時間が経てば伝播します
- Renderは権威DNSサーバーに問い合わせるので、検証は成功しています

### 問題3: wwwサブドメインが解決できない

**現在の状況**:
- `www.reserve-now.jp` のCNAMEレコードがまだ伝播していない可能性

**確認方法**:
```bash
# 権威DNSサーバーで確認
dig @03.dnsv.jp www.reserve-now.jp CNAME +short
# 期待値: happle-reservation-frontend.onrender.com
```

**対処法**:
- DNS設定を確認（CNAMEレコードが正しく設定されているか）
- DNS伝播を待つ（最大48時間）

## 次のステップ

1. ✅ DNS設定は正しい（Domain Verified）
2. ⏳ SSL証明書の発行を待つ（数分〜数時間）
3. ✅ 定期的にRenderダッシュボードで確認
4. ✅ 証明書が発行されたら `https://reserve-now.jp` にアクセスして確認

## 参考

- [Render Custom Domains Documentation](https://render.com/docs/custom-domains)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)


