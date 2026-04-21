"""Unit tests for scripts.ingest_catch_weights.

Covers:
  - Valid CSV upserts every row and persists the chosen vendor tag.
  - User-measured override row (sku 7078475) brings tare_lb + source.
  - catalog_wt_lb == 0 raises and rolls back the transaction.
  - tare_lb negative raises and rolls back.
  - Empty sku is skipped with a warning, not an error.
  - Idempotency: running twice yields the same rows and count.
  - Wrong header shape fails loud with the offending file path.
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

from scripts.ingest_catch_weights import main as ingest_catch_weights  # noqa: E402


DDL_VCW = """
CREATE TABLE IF NOT EXISTS vendor_catch_weights (
    vendor        TEXT NOT NULL,
    sku           TEXT NOT NULL,
    catalog_wt_lb REAL NOT NULL,
    tare_lb       REAL,
    source        TEXT,
    updated_at    TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (vendor, sku)
);
"""

HEADER = "sku,ingredient,pack_size,pack_unit,sysco_net_wt_lb,tare_lb,verified_net_weight_g,source,verified"


def _make_db(path: Path) -> None:
    conn = sqlite3.connect(str(path))
    try:
        conn.executescript(DDL_VCW)
        conn.commit()
    finally:
        conn.close()


def _write_csv(path: Path, rows: list[str]) -> None:
    path.write_text("\n".join([HEADER, *rows]) + "\n", encoding="utf-8")


def _fetch_all(db_path: Path) -> list[tuple]:
    conn = sqlite3.connect(str(db_path))
    try:
        rows = conn.execute(
            "SELECT vendor, sku, catalog_wt_lb, tare_lb, source "
            "FROM vendor_catch_weights ORDER BY sku"
        ).fetchall()
    finally:
        conn.close()
    return rows


class BasicIngest(unittest.TestCase):
    def test_valid_csv_populates_rows_with_vendor_tag(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "lariat.db"
            csv = tmpdir / "pack_weights.csv"
            _make_db(db)
            _write_csv(
                csv,
                [
                    "5844220,Bean Black,6,CT,41.25,,,sysco_catalog,false",
                    "7078475,Cilantro Bunch,8,CT,8.0,2.0,2722,user-measured 2026-04-04,true",
                ],
            )
            rc = ingest_catch_weights(db, csv, "sysco")
            self.assertEqual(rc, 0)
            rows = _fetch_all(db)
            self.assertEqual(len(rows), 2)
            self.assertEqual(
                rows,
                [
                    ("sysco", "5844220", 41.25, None, "sysco_catalog"),
                    ("sysco", "7078475", 8.0, 2.0, "user-measured 2026-04-04"),
                ],
            )

    def test_vendor_parameter_determines_namespace(self) -> None:
        # Same sku ingested under two different vendor tags produces two
        # separate PK rows; catalog_wt_lb can differ.
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "lariat.db"
            csv = tmpdir / "pack_weights.csv"
            _make_db(db)
            _write_csv(csv, ["12345,Thing,1,CT,10.0,,,sysco_catalog,false"])
            ingest_catch_weights(db, csv, "sysco")

            _write_csv(csv, ["12345,Thing,1,CT,20.0,,,shamrock_catalog,false"])
            ingest_catch_weights(db, csv, "shamrock")

            rows = _fetch_all(db)
            self.assertEqual(len(rows), 2)
            self.assertEqual({r[0] for r in rows}, {"sysco", "shamrock"})


class Idempotency(unittest.TestCase):
    def test_repeat_runs_preserve_row_count(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "lariat.db"
            csv = tmpdir / "pack_weights.csv"
            _make_db(db)
            _write_csv(
                csv,
                [
                    "5844220,Bean Black,6,CT,41.25,,,sysco_catalog,false",
                    "7078475,Cilantro Bunch,8,CT,8.0,2.0,2722,user-measured 2026-04-04,true",
                ],
            )
            ingest_catch_weights(db, csv, "sysco")
            first = _fetch_all(db)
            ingest_catch_weights(db, csv, "sysco")
            second = _fetch_all(db)
            self.assertEqual(first, second)


class ValidationErrors(unittest.TestCase):
    def test_zero_catalog_wt_raises_and_rolls_back(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "lariat.db"
            csv = tmpdir / "pack_weights.csv"
            _make_db(db)
            _write_csv(
                csv,
                [
                    # Second row is invalid — whole transaction must roll back.
                    "5844220,Bean Black,6,CT,41.25,,,sysco_catalog,false",
                    "12345,Bad,1,CT,0.0,,,sysco_catalog,false",
                ],
            )
            with self.assertRaises(ValueError):
                ingest_catch_weights(db, csv, "sysco")
            # Either 0 rows (validation fails before commit) is fine; what
            # matters is no partial write — the first row shouldn't be in DB.
            self.assertEqual(_fetch_all(db), [])

    def test_negative_tare_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "lariat.db"
            csv = tmpdir / "pack_weights.csv"
            _make_db(db)
            _write_csv(
                csv,
                ["12345,Bad,1,CT,10.0,-0.5,,sysco_catalog,false"],
            )
            with self.assertRaises(ValueError):
                ingest_catch_weights(db, csv, "sysco")
            self.assertEqual(_fetch_all(db), [])

    def test_empty_sku_is_skipped_with_warning(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "lariat.db"
            csv = tmpdir / "pack_weights.csv"
            _make_db(db)
            _write_csv(
                csv,
                [
                    ",Empty SKU,1,CT,10.0,,,sysco_catalog,false",
                    "12345,Good,1,CT,10.0,,,sysco_catalog,false",
                ],
            )
            rc = ingest_catch_weights(db, csv, "sysco")
            self.assertEqual(rc, 0)
            rows = _fetch_all(db)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][1], "12345")

    def test_wrong_header_shape_fails_loud(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "lariat.db"
            csv = tmpdir / "pack_weights.csv"
            _make_db(db)
            # Wrong header
            csv.write_text(
                "sku,ingredient,pack_size,pack_unit,WRONG_COL,tare_lb,verified_net_weight_g,source,verified\n"
                "12345,Good,1,CT,10.0,,,sysco_catalog,false\n",
                encoding="utf-8",
            )
            with self.assertRaises(ValueError) as ctx:
                ingest_catch_weights(db, csv, "sysco")
            self.assertIn("header mismatch", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
