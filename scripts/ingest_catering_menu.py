#!/usr/bin/env python3
"""Seed the catering menu cache from a Lariat invoice worksheet.

The Drive-style BEO worksheet uses a two-column layout. The right-hand
pane (Item / Cost / Amount starting at column F) is the master
catering menu, with category banner rows ("Buffet", "Boards",
"Desserts", "Dinners"). The leading rows — from "Item " through the
first category banner — are passed appetizers (no banner in the
source). Rows with no Cost cell are banner rows, not items.

Writes::

    data/cache/catering_menu.json

Shape::

    [
      {"category": "Passed Apps", "name": "Nashville Slider", "cost": 6.0},
      ...
      {"category": "Buffet", "name": "Trio Dips", "cost": 15.0},
      ...
    ]

Usage::

    python3 scripts/ingest_catering_menu.py
    python3 scripts/ingest_catering_menu.py --file path/to/invoice.xlsx
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FILE = ROOT / "data" / "imports" / "beo-reference" / "sample-invoice-bob-clauss.xlsx"
OUT = ROOT / "data" / "cache" / "catering_menu.json"

# Column indices in the worksheet (0-based):
COL_ITEM = 5   # F
COL_COST = 6   # G
COL_AMT  = 7   # H


def parse_menu(xlsx: Path) -> list[dict]:
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    items: list[dict] = []
    # Start with the implicit "Passed Apps" category — the sheet lists
    # appetizers above the first category banner.
    current = "Passed Apps"
    header_seen = False
    for r in rows:
        if r is None or len(r) <= COL_COST:
            continue
        cell_item = r[COL_ITEM]
        cell_cost = r[COL_COST] if len(r) > COL_COST else None
        if cell_item is None or str(cell_item).strip() == "":
            continue
        name = str(cell_item).strip()
        if name.lower() == "item":
            header_seen = True
            continue
        if not header_seen:
            continue
        if cell_cost is None or str(cell_cost).strip() == "":
            # Banner row naming a new category.
            current = name
            continue
        try:
            cost = float(str(cell_cost).replace("$", "").replace(",", ""))
        except ValueError:
            continue
        items.append({"category": current, "name": name, "cost": cost})
    return items


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--file", type=Path, default=DEFAULT_FILE)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.file.exists():
        print(f"Missing: {args.file}", file=sys.stderr)
        return 2

    items = parse_menu(args.file)
    cats: dict[str, int] = {}
    for it in items:
        cats[it["category"]] = cats.get(it["category"], 0) + 1

    summary = ", ".join(f"{k}:{v}" for k, v in cats.items())
    print(f"Parsed {len(items)} items from {args.file.name}  [{summary}]")
    if args.dry_run:
        for it in items:
            print(f"  {it['category']:13} ${it['cost']:>6.2f}  {it['name']}")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(items, indent=2))
    print(f"Wrote {OUT.relative_to(ROOT)} ({len(items)} items)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
