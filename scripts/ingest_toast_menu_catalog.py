#!/usr/bin/env python3
"""Ingest the Toast MenuItems + MenuOption catalog into lariat.db.

Sources (originals were moved to ~/Dev/_archives/lariat-pre-scrub-2026-04-18/
on 2026-04-18; this script reads them in place):

    data/originals/Toast/MenuItems.csv               (3590 rows, 11 cols)
    data/originals/Toast/MenuOption.csv              (416 rows, 9 cols)
    data/originals/Toast/MenuOptionGroupcurrent.csv  (416 rows, 9 cols)

NOTE on the option files: MenuOption.csv and MenuOptionGroupcurrent.csv
were verified byte-identical via `diff -q` on 2026-04-19, so we ingest
only MenuOption.csv (source_file='MenuOption.csv'). If a future export
makes them diverge, flip USE_BOTH_OPTION_FILES to True; the table's
UNIQUE(guid, location_id) plus INSERT OR IGNORE will keep duplicates
out while still capturing any new rows from the second file.

Headers (MenuItems has 11 cols, MenuOption has 9 — no SKU/PLU):
    Item ID, GUID, Name, Number, Imported ID, Base Price, Created Date,
    Archived, Modifier [, SKU, PLU]

Strategy: Full refresh of both tables for location_id='default'. DELETE
+ INSERT in a single transaction so a mid-insert failure rolls back
rather than emptying the table. "Yes"/"No" -> 1/0 for archived/modifier;
all string fields stripped.
"""

from __future__ import annotations

import argparse
import csv
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = Path(
    "/Users/seanburdges/Dev/_archives/lariat-pre-scrub-2026-04-18/data/"
    "originals/Toast"
)
DEFAULT_ITEMS_CSV = ARCHIVE / "MenuItems.csv"
DEFAULT_OPTION_CSV = ARCHIVE / "MenuOption.csv"
DEFAULT_OPTION_GROUP_CSV = ARCHIVE / "MenuOptionGroupcurrent.csv"
DEFAULT_DB = ROOT / "data" / "lariat.db"
DEFAULT_RECIPE_MAP = ROOT / "menus" / "toast_recipe_map.csv"

USE_BOTH_OPTION_FILES = False  # see note in module docstring

ITEMS_DDL = """
CREATE TABLE IF NOT EXISTS toast_menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  guid TEXT NOT NULL,
  name TEXT NOT NULL,
  number TEXT,
  imported_id TEXT,
  base_price REAL,
  created_date TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  modifier INTEGER NOT NULL DEFAULT 0,
  sku TEXT,
  plu TEXT,
  source_file TEXT,
  location_id TEXT DEFAULT 'default',
  imported_at TEXT DEFAULT (datetime('now')),
  UNIQUE(guid, location_id)
);
"""

ITEMS_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_toast_menu_items_archived "
    "ON toast_menu_items(archived);",
    "CREATE INDEX IF NOT EXISTS idx_toast_menu_items_name "
    "ON toast_menu_items(name);",
]

OPTIONS_DDL = """
CREATE TABLE IF NOT EXISTS toast_menu_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  guid TEXT NOT NULL,
  name TEXT NOT NULL,
  number TEXT,
  imported_id TEXT,
  base_price REAL,
  created_date TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  modifier INTEGER NOT NULL DEFAULT 0,
  source_file TEXT,
  location_id TEXT DEFAULT 'default',
  imported_at TEXT DEFAULT (datetime('now')),
  UNIQUE(guid, location_id)
);
"""


def _strip(v) -> str:
    if v is None:
        return ""
    return str(v).strip()


def _yes_no(v) -> int:
    return 1 if _strip(v).lower() == "yes" else 0


def _price(v) -> float | None:
    s = _strip(v)
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _none_if_empty(v) -> str | None:
    s = _strip(v)
    return s or None


def parse_csv(
    path: Path, has_sku_plu: bool, source_label: str,
) -> tuple[list[dict], dict[str, int]]:
    rows: list[dict] = []
    skipped = {"empty_guid": 0, "empty_name": 0, "short_row": 0}
    # Toast exports are cp1252 (Windows), not UTF-8. MenuItems.csv contains
    # bytes 0x92 (curly apostrophe in "Tito\x92s") and 0xbf 0xbf in a $???
    # placeholder. Ingest as cp1252 and let SQLite store the decoded UTF-8.
    with path.open("r", encoding="cp1252", newline="") as fh:
        reader = csv.DictReader(fh)
        for lineno, raw in enumerate(reader, start=2):
            item_id = _strip(raw.get("Item ID"))
            guid = _strip(raw.get("GUID"))
            name = _strip(raw.get("Name"))
            if not guid:
                skipped["empty_guid"] += 1
                print(
                    f"skip {path.name} line {lineno}: empty GUID",
                    file=sys.stderr,
                )
                continue
            if not name:
                skipped["empty_name"] += 1
                print(
                    f"skip {path.name} line {lineno}: empty Name "
                    f"(guid={guid})",
                    file=sys.stderr,
                )
                continue

            row = {
                "item_id": item_id,
                "guid": guid,
                "name": name,
                "number": _none_if_empty(raw.get("Number")),
                "imported_id": _none_if_empty(raw.get("Imported ID")),
                "base_price": _price(raw.get("Base Price")),
                "created_date": _none_if_empty(raw.get("Created Date")),
                "archived": _yes_no(raw.get("Archived")),
                "modifier": _yes_no(raw.get("Modifier")),
                "source_file": source_label,
                "location_id": "default",
            }
            if has_sku_plu:
                row["sku"] = _none_if_empty(raw.get("SKU"))
                row["plu"] = _none_if_empty(raw.get("PLU"))
            rows.append(row)
    return rows, skipped


def ensure_schema(con: sqlite3.Connection) -> None:
    cur = con.cursor()
    cur.execute(ITEMS_DDL)
    for stmt in ITEMS_INDEXES:
        cur.execute(stmt)
    cur.execute(OPTIONS_DDL)
    con.commit()


def refresh_items(
    con: sqlite3.Connection, rows: list[dict], dry_run: bool,
) -> tuple[int, int]:
    cur = con.cursor()
    before = cur.execute(
        "SELECT COUNT(*) FROM toast_menu_items "
        "WHERE location_id='default';"
    ).fetchone()[0]
    if dry_run:
        return before, len(rows)
    try:
        cur.execute("BEGIN;")
        cur.execute(
            "DELETE FROM toast_menu_items WHERE location_id='default';"
        )
        cur.executemany(
            """INSERT OR IGNORE INTO toast_menu_items
               (item_id, guid, name, number, imported_id, base_price,
                created_date, archived, modifier, sku, plu, source_file,
                location_id)
               VALUES (:item_id, :guid, :name, :number, :imported_id,
                       :base_price, :created_date, :archived, :modifier,
                       :sku, :plu, :source_file, :location_id);""",
            rows,
        )
        con.commit()
    except Exception:
        con.rollback()
        raise
    after = cur.execute(
        "SELECT COUNT(*) FROM toast_menu_items "
        "WHERE location_id='default';"
    ).fetchone()[0]
    return before, after


def refresh_options(
    con: sqlite3.Connection, rows: list[dict], dry_run: bool,
) -> tuple[int, int]:
    cur = con.cursor()
    before = cur.execute(
        "SELECT COUNT(*) FROM toast_menu_options "
        "WHERE location_id='default';"
    ).fetchone()[0]
    if dry_run:
        return before, len(rows)
    try:
        cur.execute("BEGIN;")
        cur.execute(
            "DELETE FROM toast_menu_options WHERE location_id='default';"
        )
        cur.executemany(
            """INSERT OR IGNORE INTO toast_menu_options
               (item_id, guid, name, number, imported_id, base_price,
                created_date, archived, modifier, source_file,
                location_id)
               VALUES (:item_id, :guid, :name, :number, :imported_id,
                       :base_price, :created_date, :archived, :modifier,
                       :source_file, :location_id);""",
            rows,
        )
        con.commit()
    except Exception:
        con.rollback()
        raise
    after = cur.execute(
        "SELECT COUNT(*) FROM toast_menu_options "
        "WHERE location_id='default';"
    ).fetchone()[0]
    return before, after


def report(
    con: sqlite3.Connection,
    recipe_map: Path | None,
    allow_orphans: bool = False,
) -> int:
    """Print a catalog-size report. Returns the orphan count so the caller
    can fail the ingest when toast_recipe_map.csv drifts out of sync with the
    Toast menu catalog — which is how commit 7e4c2bf's 4 orphans slipped in.
    Set ``allow_orphans`` for ops scenarios where the mapping is seeded
    ahead of a pending Toast publish.
    """
    cur = con.cursor()
    total = cur.execute(
        "SELECT COUNT(*) FROM toast_menu_items WHERE location_id='default';"
    ).fetchone()[0]
    archived = cur.execute(
        "SELECT COUNT(*) FROM toast_menu_items "
        "WHERE location_id='default' AND archived=1;"
    ).fetchone()[0]
    active = cur.execute(
        "SELECT COUNT(*) FROM toast_menu_items "
        "WHERE location_id='default' AND archived=0;"
    ).fetchone()[0]
    opt_total = cur.execute(
        "SELECT COUNT(*) FROM toast_menu_options "
        "WHERE location_id='default';"
    ).fetchone()[0]
    n_sku = cur.execute(
        "SELECT COUNT(*) FROM toast_menu_items "
        "WHERE location_id='default' AND sku IS NOT NULL AND sku != '';"
    ).fetchone()[0]
    n_plu = cur.execute(
        "SELECT COUNT(*) FROM toast_menu_items "
        "WHERE location_id='default' AND plu IS NOT NULL AND plu != '';"
    ).fetchone()[0]

    print(f"\ntoast_menu_items:   total={total}  active={active}  "
          f"archived={archived}")
    print(f"toast_menu_options: total={opt_total}")
    print(f"items with SKU:     {n_sku}")
    print(f"items with PLU:     {n_plu}")

    print("\nSample 5 active toast_menu_items:")
    for r in cur.execute(
        "SELECT guid, name, base_price, created_date "
        "FROM toast_menu_items "
        "WHERE location_id='default' AND archived=0 "
        "ORDER BY name LIMIT 5;"
    ):
        print(" ", r)

    if recipe_map and recipe_map.exists():
        with recipe_map.open("r", encoding="utf-8-sig", newline="") as fh:  # noqa: E501 - this one is utf-8
            reader = csv.DictReader(fh)
            map_rows = [
                (
                    _strip(r.get("toast_item_id")),
                    _strip(r.get("recipe_id")),
                )
                for r in reader
            ]
        # toast_recipe_map.csv keys recipes by toast_item_id, not GUID.
        present = set(
            row[0] for row in cur.execute(
                "SELECT item_id FROM toast_menu_items "
                "WHERE location_id='default';"
            )
        )
        orphans = [(tid, rid) for tid, rid in map_rows if tid and tid not in present]
        print(f"\ntoast_recipe_map.csv: {len(map_rows)} mappings, "
              f"{len(orphans)} orphan(s)")
        if orphans:
            print("Orphan toast_item_id -> recipe_id (no match in "
                  "toast_menu_items):")
            for tid, rid in orphans:
                print(f"  {tid}  ->  {rid}")
            if not allow_orphans:
                print(
                    "\nERROR: toast_recipe_map.csv has "
                    f"{len(orphans)} orphan(s). Either fix the CSV or pass "
                    "--allow-recipe-map-orphans if this is a deliberate "
                    "seed-ahead mapping.",
                    file=sys.stderr,
                )
                return len(orphans)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--items-csv", type=Path, default=DEFAULT_ITEMS_CSV)
    ap.add_argument("--option-csv", type=Path, default=DEFAULT_OPTION_CSV)
    ap.add_argument(
        "--option-group-csv", type=Path, default=DEFAULT_OPTION_GROUP_CSV,
    )
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--recipe-map", type=Path, default=DEFAULT_RECIPE_MAP)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--allow-recipe-map-orphans", action="store_true",
        help="Permit toast_recipe_map.csv entries whose toast_item_id is not "
             "in the current Toast catalog (e.g. seeded ahead of a publish).",
    )
    args = ap.parse_args()

    for p in (args.items_csv, args.option_csv):
        if not p.exists():
            print(f"ERROR: missing source {p}", file=sys.stderr)
            return 2
    if not args.db.exists():
        print(f"ERROR: missing db {args.db}", file=sys.stderr)
        return 2

    item_rows, item_skipped = parse_csv(
        args.items_csv, has_sku_plu=True, source_label="MenuItems.csv",
    )
    print(f"Parsed {len(item_rows)} items from {args.items_csv.name}")
    if any(item_skipped.values()):
        print(f"  items skipped: {dict(item_skipped)}", file=sys.stderr)

    option_rows, option_skipped = parse_csv(
        args.option_csv, has_sku_plu=False, source_label="MenuOption.csv",
    )
    print(f"Parsed {len(option_rows)} options from {args.option_csv.name}")
    if any(option_skipped.values()):
        print(f"  options skipped: {dict(option_skipped)}", file=sys.stderr)

    if USE_BOTH_OPTION_FILES and args.option_group_csv.exists():
        extra, extra_skipped = parse_csv(
            args.option_group_csv,
            has_sku_plu=False,
            source_label="MenuOptionGroupcurrent.csv",
        )
        print(f"Parsed {len(extra)} extra options from "
              f"{args.option_group_csv.name} (will INSERT OR IGNORE)")
        if any(extra_skipped.values()):
            print(f"  extra options skipped: {dict(extra_skipped)}",
                  file=sys.stderr)
        option_rows.extend(extra)

    with sqlite3.connect(str(args.db)) as con:
        ensure_schema(con)
        i_before, i_after = refresh_items(con, item_rows, args.dry_run)
        o_before, o_after = refresh_options(con, option_rows, args.dry_run)
        suffix = "  (dry-run)" if args.dry_run else ""
        print(f"toast_menu_items:   before={i_before}  after={i_after}"
              f"{suffix}")
        print(f"toast_menu_options: before={o_before}  after={o_after}"
              f"{suffix}")
        if not args.dry_run:
            orphans = report(
                con,
                args.recipe_map,
                allow_orphans=args.allow_recipe_map_orphans,
            )
            if orphans:
                return 3

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
