"""Smoke tests for ``scripts.datapack.search.DataPackSearch``.

The search module unifies SQLite + FTS5 + embedding indexes built by the
sibling ``build_*_index.py`` scripts. Each test below builds a real tiny
SQLite DB + real tiny FTS DB via the upstream builders, then writes a
deterministic ``vectors.npy`` + ``metadata.jsonl`` directly under
``indexes/embeddings/<bucket>/`` (skipping the embeddings builder so the
real BGE model never loads — that would download ~134 MB of weights).

The semantic / hybrid paths import ``sentence_transformers`` lazily; we
inject a fake into ``sys.modules`` BEFORE importing ``search`` so the
module's ``from sentence_transformers import SentenceTransformer`` resolves
to a deterministic stub. The fake's ``encode([query])`` returns a unit
vector chosen by parsing a sentinel token (``ALPHA`` / ``BETA`` / etc.)
out of the query text, so each test can pin the query embedding to
exactly one row in the metadata fixture.

  1. ``fts()`` with a single source — ``"apple"`` against ``source="usda"``
     surfaces the expected USDA row, result rows have the documented shape.
  2. ``fts()`` with ``source="all"`` — query word that hits both USDA and
     OFF returns rows from both sources.
  3. ``semantic()`` returns top-k by cosine — query encoded as a known unit
     vector aligns with one fixture row; ordering reflects cosine distance.
  4. ``hybrid()`` over a bucket fuses both signals — FTS strong on row A,
     semantic strong on row B; both appear in the merged top-k.
  5. Missing index raises ``FileNotFoundError`` — both the SQLite-missing
     and FTS-missing cases get a clear message.
  6. Context manager closes resources — calls after ``__exit__`` fail.
"""

from __future__ import annotations

import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ---------------------------------------------------------------------------
# Fake SentenceTransformer + torch — installed BEFORE importing search.
# ---------------------------------------------------------------------------


_DIMS = 4

# Sentinel tokens the fake encoder looks for inside the query text. The
# query passed to ``model.encode()`` is the BGE prefix + the user's raw
# query, so every test embeds one of these markers in its query string
# to deterministically pick a vector axis. Unknown queries fall back to
# axis 0 (a neutral default that won't accidentally tie any row).
_QUERY_AXIS_BY_TOKEN: dict[str, int] = {
    "ALPHA": 0,
    "BETA": 1,
    "GAMMA": 2,
    "DELTA": 3,
}


class _FakeSentenceTransformer:
    """Deterministic stand-in for ``sentence_transformers.SentenceTransformer``.

    ``encode([text])`` returns a single L2-normalized unit vector in
    dimension ``i`` where ``i`` is determined by which sentinel
    (``ALPHA`` / ``BETA`` / ``GAMMA`` / ``DELTA``) appears in the text.
    Tests embed the sentinel into the query string so the encoded query
    aligns with a specific row in the test's vectors fixture.
    """

    init_calls = 0
    encode_calls = 0
    last_model_id: str | None = None
    last_texts: list[str] | None = None

    def __init__(self, model_id: str, device: str | None = None) -> None:
        type(self).init_calls += 1
        type(self).last_model_id = model_id
        self.model_id = model_id
        self.device = device or "cpu"

    def encode(
        self,
        texts: list[str],
        normalize_embeddings: bool = True,
        convert_to_numpy: bool = True,
        **_: Any,
    ) -> Any:
        import numpy as np
        type(self).encode_calls += 1
        type(self).last_texts = list(texts)
        out = np.zeros((len(texts), _DIMS), dtype=np.float32)
        for row_i, text in enumerate(texts):
            axis = 0
            for token, idx in _QUERY_AXIS_BY_TOKEN.items():
                if token in text:
                    axis = idx
                    break
            out[row_i, axis] = 1.0
        return out

    @classmethod
    def reset(cls) -> None:
        cls.init_calls = 0
        cls.encode_calls = 0
        cls.last_model_id = None
        cls.last_texts = None


class _FakeBackends:
    class mps:
        @staticmethod
        def is_available() -> bool:
            return False


class _FakeCuda:
    @staticmethod
    def is_available() -> bool:
        return False


def _install_fakes() -> dict[str, Any]:
    """Install the search-test fakes into ``sys.modules`` and return the
    previous module objects so ``_restore_fakes`` can put them back.

    We do this per-test (in setUp / tearDown) rather than at module import
    so that other test modules — notably ``test_build_embeddings_index``
    which has its OWN fake encoder with a different ``encode()`` shape —
    aren't clobbered by load-order accidents under pytest collection.
    The previous fake's behavior is preserved across our test method.
    """
    prev_st = sys.modules.get("sentence_transformers")
    prev_torch = sys.modules.get("torch")
    fake_st = types.ModuleType("sentence_transformers")
    fake_st.SentenceTransformer = _FakeSentenceTransformer  # type: ignore[attr-defined]
    sys.modules["sentence_transformers"] = fake_st
    fake_torch = types.ModuleType("torch")
    fake_torch.backends = _FakeBackends  # type: ignore[attr-defined]
    fake_torch.cuda = _FakeCuda  # type: ignore[attr-defined]
    sys.modules["torch"] = fake_torch
    return {"sentence_transformers": prev_st, "torch": prev_torch}


def _restore_fakes(prev: dict[str, Any]) -> None:
    for name, mod in prev.items():
        if mod is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = mod


# Production modules are safe to import unconditionally — ``search`` only
# touches ``sentence_transformers`` inside ``_load_model()``, which runs at
# query time after our setUp has already installed the fake.
from scripts.datapack import build_fts_index, build_sqlite_index  # noqa: E402
from scripts.datapack.search import DataPackSearch  # noqa: E402

from tests.python._datapack_test_helpers import (  # noqa: E402
    OFF_ALLERGENS_SUMMARY,
    USDA_NUTRIENTS,
    _write_json,
    _write_jsonl,
)


# ---------------------------------------------------------------------------
# Custom fixtures — designed so cross-source FTS hits are unambiguous.
# ---------------------------------------------------------------------------


# USDA fixture extended with an "almond" food so the cross-source FTS test
# can find matches in both usda_foods.description AND
# off_products.product_name / ingredients_text.
_USDA_FOODS: list[dict[str, Any]] = [
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
        "source_archive": "usda.zip",
    },
    {
        "fdc_id": 1002,
        "description": "Almonds, dry roasted",
        "data_type": "foundation_food",
        "food_category_id": 12,
        "food_category": "Nuts and Seeds",
        "brand_owner": None,
        "gtin_upc": None,
        "ingredients": None,
        "serving_size": 28.0,
        "serving_size_unit": "g",
        "source_archive": "usda.zip",
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
        "source_archive": "usda.zip",
    },
]

# OFF fixture: the existing "Organic Almond Butter" + "Sparkling Water"
# already has "almond" in product_name and ingredients_text, so it pairs
# with the new USDA "Almonds, dry roasted" row for the cross-source test.
_OFF_PRODUCTS: list[dict[str, Any]] = [
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

# Wikibooks fixture: include a "knife skills" page so the hybrid test has
# a wikibooks FTS hit on the word "knife" plus a recipes page that does
# NOT contain the word — semantic alone should surface it.
_WIKIBOOKS_PAGES: list[dict[str, Any]] = [
    {
        "page_id": 42,
        "title": "Cookbook:Apple Pie",
        "slug": "Cookbook:Apple_Pie",
        "is_redirect": False,
        "redirect_target": None,
        "categories": ["Recipes", "Desserts"],
        "wikitext_length": 4321,
        "plain_text_summary": "A classic American dessert with apples in a pastry crust.",
        "source_url": "https://en.wikibooks.org/wiki/Cookbook:Apple_Pie",
    },
    {
        "page_id": 50,
        "title": "Cookbook:Knife Skills",
        "slug": "Cookbook:Knife_Skills",
        "is_redirect": False,
        "redirect_target": None,
        "categories": ["Recipes", "Cooking techniques"],
        "wikitext_length": 800,
        "plain_text_summary": "Holding a chef's knife for control and safety.",
        "source_url": "https://en.wikibooks.org/wiki/Cookbook:Knife_Skills",
    },
    {
        "page_id": 60,
        "title": "Cookbook:Sourdough Bread",
        "slug": "Cookbook:Sourdough_Bread",
        "is_redirect": False,
        "redirect_target": None,
        "categories": ["Recipes", "Breads"],
        "wikitext_length": 2000,
        "plain_text_summary": "Wild yeast leavened loaf with a tangy crumb.",
        "source_url": "https://en.wikibooks.org/wiki/Cookbook:Sourdough_Bread",
    },
]

_FDA_SECTIONS: list[dict[str, Any]] = [
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
]


def _build_input_root_for_search(input_root: Path) -> None:
    """Materialize the synthetic JSONL tree used by all search.py tests."""
    _write_jsonl(input_root / "usda" / "ingredients.jsonl", _USDA_FOODS)
    _write_jsonl(input_root / "usda" / "nutrients.jsonl", USDA_NUTRIENTS)
    _write_jsonl(input_root / "openfoodfacts" / "branded_products.jsonl", _OFF_PRODUCTS)
    _write_json(input_root / "openfoodfacts" / "allergens.json", OFF_ALLERGENS_SUMMARY)
    _write_jsonl(input_root / "wikibooks" / "cookbook_pages.jsonl", _WIKIBOOKS_PAGES)
    _write_jsonl(input_root / "fda_food_code" / "sections.jsonl", _FDA_SECTIONS)


def _write_embeddings(
    bucket_dir: Path,
    *,
    vectors: list[list[float]],
    metadata: list[dict[str, Any]],
) -> None:
    """Write vectors.npy + metadata.jsonl directly to a bucket directory.

    Bypasses ``build_embeddings_index.py`` so the BGE model never loads.
    Vectors are written as float32; the caller is responsible for handing
    in unit-normalized rows so cosine similarity is well-defined.
    """
    import numpy as np
    bucket_dir.mkdir(parents=True, exist_ok=True)
    arr = np.asarray(vectors, dtype=np.float32)
    np.save(bucket_dir / "vectors.npy", arr)
    with open(bucket_dir / "metadata.jsonl", "w", encoding="utf-8") as f:
        for row in metadata:
            f.write(json.dumps(row))
            f.write("\n")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class DataPackSearchSmokeTests(unittest.TestCase):

    def setUp(self) -> None:
        _FakeSentenceTransformer.reset()
        self._prev_modules = _install_fakes()
        self._tmp = tempfile.TemporaryDirectory()
        self.data_root = Path(self._tmp.name)
        self.input_root = self.data_root / "normalized"
        self.input_root.mkdir(parents=True)

    def tearDown(self) -> None:
        self._tmp.cleanup()
        _restore_fakes(self._prev_modules)

    # ------------------------------------------------------------------ helpers

    def _build_indexes(self) -> None:
        """Build SQLite + FTS DBs in the canonical layout
        ``<data_root>/indexes/sqlite/`` + ``<data_root>/indexes/search/fts/``
        — exactly where ``DataPackSearch`` expects them.
        """
        _build_input_root_for_search(self.input_root)
        sqlite_dir = self.data_root / "indexes" / "sqlite"
        fts_dir = self.data_root / "indexes" / "search" / "fts"
        build_sqlite_index.build(
            input_root=self.input_root,
            output_dir=sqlite_dir,
            force=False,
        )
        build_fts_index.build(
            input_db=sqlite_dir / "lariat_data.db",
            output_dir=fts_dir,
            force=False,
        )

    # --------------------------------------------------------------- 1. fts one
    def test_fts_single_source_returns_documented_shape(self) -> None:
        self._build_indexes()
        with DataPackSearch(data_root=self.data_root) as s:
            rows = s.fts("apple", source="usda", limit=10)

        self.assertGreaterEqual(len(rows), 1, "expected at least one apple hit")
        # The "Apple, raw" food (fdc_id 1001) must be the top hit. If the
        # SQL routing were wrong (e.g. JOIN swapped to off_products) the
        # title would not contain "Apple".
        top = rows[0]
        self.assertEqual(top["source"], "usda")
        self.assertEqual(top["id"], 1001)
        self.assertIn("Apple", top["title"])
        # Documented shape: score + source + id + title + subtitle + extra.
        for key in ("score", "source", "id", "title", "subtitle", "extra"):
            self.assertIn(key, top, f"missing field {key!r} in fts row")
        self.assertIsInstance(top["score"], float)

        # No row should leak from a different source — assertion guards
        # against an accidental cross-source UNION sneaking into _fts_one.
        for r in rows:
            self.assertEqual(r["source"], "usda")

    # ----------------------------------------------------------- 2. fts all
    def test_fts_all_merges_hits_across_sources(self) -> None:
        self._build_indexes()
        with DataPackSearch(data_root=self.data_root) as s:
            rows = s.fts("almond", source="all", limit=10)

        sources = {r["source"] for r in rows}
        # USDA "Almonds, dry roasted" + OFF "Organic Almond Butter" both hit.
        self.assertIn("usda", sources)
        self.assertIn("off", sources)

        # Order: every row's score must be <= the next row's score (FTS5
        # bm25 is more-negative = better, so ASC = best first).
        for prev, curr in zip(rows, rows[1:]):
            self.assertLessEqual(prev["score"], curr["score"])

        # Discriminating check: the USDA row must be 1002 (Almonds), not
        # 1001 (Apple) — proves we matched on description not on a stray
        # all-tables wildcard.
        usda_hits = [r for r in rows if r["source"] == "usda"]
        self.assertEqual(usda_hits[0]["id"], 1002)

    # ---------------------------------------------------------- 3. semantic
    def test_semantic_orders_by_cosine_similarity(self) -> None:
        self._build_indexes()
        # Three orthogonal unit vectors → known cosine ordering. The fake
        # encoder maps "BETA" → axis 1, so the query vector is (0, 1, 0, 0)
        # and the closest fixture row must be the one whose vector is also
        # (0, 1, 0, 0) — page_id 50.
        bucket_dir = self.data_root / "indexes" / "embeddings" / "techniques"
        _write_embeddings(
            bucket_dir,
            vectors=[
                [1.0, 0.0, 0.0, 0.0],   # axis 0 — apple pie
                [0.0, 1.0, 0.0, 0.0],   # axis 1 — knife skills (target)
                [0.7071, 0.7071, 0.0, 0.0],  # 45° between axes 0 and 1
            ],
            metadata=[
                {"page_id": 42, "title": "Cookbook:Apple Pie", "source": "wikibooks"},
                {"page_id": 50, "title": "Cookbook:Knife Skills", "source": "wikibooks"},
                {"page_id": 60, "title": "Cookbook:Sourdough Bread", "source": "wikibooks"},
            ],
        )

        with DataPackSearch(data_root=self.data_root) as s:
            rows = s.semantic("BETA holding a chef knife", bucket="techniques", limit=3)

        self.assertEqual(len(rows), 3)
        # Closest vector wins (cosine ~1.0), the 45° vector second
        # (~0.7071), the orthogonal one last (~0).
        self.assertEqual(rows[0]["page_id"], 50)
        self.assertEqual(rows[1]["page_id"], 60)
        self.assertEqual(rows[2]["page_id"], 42)
        self.assertAlmostEqual(rows[0]["score"], 1.0, places=4)
        self.assertAlmostEqual(rows[1]["score"], 0.7071, places=3)
        self.assertAlmostEqual(rows[2]["score"], 0.0, places=4)
        # Strictly decreasing score ordering — guards against the script
        # flipping argsort sign or skipping the np.argpartition top-k sort.
        for prev, curr in zip(rows, rows[1:]):
            self.assertGreater(prev["score"], curr["score"])

        # Semantic must lazy-load the model exactly once and pass the BGE
        # query prefix through to encode().
        self.assertEqual(_FakeSentenceTransformer.init_calls, 1)
        self.assertEqual(_FakeSentenceTransformer.encode_calls, 1)
        self.assertTrue(
            any(
                "Represent this sentence for searching" in t
                for t in (_FakeSentenceTransformer.last_texts or [])
            ),
            "search.py did not prepend the BGE query prefix",
        )

    # ----------------------------------------------------------- 4. hybrid
    def test_hybrid_fuses_fts_and_semantic_signals(self) -> None:
        self._build_indexes()
        # Wikibooks FTS will strongly match page_id 50 (Knife Skills) on the
        # word "knife". The embedding fixture is rigged so the query (axis
        # 0 via the ALPHA sentinel) aligns with page_id 60 (Sourdough). RRF
        # should surface BOTH in the merged top-k.
        bucket_dir = self.data_root / "indexes" / "embeddings" / "recipes"
        _write_embeddings(
            bucket_dir,
            vectors=[
                [0.0, 1.0, 0.0, 0.0],  # axis 1 — apple pie (off-axis)
                [0.0, 0.0, 1.0, 0.0],  # axis 2 — knife skills (off-axis)
                [1.0, 0.0, 0.0, 0.0],  # axis 0 — sourdough (TARGET for ALPHA)
            ],
            metadata=[
                {"page_id": 42, "title": "Cookbook:Apple Pie", "source": "wikibooks"},
                {"page_id": 50, "title": "Cookbook:Knife Skills", "source": "wikibooks"},
                {"page_id": 60, "title": "Cookbook:Sourdough Bread", "source": "wikibooks"},
            ],
        )

        with DataPackSearch(data_root=self.data_root) as s:
            rows = s.hybrid("knife ALPHA", bucket="recipes", limit=5)

        self.assertGreaterEqual(len(rows), 2)
        page_ids = {r.get("page_id") or r.get("id") for r in rows}
        # FTS-strong row (knife) and semantic-strong row (sourdough) both
        # present — proves RRF didn't silently drop one signal.
        self.assertIn(50, page_ids)
        self.assertIn(60, page_ids)

        # Public shape: ``score`` is the fused RRF value, internal
        # bookkeeping keys are stripped.
        for r in rows:
            self.assertIn("score", r)
            self.assertIsInstance(r["score"], float)
            self.assertNotIn("_fused", r)
            self.assertNotIn("_fts", r)
            self.assertNotIn("_sem", r)

        # Fused score must be strictly decreasing in the returned order.
        for prev, curr in zip(rows, rows[1:]):
            self.assertGreaterEqual(prev["score"], curr["score"])

    # -------------------------------------------------------- 5. missing index
    def test_missing_index_raises_filenotfounderror(self) -> None:
        # Both DBs absent → SQLite-missing message comes first.
        with self.assertRaises(FileNotFoundError) as ctx:
            DataPackSearch(data_root=self.data_root)
        self.assertIn("SQLite", str(ctx.exception))
        self.assertIn("lariat_data.db", str(ctx.exception))

        # Build SQLite only; FTS still missing.
        _build_input_root_for_search(self.input_root)
        build_sqlite_index.build(
            input_root=self.input_root,
            output_dir=self.data_root / "indexes" / "sqlite",
            force=False,
        )
        with self.assertRaises(FileNotFoundError) as ctx:
            DataPackSearch(data_root=self.data_root)
        self.assertIn("FTS", str(ctx.exception))
        self.assertIn("lariat_fts.db", str(ctx.exception))

    # -------------------------------------------------- 6. context manager close
    def test_context_manager_closes_connections(self) -> None:
        import sqlite3
        self._build_indexes()
        with DataPackSearch(data_root=self.data_root) as s:
            rows = s.fts("apple", source="usda", limit=1)
            self.assertEqual(len(rows), 1)

        # After __exit__ the FTS connection is closed; another fts() call
        # must fail. sqlite3 raises ProgrammingError on a closed connection.
        with self.assertRaises(sqlite3.ProgrammingError):
            s.fts("apple", source="usda", limit=1)


if __name__ == "__main__":
    unittest.main()
