#!/usr/bin/env python3
"""
Lariat Data Pack — FDA Food Code 2022 normalizer (Task N4).

Extracts the FDA Food Code 2022 PDF and emits a per-section JSONL stream
for downstream FTS5 + embeddings indexing. The Food Code is a 668-page
regulatory document organized into Chapters (1–8) plus Annexes (1–7),
with sections numbered like ``3-501.14`` (chapter-section.subsection).

Output (atomic):
    data/lariat-data/normalized/fda_food_code/
        sections.jsonl  — one row per section, ordered by appearance
        manifest.json   — input sha256, byte sizes, row counts

Section row schema:
    {
        "section_id":   "3-501.15",      # nullable for free-form sections
        "title":        "Cooling Methods",
        "chapter":      "Chapter 3. Food",
        "annex":        null | "Annex 3. Public Health Reasons/...",
        "body":         "<paragraph text>...",
        "char_count":   1234,
        "page_start":   401,
        "page_end":     402
    }

The PDF has consistent running headers like
"FDA Food Code 2022 Chapter 3. Food" / "Annex 3. Public Health Reasons/..."
which we strip out before chunking. Section headers on a content line look
like "3-501.15 Cooling Methods." — a section_id matching ``\\d-\\d+\\.\\d+``
followed by a title and a sentence-ending period. Free-form prose between
sections (e.g. introductory paragraphs in Annex 3) is captured as a
section row with section_id=None and the surrounding chapter/annex set.

Idempotency: if manifest.json records the same sha256 for the input PDF,
the script exits early. Pass ``--force`` to rebuild.

CLI:
    python scripts/datapack/normalize_fda_food_code.py
    python scripts/datapack/normalize_fda_food_code.py --force
    python scripts/datapack/normalize_fda_food_code.py \\
        --input-file /path/to/FDA_Food_Code_2022.pdf \\
        --output-dir  /path/to/out
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scripts.datapack._io import (  # noqa: E402
    atomic_replace as _atomic_replace,
    atomic_write_text as _atomic_write_text,
    default_data_root as _default_data_root,
    human_bytes as _human_bytes,
    sha256_file as _sha256_file,
)


def _default_input_file() -> Path:
    return (
        _default_data_root()
        / "raw"
        / "fda_food_code"
        / "pdf"
        / "FDA_Food_Code_2022.pdf"
    )


def _default_output_dir() -> Path:
    return _default_data_root() / "normalized" / "fda_food_code"


# ---------------------------------------------------------------------------
# Page-level extraction
# ---------------------------------------------------------------------------


# Each page has a header like "FDA Food Code 2022 Chapter 3. Food" or
# "FDA Food Code 2022 Annex 3. Public Health Reasons/Administrative
# Guidelines". The header is the first non-empty line. We strip it during
# extraction so it doesn't leak into section bodies.
_HEADER_RE = re.compile(
    r"""^FDA\ Food\ Code\ 2022\s+
        (?:
            (?P<chapter>Chapter\s+\d+(?:\.|\.\s+)[^\n]+)
          | (?P<annex>Annex\s+\d+(?:\.|\.\s+)[^\n]+)
          | (?P<preface>Preface[^\n]*)
          | (?P<other>[^\n]+)
        )$""",
    re.VERBOSE,
)

# Section heading line. Section IDs look like 3-501.15 / 8-907.40 / 2-201.13.
# A heading line is a section ID followed by a title. The Annex 3 prose
# version has a sentence-ending period ("3-501.15 Cooling Methods.") but
# the cross-references in Annex 7 / late-annex tables drop the period
# ("8-304.11 Responsibility of the Permit Holder"). The trailing period is
# optional but the title still has to start uppercase to avoid matching
# inline citations like "as in 3-501.15" mid-paragraph.
_SECTION_HEADER_RE = re.compile(
    r"""^\s*
        (?P<id>\d-\d+\.\d+)\s+         # section id
        (?P<title>[A-Z][^\n]*?)        # title starts uppercase, lazy match
        \.?\s*$""",                    # optional period + optional ws
    re.VERBOSE,
)

# Some chapter/annex titles also appear as section_id=None entries —
# capture the first content paragraph as a row tied to the chapter.

# Page numbering: most pages have a footer "X-N" where X is the chapter
# number (e.g., "3-12" on chapter-3 pages) or arabic numerals on annex
# pages. We don't parse the footers — pdfplumber gives us page indexes
# already, which is what the manifest uses for page_start/page_end.


def _extract_pages(pdf_path: Path) -> Iterator[tuple[int, str | None]]:
    """Yield (page_number, header_string_or_None) and the body text per
    page. We yield (page_number, body) — header lookup is done by
    ``_iter_pages_with_chapter`` below."""
    import pdfplumber  # heavy import — local

    with pdfplumber.open(str(pdf_path)) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            yield i, text


def _split_header(text: str) -> tuple[str | None, str]:
    """Pop the FDA Food Code page header off the top of a page's text.
    Returns (header_line_or_None, body_without_header)."""
    if not text:
        return None, ""
    lines = text.splitlines()
    # Skip leading blanks
    j = 0
    while j < len(lines) and not lines[j].strip():
        j += 1
    if j >= len(lines):
        return None, ""
    candidate = lines[j].strip()
    if candidate.startswith("FDA Food Code 2022"):
        # Drop this header line; rejoin the rest.
        return candidate, "\n".join(lines[j + 1 :])
    return None, "\n".join(lines)


def _classify_header(header: str | None) -> tuple[str | None, str | None]:
    """Map a page header to (chapter, annex). One of the two will be set
    when we recognize the page; both stay None for cover/TOC/etc."""
    if not header:
        return None, None
    m = _HEADER_RE.match(header)
    if not m:
        return None, None
    if m.group("chapter"):
        return m.group("chapter").strip(), None
    if m.group("annex"):
        return None, m.group("annex").strip()
    # Preface and other front-matter pages — chapter/annex stay None.
    return None, None


# ---------------------------------------------------------------------------
# Section assembly
# ---------------------------------------------------------------------------


def _assemble_sections(pdf_path: Path) -> list[dict[str, Any]]:
    """Walk page-by-page, group lines into sections keyed by header
    pattern. Each yielded section captures (section_id, title, chapter,
    annex, body, page_start, page_end)."""
    sections: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    def _flush():
        if current is None:
            return
        body = "\n".join(current["_body_lines"]).strip()
        if not body and not current.get("section_id"):
            # Skip empty unheaded sections
            return
        sections.append(
            {
                "section_id": current.get("section_id"),
                "title": current.get("title"),
                "chapter": current.get("chapter"),
                "annex": current.get("annex"),
                "body": body,
                "char_count": len(body),
                "page_start": current.get("page_start"),
                "page_end": current.get("page_end"),
            }
        )

    last_chapter: str | None = None
    last_annex: str | None = None

    for page_no, raw in _extract_pages(pdf_path):
        header, body = _split_header(raw)
        chap, annex = _classify_header(header)
        ctx_changed = False
        if chap is not None and chap != last_chapter:
            last_chapter, last_annex = chap, None
            ctx_changed = True
        elif annex is not None and annex != last_annex:
            last_chapter, last_annex = None, annex
            ctx_changed = True
        # On a chapter / annex transition, close the running section so it
        # can't span across boundaries. Without this, a section that fails
        # to find its terminator (e.g. because the late annexes are not
        # numbered) absorbs every page until EOF.
        if ctx_changed and current is not None:
            _flush()
            current = None

        for line in body.splitlines():
            sm = _SECTION_HEADER_RE.match(line)
            if sm:
                # Close the previous section, open a new one.
                _flush()
                current = {
                    "section_id": sm.group("id"),
                    "title": sm.group("title").strip(),
                    "chapter": last_chapter,
                    "annex": last_annex,
                    "page_start": page_no,
                    "page_end": page_no,
                    "_body_lines": [],
                }
            else:
                if current is None:
                    # Unheaded prelude content — open a free-form section.
                    current = {
                        "section_id": None,
                        "title": None,
                        "chapter": last_chapter,
                        "annex": last_annex,
                        "page_start": page_no,
                        "page_end": page_no,
                        "_body_lines": [],
                    }
                current["_body_lines"].append(line)
                current["page_end"] = page_no

    _flush()
    return sections


# ---------------------------------------------------------------------------
# Manifest helpers
# ---------------------------------------------------------------------------


def _read_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _is_up_to_date(
    manifest: dict[str, Any], output_dir: Path, input_sha: str
) -> bool:
    sections_file = output_dir / "sections.jsonl"
    return sections_file.exists() and manifest.get("input_sha256") == input_sha


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------


def normalize(
    *,
    input_file: Path,
    output_dir: Path,
    force: bool = False,
) -> dict[str, Any]:
    if not input_file.exists():
        raise FileNotFoundError(f"Input PDF missing: {input_file}")

    output_dir.mkdir(parents=True, exist_ok=True)
    sections_path = output_dir / "sections.jsonl"
    manifest_path = output_dir / "manifest.json"

    print(f"  hashing input PDF ({_human_bytes(input_file.stat().st_size)})…")
    input_sha = _sha256_file(input_file)

    if not force:
        prev = _read_manifest(manifest_path)
        if _is_up_to_date(prev, output_dir, input_sha):
            print(
                f"  ✓ Up to date — manifest sha256 matches input "
                f"({prev.get('rows', '?')} sections)."
            )
            return prev

    print("  parsing PDF and assembling sections…")
    t0 = time.time()
    sections = _assemble_sections(input_file)
    elapsed = time.time() - t0
    n_with_id = sum(1 for s in sections if s.get("section_id"))
    n_total = len(sections)
    print(
        f"  ✓ Extracted {n_total:,} sections "
        f"({n_with_id:,} with section_id) in {elapsed:.1f}s"
    )

    # Atomic write: stage to .tmp, fsync, rename.
    tmp_path = sections_path.with_suffix(sections_path.suffix + ".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        for row in sections:
            f.write(json.dumps(row, ensure_ascii=False, sort_keys=True))
            f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    _atomic_replace(tmp_path, sections_path)

    output_sha = _sha256_file(sections_path)
    manifest = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "input_file": input_file.name,
        "input_sha256": input_sha,
        "input_bytes": input_file.stat().st_size,
        "outputs": {
            "sections.jsonl": {
                "bytes": sections_path.stat().st_size,
                "sha256": output_sha,
            }
        },
        "rows": n_total,
        "rows_with_section_id": n_with_id,
        "rows_without_section_id": n_total - n_with_id,
        "elapsed_seconds": round(elapsed, 2),
    }
    _atomic_write_text(manifest_path, json.dumps(manifest, indent=2, sort_keys=True))
    print(f"  ✓ Wrote {sections_path} ({_human_bytes(sections_path.stat().st_size)})")
    return manifest


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Normalize the FDA Food Code 2022 PDF into JSONL sections."
    )
    p.add_argument(
        "--input-file",
        type=Path,
        default=_default_input_file(),
        help="Path to FDA_Food_Code_2022.pdf. "
        "Default: data/lariat-data/raw/fda_food_code/pdf/FDA_Food_Code_2022.pdf",
    )
    p.add_argument(
        "--output-dir",
        type=Path,
        default=_default_output_dir(),
        help="Directory to write sections.jsonl + manifest.json into. "
        "Default: data/lariat-data/normalized/fda_food_code",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Ignore existing manifest and rebuild from scratch.",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    print("Lariat Data Pack — FDA Food Code 2022 normalizer")
    print(f"  input_file: {args.input_file}")
    print(f"  output_dir: {args.output_dir}")
    if args.force:
        print("  force: rebuild requested")
    normalize(
        input_file=args.input_file, output_dir=args.output_dir, force=args.force
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
