"""Unit tests for scripts.ingest_sysco_invoice_pdfs.persist_sysco_items_to_sqlite.

Covers:
  - Fresh DB (no sysco_invoices table) gets the table created + rows written.
  - Missing DB path → no-op (returns 0), doesn't crash.
  - SUPC is picked from the last peeled SKU in items[].skus.
  - Rerun with same items DELETE+REINSERTs (full refresh per invoice_no).
  - Rows for other invoices are NOT touched on rerun.
  - catch-weight columns (actual_received_lb, reconciled_unit_price)
    persist NULL when the item lacks them.
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
    ensure_sysco_invoices_table,
    persist_sysco_items_to_sqlite,
)


def _new_db() -> Path:
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    return Path(tmp.name)


def _rows(db: Path) -> list[tuple]:
    with sqlite3.connect(str(db)) as con:
        return con.execute(
            "SELECT invoice_no, description, sku, qty, line_total, "
            "actual_received_lb, reconciled_unit_price "
            "FROM sysco_invoices ORDER BY invoice_no, description"
        ).fetchall()


class BasicPersist(unittest.TestCase):
    def test_fresh_db_creates_table_and_inserts(self) -> None:
        db = _new_db()
        try:
            # Pre-create an empty DB so persist_ is not a no-op; the function
            # only runs when the file exists.
            sqlite3.connect(db).close()
            items = [
                {"invoice": "759616979", "delivery_date": "3/12/2026",
                 "description": "Pork Chop", "qty": 2,
                 "skus": ["1813973", "4874526"], "unit_price": 18.29,
                 "line_total": 318.25, "actual_received_lb": 17.4,
                 "reconciled_unit_price": 18.29, "category": "Meat"},
                {"invoice": "759616979", "delivery_date": "3/12/2026",
                 "description": "Chicken Breast", "qty": 1,
                 "skus": ["7235243"], "unit_price": 5.699, "line_total": 117.68,
                 "actual_received_lb": 20.65, "reconciled_unit_price": 5.70,
                 "category": "Meat"},
            ]
            n = persist_sysco_items_to_sqlite(db, items, "EnterpriseInvoice-759616979.pdf")
            self.assertEqual(n, 2)
            rows = _rows(db)
            self.assertEqual(len(rows), 2)
            # SUPC is last peeled SKU — last-of-list.
            skus = {r[2] for r in rows}
            self.assertEqual(skus, {"4874526", "7235243"})
        finally:
            db.unlink()

    def test_missing_db_path_is_noop(self) -> None:
        n = persist_sysco_items_to_sqlite(Path("tmp/does-not-exist-sysco.db"),
                                           [{"invoice": "x", "description": "y", "qty": 1}],
                                           "src.pdf")
        self.assertEqual(n, 0)


class IdempotencyAndRefresh(unittest.TestCase):
    def test_rerun_same_invoice_delete_plus_reinsert(self) -> None:
        db = _new_db()
        try:
            sqlite3.connect(db).close()
            items_v1 = [
                {"invoice": "A", "delivery_date": "1/1/2026",
                 "description": "Pork", "qty": 2, "skus": ["4874526"],
                 "line_total": 100.0, "actual_received_lb": 17.4,
                 "reconciled_unit_price": None},
            ]
            persist_sysco_items_to_sqlite(db, items_v1, "a.pdf")
            items_v2 = [
                {"invoice": "A", "delivery_date": "1/1/2026",
                 "description": "Pork", "qty": 3, "skus": ["4874526"],
                 "line_total": 150.0, "actual_received_lb": 26.1,
                 "reconciled_unit_price": 5.75},
            ]
            persist_sysco_items_to_sqlite(db, items_v2, "a.pdf")
            rows = _rows(db)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][3], 3)   # qty updated
            self.assertAlmostEqual(rows[0][4], 150.0)
            self.assertAlmostEqual(rows[0][5], 26.1)
        finally:
            db.unlink()

    def test_rerun_other_invoice_is_untouched(self) -> None:
        db = _new_db()
        try:
            sqlite3.connect(db).close()
            persist_sysco_items_to_sqlite(db, [
                {"invoice": "A", "description": "x", "qty": 1, "skus": ["1111"],
                 "line_total": 10.0},
                {"invoice": "B", "description": "y", "qty": 2, "skus": ["2222"],
                 "line_total": 20.0},
            ], "a.pdf")
            # Rerun touching only invoice A — invoice B must survive.
            persist_sysco_items_to_sqlite(db, [
                {"invoice": "A", "description": "x", "qty": 9, "skus": ["1111"],
                 "line_total": 90.0},
            ], "a.pdf")
            rows = _rows(db)
            self.assertEqual(len(rows), 2)
            by_inv = {r[0]: r for r in rows}
            self.assertAlmostEqual(by_inv["A"][4], 90.0)
            self.assertAlmostEqual(by_inv["B"][4], 20.0)
        finally:
            db.unlink()


class EnsureTableIdempotent(unittest.TestCase):
    def test_ensure_is_idempotent(self) -> None:
        with sqlite3.connect(":memory:") as con:
            ensure_sysco_invoices_table(con)
            ensure_sysco_invoices_table(con)
            cols = [r[1] for r in con.execute("PRAGMA table_info(sysco_invoices)").fetchall()]
            for required in ("invoice_no", "description", "sku", "actual_received_lb",
                             "reconciled_unit_price", "location_id"):
                self.assertIn(required, cols)


class NullCatchWeightPersistsAsNull(unittest.TestCase):
    def test_null_catch_weight_persists_as_null(self) -> None:
        db = _new_db()
        try:
            sqlite3.connect(db).close()
            persist_sysco_items_to_sqlite(db, [
                {"invoice": "X", "description": "Non-catch-weight", "qty": 1,
                 "skus": ["1111"], "line_total": 10.0,
                 "actual_received_lb": None, "reconciled_unit_price": None},
            ], "x.pdf")
            rows = _rows(db)
            self.assertIsNone(rows[0][5])
            self.assertIsNone(rows[0][6])
        finally:
            db.unlink()


if __name__ == "__main__":
    unittest.main()
