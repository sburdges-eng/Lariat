#!/usr/bin/env python3
"""Ingest Shamrock order-confirmation .xls files into `shamrock_invoices`.

Source: data/originals/shamrock/invoice history shamrock/the-lariat-order-confirmation-NNNNNNN.xls
(originals were moved to ~/Dev/_archives/lariat-pre-scrub-2026-04-18/ on 2026-04-18;
this script reads them in place.)

Sheet layout (single sheet 'confirmation', ~65-70 files, all consistent):
    row  1: banner: '<MM/DD/YYYY>\\nOrder Confirmation' (col 7) — the printed-on
            date, NOT the order date. We capture it as `ordered_date` only as a
            best-effort proxy; Shamrock doesn't expose the true order-entry date
            in this export.
    row  5: 'Sales Order' label (col 12) | invoice_no in col 16
    row  9: 'Type'           label (col 12) | order type in col 16 (Standard/Recovery)
    row 11: 'Ship Date'      label (col 12) | delivery date 'MM/DD/YYYY' in col 16
    row 13: 'Current Status' label (col 12) | e.g. 'Delivered' in col 16
    row 20: column headers
        col  1: '#'              col 13: 'Quantity'
        col  2: 'Product #'      col 14: 'Price'    ($ string, e.g. '$57.26')
        col  3: 'Description'    col 17: 'Unit'     ('CS', 'EA', 'LB', ...)
        col  9: 'Pack'           col 18: 'Line Amount' ($ string)
        col 10: 'Brand'
    row 21..N-1: line items. col 1 is a 1-based ordinal (xlrd float).
    last row: ['', 'Subtotal', '', ..., '$X,XXX.XX']  -> skip.

Catch-weight notes (e.g. BEEF, CHEEK MEAT REFRIG):
    Description cell can contain '\\nActual Weight: 30lbs'. We keep that in the
    `item` text — it's load-bearing for reconciliation against catch-weight
    pricing (qty=1 case, but billed per LB of actual weight).

Idempotency:
    Full refresh — DELETE all rows for location_id='default' then bulk INSERT
    inside one BEGIN..COMMIT. If the insert fails, rollback so we don't end up
    with a half-loaded table. UNIQUE(invoice_no, sku, item, location_id) on the
    table catches duplicate (invoice, line) keys; we dedupe per-invoice in the
    parser and log skips.

After ingest, backfill `spend_monthly` — the T1 task that was blocked because
the analytics workbook only carried Sep 2025..Mar 2026. We aggregate
line_total by YYYY-MM(delivery_date) and INSERT only months not already
present (any source label). Months touching multiple sources are not
overwritten — manual reconciliation if discrepancies appear.
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import xlrd

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DIR = (
    Path("/Users/seanburdges/Dev/_archives/lariat-pre-scrub-2026-04-18/data/")
    / "originals/shamrock/invoice history shamrock"
)
DEFAULT_DB = ROOT / "data" / "lariat.db"
SOURCE_LABEL = "shamrock_invoices_2026-04-18"

# Pack-size unit tokens (mirrors ingest_shamrock_inventory_sheet.py exactly).
_UNIT_TOKENS = [
    ("LBAV", "lb"),
    ("LB", "lb"),
    ("OZ", "oz"),
    ("FO", "floz"),
    ("GAL", "gal"),
    ("GL", "gal"),
    ("ML", "ml"),
    ("DZ", "dz"),
    ("PC", "pc"),
    ("FT", "ft"),
    ("CT", "ct"),
    ("CN", "cn"),
    ("RL", "rl"),
    ("KG", "kg"),
    ("EA", "ea"),
    ("PK", "pk"),
    ("CS", "cs"),
    ("G", "g"),
]


def parse_pack(pack_str: str) -> tuple[float | None, str]:
    """Parse '4/5/LB' -> (20.0, 'lb'). Returns (None, '') if unparseable."""
    if pack_str is None:
        return None, ""
    s = str(pack_str).upper().strip()
    if not s:
        return None, ""

    unit = ""
    for tok, canon in _UNIT_TOKENS:
        if re.search(rf"(?:^|[^A-Z]){tok}$", s):
            unit = canon
            s_no_unit = s[: s.rfind(tok)].rstrip("/ ")
            break
    else:
        s_no_unit = s

    parts = [p for p in re.split(r"[/\s]+", s_no_unit) if p]
    qty = 1.0
    any_num = False
    for p in parts:
        try:
            qty *= float(p)
            any_num = True
        except ValueError:
            return None, unit
    if not any_num:
        return None, unit
    if qty == 0:
        return None, unit
    return qty, unit


def parse_money(cell) -> float | None:
    """'$57.26' -> 57.26 ; '$1,234.56' -> 1234.56 ; '' / None -> None."""
    if cell is None:
        return None
    if isinstance(cell, (int, float)):
        return float(cell)
    s = str(cell).strip().replace("$", "").replace(",", "")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_date(s) -> str | None:
    """'09/29/2025' -> '2025-09-29'; returns None on failure."""
    if s is None:
        return None
    s = str(s).strip()
    if not s:
        return None
    # Strip trailing newlines/extras (the banner cell has '\nOrder Confirmation')
    s = s.split("\n", 1)[0].strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def humanize(s) -> str:
    return re.sub(r"\s+", " ", str(s).strip())


def parse_invoice(xls_path: Path) -> tuple[dict | None, list[dict], dict[str, int]]:
    """Parse one .xls. Returns (header, lines, skipped) or (None, [], skipped)
    if header is unrecoverable.

    `header` is dict with invoice_no, delivery_date, ordered_date.
    `lines`  is list of dicts ready for INSERT.
    """
    skipped = {
        "no_invoice_no": 0,
        "no_delivery_date": 0,
        "short_row": 0,
        "non_numeric_idx": 0,
        "empty_desc": 0,
        "no_line_total": 0,
        "duplicate_line_key": 0,
        "subtotal": 0,
    }

    wb = xlrd.open_workbook(str(xls_path))
    sh = (
        wb.sheet_by_name("confirmation")
        if "confirmation" in wb.sheet_names()
        else wb.sheet_by_index(0)
    )

    def get(r: int, c: int):
        if r < sh.nrows and c < sh.ncols:
            return sh.row_values(r)[c]
        return ""

    invoice_no = str(get(5, 16)).strip()
    if invoice_no.endswith(".0"):
        invoice_no = invoice_no[:-2]
    if not invoice_no:
        # Fall back to filename: the-lariat-order-confirmation-NNNNNNN.xls
        m = re.search(r"(\d{6,})", xls_path.stem)
        if m:
            invoice_no = m.group(1)
    if not invoice_no:
        skipped["no_invoice_no"] += 1
        return None, [], skipped

    delivery_date = parse_date(get(11, 16))
    if not delivery_date:
        skipped["no_delivery_date"] += 1
        # Don't bail — header row alone is valid signal — but we won't be able
        # to roll up to spend_monthly. Caller treats this as a soft fail and
        # still inserts the lines.

    ordered_date = parse_date(get(1, 7))  # banner date — proxy only

    header = {
        "invoice_no": invoice_no,
        "delivery_date": delivery_date,
        "ordered_date": ordered_date,
    }

    lines: list[dict] = []
    seen: set[tuple[str, str]] = set()
    # Data starts at row 21 (row 20 is the column header band).
    for r in range(21, sh.nrows):
        row = sh.row_values(r)
        if len(row) < 19:
            skipped["short_row"] += 1
            continue
        # Subtotal row: col 1 == 'Subtotal'
        if str(row[1]).strip().lower() == "subtotal":
            skipped["subtotal"] += 1
            continue
        idx = row[1]
        if not isinstance(idx, (int, float)):
            skipped["non_numeric_idx"] += 1
            continue
        sku = str(row[2]).strip()
        if sku.endswith(".0"):
            sku = sku[:-2]
        desc = humanize(row[3])
        if not desc:
            skipped["empty_desc"] += 1
            continue
        pack_str = str(row[9]).strip()
        qty = row[13] if isinstance(row[13], (int, float)) else parse_money(row[13])
        unit_price = parse_money(row[14])
        pack_unit_invoice = str(row[17]).strip()  # 'CS' / 'EA' / 'LB'
        line_total = parse_money(row[18])
        if line_total is None:
            skipped["no_line_total"] += 1
            print(
                f"skip {xls_path.name} row {r}: no line_total (sku={sku!r})",
                file=sys.stderr,
            )
            continue

        pack_qty, pack_unit = parse_pack(pack_str)
        # Prefer the invoice-stamped Unit ('CS'/'EA'/'LB') if pack didn't yield
        # one — that field is what Shamrock actually billed against.
        if not pack_unit and pack_unit_invoice:
            pack_unit = pack_unit_invoice.lower()

        key = (sku, desc)
        if key in seen:
            skipped["duplicate_line_key"] += 1
            print(
                f"skip {xls_path.name} row {r}: duplicate line "
                f"(sku={sku!r} desc={desc[:40]!r})",
                file=sys.stderr,
            )
            continue
        seen.add(key)

        lines.append({
            "invoice_no": invoice_no,
            "delivery_date": delivery_date,
            "ordered_date": ordered_date,
            "item": desc,
            "sku": sku or None,
            "qty": float(qty) if isinstance(qty, (int, float)) else None,
            "pack_size": pack_qty,
            "pack_unit": pack_unit or None,
            "unit_price": unit_price,
            "line_total": line_total,
            "source_file": xls_path.name,
            "location_id": "default",
        })

    return header, lines, skipped


def ensure_table(con: sqlite3.Connection) -> None:
    cur = con.cursor()
    cur.executescript("""
    CREATE TABLE IF NOT EXISTS shamrock_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT NOT NULL,
      delivery_date TEXT,
      ordered_date TEXT,
      item TEXT NOT NULL,
      sku TEXT,
      qty REAL,
      pack_size REAL,
      pack_unit TEXT,
      unit_price REAL,
      line_total REAL,
      source_file TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now')),
      UNIQUE(invoice_no, sku, item, location_id)
    );
    CREATE INDEX IF NOT EXISTS idx_shamrock_inv_date ON shamrock_invoices(delivery_date);
    CREATE INDEX IF NOT EXISTS idx_shamrock_inv_no ON shamrock_invoices(invoice_no);
    """)


def ingest(db_path: Path, all_rows: list[dict], dry_run: bool) -> tuple[int, int]:
    with sqlite3.connect(str(db_path)) as con:
        ensure_table(con)
        cur = con.cursor()
        before = cur.execute(
            "SELECT COUNT(*) FROM shamrock_invoices WHERE location_id='default';"
        ).fetchone()[0]
        if dry_run:
            return before, len(all_rows)
        try:
            cur.execute("BEGIN;")
            cur.execute(
                "DELETE FROM shamrock_invoices WHERE location_id='default';"
            )
            cur.executemany(
                """INSERT INTO shamrock_invoices
                   (invoice_no, delivery_date, ordered_date, item, sku, qty,
                    pack_size, pack_unit, unit_price, line_total, source_file,
                    location_id)
                   VALUES (:invoice_no, :delivery_date, :ordered_date, :item,
                           :sku, :qty, :pack_size, :pack_unit, :unit_price,
                           :line_total, :source_file, :location_id)""",
                all_rows,
            )
            con.commit()
        except Exception:
            con.rollback()
            raise
        after = cur.execute(
            "SELECT COUNT(*) FROM shamrock_invoices WHERE location_id='default';"
        ).fetchone()[0]
        return before, after


def backfill_spend_monthly(db_path: Path, dry_run: bool) -> list[tuple[str, float]]:
    """Insert YYYY-MM totals into spend_monthly for months not yet present.

    Returns the list of (month, total) actually inserted.
    """
    added: list[tuple[str, float]] = []
    with sqlite3.connect(str(db_path)) as con:
        cur = con.cursor()
        existing_months = {
            r[0] for r in cur.execute(
                "SELECT DISTINCT month FROM spend_monthly WHERE location_id='default';"
            )
        }
        rollup = cur.execute(
            """SELECT substr(delivery_date, 1, 7) AS month,
                      ROUND(SUM(line_total), 2)
               FROM shamrock_invoices
               WHERE location_id='default'
                 AND delivery_date IS NOT NULL
                 AND line_total IS NOT NULL
               GROUP BY month
               ORDER BY month;"""
        ).fetchall()
        for month, total in rollup:
            if not month:
                continue
            if month in existing_months:
                continue
            added.append((month, float(total)))
        if dry_run or not added:
            return added
        try:
            cur.execute("BEGIN;")
            cur.executemany(
                """INSERT INTO spend_monthly
                     (month, shamrock_total_spend, source, location_id)
                   VALUES (?, ?, ?, 'default');""",
                [(m, t, SOURCE_LABEL) for m, t in added],
            )
            con.commit()
        except Exception:
            con.rollback()
            raise
    return added


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dir", type=Path, default=DEFAULT_DIR)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.dir.exists():
        print(f"ERROR: missing source dir {args.dir}", file=sys.stderr)
        return 2
    if not args.db.exists():
        print(f"ERROR: missing db {args.db}", file=sys.stderr)
        return 2

    files = sorted(args.dir.glob("the-lariat-order-confirmation-*.xls"))
    print(f"Found {len(files)} .xls files in {args.dir}")

    all_rows: list[dict] = []
    parsed_ok = 0
    file_skipped = 0
    file_skip_reasons: dict[str, int] = defaultdict(int)
    line_skip_totals: dict[str, int] = defaultdict(int)
    invoices_seen: set[str] = set()

    for f in files:
        try:
            header, lines, skipped = parse_invoice(f)
        except Exception as e:
            file_skipped += 1
            file_skip_reasons["exception"] += 1
            print(f"skip {f.name}: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        for k, v in skipped.items():
            line_skip_totals[k] += v
        if header is None:
            file_skipped += 1
            file_skip_reasons["no_header"] += 1
            print(f"skip {f.name}: no invoice_no", file=sys.stderr)
            continue
        if not lines:
            file_skipped += 1
            file_skip_reasons["no_line_items"] += 1
            print(f"skip {f.name}: invoice {header['invoice_no']} has no line items",
                  file=sys.stderr)
            continue
        if not header["delivery_date"]:
            # Soft warn — we still ingest but it won't roll up to spend_monthly.
            file_skip_reasons["no_delivery_date_warn"] += 1
            print(f"warn {f.name}: invoice {header['invoice_no']} has no delivery_date",
                  file=sys.stderr)
        if header["invoice_no"] in invoices_seen:
            file_skip_reasons["duplicate_invoice_no_warn"] += 1
            print(f"warn {f.name}: duplicate invoice_no {header['invoice_no']}",
                  file=sys.stderr)
        invoices_seen.add(header["invoice_no"])
        all_rows.extend(lines)
        parsed_ok += 1

    print(f"Parsed OK: {parsed_ok} files | skipped: {file_skipped} files")
    if file_skip_reasons:
        for k, v in sorted(file_skip_reasons.items()):
            print(f"  file: {k}: {v}")
    if any(line_skip_totals.values()):
        print("Line skip totals:")
        for k, v in sorted(line_skip_totals.items()):
            if v:
                print(f"  line: {k}: {v}")
    print(f"Total line rows ready: {len(all_rows)}")
    print(f"Distinct invoice_no: {len(invoices_seen)}")

    parse_rate = parsed_ok / len(files) if files else 0.0
    blocked_spend = parse_rate < 0.5

    before, after = ingest(args.db, all_rows, args.dry_run)
    print(f"shamrock_invoices count: before={before}  after={after}"
          + ("  (dry-run)" if args.dry_run else ""))

    # Date-range report
    if not args.dry_run:
        with sqlite3.connect(str(args.db)) as con:
            cur = con.cursor()
            mn, mx = cur.execute(
                "SELECT MIN(delivery_date), MAX(delivery_date) FROM shamrock_invoices "
                "WHERE location_id='default' AND delivery_date IS NOT NULL;"
            ).fetchone()
            print(f"delivery_date range: {mn} .. {mx}")

    if blocked_spend:
        print("BLOCKED — Data Not Available: parse rate <50%, skipping spend_monthly backfill")
    else:
        added = backfill_spend_monthly(args.db, args.dry_run)
        if added:
            print("spend_monthly months added:")
            for m, t in added:
                print(f"  {m}  ${t:,.2f}")
        else:
            print("spend_monthly: no new months to add (all months already present)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
