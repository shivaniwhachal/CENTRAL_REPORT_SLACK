"""Daily report sheet. This module names the range. It does not calculate it."""

from urllib.parse import urlencode

SPREADSHEET_ID = "1rNW65NGvWoNXxHI0pKM2kjgW8rZ6ZsoPqIlpa3CDMDc"
TAB_NAME = "Daily report"
TAB_GID = 1544274662
RANGE_A1 = "B4:H22"

# Google's PDF export takes 0-based bounds. r1 and c1 are inclusive.
# r2 and c2 are exclusive. B4:H22 is rows [3, 22) and columns [1, 8).
PDF_R1 = 3
PDF_C1 = 1
PDF_R2 = 22
PDF_C2 = 8

DETAILED_VIEW_GID = 1271063511
DETAILED_VIEW_URL = (
    "https://docs.google.com/spreadsheets/d/"
    f"{SPREADSHEET_ID}/edit#gid={DETAILED_VIEW_GID}"
)

# #central-analytics-programs
TEAM_CHANNEL_ID = "C0AULQ5F2D6"
# daily_vini_report bot DM. The morning picture is not copied here.
BOT_DM_CHANNEL_ID = "D0C40GC2CN8"


def export_url() -> str:
    """PDF of the Daily report print range.

    Hidden rows stay hidden. The query does not unhide them.
    """
    query = urlencode(
        [
            ("format", "pdf"),
            ("gid", str(TAB_GID)),
            ("size", "A4"),
            ("portrait", "true"),
            ("fitw", "true"),
            ("sheetnames", "false"),
            ("printtitle", "false"),
            ("pagenumbers", "false"),
            ("gridlines", "false"),
            ("fzr", "false"),
            ("top_margin", "0.25"),
            ("bottom_margin", "0.25"),
            ("left_margin", "0.25"),
            ("right_margin", "0.25"),
            ("horizontal_alignment", "CENTER"),
            ("vertical_alignment", "TOP"),
            ("r1", str(PDF_R1)),
            ("c1", str(PDF_C1)),
            ("r2", str(PDF_R2)),
            ("c2", str(PDF_C2)),
        ]
    )
    return f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/export?{query}"
