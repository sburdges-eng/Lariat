#!/usr/bin/env python3
"""
Lariat Data Pack — Wikibooks Cookbook Page Filter

Streams the full enwikibooks XML dump and extracts pages that belong
to the Cookbook namespace (ns 102) OR whose title starts with
"Cookbook:" in ns 0.  Each page is saved as an individual JSON file
in the selected_pages/ directory.

Output per page:
  { "title": "...", "ns": 102, "id": 1234, "text": "...(wikitext)..." }

Usage:
  python scripts/datapack/filter_wikibooks_cookbook.py
"""

import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

# ---------------------------------------------------------------------------
# Resolve paths (same logic as other datapack scripts)
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
    sys.exit(1)

XML_PATH = DATA_ROOT / "raw" / "wikibooks_cookbook" / "extracted" / "enwikibooks-latest-pages-articles.xml"
OUT_DIR = DATA_ROOT / "raw" / "wikibooks_cookbook" / "selected_pages"

NS = "{http://www.mediawiki.org/xml/export-0.11/}"

# Cookbook namespace = 102.  Also grab ns-0 pages titled "Cookbook:..."
COOKBOOK_NS = {"102"}
COOKBOOK_TITLE_PREFIX = "Cookbook:"

# Also grab the main-namespace (0) "Cookbook" book pages — these are the
# chapter/recipe pages that live outside the dedicated namespace.
FOOD_BOOKS = {
    "Cookbook",
    "Bartending",
    "Pizza",
    "Bread",
    "Cheese",
    "Beer",
    "Wine",
    "Food Preparation",
    "Indian Cuisine",
    "Chinese Cuisine",
    "Japanese Cuisine",
    "Korean Cuisine",
    "Thai Cuisine",
    "Italian Cuisine",
    "French Cuisine",
    "Mexican Cuisine",
    "Cuisines of the World",
    "Horticulture",
}


def _slugify(title: str) -> str:
    """Turn a page title into a safe filename."""
    s = title.replace("/", "__").replace(" ", "_")
    s = re.sub(r'[^A-Za-z0-9_\-.]', '', s)
    return s[:200]  # cap length


def is_cookbook_page(title: str, ns: str) -> bool:
    """Return True if this page belongs to a cookbook-related book."""
    if ns in COOKBOOK_NS:
        return True
    if title.startswith(COOKBOOK_TITLE_PREFIX):
        return True
    # Check main-namespace food books (e.g. "Bartending/Cocktails")
    if ns == "0":
        for book in FOOD_BOOKS:
            if title == book or title.startswith(f"{book}/"):
                return True
    return False


def main():
    if not XML_PATH.exists():
        print(f"ERROR: XML dump not found at {XML_PATH}")
        print("       Run extract_and_normalize.py --source wikibooks first.")
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Filtering Wikibooks cookbook pages")
    print(f"  Source: {XML_PATH}")
    print(f"  Output: {OUT_DIR}")
    print()

    kept = 0
    skipped = 0

    # Use iterparse to stream — the full XML is ~860 MB, too big to load
    context = ET.iterparse(str(XML_PATH), events=("end",))
    for event, elem in context:
        if elem.tag != f"{NS}page":
            continue

        title_el = elem.find(f"{NS}title")
        ns_el = elem.find(f"{NS}ns")
        id_el = elem.find(f"{NS}id")

        title = title_el.text if title_el is not None else ""
        ns = ns_el.text if ns_el is not None else ""
        page_id = id_el.text if id_el is not None else ""

        if not is_cookbook_page(title, ns):
            skipped += 1
            elem.clear()
            continue

        # Get the latest revision text
        rev = elem.find(f"{NS}revision")
        text_el = rev.find(f"{NS}text") if rev is not None else None
        text = text_el.text if text_el is not None else ""

        # Skip redirects (very short stubs that just point elsewhere)
        if text and text.strip().upper().startswith("#REDIRECT"):
            skipped += 1
            elem.clear()
            continue

        slug = _slugify(title)
        out_file = OUT_DIR / f"{slug}.json"
        out_file.write_text(json.dumps({
            "title": title,
            "ns": int(ns) if ns.isdigit() else ns,
            "id": int(page_id) if page_id.isdigit() else page_id,
            "text": text or "",
        }, ensure_ascii=False, indent=2), encoding="utf-8")

        kept += 1
        if kept % 100 == 0:
            print(f"  … {kept} pages extracted")

        elem.clear()

    print(f"\n✓ Done — {kept} cookbook pages saved, {skipped} non-cookbook pages skipped")
    print(f"  Output: {OUT_DIR}")


if __name__ == "__main__":
    main()
