"""Unit tests for scripts.datapack.sanity_check.

All tests run against synthetic fixtures written into ``tmp_path``: there is
no dependency on the real 12+ GB datasets. We build a small ``data_root``
tree mirroring the production layout::

    <tmp>/lariat-data/normalized/usda/
                                    /openfoodfacts/
                                    /wikibooks/

and point the validator at it via ``--data-root``.

Spec test coverage (per task brief):

    1. all-green — proper manifest + matching sha + correct line count
    2. missing manifest for one source — that source SKIPs, others OK
    3. sha256 mismatch — manifest claims one sha, file has different content
    4. bytes mismatch — file size differs from manifest
    5. row count mismatch — manifest claims N, file has M ≠ N
    6. schema spot-check fails — JSONL row missing one of the expected keys
    7. malformed JSONL — one line is not valid JSON
    8. empty JSONL with manifest claiming row count > 0
    9. tail sampling on file with < 2×N lines — script samples all lines
    10. verbose mode — --verbose emits per-file lines
"""
from __future__ import annotations

import hashlib
import io
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.datapack.sanity_check import (  # noqa: E402
    _human_bytes,
    _iter_tail_lines,
    main as sanity_main,
)


# ---------------------------------------------------------------------------
# Sample-row factories — minimal rows that satisfy each schema.
# ---------------------------------------------------------------------------


def _usda_ingredient_row(fdc_id: int) -> dict:
    return {
        "fdc_id": fdc_id,
        "description": f"food-{fdc_id}",
        "data_type": "branded_food",
        "food_category_id": None,
        "food_category": None,
        "brand_owner": None,
        "gtin_upc": None,
        "ingredients": None,
        "serving_size": None,
        "serving_size_unit": None,
        "source_archive": "branded",
    }


def _usda_nutrient_row(fdc_id: int, nid: int) -> dict:
    return {
        "fdc_id": fdc_id,
        "nutrient_id": nid,
        "nutrient_name": "Energy",
        "unit_name": "KCAL",
        "amount": 100.0,
        "derivation_id": 1,
        "source_archive": "branded",
    }


def _off_product_row(code: str) -> dict:
    return {
        "code": code,
        "product_name": f"Product {code}",
        "brands": "",
        "brand_owner": "",
        "categories_tags": [],
        "allergens_tags": [],
        "traces_tags": [],
        "ingredients_text": "",
        "serving_size": "",
        "nutriscore_grade": "",
        "countries_en": "",
        "source_url": f"https://world.openfoodfacts.org/product/{code}",
    }


def _wikibooks_page_row(page_id: int) -> dict:
    return {
        "page_id": page_id,
        "title": f"Cookbook:Page {page_id}",
        "slug": f"Page {page_id}",
        "is_redirect": False,
        "redirect_target": None,
        "categories": [],
        "wikitext_length": 10,
        "plain_text_summary": "summary",
        "source_url": f"https://en.wikibooks.org/wiki/Cookbook:Page_{page_id}",
    }


# ---------------------------------------------------------------------------
# Fixture builder — writes a complete, internally consistent normalized tree.
# ---------------------------------------------------------------------------


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for buf in iter(lambda: f.read(1 << 20), b""):
            h.update(buf)
    return h.hexdigest()


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _build_usda(root: Path, *, n_ing: int = 3, n_nut: int = 4) -> Path:
    out = root / "normalized" / "usda"
    out.mkdir(parents=True, exist_ok=True)
    ing_path = out / "ingredients.jsonl"
    nut_path = out / "nutrients.jsonl"
    _write_jsonl(ing_path, [_usda_ingredient_row(i) for i in range(1, n_ing + 1)])
    _write_jsonl(nut_path, [_usda_nutrient_row(1, i) for i in range(1, n_nut + 1)])
    manifest = {
        "generated_at": "2026-04-25T19:42:00Z",
        "input_archives": ["foundation"],
        "input_files": {},
        "row_counts": {
            "ingredients": n_ing,
            "nutrients": n_nut,
            "by_archive": {},
        },
        "outputs": {
            "ingredients.jsonl": {
                "sha256": _sha256(ing_path),
                "bytes": ing_path.stat().st_size,
            },
            "nutrients.jsonl": {
                "sha256": _sha256(nut_path),
                "bytes": nut_path.stat().st_size,
            },
        },
    }
    _write_json(out / "manifest.json", manifest)
    return out


def _build_off(root: Path, *, n_products: int = 3) -> Path:
    out = root / "normalized" / "openfoodfacts"
    out.mkdir(parents=True, exist_ok=True)
    prod_path = out / "branded_products.jsonl"
    allergens_path = out / "allergens.json"
    _write_jsonl(
        prod_path,
        [_off_product_row(f"00000000000{i:02d}") for i in range(n_products)],
    )
    _write_json(allergens_path, {"allergens": {"en:milk": 1}, "traces": {"en:nuts": 2}})
    manifest = {
        "generated_at": "2026-04-25T22:15:00Z",
        "input_file": "/dev/null",
        "input_bytes": 0,
        "row_counts": {
            "total_input": n_products,
            "emitted": n_products,
            "skipped_no_code": 0,
            "skipped_no_name": 0,
            "duplicate_codes_skipped": 0,
        },
        "outputs": {
            "branded_products.jsonl": {
                "sha256": _sha256(prod_path),
                "bytes": prod_path.stat().st_size,
            },
            "allergens.json": {
                "sha256": _sha256(allergens_path),
                "bytes": allergens_path.stat().st_size,
            },
        },
    }
    _write_json(out / "manifest.json", manifest)
    return out


def _build_wikibooks(root: Path, *, n_pages: int = 2) -> Path:
    out = root / "normalized" / "wikibooks"
    out.mkdir(parents=True, exist_ok=True)
    pages_path = out / "cookbook_pages.jsonl"
    _write_jsonl(pages_path, [_wikibooks_page_row(i) for i in range(1, n_pages + 1)])
    manifest = {
        "generated_at": "2026-04-25T20:01:00Z",
        "input_file": "/dev/null",
        "input_bytes": 0,
        "row_counts": {
            "total_pages_scanned": n_pages,
            "cookbook_pages_emitted": n_pages,
            "cookbook_articles": n_pages,
            "cookbook_redirects": 0,
            "non_cookbook_skipped": 0,
            "parse_errors": 0,
        },
        "outputs": {
            "cookbook_pages.jsonl": {
                "sha256": _sha256(pages_path),
                "bytes": pages_path.stat().st_size,
            },
        },
    }
    _write_json(out / "manifest.json", manifest)
    return out


def _build_all(root: Path) -> tuple[Path, Path, Path]:
    return _build_usda(root), _build_off(root), _build_wikibooks(root)


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------


class SanityCheckTests(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._tmp.name)
        self.data_root = self.tmp_path / "lariat-data"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    # ---- helpers ----

    def _run(self, *extra: str) -> tuple[int, str, str]:
        """Run the CLI main() with --data-root pointing at the fixture."""
        argv = ["--data-root", str(self.data_root), *extra]
        out = io.StringIO()
        err = io.StringIO()
        old_out, old_err = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = out, err
        try:
            code = sanity_main(argv)
        finally:
            sys.stdout, sys.stderr = old_out, old_err
        return code, out.getvalue(), err.getvalue()

    # ---- 1. all-green ----

    def test_all_green(self) -> None:
        _build_all(self.data_root)
        code, stdout, _ = self._run()
        self.assertEqual(code, 0, stdout)
        # Every source row must be OK.
        for source in ("usda", "openfoodfacts", "wikibooks"):
            self.assertIn(source, stdout)
        self.assertEqual(stdout.count("✓ OK"), 3, stdout)
        self.assertNotIn("FAIL", stdout)

    # ---- 2. missing manifest ----

    def test_missing_manifest_skips(self) -> None:
        _build_usda(self.data_root)
        _build_wikibooks(self.data_root)
        # OFF intentionally not built.
        code, stdout, _ = self._run()
        self.assertEqual(code, 0, stdout)
        self.assertIn("○ SKIP", stdout)
        self.assertIn("manifest not found", stdout)
        self.assertEqual(stdout.count("✓ OK"), 2, stdout)

    # ---- 3. sha256 mismatch ----

    def test_sha256_mismatch_fails(self) -> None:
        _build_all(self.data_root)
        # Tamper: bytes-preserving overwrite of one ingredient row keeps
        # the byte size identical so we exercise the sha path, not the
        # bytes path.
        target = self.data_root / "normalized" / "usda" / "ingredients.jsonl"
        original = target.read_bytes()
        # Find a flippable byte and toggle a single character inside a row.
        # We replace the first 'a' with 'b' (or vice-versa) to keep length
        # identical but content different.
        replaced = original.replace(b"food-1", b"food-X", 1)
        self.assertNotEqual(replaced, original, "sentinel byte not found")
        self.assertEqual(len(replaced), len(original))
        target.write_bytes(replaced)

        code, stdout, _ = self._run()
        self.assertEqual(code, 1, stdout)
        self.assertIn("sha256 mismatch on ingredients.jsonl", stdout)

    # ---- 4. bytes mismatch ----

    def test_bytes_mismatch_fails(self) -> None:
        _build_all(self.data_root)
        # Append a byte to break size accounting.
        target = self.data_root / "normalized" / "wikibooks" / "cookbook_pages.jsonl"
        with open(target, "ab") as f:
            f.write(b"\n")  # extra blank line
        code, stdout, _ = self._run()
        self.assertEqual(code, 1, stdout)
        self.assertIn("bytes mismatch on cookbook_pages.jsonl", stdout)

    # ---- 5. row count mismatch ----

    def test_row_count_mismatch_fails(self) -> None:
        _build_all(self.data_root)
        # Inflate the manifest's expected count and re-fix sha/bytes so the
        # only failure surface is the row count.
        out = self.data_root / "normalized" / "wikibooks"
        manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
        manifest["row_counts"]["cookbook_pages_emitted"] = 999
        (out / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )
        code, stdout, _ = self._run()
        self.assertEqual(code, 1, stdout)
        self.assertIn("row count mismatch on cookbook_pages.jsonl", stdout)
        self.assertIn("manifest=999", stdout)

    # ---- 6. schema spot-check fails ----

    def test_schema_missing_key_fails(self) -> None:
        # Build a USDA tree with a missing key in one row.
        out = self.data_root / "normalized" / "usda"
        out.mkdir(parents=True, exist_ok=True)
        rows = [_usda_ingredient_row(i) for i in range(1, 4)]
        del rows[1]["food_category"]  # break row 2 line-2
        ing_path = out / "ingredients.jsonl"
        _write_jsonl(ing_path, rows)
        nut_rows = [_usda_nutrient_row(1, i) for i in range(1, 3)]
        nut_path = out / "nutrients.jsonl"
        _write_jsonl(nut_path, nut_rows)
        manifest = {
            "generated_at": "2026-04-25T19:42:00Z",
            "input_archives": [],
            "input_files": {},
            "row_counts": {
                "ingredients": 3,
                "nutrients": 2,
                "by_archive": {},
            },
            "outputs": {
                "ingredients.jsonl": {
                    "sha256": _sha256(ing_path),
                    "bytes": ing_path.stat().st_size,
                },
                "nutrients.jsonl": {
                    "sha256": _sha256(nut_path),
                    "bytes": nut_path.stat().st_size,
                },
            },
        }
        _write_json(out / "manifest.json", manifest)
        _build_off(self.data_root)
        _build_wikibooks(self.data_root)

        code, stdout, _ = self._run()
        self.assertEqual(code, 1, stdout)
        self.assertIn("schema spot-check failed", stdout)
        self.assertIn("ingredients.jsonl", stdout)
        self.assertIn("food_category", stdout)

    # ---- 7. malformed JSONL ----

    def test_malformed_jsonl_fails(self) -> None:
        out = self.data_root / "normalized" / "wikibooks"
        out.mkdir(parents=True, exist_ok=True)
        pages_path = out / "cookbook_pages.jsonl"
        # Mix one valid row and one garbage line.
        with open(pages_path, "w", encoding="utf-8") as f:
            f.write(json.dumps(_wikibooks_page_row(1)) + "\n")
            f.write("{not-valid-json,\n")
        manifest = {
            "generated_at": "2026-04-25T20:01:00Z",
            "input_file": "/dev/null",
            "input_bytes": 0,
            "row_counts": {
                "cookbook_pages_emitted": 2,
                "total_pages_scanned": 2,
                "cookbook_articles": 2,
                "cookbook_redirects": 0,
                "non_cookbook_skipped": 0,
                "parse_errors": 0,
            },
            "outputs": {
                "cookbook_pages.jsonl": {
                    "sha256": _sha256(pages_path),
                    "bytes": pages_path.stat().st_size,
                },
            },
        }
        _write_json(out / "manifest.json", manifest)
        _build_usda(self.data_root)
        _build_off(self.data_root)

        code, stdout, _ = self._run()
        self.assertEqual(code, 1, stdout)
        self.assertIn("JSONL parse error", stdout)
        self.assertIn("cookbook_pages.jsonl", stdout)

    # ---- 8. empty JSONL with claimed count > 0 ----

    def test_empty_jsonl_with_claimed_rows_fails(self) -> None:
        out = self.data_root / "normalized" / "wikibooks"
        out.mkdir(parents=True, exist_ok=True)
        pages_path = out / "cookbook_pages.jsonl"
        pages_path.write_bytes(b"")  # empty file
        manifest = {
            "generated_at": "2026-04-25T20:01:00Z",
            "input_file": "/dev/null",
            "input_bytes": 0,
            "row_counts": {
                "cookbook_pages_emitted": 5,  # claim 5 rows but file is empty
                "total_pages_scanned": 5,
                "cookbook_articles": 5,
                "cookbook_redirects": 0,
                "non_cookbook_skipped": 0,
                "parse_errors": 0,
            },
            "outputs": {
                "cookbook_pages.jsonl": {
                    "sha256": _sha256(pages_path),
                    "bytes": pages_path.stat().st_size,
                },
            },
        }
        _write_json(out / "manifest.json", manifest)
        _build_usda(self.data_root)
        _build_off(self.data_root)

        code, stdout, _ = self._run()
        self.assertEqual(code, 1, stdout)
        self.assertIn("row count mismatch on cookbook_pages.jsonl", stdout)

    # ---- 9. tail sampling on small files ----

    def test_small_file_samples_all_lines(self) -> None:
        # samples=10 vs 4 total rows means head+tail >> file size; the
        # script must just walk the whole file without raising.
        _build_usda(self.data_root, n_ing=4, n_nut=4)
        _build_off(self.data_root)
        _build_wikibooks(self.data_root)
        code, stdout, _ = self._run("--samples", "10")
        self.assertEqual(code, 0, stdout)
        self.assertEqual(stdout.count("✓ OK"), 3, stdout)

    def test_tail_helper_handles_short_file(self) -> None:
        # Direct unit-test on the helper: 3 lines, ask for 10.
        path = self.data_root / "tiny.txt"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"alpha\nbeta\ngamma\n")
        out = _iter_tail_lines(path, 10)
        self.assertEqual(out, [b"alpha", b"beta", b"gamma"])

    def test_tail_helper_handles_no_trailing_newline(self) -> None:
        path = self.data_root / "no_nl.txt"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"alpha\nbeta\ngamma")  # no trailing \n
        out = _iter_tail_lines(path, 2)
        self.assertEqual(out, [b"beta", b"gamma"])

    def test_tail_helper_empty_file(self) -> None:
        path = self.data_root / "empty.txt"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"")
        self.assertEqual(_iter_tail_lines(path, 5), [])

    # ---- 10. verbose mode ----

    def test_verbose_emits_per_file_lines(self) -> None:
        _build_all(self.data_root)
        code, stdout, _ = self._run("--verbose")
        self.assertEqual(code, 0, stdout)
        # Expect a per-file line for every output file (5 total: 2 USDA, 2 OFF, 1 WB).
        self.assertIn("usda/ingredients.jsonl", stdout)
        self.assertIn("usda/nutrients.jsonl", stdout)
        self.assertIn("openfoodfacts/branded_products.jsonl", stdout)
        self.assertIn("openfoodfacts/allergens.json", stdout)
        self.assertIn("wikibooks/cookbook_pages.jsonl", stdout)
        # Each verbose line carries a sha=… prefix.
        self.assertGreaterEqual(stdout.count("sha="), 5)

    # ---- bonus: bad allergens.json structure ----

    def test_allergens_json_missing_keys_fails(self) -> None:
        _build_usda(self.data_root)
        _build_wikibooks(self.data_root)
        out = self.data_root / "normalized" / "openfoodfacts"
        out.mkdir(parents=True, exist_ok=True)
        prod_path = out / "branded_products.jsonl"
        _write_jsonl(prod_path, [_off_product_row("0000000000000")])
        # allergens.json with WRONG top-level structure (missing 'traces').
        allergens_path = out / "allergens.json"
        _write_json(allergens_path, {"allergens": {"en:milk": 1}})
        manifest = {
            "generated_at": "2026-04-25T22:15:00Z",
            "input_file": "/dev/null",
            "input_bytes": 0,
            "row_counts": {
                "total_input": 1,
                "emitted": 1,
                "skipped_no_code": 0,
                "skipped_no_name": 0,
                "duplicate_codes_skipped": 0,
            },
            "outputs": {
                "branded_products.jsonl": {
                    "sha256": _sha256(prod_path),
                    "bytes": prod_path.stat().st_size,
                },
                "allergens.json": {
                    "sha256": _sha256(allergens_path),
                    "bytes": allergens_path.stat().st_size,
                },
            },
        }
        _write_json(out / "manifest.json", manifest)
        code, stdout, _ = self._run()
        self.assertEqual(code, 1, stdout)
        self.assertIn("traces", stdout)

    # ---- bonus: human bytes formatting ----

    def test_human_bytes_units(self) -> None:
        self.assertEqual(_human_bytes(0), "0 B")
        self.assertEqual(_human_bytes(512), "512 B")
        self.assertEqual(_human_bytes(2048), "2.0 KB")
        self.assertEqual(_human_bytes(5 * 1024 * 1024), "5.0 MB")
        self.assertTrue(_human_bytes(2 * 1024**3).endswith(" GB"))

    # ---- bonus: --samples 0 still works ----

    def test_samples_zero_skips_spot_check(self) -> None:
        _build_all(self.data_root)
        code, stdout, _ = self._run("--samples", "0")
        # samples=0 means no rows are spot-checked, but row-count + sha
        # still pass on a clean fixture.
        self.assertEqual(code, 0, stdout)


if __name__ == "__main__":
    unittest.main()
