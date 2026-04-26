"""Smoke tests for ``scripts.datapack.normalize_fda_food_code``.

The real script uses ``pdfplumber`` to extract a 668-page PDF. We never want
to install pdfplumber (heavy, drags in pdfminer.six + pillow) or ship a real
PDF fixture, so we install a fake ``pdfplumber`` module into ``sys.modules``
BEFORE importing the script. The script does ``import pdfplumber`` lazily
inside ``_extract_pages``, so the stub is what it resolves to at call time.

The fake's ``open(path)`` returns a context manager whose ``.pages`` is an
iterable of ``_FakePage`` objects exposing ``.extract_text()``. Per-test
fixtures stuff the desired page list into ``_FakePdfplumber.pages_for_path``
keyed by ``str(input_file)`` — different tests can route different paths to
different page sets without cross-test bleed.

Cases:

  1. Happy path — multi-page synthetic PDF spanning Chapter 3 + Annex 3
     with multiple section headers, free-form prose, and a header line on
     each page; manifest sha matches input file's sha.
  2. Idempotent skip — second normalize() without force=True returns same
     manifest and sections.jsonl mtime is unchanged.
  3. ``force=True`` rebuild — third call rebuilds; sha + row-count stable;
     sections.jsonl content byte-identical.
  4. Missing PDF — non-existent input_file raises FileNotFoundError with
     path in message.
  5. Header stripping — page header line never leaks into a section body.
  6. Multi-page section — section that spans pages 5 and 6 has
     page_start=5, page_end=6, and body content from both pages.

See ``tests/python/test_build_embeddings_index.py`` for the same
``sys.modules`` stubbing pattern with ``sentence_transformers``.
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
# Fake pdfplumber — installed into sys.modules BEFORE we import the script
# under test. The script does ``import pdfplumber`` lazily inside
# ``_extract_pages``, so this stub is what it resolves to at call time.
# ---------------------------------------------------------------------------


class _FakePage:
    """Stand-in for a pdfplumber Page object."""

    def __init__(self, text: str) -> None:
        self._text = text

    def extract_text(self) -> str:
        return self._text


class _FakePDFContext:
    """Stand-in for the pdfplumber.PDF object returned by ``open()``.

    Implements the context-manager protocol the script uses
    (``with pdfplumber.open(path) as pdf:``) and exposes ``.pages``.
    """

    def __init__(self, pages: list[_FakePage]) -> None:
        self.pages = pages

    def __enter__(self) -> "_FakePDFContext":
        return self

    def __exit__(self, *args: Any) -> bool:
        return False


class _FakePdfplumber:
    """Module-level state for the stub. Tests register page lists keyed by
    the str() form of the input PDF path so each test routes its own pages
    without cross-contamination."""

    pages_for_path: dict[str, list[_FakePage]] = {}

    @classmethod
    def open(cls, path: str) -> _FakePDFContext:
        key = str(path)
        if key not in cls.pages_for_path:
            raise KeyError(
                f"_FakePdfplumber: no pages registered for path {key!r}; "
                "test forgot to set pages_for_path[str(input_file)]"
            )
        return _FakePDFContext(cls.pages_for_path[key])


_fake_pdfplumber_module = types.ModuleType("pdfplumber")
_fake_pdfplumber_module.open = _FakePdfplumber.open  # type: ignore[attr-defined]
sys.modules["pdfplumber"] = _fake_pdfplumber_module


from scripts.datapack import normalize_fda_food_code  # noqa: E402
from scripts.datapack._io import sha256_file as _sha256_file  # noqa: E402


# ---------------------------------------------------------------------------
# Synthetic page builder
# ---------------------------------------------------------------------------


def _page(header: str, *body_lines: str) -> str:
    """Build the text of a synthetic PDF page.

    ``header`` is the FDA Food Code header line that the script's
    ``_split_header`` should strip (e.g. ``"FDA Food Code 2022 Chapter 3.
    Food"``). Pass ``""`` to omit the header (e.g. cover/TOC pages).
    Body lines are joined with ``\\n`` after the header.
    """
    lines: list[str] = []
    if header:
        lines.append(header)
    lines.extend(body_lines)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


CHAPTER_HEADER = "FDA Food Code 2022 Chapter 3. Food"
ANNEX_HEADER = (
    "FDA Food Code 2022 Annex 3. Public Health Reasons/Administrative Guidelines"
)


class NormalizeFdaFoodCodeSmokeTests(unittest.TestCase):
    """End-to-end smoke tests for ``normalize_fda_food_code.normalize``."""

    def setUp(self) -> None:
        # Hermetic per-test temp dir — input PDF (fake bytes), output dir.
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._tmp.name)
        self.input_file = self.tmp_path / "FDA_Food_Code_2022.pdf"
        self.output_dir = self.tmp_path / "out"
        # Wipe any state left over from a prior test.
        _FakePdfplumber.pages_for_path.clear()

    def tearDown(self) -> None:
        _FakePdfplumber.pages_for_path.clear()
        self._tmp.cleanup()

    def _write_fake_pdf(self, contents: bytes = b"%PDF-fake-bytes\n") -> None:
        """Write the input file path so ``_sha256_file`` and the existence
        check succeed. The fake pdfplumber ignores the file body."""
        self.input_file.write_bytes(contents)

    def _register_pages(self, pages: list[str]) -> None:
        """Tell the fake pdfplumber which page strings to return for our
        input file."""
        _FakePdfplumber.pages_for_path[str(self.input_file)] = [
            _FakePage(p) for p in pages
        ]

    # -----------------------------------------------------------------
    # 1. Happy path
    # -----------------------------------------------------------------

    def test_happy_path_emits_sections_and_manifest(self) -> None:
        """Synthesize a 5-page PDF spanning Chapter 3 + Annex 3 with multiple
        section headers and a free-form paragraph between them. Verify the
        sections.jsonl rows + manifest fields line up."""
        pages = [
            # Page 1 — Chapter 3, two sections back-to-back
            _page(
                CHAPTER_HEADER,
                "3-501.14 Cooling.",
                "TCS food shall be cooled within four hours from",
                "57°C (135°F) to 5°C (41°F) or less.",
                "3-501.15 Cooling Methods.",
                "Cooling shall be accomplished using one or more of",
                "the following methods.",
            ),
            # Page 2 — Chapter 3, continuing into a new section
            _page(
                CHAPTER_HEADER,
                "(A) Placing the food in shallow pans.",
                "(B) Separating the food into smaller portions.",
                "3-501.16 Hot and Cold Holding.",
                "Cold TCS food shall be maintained at 5°C (41°F) or less.",
            ),
            # Page 3 — still Chapter 3, body of 3-501.16 continues
            _page(
                CHAPTER_HEADER,
                "Hot TCS food shall be maintained at 57°C (135°F) or above.",
            ),
            # Page 4 — Annex 3 begins; free-form prose appears before any
            # section header.
            _page(
                ANNEX_HEADER,
                "Public health rationale for the provisions of Chapter 3",
                "is summarized in the following paragraphs.",
            ),
            # Page 5 — Annex 3, contains a section header
            _page(
                ANNEX_HEADER,
                "3-501.15 Cooling Methods.",
                "Annex commentary on cooling methods follows here.",
            ),
        ]
        self._write_fake_pdf()
        self._register_pages(pages)

        manifest = normalize_fda_food_code.normalize(
            input_file=self.input_file, output_dir=self.output_dir, force=False
        )

        # Files exist
        sections_path = self.output_dir / "sections.jsonl"
        manifest_path = self.output_dir / "manifest.json"
        self.assertTrue(sections_path.exists(), "sections.jsonl missing")
        self.assertTrue(manifest_path.exists(), "manifest.json missing")

        # Each line is a valid JSON object
        rows: list[dict[str, Any]] = []
        with open(sections_path, "r", encoding="utf-8") as f:
            for raw in f:
                raw = raw.rstrip("\n")
                if not raw:
                    continue
                row = json.loads(raw)
                self.assertIsInstance(row, dict)
                rows.append(row)

        self.assertGreater(len(rows), 0, "no sections emitted")

        # Manifest accounting
        self.assertEqual(manifest["rows"], len(rows))
        self.assertEqual(
            manifest["input_sha256"],
            _sha256_file(self.input_file),
            "manifest input_sha256 must match the input PDF's sha",
        )
        self.assertEqual(manifest["input_file"], "FDA_Food_Code_2022.pdf")
        self.assertEqual(manifest["input_bytes"], self.input_file.stat().st_size)
        on_disk = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(on_disk, manifest, "returned manifest must match on-disk")

        # At least one section has section_id="3-501.X" with a sensible title
        with_id = [r for r in rows if r.get("section_id")]
        self.assertGreaterEqual(
            len(with_id), 2, "expected at least 2 IDed sections, got: %r" % with_id
        )
        ids = {r["section_id"] for r in with_id}
        self.assertIn("3-501.14", ids)
        self.assertIn("3-501.16", ids)
        # Title shape is sensible for one of them
        cooling = next(r for r in with_id if r["section_id"] == "3-501.14")
        self.assertEqual(cooling["title"], "Cooling")

        # At least one free-form section (between/before section headers)
        free_form = [r for r in rows if r.get("section_id") is None]
        self.assertGreaterEqual(
            len(free_form), 1, "expected at least 1 free-form section"
        )

        # At least one section in Chapter 3 with annex=None
        in_ch3 = [
            r
            for r in rows
            if r.get("chapter") == "Chapter 3. Food" and r.get("annex") is None
        ]
        self.assertGreaterEqual(len(in_ch3), 1)

        # At least one section in Annex 3 with chapter=None
        in_annex = [
            r
            for r in rows
            if r.get("chapter") is None
            and r.get("annex", "").startswith("Annex 3.")
        ]
        self.assertGreaterEqual(len(in_annex), 1)

        # page_start <= page_end for every section
        for r in rows:
            self.assertLessEqual(
                r["page_start"],
                r["page_end"],
                f"page_start>page_end on row {r!r}",
            )

        # char_count matches body length for every row
        for r in rows:
            self.assertEqual(r["char_count"], len(r["body"]))

    # -----------------------------------------------------------------
    # 2. Idempotent skip
    # -----------------------------------------------------------------

    def test_idempotent_skip_when_sha_matches(self) -> None:
        """A second normalize() call without force=True should short-circuit:
        manifest unchanged and sections.jsonl mtime not advanced."""
        pages = [
            _page(
                CHAPTER_HEADER,
                "3-201.11 Compliance with Food Law.",
                "Food shall be obtained from sources that comply with law.",
            ),
        ]
        self._write_fake_pdf()
        self._register_pages(pages)

        first = normalize_fda_food_code.normalize(
            input_file=self.input_file, output_dir=self.output_dir, force=False
        )
        sections_path = self.output_dir / "sections.jsonl"
        first_mtime_ns = sections_path.stat().st_mtime_ns
        # Sleep just enough that any rewrite would bump mtime even on
        # filesystems with second-resolution timestamps.
        time.sleep(0.05)

        second = normalize_fda_food_code.normalize(
            input_file=self.input_file, output_dir=self.output_dir, force=False
        )

        self.assertEqual(
            first["input_sha256"],
            second["input_sha256"],
            "sha must be stable across idempotent calls",
        )
        self.assertEqual(first["rows"], second["rows"])
        self.assertEqual(
            sections_path.stat().st_mtime_ns,
            first_mtime_ns,
            "sections.jsonl was rewritten on the idempotent call (mtime bumped)",
        )

    # -----------------------------------------------------------------
    # 3. force=True rebuild
    # -----------------------------------------------------------------

    def test_force_rebuild_is_byte_identical(self) -> None:
        """``force=True`` rewrites sections.jsonl from scratch. Given the
        same fake-PDF text, the output bytes must be identical and the
        manifest's input_sha256 / rows count must agree with the prior
        call."""
        pages = [
            _page(
                CHAPTER_HEADER,
                "3-302.11 Packaged and Unpackaged Food, Separation.",
                "Food shall be protected from cross contamination.",
            ),
            _page(
                CHAPTER_HEADER,
                "3-302.12 Food Storage Containers, Identified.",
                "Containers shall be identified with the common name.",
            ),
        ]
        self._write_fake_pdf()
        self._register_pages(pages)

        first = normalize_fda_food_code.normalize(
            input_file=self.input_file, output_dir=self.output_dir, force=False
        )
        sections_path = self.output_dir / "sections.jsonl"
        first_bytes = sections_path.read_bytes()

        # Second call: idempotent skip.
        normalize_fda_food_code.normalize(
            input_file=self.input_file, output_dir=self.output_dir, force=False
        )

        # Third call: force rebuild.
        third = normalize_fda_food_code.normalize(
            input_file=self.input_file, output_dir=self.output_dir, force=True
        )
        third_bytes = sections_path.read_bytes()

        self.assertEqual(third["input_sha256"], first["input_sha256"])
        self.assertEqual(third["rows"], first["rows"])
        self.assertEqual(
            third_bytes,
            first_bytes,
            "sections.jsonl bytes drifted between initial run and forced rebuild",
        )

    # -----------------------------------------------------------------
    # 4. Missing PDF raises clearly
    # -----------------------------------------------------------------

    def test_missing_pdf_raises_file_not_found(self) -> None:
        """When the input PDF does not exist, normalize() must raise
        FileNotFoundError naming the missing path."""
        ghost = self.tmp_path / "does_not_exist.pdf"
        with self.assertRaises(FileNotFoundError) as cm:
            normalize_fda_food_code.normalize(
                input_file=ghost, output_dir=self.output_dir, force=False
            )
        msg = str(cm.exception)
        self.assertIn(str(ghost), msg)

    # -----------------------------------------------------------------
    # 5. Header stripping
    # -----------------------------------------------------------------

    def test_page_header_is_stripped_from_section_bodies(self) -> None:
        """A page that begins with the FDA Food Code header line must not
        leak that header into any emitted section body."""
        pages = [
            _page(
                CHAPTER_HEADER,
                "3-401.11 Raw Animal Foods, Cooking.",
                "Raw animal foods shall be cooked to heat all parts.",
            ),
            _page(
                CHAPTER_HEADER,
                "of the food to a temperature and for a time that complies",
                "with the table in this section.",
            ),
        ]
        self._write_fake_pdf()
        self._register_pages(pages)

        normalize_fda_food_code.normalize(
            input_file=self.input_file, output_dir=self.output_dir, force=False
        )
        sections_path = self.output_dir / "sections.jsonl"
        rows = [
            json.loads(line)
            for line in sections_path.read_text(encoding="utf-8").splitlines()
            if line
        ]
        self.assertGreaterEqual(len(rows), 1)
        for r in rows:
            self.assertNotIn(
                CHAPTER_HEADER,
                r["body"],
                f"page header leaked into body for row {r!r}",
            )

    # -----------------------------------------------------------------
    # 6. Multi-page section
    # -----------------------------------------------------------------

    def test_multi_page_section_records_correct_page_range(self) -> None:
        """Section header on page 5 with body continuing on page 6 (no new
        section header) must produce one row with page_start=5, page_end=6,
        and body content from both pages."""
        # 4 throwaway intro pages so page numbering reaches 5/6.
        pages = [
            _page(CHAPTER_HEADER, "Cover-ish content."),
            _page(CHAPTER_HEADER, "More intro material."),
            _page(CHAPTER_HEADER, "Still introductory."),
            _page(CHAPTER_HEADER, "Last lead-in page."),
            # Page 5 — section header opens here
            _page(
                CHAPTER_HEADER,
                "3-501.15 Cooling Methods.",
                "PAGE5MARKER cooling shall be accomplished by placing the",
                "food in shallow pans.",
            ),
            # Page 6 — body continues, no new section header
            _page(
                CHAPTER_HEADER,
                "PAGE6MARKER separating the food into smaller portions",
                "or stirring frequently.",
            ),
        ]
        self._write_fake_pdf()
        self._register_pages(pages)

        normalize_fda_food_code.normalize(
            input_file=self.input_file, output_dir=self.output_dir, force=False
        )
        sections_path = self.output_dir / "sections.jsonl"
        rows = [
            json.loads(line)
            for line in sections_path.read_text(encoding="utf-8").splitlines()
            if line
        ]
        cooling_rows = [r for r in rows if r.get("section_id") == "3-501.15"]
        self.assertEqual(
            len(cooling_rows),
            1,
            f"expected exactly one 3-501.15 row, got {len(cooling_rows)}",
        )
        row = cooling_rows[0]
        self.assertEqual(row["page_start"], 5)
        self.assertEqual(row["page_end"], 6)
        self.assertIn("PAGE5MARKER", row["body"])
        self.assertIn("PAGE6MARKER", row["body"])


if __name__ == "__main__":
    unittest.main()
