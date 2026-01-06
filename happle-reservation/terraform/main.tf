terraform {
  required_version = ">= 1.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "ap-northeast-1"
}

# ==================== SES Domain Identity ====================

resource "aws_ses_domain_identity" "main" {
  domain = "reserve-now.jp"
}

# ==================== SES Domain DKIM ====================

resource "aws_ses_domain_dkim" "main" {
  domain = aws_ses_domain_identity.main.domain
}

# ==================== SES Domain Mail From ====================

resource "aws_ses_domain_mail_from" "main" {
  domain           = aws_ses_domain_identity.main.domain
  mail_from_domain = "mail.reserve-now.jp"
}

# ==================== SES Email Identity (noreply@reserve-now.jp) ====================
# ドメイン検証が完了していれば、このリソースは不要ですが、
# AWSコンソールで個別に検証を求められる場合に備えて設定

resource "aws_ses_email_identity" "noreply" {
  email = "noreply@reserve-now.jp"
}

# ==================== IAM User for SES ====================

resource "aws_iam_user" "ses_user" {
  name = "ses-smtp-user"
  path = "/system/"

  tags = {
    Project = "happle-reservation"
    Purpose = "SES Email Sending"
  }
}

# ==================== IAM Policy for SES ====================

resource "aws_iam_policy" "ses_send_email" {
  name        = "ses-send-email-policy"
  description = "Policy to allow sending emails via SES"

  policy = jsonencode({
    Statement = [
      {
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
          "ses:SendBulkTemplatedEmail"
        ]
        Condition = {
          StringEquals = {
            "ses:FromAddress" = "*@reserve-now.jp"
          }
        }
        Effect   = "Allow"
        Resource = "*"
      }
    ]
    Version = "2012-10-17"
  })
}

# ==================== IAM User Policy Attachment ====================

resource "aws_iam_user_policy_attachment" "ses_user_policy" {
  user       = aws_iam_user.ses_user.name
  policy_arn = aws_iam_policy.ses_send_email.arn
}

# ==================== IAM Access Key for SES ====================

resource "aws_iam_access_key" "ses_user_key" {
  user = aws_iam_user.ses_user.name
}

# ==================== Outputs ====================

output "ses_verification_token" {
  description = "SES domain verification token"
  value       = aws_ses_domain_identity.main.verification_token
}

output "ses_verification_record" {
  description = "SES domain verification DNS record"
  value = {
    name  = "_amazonses.${aws_ses_domain_identity.main.domain}"
    type  = "TXT"
    value = aws_ses_domain_identity.main.verification_token
  }
}

output "dkim_tokens" {
  description = "DKIM tokens for domain"
  value       = aws_ses_domain_dkim.main.dkim_tokens
}

output "dkim_cname_records" {
  description = "DKIM CNAME records for domain"
  value = [
    for token in aws_ses_domain_dkim.main.dkim_tokens : {
      name  = "${token}._domainkey.${aws_ses_domain_identity.main.domain}"
      type  = "CNAME"
      value = "${token}.dkim.amazonses.com"
    }
  ]
}

output "mail_from_mx_record" {
  description = "Mail FROM MX record"
  value = {
    name     = aws_ses_domain_mail_from.main.mail_from_domain
    type     = "MX"
    priority = 10
    value    = "feedback-smtp.ap-northeast-1.amazonses.com"
  }
}

output "mail_from_txt_record" {
  description = "Mail FROM SPF TXT record"
  value = {
    name  = aws_ses_domain_mail_from.main.mail_from_domain
    type  = "TXT"
    value = "v=spf1 include:amazonses.com ~all"
  }
}

output "ses_smtp_user_access_key" {
  description = "SES SMTP user access key"
  value       = aws_iam_access_key.ses_user_key.id
}

output "ses_smtp_user_secret_key" {
  description = "SES SMTP user secret key"
  value       = aws_iam_access_key.ses_user_key.secret
  sensitive   = true
}

output "dns_setup_instructions" {
  description = "DNS setup instructions"
  value = <<-EOT
    
===== お名前.com DNS設定手順 =====
    
以下のDNSレコードをお名前.comに追加してください:
    
1. ドメイン検証用TXTレコード:
   - タイプ: TXT
   - ホスト名: _amazonses
   - 値: ${aws_ses_domain_identity.main.verification_token}
    
2. DKIM用CNAMEレコード (3つ):
   - タイプ: CNAME
   - ホスト名: (token)._domainkey
   - 値: (token).dkim.amazonses.com
   ※ dkim_cname_records の出力を参照
    
3. Mail FROM用MXレコード:
   - タイプ: MX
   - ホスト名: mail
   - 優先度: 10
   - 値: feedback-smtp.ap-northeast-1.amazonses.com
    
4. SPF用TXTレコード:
   - タイプ: TXT
   - ホスト名: mail
   - 値: v=spf1 include:amazonses.com ~all
    
DNS設定後、検証が完了するまで最大72時間かかる場合があります。
    
EOT
}
















