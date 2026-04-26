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
import json
import shutil
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

# OFF ingredients_text + categories_tags can be very long.
csv.field_size_limit(sys.maxsize)

# Make `from scripts.datapack._io import ...` work both as a package import
# and when this script is run directly. See normalize_usda.py for context.
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scripts.datapack._io import (  # noqa: E402
    atomic_write_text as _atomic_write_text,
    default_data_root as _default_data_root,
    external_sort_jsonl as _external_sort_jsonl,
    sha256_file as _sha256_file,
)


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


def _external_sort(
    input_file: Path,
    out_path: Path,
    counters: dict[str, int],
    chunk_rows: int,
) -> tuple[int, Counter, Counter, int]:
    """External merge sort by `code`. Returns (emitted, allergen_counts,
    trace_counts, products_with_allergens).

    Delegates the chunk-flush / heapq.merge / dedup mechanics to
    ``_io.external_sort_jsonl``. Allergen / traces aggregation runs as the
    helper's ``on_emit`` callback so that counts reflect exactly the rows
    that survived dedup (i.e. that actually appear in the output file).

    Mutates `counters`: sets `emitted` and `duplicate_codes_skipped` to
    the helper's return values.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_dir = Path(tempfile.mkdtemp(prefix=".tmp_off_sort_", dir=str(out_path.parent)))
    allergen_counts: Counter = Counter()
    trace_counts: Counter = Counter()
    # Wrap in a single-element list so the closure can rebind without
    # introducing a `nonlocal` declaration on every call.
    products_with_allergens_box = [0]

    def _aggregate(_key_tuple: tuple, json_line: str) -> None:
        # Decode the line we just wrote so the counts reflect exactly
        # what's in the output file.
        record = json.loads(json_line)
        a_tags = record.get("allergens_tags") or []
        t_tags = record.get("traces_tags") or []
        # De-dupe within a single product so a row with
        # ['en:milk','en:milk'] only contributes 1 to
        # allergen_counts['en:milk'] (spec test 9).
        if a_tags:
            for tag in set(a_tags):
                allergen_counts[tag] += 1
            products_with_allergens_box[0] += 1
        if t_tags:
            for tag in set(t_tags):
                trace_counts[tag] += 1

    def _gen() -> Iterator[tuple[tuple, str]]:
        for code, line in _stream_with_counters(input_file, counters):
            yield (code,), line

    try:
        emitted, dup_skipped = _external_sort_jsonl(
            _gen(),
            out_path,
            chunk_rows=chunk_rows,
            tmp_dir=tmp_dir,
            key_types=(str,),
            dedup_by_key=True,
            on_emit=_aggregate,
        )
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    counters["emitted"] = emitted
    counters["duplicate_codes_skipped"] = dup_skipped
    return emitted, allergen_counts, trace_counts, products_with_allergens_box[0]


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
        "input_file": input_file.name,  # basename only — keep manifest portable
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
    output_dir.mkdir(parents=True, exist_ok=True)

    # Sweep stale external-sort tmp dirs from prior aborted runs (SIGKILL,
    # OOM, kernel termination skip our try/finally cleanup). These are
    # always garbage — sweep regardless of --force or idempotency state.
    for stale in output_dir.glob(".tmp_off_sort_*"):
        print(f"  cleaning stale tmp dir: {stale.name}")
        shutil.rmtree(stale, ignore_errors=True)

    if not force and _is_already_normalized(output_dir):
        manifest = json.loads(
            (output_dir / "manifest.json").read_text(encoding="utf-8")
        )
        print(f"✓ already normalized — outputs match manifest sha256 in {output_dir}")
        return manifest

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
