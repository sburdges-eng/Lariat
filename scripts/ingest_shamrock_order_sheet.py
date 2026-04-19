#!/usr/bin/env python3
"""Refresh `order_guide_items` for vendor='shamrock' from the Shamrock Order Sheet.

Source: data/originals/shamrock/Order Sheet.xls (CDFV2 binary .xls -> xlrd)
        Originals were moved to ~/Dev/_archives/lariat-pre-scrub-2026-04-18/
        on 2026-04-18; this script reads them in place.

Sheet layout (single sheet 'ordersheet'):
    row 0..2: header banner (date, account, four undated 'Date:' columns)
    row 3: column headers
        ['', '#', 'Product #', 'Description', 'Pack', 'Brand', 'Price',
         'Unit', 'PAR', 'ONHAND', 'ORDER', 'ONHAND', 'ORDER', 'ONHAND',
         'ORDER', 'ONHAND', 'ORDER']
    row 4..N: data rows.
        col 6  'Price' is a $-string ('$14.26').
        col 7  'Unit'  is one of EA/CS/LB (per-Unit semantics for Price).
        col 8  'PAR'   is the suggested order baseline expressed in vendor
                       packs. '-' means no par; we skip those (no fabricated
                       0). Identical semantics to the Inventory Sheet PAR.
        cols 9..16  'ONHAND'/'ORDER' x4 are blank scratch columns the BOH
                    fills in by hand each week. They are uniformly empty in
                    the 2026-03-28 export and are NOT ingested — there is no
                    actual order-quantity data here, only the PAR baseline.

Mapping into order_guide_items:
    ingredient = humanized vendor description (lowercased to match the
                 existing seed convention; the table is keyed by recipe-style
                 ingredient names elsewhere, but for vendor-catalog rows we
                 use the vendor description verbatim aside from case/spacing
                 normalisation).
    base_qty   = PAR value (in packs).  Per task spec: "If the order sheet
                 has a 'suggested order qty' column, use that for base_qty."
                 PAR is exactly that — the per-week order baseline.
    unit       = 'pack' (kept consistent with inventory_par.par_unit so the
                 two tables join cleanly). Pack composition lives in
                 vendor_prices.pack_size/pack_unit.
    unit_price = per-pack-unit price (price / pack_size), matching the
                 price-list ingest's `unit_price` semantics. For LB catch-
                 weight items the price IS already per-lb, so unit_price=price.
                 For EA single items unit_price=price.

Strategy: full refresh of vendor='shamrock' rows only.
    DELETE WHERE vendor='shamrock' AND location_id='default'
    then bulk INSERT, all wrapped in a single BEGIN/COMMIT with rollback.
    Other vendors (sysco, etc.) are untouched.
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path

import xlrd

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_XLS = (
    Path("/Users/seanburdges/Dev/_archives/lariat-pre-scrub-2026-04-18/data/")
    / "originals/shamrock/Order Sheet.xls"
)
DEFAULT_DB = ROOT / "data" / "lariat.db"
SOURCE_LABEL = "shamrock_order_sheet_2026-04-18"  # for log lines; no source col

# Pack-string trailing units we recognise. Order matters: longer first.
# Mirrors ingest_shamrock_price_list.py / ingest_shamrock_inventory_sheet.py.
_UNIT_TOKENS = [
    ("LBAV", "lb"),
    ("LB", "lb"),
    ("OZ", "oz"),    # dry oz
    ("FO", "floz"),  # fluid oz
    ("GAL", "gal"),
    ("GL", "gal"),
    ("ML", "ml"),
    ("DZ", "dz"),
    ("PC", "pc"),
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

    See ingest_shamrock_price_list.py for the canonical implementation.
    Returns (None, '') if unparseable, (None, unit) if unit found but qty
    can't be multiplied out, and (qty, unit) on success. qty == 0 returns
    (None, unit) so callers don't divide by zero downstream.
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


_PRICE_RE = re.compile(r"-?\d+(?:\.\d+)?")


def parse_price(price_cell) -> float | None:
    if price_cell is None or price_cell == "":
        return None
    if isinstance(price_cell, (int, float)):
        return float(price_cell)
    m = _PRICE_RE.search(str(price_cell))
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def parse_par(cell) -> float | None:
    """Parse the PAR cell. '-' / '' / None -> None. Numeric -> float."""
    if cell is None:
        return None
    if isinstance(cell, (int, float)):
        return float(cell)
    s = str(cell).strip()
    if not s or s == "-":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def humanize_ingredient(desc: str) -> str:
    """Light cleanup: collapse whitespace, lowercase.

    Existing order_guide_items rows use lowercase recipe-style ingredient
    names ('anchovy', 'apple cider vinegar'). Vendor descriptions are SHOUTY
    ABBREVIATED ('ANCHOVY, FLT IN OLV OIL 13Z CAN'); we lowercase to match
    the existing convention but keep the full vendor description so the row
    is unambiguously the catalog product, not a hand-curated recipe entry.
    """
    s = str(desc).strip()
    s = re.sub(r"\s+", " ", s)
    return s.lower()


def extract_rows(xls_path: Path) -> tuple[list[dict], dict[str, int]]:
    """Parse the .xls and return (rows, skip_counts).

    Rows where PAR == '-' are skipped under 'no_par' — same policy as
    inventory_par. order_guide_items is the suggested-order baseline; a
    NULL base_qty would defeat the table's purpose.
    """
    wb = xlrd.open_workbook(str(xls_path))
    sh = (
        wb.sheet_by_name("ordersheet")
        if "ordersheet" in wb.sheet_names()
        else wb.sheet_by_index(0)
    )

    rows: list[dict] = []
    skipped = {
        "short_row": 0,
        "empty_desc": 0,
        "non_numeric_idx": 0,
        "no_par": 0,
        "no_price": 0,
        "duplicate_key": 0,
    }
    seen_keys: set[tuple[str, str]] = set()

    # Data starts at row 4 (rows 0-2 banner, row 3 headers)
    for r in range(4, sh.nrows):
        row = sh.row_values(r)
        if len(row) < 9:
            skipped["short_row"] += 1
            print(f"skip row {r}: short row (len={len(row)})", file=sys.stderr)
            continue
        # Layout:
        #  0:'' | 1:# | 2:Product# | 3:Description | 4:Pack | 5:Brand
        #  6:Price | 7:Unit | 8:PAR | 9..16:ONHAND/ORDER scratch
        idx, sku, desc, pack_str, _brand, price_cell, unit_cell, par_cell = (
            row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8],
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
            # Dominant case (~half the catalog); silent on stderr.
            continue

        price = parse_price(price_cell)
        if price is None:
            skipped["no_price"] += 1
            print(
                f"skip row {r}: no price (sku={sku_str!r} desc={str(desc)[:40]!r})",
                file=sys.stderr,
            )
            continue

        pack_qty, pack_unit = parse_pack(pack_str)
        unit_token = str(unit_cell).strip().upper()

        # Per-unit price: same rules as ingest_shamrock_price_list.py
        if unit_token == "CS":
            unit_price = price / pack_qty if pack_qty is not None else None
        elif unit_token == "LB":
            unit_price = price  # already per-lb
            pack_unit = "lb"
        elif unit_token == "EA":
            if pack_qty is not None and pack_qty > 1:
                unit_price = price / pack_qty
            else:
                unit_price = price
        else:
            unit_price = price / pack_qty if pack_qty is not None else None

        ingredient = humanize_ingredient(desc)
        # Dedupe on (ingredient, sku) — the price list has no duplicates in
        # the 2025 export but be defensive in case a re-export does.
        key = (ingredient, sku_str)
        if key in seen_keys:
            skipped["duplicate_key"] += 1
            print(
                f"skip row {r}: duplicate key (sku={sku_str!r} desc={ingredient[:40]!r})",
                file=sys.stderr,
            )
            continue
        seen_keys.add(key)

        rows.append({
            "ingredient": ingredient,
            "base_qty": par_qty,
            "unit": "pack",  # PAR is in vendor packs; pack composition in vendor_prices
            "vendor": "shamrock",
            "unit_price": unit_price,
        })
    return rows, skipped


def upsert(db_path: Path, rows: list[dict], dry_run: bool) -> tuple[int, int, int]:
    """Refresh shamrock rows. Returns (shamrock_before, shamrock_after, sysco_after).

    The sysco_after count is returned so the caller can confirm we did NOT
    touch other vendors. Wrapped in BEGIN/COMMIT with rollback on failure
    so a mid-insert error doesn't leave the table empty.
    """
    with sqlite3.connect(str(db_path)) as con:
        cur = con.cursor()
        sham_before = cur.execute(
            "SELECT COUNT(*) FROM order_guide_items WHERE vendor='shamrock' "
            "AND location_id='default';"
        ).fetchone()[0]
        sysco_before = cur.execute(
            "SELECT COUNT(*) FROM order_guide_items WHERE vendor='sysco';"
        ).fetchone()[0]

        if dry_run:
            return sham_before, len(rows), sysco_before

        try:
            cur.execute("BEGIN;")
            cur.execute(
                "DELETE FROM order_guide_items WHERE vendor='shamrock' "
                "AND location_id='default';"
            )
            cur.executemany(
                """INSERT INTO order_guide_items
                   (ingredient, base_qty, unit, vendor, unit_price, location_id)
                   VALUES (:ingredient, :base_qty, :unit, :vendor,
                           :unit_price, :location_id)""",
                [{**r, "location_id": "default"} for r in rows],
            )
            con.commit()
        except Exception:
            con.rollback()
            raise

        sham_after = cur.execute(
            "SELECT COUNT(*) FROM order_guide_items WHERE vendor='shamrock' "
            "AND location_id='default';"
        ).fetchone()[0]
        sysco_after = cur.execute(
            "SELECT COUNT(*) FROM order_guide_items WHERE vendor='sysco';"
        ).fetchone()[0]
        # Hard-fail if sysco changed — should be impossible given the WHERE
        # clauses but cheap to check.
        if sysco_after != sysco_before:
            raise RuntimeError(
                f"sysco count changed: before={sysco_before} after={sysco_after}"
            )
        return sham_before, sham_after, sysco_after


def report(db_path: Path) -> None:
    with sqlite3.connect(str(db_path)) as con:
        cur = con.cursor()
        print("\nSample 5 shamrock order_guide_items rows:")
        for r in cur.execute(
            "SELECT ingredient, base_qty, unit, vendor, unit_price "
            "FROM order_guide_items WHERE vendor='shamrock' "
            "ORDER BY ingredient LIMIT 5;"
        ):
            print(" ", r)
        n_null_price = cur.execute(
            "SELECT COUNT(*) FROM order_guide_items WHERE vendor='shamrock' "
            "AND unit_price IS NULL;"
        ).fetchone()[0]
        total_par = cur.execute(
            "SELECT SUM(base_qty) FROM order_guide_items WHERE vendor='shamrock';"
        ).fetchone()[0]
        print(f"\nNULL unit_price: {n_null_price}")
        print(f"SUM(base_qty):   {total_par}")


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
    print(f"Parsed {len(rows)} order-guide rows from {args.xls.name} "
          f"(source={SOURCE_LABEL})")
    total_skipped = sum(skipped.values())
    print(f"Skipped: {total_skipped}", file=sys.stderr)
    if total_skipped:
        for reason, n in skipped.items():
            if n:
                print(f"  {reason}: {n}", file=sys.stderr)

    sham_before, sham_after, sysco_after = upsert(args.db, rows, args.dry_run)
    print(
        f"shamrock order_guide_items: before={sham_before}  after={sham_after}"
        + ("  (dry-run)" if args.dry_run else "")
    )
    print(f"sysco order_guide_items (unchanged): {sysco_after}")
    if not args.dry_run:
        report(args.db)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
