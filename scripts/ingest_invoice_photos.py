#!/usr/bin/env python3
"""Ingest photographed paper invoices (Sysco / Shamrock delivery invoices).

Source: bbox-OCR JSON produced by the Vision OCR pass over
``~/Downloads/lariat-docs`` (one ``_ocr_boxes3/<IMG>.json`` per photo, each
``{"orientation": ..., "boxes": [{"t","x","y","w","h"}, ...]}`` with
normalized top-left-origin coordinates). The photos are iPhone shots of the
printed delivery invoices — a DIFFERENT document series from what is already
in the DB:

  - ``shamrock_invoices`` holds Shamrock *order confirmations* (7-digit sales
    order numbers, .xls exports). The photos are *delivery invoices* (8-digit
    invoice numbers). Same goods can appear in both — do NOT sum the two
    tables for spend without reconciling.
  - The Sysco PDF ingest covers 10 EnterpriseInvoice PDFs; the photos are 40+
    other invoices with zero overlap.

Parsing strategy (deterministic, offline):
  1. Cluster word boxes into visual rows by y-center (works for flat pages —
     Sysco invoices are machine-printed and photographed flat).
  2. Sysco: a line item is a row containing a 7-digit SKU and >=1 money
     value. unit_price = first money, line_total = last money (a middle value
     is tax). qty = printed leading int, else round(line_total/unit_price).
  3. Shamrock: paper is wrinkled, so rows drift across columns. Parse by
     COLUMN bands instead: SKU tokens (left), description text (middle),
     money (right, split into item-price and extended sub-columns by x),
     then zip columns in y-order. A leading digit fused onto an 8-digit SKU
     token is the quantity (true Shamrock SKUs are 7 digits).
  4. Photos of customers other than Lariat (e.g. THE BLEND) are excluded.

Idempotency: per-invoice refresh — DELETE the existing (vendor, invoice_no,
location_id) header + lines inside the same transaction, then re-INSERT.
Photos with no detected invoice_no are keyed by source file name instead.

Zero-row guard: aborts (exit 2) before any write if no invoices parse.

Run:
  .venv/bin/python scripts/ingest_invoice_photos.py            # dry-run (default)
  .venv/bin/python scripts/ingest_invoice_photos.py --live     # write to DB
  .venv/bin/python scripts/ingest_invoice_photos.py --boxes-dir <dir> --db <path>
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date as _date
from pathlib import Path

DEFAULT_BOXES_DIR = Path.home() / "Downloads/lariat-docs/_ocr_boxes3"
DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "lariat.db"
LOCATION_ID = "default"

MONEY_RE = re.compile(r"^\$?\s?(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s?[NT]?$")
SYSCO_SKU_RE = re.compile(r"^\d{7}$")
SHAMROCK_SKU_RE = re.compile(r"^\(?(\d)?\s?(\d{7})\)?$")
DATE_RE = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b")
SYSCO_INVOICE_RE = re.compile(r"\b(7\d{8})\b")
SHAMROCK_INVOICE_RE = re.compile(r"\b(3\d{7})\b")

SYSCO_CATEGORIES = (
    "DAIRY PRODUCTS", "MEATS", "POULTRY", "SEAFOOD", "FROZEN",
    "CANNED & DRY", "PAPER & DISP", "PRODUCE", "MISC", "BAKERY",
    "DISPOSABLES", "CHEMICALS",
)

EXCLUDED_CUSTOMERS = ("THE BLEND", "COOL RIVER")


# ---------------------------------------------------------------- geometry

def rows_from_boxes(boxes: list[dict], tol_factor: float = 0.5) -> list[list[dict]]:
    """Cluster word boxes into visual rows by y-center proximity."""
    if not boxes:
        return []
    heights = sorted(b["h"] for b in boxes)
    med_h = heights[len(heights) // 2]
    tol = max(med_h * tol_factor, 1e-4)
    ordered = sorted(boxes, key=lambda b: b["y"] + b["h"] / 2)
    rows: list[list[dict]] = []
    cur: list[dict] = []
    cur_y: float | None = None
    for b in ordered:
        yc = b["y"] + b["h"] / 2
        if cur_y is None or abs(yc - cur_y) <= tol:
            cur.append(b)
            cur_y = sum(x["y"] + x["h"] / 2 for x in cur) / len(cur)
        else:
            rows.append(sorted(cur, key=lambda x: x["x"]))
            cur, cur_y = [b], yc
    if cur:
        rows.append(sorted(cur, key=lambda x: x["x"]))
    return rows


def row_text(row: list[dict]) -> str:
    return " ".join(b["t"] for b in row)


# ---------------------------------------------------------------- helpers

def parse_money(token: str) -> float | None:
    m = MONEY_RE.match(token.strip())
    if not m:
        return None
    raw = m.group(1)
    # OCR swaps , and . — normalize: the last separator is the decimal point.
    digits = re.sub(r"[.,]", "", raw)
    return float(digits) / 100.0


def parse_date_iso(token: str) -> str | None:
    m = DATE_RE.search(token)
    if not m:
        return None
    mo, dd, yy = (int(g) for g in m.groups())
    if yy < 100:
        yy += 2000
    if not (1 <= mo <= 12 and 1 <= dd <= 31 and 2020 <= yy):
        return None
    iso = f"{yy:04d}-{mo:02d}-{dd:02d}"
    # Invoices cannot be dated in the future — OCR year misreads (e.g. 2029
    # for 2025) otherwise win the "latest date on page" header heuristic.
    if iso > _date.today().isoformat():
        return None
    return iso


@dataclass
class Line:
    sku: str | None
    description: str
    qty: float | None
    unit: str | None
    pack_size: str | None
    unit_price: float | None
    line_total: float | None
    category: str | None
    confidence: str  # high | medium | low


@dataclass
class PhotoParse:
    file: str
    vendor: str | None
    customer: str | None
    invoice_no: str | None
    invoice_date: str | None
    invoice_total: float | None
    lines: list[Line] = field(default_factory=list)


# ---------------------------------------------------------------- classify

def classify(full_text: str) -> tuple[str | None, str | None]:
    """Return (vendor, customer) from full page text."""
    up = full_text.upper()
    vendor = None
    if "SYSCO" in up:
        vendor = "Sysco"
    elif "SHAMROCK" in up:
        vendor = "Shamrock"
    customer = None
    for c in EXCLUDED_CUSTOMERS:
        if c in up:
            customer = c.title()
            break
    if customer is None and "LARIAT" in up:
        customer = "Lariat"
    return vendor, customer


# ---------------------------------------------------------------- Sysco

def parse_sysco_lines(rows: list[list[dict]]) -> list[Line]:
    lines: list[Line] = []
    category = None
    pending: Line | None = None  # line item awaiting an orphan total row
    for row in rows:
        text = row_text(row)
        up = text.upper()
        for cat in SYSCO_CATEGORIES:
            if cat in up and len(up) < len(cat) + 25:
                category = cat
                break
        if "GROUP TOTAL" in up:
            pending = None
            continue

        tokens = [b["t"].strip() for b in row]
        moneys = [(i, parse_money(t)) for i, t in enumerate(tokens)]
        moneys = [(i, v) for i, v in moneys if v is not None]
        skus = [i for i, t in enumerate(tokens) if SYSCO_SKU_RE.match(t)]

        # Orphan money row: a wrapped line_total from the previous item.
        if pending is not None and not skus and len(moneys) == 1 and len(tokens) <= 2:
            pending.line_total = moneys[0][1]
            if pending.unit_price:
                pending.qty = round(pending.line_total / pending.unit_price) or 1
            pending.confidence = "medium"
            pending = None
            continue

        if not skus or not moneys:
            continue
        sku_idx = skus[-1] if not moneys or skus[-1] < moneys[0][0] else skus[0]
        sku = tokens[sku_idx]
        unit_price = moneys[0][1]
        line_total = moneys[-1][1] if len(moneys) >= 2 else None

        qty = None
        unit = None
        pack = None
        desc_parts = []
        for i, t in enumerate(tokens[:sku_idx]):
            tu = t.upper()
            if i == 0 and re.fullmatch(r"\d{1,2}", t):
                qty = float(t)
            elif tu in ("CS", "EA", "LB", "DZ", "GA", "PL") and unit is None:
                unit = tu
            elif re.fullmatch(r"\d*\s?(LB|OZ|CT|EA|GAL|DZ|#|LBS)S?", tu) and pack is None:
                pack = t
            elif parse_money(t) is None and not SYSCO_SKU_RE.match(t):
                desc_parts.append(t)
        desc = " ".join(desc_parts).strip()
        if not desc:
            continue

        if qty is None and unit_price and line_total:
            derived = line_total / unit_price
            qty = round(derived) if abs(derived - round(derived)) < 0.15 else None
        confidence = "high" if (qty and line_total) else ("medium" if line_total else "low")
        line = Line(sku=sku, description=desc, qty=qty, unit=unit, pack_size=pack,
                    unit_price=unit_price, line_total=line_total,
                    category=category, confidence=confidence)
        lines.append(line)
        pending = line if line_total is None else None
    return lines


# ---------------------------------------------------------------- Shamrock

def _monotonic_zip(anchor: list[dict], others: list[list[dict]], tol: float = 0.025):
    """Zip column lists by nearest-y to each anchor box, consuming monotonically."""
    cursors = [0] * len(others)
    for a in sorted(anchor, key=lambda b: b["y"]):
        ay = a["y"] + a["h"] / 2
        matched: list[dict | None] = []
        for ci, col in enumerate(others):
            best = None
            while cursors[ci] < len(col):
                b = col[cursors[ci]]
                by = b["y"] + b["h"] / 2
                if by < ay - tol:
                    cursors[ci] += 1
                    continue
                if by <= ay + tol:
                    best = b
                    cursors[ci] += 1
                break
            matched.append(best)
        yield a, matched


SHAMROCK_NOISE_RE = re.compile(
    r"DE.?[SBG]?[CG]R[Il]PT[Il]ON|ITEM\s*PRICE|AMOUNT|MAIL|DRIVER|CUBE|WEIGHT"
    r"|INVOICE|CUSTOMER|ORDER|SPECIAL|RECEIVED|SIGNATURE|INSTRUCTIONS|ROUTE"
    r"|SHIP|REMIT|VISTA|MAIN ST|SHAMROCK|SATISFACTION|TAXCODE|Last Line",
    re.I,
)


def parse_shamrock_lines(rows: list[list[dict]],
                         invoice_total: float | None = None) -> list[Line]:
    boxes = [b for row in rows for b in row]
    sku_boxes = []
    for b in boxes:
        t = b["t"].strip().replace(" ", "")
        m = SHAMROCK_SKU_RE.match(t) if len(t) in (7, 8, 9) else None
        if m and b["x"] < 0.35:
            sku_boxes.append((b, m))
    if not sku_boxes:
        return []

    # The line-item table spans the y-range of the SKU column; candidate
    # description/price boxes outside that band are header/footer noise.
    med_h = sorted(b["h"] for b in boxes)[len(boxes) // 2]
    band_lo = min(b["y"] for b, _ in sku_boxes) - med_h
    band_hi = max(b["y"] + b["h"] for b, _ in sku_boxes) + 2 * med_h
    price_boxes, desc_boxes = [], []
    for b in boxes:
        t = b["t"].strip()
        yc = b["y"] + b["h"] / 2
        if not (band_lo <= yc <= band_hi) or any(b is s for s, _ in sku_boxes):
            continue
        if parse_money(t) is not None and b["x"] > 0.45:
            v = parse_money(t)
            if invoice_total and v is not None and v >= invoice_total * 0.9:
                continue  # the invoice total itself leaking into the band
            price_boxes.append(b)
        elif (b["x"] < 0.75 and re.search(r"[A-Za-z]{3}", t) and len(t) > 6
              and not SHAMROCK_NOISE_RE.search(t)):
            desc_boxes.append(b)
    # Two money sub-columns: item price (left) vs extended amount (right).
    if price_boxes:
        xs = [b["x"] for b in price_boxes]
        if max(xs) - min(xs) < 0.08:  # no spread -> only one price column captured
            item_col = sorted(price_boxes, key=lambda b: b["y"])
            ext_col = []
        else:
            split = (min(xs) + max(xs)) / 2
            item_col = sorted((b for b in price_boxes if b["x"] < split), key=lambda b: b["y"])
            ext_col = sorted((b for b in price_boxes if b["x"] >= split), key=lambda b: b["y"])
    else:
        item_col, ext_col = [], []
    desc_col = sorted(desc_boxes, key=lambda b: b["y"])

    lines = []
    anchors = [b for b, _ in sku_boxes]
    metas = {id(b): m for b, m in sku_boxes}
    zip_tol = max(med_h * 1.2, 0.008)
    for a, (d, ip, ext) in _monotonic_zip(anchors, [desc_col, item_col, ext_col], tol=zip_tol):
        m = metas[id(a)]
        qty = float(m.group(1)) if m.group(1) else None
        sku = m.group(2)
        desc = d["t"].strip() if d else ""
        # Strip a fused unit prefix like "LBHONEY,CLOVER" / "PK|TORTILLA..."
        unit = None
        um = re.match(r"^(CS|PK|LB|GL|EA|DZ|BX|BG)[|\s]?(?=[A-Z])", desc)
        if um and len(desc) > 4:
            unit = um.group(1)
            desc = desc[um.end():].strip()
        unit_price = parse_money(ip["t"]) if ip else None
        line_total = parse_money(ext["t"]) if ext else None
        if invoice_total:
            if line_total and line_total > invoice_total:
                line_total = None
            if unit_price and unit_price > invoice_total:
                unit_price = None
        if qty is None and unit_price and line_total and unit_price > 0:
            derived = line_total / unit_price
            qty = round(derived) if abs(derived - round(derived)) < 0.15 else None
        if not desc and not unit_price:
            continue
        confidence = "high" if (desc and unit_price and line_total) else (
            "medium" if desc and (unit_price or line_total) else "low")
        lines.append(Line(sku=sku, description=desc, qty=qty, unit=unit, pack_size=None,
                          unit_price=unit_price, line_total=line_total,
                          category=None, confidence=confidence))
    return lines


# ---------------------------------------------------------------- header

def extract_header(vendor: str, full_text: str) -> tuple[str | None, str | None, float | None]:
    """Return (invoice_no, invoice_date_iso, invoice_total)."""
    inv = None
    if vendor == "Sysco":
        m = SYSCO_INVOICE_RE.search(full_text)
        inv = m.group(1) if m else None
    elif vendor == "Shamrock":
        m = SHAMROCK_INVOICE_RE.search(full_text)
        inv = m.group(1) if m else None
    dates = [d for d in (parse_date_iso(t) for t in full_text.split()) if d]
    date = sorted(dates)[-1] if dates else None  # delivery date >= order date
    moneys = [parse_money(t.rstrip(",")) for t in full_text.split()]
    moneys = [v for v in moneys if v is not None]
    total = max(moneys) if moneys else None  # totals exceed any line amount
    return inv, date, total


# ---------------------------------------------------------------- pipeline

def parse_photo(path: Path) -> PhotoParse | None:
    doc = json.loads(path.read_text())
    boxes = doc.get("boxes", [])
    if not boxes:
        return None
    rows = rows_from_boxes(boxes)
    full_text = " ".join(row_text(r) for r in rows)
    vendor, customer = classify(full_text)
    if vendor is None:
        return PhotoParse(file=path.stem, vendor=None, customer=customer,
                          invoice_no=None, invoice_date=None, invoice_total=None)
    inv, date, total = extract_header(vendor, full_text)
    lines = (parse_sysco_lines(rows) if vendor == "Sysco"
             else parse_shamrock_lines(rows, invoice_total=total))
    return PhotoParse(file=path.stem, vendor=vendor, customer=customer,
                      invoice_no=inv, invoice_date=date, invoice_total=total,
                      lines=lines)


@dataclass
class InvoiceGroup:
    vendor: str
    invoice_no: str | None
    files: list[str]
    invoice_date: str | None
    invoice_total: float | None
    customer: str | None
    lines: list[Line]


def group_invoices(parses: list[PhotoParse]) -> list[InvoiceGroup]:
    """Merge multi-photo invoices by (vendor, invoice_no); dedupe lines by SKU."""
    keyed: dict[tuple, list[PhotoParse]] = defaultdict(list)
    for p in parses:
        key = (p.vendor, p.invoice_no) if p.invoice_no else (p.vendor, f"file:{p.file}")
        keyed[key].append(p)
    groups = []
    for (vendor, _key), ps in keyed.items():
        ps.sort(key=lambda p: p.file)
        seen_skus: dict[str, Line] = {}
        loose: list[Line] = []
        conf_rank = {"high": 0, "medium": 1, "low": 2}
        for p in ps:
            for ln in p.lines:
                if ln.sku:
                    cur = seen_skus.get(ln.sku)
                    if cur is None or conf_rank[ln.confidence] < conf_rank[cur.confidence]:
                        seen_skus[ln.sku] = ln
                else:
                    loose.append(ln)
        groups.append(InvoiceGroup(
            vendor=vendor,
            invoice_no=ps[0].invoice_no,
            files=[p.file for p in ps],
            invoice_date=next((p.invoice_date for p in ps if p.invoice_date), None),
            invoice_total=max((p.invoice_total for p in ps if p.invoice_total), default=None),
            customer=next((p.customer for p in ps if p.customer), None),
            lines=list(seen_skus.values()) + loose,
        ))
    return groups


# ---------------------------------------------------------------- DB

SCHEMA = """
CREATE TABLE IF NOT EXISTS photo_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id TEXT NOT NULL DEFAULT 'default',
  vendor TEXT NOT NULL,
  invoice_no TEXT,
  invoice_date TEXT,
  invoice_total REAL,
  customer TEXT,
  source_files TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(vendor, invoice_no, location_id)
);
CREATE TABLE IF NOT EXISTS photo_invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_invoice_id INTEGER NOT NULL REFERENCES photo_invoices(id) ON DELETE CASCADE,
  sku TEXT,
  description TEXT,
  qty REAL,
  unit TEXT,
  pack_size TEXT,
  unit_price REAL,
  line_total REAL,
  category TEXT,
  parse_confidence TEXT
);
CREATE INDEX IF NOT EXISTS idx_photo_invoice_lines_inv
  ON photo_invoice_lines(photo_invoice_id);
"""


def write_db(db_path: Path, groups: list[InvoiceGroup]) -> tuple[int, int]:
    con = sqlite3.connect(db_path)
    con.execute("PRAGMA foreign_keys = ON")
    con.executescript(SCHEMA)
    n_inv = n_lines = 0
    with con:
        for g in groups:
            if g.invoice_no:
                old = con.execute(
                    "SELECT id FROM photo_invoices WHERE vendor=? AND invoice_no=? AND location_id=?",
                    (g.vendor, g.invoice_no, LOCATION_ID)).fetchone()
            else:
                old = con.execute(
                    "SELECT id FROM photo_invoices WHERE vendor=? AND invoice_no IS NULL"
                    " AND source_files=? AND location_id=?",
                    (g.vendor, ",".join(g.files), LOCATION_ID)).fetchone()
            if old:
                con.execute("DELETE FROM photo_invoice_lines WHERE photo_invoice_id=?", (old[0],))
                con.execute("DELETE FROM photo_invoices WHERE id=?", (old[0],))
            cur = con.execute(
                "INSERT INTO photo_invoices (location_id, vendor, invoice_no, invoice_date,"
                " invoice_total, customer, source_files) VALUES (?,?,?,?,?,?,?)",
                (LOCATION_ID, g.vendor, g.invoice_no, g.invoice_date, g.invoice_total,
                 g.customer, ",".join(g.files)))
            inv_id = cur.lastrowid
            for ln in g.lines:
                con.execute(
                    "INSERT INTO photo_invoice_lines (photo_invoice_id, sku, description, qty,"
                    " unit, pack_size, unit_price, line_total, category, parse_confidence)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (inv_id, ln.sku, ln.description, ln.qty, ln.unit, ln.pack_size,
                     ln.unit_price, ln.line_total, ln.category, ln.confidence))
                n_lines += 1
            n_inv += 1
    con.close()
    return n_inv, n_lines


# ---------------------------------------------------------------- main

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--boxes-dir", type=Path, default=DEFAULT_BOXES_DIR)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--live", action="store_true", help="write to DB (default: dry-run)")
    args = ap.parse_args(argv)

    files = sorted(args.boxes_dir.glob("*.json"))
    if not files:
        print(f"no box JSON found in {args.boxes_dir}", file=sys.stderr)
        return 2

    parses, skipped_vendor, skipped_customer = [], 0, 0
    for f in files:
        p = parse_photo(f)
        if p is None or p.vendor is None:
            skipped_vendor += 1
            continue
        if p.customer and p.customer != "Lariat":
            skipped_customer += 1
            continue
        parses.append(p)

    groups = group_invoices(parses)
    if not groups:
        print("⚠ ZERO ROWS — no invoices parsed; aborting before any write", file=sys.stderr)
        return 2

    by_vendor: dict[str, list[InvoiceGroup]] = defaultdict(list)
    for g in groups:
        by_vendor[g.vendor].append(g)

    mode = "LIVE" if args.live else "DRY-RUN"
    print(f"[{mode}] photos: {len(files)} | parsed: {len(parses)}"
          f" | skipped non-vendor: {skipped_vendor} | skipped other-customer: {skipped_customer}")
    print(f"{'vendor':<10}{'invoices':>9}{'w/ inv_no':>10}{'lines':>7}{'hi':>5}{'med':>5}{'lo':>5}{'recon%':>8}")
    for v, gs in sorted(by_vendor.items()):
        lines = [ln for g in gs for ln in g.lines]
        conf = {"high": 0, "medium": 0, "low": 0}
        for ln in lines:
            conf[ln.confidence] += 1
        recon = []
        for g in gs:
            s = sum(ln.line_total for ln in g.lines if ln.line_total)
            if g.invoice_total and s:
                recon.append(min(s / g.invoice_total, 1.0))
        recon_pct = f"{100 * sum(recon) / len(recon):.0f}%" if recon else "n/a"
        print(f"{v:<10}{len(gs):>9}{len([g for g in gs if g.invoice_no]):>10}"
              f"{len(lines):>7}{conf['high']:>5}{conf['medium']:>5}{conf['low']:>5}{recon_pct:>8}")

    if args.live:
        n_inv, n_lines = write_db(args.db, groups)
        print(f"\nwrote {n_inv} invoices / {n_lines} lines -> {args.db}")
    else:
        print("\ndry-run complete — no DB writes (use --live to ingest)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
