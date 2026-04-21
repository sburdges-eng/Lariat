"""Unit tests for T5b invoice→catch-weight wiring.

Covers both the Sysco PDF path (``ingest_sysco_invoice_pdfs.parse_line_item``
+ ``enrich_catch_weights``) and the Shamrock XLS path
(``ingest_shamrock_invoices.RE_ACTUAL_WEIGHT`` + ``enrich_catch_weights``).

Scope:
  - Sysco ``parse_line_item`` returns skus + line_total so the enrich step
    can join.
  - Sysco ``enrich_catch_weights`` reads vendor_catch_weights, divides T/WT=
    total by qty for per-pack actual, calls ``reconcile_catch_weight``, and
    only sets ``reconciled_unit_price`` when deviation > threshold.
  - Sysco returns early cleanly when the DB path doesn't exist OR when the
    ``vendor_catch_weights`` table is absent (pre-T5a DB).
  - Shamrock ``RE_ACTUAL_WEIGHT`` pulls numeric weight from free-text
    description.
  - Shamrock ``enrich_catch_weights`` mutates rows in place, matches on
    ``sku``, only sets ``reconciled_unit_price`` on reconciled rows, leaves
    mis-catalog or within-threshold rows NULL.
"""
from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.ingest_sysco_invoice_pdfs import (  # noqa: E402
    enrich_catch_weights as sysco_enrich,
    parse_line_item,
)
from scripts.ingest_shamrock_invoices import (  # noqa: E402
    RE_ACTUAL_WEIGHT,
    enrich_catch_weights as shamrock_enrich,
)


DDL_VCW = """
CREATE TABLE IF NOT EXISTS vendor_catch_weights (
    vendor TEXT NOT NULL,
    sku TEXT NOT NULL,
    catalog_wt_lb REAL NOT NULL,
    tare_lb REAL,
    source TEXT,
    updated_at TEXT,
    PRIMARY KEY (vendor, sku)
);
"""


def _make_db_with_catalog(rows: list[tuple[str, str, float, float | None]]) -> Path:
    """Create a scratch DB + seed vendor_catch_weights. Returns path."""
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    con = sqlite3.connect(tmp.name)
    con.executescript(DDL_VCW)
    con.executemany(
        "INSERT INTO vendor_catch_weights (vendor, sku, catalog_wt_lb, tare_lb) VALUES (?, ?, ?, ?)",
        rows,
    )
    con.commit()
    con.close()
    return Path(tmp.name)


class SyscoLineParser(unittest.TestCase):
    PORK_CHOP = (
        "F 2 CS 1012 OZ BHB/NPM PORK CHOP B\\I FRCHD LNGBN FR "
        "1813973 4874526 18.290 318.25"
    )
    CHICKEN = (
        "C 1 CS 45 LB REDBIRD CHICKEN BRST CUTLET 5OZ 11825 "
        "7235243 5.699 117.68"
    )

    def test_parse_returns_dict_with_skus_and_totals(self) -> None:
        res = parse_line_item(self.PORK_CHOP)
        self.assertIsNotNone(res)
        self.assertEqual(res["qty"], 2)
        self.assertEqual(res["skus"], ["1813973", "4874526"])
        self.assertAlmostEqual(res["line_total"], 318.25)
        self.assertAlmostEqual(res["unit_price"], 18.29)

    def test_parse_returns_single_sku_when_only_sysco_supc_present(self) -> None:
        res = parse_line_item(self.CHICKEN)
        self.assertIsNotNone(res)
        self.assertEqual(res["skus"], ["7235243"])
        self.assertAlmostEqual(res["line_total"], 117.68)


class SyscoEnrichment(unittest.TestCase):
    """Wiring between parsed items + vendor_catch_weights."""

    def _items(self) -> list[dict]:
        # Mirrors what parse_pdf produces post-T/WT= capture.
        return [
            {
                "qty": 2,
                "skus": ["1813973", "4874526"],
                "line_total": 318.25,
                "actual_received_lb": 17.4,  # T/WT= 17.400 across 2 cases
                "reconciled_unit_price": None,
                "description": "Pork Chop",
            },
            {
                "qty": 1,
                "skus": ["7235243"],
                "line_total": 117.68,
                "actual_received_lb": 20.65,
                "reconciled_unit_price": None,
                "description": "Chicken Breast Cutlet",
            },
            {
                "qty": 1,
                "skus": ["9999999"],
                "line_total": 50.0,
                "actual_received_lb": 10.0,
                "reconciled_unit_price": None,
                "description": "Mystery item (no catalog)",
            },
            {
                "qty": 4,
                "skus": ["1234567"],
                "line_total": 40.0,
                "actual_received_lb": None,  # not catch-weight
                "reconciled_unit_price": None,
                "description": "Non-catch-weight case",
            },
        ]

    def test_enrich_joins_and_reconciles(self) -> None:
        db = _make_db_with_catalog([
            # Catalog 8 lb nominal, actual per-pack 8.7 → +8.75% deviation → reconcile.
            ("sysco", "4874526", 8.0, None),
            # Catalog 20 lb, actual 20.65 → +3.25% deviation → reconcile.
            ("sysco", "7235243", 20.0, None),
        ])
        try:
            items = self._items()
            counters = sysco_enrich(db, items)
        finally:
            db.unlink()

        self.assertEqual(counters["matched"], 2)
        self.assertEqual(counters["reconciled"], 2)
        self.assertEqual(counters["no_catalog"], 1)
        self.assertEqual(counters["no_actual"], 1)

        # Pork chop: per-pack dollars = 318.25/2 = 159.125; per-pack actual =
        # 17.4/2 = 8.7 → reconciled_unit_price = 159.125/8.7 ≈ 18.2902
        self.assertAlmostEqual(items[0]["reconciled_unit_price"], 159.125 / 8.7, places=6)
        # Chicken: 117.68/1 / 20.65 ≈ 5.6988
        self.assertAlmostEqual(items[1]["reconciled_unit_price"], 117.68 / 20.65, places=6)
        # No catalog → stays NULL.
        self.assertIsNone(items[2]["reconciled_unit_price"])
        self.assertIsNone(items[3]["reconciled_unit_price"])

    def test_within_threshold_leaves_reconciled_unit_price_null(self) -> None:
        # Catalog 10.0, actual 10.1 (1% deviation, below default 2%).
        db = _make_db_with_catalog([("sysco", "4874526", 10.0, None)])
        try:
            items = [
                {
                    "qty": 1,
                    "skus": ["4874526"],
                    "line_total": 100.0,
                    "actual_received_lb": 10.1,
                    "reconciled_unit_price": None,
                    "description": "Close match",
                }
            ]
            counters = sysco_enrich(db, items)
        finally:
            db.unlink()
        self.assertEqual(counters["matched"], 1)
        self.assertEqual(counters["reconciled"], 0)
        self.assertIsNone(items[0]["reconciled_unit_price"])

    def test_missing_db_is_noop(self) -> None:
        items = self._items()
        counters = sysco_enrich(Path("/tmp/does-not-exist-t5b.db"), items)
        self.assertEqual(counters, {"matched": 0, "reconciled": 0, "no_catalog": 0, "no_actual": 0})
        for it in items:
            self.assertIsNone(it["reconciled_unit_price"])

    def test_pre_t5a_db_without_table_is_noop(self) -> None:
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        try:
            # DB exists but has no vendor_catch_weights table.
            sqlite3.connect(tmp.name).close()
            items = self._items()
            counters = sysco_enrich(Path(tmp.name), items)
            self.assertEqual(counters, {"matched": 0, "reconciled": 0, "no_catalog": 0, "no_actual": 0})
        finally:
            Path(tmp.name).unlink()


class ShamrockActualWeightRegex(unittest.TestCase):
    def test_matches_integer_lb(self) -> None:
        m = RE_ACTUAL_WEIGHT.search("BEEF, CHEEK MEAT REFRIG\n\nActual Weight: 30lbs")
        self.assertIsNotNone(m)
        self.assertEqual(float(m.group(1)), 30.0)

    def test_matches_decimal_lb(self) -> None:
        m = RE_ACTUAL_WEIGHT.search(
            "HAM, BLK FRST 97% FF WHL SMKD WA CKD\n\nActual Weight: 19.30lbs"
        )
        self.assertIsNotNone(m)
        self.assertAlmostEqual(float(m.group(1)), 19.30)

    def test_matches_with_whitespace_and_case_variations(self) -> None:
        # Real invoices sometimes have spacing before 'lbs', lowercase label, etc.
        for text in [
            "Actual Weight:  29.90 lbs",
            "actual weight: 50lb",  # singular
            "ACTUAL WEIGHT:   42.0lbs",
        ]:
            m = RE_ACTUAL_WEIGHT.search(text)
            self.assertIsNotNone(m, f"failed to match: {text!r}")

    def test_returns_none_when_absent(self) -> None:
        m = RE_ACTUAL_WEIGHT.search("ORANGE, NAVEL 88CT")
        self.assertIsNone(m)


class ShamrockEnrichment(unittest.TestCase):
    def test_enrich_matches_by_sku_and_reconciles_when_deviated(self) -> None:
        db = _make_db_with_catalog([
            # Shamrock beef cheek — suppose catalog 20 lb, actual 30 lb (+50%).
            ("shamrock", "3091571", 20.0, None),
        ])
        try:
            rows = [
                {
                    "sku": "3091571",
                    "actual_received_lb": 30.0,
                    "line_total": 150.0,
                    "reconciled_unit_price": None,
                },
                {
                    "sku": "9999999",  # no catalog
                    "actual_received_lb": 10.0,
                    "line_total": 50.0,
                    "reconciled_unit_price": None,
                },
                {
                    "sku": "1234567",  # no actual weight parsed
                    "actual_received_lb": None,
                    "line_total": 20.0,
                    "reconciled_unit_price": None,
                },
            ]
            con = sqlite3.connect(db)
            try:
                counters = shamrock_enrich(con, rows)
            finally:
                con.close()
        finally:
            db.unlink()

        self.assertEqual(counters["matched"], 1)
        self.assertEqual(counters["reconciled"], 1)
        self.assertEqual(counters["no_catalog"], 1)
        self.assertEqual(counters["no_actual"], 1)
        # 150 / 30 lbs actual = $5/lb
        self.assertAlmostEqual(rows[0]["reconciled_unit_price"], 5.0)
        self.assertIsNone(rows[1]["reconciled_unit_price"])
        self.assertIsNone(rows[2]["reconciled_unit_price"])

    def test_within_threshold_leaves_null(self) -> None:
        db = _make_db_with_catalog([("shamrock", "3091571", 30.0, None)])
        try:
            rows = [{
                "sku": "3091571",
                "actual_received_lb": 30.3,  # +1% — under default 2%
                "line_total": 150.0,
                "reconciled_unit_price": None,
            }]
            con = sqlite3.connect(db)
            try:
                counters = shamrock_enrich(con, rows)
            finally:
                con.close()
        finally:
            db.unlink()
        self.assertEqual(counters["reconciled"], 0)
        self.assertIsNone(rows[0]["reconciled_unit_price"])


if __name__ == "__main__":
    unittest.main()
