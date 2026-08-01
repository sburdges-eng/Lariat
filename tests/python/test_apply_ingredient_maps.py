"""Applying reviewed ingredient maps — the write half of the B2 worklist.

`build_mapping_worklist.py` proposes and never applies. This is the other side:
it reads the `accept` column a human filled in and writes `ingredient_maps`,
which `enrich-bom-vendor-columns.mjs` then propagates onto `bom_lines`.

The discipline that matters here is that a proposal is not a decision. Only the
`accept` column is ever read — never `proposed_vendor_ingredient` — so a row a
reviewer skipped stays unmapped rather than quietly taking the machine's guess.
That is the whole point of splitting propose from apply, and the test suite
holds it.

Accepting a vendor description that does not exist in `vendor_prices` is a typo,
not a new product, and is rejected loudly. Silently writing it would create a map
that can never price, which looks identical to a working map until someone reads
the cost.
"""

import csv
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.apply_ingredient_maps import main, read_decisions  # noqa: E402

FIELDS = ['ingredient', 'recipe_count', 'line_count', 'units', 'reason',
          'proposed_vendor_ingredient', 'alternates', 'accept']

CATALOG = ['HERB, THYME', 'OIL, OLV XVRGN IMP', 'TORTILLA, FLOUR 6"',
           'EXTRACT, VANILLA PURE', 'Cookie Vanilla Wafer']


def write_worklist(path, rows):
    with open(path, 'w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow({**{f: '' for f in FIELDS}, **row})


@pytest.fixture
def db(tmp_path):
    path = tmp_path / 'lariat.db'
    con = sqlite3.connect(str(path))
    con.executescript("""
        CREATE TABLE ingredient_maps (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipe_ingredient TEXT, vendor_ingredient TEXT, status TEXT,
          location_id TEXT DEFAULT 'default',
          imported_at TEXT DEFAULT (datetime('now')),
          UNIQUE(recipe_ingredient, location_id));
        CREATE TABLE vendor_prices (
          id INTEGER PRIMARY KEY AUTOINCREMENT, ingredient TEXT, vendor TEXT,
          location_id TEXT DEFAULT 'default');
    """)
    con.executemany("INSERT INTO vendor_prices (ingredient, vendor) VALUES (?, 'shamrock')",
                    [(c,) for c in CATALOG])
    con.commit()
    con.close()
    return path


def maps_in(db_path):
    con = sqlite3.connect(str(db_path))
    try:
        return {r[0]: r[1] for r in con.execute(
            'SELECT recipe_ingredient, vendor_ingredient FROM ingredient_maps')}
    finally:
        con.close()


class TestOnlyAcceptedRowsApply:
    def test_writes_an_accepted_map(self, tmp_path, db):
        wl = tmp_path / 'wl.csv'
        write_worklist(wl, [{'ingredient': 'fresh thyme', 'accept': 'HERB, THYME'}])
        assert main(['--worklist', str(wl), '--db', str(db)]) == 0
        assert maps_in(db) == {'fresh thyme': 'HERB, THYME'}

    def test_a_proposal_alone_is_never_applied(self, tmp_path, db):
        """The reviewer left `accept` blank. The machine's guess must not win —
        this is the entire reason propose and apply are separate steps."""
        wl = tmp_path / 'wl.csv'
        write_worklist(wl, [{'ingredient': 'vanilla',
                             'proposed_vendor_ingredient': 'Cookie Vanilla Wafer',
                             'accept': ''}])
        main(['--worklist', str(wl), '--db', str(db)])
        assert maps_in(db) == {}

    def test_accept_overrides_a_wrong_proposal(self, tmp_path, db):
        wl = tmp_path / 'wl.csv'
        write_worklist(wl, [{'ingredient': 'vanilla',
                             'proposed_vendor_ingredient': 'Cookie Vanilla Wafer',
                             'accept': 'EXTRACT, VANILLA PURE'}])
        main(['--worklist', str(wl), '--db', str(db)])
        assert maps_in(db)['vanilla'] == 'EXTRACT, VANILLA PURE'

    def test_none_records_a_deliberate_no_map(self, tmp_path, db):
        """'none' is a decision, not a blank. It must not be written as a map."""
        wl = tmp_path / 'wl.csv'
        write_worklist(wl, [{'ingredient': 'arugula', 'reason': 'other_vendor',
                             'accept': 'none'}])
        main(['--worklist', str(wl), '--db', str(db)])
        assert maps_in(db) == {}


class TestRejectsBadAccepts:
    def test_unknown_vendor_description_is_an_error(self, tmp_path, db, capsys):
        """A typo would create a map that can never price — indistinguishable
        from a working map until someone reads the cost."""
        wl = tmp_path / 'wl.csv'
        write_worklist(wl, [{'ingredient': 'fresh thyme', 'accept': 'HERB, THYMEE'}])
        assert main(['--worklist', str(wl), '--db', str(db)]) == 1
        assert maps_in(db) == {}
        assert 'HERB, THYMEE' in capsys.readouterr().err

    def test_one_bad_row_blocks_the_whole_batch(self, tmp_path, db):
        """Partial application leaves the operator guessing what landed."""
        wl = tmp_path / 'wl.csv'
        write_worklist(wl, [
            {'ingredient': 'fresh thyme', 'accept': 'HERB, THYME'},
            {'ingredient': 'evoo', 'accept': 'NOT A REAL PRODUCT'},
        ])
        assert main(['--worklist', str(wl), '--db', str(db)]) == 1
        assert maps_in(db) == {}


class TestIdempotenceAndUpdate:
    def test_rerun_changes_nothing(self, tmp_path, db):
        wl = tmp_path / 'wl.csv'
        write_worklist(wl, [{'ingredient': 'fresh thyme', 'accept': 'HERB, THYME'}])
        main(['--worklist', str(wl), '--db', str(db)])
        main(['--worklist', str(wl), '--db', str(db)])
        con = sqlite3.connect(str(db))
        assert list(con.execute('SELECT COUNT(*) FROM ingredient_maps'))[0][0] == 1
        con.close()

    def test_a_corrected_decision_replaces_the_old_one(self, tmp_path, db):
        wl = tmp_path / 'wl.csv'
        write_worklist(wl, [{'ingredient': 'vanilla', 'accept': 'Cookie Vanilla Wafer'}])
        main(['--worklist', str(wl), '--db', str(db)])
        write_worklist(wl, [{'ingredient': 'vanilla', 'accept': 'EXTRACT, VANILLA PURE'}])
        main(['--worklist', str(wl), '--db', str(db)])
        assert maps_in(db)['vanilla'] == 'EXTRACT, VANILLA PURE'

    def test_dry_run_writes_nothing(self, tmp_path, db):
        wl = tmp_path / 'wl.csv'
        write_worklist(wl, [{'ingredient': 'fresh thyme', 'accept': 'HERB, THYME'}])
        main(['--worklist', str(wl), '--db', str(db), '--dry-run'])
        assert maps_in(db) == {}


class TestReadDecisions:
    def test_ignores_blank_and_none(self, tmp_path):
        wl = tmp_path / 'wl.csv'
        write_worklist(wl, [
            {'ingredient': 'a', 'accept': 'HERB, THYME'},
            {'ingredient': 'b', 'accept': ''},
            {'ingredient': 'c', 'accept': 'none'},
            {'ingredient': 'd', 'accept': '  NONE  '},
        ])
        assert [d['ingredient'] for d in read_decisions(wl)] == ['a']

    def test_missing_accept_column_is_an_error(self, tmp_path):
        wl = tmp_path / 'wl.csv'
        with open(wl, 'w', newline='', encoding='utf-8') as handle:
            writer = csv.writer(handle)
            writer.writerow(['ingredient', 'reason'])
            writer.writerow(['fresh thyme', 'needs_map'])
        with pytest.raises(ValueError, match='accept'):
            read_decisions(wl)
