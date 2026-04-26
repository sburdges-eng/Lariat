"""Unit tests for scripts.datapack.normalize_usda.

Builds a small synthetic set of USDA FoodData Central CSV fixtures across two
archives (sr_legacy + branded) and runs the normalizer against them. Verifies:

  - ingredients.jsonl row count and sort order (by fdc_id ascending)
  - nutrients.jsonl row count and sort order (by (fdc_id, nutrient_id))
  - schema fields present on every row
  - branded fields populate from branded_food.csv only for the branded archive
  - food_category description is joined when food_category.csv is present
  - rows with empty amount are skipped
  - manifest.json sha256 values match the on-disk file hashes
  - --force regeneration produces a stable manifest (idempotent except for
    the generated_at timestamp)
"""
from __future__ import annotations

import hashlib
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.datapack.normalize_usda import (  # noqa: E402
    ARCHIVE_ORDER,
    ARCHIVES,
    main as normalize_main,
    normalize,
)


# ---------------------------------------------------------------------------
# Fixture builder
# ---------------------------------------------------------------------------


def _write_csv(path: Path, header: list[str], rows: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [",".join(header)]
    for row in rows:
        # Quote any field that contains a comma; tests don't need full csv
        # writer machinery for these inputs.
        out = []
        for cell in row:
            if "," in cell or '"' in cell:
                out.append('"' + cell.replace('"', '""') + '"')
            else:
                out.append(cell)
        lines.append(",".join(out))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _build_fixture(input_root: Path) -> None:
    """Build a small two-archive USDA fixture under input_root.

    Layout:
      <input_root>/<sr_legacy_dir>/{food.csv, food_nutrient.csv, nutrient.csv,
                                    food_category.csv}
      <input_root>/<branded_dir>/{food.csv, food_nutrient.csv, nutrient.csv,
                                  branded_food.csv}

    Foods (3 total):
      167512 sr_legacy_food   - Pillsbury Biscuits (cat 18: Baked Products)
      319874 sr_legacy_food   - HUMMUS, SABRA CLASSIC (cat 16)
      1105904 branded_food    - WESSON Vegetable Oil 1 GAL (cat null)

    Nutrients (catalog, 2 entries):
      1003 Protein G
      1257 Total Fat G

    food_nutrient rows (5 valid rows + 1 skipped row with empty amount):
      sr_legacy:
        (fdc 167512, nut 1003, amt 5.88, deriv 46)
        (fdc 167512, nut 1257, amt 17.0, deriv 46)
        (fdc 319874, nut 1003, amt 8.0,  deriv 46)
      branded:
        (fdc 1105904, nut 1003, amt 0.0, deriv 71)
        (fdc 1105904, nut 1257, amt 100.0, deriv 71)
        (fdc 1105904, nut 1003, amt "",  deriv 71)   <-- skipped (empty amount)
    """
    sr_dir = input_root / ARCHIVES["sr_legacy"]
    br_dir = input_root / ARCHIVES["branded"]

    nutrient_header = ["id", "name", "unit_name", "nutrient_nbr", "rank"]
    nutrient_rows = [
        ["1003", "Protein", "G", "203", "600.0"],
        ["1257", "Total Fat", "G", "204", "800.0"],
    ]

    food_category_header = ["id", "code", "description"]
    food_category_rows = [
        ["16", "1600", "Legumes and Legume Products"],
        ["18", "1800", "Baked Products"],
    ]

    # sr_legacy
    _write_csv(
        sr_dir / "food.csv",
        ["fdc_id", "data_type", "description", "food_category_id", "publication_date"],
        [
            ["167512", "sr_legacy_food", "Pillsbury Biscuits", "18", "2019-04-01"],
            ["319874", "sr_legacy_food", "HUMMUS, SABRA CLASSIC", "16", "2019-04-01"],
        ],
    )
    _write_csv(
        sr_dir / "food_nutrient.csv",
        ["id", "fdc_id", "nutrient_id", "amount", "data_points", "derivation_id",
         "min", "max", "median", "footnote", "min_year_acquired"],
        [
            ["1283674", "167512", "1003", "5.88", "1", "46", "", "", "", "", ""],
            ["1283675", "167512", "1257", "17.0", "1", "46", "", "", "", "", ""],
            ["1283676", "319874", "1003", "8.0", "1", "46", "", "", "", "", ""],
        ],
    )
    _write_csv(sr_dir / "nutrient.csv", nutrient_header, nutrient_rows)
    _write_csv(sr_dir / "food_category.csv", food_category_header, food_category_rows)

    # branded
    _write_csv(
        br_dir / "food.csv",
        ["fdc_id", "data_type", "description", "food_category_id",
         "publication_date", "market_country", "trade_channel", "microbe_data"],
        [
            ["1105904", "branded_food", "WESSON Vegetable Oil 1 GAL", "",
             "2020-11-13", "United States", "", ""],
        ],
    )
    _write_csv(
        br_dir / "food_nutrient.csv",
        ["id", "fdc_id", "nutrient_id", "amount", "data_points", "derivation_id",
         "min", "max", "median", "footnote", "min_year_acquired"],
        [
            ["13706927", "1105904", "1003", "0.0", "", "71", "", "", "", "", ""],
            ["13706928", "1105904", "1257", "100.0", "", "71", "", "", "", "", ""],
            ["13706929", "1105904", "1003", "", "", "71", "", "", "", "", ""],
        ],
    )
    _write_csv(br_dir / "nutrient.csv", nutrient_header, nutrient_rows)
    _write_csv(
        br_dir / "branded_food.csv",
        ["fdc_id", "brand_owner", "brand_name", "subbrand_name", "gtin_upc",
         "ingredients", "not_a_significant_source_of", "serving_size",
         "serving_size_unit", "household_serving_fulltext", "branded_food_category"],
        [
            ["1105904", "Richardson Oilseed Products (US) Limited", "", "",
             "00027000612323", "Vegetable Oil", "", "15.0", "ml", "", "Oils Edible"],
        ],
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class NormalizeUSDATest(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_root = Path(self._tmp.name)
        self.input_root = self.tmp_root / "extracted"
        self.output_dir = self.tmp_root / "out"
        _build_fixture(self.input_root)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _run(self) -> dict:
        return normalize(
            input_root=self.input_root,
            output_dir=self.output_dir,
            force=False,
            chunk_rows=2,  # tiny chunk to exercise external merge sort path
        )

    def _read_jsonl(self, name: str) -> list[dict]:
        return [
            json.loads(line)
            for line in (self.output_dir / name).read_text(encoding="utf-8").splitlines()
            if line
        ]

    def test_ingredients_row_count(self) -> None:
        self._run()
        rows = self._read_jsonl("ingredients.jsonl")
        self.assertEqual(len(rows), 3)

    def test_nutrients_row_count(self) -> None:
        self._run()
        rows = self._read_jsonl("nutrients.jsonl")
        # 5 valid rows; the empty-amount row is skipped.
        self.assertEqual(len(rows), 5)

    def test_ingredients_sorted_by_fdc_id(self) -> None:
        self._run()
        rows = self._read_jsonl("ingredients.jsonl")
        ids = [r["fdc_id"] for r in rows]
        self.assertEqual(ids, sorted(ids))
        self.assertEqual(ids, [167512, 319874, 1105904])

    def test_nutrients_sorted_by_fdc_then_nutrient(self) -> None:
        self._run()
        rows = self._read_jsonl("nutrients.jsonl")
        keys = [(r["fdc_id"], r["nutrient_id"]) for r in rows]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(
            keys,
            [(167512, 1003), (167512, 1257), (319874, 1003),
             (1105904, 1003), (1105904, 1257)],
        )

    def test_ingredient_schema_fields(self) -> None:
        self._run()
        rows = self._read_jsonl("ingredients.jsonl")
        expected = {
            "fdc_id", "description", "data_type", "food_category_id",
            "food_category", "brand_owner", "gtin_upc", "ingredients",
            "serving_size", "serving_size_unit", "source_archive",
        }
        for r in rows:
            self.assertEqual(set(r.keys()), expected, r)

    def test_nutrient_schema_fields(self) -> None:
        self._run()
        rows = self._read_jsonl("nutrients.jsonl")
        expected = {
            "fdc_id", "nutrient_id", "nutrient_name", "unit_name",
            "amount", "derivation_id", "source_archive",
        }
        for r in rows:
            self.assertEqual(set(r.keys()), expected, r)

    def test_branded_fields_only_on_branded_rows(self) -> None:
        self._run()
        rows = {r["fdc_id"]: r for r in self._read_jsonl("ingredients.jsonl")}
        sr = rows[167512]
        self.assertEqual(sr["source_archive"], "sr_legacy")
        self.assertIsNone(sr["brand_owner"])
        self.assertIsNone(sr["gtin_upc"])
        self.assertIsNone(sr["ingredients"])
        self.assertIsNone(sr["serving_size"])
        self.assertIsNone(sr["serving_size_unit"])

        br = rows[1105904]
        self.assertEqual(br["source_archive"], "branded")
        self.assertEqual(br["brand_owner"], "Richardson Oilseed Products (US) Limited")
        self.assertEqual(br["gtin_upc"], "00027000612323")
        self.assertEqual(br["ingredients"], "Vegetable Oil")
        self.assertEqual(br["serving_size"], 15.0)
        self.assertEqual(br["serving_size_unit"], "ml")

    def test_food_category_join(self) -> None:
        self._run()
        rows = {r["fdc_id"]: r for r in self._read_jsonl("ingredients.jsonl")}
        self.assertEqual(rows[167512]["food_category_id"], 18)
        self.assertEqual(rows[167512]["food_category"], "Baked Products")
        self.assertEqual(rows[319874]["food_category_id"], 16)
        self.assertEqual(rows[319874]["food_category"], "Legumes and Legume Products")
        # Branded food has no food_category_id in the fixture.
        self.assertIsNone(rows[1105904]["food_category_id"])
        self.assertIsNone(rows[1105904]["food_category"])

    def test_nutrient_join(self) -> None:
        self._run()
        rows = self._read_jsonl("nutrients.jsonl")
        sample = rows[0]
        self.assertEqual(sample["fdc_id"], 167512)
        self.assertEqual(sample["nutrient_id"], 1003)
        self.assertEqual(sample["nutrient_name"], "Protein")
        self.assertEqual(sample["unit_name"], "G")
        self.assertEqual(sample["amount"], 5.88)
        self.assertEqual(sample["derivation_id"], 46)
        self.assertEqual(sample["source_archive"], "sr_legacy")

    def test_manifest_sha256_matches_files(self) -> None:
        self._run()
        manifest = json.loads(
            (self.output_dir / "manifest.json").read_text(encoding="utf-8")
        )
        for name in ("ingredients.jsonl", "nutrients.jsonl"):
            recorded = manifest["outputs"][name]["sha256"]
            actual = hashlib.sha256(
                (self.output_dir / name).read_bytes()
            ).hexdigest()
            self.assertEqual(recorded, actual, name)
            self.assertEqual(
                manifest["outputs"][name]["bytes"],
                (self.output_dir / name).stat().st_size,
            )

    def test_manifest_row_counts(self) -> None:
        self._run()
        manifest = json.loads(
            (self.output_dir / "manifest.json").read_text(encoding="utf-8")
        )
        self.assertEqual(manifest["row_counts"]["ingredients"], 3)
        self.assertEqual(manifest["row_counts"]["nutrients"], 5)
        self.assertEqual(
            manifest["row_counts"]["by_archive"]["sr_legacy"]["ingredients"], 2,
        )
        self.assertEqual(
            manifest["row_counts"]["by_archive"]["branded"]["ingredients"], 1,
        )
        self.assertEqual(
            manifest["row_counts"]["by_archive"]["sr_legacy"]["nutrients"], 3,
        )
        self.assertEqual(
            manifest["row_counts"]["by_archive"]["branded"]["nutrients"], 2,
        )

    def test_idempotent_skip_on_second_run(self) -> None:
        m1 = self._run()
        ing_sha_1 = m1["outputs"]["ingredients.jsonl"]["sha256"]
        # Second run: should detect existing manifest matches files and
        # short-circuit without rewriting.
        m2 = normalize(
            input_root=self.input_root,
            output_dir=self.output_dir,
            force=False,
        )
        self.assertEqual(m2["outputs"]["ingredients.jsonl"]["sha256"], ing_sha_1)

    def test_force_rebuild_produces_same_data(self) -> None:
        m1 = self._run()
        m2 = normalize(
            input_root=self.input_root,
            output_dir=self.output_dir,
            force=True,
            chunk_rows=2,
        )
        # Force rebuild should produce byte-identical jsonl outputs (the
        # data is deterministic; only generated_at differs in the manifest).
        self.assertEqual(
            m1["outputs"]["ingredients.jsonl"]["sha256"],
            m2["outputs"]["ingredients.jsonl"]["sha256"],
        )
        self.assertEqual(
            m1["outputs"]["nutrients.jsonl"]["sha256"],
            m2["outputs"]["nutrients.jsonl"]["sha256"],
        )

    def test_cli_main(self) -> None:
        rc = normalize_main(
            [
                "--input-root", str(self.input_root),
                "--output-dir", str(self.output_dir),
                "--chunk-rows", "2",
            ]
        )
        self.assertEqual(rc, 0)
        self.assertTrue((self.output_dir / "ingredients.jsonl").exists())
        self.assertTrue((self.output_dir / "nutrients.jsonl").exists())
        self.assertTrue((self.output_dir / "manifest.json").exists())

    def test_stale_tmp_dir_swept_on_startup(self) -> None:
        # Simulate an aborted prior run by creating a stale tmp dir under
        # the output dir. The normalizer must remove it before kicking off
        # a fresh run (and BEFORE the idempotency check, so a stale tmp
        # alongside valid outputs doesn't survive).
        self.output_dir.mkdir(parents=True, exist_ok=True)
        stale = self.output_dir / ".tmp_usda_sort_dummy"
        stale.mkdir()
        (stale / "chunk-00000.jsonl").write_text("garbage\n", encoding="utf-8")
        self._run()
        self.assertFalse(stale.exists(), "stale tmp dir should be swept")


# ---------------------------------------------------------------------------
# Edge-case tests (I-6): empty archives, missing files, ties, unsorted input,
# unknown nutrient ids, orphan branded rows, idempotency under tampering.
# ---------------------------------------------------------------------------


class NormalizeUSDAEdgeCasesTest(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_root = Path(self._tmp.name)
        self.input_root = self.tmp_root / "extracted"
        self.output_dir = self.tmp_root / "out"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _read_jsonl(self, name: str) -> list[dict]:
        return [
            json.loads(line)
            for line in (self.output_dir / name).read_text(encoding="utf-8").splitlines()
            if line
        ]

    # --- I-6.1 ---------------------------------------------------------------
    def test_empty_archive_directory_is_silently_skipped(self) -> None:
        """An archive dir that exists but contains only an empty food.csv (no
        rows) must not crash; it must just contribute zero foods/nutrients."""
        # Build a normal sr_legacy archive plus a branded archive whose
        # food.csv is *just a header*.
        _build_fixture(self.input_root)
        br_dir = self.input_root / ARCHIVES["branded"]
        # Replace branded food.csv + food_nutrient.csv + branded_food.csv with
        # header-only files. nutrient.csv stays so the catalog still loads.
        _write_csv(
            br_dir / "food.csv",
            ["fdc_id", "data_type", "description", "food_category_id",
             "publication_date"],
            [],
        )
        _write_csv(
            br_dir / "food_nutrient.csv",
            ["id", "fdc_id", "nutrient_id", "amount", "data_points",
             "derivation_id", "min", "max", "median", "footnote",
             "min_year_acquired"],
            [],
        )
        _write_csv(
            br_dir / "branded_food.csv",
            ["fdc_id", "brand_owner", "brand_name", "subbrand_name", "gtin_upc",
             "ingredients", "not_a_significant_source_of", "serving_size",
             "serving_size_unit", "household_serving_fulltext",
             "branded_food_category"],
            [],
        )
        normalize(
            input_root=self.input_root,
            output_dir=self.output_dir,
            force=False,
            chunk_rows=2,
        )
        ingredients = self._read_jsonl("ingredients.jsonl")
        nutrients = self._read_jsonl("nutrients.jsonl")
        # Only sr_legacy contributed.
        self.assertEqual({r["source_archive"] for r in ingredients}, {"sr_legacy"})
        self.assertEqual({r["source_archive"] for r in nutrients}, {"sr_legacy"})
        self.assertEqual(len(ingredients), 2)
        self.assertEqual(len(nutrients), 3)

    # --- I-6.2 ---------------------------------------------------------------
    def test_missing_food_nutrient_csv_is_skipped(self) -> None:
        """When a single archive has no food_nutrient.csv at all, the
        ``if not path.exists(): continue`` branch in ``_iter_nutrient_rows``
        must fire. Ingredients from that archive still appear; nutrients
        from it are silently absent."""
        _build_fixture(self.input_root)
        # Delete branded/food_nutrient.csv but leave branded food.csv in place.
        (self.input_root / ARCHIVES["branded"] / "food_nutrient.csv").unlink()
        normalize(
            input_root=self.input_root,
            output_dir=self.output_dir,
            force=False,
            chunk_rows=2,
        )
        ingredients = self._read_jsonl("ingredients.jsonl")
        nutrients = self._read_jsonl("nutrients.jsonl")
        # Branded ingredient still emits.
        self.assertIn(1105904, [r["fdc_id"] for r in ingredients])
        # No nutrient rows from branded.
        self.assertEqual({r["source_archive"] for r in nutrients}, {"sr_legacy"})

        manifest = json.loads(
            (self.output_dir / "manifest.json").read_text(encoding="utf-8")
        )
        self.assertEqual(
            manifest["row_counts"]["by_archive"]["branded"]["nutrients"], 0,
        )
        self.assertEqual(
            manifest["row_counts"]["by_archive"]["branded"]["ingredients"], 1,
        )

    # --- I-6.3 ---------------------------------------------------------------
    def test_load_nutrient_catalog_raises_when_no_archive_has_nutrient_csv(self) -> None:
        """If every archive lacks nutrient.csv, ``_load_nutrient_catalog``
        raises FileNotFoundError. We wire that up by building a fixture and
        then deleting every nutrient.csv."""
        from scripts.datapack.normalize_usda import _load_nutrient_catalog

        _build_fixture(self.input_root)
        for key in ARCHIVE_ORDER:
            p = self.input_root / ARCHIVES[key] / "nutrient.csv"
            if p.exists():
                p.unlink()
        with self.assertRaises(FileNotFoundError):
            _load_nutrient_catalog(self.input_root)

    # --- I-6.4 ---------------------------------------------------------------
    def test_unsorted_input_csv_yields_sorted_output(self) -> None:
        """Rewrite sr_legacy's food.csv and food_nutrient.csv in REVERSE
        fdc_id order. Outputs must still come out ascending — proves the
        sort is doing real work."""
        _build_fixture(self.input_root)
        sr_dir = self.input_root / ARCHIVES["sr_legacy"]
        # Reverse food.csv: 319874 first, then 167512.
        _write_csv(
            sr_dir / "food.csv",
            ["fdc_id", "data_type", "description", "food_category_id",
             "publication_date"],
            [
                ["319874", "sr_legacy_food", "HUMMUS, SABRA CLASSIC", "16",
                 "2019-04-01"],
                ["167512", "sr_legacy_food", "Pillsbury Biscuits", "18",
                 "2019-04-01"],
            ],
        )
        # Reverse food_nutrient.csv: 319874 row, then 167512 rows. Within
        # 167512 also reverse the two nutrient_ids so the chunk sort has to
        # reorder them.
        _write_csv(
            sr_dir / "food_nutrient.csv",
            ["id", "fdc_id", "nutrient_id", "amount", "data_points",
             "derivation_id", "min", "max", "median", "footnote",
             "min_year_acquired"],
            [
                ["1283676", "319874", "1003", "8.0", "1", "46", "", "", "", "", ""],
                ["1283675", "167512", "1257", "17.0", "1", "46", "", "", "", "", ""],
                ["1283674", "167512", "1003", "5.88", "1", "46", "", "", "", "", ""],
            ],
        )
        # tiny chunk_rows so multiple chunks must be produced and merged.
        normalize(
            input_root=self.input_root,
            output_dir=self.output_dir,
            force=False,
            chunk_rows=2,
        )
        ing_ids = [r["fdc_id"] for r in self._read_jsonl("ingredients.jsonl")]
        self.assertEqual(ing_ids, sorted(ing_ids))
        nut_keys = [
            (r["fdc_id"], r["nutrient_id"])
            for r in self._read_jsonl("nutrients.jsonl")
        ]
        self.assertEqual(nut_keys, sorted(nut_keys))

    # --- I-6.5 ---------------------------------------------------------------
    def test_tied_fdc_nutrient_pair_orders_by_derivation_id(self) -> None:
        """Two rows at the same (fdc, nid) but with different derivation_id
        values must both emit, and the row with the smaller derivation_id
        must come first (stable tie-break, I-5)."""
        _build_fixture(self.input_root)
        sr_dir = self.input_root / ARCHIVES["sr_legacy"]
        # Append a second (167512, 1003) row with a DIFFERENT derivation_id.
        # Write the rows in an order that does NOT happen to be sorted.
        _write_csv(
            sr_dir / "food_nutrient.csv",
            ["id", "fdc_id", "nutrient_id", "amount", "data_points",
             "derivation_id", "min", "max", "median", "footnote",
             "min_year_acquired"],
            [
                # Larger derivation first — sort must reorder.
                ["1283674", "167512", "1003", "5.88", "1", "70", "", "", "", "", ""],
                ["1283677", "167512", "1003", "5.92", "1", "46", "", "", "", "", ""],
                ["1283675", "167512", "1257", "17.0", "1", "46", "", "", "", "", ""],
                ["1283676", "319874", "1003", "8.0",  "1", "46", "", "", "", "", ""],
            ],
        )
        normalize(
            input_root=self.input_root,
            output_dir=self.output_dir,
            force=False,
            chunk_rows=2,
        )
        rows = self._read_jsonl("nutrients.jsonl")
        # Find the two tied rows.
        tied = [r for r in rows if r["fdc_id"] == 167512 and r["nutrient_id"] == 1003]
        self.assertEqual(len(tied), 2)
        # Smaller derivation_id (46) must come before the larger (70).
        self.assertEqual([r["derivation_id"] for r in tied], [46, 70])

    # --- I-6.6 ---------------------------------------------------------------
    def test_orphan_branded_food_row_is_silently_dropped(self) -> None:
        """A branded_food.csv row whose fdc_id has no corresponding food.csv
        row must NOT cause the orphan to appear in ingredients.jsonl —
        ingredients are sourced from food.csv, branded_food.csv only enriches
        existing rows."""
        _build_fixture(self.input_root)
        br_dir = self.input_root / ARCHIVES["branded"]
        # Add an orphan row in branded_food.csv (fdc 9999999), no matching
        # food.csv row. Keep the original branded food.csv as-is so 1105904
        # still emits.
        _write_csv(
            br_dir / "branded_food.csv",
            ["fdc_id", "brand_owner", "brand_name", "subbrand_name", "gtin_upc",
             "ingredients", "not_a_significant_source_of", "serving_size",
             "serving_size_unit", "household_serving_fulltext",
             "branded_food_category"],
            [
                ["1105904", "Richardson Oilseed Products (US) Limited", "", "",
                 "00027000612323", "Vegetable Oil", "", "15.0", "ml", "",
                 "Oils Edible"],
                ["9999999", "Phantom Brand", "", "", "00000000000000",
                 "Phantom Ingredients", "", "1.0", "ml", "", "Phantom"],
            ],
        )
        normalize(
            input_root=self.input_root,
            output_dir=self.output_dir,
            force=False,
            chunk_rows=2,
        )
        rows = self._read_jsonl("ingredients.jsonl")
        ids = [r["fdc_id"] for r in rows]
        self.assertNotIn(9999999, ids)
        # Real branded row still present and enriched.
        br = next(r for r in rows if r["fdc_id"] == 1105904)
        self.assertEqual(br["brand_owner"], "Richardson Oilseed Products (US) Limited")

    # --- I-6.7 ---------------------------------------------------------------
    def test_unknown_nutrient_id_emits_null_name_and_unit(self) -> None:
        """A food_nutrient.csv row that references a nutrient_id absent from
        the catalog must still emit, with nutrient_name=null and
        unit_name=null. No crash."""
        _build_fixture(self.input_root)
        sr_dir = self.input_root / ARCHIVES["sr_legacy"]
        # Add a row referencing nutrient_id 9999, which is NOT in the catalog
        # built by _build_fixture (only 1003 + 1257 exist).
        _write_csv(
            sr_dir / "food_nutrient.csv",
            ["id", "fdc_id", "nutrient_id", "amount", "data_points",
             "derivation_id", "min", "max", "median", "footnote",
             "min_year_acquired"],
            [
                ["1283674", "167512", "1003", "5.88", "1", "46", "", "", "", "", ""],
                ["1283675", "167512", "1257", "17.0", "1", "46", "", "", "", "", ""],
                ["1283676", "319874", "1003", "8.0",  "1", "46", "", "", "", "", ""],
                ["1283999", "319874", "9999", "1.23", "1", "46", "", "", "", "", ""],
            ],
        )
        normalize(
            input_root=self.input_root,
            output_dir=self.output_dir,
            force=False,
            chunk_rows=2,
        )
        rows = self._read_jsonl("nutrients.jsonl")
        unknown = [r for r in rows if r["nutrient_id"] == 9999]
        self.assertEqual(len(unknown), 1)
        self.assertIsNone(unknown[0]["nutrient_name"])
        self.assertIsNone(unknown[0]["unit_name"])
        # Other rows still have proper joins.
        protein = next(r for r in rows if r["nutrient_id"] == 1003 and r["fdc_id"] == 167512)
        self.assertEqual(protein["nutrient_name"], "Protein")

    # --- I-6.8 ---------------------------------------------------------------
    def test_idempotency_under_tampering_triggers_rebuild(self) -> None:
        """Run once, mutate nutrients.jsonl off-disk, run again without
        --force. The sha256 mismatch must trigger a rebuild and restore the
        canonical content."""
        _build_fixture(self.input_root)
        m1 = normalize(
            input_root=self.input_root,
            output_dir=self.output_dir,
            force=False,
            chunk_rows=2,
        )
        canonical_sha = m1["outputs"]["nutrients.jsonl"]["sha256"]
        nutrients_path = self.output_dir / "nutrients.jsonl"
        canonical_bytes = nutrients_path.read_bytes()

        # Tamper: flip a single byte deep in the file. Use a write that makes
        # the file's sha256 *not* match the manifest entry.
        tampered = bytearray(canonical_bytes)
        # Flip the first byte (must be ASCII so json stays readable-ish; we
        # don't care, only the sha matters).
        tampered[0] = (tampered[0] ^ 0x01)
        nutrients_path.write_bytes(bytes(tampered))
        post_tamper_sha = hashlib.sha256(nutrients_path.read_bytes()).hexdigest()
        self.assertNotEqual(post_tamper_sha, canonical_sha)

        # Second run, no --force. Must detect the mismatch and rebuild.
        m2 = normalize(
            input_root=self.input_root,
            output_dir=self.output_dir,
            force=False,
            chunk_rows=2,
        )
        restored_sha = hashlib.sha256(nutrients_path.read_bytes()).hexdigest()
        self.assertEqual(restored_sha, canonical_sha)
        self.assertEqual(m2["outputs"]["nutrients.jsonl"]["sha256"], canonical_sha)


class NormalizeUSDAProgressTest(unittest.TestCase):
    """F2: per-N-row progress logging on stderr.

    Patches ``sys.stderr.isatty`` to True so the gated emit fires, runs the
    iterator with ``progress_every=2`` (the fixture has 5 valid rows so we
    expect emits at row 2 and row 4), and asserts at least one matching
    line shows up in stderr. The TTY gate is the load-bearing thing: every
    other test in this file runs under unittest's default capture, where
    ``sys.stderr.isatty()`` is False, so they stay silent.
    """

    def setUp(self) -> None:
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_root = Path(self._tmp.name)
        self.input_root = self.tmp_root / "extracted"
        _build_fixture(self.input_root)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_progress_lines_emit_on_tty(self) -> None:
        import io
        from unittest.mock import patch

        from scripts.datapack.normalize_usda import (
            _iter_nutrient_rows,
            _load_nutrient_catalog,
        )

        catalog = _load_nutrient_catalog(self.input_root)
        captured = io.StringIO()
        # Patch sys.stderr to a writable buffer whose isatty() returns True,
        # so the script's gate fires. patching only stderr (not stdout)
        # ensures phase-boundary lines stay on stdout.
        captured.isatty = lambda: True  # type: ignore[method-assign]
        with patch("scripts.datapack.normalize_usda.sys.stderr", captured):
            # Drain the iterator so all yields execute.
            rows = list(
                _iter_nutrient_rows(
                    self.input_root, catalog, progress_every=2
                )
            )
        # 5 valid rows in the fixture — see _build_fixture docstring.
        self.assertEqual(len(rows), 5)
        out = captured.getvalue()
        self.assertIn("USDA nutrients:", out)
        # progress_every=2 with 5 rows -> emits at 2 and 4 (not at 0, not
        # at 5 — final-summary is the driver's responsibility).
        self.assertIn("2 rows scanned", out)
        self.assertIn("4 rows scanned", out)
        # Per-archive breakdown must be present.
        for key in ARCHIVE_ORDER:
            self.assertIn(f"{key}:", out)

    def test_progress_silent_when_stderr_not_tty(self) -> None:
        import io
        from unittest.mock import patch

        from scripts.datapack.normalize_usda import (
            _iter_nutrient_rows,
            _load_nutrient_catalog,
        )

        catalog = _load_nutrient_catalog(self.input_root)
        captured = io.StringIO()
        captured.isatty = lambda: False  # type: ignore[method-assign]
        with patch("scripts.datapack.normalize_usda.sys.stderr", captured):
            list(
                _iter_nutrient_rows(
                    self.input_root, catalog, progress_every=2
                )
            )
        self.assertEqual(captured.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
