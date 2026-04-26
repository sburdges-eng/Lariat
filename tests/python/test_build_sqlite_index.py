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

import hashlib
import json
import sqlite3
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.datapack import build_sqlite_index  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


USDA_FOODS: list[dict[str, Any]] = [
    {
        "fdc_id": 1001,
        "description": "Apple, raw",
        "data_type": "foundation_food",
        "food_category_id": 9,
        "food_category": "Fruits and Fruit Juices",
        "brand_owner": None,
        "gtin_upc": None,
        "ingredients": None,
        "serving_size": 100.0,
        "serving_size_unit": "g",
        "source_archive": "FoodData_Central_foundation_food_csv_2024-04-18.zip",
    },
    {
        "fdc_id": 2002,
        "description": "Cheddar Cheese, branded",
        "data_type": "branded_food",
        "food_category_id": 1,
        "food_category": "Dairy and Egg Products",
        "brand_owner": "Acme Dairy Co.",
        "gtin_upc": "0049000001234",
        "ingredients": "MILK, SALT, ENZYMES, CULTURE",
        "serving_size": 28.0,
        "serving_size_unit": "g",
        "source_archive": "FoodData_Central_branded_food_csv_2024-04-18.zip",
    },
]

USDA_NUTRIENTS: list[dict[str, Any]] = [
    {
        "fdc_id": 1001,
        "nutrient_id": 1008,
        "nutrient_name": "Energy",
        "unit_name": "KCAL",
        "amount": 52.0,
        "derivation_id": 71,
        "source_archive": "FoodData_Central_foundation_food_csv_2024-04-18.zip",
    },
    {
        "fdc_id": 2002,
        "nutrient_id": 1003,
        "nutrient_name": "Protein",
        "unit_name": "G",
        "amount": 7.14,
        "derivation_id": None,
        "source_archive": "FoodData_Central_branded_food_csv_2024-04-18.zip",
    },
]

OFF_PRODUCTS: list[dict[str, Any]] = [
    {
        "code": "0000000001234",
        "product_name": "Organic Almond Butter",
        "brands": "Almonderie",
        "brand_owner": "Almonderie SAS",
        "categories_tags": ["en:spreads", "en:nut-and-peanut-butters"],
        "allergens_tags": ["en:nuts"],
        "traces_tags": ["en:peanuts"],
        "ingredients_text": "Organic almonds, sea salt.",
        "serving_size": "32 g",
        "nutriscore_grade": "b",
        "countries_en": "United States",
        "source_url": "https://world.openfoodfacts.org/product/0000000001234",
    },
    {
        "code": "0000000005678",
        "product_name": "Sparkling Water",
        "brands": "Bubbly Co",
        "brand_owner": "Café Équateur",
        "categories_tags": ["en:beverages"],
        "allergens_tags": [],
        "traces_tags": [],
        "ingredients_text": "Carbonated water.",
        "serving_size": "355 ml",
        "nutriscore_grade": "a",
        "countries_en": "United States",
        "source_url": "https://world.openfoodfacts.org/product/0000000005678",
    },
]

OFF_ALLERGENS_SUMMARY: dict[str, Any] = {
    "generated_at": "2024-04-18T00:00:00Z",
    "total_products": 2,
    "products_with_allergens": 1,
    "allergens": {"en:nuts": 1},
    "traces": {"en:peanuts": 1},
}

WIKIBOOKS_PAGES: list[dict[str, Any]] = [
    {
        "page_id": 42,
        "title": "Cookbook:Apple Pie",
        "slug": "Cookbook:Apple_Pie",
        "is_redirect": False,
        "redirect_target": None,
        "categories": ["Recipes", "Desserts", "American cuisine"],
        "wikitext_length": 4321,
        "plain_text_summary": "A classic American dessert with apples in a pastry crust.",
        "source_url": "https://en.wikibooks.org/wiki/Cookbook:Apple_Pie",
    },
    {
        "page_id": 43,
        "title": "Cookbook:Apple Tart",
        "slug": "Cookbook:Apple_Tart",
        "is_redirect": True,
        "redirect_target": "Cookbook:Apple Pie",
        "categories": [],
        "wikitext_length": 0,
        "plain_text_summary": "",
        "source_url": "https://en.wikibooks.org/wiki/Cookbook:Apple_Tart",
    },
]

FDA_FOOD_CODE_SECTIONS: list[dict[str, Any]] = [
    {
        "section_id": "3-501.16",
        "title": "Time/Temperature Control for Safety Food, Hot and Cold Holding",
        "chapter": "3",
        "annex": None,
        "body": "Cold TCS food shall be maintained at 41°F (5°C) or less.",
        "char_count": 60,
        "page_start": 110,
        "page_end": 110,
    },
    {
        "section_id": "Annex-3",
        "title": "Public Health Reasons / Administrative Guidelines",
        "chapter": None,
        "annex": "3",
        "body": "Annex 3 provides public health rationale for code provisions.",
        "char_count": 62,
        "page_start": 400,
        "page_end": 401,
    },
]


# ---------------------------------------------------------------------------
# Fixture writer
# ---------------------------------------------------------------------------


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row))
            f.write("\n")


def _write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=True), encoding="utf-8")


def _build_input_root(input_root: Path) -> dict[str, Path]:
    """Materialize the synthetic input tree. Returns a dict of fixture paths."""
    paths = {
        "usda_foods": input_root / "usda" / "ingredients.jsonl",
        "usda_nutrients": input_root / "usda" / "nutrients.jsonl",
        "off_products": input_root / "openfoodfacts" / "branded_products.jsonl",
        "off_allergens": input_root / "openfoodfacts" / "allergens.json",
        "wikibooks_pages": input_root / "wikibooks" / "cookbook_pages.jsonl",
        "fda_food_code_sections": input_root / "fda_food_code" / "sections.jsonl",
    }
    _write_jsonl(paths["usda_foods"], USDA_FOODS)
    _write_jsonl(paths["usda_nutrients"], USDA_NUTRIENTS)
    _write_jsonl(paths["off_products"], OFF_PRODUCTS)
    _write_json(paths["off_allergens"], OFF_ALLERGENS_SUMMARY)
    _write_jsonl(paths["wikibooks_pages"], WIKIBOOKS_PAGES)
    _write_jsonl(paths["fda_food_code_sections"], FDA_FOOD_CODE_SECTIONS)
    return paths


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for buf in iter(lambda: f.read(1 << 16), b""):
            h.update(buf)
    return h.hexdigest()


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
