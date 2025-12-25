# Slack通知不具合の修正

## 問題の原因

予約作成時にSlack通知が送信されない問題が発生していました。

### 原因

`send_slack_notification` 関数内で `text_summary` 変数が定義されていないまま使用されていたため、`NameError` が発生していました。

```python
# 問題のあったコード（769行目付近）
payload = {
    "text": text_summary,  # ← text_summaryが未定義
    "attachments": [...]
}
```

このエラーにより、Slack通知の送信処理が例外で中断され、通知が送信されませんでした。

## 修正内容

`text_summary` 変数を定義するコードを追加しました。

```python
# フォールバック用のテキストサマリーを生成
if status == "success":
    text_summary = f"✅ 予約成功 - 予約ID: {reservation_id}, お客様: {guest_name}, 店舗: {studio_name}, 日時: {reservation_date} {reservation_time}"
else:
    text_summary = f"❌ 予約失敗 - エラーコード: {error_code}, エラー: {error_message}, お客様: {guest_name}"

payload = {
    "text": text_summary,  # フォールバック用のテキスト
    "attachments": [...]
}
```

## 影響範囲

- **固定枠予約** (`/api/reservations`): 予約成功・失敗時のSlack通知
- **自由枠予約** (`/api/reservations/choice`): 予約成功・失敗時のSlack通知

## 確認方法

1. **環境変数の確認**
   - Renderのバックエンドサービスで `SLACK_WEBHOOK_URL` が設定されていることを確認
   - 設定されていない場合、`scripts/set_render_env.sh` を使用して設定

2. **ログの確認**
   - 予約作成時に以下のログが出力されることを確認：
     ```
     Slack notification called: status=success, reservation_id=XXX, guest_name=XXX
     SLACK_WEBHOOK_URL is set, sending notification to Slack
     Sending Slack notification payload: {...}
     Slack notification sent successfully (status: success, response_status: 200)
     ```

3. **エラー時のログ**
   - エラーが発生した場合、以下のログが出力されます：
     ```
     Failed to send Slack notification: ...
     ```

## 注意事項

- Slack通知の失敗は予約処理を中断しません（例外はキャッチされ、ログに記録されるのみ）
- `SLACK_WEBHOOK_URL` が設定されていない場合、警告ログが出力され、通知はスキップされます
- Webhook URLが無効な場合、HTTPエラーがログに記録されます









