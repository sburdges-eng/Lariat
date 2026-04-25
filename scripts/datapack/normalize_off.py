#!/usr/bin/env python3
"""
Lariat Data Pack — Open Food Facts (OFF) normalizer (Task N2).

Streams the 12.88 GB Open Food Facts TSV dump (despite the .csv extension,
OFF ships tab-separated values) and emits two normalized outputs plus a
manifest:

    data/lariat-data/normalized/openfoodfacts/
        branded_products.jsonl  — one row per product, sorted by code asc
        allergens.json          — aggregated allergen + traces token counts
        manifest.json           — sha256, byte sizes, row counts

Input (default):
    data/lariat-data/raw/openfoodfacts/extracted/openfoodfacts_products.csv

The dump has ~3M rows and 210 columns; loading it into memory is not viable.
We stream with csv.reader, write sorted chunks of CHUNK_ROWS to disk, then
heapq.merge them into the final JSONL — same external-merge-sort pattern
used by ``scripts/datapack/normalize_usda.py`` for the nutrients table.
TODO: factor with normalize_usda.py — the chunk-flush/heapq.merge pieces
look like good shared sort helpers, but mixing that refactor with the
streaming TSV consumer for OFF makes the diff harder to review. Pull it
out in a follow-up.

Idempotent: if outputs already exist with manifest sha256 values that match
the on-disk file hashes, the script exits early. Pass --force to rebuild.

CLI:
    python scripts/datapack/normalize_off.py
    python scripts/datapack/normalize_off.py --force
    python scripts/datapack/normalize_off.py --input-file /path/to/off.csv \
                                             --output-dir  /path/to/out
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import heapq
import json
import os
import shutil
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, TextIO

# OFF ingredients_text + categories_tags can be very long.
csv.field_size_limit(sys.maxsize)


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
        / "openfoodfacts"
        / "extracted"
        / "openfoodfacts_products.csv"
    )


def _default_output_dir() -> Path:
    return _default_data_root() / "normalized" / "openfoodfacts"


# ---------------------------------------------------------------------------
# Schema constants
# ---------------------------------------------------------------------------

# Output JSONL field order (sort_keys=True is used on each row, but we list
# the canonical schema here so the documentation and tests have something
# to point at).
PRODUCT_SCHEMA: tuple[str, ...] = (
    "code",
    "product_name",
    "brands",
    "brand_owner",
    "categories_tags",
    "allergens_tags",
    "traces_tags",
    "ingredients_text",
    "serving_size",
    "nutriscore_grade",
    "countries_en",
    "source_url",
)

# Column resolution: each output field is sourced from the FIRST header name
# in this list that is present in the input header. Most are 1:1 but the
# allergens / traces columns vary across OFF dumps:
#   - older dumps had `allergens_tags` / `traces_tags` (canonical en: form)
#   - the current dump exposes `allergens` (canonical) and `traces_tags`
#     (canonical), with `allergens_en` blank
# We prefer the `_tags` variant when it exists, else the base name. Both
# store the same comma-separated `en:foo,en:bar` token format.
COLUMN_CANDIDATES: dict[str, tuple[str, ...]] = {
    "code":             ("code",),
    "source_url":       ("url",),
    "product_name":     ("product_name",),
    "brands":           ("brands",),
    "categories_tags":  ("categories_tags",),
    "countries_en":     ("countries_en",),
    "ingredients_text": ("ingredients_text",),
    "allergens_tags":   ("allergens_tags", "allergens"),
    "traces_tags":      ("traces_tags", "traces"),
    "serving_size":     ("serving_size",),
    "nutriscore_grade": ("nutriscore_grade",),
    "brand_owner":      ("brand_owner",),
}

# Which output fields are tag-list fields (split by comma into JSON arrays).
TAG_FIELDS: frozenset[str] = frozenset({
    "categories_tags", "allergens_tags", "traces_tags",
})

# External-merge-sort chunk size. ~200k rows of OFF data ≈ ~200 MB in memory
# before flush (each chunk row is `code<TAB>json_line`).
CHUNK_ROWS = 200_000


# ---------------------------------------------------------------------------
# Small helpers
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


def _opt(value: str | None) -> str | None:
    """Strip whitespace; return None if empty after strip."""
    if value is None:
        return None
    s = value.strip()
    return s if s else None


def _split_tags(value: str | None) -> list[str]:
    """Split an OFF comma-separated tag string into a list.

    Preserves input order — OFF tags are often semantically ordered
    (e.g. `en:dairy,en:cheese,en:cheddar`). Strips whitespace, drops
    empty tokens.
    """
    if value is None:
        return []
    raw = value.strip()
    if not raw:
        return []
    out: list[str] = []
    for tok in raw.split(","):
        t = tok.strip()
        if t:
            out.append(t)
    return out


# ---------------------------------------------------------------------------
# Header resolution
# ---------------------------------------------------------------------------


def _resolve_header(header: list[str]) -> dict[str, int]:
    """Map each output field to its source column index in `header`.

    Raises KeyError if required columns are missing. `code` and `product_name`
    are required; all others are best-effort (missing → that output field is
    always None / empty list).
    """
    by_name: dict[str, int] = {}
    for idx, name in enumerate(header):
        if name not in by_name:
            by_name[name] = idx

    resolved: dict[str, int] = {}
    for out_field, candidates in COLUMN_CANDIDATES.items():
        for cand in candidates:
            if cand in by_name:
                resolved[out_field] = by_name[cand]
                break

    for required in ("code", "product_name"):
        if required not in resolved:
            raise KeyError(
                f"OFF input header missing required column '{required}'"
            )
    return resolved


# ---------------------------------------------------------------------------
# Row → record
# ---------------------------------------------------------------------------


def _build_record(row: list[str], header_idx: dict[str, int]) -> dict | None:
    """Convert a raw TSV row into a normalized product record.

    Returns None if `code` or `product_name` is missing/empty after strip.
    """
    def field(name: str) -> str | None:
        idx = header_idx.get(name)
        if idx is None or idx >= len(row):
            return None
        return row[idx]

    code = _opt(field("code"))
    if code is None:
        return None
    product_name = _opt(field("product_name"))
    if product_name is None:
        return None

    record = {
        "code": code,
        "product_name": product_name,
        "brands": _opt(field("brands")),
        "brand_owner": _opt(field("brand_owner")),
        "categories_tags": _split_tags(field("categories_tags")),
        "allergens_tags": _split_tags(field("allergens_tags")),
        "traces_tags": _split_tags(field("traces_tags")),
        "ingredients_text": _opt(field("ingredients_text")),
        "serving_size": _opt(field("serving_size")),
        "nutriscore_grade": _opt(field("nutriscore_grade")),
        "countries_en": _opt(field("countries_en")),
        "source_url": _opt(field("source_url")),
    }
    return record


# ---------------------------------------------------------------------------
# Streaming + external merge sort
# ---------------------------------------------------------------------------


def _stream_with_counters(
    input_file: Path,
    counters: dict[str, int],
) -> Iterator[tuple[str, str]]:
    """Stream the TSV and yield (code, json_line) for valid rows.

    Mutates ``counters`` in place:
        total_input        — every data row read (excluding header)
        skipped_no_code    — rows where `code` is empty/whitespace
        skipped_no_name    — rows where `product_name` is empty/whitespace
                             (only counted if `code` was present, so the two
                             counters are disjoint)
    """
    f = open(input_file, "r", encoding="utf-8", errors="replace", newline="")
    try:
        reader = csv.reader(f, delimiter="\t")
        try:
            header = next(reader)
        except StopIteration:
            return
        header_idx = _resolve_header(header)

        code_idx = header_idx["code"]
        name_idx = header_idx["product_name"]

        for row in reader:
            counters["total_input"] += 1
            # Defensive bounds check — short rows shouldn't happen in OFF
            # but `errors="replace"` + ragged rows in the wild can.
            raw_code = row[code_idx] if code_idx < len(row) else ""
            code = _opt(raw_code)
            if code is None:
                counters["skipped_no_code"] += 1
                continue
            raw_name = row[name_idx] if name_idx < len(row) else ""
            name = _opt(raw_name)
            if name is None:
                counters["skipped_no_name"] += 1
                continue
            record = _build_record(row, header_idx)
            if record is None:
                # _build_record only returns None when code/name are missing,
                # which we just checked — but stay defensive.
                counters["skipped_no_name"] += 1
                continue
            line = json.dumps(record, ensure_ascii=False, sort_keys=True)
            yield code, line
    finally:
        f.close()


def _flush_chunk(buf: list[tuple[str, str]], tmp_dir: Path, idx: int) -> Path:
    """Sort chunk by `code` and flush to a TSV file.

    Chunk format per line: ``code<TAB>json_line`` with embedded tabs in the
    json escaped as ``\\t`` (json.dumps single-line output rarely contains
    real tabs but we escape defensively).
    """
    buf.sort(key=lambda t: t[0])
    cp = tmp_dir / f"chunk-{idx:05d}.tsv"
    with open(cp, "w", encoding="utf-8") as f:
        for code, line in buf:
            safe_line = line.replace("\t", "\\t")
            f.write(f"{code}\t{safe_line}\n")
    return cp


def _read_chunk(
    fh: TextIO, chunk_idx: int
) -> Iterator[tuple[str, int, str]]:
    """Iterate (code, chunk_idx, json_line) tuples from a chunk file.

    ``chunk_idx`` is the chunk's ordinal (= flush order = source-file
    order). Including it in the yield tuple gives heapq.merge a stable
    secondary key: when two chunks have a row with the same `code`, the
    chunk written earlier (lower ordinal) wins, which corresponds to the
    earlier occurrence in the input file. This anchors the
    "first-occurrence-wins" rule for duplicate codes.
    """
    for raw in fh:
        if not raw:
            continue
        line = raw[:-1] if raw.endswith("\n") else raw
        parts = line.split("\t", 1)
        if len(parts) != 2:
            continue
        code, body = parts
        body = body.replace("\\t", "\t")
        yield code, chunk_idx, body


def _external_sort(
    input_file: Path,
    out_path: Path,
    counters: dict[str, int],
    chunk_rows: int,
) -> tuple[int, Counter, Counter, int]:
    """External merge sort by `code`. Returns (emitted, allergen_counts,
    trace_counts, products_with_allergens).

    Mutates `counters` (adds: emitted, duplicate_codes_skipped). Counts of
    allergen / traces tokens are aggregated during the merge step because
    that is when we know which rows actually emit (post duplicate-skip).
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_dir = Path(tempfile.mkdtemp(prefix=".tmp_off_sort_", dir=str(out_path.parent)))
    chunk_paths: list[Path] = []
    allergen_counts: Counter = Counter()
    trace_counts: Counter = Counter()
    products_with_allergens = 0
    emitted = 0

    try:
        buf: list[tuple[str, str]] = []
        for code, line in _stream_with_counters(input_file, counters):
            buf.append((code, line))
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
                last_code: str | None = None
                # heapq.merge sorts on the natural tuple ordering: first
                # `code`, then `chunk_idx` (so earlier-written chunk wins
                # ties — see _read_chunk docstring), then `json_line`.
                for code, _chunk_idx, json_line in heapq.merge(*iters):
                    if last_code is not None and code == last_code:
                        counters["duplicate_codes_skipped"] += 1
                        continue
                    last_code = code
                    out_f.write(json_line)
                    out_f.write("\n")
                    emitted += 1
                    # Aggregate allergens/traces from the JSON line. We
                    # decode the line we just wrote so the counts reflect
                    # exactly what's in the output file.
                    record = json.loads(json_line)
                    a_tags = record.get("allergens_tags") or []
                    t_tags = record.get("traces_tags") or []
                    # De-dupe within a single product so a row with
                    # ['en:milk','en:milk'] only contributes 1 to
                    # allergen_counts['en:milk'] (spec test 9).
                    if a_tags:
                        unique_a = set(a_tags)
                        for tag in unique_a:
                            allergen_counts[tag] += 1
                        products_with_allergens += 1
                    if t_tags:
                        for tag in set(t_tags):
                            trace_counts[tag] += 1
                out_f.flush()
                os.fsync(out_f.fileno())
        finally:
            for r in readers:
                r.close()
        _atomic_replace(tmp_out, out_path)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    counters["emitted"] = emitted
    return emitted, allergen_counts, trace_counts, products_with_allergens


# ---------------------------------------------------------------------------
# Allergens summary
# ---------------------------------------------------------------------------


def _sorted_count_dict(counter: Counter) -> dict[str, int]:
    """Sort by count desc, then key asc — deterministic for ties."""
    return {
        k: v for k, v in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))
    }


def _build_allergens_summary(
    total_products: int,
    products_with_allergens: int,
    allergen_counts: Counter,
    trace_counts: Counter,
) -> dict:
    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_products": total_products,
        "products_with_allergens": products_with_allergens,
        "allergens": _sorted_count_dict(allergen_counts),
        "traces": _sorted_count_dict(trace_counts),
    }


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------


def _build_manifest(
    input_file: Path,
    output_dir: Path,
    counters: dict[str, int],
) -> dict:
    products_path = output_dir / "branded_products.jsonl"
    allergens_path = output_dir / "allergens.json"
    outputs = {
        "branded_products.jsonl": {
            "sha256": _sha256_file(products_path),
            "bytes": products_path.stat().st_size,
        },
        "allergens.json": {
            "sha256": _sha256_file(allergens_path),
            "bytes": allergens_path.stat().st_size,
        },
    }
    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "input_file": str(input_file),
        "input_bytes": input_file.stat().st_size,
        "row_counts": {
            "total_input": counters.get("total_input", 0),
            "emitted": counters.get("emitted", 0),
            "skipped_no_code": counters.get("skipped_no_code", 0),
            "skipped_no_name": counters.get("skipped_no_name", 0),
            "duplicate_codes_skipped": counters.get("duplicate_codes_skipped", 0),
        },
        "outputs": outputs,
    }


def _is_already_normalized(output_dir: Path) -> bool:
    """True if manifest exists and its sha256 values match on-disk files."""
    manifest_path = output_dir / "manifest.json"
    products_path = output_dir / "branded_products.jsonl"
    allergens_path = output_dir / "allergens.json"
    if not (
        manifest_path.exists()
        and products_path.exists()
        and allergens_path.exists()
    ):
        return False
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    outputs = manifest.get("outputs") or {}
    expected_p = (outputs.get("branded_products.jsonl") or {}).get("sha256")
    expected_a = (outputs.get("allergens.json") or {}).get("sha256")
    if not expected_p or not expected_a:
        return False
    return (
        _sha256_file(products_path) == expected_p
        and _sha256_file(allergens_path) == expected_a
    )


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
    if not force and _is_already_normalized(output_dir):
        manifest = json.loads(
            (output_dir / "manifest.json").read_text(encoding="utf-8")
        )
        print(f"✓ already normalized — outputs match manifest sha256 in {output_dir}")
        return manifest

    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Lariat OFF normalizer")
    print(f"  input : {input_file}")
    print(f"  output: {output_dir}")

    counters: dict[str, int] = {
        "total_input": 0,
        "emitted": 0,
        "skipped_no_code": 0,
        "skipped_no_name": 0,
        "duplicate_codes_skipped": 0,
    }

    print("  building branded_products.jsonl (external merge sort by code)...")
    products_path = output_dir / "branded_products.jsonl"
    emitted, allergen_counts, trace_counts, products_with_allergens = (
        _external_sort(input_file, products_path, counters, chunk_rows=chunk_rows)
    )
    print(
        f"    wrote {emitted} rows  "
        f"(skipped: code={counters['skipped_no_code']} "
        f"name={counters['skipped_no_name']} "
        f"dup={counters['duplicate_codes_skipped']}) -> {products_path}"
    )

    print("  building allergens.json...")
    allergens_summary = _build_allergens_summary(
        emitted, products_with_allergens, allergen_counts, trace_counts
    )
    allergens_path = output_dir / "allergens.json"
    # NOTE: sort_keys=False here on purpose. The `allergens` and `traces`
    # sub-dicts are deliberately ordered by (count desc, key asc) — see
    # _sorted_count_dict — and json.dumps preserves dict insertion order
    # when sort_keys is False. Setting sort_keys=True would clobber that
    # with plain alphabetical key order.
    _atomic_write_text(
        allergens_path,
        json.dumps(allergens_summary, indent=2, sort_keys=False) + "\n",
    )
    print(f"    wrote {allergens_path}")

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
        description="Normalize Open Food Facts TSV to JSONL + allergens summary.",
    )
    parser.add_argument(
        "--input-file",
        type=Path,
        default=None,
        help=(
            "OFF products TSV (despite the .csv extension). "
            "Default: data/lariat-data/raw/openfoodfacts/extracted/"
            "openfoodfacts_products.csv"
        ),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Output directory. Default: data/lariat-data/normalized/openfoodfacts",
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
