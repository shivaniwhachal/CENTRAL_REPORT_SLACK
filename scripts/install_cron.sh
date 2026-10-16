#!/usr/bin/env bash
# The 6:00 AM report is GitHub Actions on CENTRAL_REPORT_SLACK.
# This computer is not the clock. See docs/SETUP.md.

set -euo pipefail

LINE='*/5 0,1,2,3 * * * cd /workspace && flock -n /workspace/logs/report.lock /workspace/.venv/bin/python -m central_analytics_report --scheduled >> /workspace/logs/cron.log 2>&1'

if command -v crontab >/dev/null 2>&1; then
  current="$(crontab -l 2>/dev/null || true)"
  if grep -Fq "central_analytics_report --scheduled" <<<"$current"; then
    printf '%s\n' "$current" | grep -Fv "central_analytics_report --scheduled" | crontab - || true
    echo "Removed the old cron line from this computer."
  fi
fi

echo "This computer does not send the report."
echo "Add the secrets in docs/SETUP.md on https://github.com/shivaniwhachal/CENTRAL_REPORT_SLACK"
echo "Unused line, not installed: $LINE"
