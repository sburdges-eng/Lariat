"""Unit tests for the shared scripts.lib.seed_upsert module (debt D2).

The per-script tests in test_seed_ingredient_{densities,yields}.py and
test_ingest_catch_weights.py are the integration-level ground truth —
they exercise the real seed scripts end-to-end.  This file is the
mid-level, parameterized test of the shared driver itself so a
regression in the shared layer surfaces with a crisp error here
rather than a tangled cascade across the three per-script files.

Covers:
  - Header-shape validation fires with file path + offending line.
  - Missing column raises.
  - Idempotent UPSERT across a re-run.
  - Validation error triggers rollback (no partial write).
  - Empty normalized key → skip + stderr warn.
  - Source enum validation (both required-enum and optional-enum paths).
  - null_on_empty handling for optional cells.
  - Composite primary keys + injected constant columns.
"""
from __future__ import annotations

import contextlib
import io
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.seed_upsert import (  # noqa: E402
    ALLOWED_SEED_SOURCES,
    ColumnSpec,
    SeedSpec,
    assert_csv_shape,
    seed_upsert_main,
)


# ---------------------------------------------------------------------------
# assert_csv_shape
# ---------------------------------------------------------------------------


class AssertCsvShape(unittest.TestCase):
    def test_empty_file_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            csv = Path(tmp) / "empty.csv"
            csv.write_text("", encoding="utf-8")
            with self.assertRaises(ValueError) as cm:
                assert_csv_shape(csv, ("a", "b"))
            self.assertIn("empty", str(cm.exception))

    def test_wrong_header_names_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            csv = Path(tmp) / "bad.csv"
            csv.write_text("x,y\n1,2\n", encoding="utf-8")
            with self.assertRaises(ValueError) as cm:
                assert_csv_shape(csv, ("a", "b"))
            self.assertIn("header mismatch", str(cm.exception))

    def test_row_with_extra_field_raises_with_line_number(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            csv = Path(tmp) / "row.csv"
            csv.write_text("a,b\n1,2\n3,4,5\n", encoding="utf-8")
            with self.assertRaises(ValueError) as cm:
                assert_csv_shape(csv, ("a", "b"))
            msg = str(cm.exception)
            self.assertIn("line 3", msg)
            self.assertIn("3 fields", msg)
            # Path name should be echoed — the tempdir path contains the
            # filename, so checking for "row.csv" is enough.
            self.assertIn("row.csv", msg)

    def test_row_with_missing_field_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            csv = Path(tmp) / "row.csv"
            csv.write_text("a,b,c\n1,2,3\n4,5\n", encoding="utf-8")
            with self.assertRaises(ValueError) as cm:
                assert_csv_shape(csv, ("a", "b", "c"))
            self.assertIn("line 3", str(cm.exception))
            self.assertIn("2 fields", str(cm.exception))

    def test_trailing_blank_line_is_tolerated(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            csv = Path(tmp) / "row.csv"
            csv.write_text("a,b\n1,2\n\n", encoding="utf-8")
            # Must not raise.
            assert_csv_shape(csv, ("a", "b"))


# ---------------------------------------------------------------------------
# Helpers for end-to-end spec-driven tests
# ---------------------------------------------------------------------------

DDL_TWO_COL = """
CREATE TABLE IF NOT EXISTS toy (
    k TEXT PRIMARY KEY,
    v REAL NOT NULL,
    src TEXT CHECK (src IS NULL OR src IN ('seed','measured','vendor')),
    updated_at TEXT DEFAULT (datetime('now'))
);
"""

DDL_COMPOSITE = """
CREATE TABLE IF NOT EXISTS toy_composite (
    vendor TEXT NOT NULL,
    sku TEXT NOT NULL,
    wt REAL NOT NULL,
    note TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (vendor, sku)
);
"""


def _lowercase_strip(s: str) -> str:
    return str(s).strip().lower()


def _make_toy_spec() -> SeedSpec:
    """A compact SeedSpec covering: normalize_to_key, required numeric
    with validator, null_on_empty enum, and non-persisted column."""
    return SeedSpec(
        script_name="toy_seed",
        table_name="toy",
        columns=(
            ColumnSpec(csv_name="name", db_column="k", normalize_to_key=True),
            ColumnSpec(
                csv_name="value",
                db_column="v",
                coerce=float,
                validate=lambda v: v > 0,
                validate_msg="must be > 0",
            ),
            ColumnSpec(
                csv_name="source",
                db_column="src",
                null_on_empty=True,
                validate=lambda v: v in ALLOWED_SEED_SOURCES,
                validate_msg=f"not in allowed values {sorted(ALLOWED_SEED_SOURCES)}",
            ),
            ColumnSpec(csv_name="notes", persist=False, required=False),
        ),
        on_conflict_columns=("k",),
        normalize_fn=_lowercase_strip,
    )


def _make_composite_spec() -> SeedSpec:
    """Composite PK (vendor, sku) with vendor as injected constant."""
    return SeedSpec(
        script_name="toy_composite",
        table_name="toy_composite",
        columns=(
            ColumnSpec(csv_name="sku", normalize_to_key=True),
            ColumnSpec(
                csv_name="wt",
                coerce=float,
                validate=lambda v: v > 0,
                validate_msg="must be > 0",
            ),
            ColumnSpec(csv_name="note", null_on_empty=True),
        ),
        on_conflict_columns=("vendor", "sku"),
        normalize_fn=lambda s: str(s).strip(),
    )


def _init_db(path: Path, ddl: str) -> None:
    conn = sqlite3.connect(str(path))
    try:
        conn.executescript(ddl)
        conn.commit()
    finally:
        conn.close()


def _fetch_toy(db: Path) -> list[tuple]:
    conn = sqlite3.connect(str(db))
    try:
        return conn.execute(
            "SELECT k, v, src FROM toy ORDER BY k"
        ).fetchall()
    finally:
        conn.close()


def _fetch_composite(db: Path) -> list[tuple]:
    conn = sqlite3.connect(str(db))
    try:
        return conn.execute(
            "SELECT vendor, sku, wt, note FROM toy_composite ORDER BY vendor, sku"
        ).fetchall()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# End-to-end spec-driven tests
# ---------------------------------------------------------------------------


class SeedUpsertHappyPath(unittest.TestCase):
    def test_valid_rows_upserted(self) -> None:
        spec = _make_toy_spec()
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "t.db"
            csv = tmpdir / "t.csv"
            _init_db(db, DDL_TWO_COL)
            csv.write_text(
                "name,value,source,notes\n"
                "Alpha,1.5,seed,provenance1\n"
                "  BETA ,2.25,measured,p2\n"
                "Gamma,0.5,,\n",  # empty source -> NULL
                encoding="utf-8",
            )
            rc = seed_upsert_main(spec, db, csv)
            self.assertEqual(rc, 0)
            rows = _fetch_toy(db)
            self.assertEqual(len(rows), 3)
            by_k = {k: (v, s) for k, v, s in rows}
            self.assertAlmostEqual(by_k["alpha"][0], 1.5)
            self.assertEqual(by_k["alpha"][1], "seed")
            # whitespace + case stripped
            self.assertIn("beta", by_k)
            self.assertIsNone(by_k["gamma"][1])  # empty source -> NULL


class SeedUpsertIdempotent(unittest.TestCase):
    def test_run_twice_yields_same_rows(self) -> None:
        spec = _make_toy_spec()
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "t.db"
            csv = tmpdir / "t.csv"
            _init_db(db, DDL_TWO_COL)
            csv.write_text(
                "name,value,source,notes\n"
                "Alpha,1.5,seed,\n"
                "Beta,2.0,measured,\n",
                encoding="utf-8",
            )
            self.assertEqual(seed_upsert_main(spec, db, csv), 0)
            first = _fetch_toy(db)
            self.assertEqual(seed_upsert_main(spec, db, csv), 0)
            second = _fetch_toy(db)
            self.assertEqual(first, second)
            self.assertEqual(len(first), 2)


class SeedUpsertValidationRollsBack(unittest.TestCase):
    def test_invalid_source_raises_and_rolls_back(self) -> None:
        spec = _make_toy_spec()
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "t.db"
            csv = tmpdir / "t.csv"
            _init_db(db, DDL_TWO_COL)
            csv.write_text(
                "name,value,source,notes\n"
                "Alpha,1.5,seed,ok\n"
                "Beta,1.0,book_of_yields,not in enum\n",
                encoding="utf-8",
            )
            with self.assertRaises(ValueError):
                seed_upsert_main(spec, db, csv)
            # DB must be empty — validation fails before any INSERT runs.
            self.assertEqual(_fetch_toy(db), [])

    def test_negative_value_raises_and_rolls_back(self) -> None:
        spec = _make_toy_spec()
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "t.db"
            csv = tmpdir / "t.csv"
            _init_db(db, DDL_TWO_COL)
            csv.write_text(
                "name,value,source,notes\n"
                "Alpha,-1.5,seed,bad\n",
                encoding="utf-8",
            )
            with self.assertRaises(ValueError):
                seed_upsert_main(spec, db, csv)
            self.assertEqual(_fetch_toy(db), [])

    def test_non_numeric_value_raises(self) -> None:
        spec = _make_toy_spec()
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "t.db"
            csv = tmpdir / "t.csv"
            _init_db(db, DDL_TWO_COL)
            csv.write_text(
                "name,value,source,notes\n"
                "Alpha,heavy,seed,bad\n",
                encoding="utf-8",
            )
            with self.assertRaises(ValueError) as cm:
                seed_upsert_main(spec, db, csv)
            self.assertIn("not a number", str(cm.exception))


class SeedUpsertEmptyKeySkip(unittest.TestCase):
    def test_empty_normalized_key_is_skipped_with_warning(self) -> None:
        spec = _make_toy_spec()
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "t.db"
            csv = tmpdir / "t.csv"
            _init_db(db, DDL_TWO_COL)
            csv.write_text(
                "name,value,source,notes\n"
                "   ,1.0,seed,whitespace only\n"
                "Real,1.0,seed,ok\n",
                encoding="utf-8",
            )
            buf = io.StringIO()
            with contextlib.redirect_stderr(buf):
                rc = seed_upsert_main(spec, db, csv)
            self.assertEqual(rc, 0)
            self.assertIn("normalizes to empty", buf.getvalue())
            self.assertIn("skipping", buf.getvalue())
            rows = _fetch_toy(db)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][0], "real")


class SeedUpsertHeaderShapeGuard(unittest.TestCase):
    def test_header_mismatch_raises_before_any_write(self) -> None:
        spec = _make_toy_spec()
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "t.db"
            csv = tmpdir / "t.csv"
            _init_db(db, DDL_TWO_COL)
            csv.write_text(
                "wrong,value,source,notes\n"
                "Alpha,1.0,seed,\n",
                encoding="utf-8",
            )
            with self.assertRaises(ValueError) as cm:
                seed_upsert_main(spec, db, csv)
            self.assertIn("header mismatch", str(cm.exception))
            self.assertEqual(_fetch_toy(db), [])

    def test_row_field_count_mismatch_raises(self) -> None:
        spec = _make_toy_spec()
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "t.db"
            csv = tmpdir / "t.csv"
            _init_db(db, DDL_TWO_COL)
            csv.write_text(
                "name,value,source,notes\n"
                "Alpha,1.0,seed,ok\n"
                "Beta,2.0,seed,extra,oops\n",
                encoding="utf-8",
            )
            with self.assertRaises(ValueError) as cm:
                seed_upsert_main(spec, db, csv)
            self.assertIn("line 3", str(cm.exception))
            self.assertIn("5 fields", str(cm.exception))
            self.assertEqual(_fetch_toy(db), [])


class SeedUpsertMissingFiles(unittest.TestCase):
    def test_missing_csv_returns_1(self) -> None:
        spec = _make_toy_spec()
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "t.db"
            _init_db(db, DDL_TWO_COL)
            rc = seed_upsert_main(spec, db, tmpdir / "nope.csv")
            self.assertEqual(rc, 1)

    def test_missing_db_returns_1(self) -> None:
        spec = _make_toy_spec()
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            csv = tmpdir / "t.csv"
            csv.write_text(
                "name,value,source,notes\nAlpha,1.0,seed,\n",
                encoding="utf-8",
            )
            rc = seed_upsert_main(spec, tmpdir / "nope.db", csv)
            self.assertEqual(rc, 1)


class SeedUpsertCompositePkAndInjected(unittest.TestCase):
    def test_composite_pk_with_injected_vendor(self) -> None:
        spec = _make_composite_spec()
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "t.db"
            csv = tmpdir / "t.csv"
            _init_db(db, DDL_COMPOSITE)
            csv.write_text(
                "sku,wt,note\n"
                "A1,1.5,first\n"
                "A2,2.0,\n",  # empty note -> NULL
                encoding="utf-8",
            )
            # Same sku across two vendors must produce two rows.
            seed_upsert_main(spec, db, csv, vendor="sysco")
            seed_upsert_main(spec, db, csv, vendor="shamrock")
            rows = _fetch_composite(db)
            self.assertEqual(len(rows), 4)
            vendors = {r[0] for r in rows}
            self.assertEqual(vendors, {"sysco", "shamrock"})
            # empty note becomes NULL
            a2_rows = [r for r in rows if r[1] == "A2"]
            self.assertTrue(all(r[3] is None for r in a2_rows))

    def test_composite_pk_upsert_is_idempotent(self) -> None:
        spec = _make_composite_spec()
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "t.db"
            csv = tmpdir / "t.csv"
            _init_db(db, DDL_COMPOSITE)
            csv.write_text(
                "sku,wt,note\nA1,1.5,\n", encoding="utf-8"
            )
            seed_upsert_main(spec, db, csv, vendor="sysco")
            first = _fetch_composite(db)
            seed_upsert_main(spec, db, csv, vendor="sysco")
            second = _fetch_composite(db)
            self.assertEqual(first, second)
            self.assertEqual(len(first), 1)

    def test_composite_empty_key_uses_sku_wording(self) -> None:
        """When the normalize_to_key column is literally named 'sku',
        the empty-key warning says 'empty sku' rather than the generic
        'normalizes to empty key' — matches pre-refactor
        ingest_catch_weights wording."""
        spec = _make_composite_spec()
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "t.db"
            csv = tmpdir / "t.csv"
            _init_db(db, DDL_COMPOSITE)
            csv.write_text(
                "sku,wt,note\n,1.0,blank sku\nA1,2.0,ok\n",
                encoding="utf-8",
            )
            buf = io.StringIO()
            with contextlib.redirect_stderr(buf):
                seed_upsert_main(spec, db, csv, vendor="sysco")
            self.assertIn("empty sku; skipping", buf.getvalue())
            rows = _fetch_composite(db)
            self.assertEqual(len(rows), 1)


class SeedUpsertSummaryLine(unittest.TestCase):
    def test_script_name_prefixes_stderr_summary(self) -> None:
        spec = _make_toy_spec()
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            db = tmpdir / "t.db"
            csv = tmpdir / "t.csv"
            _init_db(db, DDL_TWO_COL)
            csv.write_text(
                "name,value,source,notes\nAlpha,1.0,seed,\n",
                encoding="utf-8",
            )
            buf = io.StringIO()
            with contextlib.redirect_stderr(buf):
                seed_upsert_main(spec, db, csv)
            self.assertIn(
                "toy_seed: read=1 upserted=1 skipped=0", buf.getvalue()
            )


if __name__ == "__main__":
    unittest.main()
