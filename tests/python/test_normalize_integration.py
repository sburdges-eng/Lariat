"""End-to-end integration test for the data-pack normalization pipeline.

Builds tiny synthetic fixtures for all three sources (USDA, OFF, Wikibooks)
under a single tmp data root, runs each ``normalize_*.py`` against its
slice, then runs ``sanity_check`` against the whole tree and asserts
exit code 0.

This is the seam test the per-task tests don't cover: a normalizer that
renames a ``row_counts`` key (or otherwise drifts from sanity_check's
expectations) will fail HERE even though every per-source unit test still
passes. Without this test, schema drift can ride into production silently.
"""
from __future__ import annotations

import io
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.datapack import (  # noqa: E402
    normalize_off,
    normalize_usda,
    normalize_wikibooks,
    sanity_check,
)


# ---------------------------------------------------------------------------
# Tiny fixture builders (one row apiece — the smallest input each
# normalizer can handle without hitting an empty-output edge case).
# ---------------------------------------------------------------------------


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _build_usda_fixture(input_root: Path) -> None:
    """One sr_legacy archive with one food + one nutrient row."""
    archive_dir = input_root / "FoodData_Central_sr_legacy_food_csv_2018-04"
    _write(
        archive_dir / "food.csv",
        "fdc_id,data_type,description,food_category_id,publication_date\n"
        '167512,sr_legacy_food,"Pillsbury Biscuits",18,2019-04-01\n',
    )
    _write(
        archive_dir / "food_nutrient.csv",
        "id,fdc_id,nutrient_id,amount,data_points,derivation_id,"
        "min,max,median,footnote,min_year_acquired\n"
        "1,167512,1003,5.88,1,46,,,,,\n",
    )
    _write(
        archive_dir / "nutrient.csv",
        "id,name,unit_name,nutrient_nbr,rank\n"
        "1003,Protein,G,203,600.0\n",
    )
    _write(
        archive_dir / "food_category.csv",
        "id,code,description\n"
        "18,1800,Baked Products\n",
    )


def _build_off_fixture(input_file: Path) -> None:
    header = [
        "code", "url", "product_name", "brands",
        "categories_tags", "countries_en", "ingredients_text",
        "allergens", "traces_tags", "serving_size",
        "nutriscore_grade", "brand_owner",
    ]
    row = [
        "0000000000017", "https://world.openfoodfacts.org/product/17",
        "Chocolate Bar", "ACME",
        "en:snacks,en:chocolates", "United States",
        "Cocoa, sugar, milk",
        "en:milk", "en:nuts", "30g",
        "d", "ACME Corp",
    ]
    _write(input_file, "\t".join(header) + "\n" + "\t".join(row) + "\n")


def _build_wikibooks_fixture(input_file: Path) -> None:
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/" '
        'xml:lang="en" version="0.11">\n'
        '  <page>\n'
        '    <title>Cookbook:Mole sauce</title>\n'
        '    <ns>102</ns>\n'
        '    <id>10</id>\n'
        '    <revision>\n'
        '      <id>1001</id>\n'
        '      <timestamp>2024-01-01T00:00:00Z</timestamp>\n'
        '      <text bytes="120" xml:space="preserve">'
        'Mole sauce is a traditional Mexican sauce.\n'
        '[[Category:Mexican cuisine]]\n'
        '</text>\n'
        '    </revision>\n'
        '  </page>\n'
        '  <page>\n'
        '    <title>Main Page</title>\n'
        '    <ns>0</ns>\n'
        '    <id>1</id>\n'
        '    <revision>\n'
        '      <id>2</id>\n'
        '      <timestamp>2024-01-01T00:00:00Z</timestamp>\n'
        '      <text bytes="20" xml:space="preserve">Welcome.</text>\n'
        '    </revision>\n'
        '  </page>\n'
        '</mediawiki>\n'
    )
    _write(input_file, xml)


# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------


class IntegrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.data_root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_full_pipeline_three_normalizers_then_sanity(self) -> None:
        # Lay down the raw/extracted tree under the shared data root.
        usda_input = self.data_root / "raw" / "usda_fooddata" / "extracted"
        off_input = (
            self.data_root / "raw" / "openfoodfacts" / "extracted"
            / "openfoodfacts_products.csv"
        )
        wikibooks_input = (
            self.data_root / "raw" / "wikibooks_cookbook" / "extracted"
            / "enwikibooks-latest-pages-articles.xml"
        )
        _build_usda_fixture(usda_input)
        _build_off_fixture(off_input)
        _build_wikibooks_fixture(wikibooks_input)

        # Run each normalizer into its conventional output_dir under data_root.
        normalize_usda.normalize(
            input_root=usda_input,
            output_dir=self.data_root / "normalized" / "usda",
            force=False,
            chunk_rows=2,
        )
        normalize_off.normalize(
            input_file=off_input,
            output_dir=self.data_root / "normalized" / "openfoodfacts",
            force=False,
            chunk_rows=2,
        )
        normalize_wikibooks.normalize(
            input_file=wikibooks_input,
            output_dir=self.data_root / "normalized" / "wikibooks",
            force=False,
            chunk_rows=2,
        )

        # Run sanity_check against the whole tree.
        buf = io.StringIO()
        rc = sanity_check.run(
            data_root=self.data_root, samples=5, verbose=False, out=buf,
        )
        stdout = buf.getvalue()

        self.assertEqual(rc, 0, msg=f"sanity_check failed:\n{stdout}")
        # Each source must report ✓ OK — not SKIP, not FAIL.
        self.assertIn("usda", stdout)
        self.assertIn("openfoodfacts", stdout)
        self.assertIn("wikibooks", stdout)
        # Three OK rows expected (one per source).
        self.assertEqual(stdout.count("✓ OK"), 3, stdout)
        self.assertNotIn("✗ FAIL", stdout)
        self.assertNotIn("○ SKIP", stdout)


if __name__ == "__main__":
    unittest.main()
