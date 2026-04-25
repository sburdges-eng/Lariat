"""Unit tests for scripts.datapack.normalize_wikibooks.

Builds small synthetic MediaWiki XML fixtures and runs the normalizer
against them. Uses ``chunk_rows=2`` everywhere so the multi-chunk merge
path is exercised on every test that has more than 2 pages.

Spec test coverage (per task brief):
  1.  Happy path — 3 cookbook articles + 1 cookbook redirect + 1 non-cookbook.
  2.  Redirect detection — both <redirect/> element AND #REDIRECT [[...]]
      wikitext fallback.
  3.  Slug strip — "Cookbook:Mole sauce" -> slug "Mole sauce", source_url
      uses underscored title.
  4.  Wikitext stripping — templates (incl. nested), File: links, wikilinks
      with display, refs, headers, whitespace collapse.
  5.  Category extraction — case-insensitive, deduped, order preserved.
  6.  Sort order — page_ids [42,7,23] -> output [7,23,42].
  7.  Idempotency — second run skips work.
  8.  --force rebuild — byte-identical output (modulo timestamp).
  9.  Parse-error resilience — malformed page counted but non-fatal.
  10. Empty wikitext — bytes=0 emits row with wikitext_length=0,
      plain_text_summary="" (locked: empty string, not null, for articles).
  11. Cross-chunk sort with chunk_rows=2 — 5 pages forces multi-chunk merge.
"""
from __future__ import annotations

import hashlib
import json
import sys
import unittest
from pathlib import Path
from textwrap import dedent
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.datapack import normalize_wikibooks  # noqa: E402
from scripts.datapack.normalize_wikibooks import (  # noqa: E402
    main as normalize_main,
    normalize,
    _wikitext_to_plain,
    _extract_categories,
    _strip_templates,
)


# ---------------------------------------------------------------------------
# Fixture builder
# ---------------------------------------------------------------------------

# Minimal MediaWiki XML 0.11 envelope. We omit <siteinfo>/<namespaces> since
# the normalizer reads <ns> per-page and doesn't depend on the catalog.
XML_HEADER = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/" '
    'xml:lang="en" version="0.11">\n'
)
XML_FOOTER = "</mediawiki>\n"


def _xml_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
         .replace('"', "&quot;")
    )


def _make_page(
    *,
    page_id: int,
    title: str,
    ns: int = 102,
    redirect_title: str | None = None,
    text: str = "",
    text_bytes: int | None = None,
    omit_text_bytes_attr: bool = False,
) -> str:
    """Build a single <page> XML fragment.

    If ``redirect_title`` is given, emits a <redirect title="..."/> element.
    ``text_bytes`` overrides the ``bytes`` attr on <text>; if None we use
    len(text). If ``omit_text_bytes_attr`` is True, the bytes attr is
    omitted entirely (for testing the fallback).
    """
    parts = [f"  <page>\n"]
    parts.append(f"    <title>{_xml_escape(title)}</title>\n")
    parts.append(f"    <ns>{ns}</ns>\n")
    parts.append(f"    <id>{page_id}</id>\n")
    if redirect_title is not None:
        parts.append(f'    <redirect title="{_xml_escape(redirect_title)}" />\n')
    parts.append(f"    <revision>\n")
    parts.append(f"      <id>{page_id * 1000 + 1}</id>\n")
    parts.append(f"      <timestamp>2024-01-01T00:00:00Z</timestamp>\n")
    if omit_text_bytes_attr:
        parts.append(f'      <text xml:space="preserve">{_xml_escape(text)}</text>\n')
    else:
        bytes_val = text_bytes if text_bytes is not None else len(text)
        parts.append(
            f'      <text bytes="{bytes_val}" xml:space="preserve">'
            f'{_xml_escape(text)}</text>\n'
        )
    parts.append(f"    </revision>\n")
    parts.append(f"  </page>\n")
    return "".join(parts)


def _write_xml(path: Path, page_fragments: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(XML_HEADER)
        for frag in page_fragments:
            f.write(frag)
        f.write(XML_FOOTER)


def _read_jsonl(path: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class NormalizeWikibooksTest(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_root = Path(self._tmp.name)
        self.input_file = self.tmp_root / "enwikibooks-latest-pages-articles.xml"
        self.output_dir = self.tmp_root / "out"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _run(self, *, force: bool = False, chunk_rows: int = 2) -> dict:
        return normalize(
            input_file=self.input_file,
            output_dir=self.output_dir,
            force=force,
            chunk_rows=chunk_rows,
        )

    # --- 1. Happy path ------------------------------------------------------
    def test_happy_path_three_articles_one_redirect_one_non_cookbook(self) -> None:
        pages = [
            _make_page(
                page_id=10,
                title="Cookbook:Mole sauce",
                text=dedent("""\
                    Mole sauce is a traditional Mexican sauce. It contains chiles, chocolate, and spices.

                    [[Category:Mexican cuisine]]
                    [[Category:Sauces]]
                """),
            ),
            _make_page(
                page_id=20,
                title="Cookbook:Cheddar cheese",
                text="Cheddar is a hard cheese from England.\n[[Category:Cheeses]]\n",
            ),
            _make_page(
                page_id=30,
                title="Cookbook:Apple pie",
                text="Apple pie is a dessert.\n[[Category:Desserts]]\n[[Category:American cuisine]]\n",
            ),
            _make_page(
                page_id=40,
                title="Cookbook:Mole",
                redirect_title="Cookbook:Mole sauce",
                text="#REDIRECT [[Cookbook:Mole sauce]]\n",
            ),
            _make_page(
                page_id=50,
                title="Main Page",
                ns=0,
                text="This is the main page.",
            ),
        ]
        _write_xml(self.input_file, pages)
        manifest = self._run()

        rows = _read_jsonl(self.output_dir / "cookbook_pages.jsonl")
        self.assertEqual(len(rows), 4)  # 3 articles + 1 redirect

        by_id = {r["page_id"]: r for r in rows}
        # Schema check
        expected_keys = {
            "page_id", "title", "slug", "is_redirect", "redirect_target",
            "categories", "wikitext_length", "plain_text_summary", "source_url",
        }
        for r in rows:
            self.assertEqual(set(r.keys()), expected_keys, r)

        mole = by_id[10]
        self.assertEqual(mole["title"], "Cookbook:Mole sauce")
        self.assertEqual(mole["slug"], "Mole sauce")
        self.assertFalse(mole["is_redirect"])
        self.assertIsNone(mole["redirect_target"])
        self.assertEqual(mole["categories"], ["Mexican cuisine", "Sauces"])
        self.assertIn("Mole sauce", mole["plain_text_summary"])
        self.assertLessEqual(len(mole["plain_text_summary"]), 500)
        self.assertEqual(
            mole["source_url"],
            "https://en.wikibooks.org/wiki/Cookbook:Mole_sauce",
        )

        redirect = by_id[40]
        self.assertTrue(redirect["is_redirect"])
        self.assertEqual(redirect["redirect_target"], "Cookbook:Mole sauce")
        self.assertIsNone(redirect["plain_text_summary"])

        # Manifest counters
        self.assertEqual(manifest["row_counts"]["total_pages_scanned"], 5)
        self.assertEqual(manifest["row_counts"]["cookbook_pages_emitted"], 4)
        self.assertEqual(manifest["row_counts"]["cookbook_articles"], 3)
        self.assertEqual(manifest["row_counts"]["cookbook_redirects"], 1)
        self.assertEqual(manifest["row_counts"]["non_cookbook_skipped"], 1)
        self.assertEqual(manifest["row_counts"]["parse_errors"], 0)

    # --- 2. Redirect detection (both forms) ---------------------------------
    def test_redirect_via_element_and_via_wikitext(self) -> None:
        pages = [
            # Element form — has <redirect/> and matching wikitext.
            _make_page(
                page_id=1,
                title="Cookbook:Aubergine",
                redirect_title="Cookbook:Eggplant",
                text="#REDIRECT [[Cookbook:Eggplant]]\n",
            ),
            # Wikitext-only form — NO <redirect/> element, but wikitext
            # starts with #REDIRECT. Normalizer must still flag it.
            _make_page(
                page_id=2,
                title="Cookbook:Aubergines",
                text="#REDIRECT [[Cookbook:Eggplant]]\n",
            ),
            # Case-insensitive variant of the wikitext form.
            _make_page(
                page_id=3,
                title="Cookbook:eggplants",
                text="#redirect [[Cookbook:Eggplant]]\n",
            ),
        ]
        _write_xml(self.input_file, pages)
        self._run()
        rows = _read_jsonl(self.output_dir / "cookbook_pages.jsonl")
        by_id = {r["page_id"]: r for r in rows}
        for pid in (1, 2, 3):
            self.assertTrue(by_id[pid]["is_redirect"], pid)
            self.assertEqual(by_id[pid]["redirect_target"], "Cookbook:Eggplant", pid)
            self.assertIsNone(by_id[pid]["plain_text_summary"], pid)

    # --- 3. Slug strip + source_url ----------------------------------------
    def test_slug_strip_and_source_url(self) -> None:
        pages = [
            _make_page(
                page_id=7,
                title="Cookbook:Mole sauce",
                text="Mole.\n[[Category:Mexican cuisine]]\n",
            ),
            # Title without "Cookbook:" prefix — slug equals title.
            # (Should not happen in practice for ns=102 pages but lock the
            # behavior anyway.)
            _make_page(
                page_id=8,
                title="Just A Title",
                text="Body.",
            ),
        ]
        _write_xml(self.input_file, pages)
        self._run()
        rows = _read_jsonl(self.output_dir / "cookbook_pages.jsonl")
        by_id = {r["page_id"]: r for r in rows}
        self.assertEqual(by_id[7]["slug"], "Mole sauce")
        self.assertEqual(
            by_id[7]["source_url"],
            "https://en.wikibooks.org/wiki/Cookbook:Mole_sauce",
        )
        self.assertEqual(by_id[8]["slug"], "Just A Title")
        self.assertEqual(
            by_id[8]["source_url"],
            "https://en.wikibooks.org/wiki/Just_A_Title",
        )

    # --- 4. Wikitext stripping ----------------------------------------------
    def test_wikitext_stripping_unit(self) -> None:
        # Pure-Python unit test on _wikitext_to_plain. No XML round-trip.

        # Templates with nesting.
        self.assertEqual(
            _wikitext_to_plain("{{template|nested {{inner}} args}} text"),
            "text",
        )
        # Stray closing braces are eaten (don't leak into the summary).
        self.assertEqual(
            _strip_templates("{{template|nested {{inner}} args}} text"),
            " text",
        )

        # File/Image links removed entirely.
        self.assertEqual(
            _wikitext_to_plain("Before [[File:Image.png|caption]] after"),
            "Before after",
        )
        self.assertEqual(
            _wikitext_to_plain("Before [[Image:pic.jpg|thumb]] after"),
            "Before after",
        )

        # Wikilinks: pipe-display vs plain.
        self.assertEqual(
            _wikitext_to_plain("See [[Cookbook:Other|Other]] page"),
            "See Other page",
        )
        self.assertEqual(
            _wikitext_to_plain("See [[Plain link]] here"),
            "See Plain link here",
        )

        # Refs (open/close + self-closing).
        self.assertEqual(
            _wikitext_to_plain('Body<ref name="x">citation</ref> more'),
            "Body more",
        )
        self.assertEqual(
            _wikitext_to_plain('Body<ref name="x" /> more'),
            "Body more",
        )

        # Headers (any number of `=` >= 2) keep text.
        self.assertEqual(_wikitext_to_plain("==Header=="), "Header")
        self.assertEqual(_wikitext_to_plain("===Sub Header==="), "Sub Header")

        # Whitespace collapse + multiline.
        self.assertEqual(
            _wikitext_to_plain("Line1\n\n\nLine2     spaced"),
            "Line1 Line2 spaced",
        )

        # HTML tags dropped.
        self.assertEqual(
            _wikitext_to_plain("Hello <b>world</b> and <br/> stuff"),
            "Hello world and stuff",
        )

        # 500-char truncation. Lock to hard slice.
        long_text = "abcde" * 200  # 1000 chars
        result = _wikitext_to_plain(long_text)
        self.assertEqual(len(result), 500)
        self.assertEqual(result, "abcde" * 100)

    # --- 5. Category extraction --------------------------------------------
    def test_category_extraction(self) -> None:
        # Case-insensitive 'category:' AND dedup with first-occurrence order.
        wikitext = (
            "Body.\n"
            "[[Category:Mexican]]\n"
            "[[category:sauces]]\n"
            "[[Category:Mexican]]\n"  # dup of first
            "[[Category:Sauces]]\n"   # case-different but unique by literal
        )
        cats = _extract_categories(wikitext)
        # First-occurrence order preserved; "Mexican" (first), "sauces"
        # (second), "Sauces" (third — different by case from "sauces").
        # The dup "Category:Mexican" is dropped.
        self.assertEqual(cats, ["Mexican", "sauces", "Sauces"])

        # With sortkey: [[Category:Foo|sortkey]] — captures "Foo".
        wikitext2 = "[[Category:Mexican|m]] [[Category:Sauces|s]]"
        self.assertEqual(_extract_categories(wikitext2), ["Mexican", "Sauces"])

        # Empty / whitespace-only categories dropped.
        wikitext3 = "[[Category:]] [[Category:   ]] [[Category:Real]]"
        self.assertEqual(_extract_categories(wikitext3), ["Real"])

    # --- 6. Sort order ------------------------------------------------------
    def test_sort_order_by_page_id(self) -> None:
        pages = [
            _make_page(page_id=42, title="Cookbook:Forty-two", text="A."),
            _make_page(page_id=7, title="Cookbook:Seven", text="B."),
            _make_page(page_id=23, title="Cookbook:Twenty-three", text="C."),
        ]
        _write_xml(self.input_file, pages)
        self._run()  # chunk_rows=2 → 2 chunks
        rows = _read_jsonl(self.output_dir / "cookbook_pages.jsonl")
        self.assertEqual([r["page_id"] for r in rows], [7, 23, 42])

    # --- 7. Idempotency ----------------------------------------------------
    def test_idempotent_skip_on_second_run(self) -> None:
        pages = [
            _make_page(page_id=1, title="Cookbook:A", text="Aaa."),
            _make_page(page_id=2, title="Cookbook:B", text="Bbb."),
        ]
        _write_xml(self.input_file, pages)
        m1 = self._run()
        sha_1 = m1["outputs"]["cookbook_pages.jsonl"]["sha256"]

        # Second run, no force: must short-circuit and return unchanged sha.
        m2 = normalize(
            input_file=self.input_file,
            output_dir=self.output_dir,
            force=False,
            chunk_rows=2,
        )
        self.assertEqual(m2["outputs"]["cookbook_pages.jsonl"]["sha256"], sha_1)
        on_disk = hashlib.sha256(
            (self.output_dir / "cookbook_pages.jsonl").read_bytes()
        ).hexdigest()
        self.assertEqual(on_disk, sha_1)

    # --- 8. --force rebuild byte-identical (modulo timestamp) --------------
    def test_force_rebuild_yields_identical_output_bytes(self) -> None:
        # Reverse-sorted input to make sure the merge sort runs.
        pages = [
            _make_page(page_id=2, title="Cookbook:B", text="Bbb."),
            _make_page(page_id=1, title="Cookbook:A", text="Aaa."),
        ]
        _write_xml(self.input_file, pages)
        m1 = self._run()
        # Capture the JSONL bytes BEFORE the force rebuild — reading after
        # both runs would be a placebo (always equal regardless of
        # determinism). See the s1-before-m2 pattern in test_normalize_off.py.
        bytes_1 = (self.output_dir / "cookbook_pages.jsonl").read_bytes()

        m2 = normalize(
            input_file=self.input_file,
            output_dir=self.output_dir,
            force=True,
            chunk_rows=2,
        )
        bytes_2 = (self.output_dir / "cookbook_pages.jsonl").read_bytes()

        # cookbook_pages.jsonl has NO generated_at field — sha must match
        # exactly across runs.
        self.assertEqual(
            m1["outputs"]["cookbook_pages.jsonl"]["sha256"],
            m2["outputs"]["cookbook_pages.jsonl"]["sha256"],
        )
        self.assertEqual(
            m1["outputs"]["cookbook_pages.jsonl"]["bytes"],
            m2["outputs"]["cookbook_pages.jsonl"]["bytes"],
        )
        self.assertEqual(bytes_1, bytes_2)

    # --- 9. Parse-error resilience -----------------------------------------
    def test_parse_error_does_not_abort_pipeline(self) -> None:
        # Page 2 has a non-numeric <ns> — the int(ns_text) cast raises
        # ValueError, which we catch and count as a parse_error. Pages 1
        # and 3 should still emit cleanly. (The lxml `recover=True` parser
        # can swallow most low-level XML malformations; injecting bad data
        # at a higher logical level — wrong type for <ns> — exercises the
        # try/except in the page loop without depending on `recover`.)
        page1 = _make_page(page_id=1, title="Cookbook:A", text="Aaa.")
        page3 = _make_page(page_id=3, title="Cookbook:C", text="Ccc.")
        # Build page 2 manually with broken <ns>
        page2 = (
            "  <page>\n"
            "    <title>Cookbook:Broken</title>\n"
            "    <ns>not-a-number</ns>\n"
            "    <id>2</id>\n"
            "    <revision>\n"
            "      <id>2001</id>\n"
            "      <timestamp>2024-01-01T00:00:00Z</timestamp>\n"
            '      <text bytes="3" xml:space="preserve">Bbb</text>\n'
            "    </revision>\n"
            "  </page>\n"
        )
        _write_xml(self.input_file, [page1, page2, page3])
        manifest = self._run()
        rows = _read_jsonl(self.output_dir / "cookbook_pages.jsonl")
        self.assertEqual([r["page_id"] for r in rows], [1, 3])
        self.assertEqual(manifest["row_counts"]["parse_errors"], 1)
        self.assertEqual(manifest["row_counts"]["cookbook_pages_emitted"], 2)
        # The broken page still gets counted in total_pages_scanned (we
        # entered the page handler for it).
        self.assertEqual(manifest["row_counts"]["total_pages_scanned"], 3)

    # --- 10. Empty wikitext -------------------------------------------------
    def test_empty_wikitext(self) -> None:
        # Locked behavior (per task spec; "your call — pick one and lock it"):
        #   - wikitext_length = 0
        #   - plain_text_summary = "" (empty string, not null) for an article
        # Redirects still get null per the redirect skip rule.
        pages = [
            _make_page(
                page_id=1,
                title="Cookbook:Empty",
                text="",
                text_bytes=0,
            ),
        ]
        _write_xml(self.input_file, pages)
        self._run()
        rows = _read_jsonl(self.output_dir / "cookbook_pages.jsonl")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["wikitext_length"], 0)
        self.assertEqual(rows[0]["plain_text_summary"], "")
        self.assertEqual(rows[0]["categories"], [])
        self.assertFalse(rows[0]["is_redirect"])

    def test_text_bytes_attr_missing_falls_back_to_len(self) -> None:
        pages = [
            _make_page(
                page_id=1,
                title="Cookbook:Lenfallback",
                text="abcdef",
                omit_text_bytes_attr=True,
            ),
        ]
        _write_xml(self.input_file, pages)
        self._run()
        rows = _read_jsonl(self.output_dir / "cookbook_pages.jsonl")
        self.assertEqual(rows[0]["wikitext_length"], 6)

    # --- 11. Cross-chunk sort with chunk_rows=2 ----------------------------
    def test_cross_chunk_sort_with_five_pages(self) -> None:
        # Page IDs intentionally interleaved so a single in-memory sort would
        # NOT be sufficient — only the merge of all chunks gives correct
        # global order. With chunk_rows=2 and 5 pages the layout is:
        #     chunk 0: ids [50, 10]      sorted in chunk 0 -> [10, 50]
        #     chunk 1: ids [40, 20]      sorted in chunk 1 -> [20, 40]
        #     chunk 2: ids [30]          sorted in chunk 2 -> [30]
        # Heap-merge across chunks must produce [10, 20, 30, 40, 50].
        pages = [
            _make_page(page_id=50, title="Cookbook:E", text="Eee."),
            _make_page(page_id=10, title="Cookbook:A", text="Aaa."),
            _make_page(page_id=40, title="Cookbook:D", text="Ddd."),
            _make_page(page_id=20, title="Cookbook:B", text="Bbb."),
            _make_page(page_id=30, title="Cookbook:C", text="Ccc."),
        ]
        _write_xml(self.input_file, pages)
        self._run(chunk_rows=2)
        rows = _read_jsonl(self.output_dir / "cookbook_pages.jsonl")
        self.assertEqual([r["page_id"] for r in rows], [10, 20, 30, 40, 50])

    # --- Additional: manifest sha256 matches files -------------------------
    def test_manifest_sha256_matches_files(self) -> None:
        pages = [
            _make_page(page_id=1, title="Cookbook:A", text="Aaa."),
            _make_page(page_id=2, title="Cookbook:B", text="Bbb."),
        ]
        _write_xml(self.input_file, pages)
        self._run()
        manifest = json.loads(
            (self.output_dir / "manifest.json").read_text(encoding="utf-8")
        )
        recorded = manifest["outputs"]["cookbook_pages.jsonl"]["sha256"]
        actual = hashlib.sha256(
            (self.output_dir / "cookbook_pages.jsonl").read_bytes()
        ).hexdigest()
        self.assertEqual(recorded, actual)
        self.assertEqual(
            manifest["outputs"]["cookbook_pages.jsonl"]["bytes"],
            (self.output_dir / "cookbook_pages.jsonl").stat().st_size,
        )

    # --- Additional: stale tmp dir is swept on startup ---------------------
    def test_stale_tmp_dir_swept_on_startup(self) -> None:
        # Simulate an aborted prior run by creating a stale tmp dir under
        # the output dir. The normalizer must remove it before kicking off
        # a fresh run (and BEFORE the idempotency check, so a stale tmp
        # alongside valid outputs doesn't survive).
        self.output_dir.mkdir(parents=True, exist_ok=True)
        stale = self.output_dir / ".tmp_wikibooks_sort_aborted"
        stale.mkdir()
        (stale / "chunk-00000.tsv").write_text("garbage\n", encoding="utf-8")
        pages = [
            _make_page(page_id=1, title="Cookbook:A", text="Aaa."),
        ]
        _write_xml(self.input_file, pages)
        self._run()
        self.assertFalse(stale.exists(), "stale tmp dir should be swept")

    # --- Additional: outer except guard exercised --------------------------
    def test_outer_except_guard_isolates_one_bad_page(self) -> None:
        # Cover the broad `except Exception` around per-page processing
        # (normalize_wikibooks._stream_pages). The inline ValueError on <ns>
        # is caught by a narrower handler higher up, so it doesn't exercise
        # the outer guard. Here we monkeypatch _build_record to raise on a
        # specific page_id, asserting:
        #   - parse_errors increments by 1
        #   - that page is NOT in the JSONL
        #   - subsequent pages still emit
        #   - the streaming pipeline does not abort
        pages = [
            _make_page(page_id=1, title="Cookbook:A", text="Aaa."),
            _make_page(page_id=2, title="Cookbook:Boom", text="Bbb."),
            _make_page(page_id=3, title="Cookbook:C", text="Ccc."),
        ]
        _write_xml(self.input_file, pages)

        real_build_record = normalize_wikibooks._build_record

        def _build_record_with_explosion(*args, **kwargs):
            if kwargs.get("page_id") == 2:
                raise RuntimeError("synthetic build_record explosion")
            return real_build_record(*args, **kwargs)

        with patch.object(
            normalize_wikibooks,
            "_build_record",
            side_effect=_build_record_with_explosion,
        ):
            manifest = self._run()

        rows = _read_jsonl(self.output_dir / "cookbook_pages.jsonl")
        self.assertEqual([r["page_id"] for r in rows], [1, 3])
        self.assertEqual(manifest["row_counts"]["parse_errors"], 1)
        self.assertEqual(manifest["row_counts"]["cookbook_pages_emitted"], 2)
        self.assertEqual(manifest["row_counts"]["total_pages_scanned"], 3)

    # --- Additional: case-insensitive File/Image/Category handling ---------
    def test_case_insensitive_file_image_category_handling(self) -> None:
        # MediaWiki accepts any case combination of the namespace prefix on
        # File:/Image:/Category: links. Lock that all three regexes use
        # re.IGNORECASE rather than first-letter [Cc]/[Ff]/[Ii] classes.
        self.assertEqual(
            _extract_categories(
                "[[CATEGORY:Foo]] [[Category:Bar]] [[category:Baz]]"
            ),
            ["Foo", "Bar", "Baz"],
        )
        self.assertEqual(
            _wikitext_to_plain("[[FILE:x.png|caption]] text"),
            "text",
        )
        self.assertEqual(
            _wikitext_to_plain("[[IMAGE:y.jpg|nope]] hello"),
            "hello",
        )

    # --- Additional: CLI main path -----------------------------------------
    def test_cli_main(self) -> None:
        pages = [
            _make_page(page_id=1, title="Cookbook:A", text="Aaa."),
            _make_page(page_id=2, title="Cookbook:B", text="Bbb."),
        ]
        _write_xml(self.input_file, pages)
        rc = normalize_main([
            "--input-file", str(self.input_file),
            "--output-dir", str(self.output_dir),
            "--chunk-rows", "2",
        ])
        self.assertEqual(rc, 0)
        self.assertTrue((self.output_dir / "cookbook_pages.jsonl").exists())
        self.assertTrue((self.output_dir / "manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
