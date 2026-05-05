#!/usr/bin/env python3
"""
Lariat Data Pack — Post-Download Extraction

Extracts compressed archives and generates normalized JSONL files.
Run after download_all.py completes.

Usage:
  python scripts/datapack/extract_and_normalize.py               # all
  python scripts/datapack/extract_and_normalize.py --source usda  # one source
  python scripts/datapack/extract_and_normalize.py --extract-only # no normalization
"""

import argparse
import bz2
import gzip
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.datapack._io import default_data_root as _default_data_root  # noqa: E402

DATA_ROOT = _default_data_root()
if not DATA_ROOT.exists():
    print("ERROR: Cannot find lariat-data directory.")
    sys.exit(1)

RAW = DATA_ROOT / "raw"
NORMALIZED = DATA_ROOT / "normalized"
MANIFESTS = DATA_ROOT / "manifests"


def sizeof_fmt(num: float, suffix: str = "B") -> str:
    for unit in ("", "K", "M", "G", "T"):
        if abs(num) < 1024.0:
            return f"{num:3.1f} {unit}{suffix}"
        num /= 1024.0
    return f"{num:.1f} P{suffix}"


# ---------------------------------------------------------------------------
# Extraction routines
# ---------------------------------------------------------------------------

def _safe_extract(src: Path, dest: Path, do_extract):
    """
    Crash-safe wrapper: extract into a .tmp sibling dir, then
    move files into dest on success. A leftover .tmp dir from a
    previous crash is cleaned up automatically.
    """
    tmp_dir = dest.parent / f"{dest.name}.tmp"
    # Clean up any leftover tmp dir from a crash
    if tmp_dir.exists():
        print(f"  ↻ Cleaning up partial extract: {tmp_dir.name}")
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True, exist_ok=True)

    try:
        do_extract(src, tmp_dir)
    except Exception:
        # Leave the tmp dir for diagnosis but don't create a marker
        print(f"  ✗ Extraction failed — partial files in: {tmp_dir}")
        raise

    # Move extracted files into the real dest
    dest.mkdir(parents=True, exist_ok=True)
    for item in tmp_dir.iterdir():
        target = dest / item.name
        if target.exists():
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()
        shutil.move(str(item), str(target))
    tmp_dir.rmdir()


def extract_zip(src: Path, dest: Path):
    """Extract a .zip archive (crash-safe)."""
    print(f"  Extracting ZIP: {src.name} → {dest}")

    def _do(s, d):
        with zipfile.ZipFile(s, "r") as zf:
            zf.extractall(d)

    _safe_extract(src, dest, _do)
    print(f"  ✓ Extracted {len(list(dest.rglob('*')))} files")


def extract_gz(src: Path, dest: Path):
    """Extract a .gz file (crash-safe)."""
    out_name = src.stem  # remove .gz
    print(f"  Extracting GZ: {src.name} → {out_name}")

    def _do(s, d):
        out_path = d / out_name
        with gzip.open(s, "rb") as f_in:
            with open(out_path, "wb") as f_out:
                shutil.copyfileobj(f_in, f_out)

    _safe_extract(src, dest, _do)
    out_path = dest / out_name
    print(f"  ✓ Extracted: {sizeof_fmt(out_path.stat().st_size)}")


def extract_bz2(src: Path, dest: Path):
    """Extract a .bz2 file (crash-safe)."""
    out_name = src.stem  # remove .bz2
    print(f"  Extracting BZ2: {src.name} → {out_name}")

    def _do(s, d):
        out_path = d / out_name
        with bz2.open(s, "rb") as f_in:
            with open(out_path, "wb") as f_out:
                shutil.copyfileobj(f_in, f_out)

    _safe_extract(src, dest, _do)
    out_path = dest / out_name
    print(f"  ✓ Extracted: {sizeof_fmt(out_path.stat().st_size)}")


# ---------------------------------------------------------------------------
# Source-specific extraction
# ---------------------------------------------------------------------------

EXTRACTORS = {
    "usda": {
        "compressed_dir": "usda_fooddata/compressed",
        "extracted_dir": "usda_fooddata/extracted",
        "patterns": {"*.zip": extract_zip},
    },
    "openfoodfacts": {
        "compressed_dir": "openfoodfacts/compressed",
        "extracted_dir": "openfoodfacts/extracted",
        "patterns": {"*.gz": extract_gz},
    },
    "recipenlg": {
        "compressed_dir": "recipenlg/compressed",
        "extracted_dir": "recipenlg/extracted",
        "patterns": {"*.zip": extract_zip, "*.gz": extract_gz, "*.tar.gz": None},
    },
    "wikibooks": {
        "compressed_dir": "wikibooks_cookbook/compressed",
        "extracted_dir": "wikibooks_cookbook/extracted",
        "patterns": {"*.bz2": extract_bz2},
    },
}


def extract_source(source_key: str):
    """Extract all compressed files for a source."""
    if source_key not in EXTRACTORS:
        print(f"  (no extraction needed for {source_key})")
        return

    cfg = EXTRACTORS[source_key]
    comp_dir = RAW / cfg["compressed_dir"]
    ext_dir = RAW / cfg["extracted_dir"]

    if not comp_dir.exists():
        print(f"  ⚠ Compressed dir missing: {comp_dir}")
        return

    for pattern, extractor in cfg["patterns"].items():
        for f in sorted(comp_dir.glob(pattern)):
            if extractor is None:
                print(f"  ⚠ No extractor for {pattern} — skip {f.name}")
                continue

            # Check if already extracted (marker = crash-safe proof of completion)
            marker = ext_dir / f".extracted_{f.name}"
            if marker.exists():
                print(f"  ✓ Already extracted: {f.name}")
                continue

            try:
                extractor(f, ext_dir)
            except Exception as e:
                print(f"  ✗ Extraction error for {f.name}: {e}")
                continue

            # Write marker with metadata
            marker.write_text(json.dumps({
                "source_file": f.name,
                "extracted_at": datetime.now(timezone.utc).isoformat(),
                "source_size_bytes": f.stat().st_size,
            }, indent=2))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Lariat Data Pack — Extract & Normalize",
    )
    parser.add_argument(
        "--source", "-s",
        choices=list(EXTRACTORS.keys()) + ["all"],
        default="all",
        help="Extract only this source",
    )
    parser.add_argument(
        "--extract-only",
        action="store_true",
        help="Only extract archives, skip normalization",
    )
    args = parser.parse_args()

    print(f"\nLariat Data Pack — Extraction")
    print(f"Data root: {DATA_ROOT}\n")

    sources = list(EXTRACTORS.keys()) if args.source == "all" else [args.source]

    for src in sources:
        print(f"\n{'─'*50}")
        print(f"  {src}")
        print(f"{'─'*50}")
        extract_source(src)

    if not args.extract_only:
        print(f"\n{'─'*50}")
        print(f"  Normalization — not yet implemented")
        print(f"  Future: JSONL pipelines per source")
        print(f"{'─'*50}")
        # TODO: Implement per-source normalization:
        #   - USDA → ingredients.jsonl, nutrients.jsonl
        #   - OFF → branded_products.jsonl, allergens.json
        #   - RecipeNLG → recipes.jsonl, recipe_ingredients.jsonl
        #   - Wikibooks → techniques.jsonl, knife_skills.jsonl

    print("\n✓ Done\n")


if __name__ == "__main__":
    main()
