"""Smoke tests for ``scripts.datapack.build_sqlite_index``.

Builds a tiny synthetic JSONL tree (2 rows per source) under ``tmp_path``,
runs the public ``build()`` entry point, and validates:

  1. Happy path — DB + manifest written, every table row count matches the
     fixture, representative-row roundtrip per table, manifest sha256 per
     input matches the on-disk fixture sha.
  2. Idempotent skip — second call without ``force=True`` returns the prior
     manifest unchanged and the DB mtime is preserved.
  3. ``force=True`` rebuild — third call rebuilds; per-source sha256s stay
     stable (deterministic content) modulo ``generated_at``.
  4. Missing input file — clear ``FileNotFoundError`` referencing the path.
  5. Schema fidelity — wikibooks ``categories`` (list[str]) roundtrips as
     JSON-encoded text (column ``categories_json``).
  6. ``is_redirect`` boolean coercion — Python bools land as 0/1 INTEGER.
"""

from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.datapack import build_sqlite_index  # noqa: E402

# Fixture data + filesystem helpers live in a shared module so the T2/T3
# datapack tests can reuse them without importing this test module.
from tests.python._datapack_test_helpers import (  # noqa: E402,F401
    FDA_FOOD_CODE_SECTIONS,
    OFF_ALLERGENS_SUMMARY,
    OFF_PRODUCTS,
    USDA_FOODS,
    USDA_NUTRIENTS,
    WIKIBOOKS_PAGES,
    _build_input_root,
    _sha256_file,
    _write_json,
    _write_jsonl,
)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class BuildSqliteIndexSmokeTests(unittest.TestCase):

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.input_root = root / "normalized"
        self.output_dir = root / "indexes" / "sqlite"
        self.input_root.mkdir(parents=True)
        self.fixture_paths = _build_input_root(self.input_root)
        self.db_path = self.output_dir / "lariat_data.db"
        self.manifest_path = self.output_dir / "manifest.json"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    # ------------------------------------------------------------------ helpers

    def _connect_ro(self) -> sqlite3.Connection:
        # Opening as URI with mode=ro gives a true read-only handle so the
        # test cannot accidentally mutate the freshly-built artifact.
        uri = f"file:{self.db_path}?mode=ro"
        return sqlite3.connect(uri, uri=True)

    def _row_count(self, conn: sqlite3.Connection, table: str) -> int:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    # -------------------------------------------------------------- test cases

    def test_happy_path(self) -> None:
        manifest = build_sqlite_index.build(
            input_root=self.input_root,
            output_dir=self.output_dir,
            force=False,
        )

        # Files exist where expected.
        self.assertTrue(self.db_path.exists(), "lariat_data.db missing")
        self.assertTrue(self.manifest_path.exists(), "manifest.json missing")

        # Manifest is what build() returned.
        on_disk = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(on_disk, manifest)

        # Top-level manifest shape.
        self.assertEqual(manifest["db_file"], "lariat_data.db")
        self.assertEqual(manifest["db_bytes"], self.db_path.stat().st_size)
        self.assertIn("generated_at", manifest)
        self.assertIn("elapsed_seconds", manifest)

        # Per-source sha256 in manifest matches the on-disk fixture sha.
        sources = manifest["sources"]
        for key, fixture_path in self.fixture_paths.items():
            self.assertIn(key, sources, f"manifest missing source {key!r}")
            self.assertEqual(
                sources[key]["sha256"],
                _sha256_file(fixture_path),
                f"sha256 mismatch for {key}",
            )
            self.assertEqual(sources[key]["source_file"], fixture_path.name)

        # Row counts in DB match fixtures.
        with self._connect_ro() as conn:
            self.assertEqual(self._row_count(conn, "usda_foods"), len(USDA_FOODS))
            self.assertEqual(self._row_count(conn, "usda_nutrients"), len(USDA_NUTRIENTS))
            self.assertEqual(self._row_count(conn, "off_products"), len(OFF_PRODUCTS))
            self.assertEqual(self._row_count(conn, "wikibooks_pages"), len(WIKIBOOKS_PAGES))
            self.assertEqual(
                self._row_count(conn, "fda_food_code_sections"),
                len(FDA_FOOD_CODE_SECTIONS),
            )
            # Allergens summary flattens into key/value rows — there are 5
            # top-level keys in the summary so the row count must match.
            self.assertEqual(
                self._row_count(conn, "off_allergens"),
                len(OFF_ALLERGENS_SUMMARY),
            )

            # _manifest table inside the DB carries one row per source
            # (5 JSONL sources + off_allergens summary).
            self.assertEqual(self._row_count(conn, "_manifest"), 6)

            # Each _manifest row's source_sha256 must match the on-disk
            # fixture sha for that source. The _manifest.source PK matches
            # the fixture-key naming used in self.fixture_paths.
            manifest_rows = {
                row[0]: row[1]
                for row in conn.execute(
                    "SELECT source, source_sha256 FROM _manifest"
                ).fetchall()
            }
            self.assertEqual(
                set(manifest_rows.keys()),
                set(self.fixture_paths.keys()),
            )
            for key, fixture_path in self.fixture_paths.items():
                self.assertEqual(
                    manifest_rows[key],
                    _sha256_file(fixture_path),
                    f"_manifest sha256 mismatch for {key}",
                )

            # Roundtrip: pick the first fixture row's PK and verify the
            # body fields land in the corresponding columns.
            food = conn.execute(
                "SELECT description, brand_owner, serving_size, serving_size_unit "
                "FROM usda_foods WHERE fdc_id = ?",
                (USDA_FOODS[0]["fdc_id"],),
            ).fetchone()
            self.assertEqual(food[0], USDA_FOODS[0]["description"])
            self.assertEqual(food[1], USDA_FOODS[0]["brand_owner"])  # None
            self.assertEqual(food[2], USDA_FOODS[0]["serving_size"])
            self.assertEqual(food[3], USDA_FOODS[0]["serving_size_unit"])

            nutrient = conn.execute(
                "SELECT nutrient_name, amount, unit_name "
                "FROM usda_nutrients WHERE fdc_id = ? AND nutrient_id = ?",
                (USDA_NUTRIENTS[0]["fdc_id"], USDA_NUTRIENTS[0]["nutrient_id"]),
            ).fetchone()
            self.assertEqual(nutrient[0], USDA_NUTRIENTS[0]["nutrient_name"])
            self.assertEqual(nutrient[1], USDA_NUTRIENTS[0]["amount"])
            self.assertEqual(nutrient[2], USDA_NUTRIENTS[0]["unit_name"])

            product = conn.execute(
                "SELECT product_name, brands, ingredients_text, allergens_tags_json "
                "FROM off_products WHERE code = ?",
                (OFF_PRODUCTS[0]["code"],),
            ).fetchone()
            self.assertEqual(product[0], OFF_PRODUCTS[0]["product_name"])
            self.assertEqual(product[1], OFF_PRODUCTS[0]["brands"])
            self.assertEqual(product[2], OFF_PRODUCTS[0]["ingredients_text"])
            self.assertEqual(
                json.loads(product[3]),
                OFF_PRODUCTS[0]["allergens_tags"],
            )

            page = conn.execute(
                "SELECT title, slug, plain_text_summary "
                "FROM wikibooks_pages WHERE page_id = ?",
                (WIKIBOOKS_PAGES[0]["page_id"],),
            ).fetchone()
            self.assertEqual(page[0], WIKIBOOKS_PAGES[0]["title"])
            self.assertEqual(page[1], WIKIBOOKS_PAGES[0]["slug"])
            self.assertEqual(page[2], WIKIBOOKS_PAGES[0]["plain_text_summary"])

            section = conn.execute(
                "SELECT title, chapter, annex, body, page_start, page_end "
                "FROM fda_food_code_sections WHERE section_id = ?",
                (FDA_FOOD_CODE_SECTIONS[0]["section_id"],),
            ).fetchone()
            self.assertEqual(section[0], FDA_FOOD_CODE_SECTIONS[0]["title"])
            self.assertEqual(section[1], FDA_FOOD_CODE_SECTIONS[0]["chapter"])
            self.assertEqual(section[2], FDA_FOOD_CODE_SECTIONS[0]["annex"])
            self.assertEqual(section[3], FDA_FOOD_CODE_SECTIONS[0]["body"])
            self.assertEqual(section[4], FDA_FOOD_CODE_SECTIONS[0]["page_start"])
            self.assertEqual(section[5], FDA_FOOD_CODE_SECTIONS[0]["page_end"])

            # OFF allergens flattened: the "allergens" sub-dict was stored
            # as JSON-encoded text under the key "allergens".
            allergens_row = conn.execute(
                "SELECT value_json FROM off_allergens WHERE key = 'allergens'",
            ).fetchone()
            self.assertEqual(
                json.loads(allergens_row[0]),
                OFF_ALLERGENS_SUMMARY["allergens"],
            )

            # Non-ASCII roundtrip: accented characters in brand_owner survive
            # the JSONL → SQLite hop without mojibake.
            (brand_owner,) = conn.execute(
                "SELECT brand_owner FROM off_products WHERE code = ?",
                (OFF_PRODUCTS[1]["code"],),
            ).fetchone()
            self.assertEqual(brand_owner, "Café Équateur")
            self.assertIn("é", brand_owner)
            self.assertIn("É", brand_owner)

            # Boundary integer: wikitext_length = 0 must come back as the
            # integer 0, NOT as NULL (a NULL would suggest the mapper
            # silently swallowed a falsy value).
            (wikitext_length,) = conn.execute(
                "SELECT wikitext_length FROM wikibooks_pages WHERE page_id = ?",
                (WIKIBOOKS_PAGES[1]["page_id"],),
            ).fetchone()
            self.assertIsNotNone(wikitext_length)
            self.assertIsInstance(wikitext_length, int)
            self.assertEqual(wikitext_length, 0)

            # Nutrient NULL coverage: a None derivation_id in the source
            # JSONL lands as SQLite NULL (Python None) rather than 0 or "".
            (derivation_id,) = conn.execute(
                "SELECT derivation_id FROM usda_nutrients "
                "WHERE fdc_id = ? AND nutrient_id = ?",
                (USDA_NUTRIENTS[1]["fdc_id"], USDA_NUTRIENTS[1]["nutrient_id"]),
            ).fetchone()
            self.assertIsNone(derivation_id)

    def test_idempotent_skip(self) -> None:
        first = build_sqlite_index.build(
            input_root=self.input_root,
            output_dir=self.output_dir,
            force=False,
        )
        mtime_before = self.db_path.stat().st_mtime_ns

        # Pause briefly so any rebuild would actually move the mtime — the
        # test asserts we *don't* rebuild, so this is purely defensive.
        time.sleep(0.01)

        second = build_sqlite_index.build(
            input_root=self.input_root,
            output_dir=self.output_dir,
            force=False,
        )
        mtime_after = self.db_path.stat().st_mtime_ns

        # The skip path returns the previous manifest verbatim.
        self.assertEqual(second, first)
        # Skip path must not touch the DB file.
        self.assertEqual(mtime_after, mtime_before)

    def test_force_rebuild_keeps_per_source_shas_stable(self) -> None:
        first = build_sqlite_index.build(
            input_root=self.input_root,
            output_dir=self.output_dir,
            force=False,
        )
        # Force a rebuild — fresh generated_at, but inputs and their shas
        # haven't moved, so per-source sha256 entries must match exactly.
        rebuilt = build_sqlite_index.build(
            input_root=self.input_root,
            output_dir=self.output_dir,
            force=True,
        )

        for key, prior in first["sources"].items():
            self.assertIn(key, rebuilt["sources"])
            self.assertEqual(rebuilt["sources"][key]["sha256"], prior["sha256"])
            self.assertEqual(
                rebuilt["sources"][key]["rows_loaded"],
                prior["rows_loaded"],
            )

        # DB still loads cleanly after the force rebuild.
        with self._connect_ro() as conn:
            self.assertEqual(self._row_count(conn, "usda_foods"), len(USDA_FOODS))

    def test_missing_input_raises_clearly(self) -> None:
        # Delete one fixture and assert a clear, path-mentioning error.
        missing = self.fixture_paths["wikibooks_pages"]
        missing.unlink()

        with self.assertRaises(FileNotFoundError) as ctx:
            build_sqlite_index.build(
                input_root=self.input_root,
                output_dir=self.output_dir,
                force=False,
            )
        self.assertIn(str(missing), str(ctx.exception))

    def test_wikibooks_categories_roundtrip_as_json(self) -> None:
        build_sqlite_index.build(
            input_root=self.input_root,
            output_dir=self.output_dir,
            force=False,
        )
        with self._connect_ro() as conn:
            row = conn.execute(
                "SELECT categories_json FROM wikibooks_pages WHERE page_id = ?",
                (WIKIBOOKS_PAGES[0]["page_id"],),
            ).fetchone()
        self.assertIsInstance(row[0], str)
        decoded = json.loads(row[0])
        self.assertEqual(decoded, WIKIBOOKS_PAGES[0]["categories"])

        # And the empty-list page roundtrips to [].
        with self._connect_ro() as conn:
            row = conn.execute(
                "SELECT categories_json FROM wikibooks_pages WHERE page_id = ?",
                (WIKIBOOKS_PAGES[1]["page_id"],),
            ).fetchone()
        self.assertEqual(json.loads(row[0]), [])

    def test_is_redirect_coerced_to_int(self) -> None:
        build_sqlite_index.build(
            input_root=self.input_root,
            output_dir=self.output_dir,
            force=False,
        )
        with self._connect_ro() as conn:
            rows = conn.execute(
                "SELECT page_id, is_redirect FROM wikibooks_pages ORDER BY page_id",
            ).fetchall()
            # Every value is an int (not bool, not text) — SQLite returns
            # the storage type, and the column was written as 0/1.
            for _pid, is_redirect in rows:
                self.assertIsInstance(is_redirect, int)
                self.assertIn(is_redirect, (0, 1))

            # Querying with WHERE is_redirect = 1 finds the redirect row(s).
            redirect_ids = [
                pid
                for (pid,) in conn.execute(
                    "SELECT page_id FROM wikibooks_pages WHERE is_redirect = 1",
                )
            ]
            expected = [p["page_id"] for p in WIKIBOOKS_PAGES if p["is_redirect"]]
            self.assertEqual(sorted(redirect_ids), sorted(expected))


if __name__ == "__main__":
    unittest.main()
