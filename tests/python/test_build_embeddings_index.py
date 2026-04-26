"""Smoke tests for ``scripts.datapack.build_embeddings_index``.

We mock ``sentence_transformers.SentenceTransformer`` BEFORE importing the
script's ``build()`` so the real model never loads (would download
~134 MB of BGE weights and pull torch.mps onto the test path). The fake
encoder returns deterministic L2-normalized float32 vectors of a fixed
dimension and tracks how many times ``encode()`` is called.

  1. Happy path — all four buckets populated, vectors.npy + metadata.jsonl
     + manifest.json shapes line up, manifest's ``input_sha256`` matches
     the source DB sha.
  2. Empty bucket placeholder fix — when a bucket has zero rows, vectors.npy
     and metadata.jsonl are still created (placeholders) and the second
     ``build()`` call short-circuits (manifest mtime unchanged, encoder
     not invoked).
  3. Idempotent skip — second build with ``force=False`` does not re-encode.
  4. ``force=True`` rebuild — re-encodes even though sha hasn't moved.
  5. Multi-bucket call — ``buckets=("recipes", "techniques")`` populates
     both bucket dirs.
  6. Model id change triggers rebuild — re-encodes when ``model_id``
     differs from the on-disk manifest.
"""

from __future__ import annotations

import json
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ---------------------------------------------------------------------------
# Fake SentenceTransformer — installed into sys.modules BEFORE the script
# runs build(). The script does ``from sentence_transformers import
# SentenceTransformer`` lazily inside build(), so this stub is what it
# resolves to at call time.
# ---------------------------------------------------------------------------


_DIMS = 8


class _FakeSentenceTransformer:
    """Deterministic stand-in for sentence_transformers.SentenceTransformer.

    ``encode()`` returns a float32 array of shape ``(len(texts), _DIMS)``
    where row ``i`` is a unit vector in dimension ``i % _DIMS`` — keeps the
    output L2-normalized (the script asserts ``normalize_embeddings=True``).
    Class-level counters let tests check whether the encoder was invoked.
    """

    init_calls = 0
    encode_calls = 0
    encode_total_texts = 0
    last_model_id: str | None = None

    def __init__(self, model_id: str, device: str | None = None) -> None:
        type(self).init_calls += 1
        type(self).last_model_id = model_id
        self.model_id = model_id
        self.device = device or "cpu"

    def encode(
        self,
        texts: list[str],
        batch_size: int = 32,
        normalize_embeddings: bool = True,
        show_progress_bar: bool = False,
        convert_to_numpy: bool = True,
    ) -> Any:
        import numpy as np
        type(self).encode_calls += 1
        type(self).encode_total_texts += len(texts)
        n = len(texts)
        out = np.zeros((n, _DIMS), dtype=np.float32)
        for i in range(n):
            out[i, i % _DIMS] = 1.0
        return out

    @classmethod
    def reset(cls) -> None:
        cls.init_calls = 0
        cls.encode_calls = 0
        cls.encode_total_texts = 0
        cls.last_model_id = None


# Install the fake module BEFORE we import build_embeddings_index, so the
# lazy ``from sentence_transformers import SentenceTransformer`` resolves
# to our stub. We keep a handle in case any test wants to confirm.
_fake_st_module = types.ModuleType("sentence_transformers")
_fake_st_module.SentenceTransformer = _FakeSentenceTransformer  # type: ignore[attr-defined]
sys.modules["sentence_transformers"] = _fake_st_module


# Stub torch's device detection so build() doesn't probe MPS/CUDA on the
# test host. Use a tiny module so even systems without torch installed pass.
class _FakeBackends:
    class mps:
        @staticmethod
        def is_available() -> bool:
            return False


class _FakeCuda:
    @staticmethod
    def is_available() -> bool:
        return False


_fake_torch_module = types.ModuleType("torch")
_fake_torch_module.backends = _FakeBackends  # type: ignore[attr-defined]
_fake_torch_module.cuda = _FakeCuda  # type: ignore[attr-defined]
sys.modules["torch"] = _fake_torch_module


from scripts.datapack import build_embeddings_index, build_sqlite_index  # noqa: E402

# Reuse the fixture data + fs helpers the T1 tests exercise. This module
# ships its own extended wikibooks variant via ``_build_full_input_root``,
# so the base ``_build_input_root`` from the helpers module isn't imported.
from tests.python._datapack_test_helpers import (  # noqa: E402
    FDA_FOOD_CODE_SECTIONS,
    OFF_ALLERGENS_SUMMARY,
    OFF_PRODUCTS,
    USDA_FOODS,
    USDA_NUTRIENTS,
    _sha256_file,
    _write_json,
    _write_jsonl,
)


# ---------------------------------------------------------------------------
# Wikibooks fixture covering all four bucket cases
# ---------------------------------------------------------------------------


# Page 42 (Apple Pie) — already in T1 fixture, has "Recipes" category, hits
# the recipes bucket.
# Page 43 — redirect, excluded everywhere.
# Page 100 — a Cookbook page with no recipe/safety markers → techniques.
# Page 200 — explicit safety category → safety bucket (alongside FDA sections).
WIKIBOOKS_PAGES_FULL: list[dict[str, Any]] = [
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
    {
        "page_id": 100,
        "title": "Cookbook:Knife Skills",
        "slug": "Cookbook:Knife_Skills",
        "is_redirect": False,
        "redirect_target": None,
        "categories": ["Cooking techniques", "Kitchen tools"],
        "wikitext_length": 1500,
        "plain_text_summary": "Holding a chef's knife with a pinch grip for control and safety.",
        "source_url": "https://en.wikibooks.org/wiki/Cookbook:Knife_Skills",
    },
    {
        "page_id": 200,
        "title": "Cookbook:Food Safety Basics",
        "slug": "Cookbook:Food_Safety_Basics",
        "is_redirect": False,
        "redirect_target": None,
        "categories": ["Food safety", "HACCP"],
        "wikitext_length": 800,
        "plain_text_summary": "Cold holding, hot holding, and time as a control for TCS foods.",
        "source_url": "https://en.wikibooks.org/wiki/Cookbook:Food_Safety_Basics",
    },
]


def _build_full_input_root(input_root: Path) -> dict[str, Path]:
    """Variant of T1's ``_build_input_root`` that ships the extended
    wikibooks page set — needed so the techniques bucket has matching rows."""
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
    _write_jsonl(paths["wikibooks_pages"], WIKIBOOKS_PAGES_FULL)
    _write_jsonl(paths["fda_food_code_sections"], FDA_FOOD_CODE_SECTIONS)
    return paths


def _build_empty_corpus_input_root(input_root: Path) -> dict[str, Path]:
    """Variant where wikibooks + FDA sections are empty so every NON-USDA
    bucket has zero rows. Lets us exercise the empty-bucket code path.
    USDA still has rows because the ingredients bucket isn't part of the
    empty test."""
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
    _write_jsonl(paths["wikibooks_pages"], [])
    _write_jsonl(paths["fda_food_code_sections"], [])
    return paths


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class BuildEmbeddingsIndexSmokeTests(unittest.TestCase):

    def setUp(self) -> None:
        _FakeSentenceTransformer.reset()
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.input_root = root / "normalized"
        self.sqlite_dir = root / "indexes" / "sqlite"
        self.embeddings_dir = root / "indexes" / "embeddings"
        self.input_root.mkdir(parents=True)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    # ------------------------------------------------------------------ helpers

    def _build_sqlite(self, builder=_build_full_input_root) -> Path:
        builder(self.input_root)
        build_sqlite_index.build(
            input_root=self.input_root,
            output_dir=self.sqlite_dir,
            force=False,
        )
        return self.sqlite_dir / "lariat_data.db"

    def _bucket_dir(self, bucket: str) -> Path:
        return self.embeddings_dir / bucket

    def _read_manifest(self, bucket: str) -> dict[str, Any]:
        return json.loads(
            (self._bucket_dir(bucket) / "manifest.json").read_text(encoding="utf-8")
        )

    def _count_metadata_lines(self, bucket: str) -> int:
        path = self._bucket_dir(bucket) / "metadata.jsonl"
        with open(path, "r", encoding="utf-8") as f:
            return sum(1 for line in f if line.strip())

    # -------------------------------------------------------------- test cases

    def test_happy_path_all_buckets(self) -> None:
        import numpy as np

        input_db = self._build_sqlite()
        result = build_embeddings_index.build(
            input_db=input_db,
            output_root=self.embeddings_dir,
            buckets=("recipes", "techniques", "safety", "ingredients"),
            model_id="fake-model",
            batch_size=4,
            force=False,
        )

        # Encoder was called for every non-empty bucket, model loaded once.
        self.assertEqual(_FakeSentenceTransformer.init_calls, 1)
        self.assertEqual(_FakeSentenceTransformer.last_model_id, "fake-model")
        self.assertGreaterEqual(_FakeSentenceTransformer.encode_calls, 4)

        # Source DB sha that build() recorded must match the file on disk.
        input_sha = _sha256_file(input_db)
        self.assertEqual(result["input_sha256"], input_sha)

        # Each bucket: vectors.npy + metadata.jsonl + manifest.json all
        # populated, dims/rows agree, manifest sha matches source DB.
        for bucket in ("recipes", "techniques", "safety", "ingredients"):
            d = self._bucket_dir(bucket)
            vectors_path = d / "vectors.npy"
            metadata_path = d / "metadata.jsonl"
            manifest_path = d / "manifest.json"
            self.assertTrue(vectors_path.exists(), f"{bucket}: vectors.npy missing")
            self.assertTrue(metadata_path.exists(), f"{bucket}: metadata.jsonl missing")
            self.assertTrue(manifest_path.exists(), f"{bucket}: manifest.json missing")

            vecs = np.load(vectors_path)
            self.assertEqual(vecs.dtype, np.float32, f"{bucket}: dtype != float32")
            self.assertEqual(
                vecs.ndim, 2, f"{bucket}: vectors must be 2-D when non-empty"
            )
            n, dims = vecs.shape
            self.assertGreater(n, 0, f"{bucket}: expected at least one vector")
            self.assertEqual(dims, _DIMS, f"{bucket}: dims must match fake encoder")

            # metadata line count == vector row count.
            self.assertEqual(
                self._count_metadata_lines(bucket),
                n,
                f"{bucket}: metadata rows != vector rows",
            )

            # Each metadata row parses + carries row_id + matches order.
            with open(metadata_path, "r", encoding="utf-8") as f:
                metas = [json.loads(line) for line in f if line.strip()]
            self.assertEqual(len(metas), n)
            for i, m in enumerate(metas):
                self.assertEqual(m["row_id"], i, f"{bucket}: row_id out of order")
                self.assertIn("source", m)
                self.assertIn("bucket", m)
                self.assertEqual(m["bucket"], bucket)

            manifest = self._read_manifest(bucket)
            self.assertEqual(manifest["bucket"], bucket)
            self.assertEqual(manifest["model_id"], "fake-model")
            self.assertEqual(manifest["input_sha256"], input_sha)
            self.assertEqual(manifest["rows"], n)
            self.assertEqual(manifest["dims"], dims)

        # Sanity: recipes finds Apple Pie, techniques finds Knife Skills,
        # safety includes FDA sections, ingredients carries the USDA foods.
        recipe_titles = self._collect_meta_field("recipes", "title")
        self.assertIn("Cookbook:Apple Pie", recipe_titles)
        self.assertNotIn("Cookbook:Apple Tart", recipe_titles)  # redirect filtered

        tech_titles = self._collect_meta_field("techniques", "title")
        self.assertIn("Cookbook:Knife Skills", tech_titles)

        # Safety: FDA section_ids show up as expected.
        safety_section_ids = [
            m.get("section_id")
            for m in self._read_metadata("safety")
            if m.get("source") == "fda_food_code"
        ]
        self.assertIn("3-501.16", safety_section_ids)
        self.assertIn("Annex-3", safety_section_ids)
        # And the wikibooks safety page rolls in too.
        safety_titles = [
            m.get("title")
            for m in self._read_metadata("safety")
            if m.get("source") == "wikibooks"
        ]
        self.assertIn("Cookbook:Food Safety Basics", safety_titles)

        ing_fdc_ids = [m.get("fdc_id") for m in self._read_metadata("ingredients")]
        self.assertEqual(
            sorted(ing_fdc_ids),
            sorted(f["fdc_id"] for f in USDA_FOODS),
        )

    def test_empty_bucket_writes_placeholders_and_short_circuits(self) -> None:
        import numpy as np

        input_db = self._build_sqlite(builder=_build_empty_corpus_input_root)

        # Build only the recipes bucket — its source (wikibooks recipes)
        # is empty in this fixture, so we hit the n=0 path.
        build_embeddings_index.build(
            input_db=input_db,
            output_root=self.embeddings_dir,
            buckets=("recipes",),
            model_id="fake-model",
            batch_size=4,
            force=False,
        )

        d = self._bucket_dir("recipes")
        vectors_path = d / "vectors.npy"
        metadata_path = d / "metadata.jsonl"
        manifest_path = d / "manifest.json"

        # Placeholders exist (this is the bug-fix being validated).
        self.assertTrue(vectors_path.exists(), "vectors.npy placeholder missing")
        self.assertTrue(metadata_path.exists(), "metadata.jsonl placeholder missing")
        self.assertTrue(manifest_path.exists(), "manifest.json missing")

        # vectors.npy is a valid empty numpy array.
        empty_vecs = np.load(vectors_path)
        self.assertEqual(empty_vecs.shape, (0,))
        self.assertEqual(empty_vecs.dtype, np.float32)

        # metadata.jsonl is zero lines (zero bytes is acceptable).
        self.assertEqual(self._count_metadata_lines("recipes"), 0)

        manifest = self._read_manifest("recipes")
        self.assertEqual(manifest["rows"], 0)
        self.assertIsNone(manifest["dims"])
        self.assertEqual(manifest["bucket"], "recipes")

        # Capture state before the second call. The encoder was called 0
        # times so far (no rows to encode); we just need to confirm
        # short-circuit on call #2.
        encode_calls_before = _FakeSentenceTransformer.encode_calls
        init_calls_before = _FakeSentenceTransformer.init_calls
        manifest_mtime_before = manifest_path.stat().st_mtime_ns
        time.sleep(0.01)  # make a rebuild move the mtime if it happens

        # Second call — must short-circuit, NOT re-write the manifest.
        build_embeddings_index.build(
            input_db=input_db,
            output_root=self.embeddings_dir,
            buckets=("recipes",),
            model_id="fake-model",
            batch_size=4,
            force=False,
        )

        self.assertEqual(
            manifest_path.stat().st_mtime_ns,
            manifest_mtime_before,
            "empty-bucket manifest was rewritten on the second build — "
            "the placeholder fix is not actually short-circuiting",
        )
        # Encoder should not have been re-invoked.
        self.assertEqual(_FakeSentenceTransformer.encode_calls, encode_calls_before)
        # Model load is the up-front load that build() does once per call;
        # the bucket-level skip should prevent a fresh init AND a fresh
        # encode. Since all requested buckets are up to date, build()
        # short-circuits before loading the model — init_calls stays put.
        self.assertEqual(_FakeSentenceTransformer.init_calls, init_calls_before)

    def test_idempotent_skip_on_populated_bucket(self) -> None:
        input_db = self._build_sqlite()
        build_embeddings_index.build(
            input_db=input_db,
            output_root=self.embeddings_dir,
            buckets=("recipes",),
            model_id="fake-model",
            batch_size=4,
            force=False,
        )
        encode_calls_after_first = _FakeSentenceTransformer.encode_calls
        init_calls_after_first = _FakeSentenceTransformer.init_calls
        self.assertGreaterEqual(encode_calls_after_first, 1)

        manifest_path = self._bucket_dir("recipes") / "manifest.json"
        mtime_before = manifest_path.stat().st_mtime_ns
        time.sleep(0.01)

        build_embeddings_index.build(
            input_db=input_db,
            output_root=self.embeddings_dir,
            buckets=("recipes",),
            model_id="fake-model",
            batch_size=4,
            force=False,
        )
        # No new encode, no new model load.
        self.assertEqual(_FakeSentenceTransformer.encode_calls, encode_calls_after_first)
        self.assertEqual(_FakeSentenceTransformer.init_calls, init_calls_after_first)
        self.assertEqual(manifest_path.stat().st_mtime_ns, mtime_before)

    def test_force_true_rebuilds_even_with_unchanged_input(self) -> None:
        input_db = self._build_sqlite()
        build_embeddings_index.build(
            input_db=input_db,
            output_root=self.embeddings_dir,
            buckets=("recipes",),
            model_id="fake-model",
            batch_size=4,
            force=False,
        )
        first_manifest = self._read_manifest("recipes")
        encode_calls_after_first = _FakeSentenceTransformer.encode_calls
        time.sleep(0.01)

        build_embeddings_index.build(
            input_db=input_db,
            output_root=self.embeddings_dir,
            buckets=("recipes",),
            model_id="fake-model",
            batch_size=4,
            force=True,
        )
        second_manifest = self._read_manifest("recipes")

        # input_sha256 unchanged (DB content is the same), but encoder
        # must have run again under force.
        self.assertEqual(
            second_manifest["input_sha256"], first_manifest["input_sha256"]
        )
        self.assertGreater(_FakeSentenceTransformer.encode_calls, encode_calls_after_first)

    def test_multiple_buckets_in_one_call(self) -> None:
        input_db = self._build_sqlite()
        build_embeddings_index.build(
            input_db=input_db,
            output_root=self.embeddings_dir,
            buckets=("recipes", "techniques"),
            model_id="fake-model",
            batch_size=4,
            force=False,
        )
        for bucket in ("recipes", "techniques"):
            d = self._bucket_dir(bucket)
            self.assertTrue((d / "vectors.npy").exists(), f"{bucket}: no vectors.npy")
            self.assertTrue((d / "metadata.jsonl").exists(), f"{bucket}: no metadata.jsonl")
            self.assertTrue((d / "manifest.json").exists(), f"{bucket}: no manifest.json")
            self.assertGreater(self._read_manifest(bucket)["rows"], 0)

    def test_model_id_change_triggers_rebuild(self) -> None:
        input_db = self._build_sqlite()
        build_embeddings_index.build(
            input_db=input_db,
            output_root=self.embeddings_dir,
            buckets=("recipes",),
            model_id="model-A",
            batch_size=4,
            force=False,
        )
        self.assertEqual(self._read_manifest("recipes")["model_id"], "model-A")
        encode_calls_after_first = _FakeSentenceTransformer.encode_calls
        time.sleep(0.01)

        # Different model_id, no force — must rebuild because the
        # _is_up_to_date() guard checks model_id.
        build_embeddings_index.build(
            input_db=input_db,
            output_root=self.embeddings_dir,
            buckets=("recipes",),
            model_id="model-B",
            batch_size=4,
            force=False,
        )
        self.assertEqual(self._read_manifest("recipes")["model_id"], "model-B")
        self.assertGreater(_FakeSentenceTransformer.encode_calls, encode_calls_after_first)

    # ----------------------------------------------------------- small helpers

    def _read_metadata(self, bucket: str) -> list[dict[str, Any]]:
        path = self._bucket_dir(bucket) / "metadata.jsonl"
        with open(path, "r", encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]

    def _collect_meta_field(self, bucket: str, field: str) -> list[Any]:
        return [m.get(field) for m in self._read_metadata(bucket)]


if __name__ == "__main__":
    unittest.main()
