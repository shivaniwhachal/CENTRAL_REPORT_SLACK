"""Turn the Daily report PDF into a PNG. Colors and numbers stay the sheet's."""

from __future__ import annotations

import urllib.request
from pathlib import Path

from PIL import Image

from central_analytics_report.sheet import export_url

USER_AGENT = "CentralDailyViniReport/1.0"
DAILY_NAME = "target-summary-daily-report.png"
LATEST_NAME = "target-summary.png"


def download_pdf(url: str | None = None, timeout: int = 60) -> bytes:
    target = url or export_url()
    request = urllib.request.Request(target, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = response.read()
    if not payload.startswith(b"%PDF"):
        raise RuntimeError(
            "Sheet export did not return a PDF. The Daily report tab must stay shared "
            "so this job can download the print."
        )
    return payload


def pdf_first_page_png(pdf_bytes: bytes, scale: float = 2) -> Image.Image:
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(pdf_bytes)
    try:
        if len(document) < 1:
            raise RuntimeError("Sheet PDF had no pages.")
        page = document[0]
        bitmap = page.render(scale=scale)
        return bitmap.to_pil().convert("RGB")
    finally:
        document.close()


def crop_empty_margin(image: Image.Image, threshold: int = 248, padding: int = 16) -> Image.Image:
    """Cut the blank page margin around the printed range."""
    rgb = image.convert("RGB")
    mask = rgb.convert("L").point(lambda pixel: 0 if pixel >= threshold else 255)
    box = mask.getbbox()
    if box is None:
        return rgb
    left, top, right, bottom = box
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(rgb.width, right + padding)
    bottom = min(rgb.height, bottom + padding)
    return rgb.crop((left, top, right, bottom))


def write_outputs(image: Image.Image, root: Path) -> tuple[Path, Path]:
    folder = root / "output"
    folder.mkdir(parents=True, exist_ok=True)
    daily = folder / DAILY_NAME
    latest = folder / LATEST_NAME
    image.save(daily, format="PNG")
    latest.write_bytes(daily.read_bytes())
    return daily, latest


def render_sheet(root: Path) -> Path:
    """Download B4:H22, keep the first page, crop the margin, write both PNGs."""
    image = crop_empty_margin(pdf_first_page_png(download_pdf()))
    daily, _latest = write_outputs(image, root)
    return daily
