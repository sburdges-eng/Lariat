"""Smoke tests for ``scripts.datapack.build_fts_index``.

Each test runs ``build_sqlite_index.build()`` against a tiny synthetic JSONL
fixture tree, then drives ``build_fts_index.build()`` against the resulting
``lariat_data.db``.

  1. Happy path — FTS DB + manifest written, per-source row counts match
     the fixtures, real MATCH queries find the expected rows in every FTS
     table, and ``off_products_codes`` carries the matching GTIN string for
     each indexed FTS rowid.
  2. Idempotent skip — second ``build()`` without ``force=True`` returns
     the prior manifest verbatim and the FTS DB mtime is preserved.
  3. ``force=True`` rebuild — third call rebuilds; ``input_sha256`` stays
     stable across the rebuild (same source DB).
  4. Wikibooks redirect filter — only ``is_redirect=0`` pages enter the
     FTS table; a unique word from the redirect page returns zero hits.
  5. ``bm25()`` returns a numeric score for a real MATCH.
  6. Missing input DB raises a clear ``FileNotFoundError`` mentioning the
     path.
"""

from __future__ import annotations

import json
import math
import sqlite3
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.datapack import build_fts_index, build_sqlite_index  # noqa: E402

# Reuse the same JSONL → SQLite fixture builders the T1 tests exercise so
# both modules drive the indexer through one well-known input shape.
from tests.python._datapack_test_helpers import (  # noqa: E402
    FDA_FOOD_CODE_SECTIONS,
    OFF_PRODUCTS,
    USDA_FOODS,
    WIKIBOOKS_PAGES,
    _build_input_root,
    _sha256_file,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _connect_ro(db_path: Path) -> sqlite3.Connection:
    uri = f"file:{db_path}?mode=ro"
    return sqlite3.connect(uri, uri=True)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class BuildFtsIndexSmokeTests(unittest.TestCase):

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.input_root = root / "normalized"
        self.sqlite_dir = root / "indexes" / "sqlite"
        self.fts_dir = root / "indexes" / "search" / "fts"
        self.input_root.mkdir(parents=True)
        self.fixture_paths = _build_input_root(self.input_root)

        # Build the upstream SQLite DB once per test.
        build_sqlite_index.build(
            input_root=self.input_root,
            output_dir=self.sqlite_dir,
            force=False,
        )

        self.input_db = self.sqlite_dir / "lariat_data.db"
        self.fts_db_path = self.fts_dir / "lariat_fts.db"
        self.manifest_path = self.fts_dir / "manifest.json"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    # -------------------------------------------------------------- test cases

    def test_happy_path(self) -> None:
        manifest = build_fts_index.build(
            input_db=self.input_db,
            output_dir=self.fts_dir,
            force=False,
        )

        # Files exist where expected.
        self.assertTrue(self.fts_db_path.exists(), "lariat_fts.db missing")
        self.assertTrue(self.manifest_path.exists(), "manifest.json missing")

        # Manifest is what build() returned.
        on_disk = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(on_disk, manifest)

        # Top-level manifest shape.
        self.assertEqual(manifest["fts_db_file"], "lariat_fts.db")
        self.assertEqual(manifest["fts_db_bytes"], self.fts_db_path.stat().st_size)
        self.assertEqual(manifest["input_db_file"], self.input_db.name)
        self.assertEqual(manifest["input_sha256"], _sha256_file(self.input_db))
        self.assertIn("generated_at", manifest)
        self.assertIn("elapsed_seconds", manifest)
        self.assertIn("tokenizer", manifest)

        # Each FTS table's indexed_rows matches the fixture row count
        # actually populated (per SOURCE_POPULATIONS — wikibooks filters
        # is_redirect=0).
        sources = manifest["sources"]
        non_redirect_pages = [p for p in WIKIBOOKS_PAGES if not p["is_redirect"]]
        expected = {
            "usda_foods_fts": len(USDA_FOODS),
            "off_products_fts": len(OFF_PRODUCTS),
            "wikibooks_pages_fts": len(non_redirect_pages),
            "fda_food_code_sections_fts": len(FDA_FOOD_CODE_SECTIONS),
        }
        for fts_table, want in expected.items():
            self.assertIn(fts_table, sources, f"manifest missing {fts_table!r}")
            self.assertEqual(
                sources[fts_table]["rows_indexed"],
                want,
                f"rows_indexed mismatch for {fts_table}",
            )

        with _connect_ro(self.fts_db_path) as conn:
            # USDA: 'protein' appears in nutrient names but not in FTS
            # columns; use 'cheddar' which is in description for fdc_id 2002.
            rows = conn.execute(
                "SELECT rowid FROM usda_foods_fts WHERE usda_foods_fts MATCH 'cheddar'",
            ).fetchall()
            self.assertEqual(
                sorted(r[0] for r in rows),
                [USDA_FOODS[1]["fdc_id"]],
            )

            # Match the other fixture row to be sure both made it in.
            rows = conn.execute(
                "SELECT rowid FROM usda_foods_fts WHERE usda_foods_fts MATCH 'apple'",
            ).fetchall()
            self.assertEqual(
                sorted(r[0] for r in rows),
                [USDA_FOODS[0]["fdc_id"]],
            )

            # OFF: 'almond' is a discriminating word in product_name +
            # ingredients_text for the first OFF row only.
            off_rowids_almond = [
                r[0]
                for r in conn.execute(
                    "SELECT rowid FROM off_products_fts "
                    "WHERE off_products_fts MATCH 'almond'"
                ).fetchall()
            ]
            self.assertEqual(len(off_rowids_almond), 1)

            # The off_products_codes table maps the FTS rowid back to the
            # source GTIN (string with leading zeros).
            (almond_code,) = conn.execute(
                "SELECT code FROM off_products_codes WHERE fts_rowid = ?",
                (off_rowids_almond[0],),
            ).fetchone()
            self.assertEqual(almond_code, OFF_PRODUCTS[0]["code"])

            # And the codes table has one row per indexed FTS row.
            (codes_count,) = conn.execute(
                "SELECT COUNT(*) FROM off_products_codes",
            ).fetchone()
            self.assertEqual(codes_count, len(OFF_PRODUCTS))

            # Every off_products_codes.fts_rowid must exist in the FTS
            # index, and every code must match the source GTIN string set.
            mapped = {
                fts_rowid: code
                for fts_rowid, code in conn.execute(
                    "SELECT fts_rowid, code FROM off_products_codes"
                )
            }
            self.assertEqual(
                set(mapped.values()),
                {p["code"] for p in OFF_PRODUCTS},
            )
            fts_rowids = {
                r[0]
                for r in conn.execute("SELECT rowid FROM off_products_fts")
            }
            self.assertEqual(set(mapped.keys()), fts_rowids)

            # Full bijection: rowid-to-code mapping matches the deterministic
            # ROW_NUMBER() OVER (ORDER BY code) ordering used by the indexer.
            expected_pairs = {
                (rn, p["code"])
                for rn, p in enumerate(
                    sorted(OFF_PRODUCTS, key=lambda r: r["code"]), start=1
                )
            }
            self.assertEqual(set(mapped.items()), expected_pairs)

            # Wikibooks: 'pie' from the non-redirect page's title.
            rows = conn.execute(
                "SELECT rowid FROM wikibooks_pages_fts "
                "WHERE wikibooks_pages_fts MATCH 'pie'",
            ).fetchall()
            self.assertEqual(
                sorted(r[0] for r in rows),
                [WIKIBOOKS_PAGES[0]["page_id"]],
            )

            # FDA: 'TCS' is only in section 3-501.16's body.
            rows = conn.execute(
                "SELECT rowid FROM fda_food_code_sections_fts "
                "WHERE fda_food_code_sections_fts MATCH 'TCS'",
            ).fetchall()
            self.assertEqual(len(rows), 1)
            # Resolve the FDA rowid back to section_id via src DB.
            with _connect_ro(self.input_db) as src:
                (section_id,) = src.execute(
                    "SELECT section_id FROM fda_food_code_sections WHERE rowid = ?",
                    (rows[0][0],),
                ).fetchone()
            self.assertEqual(section_id, FDA_FOOD_CODE_SECTIONS[0]["section_id"])

    def test_idempotent_skip(self) -> None:
        first = build_fts_index.build(
            input_db=self.input_db,
            output_dir=self.fts_dir,
            force=False,
        )
        mtime_before = self.fts_db_path.stat().st_mtime_ns

        # Pause so an unexpected rebuild's bumped mtime is unambiguous —
        # without this, an instant rebuild could in principle land on the
        # same st_mtime_ns by coincidence on very fast filesystems.
        time.sleep(0.01)

        second = build_fts_index.build(
            input_db=self.input_db,
            output_dir=self.fts_dir,
            force=False,
        )
        mtime_after = self.fts_db_path.stat().st_mtime_ns

        self.assertEqual(second, first)
        self.assertEqual(mtime_after, mtime_before)

    def test_force_rebuild_keeps_input_sha_stable(self) -> None:
        first = build_fts_index.build(
            input_db=self.input_db,
            output_dir=self.fts_dir,
            force=False,
        )
        rebuilt = build_fts_index.build(
            input_db=self.input_db,
            output_dir=self.fts_dir,
            force=True,
        )

        # Same source DB → same input sha across the rebuild.
        self.assertEqual(rebuilt["input_sha256"], first["input_sha256"])

        # Per-FTS-table indexed row counts are stable too.
        for fts_table, prior in first["sources"].items():
            self.assertIn(fts_table, rebuilt["sources"])
            self.assertEqual(
                rebuilt["sources"][fts_table]["rows_indexed"],
                prior["rows_indexed"],
            )

        # FTS DB is still queryable after the force rebuild.
        with _connect_ro(self.fts_db_path) as conn:
            (n,) = conn.execute("SELECT COUNT(*) FROM usda_foods_fts").fetchone()
            self.assertEqual(n, len(USDA_FOODS))

    def test_wikibooks_redirect_filter(self) -> None:
        # WIKIBOOKS_PAGES has page 42 (Apple Pie, non-redirect) and page 43
        # (Apple Tart, redirect → Apple Pie). Only 42 should land in FTS.
        build_fts_index.build(
            input_db=self.input_db,
            output_dir=self.fts_dir,
            force=False,
        )
        non_redirect = [p for p in WIKIBOOKS_PAGES if not p["is_redirect"]]
        redirect = [p for p in WIKIBOOKS_PAGES if p["is_redirect"]]
        self.assertEqual(len(non_redirect), 1, "fixture invariant: 1 non-redirect")
        self.assertEqual(len(redirect), 1, "fixture invariant: 1 redirect")

        with _connect_ro(self.fts_db_path) as conn:
            (n,) = conn.execute(
                "SELECT COUNT(*) FROM wikibooks_pages_fts",
            ).fetchone()
            self.assertEqual(n, 1)

            # Unique word from the kept page's summary → 1 hit.
            rows = conn.execute(
                "SELECT rowid FROM wikibooks_pages_fts "
                "WHERE wikibooks_pages_fts MATCH 'pastry'",
            ).fetchall()
            self.assertEqual(
                sorted(r[0] for r in rows),
                [non_redirect[0]["page_id"]],
            )

            # Unique word from the redirect's title ("Tart") → 0 hits.
            rows = conn.execute(
                "SELECT rowid FROM wikibooks_pages_fts "
                "WHERE wikibooks_pages_fts MATCH 'tart'",
            ).fetchall()
            self.assertEqual(rows, [])

    def test_bm25_returns_numeric_score(self) -> None:
        build_fts_index.build(
            input_db=self.input_db,
            output_dir=self.fts_dir,
            force=False,
        )
        with _connect_ro(self.fts_db_path) as conn:
            row = conn.execute(
                "SELECT bm25(usda_foods_fts) "
                "FROM usda_foods_fts WHERE usda_foods_fts MATCH 'apple'",
            ).fetchone()
        self.assertIsNotNone(row, "expected at least one MATCH for 'apple'")
        score = row[0]
        # FTS5 bm25() with default args is documented as a finite negative
        # float for any real match (more-negative = better match). We don't
        # pin a specific value — sqlite/FTS5 versions vary.
        self.assertIsNotNone(score)
        self.assertIsInstance(score, float)
        self.assertTrue(
            math.isfinite(score), f"bm25 must be finite, got {score!r}"
        )
        self.assertLess(
            score,
            0.0,
            f"FTS5 bm25() returns negative scores for real matches, got {score!r}",
        )

    def test_missing_input_raises_clearly(self) -> None:
        bogus = self.fts_dir / "does_not_exist.db"
        with self.assertRaises(FileNotFoundError) as ctx:
            build_fts_index.build(
                input_db=bogus,
                output_dir=self.fts_dir,
                force=False,
            )
        self.assertIn(str(bogus), str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
