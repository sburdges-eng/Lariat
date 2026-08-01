"""The order-email recovery has to survive a cache rebuild and reach costing.

PR #594 recovered April/May 2026 from Sysco order-confirmation emails, but wrote
them only to `data/cache/vendor_summary.json`. Two consequences, both pinned here:

  1. `scripts/rebuild-cache.mjs` regenerates that file from a narrower CSV set and
     never reads the existing one, so the recovery is one `rebuild-cache` run away
     from deletion.
  2. `computeActualCogsBreakdown` (lib/computeEngine/accountingVariance.ts) reads
     `sysco_invoices`, not the JSON cache. The recovery is invisible to the
     theoretical-vs-actual check that #594 said it was unblocking.

The sibling ingest (`ingest_sysco_invoice_pdfs.py`) already writes both the cache
and the `sysco_invoices` table. This suite holds the email ingest to the same
contract, plus the `doc_type` distinction that keeps an order confirmation from
being summed alongside the invoice that later bills the same delivery.
"""

import csv
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.ingest_sysco_order_emails import main  # noqa: E402

COLUMNS = [
    'order_number', 'order_date', 'delivery_date', 'supc', 'description',
    'pack_size', 'brand', 'qty', 'unit_price', 'extended_price',
]

# Real lines from the recovered window.
ROWS = [
    ['04488129', '2026-04-01', '2026-04-02', '4002408', 'Mayonnaise Heavy Duty Pail',
     '1/28LB', 'SYSCO RELIANCE', '2', '54.10', '108.20'],
    ['04488128', '2026-04-01', '2026-04-09', '7258790', 'Spice Asian Yuzu Kosho Green',
     '2/17.6OZ', 'YAKAMI ORCHARDS', '1', '59.84', '59.84'],
]


@pytest.fixture
def csv_path(tmp_path):
    path = tmp_path / 'orders.csv'
    with open(path, 'w', newline='', encoding='utf-8') as handle:
        writer = csv.writer(handle)
        writer.writerow(COLUMNS)
        writer.writerows(ROWS)
    return path


@pytest.fixture
def db_path(tmp_path):
    """A DB carrying one pre-existing PDF-sourced invoice row.

    Shaped as the pre-migration table so the doc_type migration is exercised
    rather than assumed.
    """
    path = tmp_path / 'lariat.db'
    con = sqlite3.connect(str(path))
    con.executescript("""
        CREATE TABLE sysco_invoices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_no TEXT NOT NULL,
          delivery_date TEXT,
          description TEXT NOT NULL,
          sku TEXT,
          qty INTEGER,
          category TEXT,
          unit_price REAL,
          line_total REAL,
          actual_received_lb REAL,
          reconciled_unit_price REAL,
          source_file TEXT,
          location_id TEXT DEFAULT 'default',
          imported_at TEXT DEFAULT (datetime('now')),
          UNIQUE(invoice_no, description, location_id)
        );
    """)
    con.execute(
        "INSERT INTO sysco_invoices (invoice_no, delivery_date, description, qty, line_total)"
        " VALUES ('759616979', '2026-03-09', 'Existing PDF Line', 1, 42.00)"
    )
    con.commit()
    con.close()
    return path


def _rows(db_path):
    con = sqlite3.connect(str(db_path))
    con.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in con.execute('SELECT * FROM sysco_invoices ORDER BY invoice_no')]
    finally:
        con.close()


def test_persists_line_items_to_sysco_invoices(csv_path, db_path, capsys):
    """The whole point: recovered lines must land in the DB, not just the cache."""
    assert main([str(csv_path), '--cache', str(db_path.parent / 'c.json'),
                 '--db', str(db_path)]) == 0
    rows = _rows(db_path)
    recovered = [r for r in rows if r['invoice_no'] in {'04488128', '04488129'}]
    assert len(recovered) == 2
    assert {r['description'] for r in recovered} == {
        'Mayonnaise Heavy Duty Pail', 'Spice Asian Yuzu Kosho Green',
    }
    assert sum(r['line_total'] for r in recovered) == pytest.approx(168.04)


def test_order_emails_are_tagged_order_confirmation(csv_path, db_path):
    """An order confirmation is not an invoice. Summing both double-counts."""
    main([str(csv_path), '--cache', str(db_path.parent / 'c.json'), '--db', str(db_path)])
    rows = _rows(db_path)
    by_no = {r['invoice_no']: r for r in rows}
    assert by_no['04488128']['doc_type'] == 'order_confirmation'
    assert by_no['04488129']['doc_type'] == 'order_confirmation'


def test_migration_defaults_existing_rows_to_invoice(csv_path, db_path):
    """Pre-existing PDF rows are invoices; the migration must not orphan them."""
    main([str(csv_path), '--cache', str(db_path.parent / 'c.json'), '--db', str(db_path)])
    existing = [r for r in _rows(db_path) if r['invoice_no'] == '759616979']
    assert len(existing) == 1
    assert existing[0]['doc_type'] == 'invoice'
    assert existing[0]['line_total'] == pytest.approx(42.00)


def test_rerun_is_idempotent(csv_path, db_path):
    """Re-running an ingest is routine. It must not duplicate spend."""
    cache = db_path.parent / 'c.json'
    main([str(csv_path), '--cache', str(cache), '--db', str(db_path)])
    first = _rows(db_path)
    main([str(csv_path), '--cache', str(cache), '--db', str(db_path)])
    second = _rows(db_path)
    assert len(first) == len(second) == 3
    assert sum(r['line_total'] for r in first) == pytest.approx(
        sum(r['line_total'] for r in second)
    )


def test_dry_run_writes_nothing_to_the_db(csv_path, db_path):
    main([str(csv_path), '--cache', str(db_path.parent / 'c.json'),
          '--db', str(db_path), '--dry-run'])
    assert len(_rows(db_path)) == 1


def test_absent_db_is_not_an_error(csv_path, tmp_path, capsys):
    """A fresh checkout has no DB. The cache write must still succeed."""
    assert main([str(csv_path), '--cache', str(tmp_path / 'c.json'),
                 '--db', str(tmp_path / 'nope.db')]) == 0
    assert (tmp_path / 'c.json').exists()
