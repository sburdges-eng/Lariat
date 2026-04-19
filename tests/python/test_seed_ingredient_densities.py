"""Unit tests for scripts.seed_ingredient_densities.

Covers:
  - Valid CSV upserts and normalizes ingredient_key correctly.
  - Leading whitespace / [JIT] prefix gets normalized away.
  - Invalid source string raises (and transaction rolls back).
  - Negative g_per_ml raises (and transaction rolls back).
  - Zero g_per_ml raises (boundary; > 0 is required).
  - Empty ingredient_name (post-normalization) is skipped with a warning.
  - Idempotency: running main() twice against the same CSV leaves
    the same row count AND the same (key -> g_per_ml, source) mapping.
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

from scripts.seed_ingredient_densities import main as seed_densities  # noqa: E402


# Minimal copy of the ingredient_densities DDL from lib/db.ts. Kept in-line
# so the test doesn't depend on the JS-side initSchema().
DDL_DENSITIES = """
CREATE TABLE IF NOT EXISTS ingredient_densities (
    ingredient_key TEXT PRIMARY KEY,
    g_per_ml REAL NOT NULL,
    source TEXT CHECK (source IS NULL OR source IN ('seed', 'measured', 'vendor')),
    updated_at TEXT DEFAULT (datetime('now'))
);
"""


def _make_db(path: Path) -> None:
    conn = sqlite3.connect(str(path))
    try:
        conn.executescript(DDL_DENSITIES)
        conn.commit()
    finally:
        conn.close()


def _write_csv(path: Path, rows: list[tuple[str, str, str, str]]) -> None:
    lines = ["ingredient_name,g_per_ml,source,notes"]
    for name, g_per_ml, source, notes in rows:
        # naive CSV: none of our fixture values contain commas or quotes
        lines.append(f"{name},{g_per_ml},{source},{notes}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _fetch_all(db_path: Path) -> list[tuple[str, float, str | None]]:
    conn = sqlite3.connect(str(db_path))
    try:
        rows = conn.execute(
            "SELECT ingredient_key, g_per_ml, source FROM ingredient_densities "
            "ORDER BY ingredient_key"
        ).fetchall()
    finally:
        conn.close()
    return rows


class SeedDensitiesHappyPath(unittest.TestCase):
    def test_valid_rows_are_upserted_and_keys_normalized(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "densities.csv"
            _make_db(db)
            _write_csv(
                csv,
                [
                    ("Water", "1.00", "seed", "physics"),
                    ("  [JIT] Olive Oil  ", "0.92", "seed", "bracket-prefix test"),
                    ("Honey", "1.42", "seed", "ref"),
                ],
            )
            rc = seed_densities(db, csv)
            self.assertEqual(rc, 0)
            rows = _fetch_all(db)
            self.assertEqual(len(rows), 3)
            by_key = {k: (g, s) for k, g, s in rows}
            # Bracket + whitespace stripped; lowercased; collapsed
            self.assertIn("olive oil", by_key)
            self.assertIn("water", by_key)
            self.assertIn("honey", by_key)
            self.assertAlmostEqual(by_key["olive oil"][0], 0.92)
            self.assertEqual(by_key["olive oil"][1], "seed")


class SeedDensitiesRejectsInvalid(unittest.TestCase):
    def test_invalid_source_raises_and_rolls_back(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "densities.csv"
            _make_db(db)
            _write_csv(
                csv,
                [
                    ("Water", "1.00", "seed", "ok"),
                    ("Olive Oil", "0.92", "book_of_yields", "not allowed here"),
                ],
            )
            with self.assertRaises(ValueError):
                seed_densities(db, csv)
            # Rollback: no rows should be present since the transaction
            # wraps the whole batch AND validation happens before the
            # transaction opens. Either way, final state must be empty.
            self.assertEqual(_fetch_all(db), [])

    def test_negative_g_per_ml_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "densities.csv"
            _make_db(db)
            _write_csv(csv, [("Water", "-1.0", "seed", "bad")])
            with self.assertRaises(ValueError):
                seed_densities(db, csv)
            self.assertEqual(_fetch_all(db), [])

    def test_zero_g_per_ml_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "densities.csv"
            _make_db(db)
            _write_csv(csv, [("Water", "0.0", "seed", "bad")])
            with self.assertRaises(ValueError):
                seed_densities(db, csv)

    def test_non_numeric_g_per_ml_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "densities.csv"
            _make_db(db)
            _write_csv(csv, [("Water", "heavy", "seed", "bad")])
            with self.assertRaises(ValueError):
                seed_densities(db, csv)


class SeedDensitiesSkipsEmptyKey(unittest.TestCase):
    def test_row_with_name_that_normalizes_to_empty_is_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "densities.csv"
            _make_db(db)
            # "[JIT]" alone normalizes to "" — should skip, not crash
            _write_csv(
                csv,
                [
                    ("[JIT]", "1.0", "seed", "becomes empty key"),
                    ("Water", "1.00", "seed", "real"),
                ],
            )
            rc = seed_densities(db, csv)
            self.assertEqual(rc, 0)
            rows = _fetch_all(db)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][0], "water")


class SeedDensitiesIdempotent(unittest.TestCase):
    def test_running_twice_yields_same_count_and_content(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = tmp_path / "test.db"
            csv = tmp_path / "densities.csv"
            _make_db(db)
            _write_csv(
                csv,
                [
                    ("Water", "1.00", "seed", "a"),
                    ("Olive Oil", "0.92", "seed", "b"),
                    ("Honey", "1.42", "seed", "c"),
                ],
            )
            self.assertEqual(seed_densities(db, csv), 0)
            first = _fetch_all(db)
            self.assertEqual(seed_densities(db, csv), 0)
            second = _fetch_all(db)
            self.assertEqual(len(first), 3)
            self.assertEqual(len(second), 3)
            # Key+value stability (updated_at timestamps differ; we check
            # ingredient_key, g_per_ml, source tuples only):
            self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
