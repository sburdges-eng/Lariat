#!/usr/bin/env python3
"""Ingest 18 untapped Toast SalesSummary report CSVs into `toast_sales_summary`.

Source: data/originals/Toast/RevanueandLabor/SalesSummary_2020-04-06_2026-04-12.zip
        (originals were moved to ~/Dev/_archives/lariat-pre-scrub-2026-04-18/
         on 2026-04-18; this script reads them in place from the archive).

The zip contains 21 CSVs covering the period 2020-04-06 through 2026-04-12.
Three of them are already ingested into dedicated tables:
    Sales by day.csv          -> toast_sales_daily
    Day of week (totals).csv  -> toast_sales_dow
    Time of day (totals).csv  -> toast_sales_hour

The remaining 18 files are tiny key/value summary tables (most under 1 KB).
Rather than spawn 18 narrow tables, we land them all in a generic
key/value store keyed by (report, period_label, row_label, metric).

Two CSV shapes appear:
  (A) Multi-row tables: first column is a row label (Sales category,
      Payment type, Discount, Service mode, Revenue center, Dining option,
      Service charge, Service / day part, Tax rate, Deferred type),
      remaining columns are metrics. We emit one row per (label, metric).
  (B) Single-row tables (no labelled axis): header row + one data row
      (Revenue summary, Net sales summary, Tip summary, Cash activity,
      Cash summary, Unpaid orders summary, Void summary). For these we
      use row_label='__totals__' and emit one row per (metric).

Strategy: idempotent full-refresh per report. For each CSV we DELETE
WHERE report=? AND period_label=? AND location_id='default' then bulk
INSERT inside a single transaction so a mid-insert failure rolls back
rather than losing the prior copy.
"""

from __future__ import annotations

import argparse
import csv
import re
import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ZIP = (
    Path("/Users/seanburdges/Dev/_archives/lariat-pre-scrub-2026-04-18/data/")
    / "originals/Toast/RevanueandLabor/SalesSummary_2020-04-06_2026-04-12.zip"
)
DEFAULT_DB = ROOT / "data" / "lariat.db"
PERIOD_LABEL = "2020-04-06_2026-04-12"
SOURCE_LABEL = "toast_sales_summary_2020-04-06_2026-04-12"

# Filenames already covered by dedicated tables. Skip them here.
ALREADY_INGESTED = {
    "Sales by day.csv",
    "Day of week (totals).csv",
    "Time of day (totals).csv",
}

# Filename -> short report slug used as the `report` column value.
# Stable, lowercase, snake_case; avoid 'summary' suffix unless needed for
# disambiguation (Cash activity vs Cash summary).
REPORT_SLUGS = {
    "Revenue summary.csv": "revenue",
    "Net sales summary.csv": "net_sales",
    "Tip summary.csv": "tip",
    "Service mode summary.csv": "service_mode",
    "Payments summary.csv": "payments",
    "Sales category summary.csv": "sales_category",
    "Revenue center summary.csv": "revenue_center",
    "Dining options summary.csv": "dining_options",
    "Tax summary.csv": "tax",
    "Service charge summary.csv": "service_charge",
    "Menu Item Discounts.csv": "menu_item_discounts",
    "Check Discounts.csv": "check_discounts",
    "Service Daypart summary.csv": "service_daypart",
    "Deferred summary.csv": "deferred",
    "Unpaid orders summary.csv": "unpaid_orders",
    "Void summary.csv": "void",
    "Cash activity.csv": "cash_activity",
    "Cash summary.csv": "cash_summary",
}

# Files of shape (B): header + one totals row, no row-label axis.
# Anything not in this set is treated as shape (A) (col 0 is row_label).
SINGLE_ROW_REPORTS = {
    "revenue",
    "net_sales",
    "tip",
    "cash_activity",
    "cash_summary",
    "unpaid_orders",
    "void",
}

# Reports whose row label needs more than the first column. Payments has
# (Payment type, Payment sub type) — we join them with ' / ' so e.g. a
# blank subtype collapses to 'Credit/debit / ' (kept distinct from
# 'Credit/debit / AMEX'). Any report not listed defaults to 1.
ROW_LABEL_COLS = {
    "payments": 2,
}

DDL = """
CREATE TABLE IF NOT EXISTS toast_sales_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report TEXT NOT NULL,
  period_label TEXT NOT NULL,
  row_label TEXT,
  metric TEXT,
  value_text TEXT,
  value_num REAL,
  source_file TEXT,
  location_id TEXT NOT NULL DEFAULT 'default',
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(report, period_label, row_label, metric, location_id)
);
CREATE INDEX IF NOT EXISTS idx_toast_summary_report
  ON toast_sales_summary(report, period_label);
"""


_NUM_RE = re.compile(r"^-?\d+(?:\.\d+)?$")


def coerce_num(s: str) -> float | None:
    """Best-effort numeric parse. Strips $ , % whitespace.

    Returns None for empty strings, non-numeric blobs ('State Tax'), or
    anything we can't confidently convert. The raw text is always kept
    in value_text so we lose nothing.
    """
    if s is None:
        return None
    t = s.strip()
    if not t:
        return None
    # Strip currency, thousands separator, percent.
    t2 = t.replace("$", "").replace(",", "").replace("%", "").strip()
    if not t2 or t2 in {"-", "—"}:
        return None
    if _NUM_RE.match(t2):
        try:
            return float(t2)
        except ValueError:
            return None
    return None


def parse_csv(
    path: Path, report: str
) -> tuple[list[dict], dict[str, int]]:
    """Parse one summary CSV into a list of (report, row_label, metric, value) dicts.

    Returns (rows, skipped_counts).
    """
    rows: list[dict] = []
    skipped = {"empty_row": 0, "header_only": 0, "blank_metric": 0, "total_row": 0}
    seen: set[tuple[str, str, str]] = set()

    # AGENTS.md: Toast exports are cp1252 (curly apostrophes, 0xbf bytes in
    # payment labels). utf-8-sig crashes mid-ingest when those bytes appear.
    with path.open("r", newline="", encoding="cp1252") as f:
        reader = csv.reader(f)
        try:
            header = next(reader)
        except StopIteration:
            skipped["header_only"] += 1
            return rows, skipped

        data_rows = [r for r in reader if any((c or "").strip() for c in r)]
        if not data_rows:
            skipped["header_only"] += 1
            return rows, skipped

        single_row_shape = report in SINGLE_ROW_REPORTS
        n_label_cols = ROW_LABEL_COLS.get(report, 1)
        # Track duplicate base labels so we can disambiguate e.g. two rows
        # both labelled "20% Service Charge" in service_charge.
        label_counts: dict[str, int] = {}

        for r_idx, raw in enumerate(data_rows):
            # Pad short rows so zip(header, raw) doesn't truncate.
            if len(raw) < len(header):
                raw = raw + [""] * (len(header) - len(raw))

            if single_row_shape:
                row_label = "__totals__"
                cells = list(zip(header, raw))
            else:
                parts = [(raw[i] or "").strip() for i in range(n_label_cols)]
                base_label = " / ".join(parts) if n_label_cols > 1 else parts[0]
                if not any(parts):
                    skipped["empty_row"] += 1
                    print(
                        f"skip {path.name} row {r_idx}: empty row label",
                        file=sys.stderr,
                    )
                    continue
                # Drop the per-report 'Total' summary row: it's the sum of
                # the breakouts and storing it invites double-counting in
                # any aggregate query that forgets to filter it out. The
                # value is reproducible via SUM(value_num) GROUP BY metric.
                # Only applies to shape-A reports — shape-B '__totals__'
                # rows ARE the data and never reach this branch.
                if parts[0].lower() == "total" and all(
                    not p for p in parts[1:]
                ):
                    skipped["total_row"] += 1
                    continue
                # Disambiguate exact duplicates of the composite label.
                seen_n = label_counts.get(base_label, 0) + 1
                label_counts[base_label] = seen_n
                row_label = base_label if seen_n == 1 else f"{base_label} #{seen_n}"
                cells = list(zip(header[n_label_cols:], raw[n_label_cols:]))

            for metric, val in cells:
                metric_clean = (metric or "").strip()
                if not metric_clean:
                    skipped["blank_metric"] += 1
                    continue
                value_text = "" if val is None else str(val).strip()
                value_num = coerce_num(value_text)

                key = (row_label, metric_clean, "default")
                if key in seen:
                    # Defensive: shouldn't happen given the file shapes, but
                    # the UNIQUE constraint would reject it anyway.
                    print(
                        f"skip {path.name} row {r_idx} metric {metric_clean!r}: "
                        f"duplicate key within file",
                        file=sys.stderr,
                    )
                    continue
                seen.add(key)

                rows.append({
                    "report": report,
                    "period_label": PERIOD_LABEL,
                    "row_label": row_label,
                    "metric": metric_clean,
                    "value_text": value_text,
                    "value_num": value_num,
                    "source_file": path.name,
                    "location_id": "default",
                })
    return rows, skipped


def ensure_schema(con: sqlite3.Connection) -> None:
    con.executescript(DDL)


def refresh_report(
    con: sqlite3.Connection, report: str, rows: list[dict]
) -> int:
    cur = con.cursor()
    cur.execute(
        "DELETE FROM toast_sales_summary "
        "WHERE report=? AND period_label=? AND location_id='default';",
        (report, PERIOD_LABEL),
    )
    if rows:
        cur.executemany(
            """INSERT INTO toast_sales_summary
               (report, period_label, row_label, metric, value_text,
                value_num, source_file, location_id)
               VALUES (:report, :period_label, :row_label, :metric,
                       :value_text, :value_num, :source_file, :location_id)""",
            rows,
        )
    return len(rows)


def spot_check(con: sqlite3.Connection) -> None:
    cur = con.cursor()
    for report in ("sales_category", "service_daypart"):
        print(f"\nTop 5 entries from {report}:")
        for r in cur.execute(
            """SELECT row_label, metric, value_text
               FROM toast_sales_summary
               WHERE report=? AND period_label=?
               ORDER BY id LIMIT 5;""",
            (report, PERIOD_LABEL),
        ):
            print(" ", r)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--zip", type=Path, default=DEFAULT_ZIP, dest="zip_path")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.zip_path.exists():
        print(f"ERROR: missing source zip {args.zip_path}", file=sys.stderr)
        return 2
    if not args.db.exists():
        print(f"ERROR: missing db {args.db}", file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory(prefix="toast_summary_") as td:
        td_path = Path(td)
        with zipfile.ZipFile(args.zip_path) as zf:
            zf.extractall(td_path)

        all_csvs = sorted(p for p in td_path.iterdir() if p.suffix == ".csv")
        targets: list[tuple[Path, str]] = []
        unrecognised: list[str] = []
        for p in all_csvs:
            if p.name in ALREADY_INGESTED:
                continue
            slug = REPORT_SLUGS.get(p.name)
            if slug is None:
                unrecognised.append(p.name)
                continue
            targets.append((p, slug))

        if unrecognised:
            print(
                f"WARN: {len(unrecognised)} CSV(s) not in REPORT_SLUGS: "
                f"{unrecognised}",
                file=sys.stderr,
            )

        # Parse everything before touching the DB so a parse error bails out
        # without leaving a half-refreshed table.
        parsed: list[tuple[str, str, list[dict], dict[str, int]]] = []
        for path, slug in targets:
            rows, skipped = parse_csv(path, slug)
            parsed.append((path.name, slug, rows, skipped))

        with sqlite3.connect(str(args.db)) as con:
            ensure_schema(con)
            cur = con.cursor()
            before = cur.execute(
                "SELECT COUNT(*) FROM toast_sales_summary "
                "WHERE period_label=? AND location_id='default';",
                (PERIOD_LABEL,),
            ).fetchone()[0]

            if args.dry_run:
                total = sum(len(rows) for _, _, rows, _ in parsed)
                print(f"DRY-RUN: would refresh {len(parsed)} reports, "
                      f"insert {total} rows. before={before}")
                for fname, slug, rows, skipped in parsed:
                    print(f"  {slug:<22} {len(rows):>4} rows  "
                          f"({fname})")
                    for k, v in skipped.items():
                        if v:
                            print(f"    skip {k}: {v}", file=sys.stderr)
                return 0

            total_inserted = 0
            try:
                cur.execute("BEGIN;")
                for fname, slug, rows, skipped in parsed:
                    n = refresh_report(con, slug, rows)
                    total_inserted += n
                    print(f"  {slug:<22} {n:>4} rows  ({fname})")
                    for k, v in skipped.items():
                        if v:
                            print(f"    skip {k}: {v}", file=sys.stderr)
                con.commit()
            except Exception:
                con.rollback()
                raise

            after = cur.execute(
                "SELECT COUNT(*) FROM toast_sales_summary "
                "WHERE period_label=? AND location_id='default';",
                (PERIOD_LABEL,),
            ).fetchone()[0]
            print(f"\ntoast_sales_summary rows for {PERIOD_LABEL}: "
                  f"before={before}  after={after}  "
                  f"inserted={total_inserted}")

            spot_check(con)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
