#!/usr/bin/env python3
"""Ingest the master workbook's hand-curated `📋 BEO Prep` sheet into
``beo_prep_history``.

Source: ``XL/Lariat Master Workbook.xlsx`` → sheet ``📋 BEO Prep``
   (originals were moved to ~/Dev/_archives/lariat-pre-scrub-2026-04-18/
   on 2026-04-18; this script reads them in place.)

Sheet layout (header in row 1, data row-by-row after):
    Client | Event Date | Type | Item | Amount/Qty | Prep Day | Pre-Prep | Plating

  - Client / Event Date are repeated per row (one row per item per event).
  - Type is one of 'Main Item', 'Secondary Prep', 'Special Sauce'.
  - Amount/Qty is numeric for Main Item rows but descriptive for Secondary
    Prep / Special Sauce rows ("Special Sauce", "Nash Oil", …) — stored as
    text in the table to keep the union honest.

Strategy: full refresh per source label.
    DELETE WHERE location_id=<loc> AND source=<label>
    then bulk INSERT — single transaction with rollback on error.
    Other source labels (e.g. future per-event Kitchen Sheet ingest) are
    untouched.

Usage::

    python3 scripts/ingest_beo_prep_history.py            # write
    python3 scripts/ingest_beo_prep_history.py --dry-run  # preview only
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path
from typing import Any

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_XLSX = Path(
    "/Users/seanburdges/Dev/_archives/lariat-pre-scrub-2026-04-18/"
    "XL/Lariat Master Workbook.xlsx"
)
DEFAULT_DB = ROOT / "data" / "lariat.db"
DEFAULT_SOURCE = "master_workbook_2026-04-18"
SHEET_NAME = "📋 BEO Prep"


def _format_event_date(v: Any) -> str | None:
    if v is None:
        return None
    if hasattr(v, "date") and callable(v.date):
        return v.date().isoformat()
    if hasattr(v, "isoformat"):
        return v.isoformat()
    s = str(v).strip()
    return s or None


def _amount_qty_text(v: Any) -> str | None:
    """Numeric amounts and descriptive labels coexist in this column —
    coerce both to text so we can union them in TEXT storage."""
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v).strip()
    return s or None


def load_rows(xlsx_path: Path) -> list[dict]:
    """Return parsed rows from the master `📋 BEO Prep` sheet."""
    wb = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)
    try:
        ws = wb[SHEET_NAME]
    except KeyError:
        wb.close()
        return []

    rows: list[dict] = []
    started = False
    for row in ws.iter_rows(values_only=True):
        if not row:
            continue
        if not started:
            # Header row literally starts with 'Client'.
            if row[0] == "Client":
                started = True
            continue
        if not any(v not in (None, "") for v in row):
            continue
        padded = list(row) + [None] * (8 - len(row))
        item = (str(padded[3]).strip() if padded[3] else None)
        if not item:
            # An item is required — skip otherwise (matches table NOT NULL).
            continue
        rows.append(
            {
                "client": str(padded[0]).strip() if padded[0] else None,
                "event_date": _format_event_date(padded[1]),
                "type": str(padded[2]).strip() if padded[2] else None,
                "item": item,
                "amount_qty": _amount_qty_text(padded[4]),
                "prep_day": str(padded[5]).strip() if padded[5] else None,
                "pre_prep_notes": str(padded[6]).strip() if padded[6] else None,
                "plating_notes": str(padded[7]).strip() if padded[7] else None,
            }
        )
    wb.close()
    return rows


def upsert(
    db_path: Path,
    rows: list[dict],
    *,
    location_id: str,
    source: str,
) -> int:
    """Refresh-and-insert all rows for (location_id, source) in one transaction."""
    con = sqlite3.connect(str(db_path))
    try:
        con.execute("BEGIN")
        con.execute(
            "DELETE FROM beo_prep_history WHERE location_id = ? AND source = ?",
            (location_id, source),
        )
        con.executemany(
            """INSERT INTO beo_prep_history
                 (location_id, client, event_date, event_file, type, item,
                  amount_qty, prep_day, pre_prep_notes, plating_notes, source)
               VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    location_id,
                    r["client"],
                    r["event_date"],
                    r["type"],
                    r["item"],
                    r["amount_qty"],
                    r["prep_day"],
                    r["pre_prep_notes"],
                    r["plating_notes"],
                    source,
                )
                for r in rows
            ],
        )
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()
    return len(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Ingest master 'BEO Prep' sheet into beo_prep_history",
    )
    ap.add_argument("--xlsx", default=str(DEFAULT_XLSX))
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--location-id", default="default")
    ap.add_argument("--source", default=DEFAULT_SOURCE)
    ap.add_argument(
        "--dry-run", action="store_true",
        help="parse and report without writing to the database",
    )
    args = ap.parse_args(argv)

    xlsx = Path(args.xlsx)
    if not xlsx.exists():
        print(f"[ingest] error: master xlsx not found at {xlsx}", file=sys.stderr)
        return 2

    rows = load_rows(xlsx)
    print(f"[ingest] read {len(rows)} rows from {xlsx} sheet '{SHEET_NAME}'")

    if args.dry_run:
        print("[ingest] --dry-run: not writing to db")
        return 0

    written = upsert(
        Path(args.db),
        rows,
        location_id=args.location_id,
        source=args.source,
    )
    print(
        f"[ingest] wrote {written} rows to beo_prep_history "
        f"(location_id={args.location_id!r}, source={args.source!r})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
