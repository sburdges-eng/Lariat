#!/usr/bin/env python3
"""Derive per-item BEO prep defaults from past BEO prep worksheets.

Companion to ``ingest_catering_menu.py``: that script seeds the master
catering menu (name / category / cost) from the invoice worksheet; this
one attaches the *prep defaults* that pre-populate a BEO line item's
prep-sheet fields the moment a cook picks the item from the menu
dropdown. Source is the historical BEO prep log, aggregated across every
past event to the most common prep pattern per item.

The output is **PII-free** — client names, event dates, and quantities
are dropped; only the item-level prep pattern survives.

Field mapping (BEO prep log -> beo_line_items column):

    Pre-Prep -> prep_notes            (what to prep ahead)
    Plating  -> secondary_prep_notes  (how to plate / present)
    Notes    -> order_items_notes     (purchasing / ordering notes)

Writes::

    data/cache/catering_prep_defaults.json

Shape (keyed by the same normalized name the menu picker matches on)::

    {
      "braised chicken taco buffet": {
        "name": "Braised Chicken Taco Buffet",
        "prep": "THAW THIGHS/COOK",
        "plating": "2\\" HOTEL BUFFET",
        "order": ""
      },
      ...
    }

Usage::

    python3 scripts/ingest_catering_prep_defaults.py
    python3 scripts/ingest_catering_prep_defaults.py --file "path/to/_ BEO Prep.csv"
"""
from __future__ import annotations

import argparse
import csv
import glob
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# The prep log + invoices live with the real (PII) data sources, outside the repo.
BEO_DIR = Path.home() / "Dev" / "lariat-data-sources" / "BEO"
DEFAULT_FILE = BEO_DIR / "_ BEO Prep.csv"
MENU = ROOT / "data" / "cache" / "catering_menu.json"
OUT = ROOT / "data" / "cache" / "catering_prep_defaults.json"

# Placeholder cells that carry no real instruction.
NOISE = {"", "none", "na", "n/a", "-", "?", "tbd"}

# How each menu category is sold — the noun the "amount" counts.
CATEGORY_UNIT = {
    "Passed Apps": "piece",
    "Desserts": "piece",
    "Dinners": "plate",
    "Buffet": "pan",
    "Boards": "board",
}
# Non-food invoice rows to ignore when learning typical order sizes.
AMOUNT_SKIP = {
    "sub total", "taxes", "service fee", "total", "bar tab", "bar budget",
    "booking fee", "open bar basic", "gratuity", "bar spend amount (?)",
}


def normalize(name: str) -> str:
    """Match the menu picker's key: lowercased, whitespace-collapsed, trimmed.

    Mirrors the Swift ``CateringPrepDefaults.normalize`` exactly so a menu
    item and its prep default line up regardless of stray spacing/case.
    """
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def _clean(value: str) -> str:
    v = re.sub(r"\s+", " ", (value or "").strip())
    return "" if v.lower() in NOISE else v


def _pick(counter: Counter) -> str:
    """Most common non-noise value; ties break toward the longer (more
    specific) instruction so a real note beats a terse one."""
    if not counter:
        return ""
    top = counter.most_common()
    best_n = top[0][1]
    tied = [val for val, n in top if n == best_n]
    return max(tied, key=len)


def parse_prep(csv_path: Path) -> dict:
    lines = csv_path.read_text(encoding="utf-8", errors="replace").splitlines()
    # Row 0 is a positional index header ("0,1,2,..."); the real header
    # ("Client,Event Date,Type,Item,Amount/Qty,Prep Day,Pre-Prep,Plating,Notes")
    # is row 1 — same two-header shape the invoice worksheets use.
    reader = csv.DictReader(lines[1:])

    agg: dict[str, dict[str, Counter]] = defaultdict(
        lambda: {"pre": Counter(), "plate": Counter(), "notes": Counter(), "display": Counter()}
    )
    for row in reader:
        item = (row.get("Item") or "").strip()
        key = normalize(item)
        if not key:
            continue
        bucket = agg[key]
        bucket["display"][item] += 1
        if (pre := _clean(row.get("Pre-Prep", ""))):
            bucket["pre"][pre] += 1
        if (plate := _clean(row.get("Plating", ""))):
            bucket["plate"][plate] += 1
        if (note := _clean(row.get("Notes", ""))):
            bucket["notes"][note] += 1

    out: dict[str, dict] = {}
    for key, bucket in agg.items():
        prep, plating, order = _pick(bucket["pre"]), _pick(bucket["plate"]), _pick(bucket["notes"])
        if not (prep or plating or order):
            continue  # nothing worth pre-filling
        out[key] = {
            "name": _pick(bucket["display"]) or key,
            "prep": prep,
            "plating": plating,
            "order": order,
        }
    return dict(sorted(out.items()))


def parse_invoice_amounts(beo_dir: Path) -> dict[str, Counter]:
    """Learn the typical order size per item from past invoices.

    Invoice lines are ``Item, Cost, Amount, Total`` — ``Amount`` is the
    quantity billed (pieces for passed apps, pans/boards for buffets). We
    match on the EXACT normalized name only: a passed-app "Braised Chicken
    Taco" and a "Braised Chicken Taco Buffet" pan are distinct products and
    must not borrow each other's counts.
    """
    amounts: dict[str, Counter] = defaultdict(Counter)
    files = glob.glob(str(beo_dir / "*Invoice*.csv")) + glob.glob(str(beo_dir / "*invoice*.csv"))
    for path in files:
        lines = Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
        for row in csv.reader(lines[2:]):  # skip positional + real header rows
            if len(row) < 3:
                continue
            key = normalize(row[0])
            if not key or key in AMOUNT_SKIP:
                continue
            try:
                amt = float(row[2])
            except ValueError:
                continue
            if amt > 0:
                amounts[key][int(amt)] += 1
    return amounts


def amount_for(key: str, category: str, invoice_amounts: dict[str, Counter]) -> tuple[str, int]:
    """(human amount description, default line quantity) for a menu item."""
    unit = CATEGORY_UNIT.get(category, "order")
    counts = invoice_amounts.get(key)
    if counts:
        typ = counts.most_common(1)[0][0]
    else:
        typ = 1 if unit in ("pan", "board") else 50  # sensible category default
    noun = unit if typ == 1 else (unit + "s" if unit != "pan" else "pans")
    if counts:
        desc = f"per {unit} · typically {typ} {noun}"
    else:
        desc = f"per {unit}"
    return desc, typ


def build_line_defaults(prep_file: Path, menu_file: Path, beo_dir: Path) -> dict:
    """Unified per-item BEO line defaults: prep (from the prep log) + amount
    (from the menu category + invoice history). Keyed by normalized name; one
    entry per menu item that carries anything worth pre-filling."""
    prep = parse_prep(prep_file)
    invoice_amounts = parse_invoice_amounts(beo_dir)
    try:
        menu = json.loads(menu_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        menu = []

    out: dict[str, dict] = {}
    for m in menu:
        name = (m.get("name") or "").strip()
        key = normalize(name)
        if not key:
            continue
        desc, typ_qty = amount_for(key, m.get("category", ""), invoice_amounts)
        p = prep.get(key, {})
        out[key] = {
            "name": p.get("name") or name,
            "prep": p.get("prep", ""),
            "plating": p.get("plating", ""),
            "order": p.get("order", ""),
            "amount_desc": desc,
            "typ_qty": typ_qty,
        }
    # Prep-only items not present in the menu still keep their prep defaults.
    for key, p in prep.items():
        out.setdefault(key, {**p, "amount_desc": "", "typ_qty": 1})
    return dict(sorted(out.items()))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--file", type=Path, default=DEFAULT_FILE, help="BEO prep CSV")
    ap.add_argument("--menu", type=Path, default=MENU, help="catering_menu.json")
    ap.add_argument("--beo-dir", type=Path, default=BEO_DIR, help="dir of BEO invoice CSVs")
    ap.add_argument("--out", type=Path, default=OUT, help="output JSON cache")
    args = ap.parse_args()

    if not args.file.exists():
        raise SystemExit(f"prep log not found: {args.file}")

    defaults = build_line_defaults(args.file, args.menu, args.beo_dir)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(defaults, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    n_prep = sum(1 for v in defaults.values() if v["prep"] or v["plating"] or v["order"])
    print(f"wrote {len(defaults)} line defaults ({n_prep} with prep) -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
