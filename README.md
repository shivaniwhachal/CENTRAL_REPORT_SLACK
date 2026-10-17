# Central Daily VINI report

At 6:00 AM India time this project prints one range of the Google Sheet tab **Daily report** and posts the PNG.

The numbers stay on the sheet. This program does not calculate them. What you need to add is [docs/SETUP.md](docs/SETUP.md). The operating record is [docs/CENTRAL-REPORT.md](docs/CENTRAL-REPORT.md). The wider Central Report map is [docs/CENTRAL-REPORT-MASTER.md](docs/CENTRAL-REPORT-MASTER.md).

While `POST_TO_CENTRAL` is `false`, the 6:00 AM job sends nothing. Set that secret to `true` before 6:00 AM IST on a morning the central channel should receive the picture. The Run workflow button does not send a picture.

## Run locally

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
```

Put `SLACK_BOT_TOKEN` in `.env`. The bot is `daily_vini_report`, with scopes `chat:write`, `files:write`, and `im:write`. The sheet must stay shared so the PDF export can be downloaded.

```bash
.venv/bin/python -m central_analytics_report --dry-run
.venv/bin/python -m central_analytics_report --test
.venv/bin/python -m central_analytics_report --approve
.venv/bin/python -m central_analytics_report --scheduled
```

`--dry-run` writes `output/target-summary-daily-report.png` and `output/target-summary.png` and does not post. `--test` posts that picture to the bot DM only. `--approve` allows the team channel and does not post. `--scheduled` is the 6:00 AM path: it posts once, between 6:00 and 9:25 AM IST, and only when both approval gates are set.

## Clock

GitHub Actions runs this at 6:00 AM IST from `CENTRAL_REPORT_SLACK`. The steps are in [docs/SETUP.md](docs/SETUP.md). This computer is not the clock. `CENTRAL_REPORT_PAUSED` in `central_analytics_report/job.py` is `False`.

## Tests

```bash
.venv/bin/python -m unittest discover -s tests
```
