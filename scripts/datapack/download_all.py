#!/usr/bin/env python3
"""
Lariat Data Pack — Download Orchestrator

Downloads all culinary reference datasets to the external SSD.
Supports:
  - Resumable downloads (Range headers)
  - SHA-256 / xxhash checksums
  - Per-source filtering (--source usda)
  - Status reporting (--status)
  - Manifest logging (manifests/download_log.json)

Usage:
  python scripts/datapack/download_all.py                  # download all
  python scripts/datapack/download_all.py --source usda    # single source
  python scripts/datapack/download_all.py --status         # check progress
  python scripts/datapack/download_all.py --dry-run        # preview only
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Resolve data root — follow symlink from repo or fallback to direct path
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]
SYMLINK_PATH = REPO_ROOT / "data" / "lariat-data"
DIRECT_PATH = Path("/Volumes/Sean's SSD/lariat-data")

if SYMLINK_PATH.exists():
    DATA_ROOT = SYMLINK_PATH.resolve()
elif DIRECT_PATH.exists():
    DATA_ROOT = DIRECT_PATH
else:
    print("ERROR: Cannot find lariat-data directory.")
    print(f"  Checked symlink: {SYMLINK_PATH}")
    print(f"  Checked direct:  {DIRECT_PATH}")
    print("  Is the external drive mounted?")
    sys.exit(1)

RAW = DATA_ROOT / "raw"
MANIFESTS = DATA_ROOT / "manifests"

# ---------------------------------------------------------------------------
# Source registry — each source defines its download targets
# ---------------------------------------------------------------------------

SOURCES: dict[str, dict] = {
    # ── 1. USDA FoodData Central ───────────────────────────────────────
    "usda": {
        "name": "USDA FoodData Central",
        "priority": 0,
        "license": "Public Domain (US Government Work)",
        "dest": "usda_fooddata",
        "files": [
            {
                "url": "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2024-10-31.zip",
                "dest_subdir": "compressed",
                "filename": "FoodData_Central_foundation_food_csv.zip",
                "description": "Foundation Foods (CSV)",
                "expected_size_mb": 3,
            },
            {
                "url": "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip",
                "dest_subdir": "compressed",
                "filename": "FoodData_Central_sr_legacy_food_csv.zip",
                "description": "SR Legacy Foods (CSV) — final 2018-04 release, no longer updated",
                "expected_size_mb": 6,
            },
            {
                "url": "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_csv_2024-10-31.zip",
                "dest_subdir": "compressed",
                "filename": "FoodData_Central_survey_food_csv.zip",
                "description": "Survey Foods (FNDDS, CSV)",
                "expected_size_mb": 3,
            },
            {
                "url": "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_branded_food_csv_2024-10-31.zip",
                "dest_subdir": "compressed",
                "filename": "FoodData_Central_branded_food_csv.zip",
                "description": "Branded Foods (CSV) — largest file (~3 GB uncompressed)",
                "expected_size_mb": 420,
            },
            # NOTE: Supporting data (nutrients, portions, measure_unit, etc.)
            # is now bundled inside each archive since April 2023.
            # No standalone download needed.
        ],
    },

    # ── 2. Open Food Facts ─────────────────────────────────────────────
    "openfoodfacts": {
        "name": "Open Food Facts",
        "priority": 1,
        "license": "ODbL (Open Database License)",
        "dest": "openfoodfacts",
        "files": [
            {
                "url": "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz",
                "dest_subdir": "compressed",
                "filename": "openfoodfacts_products.csv.gz",
                "description": "Full product dump (CSV, gzipped)",
                "expected_size_mb": 7000,
            },
        ],
    },

    # ── 3. RecipeNLG (manual fetch — gated dataset) ────────────────────
    "recipenlg": {
        "name": "RecipeNLG",
        "priority": 0,
        "license": "Academic / Research — non-commercial only (Poznań University of Technology)",
        "dest": "recipenlg",
        "note": (
            "RecipeNLG (2.2M recipes) is gated. The HuggingFace repo "
            "'mbien/recipe_nlg' contains only a loader script — the actual "
            "data is not redistributable. Register and download dataset.zip "
            "from https://recipenlg.cs.put.poznan.pl/, unzip, and place "
            "full_dataset.csv at: raw/recipenlg/dataset/full_dataset.csv"
        ),
        "files": [],  # manual fetch — see note
    },

    # ── 4. Wikibooks Cookbook ───────────────────────────────────────────
    "wikibooks": {
        "name": "Wikibooks Cookbook",
        "priority": 2,
        "license": "CC BY-SA 3.0",
        "dest": "wikibooks_cookbook",
        "files": [
            {
                "url": "https://dumps.wikimedia.org/enwikibooks/latest/enwikibooks-latest-pages-articles.xml.bz2",
                "dest_subdir": "compressed",
                "filename": "enwikibooks-latest-pages-articles.xml.bz2",
                "description": "Full Wikibooks dump (all books, will filter Cookbook)",
                "expected_size_mb": 400,
            },
        ],
    },

    # ── 5. FDA Food Code ──────────────────────────────────────────────
    "fda_food_code": {
        "name": "FDA Food Code",
        "priority": 1,
        "license": "Public Domain (US Government Work)",
        "dest": "fda_food_code",
        "files": [
            {
                "url": "https://www.fda.gov/media/164194/download",
                "dest_subdir": "pdf",
                "filename": "FDA_Food_Code_2022.pdf",
                "description": "FDA Food Code 2022 — Full Document (Jan 18 2023 release)",
                "expected_size_mb": 5,
            },
        ],
    },

    # ── 6. Food Safety references ─────────────────────────────────────
    "food_safety": {
        "name": "USDA / FoodSafety.gov Safe Temp References",
        "priority": 1,
        "license": "Public Domain (US Government Work)",
        "dest": "food_safety",
        "files": [
            {
                # Live foodsafety.gov is behind Akamai bot protection (403 to curl/wget).
                # Wayback /web/2024/ redirects to the latest 2024 snapshot of the chart.
                "url": "https://web.archive.org/web/2024/https://www.foodsafety.gov/food-safety-charts/safe-minimum-internal-temperatures",
                "dest_subdir": "foodsafety_gov",
                "filename": "safe_minimum_internal_temperatures.html",
                "description": "Safe minimum internal temperature chart (HTML, via Wayback)",
                "expected_size_mb": 1,
                "is_html_page": True,
            },
            {
                # FSIS is also behind Akamai; same Wayback workaround.
                "url": "https://web.archive.org/web/2024/https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/safe-temperature-chart",
                "dest_subdir": "usda",
                "filename": "fsis_safe_temp_chart.html",
                "description": "FSIS safe minimum internal temperature chart (via Wayback)",
                "expected_size_mb": 1,
                "is_html_page": True,
            },
        ],
    },

    # ── 7. FlavorDB ───────────────────────────────────────────────────
    "flavordb": {
        "name": "FlavorDB",
        "priority": 2,
        "license": "Academic / Research",
        "dest": "flavor_graphs",
        "note": (
            "FlavorDB (https://cosylab.iiitd.edu.in/flavordb2/) does not offer "
            "a single bulk download. Data must be scraped from their API or "
            "obtained by contacting the authors. Place any obtained files in: "
            "raw/flavor_graphs/flavordb/"
        ),
        "files": [],  # requires scraping or author contact
    },

    # ── 8. Unit conversion registries ─────────────────────────────────
    "units": {
        "name": "Unit Conversion Registries",
        "priority": 0,
        "license": "BSD-3 (Pint) / various",
        "dest": "unit_systems",
        "files": [
            {
                "url": "https://raw.githubusercontent.com/hgrecco/pint/master/pint/default_en.txt",
                "dest_subdir": "pint",
                "filename": "pint_default_en.txt",
                "description": "Pint default unit definitions",
                "expected_size_mb": 1,
            },
            {
                "url": "https://raw.githubusercontent.com/hgrecco/pint/master/pint/constants_en.txt",
                "dest_subdir": "pint",
                "filename": "pint_constants_en.txt",
                "description": "Pint constants",
                "expected_size_mb": 1,
            },
            {
                "url": "https://unitsofmeasure.org/ucum-essence.xml",
                "dest_subdir": "ucum",
                "filename": "ucum-essence.xml",
                "description": "UCUM unit definitions (XML)",
                "expected_size_mb": 1,
            },
        ],
    },
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def sizeof_fmt(num: float, suffix: str = "B") -> str:
    """Human-readable file size."""
    for unit in ("", "K", "M", "G", "T"):
        if abs(num) < 1024.0:
            return f"{num:3.1f} {unit}{suffix}"
        num /= 1024.0
    return f"{num:.1f} P{suffix}"


def sha256_file(path: Path, chunk_size: int = 1 << 20) -> str:
    """Compute SHA-256 of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def load_download_log() -> dict:
    """Load or create the download log."""
    log_path = MANIFESTS / "download_log.json"
    if log_path.exists():
        with open(log_path) as f:
            return json.load(f)
    return {"downloads": [], "last_updated": None}


def _atomic_json_write(path: Path, data: dict):
    """Write JSON atomically: tmp file + os.replace() to survive power-off."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(str(tmp), str(path))


def save_download_log(log: dict):
    """Persist the download log (atomic write)."""
    log["last_updated"] = datetime.now(timezone.utc).isoformat()
    _atomic_json_write(MANIFESTS / "download_log.json", log)


def record_download(log: dict, source_key: str, file_info: dict,
                    dest_path: Path, sha256: str, elapsed_s: float):
    """Append an entry to the download log."""
    entry = {
        "source": source_key,
        "url": file_info["url"],
        "filename": file_info["filename"],
        "description": file_info.get("description", ""),
        "dest": str(dest_path),
        "size_bytes": dest_path.stat().st_size if dest_path.exists() else 0,
        "sha256": sha256,
        "downloaded_at": datetime.now(timezone.utc).isoformat(),
        "elapsed_seconds": round(elapsed_s, 2),
    }
    log["downloads"].append(entry)
    save_download_log(log)


# ---------------------------------------------------------------------------
# Download engine
# ---------------------------------------------------------------------------

def _is_file_complete(dest: Path, expected_mb: int | None = None) -> bool:
    """Check if a downloaded file looks complete (exists, non-empty, size-sane)."""
    if not dest.exists() or dest.stat().st_size == 0:
        return False
    # If we know expected size, reject files < 80% of expected (likely partial)
    if expected_mb and expected_mb > 1:
        expected_bytes = expected_mb * 1_048_576
        if dest.stat().st_size < expected_bytes * 0.80:
            return False
    return True


def _done_marker(dest: Path) -> Path:
    """Path to the per-file completion marker."""
    return dest.parent / f".{dest.name}.done"


def download_file(url: str, dest: Path, description: str = "",
                  is_html_page: bool = False,
                  expected_size_mb: int | None = None) -> bool:
    """
    Download a URL to dest using curl for robustness.
    Supports resume (-C -) for large files.
    Uses a .done marker so partial files from crashes are re-downloaded.
    Returns True if the file was downloaded (or already exists).
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    marker = _done_marker(dest)

    # If the marker exists and the file is intact, skip
    if marker.exists() and dest.exists() and dest.stat().st_size > 0:
        print(f"  ✓ Already exists: {dest.name} ({sizeof_fmt(dest.stat().st_size)})")
        return True

    # If the file exists but no marker, it may be partial — curl -C - will resume
    if dest.exists() and dest.stat().st_size > 0:
        if _is_file_complete(dest, expected_size_mb):
            # Looks complete but marker is missing — create it
            print(f"  ✓ Already exists (unmarked, size OK): {dest.name} ({sizeof_fmt(dest.stat().st_size)})")
            marker.write_text(datetime.now(timezone.utc).isoformat())
            return True
        else:
            print(f"  ↻ Resuming partial download: {dest.name} ({sizeof_fmt(dest.stat().st_size)} so far)")

    label = description or dest.name
    print(f"  ↓ Downloading: {label}")
    print(f"    URL: {url}")
    print(f"    Dest: {dest}")

    # HTML pages on government / WAF-protected hosts use curl_cffi to
    # bypass TLS-fingerprint blocks (foodsafety.gov, fsis.usda.gov are on Akamai).
    if is_html_page:
        try:
            from curl_cffi import requests as _cr
        except ImportError:
            print("  ✗ curl_cffi not installed (needed for WAF-protected HTML).")
            print("    Run: pip install curl_cffi")
            return False
        try:
            r = _cr.get(url, impersonate="chrome", timeout=60, allow_redirects=True)
            if r.status_code != 200:
                print(f"  ✗ HTTP {r.status_code} for {label}")
                return False
            dest.write_bytes(r.content)
            marker.write_text(datetime.now(timezone.utc).isoformat())
            print(f"  ✓ Complete: {dest.name} ({sizeof_fmt(dest.stat().st_size)})")
            return True
        except Exception as e:
            print(f"  ✗ curl_cffi fetch failed: {label}: {e}")
            return False

    cmd = [
        "curl", "-fSL",
        "-C", "-",              # resume if partial
        "--retry", "5",         # more retries for flaky connections
        "--retry-delay", "10",
        "--retry-connrefused",   # retry on connection refused
        "--retry-max-time", "600",  # keep retrying up to 10 min
        "--max-time", "7200",    # 2hr timeout for large files
        "--connect-timeout", "30",
        "-o", str(dest),
        "-A", "Mozilla/5.0 (Lariat Data Pack)",
        url,
    ]

    try:
        subprocess.run(cmd, check=True)
        if dest.exists() and dest.stat().st_size > 0:
            # Write completion marker
            marker.write_text(datetime.now(timezone.utc).isoformat())
            print(f"  ✓ Complete: {dest.name} ({sizeof_fmt(dest.stat().st_size)})")
            return True
        else:
            print(f"  ✗ Download produced no file: {dest.name}")
            return False
    except subprocess.CalledProcessError as e:
        print(f"  ✗ Download failed (exit {e.returncode}): {label}")
        if dest.exists():
            print(f"    Partial file kept for resume: {sizeof_fmt(dest.stat().st_size)}")
        return False
    except KeyboardInterrupt:
        print(f"\n  ⚠ Download interrupted: {label}")
        if dest.exists():
            print(f"    Partial file kept for resume: {sizeof_fmt(dest.stat().st_size)}")
        raise


def download_source(source_key: str, source: dict, log: dict,
                    dry_run: bool = False):
    """Download all files for a single source."""
    print(f"\n{'='*60}")
    print(f"  {source['name']}  (priority: P{source['priority']})")
    print(f"{'='*60}")

    if source.get("note"):
        print(f"\n  NOTE: {source['note']}")

    if not source["files"]:
        print("  (no automatic downloads — see note above)")
        return

    dest_base = RAW / source["dest"]

    # ── Standard curl downloads ──
    for fi in source["files"]:
        dest = dest_base / fi["dest_subdir"] / fi["filename"]

        if dry_run:
            status = "EXISTS" if dest.exists() else "PENDING"
            size = f"~{fi.get('expected_size_mb', '?')} MB"
            print(f"  [{status}] {fi['filename']} ({size})")
            continue

        t0 = time.time()
        ok = download_file(
            url=fi["url"],
            dest=dest,
            description=fi.get("description", ""),
            is_html_page=fi.get("is_html_page", False),
            expected_size_mb=fi.get("expected_size_mb"),
        )
        elapsed = time.time() - t0

        if ok and dest.exists():
            print("    Computing SHA-256...")
            checksum = sha256_file(dest)
            record_download(log, source_key, fi, dest, checksum, elapsed)

            # Write individual checksum file
            cksum_dir = dest_base / "checksums"
            cksum_dir.mkdir(parents=True, exist_ok=True)
            cksum_file = cksum_dir / f"{fi['filename']}.sha256"
            cksum_file.write_text(f"{checksum}  {fi['filename']}\n")
            print(f"    SHA-256: {checksum[:16]}...")


# ---------------------------------------------------------------------------
# Status report
# ---------------------------------------------------------------------------

def print_status():
    """Print a status report of all sources and downloads."""
    log = load_download_log()
    downloaded_urls = {d["url"] for d in log.get("downloads", [])}

    print(f"\n{'='*70}")
    print("  LARIAT DATA PACK — STATUS REPORT")
    print(f"  Data root: {DATA_ROOT}")
    print(f"{'='*70}\n")

    total_files = 0
    done_files = 0
    total_size = 0

    for key, src in SOURCES.items():
        files = src.get("files", [])
        manual = bool(src.get("note") and not files)

        src_done = 0
        src_total = len(files)

        for fi in files:
            total_files += 1
            dest = RAW / src["dest"] / fi["dest_subdir"] / fi["filename"]
            if dest.exists() and dest.stat().st_size > 0:
                src_done += 1
                done_files += 1
                total_size += dest.stat().st_size

        if manual:
            status = "⚠ MANUAL"
        elif src_done == src_total and src_total > 0:
            status = "✓ DONE"
        elif src_done > 0:
            status = f"◐ {src_done}/{src_total}"
        else:
            status = "○ PENDING"

        print(f"  [{status:>12}]  P{src['priority']}  {src['name']}")

    print(f"\n  {'─'*50}")
    print(f"  Files: {done_files}/{total_files} downloaded")
    print(f"  Total on disk: {sizeof_fmt(total_size)}")

    # Disk space
    try:
        st = os.statvfs(str(DATA_ROOT))
        avail = st.f_bavail * st.f_frsize
        print(f"  Drive free space: {sizeof_fmt(avail)}")
    except Exception:
        pass

    print()


# ---------------------------------------------------------------------------
# Manifest generators
# ---------------------------------------------------------------------------

def generate_manifests():
    """Generate dataset_manifest.json and source_licenses.json."""
    # Dataset manifest
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_root": str(DATA_ROOT),
        "sources": {},
    }
    for key, src in SOURCES.items():
        files_on_disk = []
        for fi in src.get("files", []):
            dest = RAW / src["dest"] / fi["dest_subdir"] / fi["filename"]
            files_on_disk.append({
                "filename": fi["filename"],
                "description": fi.get("description", ""),
                "exists": dest.exists(),
                "size_bytes": dest.stat().st_size if dest.exists() else 0,
            })
        manifest["sources"][key] = {
            "name": src["name"],
            "priority": src["priority"],
            "dest_dir": src["dest"],
            "files": files_on_disk,
            "manual_download_required": bool(src.get("note") and not src["files"]),
        }

    _atomic_json_write(MANIFESTS / "dataset_manifest.json", manifest)

    # Source licenses
    licenses = {}
    for key, src in SOURCES.items():
        licenses[key] = {
            "name": src["name"],
            "license": src.get("license", "Unknown"),
        }

    _atomic_json_write(MANIFESTS / "source_licenses.json", licenses)

    print(f"\n  Manifests written to: {MANIFESTS}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Lariat Data Pack — Download Orchestrator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--source", "-s",
        choices=list(SOURCES.keys()),
        help="Download only this source (default: all)",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Print download status and exit",
    )
    parser.add_argument(
        "--dry-run", "-n",
        action="store_true",
        help="Preview downloads without executing",
    )
    parser.add_argument(
        "--priority", "-p",
        type=int,
        help="Download only sources at this priority level (0=highest)",
    )
    args = parser.parse_args()

    if args.status:
        print_status()
        return

    # Verify drive is mounted
    if not DATA_ROOT.exists():
        print("ERROR: External drive not mounted or data root missing.")
        print(f"  Expected: {DATA_ROOT}")
        sys.exit(1)

    log = load_download_log()

    # Determine which sources to download
    sources_to_run = {}
    if args.source:
        sources_to_run[args.source] = SOURCES[args.source]
    elif args.priority is not None:
        for k, v in SOURCES.items():
            if v["priority"] == args.priority:
                sources_to_run[k] = v
    else:
        sources_to_run = SOURCES

    # Sort by priority
    sorted_sources = sorted(sources_to_run.items(), key=lambda x: x[1]["priority"])

    if args.dry_run:
        print("\n  DRY RUN — no files will be downloaded\n")

    for key, src in sorted_sources:
        download_source(key, src, log, dry_run=args.dry_run)

    generate_manifests()

    if not args.dry_run:
        print_status()


if __name__ == "__main__":
    main()
