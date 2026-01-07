# AWS SES設定確認チェックリスト

## Terraformで作成されているリソース

terraform.tfstateから確認した設定：

### 1. ドメイン検証（aws_ses_domain_identity）
- **ドメイン**: `reserve-now.jp`
- **検証トークン**: `YWF32QQKXx/vHumu6iOZm6DcjscLr39+TCRegE1FUNM=`
- **DNSレコード**: `_amazonses.reserve-now.jp` にTXTレコードが必要

### 2. DKIM設定（aws_ses_domain_dkim）
- **DKIMトークン**: 3つ生成済み
  - `5dertsczyk6ihpbjss72u3zsacaegjol`
  - `e2svfinrfnqcczrycd2lrjfs3cxxrrlq`
  - `o7onwox4lgx75fv2kfxcno4qcbknqcd2`
- **DNSレコード**: 3つのCNAMEレコードが必要

### 3. Mail FROM設定（aws_ses_domain_mail_from）
- **Mail FROMドメイン**: `mail.reserve-now.jp`
- **MXレコード**: `feedback-smtp.ap-northeast-1.amazonses.com`
- **SPFレコード**: `v=spf1 include:amazonses.com ~all`

## お名前.comに設定すべきDNSレコード

### 1. ドメイン検証用TXTレコード
```
ホスト名: _amazonses
タイプ: TXT
値: YWF32QQKXx/vHumu6iOZm6DcjscLr39+TCRegE1FUNM=
```

### 2. DKIM用CNAMEレコード（3つ）
```
1. ホスト名: 5dertsczyk6ihpbjss72u3zsacaegjol._domainkey
   タイプ: CNAME
   値: 5dertsczyk6ihpbjss72u3zsacaegjol.dkim.amazonses.com

2. ホスト名: e2svfinrfnqcczrycd2lrjfs3cxxrrlq._domainkey
   タイプ: CNAME
   値: e2svfinrfnqcczrycd2lrjfs3cxxrrlq.dkim.amazonses.com

3. ホスト名: o7onwox4lgx75fv2kfxcno4qcbknqcd2._domainkey
   タイプ: CNAME
   値: o7onwox4lgx75fv2kfxcno4qcbknqcd2.dkim.amazonses.com
```

### 3. Mail FROM用MXレコード
```
ホスト名: mail
タイプ: MX
優先度: 10
値: feedback-smtp.ap-northeast-1.amazonses.com
```

### 4. Mail FROM用SPFレコード
```
ホスト名: mail
タイプ: TXT
値: v=spf1 include:amazonses.com ~all
```

## AWSコンソールでの確認手順

1. **AWS SESコンソール**（ap-northeast-1リージョン）にアクセス
2. **Verified identities** を開く
3. `reserve-now.jp` の状態を確認
   - ✅ **Verified** になっているか確認
   - ❌ **Pending verification** の場合は、DNS設定を確認

## 「IDが見つかりません」エラーの対処

このエラーは以下のいずれかが原因の可能性があります：

1. **ドメイン検証が完了していない**
   - DNSレコードが正しく設定されているか確認
   - DNS反映に最大72時間かかる場合がある

2. **メールアドレスの個別検証が必要**
   - ドメイン検証が完了していれば、`noreply@reserve-now.jp` は自動的に使用可能
   - ただし、AWSコンソールで個別にメールアドレスを検証する必要がある場合もある

3. **リージョンの不一致**
   - 必ず **ap-northeast-1（東京）** リージョンで確認すること

## 推奨アクション

1. AWS SESコンソールで `reserve-now.jp` の検証状態を確認
2. DNSレコードが正しく設定されているか確認（dig/nslookupコマンドで確認可能）
3. ドメイン検証が完了していれば、メールアドレスの個別検証は不要（ドメイン配下のメールアドレスは自動的に使用可能）



















