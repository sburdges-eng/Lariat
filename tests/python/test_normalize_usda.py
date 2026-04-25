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


if __name__ == "__main__":
    unittest.main()
