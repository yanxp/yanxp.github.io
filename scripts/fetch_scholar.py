#!/usr/bin/env python3
"""Fetch Google Scholar citation stats and write them to assets/data/scholar.json.

Scrapes the public profile page (no API key needed). If scraping fails, keeps
the previous JSON intact so the site never shows zeroed-out numbers.
"""
from __future__ import annotations

import datetime as _dt
import json
import pathlib
import re
import sys
import urllib.request
import urllib.error

USER_ID = "dwSBmqkAAAAJ"
PROFILE_URL = f"https://scholar.google.com/citations?user={USER_ID}&hl=en"
OUTPUT_PATH = pathlib.Path(__file__).resolve().parent.parent / "assets" / "data" / "scholar.json"

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


def fetch_html(url: str, timeout: int = 20) -> str:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_stats(html: str) -> dict[str, int]:
    """Extract the three 'all time' stats from the gsc_rsb_std cells.

    The Scholar stats table renders 6 cells in order:
    [citations_all, citations_since, h_index_all, h_index_since,
     i10_all, i10_since]. We only keep the 'all time' values.
    """
    cells = re.findall(r'<td class="gsc_rsb_std">(\d+)</td>', html)
    if len(cells) < 6:
        raise RuntimeError(
            f"Scholar page layout changed: expected >=6 gsc_rsb_std cells, got {len(cells)}"
        )
    return {
        "citations": int(cells[0]),
        "h_index": int(cells[2]),
        "i10_index": int(cells[4]),
    }


def load_existing() -> dict:
    if OUTPUT_PATH.exists():
        try:
            return json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def write_json(data: dict) -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    existing = load_existing()
    try:
        html = fetch_html(PROFILE_URL)
        stats = parse_stats(html)
    except (urllib.error.URLError, RuntimeError, TimeoutError) as exc:
        print(f"[fetch_scholar] WARN: scraping failed — keeping previous data. {exc}",
              file=sys.stderr)
        return 1

    payload = {
        "source": "https://scholar.google.com/citations?user=" + USER_ID,
        "updated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        **stats,
    }

    if (
        existing.get("citations") == payload["citations"]
        and existing.get("h_index") == payload["h_index"]
        and existing.get("i10_index") == payload["i10_index"]
    ):
        print("[fetch_scholar] no change — skipping write")
        return 0

    write_json(payload)
    print(
        f"[fetch_scholar] updated: citations={payload['citations']}, "
        f"h-index={payload['h_index']}, i10-index={payload['i10_index']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
