#!/usr/bin/env python3
"""
Lariat Data Pack — normalization sanity check (Task N4).

Read-only validator that walks the per-source manifests under
``data/lariat-data/normalized/`` and verifies:

    1. manifest.json exists and parses
    2. each output file listed in the manifest exists on disk
    3. sha256 of each file matches manifest["outputs"][file]["sha256"]
    4. byte size of each file matches manifest["outputs"][file]["bytes"]
    5. JSONL outputs parse on a small head+tail spot-check
    6. each spot-checked row has the expected top-level keys
    7. JSONL line counts match manifest["row_counts"]

Sources whose manifest is missing get a SKIP row (partial-pipeline state,
not a failure). Anything else is a failure: prints a one-screen summary
table and exits non-zero.

CLI:
    python scripts/datapack/sanity_check.py
    python scripts/datapack/sanity_check.py --data-root /path/to/lariat-data
    python scripts/datapack/sanity_check.py --samples 10 --verbose
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Make `from scripts.datapack._io import ...` work both as a package import
# and when this script is run directly. See normalize_usda.py for context.
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scripts.datapack._io import (  # noqa: E402
    default_data_root as _default_data_root,
    human_bytes as _human_bytes,
    sha256_file as _sha256_file,
)


# ---------------------------------------------------------------------------
# Source registry — one entry per known normalizer.
#
# Manifest schemas are derived from the _build_manifest() emitters in:
#   scripts/datapack/normalize_usda.py
#   scripts/datapack/normalize_off.py
#   scripts/datapack/normalize_wikibooks.py
# Update this table if a normalizer's manifest layout changes.
# ---------------------------------------------------------------------------

# JSONL row schemas — top-level keys we expect each emitted row to carry.
USDA_INGREDIENT_KEYS = {
    "fdc_id",
    "description",
    "data_type",
    "food_category_id",
    "food_category",
    "brand_owner",
    "gtin_upc",
    "ingredients",
    "serving_size",
    "serving_size_unit",
    "source_archive",
}
USDA_NUTRIENT_KEYS = {
    "fdc_id",
    "nutrient_id",
    "nutrient_name",
    "unit_name",
    "amount",
    "derivation_id",
    "source_archive",
}
OFF_PRODUCT_KEYS = {
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
}
WIKIBOOKS_PAGE_KEYS = {
    "page_id",
    "title",
    "slug",
    "is_redirect",
    "redirect_target",
    "categories",
    "wikitext_length",
    "plain_text_summary",
    "source_url",
}


@dataclass(frozen=True)
class JsonlSpec:
    """Per-JSONL-file expectations: row schema + which manifest counter holds the row count."""
    schema_keys: frozenset[str]
    row_count_key: str  # key under manifest["row_counts"]


@dataclass(frozen=True)
class SourceSpec:
    name: str             # display name in the table
    subdir: str           # subdirectory under <data_root>/normalized/
    jsonl: dict[str, JsonlSpec]
    json_files: tuple[str, ...] = ()  # plain JSON outputs (e.g. allergens.json)


SOURCES: tuple[SourceSpec, ...] = (
    SourceSpec(
        name="usda",
        subdir="usda",
        jsonl={
            "ingredients.jsonl": JsonlSpec(
                schema_keys=frozenset(USDA_INGREDIENT_KEYS),
                row_count_key="ingredients",
            ),
            "nutrients.jsonl": JsonlSpec(
                schema_keys=frozenset(USDA_NUTRIENT_KEYS),
                row_count_key="nutrients",
            ),
        },
    ),
    SourceSpec(
        name="openfoodfacts",
        subdir="openfoodfacts",
        jsonl={
            "branded_products.jsonl": JsonlSpec(
                schema_keys=frozenset(OFF_PRODUCT_KEYS),
                row_count_key="emitted",
            ),
        },
        json_files=("allergens.json",),
    ),
    SourceSpec(
        name="wikibooks",
        subdir="wikibooks",
        jsonl={
            "cookbook_pages.jsonl": JsonlSpec(
                schema_keys=frozenset(WIKIBOOKS_PAGE_KEYS),
                row_count_key="cookbook_pages_emitted",
            ),
        },
    ),
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _iter_tail_lines(path: Path, n: int) -> list[bytes]:
    """Read up to the last ``n`` newline-terminated lines without loading the whole file.

    Walks backwards from EOF in 4 KB chunks counting newlines until enough
    lines are buffered, then returns the last n line bytestrings (each
    without a trailing newline). Empty list if the file is empty.
    """
    if n <= 0:
        return []
    block = 4096
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        end = f.tell()
        if end == 0:
            return []
        buf = b""
        pos = end
        # Need n newlines OR file start. The last byte may or may not be \n;
        # we handle either case below when splitting.
        while pos > 0 and buf.count(b"\n") <= n:
            read_size = block if pos >= block else pos
            pos -= read_size
            f.seek(pos)
            buf = f.read(read_size) + buf
    # Split into lines, drop a trailing empty piece if file ended with \n.
    lines = buf.split(b"\n")
    if lines and lines[-1] == b"":
        lines.pop()
    return lines[-n:]


def _iter_head_lines(path: Path, n: int) -> list[bytes]:
    """Read up to the first ``n`` newline-terminated lines from ``path``."""
    if n <= 0:
        return []
    out: list[bytes] = []
    with open(path, "rb") as f:
        for line in f:
            out.append(line.rstrip(b"\n"))
            if len(out) >= n:
                break
    return out


def _count_lines(path: Path) -> int:
    """Stream-count newlines without loading the file."""
    count = 0
    with open(path, "rb") as f:
        for _ in f:
            count += 1
    return count


# ---------------------------------------------------------------------------
# Per-source result struct
# ---------------------------------------------------------------------------


@dataclass
class SourceResult:
    spec: SourceSpec
    status: str = "OK"            # "OK" | "FAIL" | "SKIP"
    fail_reason: str = ""
    outputs_present: int = 0
    outputs_total: int = 0
    sha_ok: bool = True
    bytes_ok: bool = True
    schema_ok: bool = True
    rows_ok: bool = True
    total_rows: int = 0           # sum of manifest row counts across JSONL files
    total_bytes: int = 0          # sum of file sizes for the source
    generated_at: str = ""        # manifest timestamp
    verbose_lines: list[str] = field(default_factory=list)

    def fail(self, reason: str) -> None:
        if self.status != "FAIL":
            self.status = "FAIL"
            self.fail_reason = reason


# ---------------------------------------------------------------------------
# Per-source check
# ---------------------------------------------------------------------------


def _check_source(
    spec: SourceSpec,
    data_root: Path,
    samples: int,
    verbose: bool,
) -> SourceResult:
    result = SourceResult(spec=spec)
    source_dir = data_root / "normalized" / spec.subdir
    manifest_path = source_dir / "manifest.json"

    # 1. Manifest presence — missing manifest = SKIP, not fail.
    if not manifest_path.exists():
        result.status = "SKIP"
        result.fail_reason = "manifest not found"
        return result

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        result.fail(f"manifest unreadable: {e}")
        return result

    if not isinstance(manifest, dict):
        result.fail("manifest is not a JSON object")
        return result

    result.generated_at = str(manifest.get("generated_at") or "")

    outputs = manifest.get("outputs")
    if not isinstance(outputs, dict) or not outputs:
        result.fail("manifest['outputs'] missing or malformed")
        return result

    expected_files = list(spec.jsonl.keys()) + list(spec.json_files)
    result.outputs_total = len(expected_files)

    # 2 + 3 + 4. Files exist, sha256 match, byte size match.
    for fname in expected_files:
        meta = outputs.get(fname)
        if not isinstance(meta, dict):
            result.fail(f"manifest['outputs']['{fname}'] missing")
            return result
        fpath = source_dir / fname
        if not fpath.exists():
            result.fail(f"output file missing: {fname}")
            return result
        result.outputs_present += 1

        actual_bytes = fpath.stat().st_size
        result.total_bytes += actual_bytes
        expected_bytes = meta.get("bytes")
        if expected_bytes is None or int(expected_bytes) != actual_bytes:
            result.bytes_ok = False
            result.fail(
                f"bytes mismatch on {fname}: "
                f"manifest={expected_bytes} actual={actual_bytes}"
            )
            return result

        actual_sha = _sha256_file(fpath)
        expected_sha = meta.get("sha256")
        if not expected_sha or actual_sha != expected_sha:
            result.sha_ok = False
            result.fail(f"sha256 mismatch on {fname}")
            return result

        if verbose:
            result.verbose_lines.append(
                f"  {spec.name}/{fname}: {_human_bytes(actual_bytes)}, sha={actual_sha[:12]}…"
            )

    # 5 + 6. JSONL spot-check parse + schema.
    for fname, jspec in spec.jsonl.items():
        fpath = source_dir / fname
        # Sample head + tail; for tiny files just walk every line.
        line_count = _count_lines(fpath)
        if line_count <= samples * 2:
            sampled: list[tuple[int, bytes]] = []
            with open(fpath, "rb") as f:
                for i, line in enumerate(f, start=1):
                    sampled.append((i, line.rstrip(b"\n")))
        else:
            head = _iter_head_lines(fpath, samples)
            tail = _iter_tail_lines(fpath, samples)
            sampled = []
            for i, b in enumerate(head, start=1):
                sampled.append((i, b))
            tail_start = line_count - len(tail) + 1
            for i, b in enumerate(tail, start=tail_start):
                sampled.append((i, b))

        for line_no, raw in sampled:
            if not raw:
                # blank line in a JSONL file is malformed.
                result.fail(f"empty JSONL line in {fname} at line {line_no}")
                return result
            try:
                row = json.loads(raw.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError) as e:
                result.fail(f"JSONL parse error in {fname} at line {line_no}: {e}")
                return result
            if not isinstance(row, dict):
                result.fail(f"JSONL row in {fname} line {line_no} is not a JSON object")
                return result
            missing = jspec.schema_keys - row.keys()
            if missing:
                key = sorted(missing)[0]
                result.schema_ok = False
                result.fail(
                    f"schema spot-check failed in {fname} line {line_no}: "
                    f"missing key '{key}'"
                )
                return result

        # 7. Row count vs manifest.
        row_counts = manifest.get("row_counts")
        if isinstance(row_counts, dict) and jspec.row_count_key in row_counts:
            expected_rows = row_counts[jspec.row_count_key]
            if not isinstance(expected_rows, int):
                result.rows_ok = False
                result.fail(
                    f"manifest row_counts['{jspec.row_count_key}'] is not an int"
                )
                return result
            if expected_rows != line_count:
                result.rows_ok = False
                result.fail(
                    f"row count mismatch on {fname}: "
                    f"manifest={expected_rows} actual={line_count}"
                )
                return result
            result.total_rows += line_count

    # JSON (non-JSONL) sanity: parse-able + presence-of-keys for known files.
    for fname in spec.json_files:
        fpath = source_dir / fname
        try:
            payload = json.loads(fpath.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            result.fail(f"JSON parse error in {fname}: {e}")
            return result
        if fname == "allergens.json":
            if not isinstance(payload, dict):
                result.fail(f"{fname}: top-level JSON is not an object")
                return result
            for required_key in ("allergens", "traces"):
                val = payload.get(required_key)
                if not isinstance(val, dict):
                    result.fail(
                        f"{fname}: missing or non-dict key '{required_key}'"
                    )
                    return result

    return result


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

# Column widths chosen so the table fits in a typical 80-col terminal and lines
# up regardless of which mark (✓ / ✗ / ○) is rendered. The "rows" column gets
# the most slack since manifest counts can reach 8 digits.
COL_SOURCE = 14
COL_OUTPUTS = 9
COL_SHA = 8
COL_BYTES = 7
COL_SCHEMA = 8
COL_ROWS = 12
COL_STATUS = 24


def _row(cells: list[str]) -> str:
    widths = [COL_SOURCE, COL_OUTPUTS, COL_SHA, COL_BYTES, COL_SCHEMA, COL_ROWS, COL_STATUS]
    parts = []
    for cell, width in zip(cells, widths):
        parts.append(cell.ljust(width))
    return "  " + "".join(parts).rstrip()


def _mark(ok: bool) -> str:
    return "✓" if ok else "✗"


def _print_table(
    results: list[SourceResult],
    data_root: Path,
    verbose: bool,
    out=None,
) -> None:
    if out is None:
        out = sys.stdout
    print("Lariat Data Pack — Normalization Sanity Check", file=out)
    print(f"Data root: {data_root}", file=out)
    print("", file=out)

    if verbose:
        for r in results:
            for line in r.verbose_lines:
                print(line, file=out)
        if any(r.verbose_lines for r in results):
            print("", file=out)

    header = _row([
        "source", "outputs", "sha256", "bytes", "schema", "rows", "status",
    ])
    print(header, file=out)
    total_width = COL_SOURCE + COL_OUTPUTS + COL_SHA + COL_BYTES + COL_SCHEMA + COL_ROWS + COL_STATUS
    print("  " + ("─" * total_width), file=out)

    file_total = 0
    bytes_total = 0
    timestamps: list[tuple[str, str]] = []

    for r in results:
        outputs_cell = f"{r.outputs_present}/{r.outputs_total}"
        if r.status == "SKIP":
            status_cell = f"○ SKIP — {r.fail_reason}"
            sha_cell = "-"
            bytes_cell = "-"
            schema_cell = "-"
            rows_cell = "-"
        elif r.status == "FAIL":
            status_cell = f"✗ FAIL: {r.fail_reason}"
            sha_cell = _mark(r.sha_ok)
            bytes_cell = _mark(r.bytes_ok)
            schema_cell = _mark(r.schema_ok)
            rows_cell = f"{r.total_rows:,}" if r.rows_ok else "✗"
        else:
            status_cell = "✓ OK"
            sha_cell = "✓"
            bytes_cell = "✓"
            schema_cell = "✓"
            rows_cell = f"{r.total_rows:,}"
            file_total += r.outputs_present
            bytes_total += r.total_bytes
            if r.generated_at:
                timestamps.append((r.spec.name, r.generated_at))

        print(_row([
            r.spec.name, outputs_cell, sha_cell, bytes_cell,
            schema_cell, rows_cell, status_cell,
        ]), file=out)

    print("", file=out)
    print(f"  Total: {file_total} files, {_human_bytes(bytes_total)} on disk", file=out)
    if timestamps:
        ts_parts = [f"{name.upper()} {ts}" for name, ts in timestamps]
        print(f"  Generated: {', '.join(ts_parts)}", file=out)


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def run(data_root: Path, samples: int, verbose: bool, out=None) -> int:
    """Run all source checks. Returns process exit code (0 success, 1 failure)."""
    if out is None:
        out = sys.stdout
    results = [_check_source(spec, data_root, samples, verbose) for spec in SOURCES]
    _print_table(results, data_root, verbose, out=out)
    any_fail = any(r.status == "FAIL" for r in results)
    return 1 if any_fail else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate Lariat data-pack normalized outputs.",
    )
    parser.add_argument(
        "--data-root",
        type=Path,
        default=None,
        help="Override the lariat-data root (default: data/lariat-data symlink).",
    )
    parser.add_argument(
        "--samples",
        type=int,
        default=5,
        help="Lines to spot-check from each end of every JSONL output (default: 5).",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Emit per-file progress lines before the summary table.",
    )
    args = parser.parse_args(argv)

    if args.samples < 0:
        print("error: --samples must be >= 0", file=sys.stderr)
        return 2

    data_root = args.data_root if args.data_root is not None else _default_data_root()
    return run(data_root, args.samples, args.verbose)


if __name__ == "__main__":
    raise SystemExit(main())
