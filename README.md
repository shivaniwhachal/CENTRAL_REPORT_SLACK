# Central Daily VINI report

At 6:00 AM India time this project prints one range of the Google Sheet tab **Daily report** and posts the PNG to `#central-analytics-programs`.

The numbers stay on the sheet. This program does not calculate them. The operating record is [docs/CENTRAL-REPORT.md](docs/CENTRAL-REPORT.md). The wider Central Report map (Sankey, VINI Views, OND WoW) is [docs/CENTRAL-REPORT-MASTER.md](docs/CENTRAL-REPORT-MASTER.md).

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

On the machine that holds this project at `/workspace`:

```bash
scripts/install_cron.sh
```

The installed check runs every 5 minutes from 5:30 AM IST through 9:25 AM IST. The post waits until 6:00. `CENTRAL_REPORT_PAUSED` in `central_analytics_report/job.py` is `False`.

## Tests

```bash
.venv/bin/python -m unittest discover -s tests
```
