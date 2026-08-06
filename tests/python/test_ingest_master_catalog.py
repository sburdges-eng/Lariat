"""The master product catalog — the half of the catalog the repo never loaded.

`vendor_prices` holds 451 descriptions. `_ Master Product Catalog.csv` in
lariat-data-sources holds 752 products across both suppliers, every one with a
supplier SKU. Matching recipe ingredients against the narrow set is why 98
unmapped lines looked unmappable: agave, panko, soy sauce, sriracha and birria
seasoning are all real purchased products that were simply not in the corpus.

Two facts about this source drive the design.

**Only 341 of 752 rows carry a price.** So it is an excellent matching corpus
and a partial pricing source. A row with no price must land with `pack_price`
NULL, never 0 — `rollupRecipeCosts` treats a priced line as one with
`pack_price > 0`, and a zero would read as "this ingredient is free" and silently
understate every recipe using it. NULL keeps the line visibly unpriced.

**Invoices are better evidence than a catalog.** `vendor_prices` rows written
from actual invoices reflect what we were billed; the catalog is a list price
that may be stale. A catalog row must never overwrite an existing price with a
blank, and must not clobber invoice-sourced pricing on a re-run.

Pack sizes arrive as `1/13/OZ` — case count, size, unit. The slash matters:
`CLAUDE.md` §8 records that PDF extraction loses it and turns `1/15#` into a
115 lb case. This source is CSV so the slash survives, and the parser is pinned
against that shape rather than trusting it.
"""

import csv
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.ingest_master_catalog import (  # noqa: E402
    main,
    parse_pack_size,
    parse_price,
    read_catalog,
)

HEADER = ['Lariat ID', 'Supplier', 'Supplier Product #', 'Description',
          'Pack Size', 'Brand', 'Price', 'Unit', 'Category']

# Real rows from the catalog, including the unpriced shape that is the majority.
ROWS = [
    ['LAR-1001', 'Shamrock', '39261', 'ANCHOVY, FLT IN OLV OIL 13', '1/13/OZ',
     'VLAFO', '14.26', 'EA', 'Pantry'],
    ['LAR-1002', 'Shamrock', '4467141', 'ASPARAGUS, JMBO', '1/11/LB',
     'MFC', '52.42', 'CS', 'Produce'],
    # No price — the majority case. Must not become 0.00.
    ['LAR-1003', 'Sysco', '7258790', 'Sweetener Agave Nectar Light Organic',
     '2/17.6/OZ', 'YAKAMI', '', 'CS', 'Pantry'],
    ['LAR-1004', 'Sysco', '4002408', 'Bread Crumbs Japanese Toasted Panko',
     '1/25/LB', 'SYSCO', '38.10', 'CS', 'Pantry'],
]


@pytest.fixture
def catalog_csv(tmp_path):
    path = tmp_path / 'catalog.csv'
    with open(path, 'w', newline='', encoding='cp1252') as handle:
        writer = csv.writer(handle)
        writer.writerow([str(i) for i in range(len(HEADER))])  # numeric pre-header
        writer.writerow(HEADER)
        writer.writerows(ROWS)
    return path


@pytest.fixture
def db(tmp_path):
    path = tmp_path / 'lariat.db'
    con = sqlite3.connect(str(path))
    con.executescript("""
        CREATE TABLE vendor_prices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ingredient TEXT, vendor TEXT, sku TEXT,
          pack_size REAL, pack_unit TEXT, pack_price REAL, unit_price REAL,
          category TEXT, location_id TEXT DEFAULT 'default',
          imported_at TEXT DEFAULT (datetime('now')),
          map_status TEXT,
          UNIQUE(vendor, sku, location_id)
        );
    """)
    con.commit()
    con.close()
    return path


def rows_of(db_path):
    con = sqlite3.connect(str(db_path))
    con.row_factory = sqlite3.Row
    try:
        return {r['sku']: dict(r) for r in con.execute('SELECT * FROM vendor_prices')}
    finally:
        con.close()


class TestParsers:
    @pytest.mark.parametrize('raw,size,unit', [
        ('1/13/OZ', 13.0, 'OZ'),
        ('1/11/LB', 11.0, 'LB'),
        ('2/17.6/OZ', 17.6, 'OZ'),
        ('1/25/LB', 25.0, 'LB'),
    ])
    def test_pack_size_keeps_the_slash_apart(self, raw, size, unit):
        assert parse_pack_size(raw) == (size, unit)

    def test_a_lost_slash_is_not_silently_read_as_a_giant_case(self):
        """CLAUDE.md §8: PDF extraction turns 1/15# into 115#. If a slash-less
        value ever reaches here we return no size rather than a 115 lb case."""
        assert parse_pack_size('115LB') == (None, 'LB')

    @pytest.mark.parametrize('raw', ['', '   ', None])
    def test_blank_price_is_none_not_zero(self, raw):
        assert parse_price(raw) is None

    @pytest.mark.parametrize('raw,want', [('14.26', 14.26), ('$52.42', 52.42),
                                          ('1,204.00', 1204.0)])
    def test_price_parsing(self, raw, want):
        assert parse_price(raw) == want


class TestRead:
    def test_skips_the_numeric_pre_header(self, catalog_csv):
        items = read_catalog(catalog_csv)
        assert len(items) == 4
        assert all(i['sku'] != '2' for i in items)

    def test_vendor_is_lowercased_to_match_existing_rows(self, catalog_csv):
        assert {i['vendor'] for i in read_catalog(catalog_csv)} == {'shamrock', 'sysco'}


class TestIngest:
    def test_loads_every_product(self, catalog_csv, db):
        assert main(['--csv', str(catalog_csv), '--db', str(db)]) == 0
        assert len(rows_of(db)) == 4

    def test_unpriced_rows_land_with_null_not_zero(self, catalog_csv, db):
        """A 0.00 would read as 'free' and silently understate every recipe
        using the ingredient. NULL keeps the line visibly unpriced."""
        main(['--csv', str(catalog_csv), '--db', str(db)])
        agave = rows_of(db)['7258790']
        assert agave['pack_price'] is None
        assert agave['ingredient'] == 'Sweetener Agave Nectar Light Organic'

    def test_priced_rows_carry_their_price_and_pack(self, catalog_csv, db):
        main(['--csv', str(catalog_csv), '--db', str(db)])
        panko = rows_of(db)['4002408']
        assert panko['pack_price'] == pytest.approx(38.10)
        assert panko['pack_size'] == pytest.approx(25.0)
        assert panko['pack_unit'] == 'LB'

    def test_rerun_is_idempotent(self, catalog_csv, db):
        main(['--csv', str(catalog_csv), '--db', str(db)])
        main(['--csv', str(catalog_csv), '--db', str(db)])
        assert len(rows_of(db)) == 4

    def test_never_overwrites_an_invoice_price_with_a_blank(self, catalog_csv, db):
        """Invoices are what we were billed; the catalog is a list price. A
        catalog row with no price must not erase real pricing."""
        con = sqlite3.connect(str(db))
        con.execute(
            "INSERT INTO vendor_prices (ingredient, vendor, sku, pack_price, location_id)"
            " VALUES ('Sweetener Agave Nectar Light Organic', 'sysco', '7258790', 61.50, 'default')")
        con.commit(); con.close()
        main(['--csv', str(catalog_csv), '--db', str(db)])
        assert rows_of(db)['7258790']['pack_price'] == pytest.approx(61.50)

    def test_a_catalog_price_fills_a_gap_where_none_existed(self, catalog_csv, db):
        con = sqlite3.connect(str(db))
        con.execute(
            "INSERT INTO vendor_prices (ingredient, vendor, sku, pack_price, location_id)"
            " VALUES ('Bread Crumbs Japanese Toasted Panko', 'sysco', '4002408', NULL, 'default')")
        con.commit(); con.close()
        main(['--csv', str(catalog_csv), '--db', str(db)])
        assert rows_of(db)['4002408']['pack_price'] == pytest.approx(38.10)

    def test_dry_run_writes_nothing(self, catalog_csv, db):
        main(['--csv', str(catalog_csv), '--db', str(db), '--dry-run'])
        assert rows_of(db) == {}

    def test_absent_csv_is_an_error(self, tmp_path, db):
        assert main(['--csv', str(tmp_path / 'nope.csv'), '--db', str(db)]) == 1
