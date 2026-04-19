#!/usr/bin/env python3
"""Refresh `inventory_par` for vendor='shamrock' from the Shamrock Inventory Sheet.

Source: data/originals/shamrock/Inventory Sheet.xls (CDFV2 binary .xls -> xlrd)

Sheet layout (single sheet 'inventorysheet'):
    row 0..2: header banner (date, account)
    row 3: column headers
        ['', '#', 'Product #', 'Description', 'Pack Size', 'Brand',
         'FUTURE', 'PAR', 'ON HAND', 'ORDER', 'ONHAND', 'ORDER']
    row 4..N: data rows.
        col 7 ('PAR') is the par level. Values are strings:
          - '-'  -> no par set, skip the row (do NOT fabricate a 0)
          - '1', '2', '3', ... -> integer par expressed in pack units
            (cases / each / lb container — whatever the vendor pack is).
        col 6 ('FUTURE') is uniformly '-' in the 2026-03-28 export, ignored.
        cols 8..11 are blank scratch columns the BOH fills in by hand
        and we don't ingest.

Pack Size strings look like '1/13/OZ', '6/.5/GL', '30/7/OZ', '4/5/LB' —
parsed with the same `parse_pack` helper as the price-list ingest.

Par unit semantics:
    The PAR column counts vendor packs (the same scale as the ORDER column),
    not consumption units. We store par_unit='pack' so downstream consumers
    can convert via pack_size + pack_unit if they want a weight/volume.

Strategy: full refresh — DELETE all rows for vendor='shamrock' AND
location_id='default', then bulk insert. DELETE+INSERT in one transaction
so a mid-insert failure rolls back rather than emptying the table.
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path

import xlrd

ROOT = Path(__file__).resolve().parent.parent
# Originals were moved to ~/Dev/_archives/lariat-pre-scrub-2026-04-18/ on 2026-04-18; this script reads them in place.
DEFAULT_XLS = (
    Path("/Users/seanburdges/Dev/_archives/lariat-pre-scrub-2026-04-18/data/")
    / "originals/shamrock/Inventory Sheet.xls"
)
DEFAULT_DB = ROOT / "data" / "lariat.db"
SOURCE_LABEL = "shamrock_inventory_sheet_2026-04-18"

# Pack-string trailing units we recognise. Order matters: longer first.
_UNIT_TOKENS = [
    ("LBAV", "lb"),
    ("LB", "lb"),
    ("OZ", "oz"),    # dry oz
    ("FO", "floz"),  # fluid oz
    ("GAL", "gal"),
    ("GL", "gal"),
    ("ML", "ml"),
    ("DZ", "dz"),    # dozen
    ("PC", "pc"),    # piece (catch-weight cuts)
    ("FT", "ft"),
    ("CT", "ct"),
    ("CN", "cn"),
    ("RL", "rl"),
    ("KG", "kg"),
    ("EA", "ea"),
    ("PK", "pk"),
    ("CS", "cs"),
    ("G", "g"),
]


def parse_pack(pack_str: str) -> tuple[float | None, str]:
    """Parse a pack-size string into (total_quantity, normalised_unit).

    Returns (None, '') if unparseable. See ingest_shamrock_price_list.py
    for the canonical implementation; this mirrors it exactly.
    """
    if pack_str is None:
        return None, ""
    s = str(pack_str).upper().strip()
    if not s:
        return None, ""

    unit = ""
    for tok, canon in _UNIT_TOKENS:
        if re.search(rf"(?:^|[^A-Z]){tok}$", s):
            unit = canon
            s_no_unit = s[: s.rfind(tok)].rstrip("/ ")
            break
    else:
        s_no_unit = s

    parts = [p for p in re.split(r"[/\s]+", s_no_unit) if p]
    qty = 1.0
    any_num = False
    for p in parts:
        try:
            qty *= float(p)
            any_num = True
        except ValueError:
            return None, unit
    if not any_num:
        return None, unit
    if qty == 0:
        return None, unit
    return qty, unit


def parse_par(cell) -> float | None:
    """Parse the PAR cell. '-' / '' / None -> None. Numeric string -> float."""
    if cell is None:
        return None
    if isinstance(cell, (int, float)):
        # xlrd sometimes hands back a float for cleanly numeric cells
        return float(cell)
    s = str(cell).strip()
    if not s or s == "-":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def humanize_ingredient(desc: str) -> str:
    s = str(desc).strip()
    s = re.sub(r"\s+", " ", s)
    return s


def extract_rows(xls_path: Path) -> tuple[list[dict], dict[str, int]]:
    """Parse the .xls and return (rows, skip_counts).

    Rows where PAR == '-' are skipped under the 'no_par' bucket — we do
    NOT insert NULL par_qty rows because the table is supposed to be the
    par-level baseline. The full vendor catalog still lives in
    vendor_prices; this table is only items the BOH actively pars.
    """
    wb = xlrd.open_workbook(str(xls_path))
    sh = (
        wb.sheet_by_name("inventorysheet")
        if "inventorysheet" in wb.sheet_names()
        else wb.sheet_by_index(0)
    )

    rows: list[dict] = []
    skipped = {
        "short_row": 0,
        "empty_desc": 0,
        "non_numeric_idx": 0,
        "no_par": 0,
        "duplicate_key": 0,
    }
    seen_keys: set[tuple[str, str, str]] = set()

    # Data starts at row 4 (rows 0-2 banner, row 3 headers)
    for r in range(4, sh.nrows):
        row = sh.row_values(r)
        if len(row) < 8:
            skipped["short_row"] += 1
            print(f"skip row {r}: short row (len={len(row)})", file=sys.stderr)
            continue
        # Layout:
        #  0: '' | 1: # | 2: Product # | 3: Description | 4: Pack Size
        #  5: Brand | 6: FUTURE | 7: PAR | 8..11: scratch
        idx, sku, desc, pack_str, _brand, _future, par_cell = (
            row[1], row[2], row[3], row[4], row[5], row[6], row[7],
        )
        if not desc or not str(desc).strip():
            skipped["empty_desc"] += 1
            print(f"skip row {r}: empty description", file=sys.stderr)
            continue
        if not isinstance(idx, (int, float)):
            skipped["non_numeric_idx"] += 1
            print(f"skip row {r}: non-numeric idx={idx!r}", file=sys.stderr)
            continue

        sku_str = str(sku).strip()
        if sku_str.endswith(".0"):
            sku_str = sku_str[:-2]

        par_qty = parse_par(par_cell)
        if par_qty is None:
            skipped["no_par"] += 1
            # No stderr log for this one — it's the dominant case (121 rows)
            # and would drown out the genuinely interesting skips above.
            continue

        ingredient = humanize_ingredient(desc)
        key = ("shamrock", ingredient, sku_str)
        if key in seen_keys:
            skipped["duplicate_key"] += 1
            print(
                f"skip row {r}: duplicate key (sku={sku_str!r} desc={ingredient[:40]!r})",
                file=sys.stderr,
            )
            continue
        seen_keys.add(key)

        pack_qty, pack_unit = parse_pack(pack_str)

        rows.append({
            "vendor": "shamrock",
            "ingredient": ingredient,
            "sku": sku_str,
            "par_qty": par_qty,
            "par_unit": "pack",
            "pack_size": pack_qty,
            "pack_unit": pack_unit or None,
            "category": None,
            "source": SOURCE_LABEL,
        })
    return rows, skipped


def upsert(db_path: Path, rows: list[dict], dry_run: bool) -> tuple[int, int]:
    with sqlite3.connect(str(db_path)) as con:
        cur = con.cursor()
        before = cur.execute(
            "SELECT COUNT(*) FROM inventory_par WHERE vendor='shamrock' "
            "AND location_id='default';"
        ).fetchone()[0]

        if dry_run:
            return before, len(rows)

        try:
            cur.execute("BEGIN;")
            cur.execute(
                "DELETE FROM inventory_par WHERE vendor='shamrock' "
                "AND location_id='default';"
            )
            cur.executemany(
                """INSERT INTO inventory_par
                   (vendor, ingredient, sku, par_qty, par_unit,
                    pack_size, pack_unit, category, source, location_id)
                   VALUES (:vendor, :ingredient, :sku, :par_qty, :par_unit,
                           :pack_size, :pack_unit, :category, :source,
                           :location_id)""",
                [{**r, "location_id": "default"} for r in rows],
            )
            con.commit()
        except Exception:
            con.rollback()
            raise
        after = cur.execute(
            "SELECT COUNT(*) FROM inventory_par WHERE vendor='shamrock' "
            "AND location_id='default';"
        ).fetchone()[0]
        return before, after


def report(db_path: Path) -> None:
    with sqlite3.connect(str(db_path)) as con:
        cur = con.cursor()
        print("\nSample 5 shamrock inventory_par rows:")
        for r in cur.execute(
            "SELECT ingredient, sku, par_qty, par_unit, pack_size, pack_unit "
            "FROM inventory_par WHERE vendor='shamrock' "
            "ORDER BY ingredient LIMIT 5;"
        ):
            print(" ", r)
        n_null_pack = cur.execute(
            "SELECT COUNT(*) FROM inventory_par WHERE vendor='shamrock' "
            "AND (pack_size IS NULL);"
        ).fetchone()[0]
        n_null_par = cur.execute(
            "SELECT COUNT(*) FROM inventory_par WHERE vendor='shamrock' "
            "AND (par_qty IS NULL);"
        ).fetchone()[0]
        total_par = cur.execute(
            "SELECT SUM(par_qty) FROM inventory_par WHERE vendor='shamrock';"
        ).fetchone()[0]
        print(f"\nNULL pack_size:  {n_null_pack}")
        print(f"NULL par_qty:    {n_null_par}")
        print(f"SUM(par_qty):    {total_par}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--xls", type=Path, default=DEFAULT_XLS)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.xls.exists():
        print(f"ERROR: missing source {args.xls}", file=sys.stderr)
        return 2
    if not args.db.exists():
        print(f"ERROR: missing db {args.db}", file=sys.stderr)
        return 2

    rows, skipped = extract_rows(args.xls)
    print(f"Parsed {len(rows)} par rows from {args.xls.name}")
    total_skipped = sum(skipped.values())
    print(f"Skipped: {total_skipped}", file=sys.stderr)
    if total_skipped:
        for reason, n in skipped.items():
            if n:
                print(f"  {reason}: {n}", file=sys.stderr)

    before, after = upsert(args.db, rows, args.dry_run)
    print(f"shamrock inventory_par count: before={before}  after={after}"
          + ("  (dry-run)" if args.dry_run else ""))
    if not args.dry_run:
        report(args.db)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
