#!/usr/bin/env bash
# Install the morning check on this UTC machine.
# The post itself waits until 6:00 AM IST and sends once.
# This script does not post.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/logs" "$ROOT/output"

if [[ "$ROOT" != "/workspace" ]]; then
  echo "The operating record installs the cron line for /workspace." >&2
  echo "This project is at $ROOT." >&2
  exit 1
fi

if [[ ! -x "$ROOT/.venv/bin/python" ]]; then
  python3 -m venv "$ROOT/.venv"
  "$ROOT/.venv/bin/pip" install -r "$ROOT/requirements.txt"
fi

LINE='*/5 0,1,2,3 * * * cd /workspace && flock -n /workspace/logs/report.lock /workspace/.venv/bin/python -m central_analytics_report --scheduled >> /workspace/logs/cron.log 2>&1'

current="$(crontab -l 2>/dev/null || true)"
if grep -Fqx "$LINE" <<<"$current"; then
  echo "Cron line already installed."
  exit 0
fi

{
  if [[ -n "$current" ]]; then
    printf '%s\n' "$current"
  fi
  printf '%s\n' "$LINE"
} | crontab -

echo "Installed: $LINE"
