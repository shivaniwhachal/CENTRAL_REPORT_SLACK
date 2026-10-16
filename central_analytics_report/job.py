"""6:00 AM IST Central Daily VINI report.

The Daily report numbers are formulas on the Google Sheet. This job does not
calculate them. It prints the range and posts the picture.

CENTRAL_REPORT_PAUSED stops the morning post when set to True.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from central_analytics_report.sheet import (
    BOT_DM_CHANNEL_ID,
    DETAILED_VIEW_URL,
    TEAM_CHANNEL_ID,
)

IST = ZoneInfo("Asia/Kolkata")
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
INTRODUCTION_DAY = datetime(2026, 10, 13, tzinfo=IST).date()

# The report is not paused.
CENTRAL_REPORT_PAUSED = False

WINDOW_OPEN = 6 * 60
WINDOW_CLOSE = 9 * 60 + 25


def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def load_env(root: Path) -> None:
    path = root / ".env"
    if not path.is_file():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def team_channel() -> str:
    return os.environ.get("SLACK_CHANNEL_ID", TEAM_CHANNEL_ID).strip() or TEAM_CHANNEL_ID


def notify_target() -> str:
    """Who receives the test picture, and the 'Sent' note after a central post."""
    user_id = os.environ.get("SLACK_NOTIFY_USER_ID", "").strip()
    if user_id:
        return user_id
    return os.environ.get("SLACK_DM_CHANNEL_ID", BOT_DM_CHANNEL_ID).strip() or BOT_DM_CHANNEL_ID


def post_to_central() -> bool:
    """Central stays off unless this is the exact word true."""
    return os.environ.get("POST_TO_CENTRAL", "").strip().lower() == "true"


def ist_now(now: datetime | None = None) -> datetime:
    current = now or datetime.now(IST)
    if current.tzinfo is None:
        current = current.replace(tzinfo=IST)
    return current.astimezone(IST)


def window_status(now: datetime) -> str:
    local = ist_now(now)
    minutes = local.hour * 60 + local.minute
    if minutes < WINDOW_OPEN:
        return "before"
    if minutes <= WINDOW_CLOSE:
        return "open"
    return "after"


def report_day(now: datetime):
    return ist_now(now).date() - timedelta(days=1)


def report_title(now: datetime) -> str:
    day = report_day(now)
    return f"Daily VINI report {day.day} {MONTHS[day.month - 1]}"


def report_filename(now: datetime) -> str:
    return report_title(now).lower().replace(" ", "-") + ".png"


def report_message(now: datetime) -> str:
    """Two lines from 14 Oct 2026 on. The 13 Oct introduction is not used again."""
    if ist_now(now).date() == INTRODUCTION_DAY:
        return "The daily VINI summary will be shared automatically around 6:00 AM IST."
    title = report_title(now)
    return f"{title}\n<{DETAILED_VIEW_URL}|Here is the detailed view>"


def dm_note() -> str:
    return f"Sent. The daily VINI summary is now in <#{team_channel()}>."


def sent_marker_path(root: Path, now: datetime) -> Path:
    day = ist_now(now).date().isoformat()
    return root / "logs" / f"central-sent-{day}"


def channel_is_approved(root: Path) -> bool:
    flag = os.environ.get("REPORT_CHANNEL_APPROVED", "").strip().lower() == "true"
    return flag and (root / "channel_approved").is_file()


def log(message: str, now: datetime | None = None) -> None:
    stamp = ist_now(now).strftime("%Y-%m-%d %H:%M IST")
    print(f"{stamp} {message}", flush=True)


def _set_env_line(path: Path, key: str, value: str) -> None:
    lines = path.read_text().splitlines() if path.is_file() else []
    replaced = False
    output = []
    for line in lines:
        if line.startswith(f"{key}=") or line.startswith(f"{key} ="):
            output.append(f"{key}={value}")
            replaced = True
        else:
            output.append(line)
    if not replaced:
        output.append(f"{key}={value}")
    path.write_text("\n".join(output).rstrip() + "\n")


def approve(root: Path, now: datetime | None = None) -> int:
    """Arm the central channel for the next 6:00 AM run. Do not post."""
    (root / "channel_approved").write_text("approved\n")
    env_path = root / ".env"
    if not env_path.is_file():
        example = root / ".env.example"
        env_path.write_text(example.read_text() if example.is_file() else "")
    _set_env_line(env_path, "REPORT_CHANNEL_APPROVED", "true")
    _set_env_line(env_path, "POST_TO_CENTRAL", "true")
    os.environ["REPORT_CHANNEL_APPROVED"] = "true"
    os.environ["POST_TO_CENTRAL"] = "true"
    log("Central channel armed for the next 6:00 AM run. No post sent.", now)
    return 0


def run_dry(root: Path, now: datetime, render) -> int:
    daily = render(root)
    latest = root / "output" / "target-summary.png"
    log("Dry run. No Slack post.", now)
    print(report_message(now), flush=True)
    print(daily, flush=True)
    print(latest, flush=True)
    return 0


def _refuse_if_target_is_central(target: str, now: datetime) -> bool:
    if target != team_channel():
        return False
    log("Refusing to post. That destination is the central channel.", now)
    return True


def _upload_picture(slack, now: datetime, daily: Path, destination: str) -> str:
    return slack.upload_png(
        destination,
        daily.read_bytes(),
        report_filename(now),
        report_title(now),
        report_message(now),
    )


def run_test(root: Path, now: datetime, render, slack) -> int:
    target = notify_target()
    if _refuse_if_target_is_central(target, now):
        return 1
    daily = render(root)
    file_id = _upload_picture(slack, now, daily, target)
    log(
        f"Posted the picture to {target}, Slack file {file_id}. "
        "Central channel was not posted.",
        now,
    )
    return 0


def run_scheduled(root: Path, now: datetime, render, slack) -> int:
    if CENTRAL_REPORT_PAUSED:
        log("CENTRAL_REPORT_PAUSED is True. Not posting.", now)
        return 0

    status = window_status(now)
    if status == "before":
        log("Before 6:00 AM IST. Not posting yet.", now)
        return 0
    if status == "after":
        log("After 9:25 AM IST. No further check until the next morning.", now)
        return 0

    marker = sent_marker_path(root, now)
    if marker.is_file():
        log(f"Already sent ({marker.name}); skipping.", now)
        return 0

    # False, missing, or any other value: the morning job sends nothing.
    # A hand run (--test) is the bot DM. Only the word true posts to central.
    if not post_to_central():
        log("POST_TO_CENTRAL is false. Nothing sent.", now)
        return 0

    if slack is None:
        log("SLACK_BOT_TOKEN is not set. Not posting.", now)
        return 1

    daily = render(root)

    channel = team_channel()
    file_id = _upload_picture(slack, now, daily, channel)
    # The picture is already in the team channel. Write the marker before the
    # DM so a later check cannot post the picture a second time.
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(f"Posted to {channel}, Slack file {file_id}.\n")
    try:
        slack.post_text(notify_target(), dm_note())
    except Exception as exc:
        log(f"Posted to {channel}, Slack file {file_id}. Bot DM failed: {exc}", now)
        return 0
    log(f"Posted to {channel}, Slack file {file_id}. Bot DM notified.", now)
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Print the Daily report sheet and post it to Slack at 6:00 AM IST."
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Render the PNG. Do not post.")
    mode.add_argument("--test", action="store_true", help="Post the picture to the bot DM only.")
    mode.add_argument("--scheduled", action="store_true", help="6:00 AM path. Posts once.")
    mode.add_argument("--approve", action="store_true", help="Allow the team channel. Do not post.")
    return parser


def main(argv: list[str] | None = None, now: datetime | None = None, root: Path | None = None) -> int:
    args = _build_parser().parse_args(argv)
    root = root or project_root()
    load_env(root)
    current = ist_now(now)

    if args.approve:
        return approve(root, current)

    from central_analytics_report.render import render_sheet
    from central_analytics_report.slack import SlackClient

    if args.dry_run:
        return run_dry(root, current, render_sheet)

    token = os.environ.get("SLACK_BOT_TOKEN", "").strip()
    slack = SlackClient(token) if token else None
    if args.test and slack is None:
        log("SLACK_BOT_TOKEN is not set. Not posting.", current)
        return 1
    try:
        if args.test:
            return run_test(root, current, render_sheet, slack)
        return run_scheduled(root, current, render_sheet, slack)
    except Exception as exc:
        log(f"Failed: {exc}", current)
        return 1


if __name__ == "__main__":
    sys.exit(main())
