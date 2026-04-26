"""Shared fixture data and helpers for the datapack indexer test modules.

Used by:

  * ``tests/python/test_build_sqlite_index.py``
  * ``tests/python/test_build_fts_index.py``
  * ``tests/python/test_build_embeddings_index.py``
  * ``tests/python/test_normalize_fda_food_code.py``
  * ``tests/python/test_search.py``

The leading underscore in the filename keeps pytest's default discovery from
treating this as a test module — it has no test classes / functions, just
fixture constants and small filesystem helpers.

This module is intentionally self-contained: it does NOT import from any
test module. The test modules import from it (and only from it).

Determinism tiers across the data-pack test family:
  * FDA normalize: byte-identical ``sections.jsonl`` across rebuilds (the
    test asserts via ``read_bytes()`` equality).
  * SQLite / FTS / embeddings indexers: sha-stable INPUT + stable row
    counts + stable per-source manifests, but the DB binary is NOT
    byte-identical across rebuilds (the indexers embed timestamps in
    their internal ``_manifest`` tables). Tests assert sha + row_count
    invariants, not byte equality.
  * Search (DataPackSearch): no determinism story — it is a read-only
    query API; tests assert ordering and shape contracts.
"""

from __future__ import annotations

import hashlib
import json
import sys
import types
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Fixture data
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

# T3 (test_build_embeddings_index.py) and T5 (test_search.py) define their
# own _WIKIBOOKS_PAGES with extended rows (knife skills, sourdough, food
# safety basics) because their tests need bucket-discriminating content
# this canonical fixture lacks. If you add canonical rows here, audit those
# files for duplicate page_ids before merging.
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
# Filesystem helpers
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
# sys.modules stubbing helpers
# ---------------------------------------------------------------------------
#
# The embeddings / FDA-normalize / search tests inject fake versions of
# heavy optional dependencies (``sentence_transformers``, ``torch``,
# ``pdfplumber``) so the production code can import them without the real
# packages being present. The install + restore must happen per-test rather
# than at module-import time so two test files with conflicting fakes do
# not clobber each other under pytest collection order.


def install_module_stubs(stubs: dict[str, types.ModuleType]) -> dict[str, object]:
    """Save+install module stubs in ``sys.modules``.

    Returns a dict of previous values keyed by module name. Pass the
    returned dict to ``restore_module_stubs`` to restore.

    A previous value of ``None`` means the module wasn't installed before
    the call.
    """
    previous: dict[str, object] = {}
    for name, mod in stubs.items():
        previous[name] = sys.modules.get(name)
        sys.modules[name] = mod
    return previous


def restore_module_stubs(previous: dict[str, object]) -> None:
    """Restore ``sys.modules`` to the state captured by ``install_module_stubs``."""
    for name, prev in previous.items():
        if prev is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = prev
