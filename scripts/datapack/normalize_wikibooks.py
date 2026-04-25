#!/usr/bin/env python3
"""
Lariat Data Pack — Wikibooks Cookbook normalizer (Task N3).

Streams the 902 MB MediaWiki XML dump (``enwikibooks-latest-pages-articles.xml``)
and emits a JSONL of Cookbook-namespace pages plus a manifest:

    data/lariat-data/normalized/wikibooks/
        cookbook_pages.jsonl  — one row per cookbook page, sorted by page_id
        manifest.json         — sha256, byte sizes, row counts, parse errors

Input (default):
    data/lariat-data/raw/wikibooks_cookbook/extracted/
        enwikibooks-latest-pages-articles.xml

The dump is too large to load — we use ``lxml.etree.iterparse`` with
``events=('end',)`` and ``tag={ns}page``, calling ``elem.clear()`` after
each page and ``del parent[0]`` to release the lxml internal element pool
(stdlib ElementTree doesn't free aggressively enough on a 900 MB doc).
Cookbook pages (ns=102) are emitted; everything else is counted and
skipped.

We use the same external-merge-sort idiom as ``normalize_off.py`` for
sort-by-page_id; with ~7,786 cookbook pages this is light, but mirroring
the pattern keeps the streaming guarantee end-to-end and gives us
deterministic output regardless of input ordering.
TODO: factor with normalize_{usda,off}.py — the chunk-flush/heapq.merge
pieces look like good shared sort helpers, but pulling that refactor in
mid-stream while a third consumer is being added makes the diff harder
to review. Defer.

Idempotent: if outputs already exist with manifest sha256 values that
match the on-disk file hashes, the script exits early. Pass --force to
rebuild.

CLI:
    python scripts/datapack/normalize_wikibooks.py
    python scripts/datapack/normalize_wikibooks.py --force
    python scripts/datapack/normalize_wikibooks.py --input-file /path/to/dump.xml \
                                                    --output-dir  /path/to/out
"""

from __future__ import annotations

import argparse
import hashlib
import heapq
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, TextIO

from lxml import etree


# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]
SYMLINK_PATH = REPO_ROOT / "data" / "lariat-data"
DIRECT_PATH = Path("/Volumes/Sean's SSD/lariat-data")


def _default_data_root() -> Path:
    if SYMLINK_PATH.exists():
        return SYMLINK_PATH.resolve()
    if DIRECT_PATH.exists():
        return DIRECT_PATH
    return SYMLINK_PATH


def _default_input_file() -> Path:
    return (
        _default_data_root()
        / "raw"
        / "wikibooks_cookbook"
        / "extracted"
        / "enwikibooks-latest-pages-articles.xml"
    )


def _default_output_dir() -> Path:
    return _default_data_root() / "normalized" / "wikibooks"


# ---------------------------------------------------------------------------
# Schema constants
# ---------------------------------------------------------------------------

# MediaWiki XML export 0.11 namespace. The dump's root <mediawiki> element
# declares xmlns="http://www.mediawiki.org/xml/export-0.11/" and every
# child inherits it; lxml exposes elements as Clark-notation tag names.
MW_NS = "http://www.mediawiki.org/xml/export-0.11/"
PAGE_TAG = f"{{{MW_NS}}}page"
TITLE_TAG = f"{{{MW_NS}}}title"
NS_TAG = f"{{{MW_NS}}}ns"
ID_TAG = f"{{{MW_NS}}}id"
REDIRECT_TAG = f"{{{MW_NS}}}redirect"
REVISION_TAG = f"{{{MW_NS}}}revision"
TEXT_TAG = f"{{{MW_NS}}}text"

# Cookbook namespace key.
COOKBOOK_NS = 102

# Title prefix to strip when computing the slug. The Cookbook namespace
# canonical prefix is "Cookbook:" (note: no space).
COOKBOOK_PREFIX = "Cookbook:"

# Plain-text summary length (hard slice, no word-boundary handling — keeps
# output deterministic).
SUMMARY_MAX_CHARS = 500

# External-merge-sort chunk size. Cookbook is ~7.8k pages so a single chunk
# easily fits, but keeping the chunked path live means tests with
# chunk_rows=2 exercise the same merge logic the production run uses.
CHUNK_ROWS = 2_000


# ---------------------------------------------------------------------------
# Small helpers (mirrored from normalize_off.py / normalize_usda.py — the
# shared-helpers refactor is explicitly deferred; see module docstring).
# ---------------------------------------------------------------------------


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for buf in iter(lambda: f.read(1 << 20), b""):
            h.update(buf)
    return h.hexdigest()


def _atomic_write_text(path: Path, text: str) -> None:
    """Write atomically: write to .tmp, fsync, os.replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _atomic_replace(tmp: Path, final: Path) -> None:
    final.parent.mkdir(parents=True, exist_ok=True)
    os.replace(tmp, final)


# ---------------------------------------------------------------------------
# Wikitext extraction
# ---------------------------------------------------------------------------

# Match a MediaWiki Category link: [[Category:Foo]] or [[Category:Foo|sortkey]].
# Case-insensitive — MediaWiki accepts any case combination of the namespace
# prefix (e.g. CATEGORY:, Category:, category:, cAtEgOrY:).
_CATEGORY_RE = re.compile(
    r"\[\[\s*category\s*:\s*([^\]\|]+?)\s*(?:\|[^\]]*)?\]\]",
    re.IGNORECASE,
)

# Match File:/Image: links — these may have nested brackets in the caption
# (e.g. [[File:x.png|thumb|See [[Foo]]]]). We use a simple regex that does NOT
# handle nesting; the wikitext stripper below handles nested brackets only
# inside templates ({{...}}) since File/Image captions in Cookbook pages are
# usually flat. If they aren't, the outer regex eats up to the first `]]`
# which leaves the trailing `]]` unbalanced — which our `[^\]]*` link regex
# below will not touch and our HTML/header passes will then ignore. Good
# enough for a 500-char summary.
# Case-insensitive — MediaWiki accepts FILE:, file:, fIlE:, etc.
_FILE_LINK_RE = re.compile(
    r"\[\[\s*(?:file|image)\s*:[^\[\]]*?\]\]",
    re.IGNORECASE,
)

# Match a "drop entirely" Category link form (different from _CATEGORY_RE
# which captures for output). Same shape, but used for stripping.
# Case-insensitive — see _CATEGORY_RE.
_CATEGORY_DROP_RE = re.compile(
    r"\[\[\s*category\s*:[^\]]*\]\]",
    re.IGNORECASE,
)

# Match wikilinks: [[Target]] or [[Target|Display]]. Captures the display
# text (group 2 if present, else group 1). Won't match File:/Image:/Category:
# because we strip those first.
_LINK_RE = re.compile(r"\[\[\s*([^\[\]\|]+?)\s*(?:\|\s*([^\[\]]*?)\s*)?\]\]")

# Match <ref ...>...</ref> and self-closing <ref .../>.
_REF_RE = re.compile(r"<ref\b[^>]*/>|<ref\b[^>]*>.*?</ref>", re.DOTALL | re.IGNORECASE)

# Match HTML-ish tags (after we've handled <ref>).
_HTML_TAG_RE = re.compile(r"<[^>]+>")

# Match section headers: == Header ==, === Header ===, etc. (any number of
# `=` >= 2). Keeps the captured header text.
_HEADER_RE = re.compile(r"^[ \t]*={2,}\s*(.+?)\s*={2,}[ \t]*$", re.MULTILINE)

# Matches a `#REDIRECT [[Target]]` line at start of wikitext (case-insensitive,
# with optional whitespace and an optional `:` after the `#REDIRECT`).
_WIKITEXT_REDIRECT_RE = re.compile(
    r"^\s*#\s*REDIRECT\s*:?\s*\[\[\s*([^\]\|]+?)\s*(?:\|[^\]]*)?\]\]",
    re.IGNORECASE,
)


def _strip_templates(text: str) -> str:
    """Drop everything inside ``{{...}}`` template invocations.

    Tracks brace depth manually so nested templates like
    ``{{outer|{{inner}}}}`` are removed atomically. The regex-only approach
    fails on nesting; this two-pointer scan is O(n) and simple.
    """
    out: list[str] = []
    depth = 0
    i = 0
    n = len(text)
    while i < n:
        # Opening "{{"
        if i + 1 < n and text[i] == "{" and text[i + 1] == "{":
            depth += 1
            i += 2
            continue
        # Closing "}}"
        if i + 1 < n and text[i] == "}" and text[i + 1] == "}":
            if depth > 0:
                depth -= 1
                i += 2
                continue
            # Stray }} with no opener — drop the two chars and move on so we
            # don't leave them in the summary.
            i += 2
            continue
        if depth == 0:
            out.append(text[i])
        i += 1
    return "".join(out)


def _replace_links(text: str) -> str:
    """Replace [[Target|Display]] with Display, [[Target]] with Target.

    Categories and File/Image links should already have been stripped before
    this is called.
    """
    def _sub(m: re.Match[str]) -> str:
        target = m.group(1)
        display = m.group(2)
        return display if display else target

    return _LINK_RE.sub(_sub, text)


def _wikitext_to_plain(text: str) -> str:
    """Apply the strip rules in order; collapse whitespace; truncate to 500.

    Order matters: drop templates (which may contain `[[File:...]]`-like
    syntax internally), then drop category/file/image links, then replace
    remaining wikilinks with display text, then drop refs and HTML tags,
    then strip header markup, then collapse whitespace.
    """
    s = _strip_templates(text)
    s = _CATEGORY_DROP_RE.sub("", s)
    s = _FILE_LINK_RE.sub("", s)
    s = _replace_links(s)
    s = _REF_RE.sub("", s)
    s = _HTML_TAG_RE.sub("", s)
    s = _HEADER_RE.sub(r"\1", s)
    # Collapse all whitespace runs (including newlines) to single space.
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) > SUMMARY_MAX_CHARS:
        s = s[:SUMMARY_MAX_CHARS]
    return s


def _extract_categories(text: str) -> list[str]:
    """Return [Category:Foo] names in first-occurrence order, deduped.

    De-dup uses a `seen` set; ordering is preserved so semantic ordering
    (the page's primary category usually appears first in the wikitext)
    survives.
    """
    seen: set[str] = set()
    out: list[str] = []
    for m in _CATEGORY_RE.finditer(text):
        name = m.group(1).strip()
        if not name:
            continue
        if name in seen:
            continue
        seen.add(name)
        out.append(name)
    return out


# ---------------------------------------------------------------------------
# Page record building
# ---------------------------------------------------------------------------


def _build_record(
    page_id: int,
    title: str,
    is_redirect: bool,
    redirect_target: str | None,
    wikitext: str,
    text_bytes: int | None,
) -> dict:
    """Assemble a single cookbook_pages row from already-extracted fields.

    Caller is responsible for namespace filtering and parse-error handling;
    this is a pure shape function.
    """
    slug = title[len(COOKBOOK_PREFIX):] if title.startswith(COOKBOOK_PREFIX) else title

    # If the <text bytes="..."> attr is absent, fall back to len(text).
    if text_bytes is None:
        text_bytes = len(wikitext)

    # Redirect detection via wikitext fallback. Spec: "is_redirect = true if
    # the <redirect> element is present OR if the wikitext starts with
    # #REDIRECT [[...]]". So we union the two signals.
    if not is_redirect:
        m = _WIKITEXT_REDIRECT_RE.match(wikitext)
        if m is not None:
            is_redirect = True
            if redirect_target is None:
                redirect_target = m.group(1).strip()

    if is_redirect:
        # Spec: "Skip the wikitext for redirect pages — plain_text_summary
        # for redirects is null." Categories on a redirect page (rare but
        # possible) are still extracted to preserve any sort-key signal.
        plain_summary: str | None = None
        categories = _extract_categories(wikitext)
    else:
        categories = _extract_categories(wikitext)
        plain_summary = _wikitext_to_plain(wikitext) if wikitext else ""

    source_url = "https://en.wikibooks.org/wiki/" + title.replace(" ", "_")

    return {
        "page_id": page_id,
        "title": title,
        "slug": slug,
        "is_redirect": is_redirect,
        "redirect_target": redirect_target,
        "categories": categories,
        "wikitext_length": text_bytes,
        "plain_text_summary": plain_summary,
        "source_url": source_url,
    }


# ---------------------------------------------------------------------------
# Streaming + external merge sort
# ---------------------------------------------------------------------------


def _stream_pages(
    input_file: Path,
    counters: dict[str, int],
) -> Iterator[tuple[int, str]]:
    """Stream the XML and yield (page_id, json_line) for each cookbook page.

    Uses ``iterparse`` with the ``end`` event on ``<page>`` only. Frees the
    element and any older siblings in the parent's children list after each
    page, so memory stays bounded regardless of input size. Stdlib's
    ElementTree has the same `clear()` method but doesn't release the parent
    pool; lxml does, which is why this normalizer mandates lxml.

    Mutates ``counters`` in place:
        total_pages_scanned       — every <page> consumed (any namespace)
        cookbook_pages_emitted    — cookbook rows yielded
        cookbook_articles         — emitted rows where is_redirect is False
        cookbook_redirects        — emitted rows where is_redirect is True
        non_cookbook_skipped      — pages whose <ns> != 102
        parse_errors              — pages we couldn't parse fully (non-fatal)
    """
    # recover=True lets the parser continue past minor XML errors; we still
    # catch per-page exceptions below since `recover` doesn't help if the
    # malformation is structural enough to reach our handler.
    context = etree.iterparse(
        str(input_file),
        events=("end",),
        tag=PAGE_TAG,
        recover=True,
        huge_tree=True,
    )

    try:
        for _event, elem in context:
            counters["total_pages_scanned"] += 1
            try:
                ns_el = elem.find(NS_TAG)
                if ns_el is None or ns_el.text is None:
                    counters["non_cookbook_skipped"] += 1
                    continue
                try:
                    ns_val = int(ns_el.text)
                except ValueError:
                    counters["parse_errors"] += 1
                    continue
                if ns_val != COOKBOOK_NS:
                    counters["non_cookbook_skipped"] += 1
                    continue

                title_el = elem.find(TITLE_TAG)
                title = (title_el.text or "") if title_el is not None else ""

                # Page id is the first <id> child of <page>, NOT the <id>
                # nested under <revision>. find() returns the first match in
                # document order; since <id> appears before <revision>,
                # find(ID_TAG) returns the page id.
                pid_el = elem.find(ID_TAG)
                if pid_el is None or pid_el.text is None:
                    counters["parse_errors"] += 1
                    continue
                try:
                    page_id = int(pid_el.text)
                except ValueError:
                    counters["parse_errors"] += 1
                    continue

                redirect_el = elem.find(REDIRECT_TAG)
                is_redirect = redirect_el is not None
                redirect_target: str | None = None
                if is_redirect:
                    redirect_target = redirect_el.get("title") or None

                rev_el = elem.find(REVISION_TAG)
                wikitext = ""
                text_bytes: int | None = None
                if rev_el is not None:
                    text_el = rev_el.find(TEXT_TAG)
                    if text_el is not None:
                        wikitext = text_el.text or ""
                        bytes_attr = text_el.get("bytes")
                        if bytes_attr is not None:
                            try:
                                text_bytes = int(bytes_attr)
                            except ValueError:
                                text_bytes = None

                record = _build_record(
                    page_id=page_id,
                    title=title,
                    is_redirect=is_redirect,
                    redirect_target=redirect_target,
                    wikitext=wikitext,
                    text_bytes=text_bytes,
                )
                # Recompute is_redirect after _build_record (wikitext fallback
                # may have flipped it) so the manifest counter stays honest.
                if record["is_redirect"]:
                    counters["cookbook_redirects"] += 1
                else:
                    counters["cookbook_articles"] += 1
                counters["cookbook_pages_emitted"] += 1

                line = json.dumps(record, ensure_ascii=False, sort_keys=True)
                yield page_id, line
            except Exception as exc:
                # Per spec: log the page_id (or '?') and continue. Keep the
                # message short so a malformed dump doesn't flood stdout.
                counters["parse_errors"] += 1
                pid_repr = "?"
                try:
                    pid_el = elem.find(ID_TAG)
                    if pid_el is not None and pid_el.text:
                        pid_repr = pid_el.text
                except Exception:
                    pass
                print(
                    f"  WARN: parse error on page id={pid_repr}: {type(exc).__name__}: {exc}",
                    file=sys.stderr,
                )
            finally:
                # Free this page and any older siblings still attached to
                # the parent. The "del parent[0]" loop is the canonical lxml
                # idiom for fast iterparse — without it, the parent (here:
                # <mediawiki>) accumulates references to every cleared page
                # element and RSS grows linearly with the dump size.
                elem.clear()
                parent = elem.getparent()
                if parent is not None:
                    while elem.getprevious() is not None:
                        del parent[0]
    finally:
        # Release the iterparse context and any remaining lxml internals.
        del context


def _flush_chunk(buf: list[tuple[int, str]], tmp_dir: Path, idx: int) -> Path:
    """Sort chunk by ``page_id`` and flush to a TSV file.

    Chunk format per line: ``page_id<TAB>json_line`` with embedded tabs in
    the json escaped as ``\\t`` (json.dumps single-line output rarely
    contains real tabs but we escape defensively).
    """
    buf.sort(key=lambda t: t[0])
    cp = tmp_dir / f"chunk-{idx:05d}.tsv"
    with open(cp, "w", encoding="utf-8") as f:
        for pid, line in buf:
            safe_line = line.replace("\t", "\\t")
            f.write(f"{pid}\t{safe_line}\n")
    return cp


def _read_chunk(fh: TextIO, chunk_idx: int) -> Iterator[tuple[int, int, str]]:
    """Iterate (page_id, chunk_idx, json_line) tuples from a chunk file.

    ``chunk_idx`` is the chunk's ordinal (= flush order = source-file
    order). page_ids are unique within a single XML dump (Wikibooks IDs are
    monotonic), but including chunk_idx in the merge key gives heapq.merge a
    stable secondary key for any pathological future input where IDs
    collide.
    """
    for raw in fh:
        if not raw:
            continue
        line = raw[:-1] if raw.endswith("\n") else raw
        parts = line.split("\t", 1)
        if len(parts) != 2:
            continue
        pid_s, body = parts
        body = body.replace("\\t", "\t")
        try:
            pid = int(pid_s)
        except ValueError:
            continue
        yield pid, chunk_idx, body


def _external_sort(
    input_file: Path,
    out_path: Path,
    counters: dict[str, int],
    chunk_rows: int,
) -> int:
    """External merge sort by page_id. Returns the emitted-row count.

    Mirrors normalize_off.py's pattern: stream pages into in-memory buffer,
    flush sorted chunks to a temp dir, heapq.merge them into the final
    output. Final output is byte-identical across runs (no generated_at in
    the JSONL itself).
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_dir = Path(tempfile.mkdtemp(
        prefix=".tmp_wikibooks_sort_", dir=str(out_path.parent)
    ))
    chunk_paths: list[Path] = []
    emitted = 0

    try:
        buf: list[tuple[int, str]] = []
        for pid, line in _stream_pages(input_file, counters):
            buf.append((pid, line))
            if len(buf) >= chunk_rows:
                chunk_paths.append(_flush_chunk(buf, tmp_dir, len(chunk_paths)))
                buf = []
        if buf:
            chunk_paths.append(_flush_chunk(buf, tmp_dir, len(chunk_paths)))
            buf = []

        readers: list[TextIO] = []
        try:
            iters = []
            for i, cp in enumerate(chunk_paths):
                fh = open(cp, "r", encoding="utf-8")
                readers.append(fh)
                iters.append(_read_chunk(fh, i))

            tmp_out = out_path.with_suffix(out_path.suffix + ".tmp")
            with open(tmp_out, "w", encoding="utf-8") as out_f:
                # heapq.merge sorts on natural tuple ordering: (page_id,
                # chunk_idx, json_line). Wikibooks IDs are unique, so the
                # secondary key never breaks ties in practice — see
                # _read_chunk docstring.
                for _pid, _chunk_idx, json_line in heapq.merge(*iters):
                    out_f.write(json_line)
                    out_f.write("\n")
                    emitted += 1
                out_f.flush()
                os.fsync(out_f.fileno())
        finally:
            for r in readers:
                r.close()
        _atomic_replace(tmp_out, out_path)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return emitted


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------


def _build_manifest(
    input_file: Path,
    output_dir: Path,
    counters: dict[str, int],
) -> dict:
    pages_path = output_dir / "cookbook_pages.jsonl"
    outputs = {
        "cookbook_pages.jsonl": {
            "sha256": _sha256_file(pages_path),
            "bytes": pages_path.stat().st_size,
        },
    }
    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "input_file": str(input_file),
        "input_bytes": input_file.stat().st_size,
        "row_counts": {
            "total_pages_scanned": counters.get("total_pages_scanned", 0),
            "cookbook_pages_emitted": counters.get("cookbook_pages_emitted", 0),
            "cookbook_articles": counters.get("cookbook_articles", 0),
            "cookbook_redirects": counters.get("cookbook_redirects", 0),
            "non_cookbook_skipped": counters.get("non_cookbook_skipped", 0),
            "parse_errors": counters.get("parse_errors", 0),
        },
        "outputs": outputs,
    }


def _is_already_normalized(output_dir: Path) -> bool:
    """True if manifest exists and its sha256 values match on-disk files."""
    manifest_path = output_dir / "manifest.json"
    pages_path = output_dir / "cookbook_pages.jsonl"
    if not (manifest_path.exists() and pages_path.exists()):
        return False
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    outputs = manifest.get("outputs") or {}
    expected = (outputs.get("cookbook_pages.jsonl") or {}).get("sha256")
    if not expected:
        return False
    return _sha256_file(pages_path) == expected


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def normalize(
    input_file: Path,
    output_dir: Path,
    *,
    force: bool = False,
    chunk_rows: int = CHUNK_ROWS,
) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)

    # Sweep stale external-sort tmp dirs from prior aborted runs (SIGKILL,
    # OOM, kernel termination skip our try/finally cleanup). Always sweep
    # regardless of --force or idempotency state.
    for stale in output_dir.glob(".tmp_wikibooks_sort_*"):
        print(f"  cleaning stale tmp dir: {stale.name}")
        shutil.rmtree(stale, ignore_errors=True)

    if not force and _is_already_normalized(output_dir):
        manifest = json.loads(
            (output_dir / "manifest.json").read_text(encoding="utf-8")
        )
        print(f"✓ already normalized — outputs match manifest sha256 in {output_dir}")
        return manifest

    print(f"Lariat Wikibooks Cookbook normalizer")
    print(f"  input : {input_file}")
    print(f"  output: {output_dir}")

    counters: dict[str, int] = {
        "total_pages_scanned": 0,
        "cookbook_pages_emitted": 0,
        "cookbook_articles": 0,
        "cookbook_redirects": 0,
        "non_cookbook_skipped": 0,
        "parse_errors": 0,
    }

    print("  building cookbook_pages.jsonl (streaming iterparse + external merge sort by page_id)...")
    pages_path = output_dir / "cookbook_pages.jsonl"
    emitted = _external_sort(input_file, pages_path, counters, chunk_rows=chunk_rows)
    print(
        f"    wrote {emitted} rows  "
        f"(scanned: {counters['total_pages_scanned']}, "
        f"non-cookbook: {counters['non_cookbook_skipped']}, "
        f"parse errors: {counters['parse_errors']}) -> {pages_path}"
    )

    print("  writing manifest.json...")
    manifest = _build_manifest(input_file, output_dir, counters)
    manifest_path = output_dir / "manifest.json"
    _atomic_write_text(
        manifest_path,
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
    )
    print(f"    wrote {manifest_path}")
    print("  ✓ done")
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Normalize Wikibooks Cookbook MediaWiki XML to JSONL.",
    )
    parser.add_argument(
        "--input-file",
        type=Path,
        default=None,
        help=(
            "MediaWiki XML dump. "
            "Default: data/lariat-data/raw/wikibooks_cookbook/extracted/"
            "enwikibooks-latest-pages-articles.xml"
        ),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Output directory. Default: data/lariat-data/normalized/wikibooks",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Ignore existing manifest and rebuild from scratch.",
    )
    parser.add_argument(
        "--chunk-rows",
        type=int,
        default=CHUNK_ROWS,
        help=f"External-sort chunk size (default: {CHUNK_ROWS}).",
    )
    args = parser.parse_args(argv)

    input_file = args.input_file or _default_input_file()
    output_dir = args.output_dir or _default_output_dir()

    if not input_file.exists():
        print(f"ERROR: input file does not exist: {input_file}", file=sys.stderr)
        return 2

    normalize(
        input_file=input_file,
        output_dir=output_dir,
        force=args.force,
        chunk_rows=args.chunk_rows,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
