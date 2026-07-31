#!/usr/bin/env python3
"""Ingest Sysco order-confirmation emails into vendor_summary.json.

Why this exists
---------------
`ingest_sysco_invoice_pdfs.py` is the primary path, but it can only read
invoices we actually hold as PDFs. There are windows where no PDF was ever
saved — April and May 2026 are entirely absent from the invoice archive, which
is a two-month hole in the middle of the purchase record.

Those months are still recoverable. Sysco's "Order Confirmation" emails
(shop-noreply@sysco.com) carry the full line detail, not just a total:

    Container Mfpp 1 Compartment Hinged 9 Inch X 9 Inch White
    7064461 | 1/120 CT | EARTH PLUS
    1 CS ($28.13)
    $28.13

Exported to CSV, that becomes this script's input. Output goes to the same
`vendor_summary.json.sysco.recent_items` rows the PDF ingest writes, so
downstream costing sees one uniform purchase record.

Format notes, learned the hard way
----------------------------------
- **One email covers several order numbers.** Sysco splits a single submission
  into separate orders with separate delivery dates; the 2026-04-01 email holds
  three. Every line carries its own order number, so rows are attributed
  individually rather than stamped with an email-level number.
- **Catch-weight lines price per pound, not per case** (`1 CS ($4.876LB)`), so
  `qty * unit_price != extended_price` on those rows by design. Extended price
  is authoritative; unit price is not re-derived.
- **Shipping is a header charge, not a line item.** Three of the recovered
  orders carry one. Line items will sum below the email's stated order total by
  exactly that amount — that is correct, not a parse failure.
- **The printed pack string is not trustworthy** and is deliberately not used
  for weight here, matching `ingest_sysco_invoice_pdfs.py`. PDF text extraction
  drops the slash out of the pack column (`1/15#` reads as `115#`, turning a
  15 lb case into 115 lb). Pack weight belongs to `vendor_pack_weights.csv` and
  the catch-weight tables, keyed on SUPC, which survive intact.

Idempotency: keyed on `(invoice, description)` exactly as the PDF ingest is, so
re-running is safe and a row already recovered from a PDF is never doubled.

Usage
-----
    python scripts/ingest_sysco_order_emails.py <orders.csv> [--dry-run]

Required CSV columns:
    order_number, order_date, delivery_date, supc, description,
    pack_size, brand, qty, unit_price, extended_price
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'data' / 'cache' / 'vendor_summary.json'

SYSCO_VENDOR = 'sysco'

REQUIRED_COLUMNS = (
    'order_number',
    'order_date',
    'delivery_date',
    'supc',
    'description',
    'qty',
    'extended_price',
)

# Sysco groups its catalogue into the same banners the printed invoice uses.
# Order emails do not carry a banner, so category is inferred from the
# description. Anything unmatched stays 'Uncategorized' rather than guessing —
# a wrong category silently mis-buckets spend in the costing rollup.
CATEGORY_KEYWORDS = (
    ('Dairy', ('cheese', 'milk', 'cream', 'butter', 'buttermilk', 'yogurt', 'sour crm')),
    ('Meats', ('beef', 'pork', 'bacon', 'ham', 'sausage', 'brisket', 'chorizo', 'patty')),
    ('Poultry', ('chicken', 'turkey', 'poultry')),
    ('Seafood', ('fish', 'shrimp', 'salmon', 'trout', 'crab', 'pangasius', 'basa', 'cod')),
    ('Produce', ('lettuce', 'tomato', 'onion', 'avocado', 'cilantro', 'lime', 'lemon',
                 'pepper', 'potato', 'cucumber', 'garlic', 'jalapeno', 'produce')),
    ('Paper', ('container', 'cup', 'napkin', 'towel', 'glove', 'liner', 'bag', 'lid',
               'cutlery', 'foil', 'film', 'straw', 'tissue')),
    ('Frozen', ('frozen', 'iqf', 'fry', 'fries')),
    ('Canned & Dry', ('flour', 'sugar', 'rice', 'bean', 'spice', 'oil', 'vinegar',
                      'sauce', 'canned', 'dry', 'seasoning', 'shortening')),
)


def infer_category(description: str) -> str:
    text = (description or '').lower()
    for label, keywords in CATEGORY_KEYWORDS:
        if any(k in text for k in keywords):
            return label
    return 'Uncategorized'


def to_us_date(iso_date: str) -> str:
    """'2026-04-09' -> '4/9/2026', matching rows the PDF ingest writes."""
    parts = (iso_date or '').split('-')
    if len(parts) != 3:
        return iso_date or ''
    year, month, day = parts
    try:
        return f'{int(month)}/{int(day)}/{int(year)}'
    except ValueError:
        return iso_date


def _number(value: str) -> float | None:
    try:
        return float(str(value).replace('$', '').replace(',', '').strip())
    except (TypeError, ValueError):
        return None


def read_rows(csv_path: Path) -> list[dict[str, str]]:
    with open(csv_path, newline='', encoding='utf-8-sig') as handle:
        reader = csv.DictReader(handle)
        missing = [c for c in REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(
                f'{csv_path.name} is missing required column(s): {", ".join(missing)}'
            )
        return [row for row in reader]


def build_items(rows: list[dict[str, str]]) -> tuple[list[dict], list[str]]:
    """-> (items in vendor_summary row shape, warnings)"""
    items: list[dict] = []
    warnings: list[str] = []
    for index, row in enumerate(rows, start=2):  # header is line 1
        invoice = (row.get('order_number') or '').strip()
        description = (row.get('description') or '').strip()
        qty = _number(row.get('qty'))
        extended = _number(row.get('extended_price'))

        if not invoice or not description:
            warnings.append(f'line {index}: missing order number or description — skipped')
            continue
        if qty is None or qty <= 0:
            warnings.append(f'line {index}: {description!r} has no usable qty — skipped')
            continue
        if extended is None or extended <= 0:
            warnings.append(f'line {index}: {description!r} has no extended price — skipped')
            continue

        items.append({
            'invoice': invoice,
            'delivery_date': to_us_date((row.get('delivery_date') or '').strip()),
            'description': description,
            'qty': qty,
            'category': infer_category(description),
            'supc': (row.get('supc') or '').strip(),
            'extended_price': round(extended, 2),
            'source': 'order_email',
        })
    return items, warnings


def merge_into_cache(items: list[dict], cache: dict) -> tuple[int, int]:
    """-> (appended, skipped_as_duplicate). Mutates `cache`."""
    sysco = cache.setdefault(SYSCO_VENDOR, {})
    recent = sysco.setdefault('recent_items', [])
    seen = {(r.get('invoice'), r.get('description')) for r in recent}

    appended = 0
    skipped = 0
    for item in items:
        key = (item['invoice'], item['description'])
        if key in seen:
            skipped += 1
            continue
        seen.add(key)
        recent.append(item)
        appended += 1

    latest = max(
        (i['delivery_date'] for i in items if i.get('delivery_date')),
        default=None,
        key=_sort_key_us_date,
    )
    existing = sysco.get('last_invoice_date')
    if latest and (
        not existing or _sort_key_us_date(latest) > _sort_key_us_date(existing)
    ):
        sysco['last_invoice_date'] = latest

    return appended, skipped


def _sort_key_us_date(us_date: str) -> tuple[int, int, int]:
    try:
        month, day, year = str(us_date).split('/')
        return (int(year), int(month), int(day))
    except (ValueError, AttributeError):
        return (0, 0, 0)


def write_cache_atomic(cache: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        'w', delete=False, dir=str(path.parent), encoding='utf-8', suffix='.tmp'
    )
    try:
        json.dump(cache, handle, indent=2, ensure_ascii=False)
        handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())
    finally:
        handle.close()
    os.replace(handle.name, path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('csv_path', help='Sysco order-email export (CSV)')
    parser.add_argument('--cache', default=str(CACHE), help='vendor_summary.json path')
    parser.add_argument('--dry-run', action='store_true',
                        help='parse and report, write nothing')
    args = parser.parse_args(argv)

    csv_path = Path(args.csv_path)
    if not csv_path.exists():
        print(f'error: {csv_path} does not exist', file=sys.stderr)
        return 1

    rows = read_rows(csv_path)
    items, warnings = build_items(rows)
    for warning in warnings:
        print(f'  warn: {warning}', file=sys.stderr)

    cache_path = Path(args.cache)
    cache = {}
    if cache_path.exists():
        with open(cache_path, encoding='utf-8') as handle:
            cache = json.load(handle)

    appended, skipped = merge_into_cache(items, cache)
    total = sum(i['extended_price'] for i in items)
    orders = len({i['invoice'] for i in items})

    print(
        f'{csv_path.name}: {len(items)} line items across {orders} orders, '
        f'${total:,.2f}'
    )
    print(f'  appended {appended}, already present {skipped}')
    if warnings:
        print(f'  {len(warnings)} row(s) skipped — see warnings above')

    if args.dry_run:
        print('  dry run — nothing written')
        return 0

    write_cache_atomic(cache, cache_path)
    print(f'  wrote {cache_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
