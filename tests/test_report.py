"""Clock, message, approval, and one-send gate. No Slack and no sheet."""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from PIL import Image

from central_analytics_report.job import (
    CENTRAL_REPORT_PAUSED,
    approve,
    channel_is_approved,
    dm_note,
    report_filename,
    report_message,
    report_title,
    run_scheduled,
    run_test,
    sent_marker_path,
    window_status,
)
from central_analytics_report.render import crop_empty_margin
from central_analytics_report.sheet import export_url
from central_analytics_report.slack import SlackHistoryUnavailable

IST = ZoneInfo("Asia/Kolkata")
UTC = ZoneInfo("UTC")


def at_utc(year, month, day, hour, minute) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=UTC)


class FakeSlack:
    def __init__(self):
        self.uploads = []
        self.texts = []

    def upload_png(self, channel_id, png_bytes, filename, title, comment):
        self.uploads.append(
            {
                "channel_id": channel_id,
                "png_bytes": png_bytes,
                "filename": filename,
                "title": title,
                "comment": comment,
            }
        )
        return "FTESTFILE"

    def post_text(self, channel_id, text):
        self.texts.append((channel_id, text))

    def channel_has_title(self, channel_id, title):
        return False


def fake_render(root: Path) -> Path:
    folder = root / "output"
    folder.mkdir(parents=True, exist_ok=True)
    daily = folder / "target-summary-daily-report.png"
    daily.write_bytes(b"\x89PNG-test")
    (folder / "target-summary.png").write_bytes(b"\x89PNG-test")
    return daily


class ReportTests(unittest.TestCase):
    def setUp(self):
        self._env = os.environ.copy()
        os.environ["SLACK_CHANNEL_ID"] = "C0AULQ5F2D6"
        os.environ["SLACK_DM_CHANNEL_ID"] = "D0C40GC2CN8"
        os.environ["SLACK_NOTIFY_USER_ID"] = "UTESTUSER"
        os.environ.pop("REPORT_CHANNEL_APPROVED", None)
        os.environ.pop("POST_TO_CENTRAL", None)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._env)

    def test_title_is_the_previous_india_day(self):
        # 16 Oct 2026 00:30 UTC is 16 Oct 06:00 IST. The sheet is already on yesterday.
        now = at_utc(2026, 10, 16, 0, 30)
        self.assertEqual(report_title(now), "Daily VINI report 15 Oct")
        self.assertEqual(report_filename(now), "daily-vini-report-15-oct.png")

    def test_message_is_two_lines_with_the_wow_link(self):
        now = at_utc(2026, 10, 16, 0, 30)
        text = report_message(now)
        self.assertEqual(
            text,
            "Daily VINI report 15 Oct\n"
            "<https://docs.google.com/spreadsheets/d/1rNW65NGvWoNXxHI0pKM2kjgW8rZ6ZsoPqIlpa3CDMDc/edit#gid=1271063511|Here is the detailed view>",
        )
        self.assertEqual(
            dm_note(now),
            "Sent. Daily VINI report 15 Oct is in <#C0AULQ5F2D6>.",
        )

    def test_introduction_is_only_13_oct_2026(self):
        intro = report_message(at_utc(2026, 10, 13, 0, 30))
        self.assertIn("6:00 AM IST", intro)
        self.assertNotIn("Here is the detailed view", intro)
        later = report_message(at_utc(2026, 10, 14, 0, 30))
        self.assertTrue(later.startswith("Daily VINI report 13 Oct"))

    def test_window_waits_until_six_and_stops_after_nine_twenty_five(self):
        self.assertEqual(window_status(at_utc(2026, 10, 16, 0, 0)), "before")  # 5:30 IST
        self.assertEqual(window_status(at_utc(2026, 10, 16, 0, 25)), "before")  # 5:55 IST
        self.assertEqual(window_status(at_utc(2026, 10, 16, 0, 30)), "open")  # 6:00 IST
        self.assertEqual(window_status(at_utc(2026, 10, 16, 3, 55)), "open")  # 9:25 IST
        self.assertEqual(window_status(at_utc(2026, 10, 16, 3, 56)), "after")  # 9:26 IST

    def test_export_prints_b4_h22_and_does_not_unhide_rows(self):
        url = export_url()
        self.assertIn("gid=1544274662", url)
        self.assertIn("r1=3", url)
        self.assertIn("c1=1", url)
        self.assertIn("r2=22", url)
        self.assertIn("c2=8", url)
        self.assertNotIn("hidden", url.lower())
        self.assertNotIn("unhide", url.lower())

    def test_crop_drops_the_blank_page_margin(self):
        image = Image.new("RGB", (80, 60), "white")
        for x in range(20, 50):
            for y in range(15, 40):
                image.putpixel((x, y), (20, 40, 80))
        cropped = crop_empty_margin(image, padding=2)
        self.assertLess(cropped.width, 80)
        self.assertLess(cropped.height, 60)
        self.assertGreaterEqual(cropped.width, 30)
        self.assertGreaterEqual(cropped.height, 25)

    def test_scheduled_post_is_once_and_the_picture_stays_out_of_the_dm(self):
        now = at_utc(2026, 10, 16, 2, 35)  # 8:05 IST, inside the window
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            os.environ["POST_TO_CENTRAL"] = "true"
            slack = FakeSlack()
            self.assertEqual(run_scheduled(root, now, fake_render, slack), 0)
            self.assertEqual(len(slack.uploads), 1)
            self.assertEqual(slack.uploads[0]["channel_id"], "C0AULQ5F2D6")
            self.assertEqual(slack.uploads[0]["filename"], "daily-vini-report-15-oct.png")
            self.assertEqual(slack.uploads[0]["title"], "Daily VINI report 15 Oct")
            self.assertEqual(slack.texts, [("UTESTUSER", dm_note(now))])
            self.assertTrue(sent_marker_path(root, now).is_file())

            again = FakeSlack()
            self.assertEqual(run_scheduled(root, now, fake_render, again), 0)
            self.assertEqual(again.uploads, [])
            self.assertEqual(again.texts, [])

    def test_scheduled_does_not_post_when_the_channel_already_has_the_title(self):
        now = at_utc(2026, 10, 16, 0, 30)

        class Already(FakeSlack):
            def channel_has_title(self, channel_id, title):
                self.seen = (channel_id, title)
                return True

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            os.environ["POST_TO_CENTRAL"] = "true"
            slack = Already()
            self.assertEqual(run_scheduled(root, now, fake_render, slack), 0)
            self.assertEqual(slack.seen, ("C0AULQ5F2D6", "Daily VINI report 15 Oct"))
            self.assertEqual(slack.uploads, [])
            self.assertEqual(slack.texts, [])
            self.assertTrue(sent_marker_path(root, now).is_file())

    def test_unreadable_channel_history_still_posts_once(self):
        now = at_utc(2026, 10, 16, 0, 30)

        class NoHistory(FakeSlack):
            def channel_has_title(self, channel_id, title):
                raise SlackHistoryUnavailable("missing_scope")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            os.environ["POST_TO_CENTRAL"] = "true"
            slack = NoHistory()
            self.assertEqual(run_scheduled(root, now, fake_render, slack), 0)
            self.assertEqual(len(slack.uploads), 1)
            self.assertTrue(sent_marker_path(root, now).is_file())

    def test_a_failed_central_post_notifies_the_user(self):
        now = at_utc(2026, 10, 16, 0, 30)

        class BrokenSlack(FakeSlack):
            def upload_png(self, *args, **kwargs):
                raise RuntimeError("channel_not_found")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            os.environ["POST_TO_CENTRAL"] = "true"
            slack = BrokenSlack()
            self.assertEqual(run_scheduled(root, now, fake_render, slack), 1)
            self.assertEqual(
                slack.texts,
                [("UTESTUSER", "Daily VINI report was not sent. channel_not_found")],
            )
            self.assertFalse(sent_marker_path(root, now).exists())

    def test_false_sends_nothing_at_six(self):
        now = at_utc(2026, 10, 16, 0, 30)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            os.environ["POST_TO_CENTRAL"] = "false"
            os.environ["REPORT_CHANNEL_APPROVED"] = "true"
            (root / "channel_approved").write_text("approved\n")
            slack = FakeSlack()
            self.assertEqual(run_scheduled(root, now, fake_render, slack), 0)
            self.assertEqual(slack.uploads, [])
            self.assertEqual(
                slack.texts,
                [("UTESTUSER", "Daily VINI report was not sent. POST_TO_CENTRAL is false.")],
            )
            self.assertFalse(sent_marker_path(root, now).exists())

    def test_missing_token_waits_out_the_clock_then_refuses_the_post(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            os.environ["POST_TO_CENTRAL"] = "true"
            self.assertEqual(run_scheduled(root, at_utc(2026, 10, 16, 0, 0), fake_render, None), 0)
            self.assertEqual(run_scheduled(root, at_utc(2026, 10, 16, 0, 30), fake_render, None), 1)
            self.assertFalse(sent_marker_path(root, at_utc(2026, 10, 16, 0, 30)).exists())

    def test_before_six_and_after_the_window_do_not_post(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            os.environ["REPORT_CHANNEL_APPROVED"] = "true"
            (root / "channel_approved").write_text("approved\n")
            early = FakeSlack()
            self.assertEqual(run_scheduled(root, at_utc(2026, 10, 16, 0, 0), fake_render, early), 0)
            late = FakeSlack()
            self.assertEqual(run_scheduled(root, at_utc(2026, 10, 16, 4, 0), fake_render, late), 0)
            self.assertEqual(early.uploads, [])
            self.assertEqual(late.uploads, [])

    def test_paused_flag_is_off_and_blocks_when_forced(self):
        self.assertIs(CENTRAL_REPORT_PAUSED, False)
        import central_analytics_report.job as job

        now = at_utc(2026, 10, 16, 0, 30)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            os.environ["REPORT_CHANNEL_APPROVED"] = "true"
            (root / "channel_approved").write_text("approved\n")
            slack = FakeSlack()
            original = job.CENTRAL_REPORT_PAUSED
            job.CENTRAL_REPORT_PAUSED = True
            try:
                code = job.run_scheduled(root, now, fake_render, slack)
            finally:
                job.CENTRAL_REPORT_PAUSED = original
            self.assertEqual(code, 0)
            self.assertEqual(slack.uploads, [])

    def test_dm_only_does_not_touch_the_team_channel_or_the_marker(self):
        now = at_utc(2026, 10, 16, 0, 30)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            slack = FakeSlack()
            self.assertEqual(run_test(root, now, fake_render, slack), 0)
            self.assertEqual(slack.uploads[0]["channel_id"], "UTESTUSER")
            self.assertNotEqual(slack.uploads[0]["channel_id"], "C0AULQ5F2D6")
            self.assertEqual(slack.texts, [])
            self.assertFalse(sent_marker_path(root, now).exists())

    def test_approve_writes_both_gates_and_does_not_post(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".env.example").write_text("SLACK_BOT_TOKEN=\nREPORT_CHANNEL_APPROVED=false\n")
            self.assertEqual(approve(root, at_utc(2026, 10, 16, 0, 30)), 0)
            self.assertTrue((root / "channel_approved").is_file())
            text = (root / ".env").read_text()
            self.assertIn("REPORT_CHANNEL_APPROVED=true", text)
            self.assertIn("POST_TO_CENTRAL=true", text)
            self.assertTrue(channel_is_approved(root))


if __name__ == "__main__":
    unittest.main()
