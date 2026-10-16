# VINI Accounts Alert

This is not the 6:00 AM Central Daily VINI report.

| | Central Daily VINI report | VINI Accounts Alert |
| --- | --- | --- |
| When | 6:00 AM IST | 5:30 PM IST |
| What is posted | The Google Sheet’s own print of Daily report `B4:H22` | A dark table from a different sheet |
| Code | `central_analytics_report/job.py` | `central_analytics_report/alerts_job.py` |
| Channel | #central-analytics-programs `C0AULQ5F2D6` | #vini-cs-team `C0BPY9U15U5` |

Satchit is on the accounts alert only. Satchit is not on the morning picture.

`alerts_job.py` does not post. The morning sender does not call it. The accounts-alert sheet, the dark table, and the 5:30 PM clock are a separate workstream. See `docs/CENTRAL-REPORT-MASTER.md`.
