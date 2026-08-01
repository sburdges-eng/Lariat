#!/usr/bin/env python3
"""Load the master product catalog into `vendor_prices`.

`vendor_prices` holds 451 descriptions. `_ Master Product Catalog.csv` in
lariat-data-sources holds 752 products across Sysco and Shamrock, every one with
a supplier SKU. Matching recipe ingredients against the narrow set is why 98
unmapped BOM lines looked unmappable — agave, panko, soy sauce, sriracha and
birria seasoning are all real purchased products that were simply absent from the
corpus being searched.

Two properties of this source drive the design.

Only 341 of 752 rows carry a price
----------------------------------
It is an excellent matching corpus and a partial pricing source. Unpriced rows
land with `pack_price` NULL, never 0. `rollupRecipeCosts` counts a line as priced
when `pack_price > 0`; a zero would read as "this ingredient is free" and
silently understate every recipe using it, which is the failure mode that
already leaves 26 recipes showing costs built from a subset of their lines. NULL
keeps the line visibly unpriced, which is the honest state.

A catalog is weaker evidence than an invoice
--------------------------------------------
`vendor_prices` rows written by the invoice ingests reflect what we were billed.
This file is a list price that may be stale. So a catalog row never overwrites an
existing price with a blank, and never clobbers a price that is already there —
it only fills gaps. Re-running is therefore safe and idempotent.

Pack sizes
----------
Values arrive as `1/13/OZ` — case count, size, unit — and the slash is
load-bearing. CLAUDE.md §8 records that PDF text extraction drops it and turns
`1/15#` into a 115 lb case, taking $4.64/lb down to $0.60/lb. This source is CSV
so the slash survives, but the parser refuses a slash-less value rather than
trusting it, so that bug cannot arrive through this door.

Usage
-----
    python scripts/ingest_master_catalog.py --csv "<path>/_ Master Product Catalog.csv"
    python scripts/ingest_master_catalog.py --csv ... --dry-run

The source lives in lariat-data-sources, which is read-only business data — pass
its path explicitly rather than copying the file into the repo.
"""

from __future__ import annotations

import argparse
import csv
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / 'data' / 'lariat.db'

# Vendor exports are cp1252, not UTF-8 (CLAUDE.md §6).
ENCODING = 'cp1252'

COLUMNS = ('Lariat ID', 'Supplier', 'Supplier Product #', 'Description',
           'Pack Size', 'Brand', 'Price', 'Unit', 'Category')

# '1/13/OZ' -> count 1, size 13, unit OZ. Requires both slashes: a slash-less
# value is a sign of slash-losing extraction and is rejected, not guessed at.
PACK_RE = re.compile(r'^\s*(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)\s*/\s*([A-Za-z#]+)\s*$')
UNIT_ONLY_RE = re.compile(r'([A-Za-z#]+)\s*$')


def parse_pack_size(raw: str | None) -> tuple[float | None, str | None]:
    """'1/13/OZ' -> (13.0, 'OZ'). Returns (None, unit) when the slashes are
    missing — see the module docstring on the 115 lb bacon case."""
    if not raw:
        return None, None
    match = PACK_RE.match(str(raw))
    if match:
        return float(match.group(2)), match.group(3).upper()
    unit = UNIT_ONLY_RE.search(str(raw))
    return None, unit.group(1).upper() if unit else None


def parse_price(raw: str | None) -> float | None:
    """Blank stays None. A blank price is 'unknown', and 0.0 would mean 'free'."""
    if raw is None:
        return None
    cleaned = str(raw).replace('$', '').replace(',', '').strip()
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def read_catalog(csv_path: Path) -> list[dict]:
    """-> catalog rows in vendor_prices shape.

    The export carries a numeric pre-header row ('0','1','2',...) before the
    real header, so the header is located by content rather than by position.
    """
    with open(csv_path, newline='', encoding=ENCODING, errors='replace') as handle:
        rows = list(csv.reader(handle))

    header_at = next(
        (i for i, row in enumerate(rows) if 'Description' in row and 'Supplier' in row),
        None,
    )
    if header_at is None:
        raise ValueError(f'{csv_path.name}: no header row containing Supplier + Description')
    index = {name.strip(): i for i, name in enumerate(rows[header_at])}
    missing = [c for c in ('Supplier', 'Supplier Product #', 'Description') if c not in index]
    if missing:
        raise ValueError(f'{csv_path.name} is missing column(s): {", ".join(missing)}')

    def cell(row: list[str], name: str) -> str:
        position = index.get(name)
        return (row[position].strip() if position is not None and position < len(row) else '')

    items: list[dict] = []
    for row in rows[header_at + 1:]:
        if not any(c.strip() for c in row):
            continue
        description = cell(row, 'Description')
        sku = cell(row, 'Supplier Product #')
        vendor = cell(row, 'Supplier').lower()
        if not description or not sku or not vendor:
            continue
        pack_size, pack_unit = parse_pack_size(cell(row, 'Pack Size'))
        items.append({
            'ingredient': description,
            'vendor': vendor,
            'sku': sku,
            'pack_size': pack_size,
            'pack_unit': pack_unit or (cell(row, 'Unit').upper() or None),
            'pack_price': parse_price(cell(row, 'Price')),
            'category': cell(row, 'Category') or None,
        })
    return items


def upsert(db_path: Path, items: list[dict], location_id: str = 'default') -> dict:
    """Insert new catalog rows; fill gaps on existing ones.

    Never overwrites an existing `pack_price` — invoice-sourced pricing is
    stronger evidence than a list price, and a blank catalog cell must not erase
    a real number.
    """
    con = sqlite3.connect(str(db_path))
    summary = {'inserted': 0, 'price_filled': 0, 'left_alone': 0}
    try:
        con.execute('BEGIN')
        for item in items:
            existing = con.execute(
                'SELECT id, pack_price FROM vendor_prices'
                ' WHERE vendor = ? AND sku = ? AND location_id = ?',
                (item['vendor'], item['sku'], location_id),
            ).fetchone()

            if existing is None:
                con.execute(
                    'INSERT INTO vendor_prices'
                    ' (ingredient, vendor, sku, pack_size, pack_unit, pack_price,'
                    '  category, location_id)'
                    ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    (item['ingredient'], item['vendor'], item['sku'], item['pack_size'],
                     item['pack_unit'], item['pack_price'], item['category'], location_id),
                )
                summary['inserted'] += 1
                continue

            row_id, current_price = existing
            if current_price is None and item['pack_price'] is not None:
                con.execute(
                    'UPDATE vendor_prices SET pack_price = ? WHERE id = ?',
                    (item['pack_price'], row_id),
                )
                summary['price_filled'] += 1
            else:
                summary['left_alone'] += 1
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--csv', required=True, help='_ Master Product Catalog.csv')
    parser.add_argument('--db', default=str(DB))
    parser.add_argument('--dry-run', action='store_true', help='parse and report, write nothing')
    args = parser.parse_args(argv)

    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f'error: {csv_path} does not exist', file=sys.stderr)
        return 1

    items = read_catalog(csv_path)
    priced = sum(1 for i in items if i['pack_price'] is not None)
    print(f'{csv_path.name}: {len(items)} product(s), {priced} priced, '
          f'{len(items) - priced} without a price')

    if args.dry_run:
        print('  dry run — nothing written')
        return 0

    db_path = Path(args.db)
    if not db_path.exists():
        print(f'error: {db_path} does not exist', file=sys.stderr)
        return 1

    summary = upsert(db_path, items)
    print(f"  inserted {summary['inserted']}, filled {summary['price_filled']} missing "
          f"price(s), left {summary['left_alone']} existing row(s) untouched")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
