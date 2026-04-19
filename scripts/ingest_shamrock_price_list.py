#!/usr/bin/env python3
"""Refresh `vendor_prices` for vendor='shamrock' from the 2025 Shamrock Price List.

Source: data/originals/shamrock/Price List-2025.xls (CDFV2 binary .xls -> xlrd)

Sheet layout (single sheet 'pricesheet'):
    row 0: header banner with date and account
    row 1: column headers ['', '#', 'Product #', 'Description', 'Pack Size',
                            'Brand', 'Price', 'Unit']
    row 2..N: data rows. Unit is one of EA/CS/LB.

Pack Size strings look like '1/13/OZ', '6/.5/GL', '30/7/OZ', '4/5/LB'.
We multiply the leading numeric components to get the total pack quantity.
The trailing token is the pack unit (lb/oz/gal/pk/ea/ct/cn/rl).

Pricing rules:
    Unit == 'CS'  -> Price is per case  -> pack_price = price
                                          unit_price = price / pack_size
    Unit == 'LB'  -> Price is per pound -> pack_price = price * pack_size
                                          unit_price = price (per lb)
                                          pack_unit forced to 'lb'
    Unit == 'EA'  -> Price is per each  -> pack_price = price
                                          if pack_size > 1: unit_price = price / pack_size
                                          else:             unit_price = price

Strategy: full refresh — DELETE all rows for vendor='shamrock' AND
location_id='default', then bulk insert. No `source` column exists.
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path

import xlrd

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_XLS = (
    Path("/Users/seanburdges/Dev/_archives/lariat-pre-scrub-2026-04-18/data/")
    / "originals/shamrock/Price List-2025.xls"
)
DEFAULT_DB = ROOT / "data" / "lariat.db"

# Pack-string trailing units we recognise. Order matters: longer first.
_UNIT_TOKENS = [
    ("LBAV", "lb"),
    ("LB", "lb"),
    ("OZ", "oz"),    # dry oz
    ("FO", "floz"),  # fluid oz
    ("GAL", "gal"),
    ("GL", "gal"),
    ("ML", "ml"),
    ("DZ", "dz"),    # dozen
    ("PC", "pc"),    # piece (catch-weight cuts)
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
    """Parse a pack-size string into (total_quantity, normalised_unit).

    '1/13/OZ' -> (13.0, 'oz')
    '6/.5/GL' -> (3.0, 'gal')
    '30/7/OZ' -> (210.0, 'oz')
    '4/5/LB'  -> (20.0, 'lb')
    '1/1.5/LB'-> (1.5, 'lb')
    '1/1/RL'  -> (1.0, 'rl')
    Returns (None, '') if unparseable.
    """
    if pack_str is None:
        return None, ""
    s = str(pack_str).upper().strip()
    if not s:
        return None, ""

    # Extract trailing unit token
    unit = ""
    for tok, canon in _UNIT_TOKENS:
        if re.search(rf"(?:^|[^A-Z]){tok}$", s):
            unit = canon
            s_no_unit = s[: s.rfind(tok)].rstrip("/ ")
            break
    else:
        s_no_unit = s

    # Multiply remaining numeric components
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
    return qty, unit


_PRICE_RE = re.compile(r"-?\d+(?:\.\d+)?")


def parse_price(price_cell) -> float | None:
    if price_cell is None or price_cell == "":
        return None
    if isinstance(price_cell, (int, float)):
        return float(price_cell)
    m = _PRICE_RE.search(str(price_cell))
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def humanize_ingredient(desc: str) -> str:
    """Light cleanup: strip whitespace, collapse internal spacing.

    The vendor descriptions are already abbreviated (e.g.
    'CABBAGE, RED SHRD'). Per project rules they should not contain
    underscores — they don't — so the existing form is preserved
    aside from whitespace tidy.
    """
    s = str(desc).strip()
    s = re.sub(r"\s+", " ", s)
    return s


def extract_rows(xls_path: Path) -> list[dict]:
    wb = xlrd.open_workbook(str(xls_path))
    sh = wb.sheet_by_name("pricesheet") if "pricesheet" in wb.sheet_names() \
        else wb.sheet_by_index(0)

    rows: list[dict] = []
    for r in range(2, sh.nrows):
        row = sh.row_values(r)
        if len(row) < 8:
            continue
        # Column layout: ['', '#', 'Product #', 'Description', 'Pack Size',
        #                 'Brand', 'Price', 'Unit']
        idx, sku, desc, pack_str, _brand, price_cell, unit_cell = (
            row[1], row[2], row[3], row[4], row[5], row[6], row[7],
        )
        if not desc or not str(desc).strip():
            continue
        if not isinstance(idx, (int, float)):
            # Skip subtotal/section rows (none present in 2025 file but be safe)
            continue

        sku_str = str(sku).strip()
        if sku_str.endswith(".0"):
            sku_str = sku_str[:-2]

        pack_qty, pack_unit = parse_pack(pack_str)
        price = parse_price(price_cell)
        unit_token = str(unit_cell).strip().upper()

        if price is None:
            continue

        # Apply per-unit semantics
        if unit_token == "CS":
            pack_price = price
            unit_price = price / pack_qty if pack_qty and pack_qty > 0 else None
        elif unit_token == "LB":
            # Catch-weight: price is $/lb; pack_qty is approx weight in lbs
            unit_price = price
            pack_price = price * pack_qty if pack_qty and pack_qty > 0 else None
            pack_unit = "lb"  # force; source pack like '3/10/LBAV'
        elif unit_token == "EA":
            pack_price = price
            if pack_qty and pack_qty > 1:
                unit_price = price / pack_qty
            else:
                unit_price = price
        else:
            # Unknown unit — store as best we can
            pack_price = price
            unit_price = price / pack_qty if pack_qty and pack_qty > 0 else None

        rows.append({
            "ingredient": humanize_ingredient(desc),
            "vendor": "shamrock",
            "sku": sku_str,
            "pack_size": pack_qty,
            "pack_unit": pack_unit or None,
            "pack_price": pack_price,
            "unit_price": unit_price,
            "category": None,
        })
    return rows


def upsert(db_path: Path, rows: list[dict], dry_run: bool) -> tuple[int, int]:
    con = sqlite3.connect(str(db_path))
    cur = con.cursor()
    before = cur.execute(
        "SELECT COUNT(*) FROM vendor_prices WHERE vendor='shamrock' "
        "AND location_id='default';"
    ).fetchone()[0]

    if dry_run:
        con.close()
        return before, len(rows)

    cur.execute(
        "DELETE FROM vendor_prices WHERE vendor='shamrock' "
        "AND location_id='default';"
    )
    cur.executemany(
        """INSERT INTO vendor_prices
           (ingredient, vendor, sku, pack_size, pack_unit,
            pack_price, unit_price, category)
           VALUES (:ingredient, :vendor, :sku, :pack_size, :pack_unit,
                   :pack_price, :unit_price, :category)""",
        rows,
    )
    con.commit()
    after = cur.execute(
        "SELECT COUNT(*) FROM vendor_prices WHERE vendor='shamrock' "
        "AND location_id='default';"
    ).fetchone()[0]
    con.close()
    return before, after


def report(db_path: Path) -> None:
    con = sqlite3.connect(str(db_path))
    cur = con.cursor()
    print("\nSample 5 shamrock rows:")
    for r in cur.execute(
        "SELECT ingredient, sku, pack_size, pack_unit, pack_price, unit_price "
        "FROM vendor_prices WHERE vendor='shamrock' "
        "ORDER BY ingredient LIMIT 5;"
    ):
        print(" ", r)
    n_null_pack = cur.execute(
        "SELECT COUNT(*) FROM vendor_prices WHERE vendor='shamrock' "
        "AND (pack_size IS NULL);"
    ).fetchone()[0]
    n_null_price = cur.execute(
        "SELECT COUNT(*) FROM vendor_prices WHERE vendor='shamrock' "
        "AND (pack_price IS NULL);"
    ).fetchone()[0]
    n_null_unit_price = cur.execute(
        "SELECT COUNT(*) FROM vendor_prices WHERE vendor='shamrock' "
        "AND (unit_price IS NULL);"
    ).fetchone()[0]
    print(f"\nNULL pack_size:  {n_null_pack}")
    print(f"NULL pack_price: {n_null_price}")
    print(f"NULL unit_price: {n_null_unit_price}")
    con.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--xls", type=Path, default=DEFAULT_XLS)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.xls.exists():
        print(f"ERROR: missing source {args.xls}", file=sys.stderr)
        return 2
    if not args.db.exists():
        print(f"ERROR: missing db {args.db}", file=sys.stderr)
        return 2

    rows = extract_rows(args.xls)
    print(f"Parsed {len(rows)} rows from {args.xls.name}")
    before, after = upsert(args.db, rows, args.dry_run)
    print(f"shamrock vendor_prices count: before={before}  after={after}"
          + ("  (dry-run)" if args.dry_run else ""))
    if not args.dry_run:
        report(args.db)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
