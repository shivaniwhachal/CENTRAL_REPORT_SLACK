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
| `POST_TO_CENTRAL` | Leave this secret out, or set it to `false` | No post to the central channel. |

Do not paste the token into chat.

Slack app scopes for the bot: `chat:write`, `files:write`, `im:write`.

Your member id: in Slack, open your profile, click the three dots, and choose Copy member ID.

## What happens at 6:00 AM

While `POST_TO_CENTRAL` is not `true`, the morning job sends the picture to you only. The central channel gets nothing.

The message is:

```
Daily VINI report 15 Oct
Here is the detailed view
```

The date is yesterday in India time. The picture is the sheet’s own print of Daily report, columns B–H, rows 4–22.

A manual run of the GitHub Action is the same test. It also sends the picture only to you.

## When the central channel should start

Set the secret `POST_TO_CENTRAL` to the exact word `true`.

The next 6:00 AM IST run then posts the picture to `#central-analytics-programs` and sends you one line: `Sent. The daily VINI summary is now in #central-analytics-programs.`

Before that first central morning, invite the bot `daily_vini_report` to `#central-analytics-programs`. The sheet must stay shared so the PDF can be downloaded.

Leave `POST_TO_CENTRAL` unset until you have seen one picture in your own DM and you want the channel to receive it. If you set it tonight, tomorrow at 6:00 AM the picture goes to the central channel.

## Clock

GitHub runs the workflow at 6:00, 6:45, 7:30, and 8:30 AM IST. The first success wins. Later runs that morning do nothing.

The sheet’s Apps Script should finish updating the Daily report tab before 6:00 AM IST.
