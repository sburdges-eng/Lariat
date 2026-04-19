"""Unit tests for scripts.seed_ingredient_yields.

Covers:
  - Valid CSV upserts and normalizes ingredient_key correctly.
  - Empty loss_factor cell becomes NULL in DB.
  - Non-empty loss_factor cell stored as float.
  - Invalid source raises.
  - yield_pct > 1.0 rejected (yields are fractions, not percents).
  - yield_pct = 0 rejected (strict > 0).
  - loss_factor >= 1.0 rejected.
  - [JIT] prefix and whitespace stripped from ingredient_name.
  - Idempotency on repeated main() calls.
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

from scripts.seed_ingredient_yields import main as seed_yields  # noqa: E402


# Minimal copy of the ingredient_yields DDL from lib/db.ts (T2a).
DDL_YIELDS = """
CREATE TABLE IF NOT EXISTS ingredient_yields (
    ingredient_key TEXT PRIMARY KEY,
    yield_pct      REAL NOT NULL,
    loss_factor    REAL,
    source         TEXT NOT NULL CHECK (source IN ('book_of_yields', 'lariat_measured', 'seed')),
    notes          TEXT,
    updated_at     TEXT DEFAULT (datetime('now'))
);
"""


def _make_db(path: Path) -> None:
    conn = sqlite3.connect(str(path))
    try:
        conn.executescript(DDL_YIELDS)
        conn.commit()
    finally:
        conn.close()


def _write_csv(path: Path, rows: list[tuple[str, str, str, str, str]]) -> None:
    """rows = list of (ingredient_name, yield_pct, loss_factor, source, notes)."""
    lines = ["ingredient_name,yield_pct,loss_factor,source,notes"]
    for name, yp, lf, source, notes in rows:
        lines.append(f"{name},{yp},{lf},{source},{notes}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _fetch_all(
    db_path: Path,
) -> list[tuple[str, float, float | None, str, str | None]]:
    conn = sqlite3.connect(str(db_path))
    try:
        rows = conn.execute(
            "SELECT ingredient_key, yield_pct, loss_factor, source, notes "
            "FROM ingredient_yields ORDER BY ingredient_key"
        ).fetchall()
    finally:
        conn.close()
    return rows


class SeedYieldsHappyPath(unittest.TestCase):
    def test_valid_rows_upserted_and_keys_normalized(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "yields.csv"
            _make_db(db)
            _write_csv(
                csv,
                [
                    ("Kosher Salt", "1.0", "", "seed", "no trim"),
                    ("  [JIT] Yellow Onion  ", "0.82", "", "book_of_yields", "BoY"),
                    ("Ribeye Steak", "0.88", "0.25", "book_of_yields", "grilled med"),
                ],
            )
            rc = seed_yields(db, csv)
            self.assertEqual(rc, 0)
            rows = _fetch_all(db)
            self.assertEqual(len(rows), 3)
            by_key = {k: (yp, lf, src, n) for k, yp, lf, src, n in rows}
            self.assertIn("kosher salt", by_key)
            self.assertIn("yellow onion", by_key)
            self.assertIn("ribeye steak", by_key)
            # Empty loss_factor -> NULL
            self.assertIsNone(by_key["kosher salt"][1])
            self.assertIsNone(by_key["yellow onion"][1])
            # Non-empty loss_factor -> float
            self.assertAlmostEqual(by_key["ribeye steak"][1], 0.25)
            # Source preserved
            self.assertEqual(by_key["kosher salt"][2], "seed")
            self.assertEqual(by_key["yellow onion"][2], "book_of_yields")
            # Notes preserved
            self.assertEqual(by_key["kosher salt"][3], "no trim")


class SeedYieldsRejectsInvalid(unittest.TestCase):
    def test_yield_pct_above_one_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "yields.csv"
            _make_db(db)
            _write_csv(csv, [("Kosher Salt", "1.5", "", "seed", "wrong unit")])
            with self.assertRaises(ValueError):
                seed_yields(db, csv)
            self.assertEqual(_fetch_all(db), [])

    def test_yield_pct_zero_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "yields.csv"
            _make_db(db)
            _write_csv(csv, [("Water", "0.0", "", "seed", "bad")])
            with self.assertRaises(ValueError):
                seed_yields(db, csv)

    def test_yield_pct_negative_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "yields.csv"
            _make_db(db)
            _write_csv(csv, [("Water", "-0.5", "", "seed", "bad")])
            with self.assertRaises(ValueError):
                seed_yields(db, csv)

    def test_loss_factor_one_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "yields.csv"
            _make_db(db)
            _write_csv(csv, [("Bacon", "1.0", "1.0", "book_of_yields", "100% loss impossible")])
            with self.assertRaises(ValueError):
                seed_yields(db, csv)

    def test_loss_factor_negative_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "yields.csv"
            _make_db(db)
            _write_csv(csv, [("Ribeye", "0.88", "-0.1", "book_of_yields", "bad")])
            with self.assertRaises(ValueError):
                seed_yields(db, csv)

    def test_invalid_source_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "yields.csv"
            _make_db(db)
            _write_csv(csv, [("Water", "1.0", "", "vendor", "not allowed here")])
            with self.assertRaises(ValueError):
                seed_yields(db, csv)

    def test_non_numeric_yield_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "yields.csv"
            _make_db(db)
            _write_csv(csv, [("Water", "high", "", "seed", "bad")])
            with self.assertRaises(ValueError):
                seed_yields(db, csv)


class SeedYieldsNullLossFactor(unittest.TestCase):
    def test_empty_loss_factor_becomes_null(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "yields.csv"
            _make_db(db)
            _write_csv(csv, [("Water", "1.0", "", "seed", "liquid")])
            rc = seed_yields(db, csv)
            self.assertEqual(rc, 0)
            rows = _fetch_all(db)
            self.assertEqual(len(rows), 1)
            # (ingredient_key, yield_pct, loss_factor, source, notes)
            self.assertIsNone(rows[0][2])


class SeedYieldsSkipsEmptyKey(unittest.TestCase):
    def test_row_that_normalizes_to_empty_is_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "yields.csv"
            _make_db(db)
            _write_csv(
                csv,
                [
                    ("[JIT]", "1.0", "", "seed", "empty after normalize"),
                    ("Water", "1.0", "", "seed", "real"),
                ],
            )
            rc = seed_yields(db, csv)
            self.assertEqual(rc, 0)
            rows = _fetch_all(db)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][0], "water")


class SeedYieldsRejectsMalformedCsv(unittest.TestCase):
    """I1 shape-guard tests: header mismatch and per-row field-count
    mismatch must raise loudly *before* pandas silently pads/shifts fields
    and produces a misleading downstream validation error."""

    def test_extra_trailing_comma_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "yields.csv"
            _make_db(db)
            # 5-column header, but row 3 has 6 fields.
            csv.write_text(
                "ingredient_name,yield_pct,loss_factor,source,notes\n"
                "kosher salt,1.0,,seed,no trim\n"
                "yellow onion,0.82,,book_of_yields,BoY,extra\n",
                encoding="utf-8",
            )
            with self.assertRaises(ValueError) as cm:
                seed_yields(db, csv)
            msg = str(cm.exception)
            self.assertIn("line 3", msg)
            self.assertIn("6 fields", msg)
            # DB untouched.
            self.assertEqual(_fetch_all(db), [])

    def test_missing_column_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "yields.csv"
            _make_db(db)
            # Row 3 has 4 fields (missing notes).
            csv.write_text(
                "ingredient_name,yield_pct,loss_factor,source,notes\n"
                "kosher salt,1.0,,seed,no trim\n"
                "yellow onion,0.82,,book_of_yields\n",
                encoding="utf-8",
            )
            with self.assertRaises(ValueError) as cm:
                seed_yields(db, csv)
            msg = str(cm.exception)
            self.assertIn("line 3", msg)
            self.assertIn("4 fields", msg)
            self.assertEqual(_fetch_all(db), [])

    def test_wrong_header_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "yields.csv"
            _make_db(db)
            # Header missing the `_name` suffix on the first column.
            csv.write_text(
                "ingredient,yield_pct,loss_factor,source,notes\n"
                "kosher salt,1.0,,seed,no trim\n",
                encoding="utf-8",
            )
            with self.assertRaises(ValueError) as cm:
                seed_yields(db, csv)
            msg = str(cm.exception)
            self.assertIn("header mismatch", msg)
            self.assertEqual(_fetch_all(db), [])


class SeedYieldsIdempotent(unittest.TestCase):
    def test_running_twice_yields_same_count_and_content(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "yields.csv"
            _make_db(db)
            _write_csv(
                csv,
                [
                    ("Water", "1.0", "", "seed", "a"),
                    ("Yellow Onion", "0.82", "", "book_of_yields", "b"),
                    ("Ribeye Steak", "0.88", "0.25", "book_of_yields", "c"),
                ],
            )
            self.assertEqual(seed_yields(db, csv), 0)
            first = _fetch_all(db)
            self.assertEqual(seed_yields(db, csv), 0)
            second = _fetch_all(db)
            self.assertEqual(len(first), 3)
            self.assertEqual(len(second), 3)
            # ingredient_key, yield_pct, loss_factor, source, notes
            # all stable across re-run (updated_at excluded from SELECT)
            self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
