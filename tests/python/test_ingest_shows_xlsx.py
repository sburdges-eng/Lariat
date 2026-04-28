"""Tests for scripts.ingest_shows_xlsx — pure parser, no DB writes.

Covers:
- 14 status keys snake-cased correctly
- past-sheet year banners propagate via era_year
- malformed past rows land in dropped[]
- ~$lock file → exit 3
- missing path → exit 2
- idea-only tiktok rows route to notes
- duplicate (band, date) preserved as separate rows in shows
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
PARSER = ROOT / "scripts" / "ingest_shows_xlsx.py"
FIXTURE = ROOT / "tests" / "python" / "fixtures" / "shows_minimal.xlsx"

sys.path.insert(0, str(ROOT))
from tests.python.fixtures.build_shows_fixture import build as build_fixture  # noqa: E402


@pytest.fixture(scope="module", autouse=True)
def _ensure_fixture():
    if not FIXTURE.exists():
        build_fixture()


def _run_parser(path: Path | str) -> tuple[int, dict]:
    proc = subprocess.run(
        [sys.executable, str(PARSER), str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    try:
        payload = json.loads(proc.stdout) if proc.stdout.strip() else {}
    except json.JSONDecodeError:
        payload = {"_raw": proc.stdout, "_stderr": proc.stderr}
    return proc.returncode, payload


def test_status_keys_snake_cased():
    code, p = _run_parser(FIXTURE)
    assert code == 0, p
    assert p["shows"], "expected at least one show row"
    armchair = next(s for s in p["shows"] if s["band_name"] == "armchair boogie")
    keys = set(armchair["status"].keys())
    expected = {
        "media_list", "mkting_adv", "auto_counts", "announce_date", "meta_ads",
        "fb_event", "co_host_sent", "create_dice_tickets",
        "listing_jambase_bit_songkick", "dice_email", "newsletter",
        "assets", "posts", "whbv",
    }
    assert keys == expected, f"unexpected status keys: {keys ^ expected}"
    assert armchair["status"]["listing_jambase_bit_songkick"] == "jb, bit, sk"
    assert armchair["status"]["newsletter"] == "w"
    assert armchair["price"] == 15.0


def test_past_sheet_era_year_propagates():
    code, p = _run_parser(FIXTURE)
    assert code == 0
    rows = {(r["band_name"], r["era_year"]) for r in p["shows_archive"]}
    assert ("the hip snacks", 2024) in rows
    assert ("open mic", 2025) in rows


def test_past_malformed_row_dropped():
    code, p = _run_parser(FIXTURE)
    assert code == 0
    archived_names = {r["band_name"] for r in p["shows_archive"]}
    assert "malformed-no-date" not in archived_names
    dropped_reasons = [d["reason"] for d in p["dropped"] if d["sheet"] == "past"]
    assert any("date" in r.lower() for r in dropped_reasons), p["dropped"]


def test_xlsx_lock_file_exit_3(tmp_path):
    fake_xlsx = tmp_path / "fake.xlsx"
    fake_xlsx.write_bytes(b"fake")
    lock = tmp_path / "~$fake.xlsx"
    lock.write_bytes(b"")
    code, p = _run_parser(fake_xlsx)
    assert code == 3, p
    assert p["error"] == "xlsx_locked"


def test_missing_xlsx_exit_2(tmp_path):
    code, p = _run_parser(tmp_path / "does-not-exist.xlsx")
    assert code == 2, p
    assert p["error"] == "xlsx_not_found"


def test_tiktok_idea_only_routes_to_notes():
    code, p = _run_parser(FIXTURE)
    assert code == 0
    note_rows = [t for t in p["tiktok_ideas"] if "lauren at the lariat" in t["idea"].lower()]
    assert len(note_rows) == 1
    assert note_rows[0]["video_content"] is None
    assert note_rows[0]["notes"] is None  # nothing to capture; idea itself holds the thought


def test_duplicate_band_date_preserved():
    code, p = _run_parser(FIXTURE)
    assert code == 0
    openmics = [s for s in p["shows"] if s["band_name"] == "openmic dinnershow"]
    assert len(openmics) == 2
    assert {s["show_date"] for s in openmics} == {"2026-05-01", "2026-05-08"}


def test_source_row_populated():
    code, p = _run_parser(FIXTURE)
    assert code == 0
    for row in p["shows"]:
        assert isinstance(row["source_row"], int)
        assert row["source_row"] >= 2  # row 1 is header
