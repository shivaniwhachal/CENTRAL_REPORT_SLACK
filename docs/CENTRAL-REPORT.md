# Central Daily VINI report

Operating record for the 6:00 AM IST Central report. Written 16 Oct 2026.

This job posts a picture of the Google Sheet tab **Daily report** to Slack. It is not the 5:30 PM VINI Accounts Alert, and it is not a dark table drawn by this program.

The Daily report numbers are formulas on the Google Sheet. This job does not calculate them. It prints the range and posts the picture.

## Where this lives

The sender is this git project, branch `main`.

| What | Where |
| --- | --- |
| This note | `docs/CENTRAL-REPORT.md` |
| 6:00 AM job | `central_analytics_report/job.py` |
| Sheet picture | `central_analytics_report/render.py` |
| Slack upload | `central_analytics_report/slack.py` |
| Sheet id | `central_analytics_report/sheet.py` |
| Clock installer | `scripts/install_cron.sh` |
| Run log | `logs/cron.log` |
| Sent marker | `logs/central-sent-YYYY-MM-DD` |
| Last image | `output/target-summary-daily-report.png` and `output/target-summary.png` |
| Bot token and channel ids | `.env` (not committed) |
| Central on/off | Secret `POST_TO_CENTRAL`. Anything other than `true` sends the picture to you only. |

`scripts/independent-slack-reports.gs` is not in this project and is not the sender. Do not install it. The git cron below is the sender.

The other Central Report pipelines (Sankey, VINI Views, OND Apps Script) are recorded in `docs/CENTRAL-REPORT-MASTER.md`. They are not this job.

## What is posted

At 6:00 AM IST the job downloads one range and posts it as a PNG.

| | |
| --- | --- |
| Spreadsheet | Daily report |
| Spreadsheet id | `1rNW65NGvWoNXxHI0pKM2kjgW8rZ6ZsoPqIlpa3CDMDc` |
| Tab | Daily report |
| gid | `1544274662` |
| Range | columns B–H, rows 4–22 |

Rows that are hidden on that tab stay out of the picture. The job does not unhide them. If a hidden row is shown on the sheet again, the next picture includes it.

On the sheet export read 16 Oct 2026, row 19 is hidden, so D2D Future Churn is not in the image. Row 21 is visible on that export, so Overall Churn is in the image.

The picture is the sheet’s own print. Google Sheets exports that range as a PDF. This job turns the first PDF page into a PNG and crops the empty margin. Colors, fonts, and number formats are the sheet’s, not a table drawn here.

The Slack message, from 14 Oct 2026 onward, is two lines:

```
Daily VINI report 15 Oct
Here is the detailed view
```

The date is the previous day in India time, because the sheet is already set to yesterday when the morning report runs. A send on 16 Oct is titled **Daily VINI report 15 Oct**.

“Here is the detailed view” opens the WOW Summary new report tab:

https://docs.google.com/spreadsheets/d/1rNW65NGvWoNXxHI0pKM2kjgW8rZ6ZsoPqIlpa3CDMDc/edit#gid=1271063511

gid `1271063511`.

The Slack file name is the title in lower case with spaces turned into hyphens, for example `daily-vini-report-15-oct.png`.

On 13 Oct 2026 only, the message was the introduction: the daily VINI summary would be shared automatically around 6:00 AM IST. That introduction is not used after 13 Oct.

## Who receives it

Bot: `daily_vini_report`.

| Stop | Id | What they get |
| --- | --- | --- |
| #central-analytics-programs | `C0AULQ5F2D6` | The picture and the two-line message. This is the team post. |
| Bot DM | `D0C40GC2CN8` | One note after the team post: `Sent. The daily VINI summary is now in <#C0AULQ5F2D6>.` |

The morning picture is not also copied into the bot DM. Satchit is not on this report. Satchit is only on the 5:30 PM accounts alert.

The bot must already be in #central-analytics-programs. The sheet must stay shared so the PDF export can be downloaded. The token is `SLACK_BOT_TOKEN` in `.env`. Required Slack scopes: `chat:write`, `files:write`, `im:write`.

## Clock

India time. A laptop does not run it, and this chat does not run it.

The clock is GitHub Actions on `shivaniwhachal/CENTRAL_REPORT_SLACK`, workflow `.github/workflows/daily-vini-report.yml`. It tries at 6:00, 6:45, 7:30, and 8:30 AM IST. The first success of the day is the post. Later runs that morning stop.

`POST_TO_CENTRAL` must be the word `true` before the picture goes to `#central-analytics-programs`. Until then the same 6:00 AM job sends the picture to `SLACK_NOTIFY_USER_ID` only. A manual run of the workflow is also that test. Setup is `docs/SETUP.md`.

The old every-five-minutes cron on this computer is not the sender. That computer can be paused, which is why 16 Oct posted at 8:05 instead of 6:00.

`CENTRAL_REPORT_PAUSED` in `job.py` is `False`. The report is not paused.

The central channel stays off until `POST_TO_CENTRAL` is `true`. While it is `false`, the 6:00 AM job sends nothing. A manual run of the workflow sends the picture to `SLACK_NOTIFY_USER_ID` only.

If the remote computer is paused at 6:00, that minute is skipped. Cron does not go back and run it. The next check after the computer wakes still sends that day’s report, until 9:25 AM IST. After 9:25 AM IST there is no further check until the next morning.

Closing a laptop does not by itself stop the job. The job stops only when the remote computer is paused.

The picture is marked sent after the team upload succeeds, before the bot DM. A later check in the same morning cannot post the picture again.

## Sends recorded before this workspace

These lines are the handoff record. This checkout does not contain those Slack files or those sent markers.

| India time | What the log shows |
| --- | --- |
| 13 Oct 2026, 6:00 AM | Posted to `C0AULQ5F2D6`, Slack file `F0C88KM12S3`. Bot DM notified. |
| 14 Oct 2026, 6:09 AM | Posted to `C0AULQ5F2D6`, Slack file `F0C8KJP8X6K`. Bot DM notified. The 6:00 check did not run. The 6:09 check did. |
| 15 Oct 2026 | `logs/central-sent-2026-10-15` existed. From 7:05 AM the job skipped as already sent. `logs/cron.log` had no “Posted” line for 15 Oct. |
| 16 Oct 2026, 8:05 AM | Posted to `C0AULQ5F2D6`, Slack file `F0C9N35AHGE`. Message for that morning is Daily VINI report 15 Oct. Bot DM notified. The 6:00 check did not run. The computer’s first check that morning was 8:05. |

## Commands

Render only, no Slack post:

```
.venv/bin/python -m central_analytics_report --dry-run
```

Post the picture to the bot DM only:

```
.venv/bin/python -m central_analytics_report --test
```

The 6:00 AM path:

```
.venv/bin/python -m central_analytics_report --scheduled
```

Allow the team channel, without posting:

```
.venv/bin/python -m central_analytics_report --approve
```

## Not this report

The 5:30 PM VINI Accounts Alert is a different job, a different sheet, and a dark table. Its record is `docs/VINI-ACCOUNTS-ALERT.md`. Code is `central_analytics_report/alerts_job.py`. Channel #vini-cs-team (`C0BPY9U15U5`).
