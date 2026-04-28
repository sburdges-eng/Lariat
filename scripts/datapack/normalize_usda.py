#!/usr/bin/env python3
"""
Lariat Data Pack — USDA FoodData Central normalizer (Task N1).

Reads the four extracted USDA FoodData Central CSV archives and emits two
normalized JSONL files plus a manifest:

    data/lariat-data/normalized/usda/
        ingredients.jsonl   — one row per fdc_id (food)
        nutrients.jsonl     — one row per (fdc_id, nutrient_id) pair
        manifest.json       — sha256 hashes, row counts, archive list

Inputs (under --input-root, default = data/lariat-data/raw/usda_fooddata/extracted):
    FoodData_Central_foundation_food_csv_2024-10-31/
    FoodData_Central_sr_legacy_food_csv_2018-04/
    FoodData_Central_survey_food_csv_2024-10-31/
    FoodData_Central_branded_food_csv_2024-10-31/

Each archive contains food.csv, food_nutrient.csv, nutrient.csv, and
optionally food_category.csv / branded_food.csv.

The branded archive is large: food.csv ~1.98M rows, food_nutrient.csv ~25.7M
rows / 1.5GB. Streaming with bounded memory is mandatory:

  - ingredients : ~2M food rows total — fits in memory; collected into a dict
                  keyed by fdc_id, then sorted and written.
  - nutrients   : 25M+ rows; cannot sort in memory. We do an external merge
                  sort: stream each archive's food_nutrient.csv, write sorted
                  chunks of CHUNK_ROWS rows to temp files, then heapq.merge
                  the chunks into the final sorted output. RSS stays bounded
                  by CHUNK_ROWS.

Idempotent: if outputs already exist with manifest sha256 values that match
the on-disk file hashes, the script exits early with a message. Pass --force
to rebuild regardless.

CLI:
    python scripts/datapack/normalize_usda.py
    python scripts/datapack/normalize_usda.py --force
    python scripts/datapack/normalize_usda.py --input-root /path/to/extracted \
                                              --output-dir /path/to/out
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, TextIO

# csv field size — branded ingredients lists can be very long.
csv.field_size_limit(sys.maxsize)

# Make `from scripts.datapack._io import ...` work both as a package import
# (when tests do `from scripts.datapack.normalize_usda import ...`) and when
# the script is run directly (`python scripts/datapack/normalize_usda.py`),
# in which case Python only adds the script's own directory to sys.path.
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scripts.datapack._io import (  # noqa: E402
    atomic_replace as _atomic_replace,
    atomic_write_text as _atomic_write_text,
    default_data_root as _default_data_root,
    external_sort_jsonl as _external_sort_jsonl,
    sha256_file as _sha256_file,
)


def _default_input_root() -> Path:
    return _default_data_root() / "raw" / "usda_fooddata" / "extracted"


def _default_output_dir() -> Path:
    return _default_data_root() / "normalized" / "usda"


# ---------------------------------------------------------------------------
# Archive registry
# ---------------------------------------------------------------------------

# Maps internal source key -> directory name under --input-root.
ARCHIVES: dict[str, str] = {
    "foundation": "FoodData_Central_foundation_food_csv_2024-10-31",
    "sr_legacy": "FoodData_Central_sr_legacy_food_csv_2018-04",
    "survey": "FoodData_Central_survey_food_csv_2024-10-31",
    "branded": "FoodData_Central_branded_food_csv_2024-10-31",
}

# Order matters for manifest determinism + later-wins semantics in the
# in-memory ingredient dict (unlikely in practice; each fdc_id only lives
# in one archive, but we lock the precedence anyway).
ARCHIVE_ORDER = ("foundation", "sr_legacy", "survey", "branded")

# External-merge-sort chunk size for nutrients. ~500k rows per chunk keeps
# peak RSS low (a chunk of (int, int, str) tuples ~= 100-150 MB). For the
# 25.7M branded food_nutrient.csv this produces ~52 chunks.
CHUNK_ROWS = 500_000


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _open_csv(path: Path) -> tuple[TextIO, csv.DictReader]:
    f = open(path, "r", encoding="utf-8", newline="")
    reader = csv.DictReader(f)
    return f, reader


def _opt(value: str | None) -> str | None:
    """CSV empty string -> None."""
    if value is None:
        return None
    if value == "":
        return None
    return value


def _opt_int(value: str | None) -> int | None:
    v = _opt(value)
    if v is None:
        return None
    try:
        return int(v)
    except ValueError:
        return None


def _opt_float(value: str | None) -> float | None:
    v = _opt(value)
    if v is None:
        return None
    try:
        return float(v)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Reference data loaders
# ---------------------------------------------------------------------------


def _load_food_categories(input_root: Path) -> dict[int, str]:
    """
    Build the union of food_category.csv across archives that ship one.

    Foundation and sr_legacy archives ship food_category.csv (identical
    catalog). Branded and survey do not. Returns {category_id: description}.
    """
    out: dict[int, str] = {}
    for source_key, dir_name in ARCHIVES.items():
        path = input_root / dir_name / "food_category.csv"
        if not path.exists():
            continue
        f, reader = _open_csv(path)
        try:
            for row in reader:
                cid = _opt_int(row.get("id"))
                desc = _opt(row.get("description"))
                if cid is not None and desc is not None:
                    # Earlier archives take precedence (deterministic).
                    out.setdefault(cid, desc)
        finally:
            f.close()
    return out


def _load_nutrient_catalog(input_root: Path) -> dict[int, tuple[str, str | None]]:
    """
    nutrient.csv is identical across archives. Read from the first archive
    that has it. Returns {nutrient_id: (name, unit_name)}.
    """
    for source_key in ARCHIVE_ORDER:
        path = input_root / ARCHIVES[source_key] / "nutrient.csv"
        if not path.exists():
            continue
        out: dict[int, tuple[str, str | None]] = {}
        f, reader = _open_csv(path)
        try:
            for row in reader:
                nid = _opt_int(row.get("id"))
                name = _opt(row.get("name"))
                unit = _opt(row.get("unit_name"))
                if nid is not None and name is not None:
                    out[nid] = (name, unit)
        finally:
            f.close()
        return out
    raise FileNotFoundError(
        f"No nutrient.csv found under any archive in {input_root}"
    )


def _load_branded_index(input_root: Path) -> dict[int, dict]:
    """
    Read branded_food.csv from the branded archive. ~2M rows of the
    selected fields fits easily in memory (<1 GB).
    """
    path = input_root / ARCHIVES["branded"] / "branded_food.csv"
    if not path.exists():
        return {}
    out: dict[int, dict] = {}
    f, reader = _open_csv(path)
    try:
        for row in reader:
            fdc = _opt_int(row.get("fdc_id"))
            if fdc is None:
                continue
            out[fdc] = {
                "brand_owner": _opt(row.get("brand_owner")),
                "gtin_upc": _opt(row.get("gtin_upc")),
                "ingredients": _opt(row.get("ingredients")),
                "serving_size": _opt_float(row.get("serving_size")),
                "serving_size_unit": _opt(row.get("serving_size_unit")),
            }
    finally:
        f.close()
    return out


# ---------------------------------------------------------------------------
# Ingredients
# ---------------------------------------------------------------------------


def _build_ingredients(
    input_root: Path,
    food_categories: dict[int, str],
    branded_index: dict[int, dict],
) -> tuple[list[dict], dict[str, int]]:
    """
    Read food.csv from each archive into a single dict keyed by fdc_id,
    then return the rows sorted by fdc_id. Per-archive row counts are
    returned alongside for the manifest.
    """
    by_id: dict[int, dict] = {}
    by_archive: dict[str, int] = {k: 0 for k in ARCHIVE_ORDER}

    for source_key in ARCHIVE_ORDER:
        path = input_root / ARCHIVES[source_key] / "food.csv"
        if not path.exists():
            continue
        f, reader = _open_csv(path)
        try:
            for row in reader:
                fdc = _opt_int(row.get("fdc_id"))
                if fdc is None:
                    continue
                cat_id = _opt_int(row.get("food_category_id"))
                cat_desc = food_categories.get(cat_id) if cat_id is not None else None
                branded = branded_index.get(fdc, {}) if source_key == "branded" else {}
                record = {
                    "fdc_id": fdc,
                    "description": _opt(row.get("description")),
                    "data_type": _opt(row.get("data_type")),
                    "food_category_id": cat_id,
                    "food_category": cat_desc,
                    "brand_owner": branded.get("brand_owner"),
                    "gtin_upc": branded.get("gtin_upc"),
                    "ingredients": branded.get("ingredients"),
                    "serving_size": branded.get("serving_size"),
                    "serving_size_unit": branded.get("serving_size_unit"),
                    "source_archive": source_key,
                }
                by_id[fdc] = record
                by_archive[source_key] += 1
        finally:
            f.close()

    rows = [by_id[k] for k in sorted(by_id.keys())]
    return rows, by_archive


def _write_ingredients_jsonl(rows: list[dict], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(out_path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False, sort_keys=True))
            f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    _atomic_replace(tmp, out_path)


# ---------------------------------------------------------------------------
# Nutrients (external merge sort across all archives)
# ---------------------------------------------------------------------------


def _iter_nutrient_rows(
    input_root: Path,
    nutrient_catalog: dict[int, tuple[str, str | None]],
    *,
    progress_every: int = 1_000_000,
) -> Iterator[tuple[int, int, int, int, str, str]]:
    """
    Stream every food_nutrient.csv across all archives. Yields
    ``(fdc_id, nutrient_id, derivation_sort_key, archive_index, source_archive,
    json_line)`` for each valid row.

    The derivation/archive components are baked into the yielded tuple so that
    callers (and the external-merge-sort chunk format) can use them directly
    as part of a stable, total ordering. ``derivation_sort_key`` is the
    ``derivation_id`` integer or ``-1`` if the source row's derivation_id is
    null/missing. ``archive_index`` is the ordinal of ``source_archive`` in
    ``ARCHIVE_ORDER``, which provides a final stable tie-break when the same
    ``(fdc, nid, derivation_id)`` triple appears in more than one archive.

    Per-archive accounting is *not* done here — the caller increments its own
    counter as it consumes the iterator (decoupling avoids fragile shared
    state on early-exit paths). Progress logging IS done here because the
    per-archive breakdown is naturally in scope: we keep a local counter and
    emit ``"  ... USDA nutrients: N rows scanned (...)"`` to stderr every
    ``progress_every`` consumed rows, but only when stderr is a TTY (silent in
    CI / file redirects / test capture).

    Skips rows with missing/empty amount, missing fdc_id, or missing
    nutrient_id.
    """
    # Progress tracking: per-archive counts so the operator can see where in
    # the four-archive walk the pipeline currently is.
    progress_by_archive: dict[str, int] = {k: 0 for k in ARCHIVE_ORDER}
    progress_total = 0
    for archive_index, source_key in enumerate(ARCHIVE_ORDER):
        path = input_root / ARCHIVES[source_key] / "food_nutrient.csv"
        if not path.exists():
            continue
        f = open(path, "r", encoding="utf-8", newline="")
        try:
            reader = csv.DictReader(f)
            for row in reader:
                fdc = _opt_int(row.get("fdc_id"))
                nid = _opt_int(row.get("nutrient_id"))
                amount = _opt_float(row.get("amount"))
                if fdc is None or nid is None or amount is None:
                    continue
                name_unit = nutrient_catalog.get(nid)
                if name_unit is None:
                    nutrient_name: str | None = None
                    unit_name: str | None = None
                else:
                    nutrient_name, unit_name = name_unit
                derivation_id = _opt_int(row.get("derivation_id"))
                # -1 sentinel: nulls sort before any real (non-negative) USDA
                # derivation_id. Real ids are positive integers.
                derivation_sort_key = derivation_id if derivation_id is not None else -1
                record = {
                    "fdc_id": fdc,
                    "nutrient_id": nid,
                    "nutrient_name": nutrient_name,
                    "unit_name": unit_name,
                    "amount": amount,
                    "derivation_id": derivation_id,
                    "source_archive": source_key,
                }
                line = json.dumps(record, ensure_ascii=False, sort_keys=True)
                progress_by_archive[source_key] += 1
                progress_total += 1
                # Emit at N, 2N, 3N, ... — never at 0, never a final summary
                # (the driver's "wrote N rows" line covers that). TTY-only so
                # tests + CI + file redirects stay silent.
                if (
                    progress_total % progress_every == 0
                    and sys.stderr.isatty()
                ):
                    breakdown = ", ".join(
                        f"{k}: {progress_by_archive[k]:,}" for k in ARCHIVE_ORDER
                    )
                    print(
                        f"  ... USDA nutrients: {progress_total:,} rows scanned ({breakdown})",
                        file=sys.stderr,
                        flush=True,
                    )
                yield (
                    fdc,
                    nid,
                    derivation_sort_key,
                    archive_index,
                    source_key,
                    line,
                )
        finally:
            f.close()


def _external_sort_nutrients(
    input_root: Path,
    nutrient_catalog: dict[int, tuple[str, str | None]],
    out_path: Path,
    chunk_rows: int = CHUNK_ROWS,
    progress_every: int = 1_000_000,
) -> tuple[int, dict[str, int]]:
    """
    External merge sort for nutrients. Returns (total_row_count, by_archive).

    Delegates the chunk-flush / heapq.merge mechanics to
    ``_io.external_sort_jsonl``. This wrapper is responsible for:
      - Wrapping ``_iter_nutrient_rows`` into a ``(key_tuple, line)``
        generator while incrementing the per-archive counter as rows are
        consumed (decoupled from emission — see I-1; nutrients does not
        dedup, so consumed == emitted, but the counter still belongs here
        because ``_iter_nutrient_rows`` already needs the source_key in
        scope).
      - Creating + cleaning the chunk tmp dir.

    The sort key is a four-tuple ``(fdc_id, nutrient_id, derivation_id_or_-1,
    archive_index)`` so that ties on ``(fdc_id, nutrient_id)`` (real USDA data
    has multiple measurement methods per food/nutrient pair) are broken
    deterministically rather than by the lexical ordering of the JSON line.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_dir = Path(tempfile.mkdtemp(prefix=".tmp_usda_sort_", dir=str(out_path.parent)))
    by_archive_final: dict[str, int] = {k: 0 for k in ARCHIVE_ORDER}

    def _gen() -> Iterator[tuple[tuple, str]]:
        for fdc, nid, deriv_key, arch_idx, source_key, line in _iter_nutrient_rows(
            input_root, nutrient_catalog, progress_every=progress_every
        ):
            # Per-archive accounting is owned by this consumer — see I-1.
            by_archive_final[source_key] += 1
            yield (fdc, nid, deriv_key, arch_idx), line

    try:
        emitted, _ = _external_sort_jsonl(
            _gen(),
            out_path,
            chunk_rows=chunk_rows,
            tmp_dir=tmp_dir,
            key_types=(int, int, int, int),
            dedup_by_key=False,
        )
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return emitted, by_archive_final


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------


def _build_manifest(
    input_root: Path,
    output_dir: Path,
    by_archive_ingredients: dict[str, int],
    by_archive_nutrients: dict[str, int],
    ingredient_count: int,
    nutrient_count: int,
) -> dict:
    input_files: dict[str, list[str]] = {}
    for key in ARCHIVE_ORDER:
        archive_dir = input_root / ARCHIVES[key]
        if not archive_dir.exists():
            input_files[key] = []
            continue
        wanted = ["food.csv", "food_nutrient.csv", "nutrient.csv"]
        if (archive_dir / "food_category.csv").exists():
            wanted.append("food_category.csv")
        if key == "branded" and (archive_dir / "branded_food.csv").exists():
            wanted.append("branded_food.csv")
        input_files[key] = sorted(p for p in wanted if (archive_dir / p).exists())

    ingredients_path = output_dir / "ingredients.jsonl"
    nutrients_path = output_dir / "nutrients.jsonl"
    outputs = {
        "ingredients.jsonl": {
            "sha256": _sha256_file(ingredients_path),
            "bytes": ingredients_path.stat().st_size,
        },
        "nutrients.jsonl": {
            "sha256": _sha256_file(nutrients_path),
            "bytes": nutrients_path.stat().st_size,
        },
    }
    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "input_archives": list(ARCHIVE_ORDER),
        "input_files": input_files,
        "row_counts": {
            "ingredients": ingredient_count,
            "nutrients": nutrient_count,
            "by_archive": {
                key: {
                    "ingredients": by_archive_ingredients.get(key, 0),
                    "nutrients": by_archive_nutrients.get(key, 0),
                }
                for key in ARCHIVE_ORDER
            },
        },
        "outputs": outputs,
    }


def _is_already_normalized(output_dir: Path) -> bool:
    """True if manifest exists and its sha256 values match on-disk files."""
    manifest_path = output_dir / "manifest.json"
    ingredients_path = output_dir / "ingredients.jsonl"
    nutrients_path = output_dir / "nutrients.jsonl"
    if not (manifest_path.exists() and ingredients_path.exists() and nutrients_path.exists()):
        return False
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    outputs = manifest.get("outputs") or {}
    expected_ing = (outputs.get("ingredients.jsonl") or {}).get("sha256")
    expected_nut = (outputs.get("nutrients.jsonl") or {}).get("sha256")
    if not expected_ing or not expected_nut:
        return False
    return (
        _sha256_file(ingredients_path) == expected_ing
        and _sha256_file(nutrients_path) == expected_nut
    )


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def normalize(
    input_root: Path,
    output_dir: Path,
    *,
    force: bool = False,
    chunk_rows: int = CHUNK_ROWS,
) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)

    # Sweep stale external-sort tmp dirs from prior aborted runs (SIGKILL,
    # OOM, kernel termination skip our try/finally cleanup). These are
    # always garbage — sweep regardless of --force or idempotency state.
    for stale in output_dir.glob(".tmp_usda_sort_*"):
        if stale.is_dir():
            print(f"  ↻ Sweeping stale tmp dir: {stale.name}")
            shutil.rmtree(stale, ignore_errors=True)

    if not force and _is_already_normalized(output_dir):
        manifest = json.loads((output_dir / "manifest.json").read_text(encoding="utf-8"))
        print(f"✓ already normalized — outputs match manifest sha256 in {output_dir}")
        return manifest

    print(f"Lariat USDA normalizer")
    print(f"  input : {input_root}")
    print(f"  output: {output_dir}")

    print("  loading reference tables...")
    food_categories = _load_food_categories(input_root)
    nutrient_catalog = _load_nutrient_catalog(input_root)
    branded_index = _load_branded_index(input_root)
    print(
        f"    food_category rows: {len(food_categories)}  "
        f"nutrient rows: {len(nutrient_catalog)}  "
        f"branded_food rows: {len(branded_index)}"
    )

    print("  building ingredients.jsonl...")
    ingredient_rows, by_archive_ing = _build_ingredients(
        input_root, food_categories, branded_index
    )
    ingredients_path = output_dir / "ingredients.jsonl"
    _write_ingredients_jsonl(ingredient_rows, ingredients_path)
    print(f"    wrote {len(ingredient_rows)} rows -> {ingredients_path}")

    print("  building nutrients.jsonl (external merge sort)...")
    nutrients_path = output_dir / "nutrients.jsonl"
    nutrient_count, by_archive_nut = _external_sort_nutrients(
        input_root, nutrient_catalog, nutrients_path, chunk_rows=chunk_rows
    )
    print(f"    wrote {nutrient_count} rows -> {nutrients_path}")

    print("  writing manifest.json...")
    manifest = _build_manifest(
        input_root,
        output_dir,
        by_archive_ing,
        by_archive_nut,
        len(ingredient_rows),
        nutrient_count,
    )
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
        description="Normalize USDA FoodData Central CSVs to JSONL.",
    )
    parser.add_argument(
        "--input-root",
        type=Path,
        default=None,
        help=(
            "Directory containing the four extracted USDA archives. "
            "Default: data/lariat-data/raw/usda_fooddata/extracted"
        ),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Output directory. Default: data/lariat-data/normalized/usda",
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
        help=f"External-sort chunk size for nutrients (default: {CHUNK_ROWS}).",
    )
    args = parser.parse_args(argv)

    input_root = args.input_root or _default_input_root()
    output_dir = args.output_dir or _default_output_dir()

    if not input_root.exists():
        print(f"ERROR: input root does not exist: {input_root}", file=sys.stderr)
        return 2

    normalize(
        input_root=input_root,
        output_dir=output_dir,
        force=args.force,
        chunk_rows=args.chunk_rows,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
