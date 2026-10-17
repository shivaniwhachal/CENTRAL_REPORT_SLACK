# What to set up

The 6:00 AM report runs from GitHub Actions on [CENTRAL_REPORT_SLACK](https://github.com/shivaniwhachal/CENTRAL_REPORT_SLACK). It does not run from a laptop and it does not run from this chat.

Apps Script keeps updating the workbook. This repository only prints the Daily report tab and posts the picture.

## Secrets

In the GitHub repo: Settings → Secrets and variables → Actions → New repository secret.

| Secret | What to paste | Used now? |
| --- | --- | --- |
| `SLACK_BOT_TOKEN` | Bot token for `daily_vini_report`, starting with `xoxb-` | Yes |
| `SLACK_NOTIFY_USER_ID` | Your Slack member id, starting with `U` | Yes. The test picture goes here. |
| `SLACK_CHANNEL_ID` | `C0AULQ5F2D6` | No. Saved for later. |
| `POST_TO_CENTRAL` | `false` | 6:00 AM sends nothing. |

Do not paste the token into chat.

Slack app scopes for the bot: `chat:write`, `files:write`, `im:write`.

Your member id: in Slack, open your profile, click the three dots, and choose Copy member ID.

## The only switch

`POST_TO_CENTRAL` is the only change after this setup.

| Secret value | 6:00 AM IST | Actions → Run workflow |
| --- | --- | --- |
| `false` | Nothing is posted. You get one DM: `Daily VINI report was not sent. POST_TO_CENTRAL is false.` | Check only. Nothing is sent. |
| `true` | Posts one picture to `#central-analytics-programs`, then DMs you once: `Sent. Daily VINI report <date> is in #central-analytics-programs.` If the post fails, that DM instead says the report was not sent and gives the error. | Check only. Nothing is sent. |

Set it to `true` before 6:00 AM IST on a morning that should post. If it is still `false` at 6:00, that check sends nothing.

Leave it `false` when Satchit says not to send. No code change, no new workflow run required for that decision. The 6:00 AM job reads the secret on its own.

## The Run workflow button

On the repo: Actions → Daily VINI report → Run workflow.

That button is a check. It does not upload a picture, to you or to the central channel. The only upload is the 6:00 AM run, and only when today's report is not already recorded.

## Before the first central morning

Invite the bot `daily_vini_report` to `#central-analytics-programs`. The sheet must stay shared so the PDF can be downloaded. The Apps Script should finish updating the Daily report tab before 6:00 AM IST.

## Clock

GitHub runs the workflow once, at 6:00 AM IST. If that run is delayed, it can still post until 9:25 AM IST. A second start the same morning finds the sent record and does not post again. The job also reads the channel: if today's title is already there, it does not upload.

The sheet’s Apps Script should finish updating the Daily report tab before 6:00 AM IST.
