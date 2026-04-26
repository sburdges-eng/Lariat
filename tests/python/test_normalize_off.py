"""Unit tests for scripts.datapack.normalize_off.

Builds small synthetic OFF TSV fixtures and runs the normalizer against
them. Uses ``chunk_rows=2`` everywhere so the multi-chunk merge path is
exercised on every test.

Spec test coverage:
  1. Happy path — 5 products with various allergen sets, all emit, allergens
     aggregate correctly.
  2. Missing `code` → skipped, counted in `skipped_no_code`.
  3. Missing `product_name` → skipped, counted in `skipped_no_name`.
  4. Duplicate code → only first kept, counted in `duplicate_codes_skipped`.
  5. Empty allergens_tags / traces_tags → arrays in output are `[]`, NOT
     counted in aggregations.
  6. Sort order — output sorted by `code` ascending, even on reverse-sorted
     input.
  7. Idempotency — second run skips work; manifest sha256 unchanged.
  8. `--force` — bypasses skip and rebuilds byte-identically (modulo
     `generated_at`).
  9. Tied/duplicate allergen tokens within one product — counted only once
     per product.
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

from scripts.datapack.normalize_off import (  # noqa: E402
    main as normalize_main,
    normalize,
)


# ---------------------------------------------------------------------------
# Fixture builder
# ---------------------------------------------------------------------------

# Subset of OFF columns sufficient to exercise the normalizer. Order roughly
# matches the real dump but is not load-bearing — header resolution is
# dynamic, so any column ordering works as long as all candidate names are
# present.
HEADER: list[str] = [
    "code",
    "url",
    "product_name",
    "brands",
    "categories_tags",
    "countries_en",
    "ingredients_text",
    "allergens",          # canonical en: form (per current OFF dump)
    "traces_tags",
    "serving_size",
    "nutriscore_grade",
    "brand_owner",
]


def _make_row(
    *,
    code: str = "",
    url: str = "",
    product_name: str = "",
    brands: str = "",
    categories_tags: str = "",
    countries_en: str = "",
    ingredients_text: str = "",
    allergens: str = "",
    traces_tags: str = "",
    serving_size: str = "",
    nutriscore_grade: str = "",
    brand_owner: str = "",
) -> list[str]:
    return [
        code,
        url,
        product_name,
        brands,
        categories_tags,
        countries_en,
        ingredients_text,
        allergens,
        traces_tags,
        serving_size,
        nutriscore_grade,
        brand_owner,
    ]


def _write_tsv(path: Path, header: list[str], rows: list[list[str]]) -> None:
    """Write a tab-separated values file. None of the test inputs contain
    embedded tabs or newlines, so naive join is fine."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["\t".join(header)]
    for row in rows:
        for cell in row:
            assert "\t" not in cell, f"fixture cell has TAB: {cell!r}"
            assert "\n" not in cell, f"fixture cell has NL: {cell!r}"
        lines.append("\t".join(row))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _read_jsonl(path: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class NormalizeOFFTest(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_root = Path(self._tmp.name)
        self.input_file = self.tmp_root / "openfoodfacts_products.csv"
        self.output_dir = self.tmp_root / "out"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _run(self, *, force: bool = False) -> dict:
        return normalize(
            input_file=self.input_file,
            output_dir=self.output_dir,
            force=force,
            chunk_rows=2,
        )

    # --- 1. Happy path -------------------------------------------------------
    def test_happy_path_five_products(self) -> None:
        rows = [
            _make_row(
                code="0000000000017",
                url="https://world.openfoodfacts.org/product/17",
                product_name="Chocolate Bar",
                brands="ACME",
                categories_tags="en:snacks,en:chocolates",
                countries_en="United States",
                ingredients_text="Cocoa, sugar, milk",
                allergens="en:milk,en:soybeans",
                traces_tags="en:nuts",
                serving_size="30g",
                nutriscore_grade="d",
                brand_owner="ACME Corp",
            ),
            _make_row(
                code="0000000000022",
                url="https://world.openfoodfacts.org/product/22",
                product_name="Cheddar Cheese",
                brands="DairyCo",
                categories_tags="en:dairy,en:cheese,en:cheddar",
                countries_en="United Kingdom",
                ingredients_text="Pasteurized milk, salt, cultures",
                allergens="en:milk",
                traces_tags="",
                serving_size="30g",
                nutriscore_grade="c",
                brand_owner="DairyCo Ltd",
            ),
            _make_row(
                code="0000000000035",
                url="https://world.openfoodfacts.org/product/35",
                product_name="Wheat Crackers",
                brands="CrispCo",
                categories_tags="en:snacks,en:crackers",
                countries_en="France",
                ingredients_text="Wheat flour, salt, yeast",
                allergens="en:gluten",
                traces_tags="en:milk,en:eggs",
                serving_size="20g",
                nutriscore_grade="b",
                brand_owner="",
            ),
            _make_row(
                code="0000000000043",
                url="https://world.openfoodfacts.org/product/43",
                product_name="Plain Apple",
                brands="",
                categories_tags="en:fruits",
                countries_en="Spain",
                ingredients_text="Apple",
                allergens="",
                traces_tags="",
                serving_size="",
                nutriscore_grade="a",
                brand_owner="",
            ),
            _make_row(
                code="0000000000058",
                url="https://world.openfoodfacts.org/product/58",
                product_name="Peanut Butter",
                brands="NutCo",
                categories_tags="en:spreads,en:peanut-butters",
                countries_en="United States",
                ingredients_text="Peanuts, salt",
                allergens="en:nuts,en:peanuts",
                traces_tags="en:nuts,en:soybeans",
                serving_size="32g",
                nutriscore_grade="c",
                brand_owner="NutCo Inc",
            ),
        ]
        _write_tsv(self.input_file, HEADER, rows)
        manifest = self._run()

        products = _read_jsonl(self.output_dir / "branded_products.jsonl")
        self.assertEqual(len(products), 5)

        # Schema fields
        expected_fields = {
            "code", "product_name", "brands", "brand_owner",
            "categories_tags", "allergens_tags", "traces_tags",
            "ingredients_text", "serving_size", "nutriscore_grade",
            "countries_en", "source_url",
        }
        for p in products:
            self.assertEqual(set(p.keys()), expected_fields, p)

        # Spot-check a couple of rows
        by_code = {p["code"]: p for p in products}
        choc = by_code["0000000000017"]
        self.assertEqual(choc["product_name"], "Chocolate Bar")
        self.assertEqual(choc["categories_tags"], ["en:snacks", "en:chocolates"])
        self.assertEqual(choc["allergens_tags"], ["en:milk", "en:soybeans"])
        self.assertEqual(choc["traces_tags"], ["en:nuts"])
        self.assertEqual(choc["nutriscore_grade"], "d")
        self.assertEqual(choc["brand_owner"], "ACME Corp")

        apple = by_code["0000000000043"]
        self.assertEqual(apple["allergens_tags"], [])
        self.assertEqual(apple["traces_tags"], [])
        self.assertIsNone(apple["serving_size"])
        self.assertIsNone(apple["brand_owner"])
        self.assertIsNone(apple["brands"])

        # allergens.json aggregation
        summary = json.loads(
            (self.output_dir / "allergens.json").read_text(encoding="utf-8")
        )
        self.assertEqual(summary["total_products"], 5)
        # 4 of 5 products have allergens (apple has none).
        self.assertEqual(summary["products_with_allergens"], 4)
        # en:milk appears in choc + cheese -> 2
        self.assertEqual(summary["allergens"]["en:milk"], 2)
        self.assertEqual(summary["allergens"]["en:soybeans"], 1)
        self.assertEqual(summary["allergens"]["en:gluten"], 1)
        self.assertEqual(summary["allergens"]["en:nuts"], 1)
        self.assertEqual(summary["allergens"]["en:peanuts"], 1)
        # traces: en:nuts in choc + peanut butter, en:milk in crackers,
        # en:eggs in crackers, en:soybeans in peanut butter
        self.assertEqual(summary["traces"]["en:nuts"], 2)
        self.assertEqual(summary["traces"]["en:milk"], 1)
        self.assertEqual(summary["traces"]["en:eggs"], 1)
        self.assertEqual(summary["traces"]["en:soybeans"], 1)
        # Sort order: count desc then key asc.
        allergen_items = list(summary["allergens"].items())
        for i in range(len(allergen_items) - 1):
            (k1, v1), (k2, v2) = allergen_items[i], allergen_items[i + 1]
            self.assertTrue(
                v1 > v2 or (v1 == v2 and k1 < k2),
                f"allergens not sorted at idx {i}: {(k1, v1)} -> {(k2, v2)}",
            )

        # Manifest counters
        self.assertEqual(manifest["row_counts"]["total_input"], 5)
        self.assertEqual(manifest["row_counts"]["emitted"], 5)
        self.assertEqual(manifest["row_counts"]["skipped_no_code"], 0)
        self.assertEqual(manifest["row_counts"]["skipped_no_name"], 0)
        self.assertEqual(manifest["row_counts"]["duplicate_codes_skipped"], 0)

    # --- 2. Missing code -----------------------------------------------------
    def test_missing_code_is_skipped(self) -> None:
        rows = [
            _make_row(code="0000000000010", product_name="Has Code"),
            _make_row(code="", product_name="No Code"),
            _make_row(code="   ", product_name="Whitespace Code"),
            _make_row(code="0000000000020", product_name="Also Has Code"),
        ]
        _write_tsv(self.input_file, HEADER, rows)
        manifest = self._run()
        products = _read_jsonl(self.output_dir / "branded_products.jsonl")
        self.assertEqual([p["code"] for p in products],
                         ["0000000000010", "0000000000020"])
        self.assertEqual(manifest["row_counts"]["skipped_no_code"], 2)
        self.assertEqual(manifest["row_counts"]["skipped_no_name"], 0)
        self.assertEqual(manifest["row_counts"]["emitted"], 2)
        self.assertEqual(manifest["row_counts"]["total_input"], 4)

    # --- 3. Missing product_name --------------------------------------------
    def test_missing_product_name_is_skipped(self) -> None:
        rows = [
            _make_row(code="0000000000010", product_name="Has Name"),
            _make_row(code="0000000000011", product_name=""),
            _make_row(code="0000000000012", product_name="   "),
            _make_row(code="0000000000020", product_name="Other Name"),
        ]
        _write_tsv(self.input_file, HEADER, rows)
        manifest = self._run()
        products = _read_jsonl(self.output_dir / "branded_products.jsonl")
        self.assertEqual([p["code"] for p in products],
                         ["0000000000010", "0000000000020"])
        self.assertEqual(manifest["row_counts"]["skipped_no_code"], 0)
        self.assertEqual(manifest["row_counts"]["skipped_no_name"], 2)
        self.assertEqual(manifest["row_counts"]["emitted"], 2)
        self.assertEqual(manifest["row_counts"]["total_input"], 4)

    # --- 4. Duplicate code → first wins -------------------------------------
    def test_duplicate_code_first_wins(self) -> None:
        rows = [
            _make_row(code="0000000000010", product_name="First Wins",
                      allergens="en:milk"),
            _make_row(code="0000000000020", product_name="Other"),
            _make_row(code="0000000000010", product_name="Second Loses",
                      allergens="en:gluten"),
            _make_row(code="0000000000010", product_name="Third Loses",
                      allergens="en:eggs"),
        ]
        _write_tsv(self.input_file, HEADER, rows)
        manifest = self._run()
        products = _read_jsonl(self.output_dir / "branded_products.jsonl")
        self.assertEqual(len(products), 2)
        by_code = {p["code"]: p for p in products}
        # First occurrence wins.
        self.assertEqual(by_code["0000000000010"]["product_name"], "First Wins")
        self.assertEqual(by_code["0000000000010"]["allergens_tags"], ["en:milk"])
        self.assertEqual(manifest["row_counts"]["duplicate_codes_skipped"], 2)
        self.assertEqual(manifest["row_counts"]["emitted"], 2)
        self.assertEqual(manifest["row_counts"]["total_input"], 4)
        # Allergen counts: only en:milk should appear (from First Wins).
        summary = json.loads(
            (self.output_dir / "allergens.json").read_text(encoding="utf-8")
        )
        self.assertEqual(summary["allergens"], {"en:milk": 1})
        self.assertNotIn("en:gluten", summary["allergens"])
        self.assertNotIn("en:eggs", summary["allergens"])

    # --- 4b. Duplicate code across chunks → first wins ---------------------
    def test_duplicate_code_across_chunks_first_wins(self) -> None:
        """Reviewer note: test 4 covers within-chunk dedup, test 6 covers
        reverse-sort across chunks. This test covers BOTH paths together —
        same `code` at row 0 and row 5 with chunk_rows=2 puts the first
        occurrence in chunk 0 and the duplicate in chunk 2, so the
        first-occurrence-wins rule is enforced by the merge step (chunk_idx
        secondary key in heapq.merge), not by within-chunk sorting."""
        rows = [
            _make_row(code="0000000000010", product_name="First Wins (chunk 0)",
                      allergens="en:milk"),
            _make_row(code="0000000000020", product_name="Other 1"),
            _make_row(code="0000000000030", product_name="Other 2"),
            _make_row(code="0000000000040", product_name="Other 3"),
            _make_row(code="0000000000050", product_name="Other 4"),
            _make_row(code="0000000000010", product_name="Dup Loses (chunk 2)",
                      allergens="en:gluten"),
        ]
        _write_tsv(self.input_file, HEADER, rows)
        manifest = self._run()
        products = _read_jsonl(self.output_dir / "branded_products.jsonl")
        # 6 input rows, 1 dup → 5 emitted.
        self.assertEqual(len(products), 5)
        by_code = {p["code"]: p for p in products}
        self.assertEqual(
            by_code["0000000000010"]["product_name"], "First Wins (chunk 0)"
        )
        self.assertEqual(
            by_code["0000000000010"]["allergens_tags"], ["en:milk"]
        )
        self.assertEqual(manifest["row_counts"]["duplicate_codes_skipped"], 1)
        self.assertEqual(manifest["row_counts"]["emitted"], 5)
        self.assertEqual(manifest["row_counts"]["total_input"], 6)
        # Allergen counts: only en:milk should appear (from First Wins).
        # The losing duplicate's en:gluten must NOT contribute.
        summary = json.loads(
            (self.output_dir / "allergens.json").read_text(encoding="utf-8")
        )
        self.assertEqual(summary["allergens"], {"en:milk": 1})
        self.assertNotIn("en:gluten", summary["allergens"])

    # --- 5. Empty allergens / traces ----------------------------------------
    def test_empty_tag_columns_emit_empty_arrays_and_skip_aggregation(self) -> None:
        rows = [
            _make_row(code="0000000000010", product_name="No Tags",
                      allergens="", traces_tags=""),
            _make_row(code="0000000000020", product_name="Whitespace Tags",
                      allergens="   ", traces_tags="\t  "),
            _make_row(code="0000000000030", product_name="Has One",
                      allergens="en:milk", traces_tags="en:nuts"),
        ]
        # Whitespace-only-tab is invalid in our TSV writer asserts; use plain
        # spaces only to keep the fixture writable.
        rows[1] = _make_row(code="0000000000020", product_name="Whitespace Tags",
                            allergens="   ", traces_tags="   ")
        _write_tsv(self.input_file, HEADER, rows)
        self._run()
        products = _read_jsonl(self.output_dir / "branded_products.jsonl")
        by_code = {p["code"]: p for p in products}
        self.assertEqual(by_code["0000000000010"]["allergens_tags"], [])
        self.assertEqual(by_code["0000000000010"]["traces_tags"], [])
        self.assertEqual(by_code["0000000000020"]["allergens_tags"], [])
        self.assertEqual(by_code["0000000000020"]["traces_tags"], [])
        summary = json.loads(
            (self.output_dir / "allergens.json").read_text(encoding="utf-8")
        )
        # Only the third product contributes to aggregation.
        self.assertEqual(summary["products_with_allergens"], 1)
        self.assertEqual(summary["allergens"], {"en:milk": 1})
        self.assertEqual(summary["traces"], {"en:nuts": 1})

    # --- 6. Reverse-sorted input still produces ascending output ------------
    def test_reverse_sorted_input_yields_ascending_output(self) -> None:
        rows = [
            _make_row(code="0000000000099", product_name="Z"),
            _make_row(code="0000000000088", product_name="Y"),
            _make_row(code="0000000000077", product_name="X"),
            _make_row(code="0000000000066", product_name="W"),
            _make_row(code="0000000000055", product_name="V"),
            _make_row(code="0000000000044", product_name="U"),
            _make_row(code="0000000000033", product_name="T"),
            _make_row(code="0000000000022", product_name="S"),
        ]
        _write_tsv(self.input_file, HEADER, rows)
        # chunk_rows=2 → 4 chunks, exercises the merge.
        self._run()
        products = _read_jsonl(self.output_dir / "branded_products.jsonl")
        codes = [p["code"] for p in products]
        self.assertEqual(codes, sorted(codes))
        self.assertEqual(codes, [
            "0000000000022", "0000000000033", "0000000000044",
            "0000000000055", "0000000000066", "0000000000077",
            "0000000000088", "0000000000099",
        ])

    # --- 7. Idempotency ------------------------------------------------------
    def test_idempotent_skip_on_second_run(self) -> None:
        rows = [
            _make_row(code="0000000000010", product_name="A", allergens="en:milk"),
            _make_row(code="0000000000020", product_name="B"),
        ]
        _write_tsv(self.input_file, HEADER, rows)
        m1 = self._run()
        sha_1 = m1["outputs"]["branded_products.jsonl"]["sha256"]
        a_sha_1 = m1["outputs"]["allergens.json"]["sha256"]
        # Second run, no force: must short-circuit and return unchanged sha.
        m2 = normalize(
            input_file=self.input_file,
            output_dir=self.output_dir,
            force=False,
            chunk_rows=2,
        )
        self.assertEqual(m2["outputs"]["branded_products.jsonl"]["sha256"], sha_1)
        self.assertEqual(m2["outputs"]["allergens.json"]["sha256"], a_sha_1)
        # And on disk: file shas match what manifest claims.
        on_disk = hashlib.sha256(
            (self.output_dir / "branded_products.jsonl").read_bytes()
        ).hexdigest()
        self.assertEqual(on_disk, sha_1)

    # --- 8. --force rebuilds byte-identically (modulo generated_at) ---------
    def test_force_rebuild_yields_identical_output_bytes(self) -> None:
        rows = [
            _make_row(code="0000000000020", product_name="B", allergens="en:nuts"),
            _make_row(code="0000000000010", product_name="A", allergens="en:milk"),
        ]
        _write_tsv(self.input_file, HEADER, rows)
        m1 = self._run()
        # Capture allergens.json content from m1 BEFORE the force rebuild
        # clobbers it. Reading it twice after m2 would be a placebo (always
        # equal regardless of determinism).
        s1 = json.loads(
            (self.output_dir / "allergens.json").read_text(encoding="utf-8")
        )
        m2 = normalize(
            input_file=self.input_file,
            output_dir=self.output_dir,
            force=True,
            chunk_rows=2,
        )
        # branded_products.jsonl has NO generated_at field — sha must match
        # exactly across runs.
        self.assertEqual(
            m1["outputs"]["branded_products.jsonl"]["sha256"],
            m2["outputs"]["branded_products.jsonl"]["sha256"],
        )
        self.assertEqual(
            m1["outputs"]["branded_products.jsonl"]["bytes"],
            m2["outputs"]["branded_products.jsonl"]["bytes"],
        )
        # allergens.json HAS generated_at, so its sha will differ. But the
        # underlying counts dicts must be identical between m1 (s1, captured
        # above) and m2 (s2, read now).
        s2 = json.loads(
            (self.output_dir / "allergens.json").read_text(encoding="utf-8")
        )
        self.assertEqual(s1["allergens"], s2["allergens"])
        self.assertEqual(s1["traces"], s2["traces"])
        self.assertEqual(s1["total_products"], s2["total_products"])
        self.assertEqual(s1["products_with_allergens"], s2["products_with_allergens"])

    # --- 9. Duplicate allergen tokens within one product -------------------
    def test_duplicate_allergen_tokens_within_row_count_once(self) -> None:
        rows = [
            _make_row(
                code="0000000000010",
                product_name="Triplicate Milk",
                # OFF can have duplicates from labelers; we MUST count once.
                allergens="en:milk,en:milk,en:milk",
                traces_tags="en:nuts,en:nuts",
            ),
            _make_row(
                code="0000000000020",
                product_name="Single Milk",
                allergens="en:milk",
                traces_tags="en:nuts",
            ),
        ]
        _write_tsv(self.input_file, HEADER, rows)
        self._run()
        products = _read_jsonl(self.output_dir / "branded_products.jsonl")
        # In the JSONL we preserve input order (and duplicates).
        first = next(p for p in products if p["code"] == "0000000000010")
        self.assertEqual(first["allergens_tags"], ["en:milk", "en:milk", "en:milk"])
        self.assertEqual(first["traces_tags"], ["en:nuts", "en:nuts"])

        summary = json.loads(
            (self.output_dir / "allergens.json").read_text(encoding="utf-8")
        )
        # Each product contributes 1 to the count (not 3, not 2).
        self.assertEqual(summary["allergens"]["en:milk"], 2)
        self.assertEqual(summary["traces"]["en:nuts"], 2)
        # Both products have allergens.
        self.assertEqual(summary["products_with_allergens"], 2)

    # --- Additional: manifest sha256 matches files ---------------------------
    def test_manifest_sha256_matches_files(self) -> None:
        rows = [
            _make_row(code="0000000000010", product_name="A", allergens="en:milk"),
            _make_row(code="0000000000020", product_name="B"),
        ]
        _write_tsv(self.input_file, HEADER, rows)
        self._run()
        manifest = json.loads(
            (self.output_dir / "manifest.json").read_text(encoding="utf-8")
        )
        for name in ("branded_products.jsonl", "allergens.json"):
            recorded = manifest["outputs"][name]["sha256"]
            actual = hashlib.sha256(
                (self.output_dir / name).read_bytes()
            ).hexdigest()
            self.assertEqual(recorded, actual, name)
            self.assertEqual(
                manifest["outputs"][name]["bytes"],
                (self.output_dir / name).stat().st_size,
            )

    # --- Additional: CLI main path -------------------------------------------
    def test_cli_main(self) -> None:
        rows = [
            _make_row(code="0000000000010", product_name="A"),
            _make_row(code="0000000000020", product_name="B"),
        ]
        _write_tsv(self.input_file, HEADER, rows)
        rc = normalize_main([
            "--input-file", str(self.input_file),
            "--output-dir", str(self.output_dir),
            "--chunk-rows", "2",
        ])
        self.assertEqual(rc, 0)
        self.assertTrue((self.output_dir / "branded_products.jsonl").exists())
        self.assertTrue((self.output_dir / "allergens.json").exists())
        self.assertTrue((self.output_dir / "manifest.json").exists())

    # --- Additional: header-fallback (allergens_tags column when present) ---
    def test_chunk_format_survives_json_backslash_t_sequences(self) -> None:
        """Regression: literal `\\t` in source strings (e.g. Windows paths in
        ingredients_text) get json-escaped to `\\\\t`, which an unescape pass
        would mangle into an invalid `\\<TAB>` sequence and break json.loads
        during the merge phase. Chunk format must round-trip cleanly without
        ANY escape/unescape on the json body."""
        rows = [
            _make_row(
                code="0000000000020",
                product_name="Backslash-t product",
                # ingredients_text contains literal `\t` — Python double-backslash
                # in source = single backslash + t in the actual string value.
                ingredients_text=r"path: C:\temp and a\tab",
            ),
            _make_row(
                code="0000000000021",
                product_name="Backslash-n product",
                ingredients_text=r"line\nbreak",
            ),
        ]
        _write_tsv(self.input_file, HEADER, rows)
        # _run uses chunk_rows=2 by default, which puts both rows in one chunk.
        # That still exercises the read path (chunk → merge → json.loads).
        self._run()
        products = _read_jsonl(self.output_dir / "branded_products.jsonl")
        self.assertEqual(len(products), 2)
        self.assertEqual(
            products[0]["ingredients_text"], r"path: C:\temp and a\tab"
        )
        self.assertEqual(products[1]["ingredients_text"], r"line\nbreak")

    def test_allergens_tags_column_preferred_when_present(self) -> None:
        """Older OFF dumps had `allergens_tags`. We must prefer it over
        `allergens` when both are present."""
        header = HEADER + ["allergens_tags"]
        # build rows: allergens column says 'en:milk', allergens_tags says
        # 'en:gluten'. The _tags column is preferred.
        row = _make_row(
            code="0000000000010", product_name="Both Cols",
            allergens="en:milk",
        ) + ["en:gluten"]
        _write_tsv(self.input_file, header, [row])
        self._run()
        products = _read_jsonl(self.output_dir / "branded_products.jsonl")
        self.assertEqual(products[0]["allergens_tags"], ["en:gluten"])


class NormalizeOFFProgressTest(unittest.TestCase):
    """F2: per-N-row progress logging on stderr.

    Patches ``sys.stderr.isatty`` to True and runs ``_stream_with_counters``
    with ``progress_every=2`` against a 5-row fixture. Asserts that at least
    one progress line shows up in stderr. The non-TTY case is also covered
    so the gate's silent path is locked in.
    """

    def setUp(self) -> None:
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_root = Path(self._tmp.name)
        self.input_file = self.tmp_root / "openfoodfacts_products.csv"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _write_five_rows(self) -> None:
        rows = [
            _make_row(code=f"000000000001{i}", product_name=f"Prod {i}")
            for i in range(5)
        ]
        _write_tsv(self.input_file, HEADER, rows)

    def _empty_counters(self) -> dict:
        return {
            "total_input": 0,
            "emitted": 0,
            "skipped_no_code": 0,
            "skipped_no_name": 0,
            "duplicate_codes_skipped": 0,
        }

    def test_progress_lines_emit_on_tty(self) -> None:
        import io
        from unittest.mock import patch

        from scripts.datapack.normalize_off import _stream_with_counters

        self._write_five_rows()
        captured = io.StringIO()
        captured.isatty = lambda: True  # type: ignore[method-assign]
        counters = self._empty_counters()
        with patch("scripts.datapack.normalize_off.sys.stderr", captured):
            yielded = list(
                _stream_with_counters(
                    self.input_file, counters, progress_every=2
                )
            )
        # 5 valid rows -> all yield.
        self.assertEqual(len(yielded), 5)
        out = captured.getvalue()
        self.assertIn("OFF:", out)
        self.assertIn("2 rows scanned", out)
        self.assertIn("4 rows scanned", out)
        self.assertIn("no-code", out)
        self.assertIn("no-name", out)

    def test_progress_silent_when_stderr_not_tty(self) -> None:
        import io
        from unittest.mock import patch

        from scripts.datapack.normalize_off import _stream_with_counters

        self._write_five_rows()
        captured = io.StringIO()
        captured.isatty = lambda: False  # type: ignore[method-assign]
        counters = self._empty_counters()
        with patch("scripts.datapack.normalize_off.sys.stderr", captured):
            list(
                _stream_with_counters(
                    self.input_file, counters, progress_every=2
                )
            )
        self.assertEqual(captured.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
