#!/usr/bin/env python3
"""Fetch Google Scholar citation stats and write them to assets/data/scholar.json.

Uses the SerpAPI Google Scholar Author engine (https://serpapi.com/google-scholar-author-api).
A SERPAPI_KEY environment variable is required. If the API call fails, the previous
JSON is kept intact so the site never shows zeroed-out numbers.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

USER_ID = "dwSBmqkAAAAJ"
PROFILE_URL = f"https://scholar.google.com/citations?user={USER_ID}&hl=en"
SERPAPI_ENDPOINT = "https://serpapi.com/search.json"
OUTPUT_PATH = pathlib.Path(__file__).resolve().parent.parent / "assets" / "data" / "scholar.json"


def fetch_serpapi(api_key: str, timeout: int = 30) -> dict:
    params = {
        "engine": "google_scholar_author",
        "author_id": USER_ID,
        "hl": "en",
        "api_key": api_key,
    }
    url = f"{SERPAPI_ENDPOINT}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def parse_stats(payload: dict) -> dict[str, int]:
    """Extract the three 'all time' stats from SerpAPI's cited_by.table.

    The table is a list of three single-key dicts in the order:
      [{citations: {all, since_YYYY}}, {h_index: {...}}, {i10_index: {...}}]
    """
    if payload.get("error"):
        raise RuntimeError(f"SerpAPI error: {payload['error']}")

    cited_by = payload.get("cited_by") or {}
    table = cited_by.get("table") or []
    if not isinstance(table, list):
        raise RuntimeError(
            f"SerpAPI response cited_by.table is {type(table).__name__}, expected list"
        )

    def pick(key: str) -> int:
        for row in table:
            if not isinstance(row, dict) or key not in row:
                continue
            cell = row[key]
            if not isinstance(cell, dict):
                continue
            value = cell.get("all")
            if isinstance(value, int):
                return value
        raise RuntimeError(f"SerpAPI response missing cited_by.table[*].{key}.all")

    return {
        "citations": pick("citations"),
        "h_index": pick("h_index"),
        "i10_index": pick("i10_index"),
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
    api_key = os.environ.get("SERPAPI_KEY", "").strip()
    if not api_key:
        print(
            "[fetch_scholar] ERROR: SERPAPI_KEY env var is empty. "
            "Add a repo secret named SERPAPI_KEY (https://serpapi.com/manage-api-key).",
            file=sys.stderr,
        )
        return 1

    existing = load_existing()
    try:
        payload = fetch_serpapi(api_key)
        stats = parse_stats(payload)
    except (urllib.error.URLError, RuntimeError, TimeoutError, json.JSONDecodeError) as exc:
        print(
            f"[fetch_scholar] WARN: SerpAPI request failed — keeping previous data. {exc}",
            file=sys.stderr,
        )
        # Exit 0 so the workflow does not show a red X on transient API failures;
        # the previous scholar.json is left untouched.
        return 0

    out = {
        "source": PROFILE_URL,
        "updated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        **stats,
    }

    if (
        existing.get("citations") == out["citations"]
        and existing.get("h_index") == out["h_index"]
        and existing.get("i10_index") == out["i10_index"]
    ):
        print("[fetch_scholar] no change — skipping write")
        return 0

    write_json(out)
    print(
        f"[fetch_scholar] updated: citations={out['citations']}, "
        f"h-index={out['h_index']}, i10-index={out['i10_index']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
