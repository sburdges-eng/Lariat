#!/usr/bin/env python3
"""Ingest Toast LaborBreakDown_*.zip exports into SQLite.

The zip contains two CSVs:
    Labor cost summary.csv      Period-aggregate labor metrics (single row).
                                7 columns: net sales, gross sales, labor cost,
                                labor % (net), SPLH (net), SLPH (gross),
                                labor % (gross).
    Labor cost by job.csv       Per-employee-per-job breakdown for the period.
                                17 columns: Department, hourOfDay, restaurantGuid,
                                Regular/Overtime/Total hours, Regular/Overtime/Total
                                cost, Labor % (net), Labor % (gross), Last Name,
                                First Name, Chosen Name, Job code, Job title, Day.

Two tables:
    toast_labor_summary         One row per (location_id, period_start, period_end).
                                Captured as flat columns matching the CSV
                                headers, plus the ingest provenance.
    toast_labor_by_job          One row per employee×job for the period. The
                                per-employee detail; useful for SPLH, OT %,
                                role mix, retention analytics.

The period (start, end) is parsed from the zip filename
    LaborBreakDown_<YYYY-MM-DD>_<YYYY-MM-DD>.zip

Idempotent full-refresh per (location_id, period_start, period_end) — a
re-ingest of the same zip overwrites prior rows for that period inside a
single transaction.

CLI:
    python3 scripts/ingest_toast_labor.py --zip path/to/LaborBreakDown_…zip
    python3 scripts/ingest_toast_labor.py --zip … --location lariat-tn
    python3 scripts/ingest_toast_labor.py --zip … --db /custom/path.db
"""

from __future__ import annotations

import argparse
import csv
import re
import sqlite3
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "lariat.db"

# ── DDL ─────────────────────────────────────────────────────────────

DDL = (
    """
    CREATE TABLE IF NOT EXISTS toast_labor_summary (
        location_id     TEXT NOT NULL,
        period_start    TEXT NOT NULL,
        period_end      TEXT NOT NULL,
        net_sales       REAL,
        gross_sales     REAL,
        labor_cost      REAL,
        labor_pct_net   REAL,
        splh_net        REAL,
        slph_gross      REAL,
        labor_pct_gross REAL,
        source_zip      TEXT,
        ingested_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (location_id, period_start, period_end)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS toast_labor_by_job (
        location_id      TEXT NOT NULL,
        period_start     TEXT NOT NULL,
        period_end       TEXT NOT NULL,
        department       TEXT,
        hour_of_day      TEXT,
        restaurant_guid  TEXT,
        regular_hours    REAL,
        overtime_hours   REAL,
        total_hours      REAL,
        regular_cost     REAL,
        overtime_cost    REAL,
        total_cost       REAL,
        labor_pct_net    REAL,
        labor_pct_gross  REAL,
        last_name        TEXT,
        first_name       TEXT,
        chosen_name      TEXT,
        job_code         TEXT,
        job_title        TEXT,
        day              TEXT,
        source_zip       TEXT,
        ingested_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_toast_labor_by_job_period
        ON toast_labor_by_job(location_id, period_start, period_end)
    """,
)

# ── Parsing helpers ─────────────────────────────────────────────────


def _to_float(s: str) -> float | None:
    """CSV numerics arrive as strings; "" / "-" / non-numeric → None."""
    if s is None:
        return None
    t = s.strip()
    if not t or t == "-":
        return None
    # Strip thousands separators if Toast ever emits them; '.' is decimal.
    t = t.replace(",", "")
    try:
        return float(t)
    except ValueError:
        return None


def _to_text(s: str | None) -> str | None:
    if s is None:
        return None
    t = s.strip()
    return t or None


def _period_from_filename(zip_path: Path) -> tuple[str, str]:
    """Extract (period_start, period_end) ISO dates from the zip filename.
    Matches `LaborBreakDown_YYYY-MM-DD_YYYY-MM-DD.zip`. Falls back to
    ('', '') if the pattern doesn't match — the caller can override via
    --period-start / --period-end if needed."""
    m = re.search(r"_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.zip$", zip_path.name)
    if not m:
        return ("", "")
    return (m.group(1), m.group(2))


def _read_csv(zf: zipfile.ZipFile, member: str) -> list[dict[str, str]]:
    with zf.open(member) as fh:
        text = fh.read().decode("utf-8-sig")
    reader = csv.DictReader(text.splitlines())
    return list(reader)


# ── Ingest steps ─────────────────────────────────────────────────────


def ingest_summary(
    db: sqlite3.Connection,
    rows: list[dict[str, str]],
    *,
    location_id: str,
    period_start: str,
    period_end: str,
    source_zip: str,
) -> int:
    if not rows:
        return 0
    # The summary CSV has exactly one data row.
    r = rows[0]
    db.execute(
        "DELETE FROM toast_labor_summary "
        "WHERE location_id = ? AND period_start = ? AND period_end = ?",
        (location_id, period_start, period_end),
    )
    db.execute(
        """
        INSERT INTO toast_labor_summary (
            location_id, period_start, period_end,
            net_sales, gross_sales, labor_cost,
            labor_pct_net, splh_net, slph_gross, labor_pct_gross,
            source_zip
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            location_id,
            period_start,
            period_end,
            _to_float(r.get("Net sales", "")),
            _to_float(r.get("Gross sales", "")),
            _to_float(r.get("Labor cost", "")),
            _to_float(r.get("Labor % (net)", "")),
            _to_float(r.get("SPLH (net)", "")),
            _to_float(r.get("SLPH (gross)", "")),
            _to_float(r.get("Labor % (gross)", "")),
            source_zip,
        ),
    )
    return 1


def ingest_by_job(
    db: sqlite3.Connection,
    rows: list[dict[str, str]],
    *,
    location_id: str,
    period_start: str,
    period_end: str,
    source_zip: str,
) -> int:
    db.execute(
        "DELETE FROM toast_labor_by_job "
        "WHERE location_id = ? AND period_start = ? AND period_end = ?",
        (location_id, period_start, period_end),
    )
    if not rows:
        return 0
    payload = [
        (
            location_id,
            period_start,
            period_end,
            _to_text(r.get("Department")),
            _to_text(r.get("hourOfDay")),
            _to_text(r.get("restaurantGuid")),
            _to_float(r.get("Regular hours", "")),
            _to_float(r.get("Overtime hours", "")),
            _to_float(r.get("Total hours", "")),
            _to_float(r.get("Regular cost", "")),
            _to_float(r.get("Overtime cost", "")),
            _to_float(r.get("Total cost", "")),
            _to_float(r.get("Labor % (net)", "")),
            _to_float(r.get("Labor % (gross)", "")),
            _to_text(r.get("Last Name")),
            _to_text(r.get("First Name")),
            _to_text(r.get("Chosen Name")),
            _to_text(r.get("Job code")),
            _to_text(r.get("Job title")),
            _to_text(r.get("Day")),
            source_zip,
        )
        for r in rows
    ]
    db.executemany(
        """
        INSERT INTO toast_labor_by_job (
            location_id, period_start, period_end,
            department, hour_of_day, restaurant_guid,
            regular_hours, overtime_hours, total_hours,
            regular_cost, overtime_cost, total_cost,
            labor_pct_net, labor_pct_gross,
            last_name, first_name, chosen_name,
            job_code, job_title, day,
            source_zip
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        payload,
    )
    return len(payload)


# ── Main ─────────────────────────────────────────────────────────────


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--zip", type=Path, required=True, help="LaborBreakDown_*.zip path")
    p.add_argument("--location", default="default", help="location_id (default: 'default')")
    p.add_argument("--period-start", help="Override YYYY-MM-DD start (else parsed from filename)")
    p.add_argument("--period-end", help="Override YYYY-MM-DD end (else parsed from filename)")
    p.add_argument("--db", type=Path, default=DEFAULT_DB, help=f"SQLite DB (default: {DEFAULT_DB})")
    args = p.parse_args()

    if not args.zip.exists():
        print(f"✗ zip not found: {args.zip}", file=sys.stderr)
        return 1

    period_start, period_end = _period_from_filename(args.zip)
    if args.period_start:
        period_start = args.period_start
    if args.period_end:
        period_end = args.period_end
    if not period_start or not period_end:
        print(
            "✗ could not parse period from filename and --period-start/--period-end "
            "not provided. Filename must look like LaborBreakDown_YYYY-MM-DD_YYYY-MM-DD.zip",
            file=sys.stderr,
        )
        return 1

    print("Toast labor ingest")
    print(f"  zip:      {args.zip}")
    print(f"  location: {args.location}")
    print(f"  period:   {period_start} → {period_end}")
    print(f"  db:       {args.db}")

    db = sqlite3.connect(str(args.db))
    try:
        for ddl in DDL:
            db.execute(ddl)
        db.commit()

        with zipfile.ZipFile(args.zip, "r") as zf:
            members = {name: name for name in zf.namelist()}
            summary_name = next(
                (m for m in members if m.lower() == "labor cost summary.csv"), None
            )
            byjob_name = next(
                (m for m in members if m.lower() == "labor cost by job.csv"), None
            )
            if not summary_name or not byjob_name:
                print(
                    f"✗ expected 'Labor cost summary.csv' and 'Labor cost by job.csv' in {args.zip.name}; got {list(members)}",
                    file=sys.stderr,
                )
                return 1

            summary_rows = _read_csv(zf, summary_name)
            byjob_rows = _read_csv(zf, byjob_name)

        with db:  # single transaction
            n_summary = ingest_summary(
                db,
                summary_rows,
                location_id=args.location,
                period_start=period_start,
                period_end=period_end,
                source_zip=args.zip.name,
            )
            n_byjob = ingest_by_job(
                db,
                byjob_rows,
                location_id=args.location,
                period_start=period_start,
                period_end=period_end,
                source_zip=args.zip.name,
            )

        print(f"  ✓ summary rows: {n_summary}")
        print(f"  ✓ by-job rows:  {n_byjob}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
