#!/usr/bin/env python3
"""Build Lariat Unified Workbook from originals + existing master + new CSVs.

Reads three input classes from the pre-scrub archive:

  1. `data/originals/` — raw supplier sources:
        - shamrock/Price List-2025.xls  (parsed from existing master workbook
          mirror; .xls parsing via pandas requires xlrd)
        - sysco/Sysco Purchase History.csv  (SUPC-indexed purchase rows)
        - sysco/BEO basics.csv              (BEO item catalog)
        - Toast/MenuItems.csv               (Toast menu item export)
        - webstaurantstore/total_spend_2026-04-18.csv
  2. `XL/Lariat Master Workbook.xlsx` — existing monolith with 80+ sheets,
     including the Shamrock Price List we mirror and the 68 Shamrock OC
     sheets (parsing deferred; see TODO block in build_shamrock_orders).
  3. `XL/table-2026-04-24-*.csv` — seven Toast analytics exports from
     2026-04-24 (one file is a duplicate of another; the duplicate is
     dropped before writing).
  4. `XL/Lariat Invoice *.xlsx` — seven BEO event invoice workbooks.

Writes `XL/Lariat_Unified_Workbook_2026-04-24.xlsx` with:
  - 🔧 Schema Documentation  (first sheet — sheet index + field defs)
  - 🔧 Master Product Catalog (LAR-XXXX IDs)
  - 🔧 Master Transaction Log (TXN-XXXX IDs; Shamrock purchases deferred)
  - 📋 BEO Invoices
  - 📈 Supplier Comparison   (Shamrock PL ⟷ Sysco PH by description)
  - 📊 Toast Analytics — Yearly Sales
  - 📊 Toast Analytics — Sales By Category
  - 📊 Toast Analytics — Labor Yearly
  - 📊 Toast Analytics — Labor Monthly
  - 📊 Toast Analytics — Labor Weekly
  - 📊 Toast Analytics — Menu Groups
  - ref — Shamrock Price List (carried from master)
  - ref — Sysco Purchase History
  - ref — Sysco BEO Basics
  - ref — Toast MenuItems
  - ref — Webstaurantstore Spend
  - 📋 Deferred TODOs         (explicit list of what this build skipped)

Not yet generated (see "📋 Deferred TODOs" sheet for rationale):
  - 📋 Shamrock Orders (parsing the 68 OC sheets is a separate work item)
  - 📈 Pricing Trends (needs Shamrock Orders)
  - 📋 BEO Prep (per-event kitchen sheets; not all BEOs have them)
  - 📊 Dashboard with charts (openpyxl charts are fiddly; deferred)

Usage:
  python3 scripts/build_unified_workbook.py \
    --archive /Users/seanburdges/Dev/_archives/lariat-pre-scrub-2026-04-18 \
    --output  /Users/seanburdges/Dev/_archives/lariat-pre-scrub-2026-04-18/XL/Lariat_Unified_Workbook_2026-04-24.xlsx

  Both flags default to those exact paths.
"""
from __future__ import annotations

import argparse
import csv
import glob
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import openpyxl
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

DEFAULT_ARCHIVE = "/Users/seanburdges/Dev/_archives/lariat-pre-scrub-2026-04-18"
DEFAULT_OUTPUT = (
    f"{DEFAULT_ARCHIVE}/XL/Lariat_Unified_Workbook_2026-04-24.xlsx"
)

CURRENCY_RE = re.compile(r"^\s*\$?-?[\d,]+(?:\.\d+)?\s*$")
HOURS_RE = re.compile(r"^\s*(\d+)h\s*(\d+)?m?\s*$")

# ── Parsing helpers ───────────────────────────────────────────────


def parse_currency(s: Any) -> float | None:
    """'$192,989' → 192989.0 ; '$0' → 0.0 ; '' / None → None."""
    if s is None:
        return None
    t = str(s).strip()
    if not t or t in {"-", "--"}:
        return None
    if not CURRENCY_RE.match(t):
        return None
    return float(t.replace("$", "").replace(",", ""))


def parse_int_loose(s: Any) -> int | None:
    """'5,743' → 5743 ; '24,536.0' → 24536 ; 'N' → None."""
    if s is None:
        return None
    t = str(s).strip().replace(",", "")
    if not t:
        return None
    try:
        return int(float(t))
    except ValueError:
        return None


def parse_hours(s: Any) -> float | None:
    """'5411h 33m' → 5411.55 (hours as float)."""
    if s is None:
        return None
    m = HOURS_RE.match(str(s))
    if not m:
        return None
    h = int(m.group(1))
    mins = int(m.group(2) or 0)
    return h + mins / 60.0


def parse_percent(s: Any) -> float | None:
    """'31.5%' → 31.5 ; '' → None."""
    if s is None:
        return None
    t = str(s).strip().rstrip("%")
    if not t:
        return None
    try:
        return float(t)
    except ValueError:
        return None


# ── Per-sheet builders ────────────────────────────────────────────


@dataclass
class SheetPayload:
    name: str
    header: list[str]
    rows: list[list[Any]] = field(default_factory=list)
    freeze_top: bool = True

    def row_count(self) -> int:
        return len(self.rows)


# Toast analytics: the seven CSVs land as six distinct sheets because
# 134853 duplicates 134741. We detect the dup by comparing file contents.
TOAST_CSV_MAPPING = [
    ("table-2026-04-24-133542.csv", "📊 Toast Analytics — Yearly Sales"),
    ("table-2026-04-24-133723.csv", "📊 Toast Analytics — Sales By Category"),
    ("table-2026-04-24-134036.csv", "📊 Toast Analytics — Labor Yearly"),
    ("table-2026-04-24-134047.csv", "📊 Toast Analytics — Labor Monthly"),
    ("table-2026-04-24-134554.csv", "📊 Toast Analytics — Labor Weekly"),
    ("table-2026-04-24-134741.csv", "📊 Toast Analytics — Menu Groups"),
    # 134853 dropped as duplicate (verified at runtime)
]


def build_toast_analytics(archive: Path) -> list[SheetPayload]:
    sheets: list[SheetPayload] = []
    # Dup guard: if 134741 and 134853 are byte-identical, skip 134853 as
    # documented. If they're different, we still skip 134853 but log a
    # warning — the caller decides whether to investigate.
    p741 = archive / "XL" / "table-2026-04-24-134741.csv"
    p853 = archive / "XL" / "table-2026-04-24-134853.csv"
    if p741.exists() and p853.exists():
        if p741.read_bytes() != p853.read_bytes():
            print(
                "[warn] 134741 and 134853 differ; only 134741 is being used. "
                "Review if menu-groups analytics came in two variants.",
                file=sys.stderr,
            )

    for fname, sheet_name in TOAST_CSV_MAPPING:
        path = archive / "XL" / fname
        if not path.exists():
            print(f"[skip] {fname} not found", file=sys.stderr)
            continue
        with path.open(newline="", encoding="utf-8-sig") as fh:
            reader = csv.reader(fh)
            rows = list(reader)
        if not rows:
            continue
        header = rows[0]
        body: list[list[Any]] = []
        for raw in rows[1:]:
            # Pad/truncate to header length and coerce obvious numerics.
            padded = (raw + [None] * len(header))[: len(header)]
            coerced: list[Any] = []
            for col, cell in zip(header, padded):
                if cell is None or cell == "":
                    coerced.append(None)
                    continue
                col_l = col.lower()
                if "hours" in col_l and col_l != "total hours" or col_l == "total hours":
                    parsed = parse_hours(cell)
                    coerced.append(parsed if parsed is not None else cell)
                elif (
                    "$" in str(cell)
                    or "sales" in col_l
                    or "cost" in col_l
                    or "splh" in col_l
                    or "discounts" in col_l
                    or "voids" in col_l
                    or "refunds" in col_l
                    or "tax" in col_l
                ):
                    parsed = parse_currency(cell)
                    coerced.append(parsed if parsed is not None else cell)
                elif "%" in str(cell):
                    parsed = parse_percent(cell)
                    coerced.append(parsed if parsed is not None else cell)
                else:
                    parsed = parse_int_loose(cell)
                    coerced.append(parsed if parsed is not None else cell)
            body.append(coerced)
        sheets.append(SheetPayload(sheet_name, header, body))
    return sheets


# ── Shamrock Price List (from existing Master Workbook) ──────────


def build_shamrock_price_list_ref(master_xlsx: Path) -> SheetPayload:
    wb = openpyxl.load_workbook(master_xlsx, data_only=True, read_only=True)
    try:
        ws = wb["shamrock - Price List-2025"]
    except KeyError:
        wb.close()
        return SheetPayload(
            "ref — Shamrock Price List",
            ["product_no", "description", "pack_size", "brand", "price", "unit"],
        )
    header = ["product_no", "description", "pack_size", "brand", "price", "unit"]
    rows: list[list[Any]] = []
    started = False
    for row in ws.iter_rows(values_only=True):
        # row layout: [blank, #, Product #, Description, Pack Size, Brand, Price, Unit]
        if not row or len(row) < 8:
            continue
        if not started:
            # Header row is the one where row[1] == '#' literally.
            if str(row[1]).strip() == "#":
                started = True
            continue
        product_no = str(row[2]).strip() if row[2] else None
        if not product_no:
            continue
        rows.append(
            [
                product_no,
                str(row[3]).strip() if row[3] else None,
                str(row[4]).strip() if row[4] else None,
                str(row[5]).strip() if row[5] else None,
                parse_currency(row[6]),
                str(row[7]).strip() if row[7] else None,
            ]
        )
    wb.close()
    return SheetPayload("ref — Shamrock Price List", header, rows)


# ── Shamrock Orders (from 68 OC sheets in Master Workbook) ─────────


SHAMROCK_ORDERS_HEADER = [
    "ship_date",
    "order_ref",
    "product_no",
    "description",
    "pack_size",
    "brand",
    "quantity",
    "price",
    "unit",
    "line_amount",
]


def parse_shamrock_oc_sheet(ws, sheet_name: str) -> list[list[Any]]:
    ship_date = None
    rows: list[list[Any]] = []
    started = False

    for row in ws.iter_rows(values_only=True):
        if not started:
            # Look for ship date
            for i, cell in enumerate(row):
                if cell and str(cell).strip().lower() == "ship date":
                    # find the next non-empty cell in this row
                    for j in range(i + 1, len(row)):
                        if row[j] is not None and str(row[j]).strip():
                            ship_date = str(row[j]).strip()
                            break
            # Check for header
            if len(row) > 2 and row[1] is not None and str(row[1]).strip() == "#":
                started = True
            continue

        if len(row) < 19:
            continue

        product_no = str(row[2]).strip() if row[2] else None
        if not product_no or product_no.lower() == "none":
            # stop if we hit an empty row after started
            if not any(row):
                break
            continue

        desc = str(row[3]).strip() if row[3] else None
        pack = str(row[9]).strip() if row[9] else None
        brand = str(row[10]).strip() if row[10] else None
        qty = parse_int_loose(row[13])
        price = parse_currency(row[14])
        unit = str(row[17]).strip() if row[17] else None
        amount = parse_currency(row[18])

        dt = ship_date
        if ship_date:
            m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", ship_date)
            if m:
                dt = f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"

        rows.append(
            [
                dt,
                sheet_name,
                product_no,
                desc,
                pack,
                brand,
                qty,
                price,
                unit,
                amount,
            ]
        )
    return rows


def build_shamrock_orders(master_xlsx: Path) -> SheetPayload:
    wb = openpyxl.load_workbook(master_xlsx, data_only=True, read_only=True)
    oc_sheet_names = [n for n in wb.sheetnames if n.startswith("Shamrock OC ")]
    all_rows: list[list[Any]] = []
    
    for sheet_name in oc_sheet_names:
        ws = wb[sheet_name]
        all_rows.extend(parse_shamrock_oc_sheet(ws, sheet_name))
        
    wb.close()
    
    # Sort by ship_date (descending) then order_ref
    all_rows.sort(key=lambda r: (r[0] or "", r[1] or ""), reverse=True)
    
    return SheetPayload("📋 Shamrock Orders", SHAMROCK_ORDERS_HEADER, all_rows)


# ── Sysco Purchase History (line-item rows keyed by SUPC) ────────


SYSCO_PH_HEADER = [
    "supc",
    "pack",
    "size",
    "unit",
    "brand",
    "mfr_no",
    "description",
    "category",
    "case_price",
    "split_price",
    "per_lb",
    "net_wt_lb",
    "stock_status",
]


def _parse_sysco_flat_csv(path: Path) -> list[list[Any]]:
    """Sysco exports use H/F/P record markers. We only want P lines."""
    out: list[list[Any]] = []
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.reader(fh)
        for row in reader:
            if not row or row[0] != "P":
                continue
            # Columns per F-row: P, SUPC, CaseQty, SplitQty, Code, Status,
            # Replaced, Pack, Size, Unit, Brand, MfrNo, Desc, Cat, Case$,
            # Split$, PerLb, Market, Splittable, Splits, MinSplit, NetWt,
            # LeadTime, Stock, Substitute, Agr
            padded = (row + [None] * 27)[:27]
            out.append(
                [
                    padded[1],  # supc
                    padded[7],  # pack
                    padded[8],  # size
                    padded[9],  # unit
                    padded[10],  # brand
                    padded[11],  # mfr_no
                    padded[12],  # description
                    padded[13],  # category
                    parse_currency(padded[14]),  # case $
                    parse_currency(padded[15]),  # split $
                    str(padded[16]) if padded[16] is not None else None,  # per lb (Y/N)
                    parse_currency(padded[21]) if padded[21] is not None else None,
                    padded[23],  # stock status
                ]
            )
    return out


def build_sysco_purchase_history_ref(archive: Path) -> SheetPayload:
    path = archive / "data" / "originals" / "sysco" / "Sysco Purchase History.csv"
    if not path.exists():
        return SheetPayload("ref — Sysco Purchase History", SYSCO_PH_HEADER)
    return SheetPayload(
        "ref — Sysco Purchase History", SYSCO_PH_HEADER, _parse_sysco_flat_csv(path)
    )


def build_sysco_beo_basics_ref(archive: Path) -> SheetPayload:
    path = archive / "data" / "originals" / "sysco" / "BEO basics.csv"
    if not path.exists():
        return SheetPayload("ref — Sysco BEO Basics", SYSCO_PH_HEADER)
    return SheetPayload(
        "ref — Sysco BEO Basics", SYSCO_PH_HEADER, _parse_sysco_flat_csv(path)
    )


# ── Toast MenuItems ──────────────────────────────────────────────


def build_toast_menu_items_ref(archive: Path) -> SheetPayload:
    path = archive / "data" / "originals" / "Toast" / "MenuItems.csv"
    header = [
        "item_id",
        "guid",
        "name",
        "number",
        "imported_id",
        "base_price",
        "created_date",
        "archived",
        "modifier",
        "sku",
        "plu",
    ]
    if not path.exists():
        return SheetPayload("ref — Toast MenuItems", header)
    rows: list[list[Any]] = []
    # Toast exports mix UTF-8 and Latin-1 bytes in practice; tolerate.
    with path.open(newline="", encoding="utf-8-sig", errors="replace") as fh:
        reader = csv.DictReader(fh)
        for r in reader:
            rows.append(
                [
                    r.get("Item ID") or None,
                    r.get("GUID") or None,
                    r.get("Name") or None,
                    r.get("Number") or None,
                    r.get("Imported ID") or None,
                    parse_currency(r.get("Base Price")),
                    r.get("Created Date") or None,
                    r.get("Archived") or None,
                    r.get("Modifier") or None,
                    r.get("SKU") or None,
                    r.get("PLU") or None,
                ]
            )
    return SheetPayload("ref — Toast MenuItems", header, rows)


# ── Webstaurantstore total spend ─────────────────────────────────


def build_webstaurantstore_ref(archive: Path) -> SheetPayload:
    path = (
        archive
        / "data"
        / "originals"
        / "webstaurantstore"
        / "total_spend_2026-04-18.csv"
    )
    header = ["total_spend", "shipping_address"]
    if not path.exists():
        return SheetPayload("ref — Webstaurantstore Spend", header)
    # Format is non-standard: first line has a "Grand Total: " cell then the
    # actual fields. We just scan for a data row matching the header layout.
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = list(csv.reader(fh))
    rows: list[list[Any]] = []
    for row in reader[2:]:  # skip two-row header
        if not row or not row[0].strip():
            continue
        total = parse_currency(row[0])
        addr = row[1] if len(row) > 1 else None
        rows.append([total, addr])
    return SheetPayload("ref — Webstaurantstore Spend", header, rows)


# ── BEO invoices (parse the 7 event xlsx files) ──────────────────


BEO_INVOICES_HEADER = [
    "event_file",
    "client",
    "item",
    "cost_per_unit",
    "quantity",
    "line_total",
    "notes",
]


def _extract_client_from_filename(stem: str) -> str:
    # "Lariat Invoice Christy Nichols 9_7 " → "Christy Nichols"
    # "Invoice Darrell and anne collett 9_27" → "Darrell and anne collett"
    s = stem.replace("Lariat Invoice", "").replace("Invoice", "").strip()
    # Strip trailing date-like tokens (1-2 digits + _ + digits)
    s = re.sub(r"\s+\d{1,2}[_.\- ]\d{1,2}(?:[_.\- ]\d{2,4})?\s*$", "", s)
    return s.strip() or stem


def build_beo_invoices(archive: Path) -> SheetPayload:
    pattern = str(archive / "XL" / "Lariat Invoice *.xlsx")
    paths = sorted(glob.glob(pattern))
    # Also pick up the Darrell invoice (filename differs).
    paths += sorted(glob.glob(str(archive / "XL" / "Invoice *.xlsx")))
    rows: list[list[Any]] = []
    for p in paths:
        client = _extract_client_from_filename(Path(p).stem)
        try:
            wb = openpyxl.load_workbook(p, data_only=True, read_only=True)
        except Exception as err:
            print(f"[beo] failed to open {p}: {err}", file=sys.stderr)
            continue
        ws = wb[wb.sheetnames[0]]
        started = False
        for row in ws.iter_rows(values_only=True):
            # row[0..4] = Item, Cost, Amount, Total, Notes (left block)
            if not row or len(row) < 4:
                continue
            if not started:
                if row[0] and str(row[0]).strip().lower() == "item":
                    started = True
                continue
            item = str(row[0]).strip() if row[0] else None
            if not item:
                # blank row ends the left block; stop reading this sheet.
                break
            cost = parse_currency(row[1])
            qty = parse_currency(row[2])  # may be float like 20.0
            total = parse_currency(row[3])
            notes = str(row[4]).strip() if len(row) > 4 and row[4] else None
            rows.append([Path(p).name, client, item, cost, qty, total, notes])
        wb.close()
    return SheetPayload("📋 BEO Invoices", BEO_INVOICES_HEADER, rows)


# ── Derived: Master Product Catalog ──────────────────────────────


MPC_HEADER = [
    "lariat_id",
    "supplier",
    "supplier_product_no",
    "description",
    "pack_size",
    "brand",
    "price",
    "unit",
    "category",
    "source_list",
]


def build_master_product_catalog(
    shamrock: SheetPayload, sysco_ph: SheetPayload, sysco_beo: SheetPayload
) -> SheetPayload:
    """Unify Shamrock PL + Sysco PH + Sysco BEO into LAR-XXXX-keyed rows.

    Dedup key: (supplier, supplier_product_no). Collisions across suppliers
    get distinct LAR IDs. Price is whichever row won (first-seen wins).
    """
    seen: set[tuple[str, str]] = set()
    next_id = 1001
    rows: list[list[Any]] = []

    def emit(supplier: str, product_no: Any, description: Any, pack: Any,
             brand: Any, price: Any, unit: Any, category: Any, source: str) -> None:
        nonlocal next_id
        pno = (product_no or "").strip() if isinstance(product_no, str) else str(product_no or "").strip()
        if not pno:
            return
        key = (supplier, pno)
        if key in seen:
            return
        seen.add(key)
        rows.append(
            [
                f"LAR-{next_id}",
                supplier,
                pno,
                description,
                pack,
                brand,
                price,
                unit,
                category,
                source,
            ]
        )
        next_id += 1

    # Shamrock: (product_no, description, pack_size, brand, price, unit)
    for r in shamrock.rows:
        emit("Shamrock", r[0], r[1], r[2], r[3], r[4], r[5], None, "Price List-2025")

    # Sysco PH: (supc, pack, size, unit, brand, mfr, desc, cat, case$, split$, …)
    for src_name, payload in [
        ("Sysco Purchase History", sysco_ph),
        ("Sysco BEO Basics", sysco_beo),
    ]:
        for r in payload.rows:
            pack_size = f"{r[1]}/{r[2]}/{r[3]}" if r[1] and r[2] and r[3] else None
            emit(
                "Sysco",
                r[0],
                r[6],
                pack_size,
                r[4],
                r[8],  # case price
                r[3],  # unit
                r[7],  # category
                src_name,
            )

    return SheetPayload("🔧 Master Product Catalog", MPC_HEADER, rows)


# ── Derived: Supplier Comparison ─────────────────────────────────


SC_HEADER = [
    "description_normalized",
    "shamrock_product_no",
    "shamrock_description",
    "shamrock_price",
    "shamrock_unit",
    "sysco_supc",
    "sysco_description",
    "sysco_case_price",
    "sysco_unit",
]


def _normalize_desc(s: Any) -> str:
    if s is None:
        return ""
    t = str(s).upper()
    # Drop noisy punctuation, collapse spaces.
    t = re.sub(r"[^A-Z0-9 ]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def build_supplier_comparison(
    shamrock: SheetPayload, sysco_ph: SheetPayload
) -> SheetPayload:
    """Side-by-side rows where normalized first-word bucket matches.

    Not fuzzy: we bucket by the first token (e.g. 'BEEF', 'CHICKEN') and
    emit cartesian pairs where descriptions share the first *two* tokens.
    True fuzzy matching is out of scope; this gives operators a rough
    side-by-side to skim.
    """
    # Build bucket map for Sysco by first 2 tokens.
    sysco_by_prefix: dict[str, list[list[Any]]] = {}
    for r in sysco_ph.rows:
        n = _normalize_desc(r[6])
        if not n:
            continue
        toks = n.split()
        prefix = " ".join(toks[:2]) if len(toks) >= 2 else (toks[0] if toks else "")
        sysco_by_prefix.setdefault(prefix, []).append(r)

    out: list[list[Any]] = []
    for sr in shamrock.rows:
        n = _normalize_desc(sr[1])
        if not n:
            continue
        toks = n.split()
        prefix = " ".join(toks[:2]) if len(toks) >= 2 else (toks[0] if toks else "")
        matches = sysco_by_prefix.get(prefix, [])
        if not matches:
            # Still emit the Shamrock row alone so the comparison sheet
            # is a full left-join view (operators want to see "we buy
            # this from Shamrock; no Sysco equivalent available").
            out.append(
                [n, sr[0], sr[1], sr[4], sr[5], None, None, None, None]
            )
            continue
        for m in matches:
            out.append(
                [
                    n,
                    sr[0],
                    sr[1],
                    sr[4],
                    sr[5],
                    m[0],  # supc
                    m[6],  # sysco desc
                    m[8],  # sysco case price
                    m[3],  # sysco unit
                ]
            )
    # Sort by normalized description so the sheet reads alphabetically.
    out.sort(key=lambda r: r[0])
    return SheetPayload("📈 Supplier Comparison", SC_HEADER, out)


# ── Derived: Master Transaction Log (BEO revenue only, purchases TODO) ──


MTL_HEADER = [
    "transaction_id",
    "date",
    "type",
    "source_counterparty",
    "product_no",
    "description",
    "qty",
    "unit_price",
    "unit",
    "total_amount",
    "reference_no",
    "status",
]


def build_master_transaction_log(beo: SheetPayload, shamrock_orders: SheetPayload) -> SheetPayload:
    """BEO rows as revenue transactions and Shamrock purchases as expense transactions."""
    rows: list[list[Any]] = []
    next_id = 5001
    # Try to pluck the event date from the filename (e.g. 'Navratil 4_10.xlsx').
    file_date_re = re.compile(r"(\d{1,2})[_.\- ](\d{1,2})")
    for r in beo.rows:
        event_file, client, item, cost, qty, total, _notes = r
        m = file_date_re.search(event_file or "")
        if m:
            month, day = int(m.group(1)), int(m.group(2))
            date = f"2025-{month:02d}-{day:02d}"  # BEO files are all 2025 events
        else:
            date = None
        rows.append(
            [
                f"TXN-{next_id}",
                date,
                "BEO Revenue",
                f"Client: {client}" if client else None,
                None,
                item,
                qty,
                cost,
                None,
                total,
                f"BEO-{Path(event_file).stem}" if event_file else None,
                "Invoiced",
            ]
        )
        next_id += 1

    for r in shamrock_orders.rows:
        ship_date, order_ref, product_no, description, pack_size, brand, quantity, price, unit, line_amount = r
        rows.append(
            [
                f"TXN-{next_id}",
                ship_date,
                "Purchase",
                "Vendor: Shamrock",
                product_no,
                description,
                quantity,
                price,
                unit,
                line_amount,
                order_ref,
                "Delivered",
            ]
        )
        next_id += 1

    # Sort by date (descending)
    rows.sort(key=lambda r: r[1] or "", reverse=True)

    return SheetPayload("🔧 Master Transaction Log", MTL_HEADER, rows)


# ── Derived: Pricing Trends ──────────────────────────────────────


PRICING_TRENDS_HEADER = [
    "product_no",
    "description",
    "first_order_date",
    "last_order_date",
    "order_count",
    "min_price",
    "max_price",
    "first_price",
    "last_price",
    "pct_change",
]


def build_pricing_trends(shamrock_orders: SheetPayload) -> SheetPayload:
    grouped: dict[tuple[str, str], list[tuple[str, float]]] = {}
    for r in shamrock_orders.rows:
        ship_date, order_ref, product_no, description, pack_size, brand, quantity, price, unit, line_amount = r
        if not product_no or price is None or not ship_date:
            continue
        key = (product_no, str(description or ""))
        grouped.setdefault(key, []).append((ship_date, float(price)))

    out_rows: list[list[Any]] = []
    for (product_no, description), records in grouped.items():
        if len(records) < 2:
            continue
        records.sort(key=lambda x: x[0])
        first_date, first_price = records[0]
        last_date, last_price = records[-1]

        prices = [p for _, p in records]
        min_price = min(prices)
        max_price = max(prices)

        pct_change = None
        if first_price > 0:
            pct_change = (last_price - first_price) / first_price

        out_rows.append(
            [
                product_no,
                description,
                first_date,
                last_date,
                len(records),
                min_price,
                max_price,
                first_price,
                last_price,
                pct_change,
            ]
        )

    out_rows.sort(key=lambda r: r[9] if r[9] is not None else 0, reverse=True)
    return SheetPayload("📈 Pricing Trends", PRICING_TRENDS_HEADER, out_rows)


# ── Schema Documentation sheet ──────────────────────────────────


def build_schema_documentation(counts: dict[str, int]) -> SheetPayload:
    """Inline schema-doc sheet summarizing what this run actually produced.

    Intentionally differs from the old Schema Documentation.csv: that file
    was written by hand in April to describe an *aspirational* state. This
    sheet describes what THIS build actually emitted, with live row counts.
    """
    header = ["field_0", "field_1", "field_2", "field_3", "field_4"]
    rows: list[list[Any]] = [
        ["LARIAT UNIFIED WORKBOOK 2026-04-24", "", "", "", ""],
        ["Generated by scripts/build_unified_workbook.py", "", "", "", ""],
        ["", "", "", "", ""],
        ["SHEET INDEX", "", "", "", ""],
        ["Sheet", "Purpose", "Rows", "", ""],
    ]
    for name, n in counts.items():
        rows.append([name, "", n, "", ""])
    rows.extend(
        [
            ["", "", "", "", ""],
            ["FIELD DEFINITIONS — MASTER PRODUCT CATALOG", "", "", "", ""],
            ["Field", "Type", "Format", "Nullable", "Example"],
            ["lariat_id", "String", "LAR-XXXX", "No", "LAR-1001"],
            ["supplier", "String", "free text", "No", "Shamrock / Sysco"],
            ["supplier_product_no", "String", "alphanumeric", "No", "4608121"],
            ["description", "String", "free text", "No", "BEEF, CHEEK MEAT REFRIG"],
            ["pack_size", "String", "X/Y/UNIT", "Yes", "1/5/LB"],
            ["brand", "String", "abbreviation", "Yes", "KATYS"],
            ["price", "Currency", "numeric", "Yes", "57.26"],
            ["unit", "String", "CS/EA/LB", "No", "CS"],
            ["category", "String", "free text", "Yes", "Meat-Beef"],
            ["source_list", "String", "free text", "Yes", "Price List-2025"],
            ["", "", "", "", ""],
            ["FIELD DEFINITIONS — MASTER TRANSACTION LOG", "", "", "", ""],
            ["Field", "Type", "Format", "Nullable", "Example"],
            ["transaction_id", "String", "TXN-XXXX", "No", "TXN-5001"],
            ["date", "Date", "YYYY-MM-DD", "Yes", "2025-09-27"],
            ["type", "Enum", "Purchase | BEO Revenue", "No", "BEO Revenue"],
            ["source_counterparty", "String", "free text", "Yes", "Client: Darrell"],
            ["product_no", "String", "alphanumeric", "Yes", "4608121"],
            ["description", "String", "free text", "No", "Mac Balls"],
            ["qty", "Number", "numeric", "Yes", "20"],
            ["unit_price", "Currency", "numeric", "Yes", "4.00"],
            ["unit", "String", "CS/EA/LB", "Yes", ""],
            ["total_amount", "Currency", "numeric", "Yes", "80.00"],
            ["reference_no", "String", "BEO-… / OC-…", "Yes", "BEO-Navratil 4_10"],
            ["status", "String", "free text", "Yes", "Invoiced"],
        ]
    )
    return SheetPayload(
        "🔧 Schema Documentation", header, rows, freeze_top=False
    )


# ── Deferred TODOs sheet ─────────────────────────────────────────


def build_deferred_todos() -> SheetPayload:
    header = ["deferred_sheet", "blocker", "next_step"]
    rows = [
        [
            "📋 BEO Prep",
            "Per-event kitchen prep sheets exist as a second sheet in some BEO "
            "xlsx files ('BEO Kitchen *' sheets in the master). Not all events "
            "have one, and the layout varies per event.",
            "Add parse_beo_prep(wb) + append to the output; emit a warning "
            "for events without a prep sheet instead of failing.",
        ],
        [
            "📊 Dashboard (with charts)",
            "openpyxl chart API works but the axis/category binding is fiddly "
            "and the old Dashboard had 3 charts plus a KPI card grid.",
            "Defer to a follow-up PR; the Toast Analytics sheets already give "
            "operators a numeric readout of the same data.",
        ],
    ]
    return SheetPayload("📋 Deferred TODOs", header, rows)


# ── Workbook writer ──────────────────────────────────────────────


def write_workbook(path: Path, sheets: Iterable[SheetPayload]) -> None:
    wb = Workbook()
    # Remove the default sheet; we'll add our own.
    default = wb.active
    wb.remove(default)

    header_font = Font(bold=True)
    header_fill = PatternFill("solid", fgColor="D9D9D9")

    for s in sheets:
        ws = wb.create_sheet(title=_truncate_sheet_name(s.name))
        ws.append(s.header)
        for col_idx in range(1, len(s.header) + 1):
            cell = ws.cell(row=1, column=col_idx)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="left", vertical="center")
        for row in s.rows:
            ws.append(row)
        # Reasonable column widths.
        for i, col_name in enumerate(s.header, start=1):
            ws.column_dimensions[get_column_letter(i)].width = max(
                12, min(48, len(str(col_name)) + 4)
            )
        if s.freeze_top:
            ws.freeze_panes = "A2"

    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(path))


def _truncate_sheet_name(name: str) -> str:
    """Excel hard-limits sheet names to 31 chars."""
    if len(name) <= 31:
        return name
    return name[:28] + "…"


# ── Main ─────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--archive", default=DEFAULT_ARCHIVE)
    p.add_argument("--output", default=DEFAULT_OUTPUT)
    args = p.parse_args(argv)

    archive = Path(args.archive)
    output = Path(args.output)
    master_xlsx = archive / "XL" / "Lariat Master Workbook.xlsx"

    if not archive.exists():
        print(f"archive not found: {archive}", file=sys.stderr)
        return 2
    if not master_xlsx.exists():
        print(f"master workbook not found: {master_xlsx}", file=sys.stderr)
        return 2

    print(f"[build] archive={archive}")
    print(f"[build] master={master_xlsx}")
    print(f"[build] output={output}")

    # Parse reference sources first — downstream derived sheets read from these.
    shamrock = build_shamrock_price_list_ref(master_xlsx)
    print(f"  shamrock PL rows: {shamrock.row_count()}")
    sysco_ph = build_sysco_purchase_history_ref(archive)
    print(f"  sysco PH rows:    {sysco_ph.row_count()}")
    sysco_beo = build_sysco_beo_basics_ref(archive)
    print(f"  sysco BEO rows:   {sysco_beo.row_count()}")
    toast_menu = build_toast_menu_items_ref(archive)
    print(f"  toast menu rows:  {toast_menu.row_count()}")
    ws_spend = build_webstaurantstore_ref(archive)
    print(f"  webstaur. rows:   {ws_spend.row_count()}")
    beo = build_beo_invoices(archive)
    print(f"  BEO invoice rows: {beo.row_count()}")

    toast_analytics = build_toast_analytics(archive)
    for s in toast_analytics:
        print(f"  {s.name}: {s.row_count()} rows")

    shamrock_orders = build_shamrock_orders(master_xlsx)
    print(f"  shamrock orders:        {shamrock_orders.row_count()} rows")

    # Derived sheets.
    mpc = build_master_product_catalog(shamrock, sysco_ph, sysco_beo)
    print(f"  master product catalog: {mpc.row_count()} rows")
    comparison = build_supplier_comparison(shamrock, sysco_ph)
    print(f"  supplier comparison:    {comparison.row_count()} rows")
    mtl = build_master_transaction_log(beo, shamrock_orders)
    print(f"  master transaction log: {mtl.row_count()} rows")
    
    pricing_trends = build_pricing_trends(shamrock_orders)
    print(f"  pricing trends:         {pricing_trends.row_count()} rows")

    deferred = build_deferred_todos()

    # Assemble in display order.
    ordered: list[SheetPayload] = [
        # Schema docs first — but we need row counts, so build after everything.
        mpc,
        mtl,
        shamrock_orders,
        pricing_trends,
        beo,
        comparison,
        *toast_analytics,
        shamrock,
        sysco_ph,
        sysco_beo,
        toast_menu,
        ws_spend,
        deferred,
    ]
    counts = {s.name: s.row_count() for s in ordered}
    schema = build_schema_documentation(counts)
    ordered.insert(0, schema)

    write_workbook(output, ordered)
    print(f"\n✅ wrote {output}  ({len(ordered)} sheets)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
