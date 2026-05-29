#!/usr/bin/env python3
"""Ingest Sysco invoice PDFs into vendor_summary.json.

Reads PDFs from `data/originals/sysco/invoices/` (under the pre-scrub archive)
and appends one row per line item to `vendor_summary.json.sysco.recent_items`.
Updates `sysco.last_invoice_date` to max(existing, all parsed delivery dates).

Source layout (pdfplumber text extraction, e.g. EnterpriseInvoice-759616979.pdf):
    Header (per page):
        ... DELV. DATE CUSTOMER INVOICE NUMBER PAGE
        3/12/26
        LARIAT TRUCK STOP 075356 759616979 2 1
    Body lines (after a category banner like 'DAIRY PRODUCTS' / 'MEATS' /
    'POULTRY' / 'SEAFOOD' / 'FROZEN' / 'CANNED & DRY' / 'PAPER & DISP' /
    'PRODUCE'):
        <flag> <qty>[S][CS|PL|...] <pack> <brand> <DESCRIPTION...> \
            [vendor_sku] <sysco_sku_7digit> <unit_price> <line_total>
    'MISC CHARGES CHGS FOR FUEL SURCHARGE ...'   -> Fuel Surcharge / Misc
    'STATE FEE EPR ...'                           -> State Fee EPR / Misc
    Skip: GROUP TOTAL, OUT/STOCK, REMOTE-STOCK, SUBSTITUTE, PART/ORD,
    'T/WT=' continuation rows, REFERENCE, DROP-SHIP standalone, banners.

Output schema (matches existing rows in vendor_summary.json):
    {invoice, delivery_date (M/D/YYYY), description, qty, category}

Idempotency: builds a set of (invoice, description) pairs already present,
appends only new tuples. Atomic write via temp file + rename. Top-level keys
other than 'sysco' (e.g. 'webstaurantstore') are preserved untouched.

In-PDF dedup: when two line items inside the same PDF share
(invoice, description, category), their qty is summed into a single row
(delivery_date taken from the first occurrence). This preserves spend math
when the printed invoice has two lines for the same SKU (e.g. taxable +
nontaxable variants of trash liners, or split shipments of a dairy item).
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
from pathlib import Path

ROOT_FOR_IMPORT = Path(__file__).resolve().parent.parent
if str(ROOT_FOR_IMPORT) not in sys.path:
    sys.path.insert(0, str(ROOT_FOR_IMPORT))

from scripts.lib.invoice_processor import (  # noqa: E402
    CATCH_WEIGHT_THRESHOLD,
    reconcile_catch_weight,
)

SYSCO_VENDOR = "sysco"

# pdfplumber lives in the project venv. When run via `.venv/bin/python` or
# with the venv activated this import resolves naturally; otherwise fall back
# to injecting the venv site-packages path.
try:
    import pdfplumber
except ModuleNotFoundError:
    _venv_sp = (
        ROOT_FOR_IMPORT
        / '.venv'
        / 'lib'
        / f'python{sys.version_info.major}.{sys.version_info.minor}'
        / 'site-packages'
    )
    if _venv_sp.exists():
        sys.path.insert(0, str(_venv_sp))
        import pdfplumber  # noqa: E402,F401
    else:
        raise

ROOT = ROOT_FOR_IMPORT
ARCHIVE_ROOT = Path(
    os.environ.get(
        'LARIAT_PRE_SCRUB_ARCHIVE',
        str(ROOT.parent / '_archives' / 'lariat-pre-scrub-2026-04-18'),
    )
)
SRC_DIR = ARCHIVE_ROOT / 'data' / 'originals' / 'sysco' / 'invoices'
CACHE = ROOT / 'data' / 'cache' / 'vendor_summary.json'

# Invoices to (re)parse. The set is filtered against existing cache by the
# (invoice, description) idempotency key, so listing all is safe.
TARGET_INVOICES = {
    '15981556P',
    '759616979',
    '759626592',
    '759632867',
    '759639500',
    '759642390',
    '759648336',
}

# Category banners that announce the section the next rows belong to.
# Mapping to the short labels already used in vendor_summary.json.
CATEGORY_BANNERS = {
    'DAIRY PRODUCTS': 'Dairy',
    'MEATS': 'Meats',
    'POULTRY': 'Poultry',
    'SEAFOOD': 'Seafood',
    'FROZEN': 'Frozen',
    'CANNED & DRY': 'Canned & Dry',
    'PAPER & DISP': 'Paper',
    'PRODUCE': 'Produce',
}

# Lines that should never be parsed as a line item.
SKIP_PREFIXES = (
    'GROUP TOTAL',
    'CASES',
    'PO BOX',
    'DENVER',
    'TAX',
    'INVOICE',
    'TOTAL',
    'IMPORTANT',
    'RESPECT',
    'REPRESENTATIVE',
    'CONT.',
    'MANIFEST',
    'CUSTOMER',
    'DELV.',
    'LARIAT',
    'THE ROPE',
    '206 EAST',
    'BUENA VISTA',
    'L O C',
    'EQUAL',
    'OPPORTUNITY',
    'ACTION',
    'CLAUSES',
    'INCORPORATED',
    'AFFRIMATIVE',
    'REFERENCE',
    'AND',
    'ARE',
    'BY',
    'OF',
    'CFR',
    'HEREIN',
    'SYSCO',
    'AUTHORIZED',
    'SIGNED',
    'TIME',
    'DRIVER',
    'PART/ORD',
    'SUBSTITUTE',
    'OUT/STOCK',
    'REMOTE-STOCK',
    'DROP-SHIP',
    'ORDER SUMMARY',
    'REFERENCE :',
    'SALES ERROR',
    'P.O.',
    'SHIPPER INVOICE',
    'MISC TAX',
    'ISCELLANEOUS',
    '* * CREDIT',
    'NOT FOR',
)

# Regex helpers
RE_DELV = re.compile(r'^(\d{1,2})/(\d{1,2})/(\d{2,4})$')
RE_INV_HEADER = re.compile(
    r'LARIAT TRUCK STOP 075356\s+([0-9A-Z]+)\s+\d+\s+\d+'
)
RE_LINE_ITEM = re.compile(
    r'^([CFD])\s+(\d+|OUT)(S?)\s*(?:CS|PL|EA|BG|BX|PK|CT|LB|GA|GAL|ONLY)?\b'
)
# Credit-memo rows omit the storage flag and start straight with qty+CS.
RE_CREDIT_LINE = re.compile(
    r'^(\d+)\s+(?:CS|PL|EA|BG|BX|PK|CT|LB|GAL)\b'
)
# Trailing prices (1-2 floats). Tokens ending in '*' or 'B' are tax flags.
RE_PRICE = re.compile(r'^\d+(?:\.\d+)?$')
RE_SYSCO_SKU = re.compile(r'^\d{7}$')

# Words/abbreviations to title-case nicely. Anything not in this map gets the
# default `.title()` treatment (which handles most English words fine).
SPECIAL_CASE = {
    'B/I': 'B/I',
    'B\\I': 'B/I',  # Sysco prints BACKSLASH; normalize.
    'C/C': 'C/C',
    'W/BAG': 'w/Bag',
    'W/WHT': 'w/White',
    'WHL': 'Whole',
    'GF': 'GF',
    'IQF': 'IQF',
    'CGFREE': 'CageFree',
    'CF': 'CF',
    'GRB': 'GrabNGo',
    'N': 'N',
    'G': 'Go',
    'OZ': 'oz',
    'LB': 'lb',
    'CT': 'ct',
    'IN': 'in',
    'GAL': 'gal',
    'QT': 'qt',
    'ML': 'ml',
    'YEL': 'Yellow',
    'WHT': 'White',
    'GRND': 'Ground',
    'GR': 'Grade',
    'A': 'A',
    'BCI03388': 'BCI03388',
    'XL': 'XL',
    'JBO': 'Jumbo',
    'BTRMLK': 'Buttermilk',
    'PCK': 'Pack',
    'BRD': 'Breaded',
    'TNDR': 'Tender',
    'CHCK': 'Chuck',
    'BRSKT': 'Brisket',
    'SHTRB': 'Shortrib',
    'F': 'F',
    'DZ': 'dz',
    'EA': 'ea',
    'CS': 'cs',
    'STYL': 'Style',
    'STD': 'Standard',
    'WGT': 'Weight',
    'ALMN': 'Aluminum',
    'PWDR': 'Powder',
    'DOM': 'Domestic',
    'BLND': 'Blend',
    'SCRMBL': 'Scrambled',
    'BKFST': 'Breakfast',
    'BRKFST': 'Breakfast',
    'SKON': 'SkinOn',
    'H/BRN': 'Hashbrown',
    'FNCY': 'Fancy',
    'SHRE': 'Shred',
    'SHRED': 'Shred',
    'SHRD': 'Shred',
    'FRSH': 'Fresh',
    'FRZ': 'Frozen',
    'CHGS': 'Charges',
    'FOR': 'for',
    'BRST': 'Breast',
    'TKO': 'Take-Out',
    'TK': 'TK',
    'KR': 'Kraft',
    'PLS': 'Plus',
    'STKS': 'Sticks',
    'STK': 'Stk',
    'MCS302': 'MCS302',
    'CN': 'cn',
    'PL': 'PL',
    'BG': 'bg',
    'PA': 'PA',
    'TWO': 'Two',
}


def parse_date(token: str) -> str | None:
    """Convert 'M/DD/YY' to 'M/D/YYYY' to match existing cache rows."""
    m = RE_DELV.match(token.strip())
    if not m:
        return None
    mo, da, yr = m.groups()
    if len(yr) == 2:
        yr = '20' + yr
    return f'{int(mo)}/{int(da)}/{yr}'


def title_word(w: str) -> str:
    if w in SPECIAL_CASE:
        return SPECIAL_CASE[w]
    if w.replace('.', '').isdigit():
        return w
    # Tokens like '5OZ', '4.5', '6IN' — leave numeric prefix alone.
    if re.match(r'^\d', w):
        return w.lower()
    return w.title()


def clean_description(words: list[str]) -> str:
    cleaned = [title_word(w) for w in words]
    desc = ' '.join(cleaned).strip()
    # Compact common artifacts.
    desc = desc.replace(' B/I ', ' B/I ').replace('B\\I', 'B/I')
    return desc


def looks_like_sku(tok: str) -> bool:
    """SKU tokens contain at least one digit and aren't a plain price.

    Sysco vendor SKUs are alphanumeric with optional dashes (e.g. '90101-COM',
    'SY122945', '46025-21242-00', 'BCI03388'). Sysco internal SKUs are
    7 plain digits. Pure short numerics like '4', '8' are units; ignore.
    """
    if not tok:
        return False
    if RE_PRICE.match(tok) and len(tok) <= 4 and '.' not in tok:
        return False  # short integer = probably a count, not SKU
    has_digit = any(c.isdigit() for c in tok)
    has_dash_or_letter = any(c.isalpha() or c == '-' for c in tok)
    if RE_SYSCO_SKU.match(tok):
        return True
    return has_digit and (has_dash_or_letter or len(tok) >= 6)


def parse_line_item(line: str) -> dict | None:
    """Return ``{qty, description, skus, unit_price, line_total}`` for a
    line-item row, or None if not parseable.

    Strategy: pull qty from the leading 'C/F/D <qty>[S]CS' shape. Then walk
    from the right, peel off trailing tokens that are prices (last 1-2),
    optional tax/promo flag ('B', '*', 'P'), then 1-2 SKU tokens. The remainder
    after dropping the leading 4 columns (flag, qty/CS, pack-numeric, pack-unit
    OR brand) is the brand + description; we drop the first remaining token
    (brand) and keep the rest as description.

    T5b: ``skus`` and the trailing price columns are exposed to callers so
    catch-weight reconciliation can join against ``vendor_catch_weights``
    by SKU and compute ``reconciled_unit_price`` from ``line_total /
    actual_received_lb``.
    """
    m = RE_LINE_ITEM.match(line)
    credit_offset = 0  # whether to skip a leading storage flag in toks
    if m:
        qty_token = m.group(2)
        if qty_token == 'OUT':
            # 'OUT' rows print the unit price but no line total — nothing was
            # delivered. Skip.
            return None
        qty = int(qty_token)
        credit_offset = 1
    else:
        m2 = RE_CREDIT_LINE.match(line)
        if not m2:
            return None
        qty = int(m2.group(1))
        credit_offset = 0  # no leading flag column

    toks = line.split()
    if len(toks) < 5:
        return None

    # Drop trailing flags like 'B', '*', or 'P' that mark tax/refund.
    while toks and toks[-1] in ('B', '*', 'P', 'T'):
        toks.pop()

    # Peel trailing prices (line_total, unit_price, optional per-piece tax
    # rate). All are floats with a '.'. Catch-weight unit prices are 3-dec.
    # Some rows print 3 prices (line_total, unit_price, per-piece tax rate)
    # plus a tax flag '*' or 'B' (handled above). Peel up to 4 floats.
    prices: list[str] = []
    while toks and re.match(r'^\d+(?:\.\d+)?-?$', toks[-1]) and '.' in toks[-1]:
        prices.append(toks.pop())
        if len(prices) == 4:
            break
    if not prices:
        return None  # no price -> not a real item row

    # Peel SKU tokens (up to 2): trailing tokens that look like SKUs.
    # T5b keeps the peeled SKUs so the enrichment phase can join against
    # vendor_catch_weights. Order is outer-first because `pop()` reversed it:
    # the line shape "... vendor_sku sysco_supc prices" means we popped
    # sysco_supc first, so reverse back to preserve left-to-right order.
    skus_peeled: list[str] = []
    while toks and len(skus_peeled) < 2 and looks_like_sku(toks[-1]):
        skus_peeled.append(toks.pop())
    skus_peeled.reverse()

    # What remains: leading flag, qty/CS bundle, pack tokens, brand, desc...
    # Heuristic: drop the leading <flag> and <qty/CS> tokens (already known).
    # Then drop pack tokens — those are tokens that start with a digit OR are
    # pack-only words like 'OZ', 'LB', 'GAL', 'GA', 'CT', 'CN', 'FO', 'DZ',
    # 'IN', 'EA', 'PL', 'CS', 'PK', 'GL', 'QT', 'ML', '#'. Pack ends and brand
    # begins at the first all-uppercase token that isn't a unit AND doesn't
    # start with a digit AND has length >= 3.
    PACK_UNITS = {
        'OZ', 'LB', 'GAL', 'GA', 'CT', 'CN', 'FO', 'DZ', 'IN', 'EA', 'PL',
        'CS', 'PK', 'GL', 'QT', 'ML', '#', 'AVG', 'KG',
    }

    # Drop flag + qty token.
    body = toks[2:]  # skip 'C' '1' (or similar) — but qty token may include 'S'

    # In some Sysco rows the unit fuses with qty: '1SCS' is one token, so the
    # leading split is 'C 1SCS 45LB ...' (3 tokens before brand). Detect by
    # looking at toks[2] — if it starts with a digit (pack), keep going.
    # Simpler: re-split from full original tokens.
    # Reconstruct cleaned token list for description extraction. Easiest:
    # use the same `toks` we already peeled (toks now ends at brand+desc).
    raw_trim = list(toks)

    # Walk from after the leading storage-flag column (index 1 for normal
    # rows, index 0 for credit-memo rows) and skip pack tokens.
    i = credit_offset
    # qty/cs token (may be '1', '1SCS', '10', '1S')
    if i < len(raw_trim):
        i += 1
    # Skip subsequent pack tokens: token starts with digit, OR is in
    # PACK_UNITS, OR is a single '#'-prefixed weight.
    while i < len(raw_trim):
        tok = raw_trim[i]
        if tok and (tok[0].isdigit() or tok in PACK_UNITS or tok.startswith('#')
                    or re.match(r'^\d+#', tok)):
            i += 1
            continue
        break
    # Now raw_trim[i] should be the brand. Skip it.
    if i < len(raw_trim):
        i += 1

    desc_words = raw_trim[i:]
    if not desc_words:
        return None

    description = clean_description(desc_words)
    if not description:
        return None
    # prices was popped right-to-left, so it contains [line_total, unit_price, ...].
    line_total: float | None = None
    unit_price: float | None = None
    try:
        if len(prices) >= 1:
            line_total = float(prices[0].rstrip('-'))
        if len(prices) >= 2:
            unit_price = float(prices[1].rstrip('-'))
    except ValueError:
        pass
    return {
        "qty": qty,
        "description": description,
        "skus": skus_peeled,
        "unit_price": unit_price,
        "line_total": line_total,
    }


def parse_pdf(path: Path) -> tuple[str, str, list[dict[str, object]]]:
    """Return (invoice, delivery_date, items) for one Sysco invoice PDF."""
    invoice: str | None = None
    delivery_date: str | None = None
    items: list[dict[str, object]] = []
    current_cat = ''
    # Sysco credit-memo invoices carry '* * CREDIT MEMO * *' in the header
    # and a 'P' suffix on the invoice number. Their line qtys are printed as
    # positives but the accounting sign is negative (cases returned, not
    # purchased). Left un-flipped, they inflate usage totals.
    is_credit = False

    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ''
            if 'CREDIT MEMO' in text:
                is_credit = True
            lines = [ln.rstrip() for ln in text.splitlines()]

            # Pull invoice + delivery date from the page header.
            for idx, ln in enumerate(lines):
                if invoice is None:
                    m = RE_INV_HEADER.search(ln)
                    if m:
                        invoice = m.group(1)
                if delivery_date is None:
                    d = parse_date(ln.strip())
                    if d:
                        # Sanity: header date appears just under
                        # 'DELV. DATE CUSTOMER INVOICE NUMBER PAGE'.
                        if idx > 0 and 'DELV. DATE' in lines[idx - 1]:
                            delivery_date = d

            # Walk body for items.
            for ln in lines:
                stripped = ln.strip()
                if not stripped:
                    continue
                if stripped in CATEGORY_BANNERS:
                    current_cat = CATEGORY_BANNERS[stripped]
                    continue
                # Misc charges: fuel surcharge, state fee.
                if stripped.startswith('MISC CHARGES'):
                    if 'FUEL SURCHARGE' in stripped:
                        items.append({
                            'invoice': invoice or '',
                            'delivery_date': delivery_date or '',
                            'description': 'Fuel Surcharge',
                            'qty': 1,
                            'category': 'Misc',
                        })
                    continue
                if stripped.startswith('STATE FEE EPR'):
                    items.append({
                        'invoice': invoice or '',
                        'delivery_date': delivery_date or '',
                        'description': 'State Fee EPR',
                        'qty': 1,
                        'category': 'Misc',
                    })
                    continue
                if any(stripped.startswith(p) for p in SKIP_PREFIXES):
                    continue
                # Continuation lines: 'T/WT=' rows carry the total delivered
                # weight for the immediately-preceding catch-weight line
                # (e.g. "8.650 8.750 T/WT= 17.400" → 17.4 lb across both
                # cases of that row). T5b captures this value onto the
                # previous item rather than discarding it.
                if 'T/WT=' in stripped:
                    m_twt = re.search(r'T/WT=\s*([0-9]+(?:\.[0-9]+)?)', stripped)
                    if m_twt and items:
                        items[-1]['actual_received_lb'] = float(m_twt.group(1))
                    continue
                if re.match(r'^\d+(?:\.\d+)?(\s+\d+(?:\.\d+)?)*$', stripped):
                    continue

                parsed = parse_line_item(stripped)
                if parsed is None:
                    continue
                items.append({
                    'invoice': invoice or '',
                    'delivery_date': delivery_date or '',
                    'description': parsed['description'],
                    'qty': parsed['qty'],
                    'skus': parsed['skus'],
                    'unit_price': parsed['unit_price'],
                    'line_total': parsed['line_total'],
                    'actual_received_lb': None,  # filled in by T/WT= continuation if present
                    'reconciled_unit_price': None,  # filled in by enrich_catch_weights()
                    'category': current_cat or 'Misc',
                })

    if invoice is None or delivery_date is None:
        raise RuntimeError(
            f'failed to extract invoice/date header from {path.name}: '
            f'invoice={invoice!r} delivery_date={delivery_date!r}'
        )
    if is_credit:
        for it in items:
            it['qty'] = -int(it['qty'])
    items = _collapse_in_pdf_duplicates(items)
    return invoice, delivery_date, items


def _collapse_in_pdf_duplicates(
    items: list[dict[str, object]],
) -> list[dict[str, object]]:
    """Sum qty for rows sharing (invoice, description, category) within one PDF.

    Some Sysco invoices print the same SKU on two lines (e.g. taxable +
    nontaxable variants of trash liners, or a split shipment). Without this
    collapse, the cross-run idempotency key (invoice, description) drops the
    second occurrence and understates qty. Schema is unchanged: a single row
    is emitted with summed qty and the first occurrence's delivery_date.
    """
    aggregated: dict[tuple[str, str, str], dict[str, object]] = {}
    order: list[tuple[str, str, str]] = []
    for it in items:
        key = (
            str(it.get('invoice', '')),
            str(it.get('description', '')),
            str(it.get('category', '')),
        )
        if key in aggregated:
            aggregated[key]['qty'] = int(aggregated[key]['qty']) + int(it['qty'])
            # Sum line_total across split shipments so downstream
            # catch-weight reconciliation sees the true aggregate dollars.
            a_lt = aggregated[key].get('line_total')
            b_lt = it.get('line_total')
            if isinstance(a_lt, (int, float)) and isinstance(b_lt, (int, float)):
                aggregated[key]['line_total'] = a_lt + b_lt
            # Sum actual_received_lb: each line had its own T/WT= total.
            a_w = aggregated[key].get('actual_received_lb')
            b_w = it.get('actual_received_lb')
            if isinstance(a_w, (int, float)) and isinstance(b_w, (int, float)):
                aggregated[key]['actual_received_lb'] = a_w + b_w
            elif isinstance(b_w, (int, float)):
                aggregated[key]['actual_received_lb'] = b_w
        else:
            aggregated[key] = dict(it)
            order.append(key)
    return [aggregated[k] for k in order]


def date_key(d: str) -> tuple[int, int, int]:
    mo, da, yr = d.split('/')
    return (int(yr), int(mo), int(da))


def _to_iso_date(d: str | None) -> str | None:
    """'M/D/YYYY' -> 'YYYY-MM-DD' for correct lexicographic ordering in SQLite."""
    if not d:
        return None
    parts = d.split('/')
    if len(parts) == 3:
        mo, da, yr = parts
        return f'{int(yr):04d}-{int(mo):02d}-{int(da):02d}'
    return d


def ensure_sysco_invoices_table(con: sqlite3.Connection) -> None:
    """DDL for sysco_invoices — the SQLite companion to vendor_summary.json.

    Same shape as shamrock_invoices (see scripts/ingest_shamrock_invoices.py)
    so the T5b.3 backfill can scan both tables uniformly. Idempotent via
    CREATE TABLE IF NOT EXISTS. No migration block needed since we're
    introducing this for the first time.
    """
    con.executescript("""
    CREATE TABLE IF NOT EXISTS sysco_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT NOT NULL,
      delivery_date TEXT,
      description TEXT NOT NULL,
      sku TEXT,
      qty INTEGER,
      category TEXT,
      unit_price REAL,
      line_total REAL,
      actual_received_lb REAL,
      reconciled_unit_price REAL,
      source_file TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now')),
      UNIQUE(invoice_no, description, location_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sysco_inv_date ON sysco_invoices(delivery_date);
    CREATE INDEX IF NOT EXISTS idx_sysco_inv_no ON sysco_invoices(invoice_no);
    CREATE INDEX IF NOT EXISTS idx_sysco_inv_sku ON sysco_invoices(sku);
    """)


def persist_sysco_items_to_sqlite(
    db_path: Path,
    items: list[dict],
    source_file: str,
) -> int:
    """Upsert parsed Sysco line items into sysco_invoices. Mirrors
    shamrock_invoices's full-refresh-per-invoice pattern: DELETE rows for
    this invoice_no + REINSERT. Idempotent across runs; safe on a pre-T5b
    DB (creates the table if missing).

    Returns the count of rows persisted. No-op when db_path doesn't exist.
    """
    if not db_path.exists():
        return 0
    with sqlite3.connect(str(db_path)) as con:
        ensure_sysco_invoices_table(con)
        invoices = {str(it.get('invoice', '')) for it in items if it.get('invoice')}
        try:
            con.execute("BEGIN")
            if invoices:
                # Clear prior rows for the specific invoice(s) we're about to
                # rewrite. Don't touch unrelated invoices.
                placeholders = ','.join('?' for _ in invoices)
                con.execute(
                    f"DELETE FROM sysco_invoices WHERE invoice_no IN ({placeholders}) "
                    f"AND location_id = 'default'",
                    list(invoices),
                )
            rows = []
            for it in items:
                skus = it.get('skus') or []
                sysco_supc = skus[-1] if skus else None  # SUPC is the last peeled SKU
                rows.append({
                    'invoice_no': str(it.get('invoice', '')),
                    'delivery_date': _to_iso_date(it.get('delivery_date')),
                    'description': str(it.get('description', '')),
                    'sku': sysco_supc,
                    'qty': int(it['qty']) if isinstance(it.get('qty'), (int, float)) else None,
                    'category': it.get('category'),
                    'unit_price': it.get('unit_price'),
                    'line_total': it.get('line_total'),
                    'actual_received_lb': it.get('actual_received_lb'),
                    'reconciled_unit_price': it.get('reconciled_unit_price'),
                    'source_file': source_file,
                    'location_id': 'default',
                })
            con.executemany(
                """INSERT INTO sysco_invoices
                   (invoice_no, delivery_date, description, sku, qty, category,
                    unit_price, line_total, actual_received_lb, reconciled_unit_price,
                    source_file, location_id)
                   VALUES (:invoice_no, :delivery_date, :description, :sku, :qty, :category,
                           :unit_price, :line_total, :actual_received_lb, :reconciled_unit_price,
                           :source_file, :location_id)""",
                rows,
            )
            con.commit()
        except Exception:
            con.rollback()
            raise
    return len(items)


def enrich_catch_weights(
    db_path: Path,
    items: list[dict],
    *,
    vendor: str = SYSCO_VENDOR,
    threshold: float = CATCH_WEIGHT_THRESHOLD,
) -> dict[str, int]:
    """Fill ``reconciled_unit_price`` on items whose ``actual_received_lb``
    deviates from ``vendor_catch_weights.catalog_wt_lb`` by more than
    ``threshold``. Leaves ``reconciled_unit_price`` NULL on items with no
    T/WT= capture, no matching catalog entry, or deviation within tolerance.

    The lookup walks each item's peeled SKUs (vendor_sku and sysco SUPC,
    in that order); first catalog match wins. We divide T/WT total by qty
    to get per-pack actual weight before reconciling — Sysco invoices
    report the summed weight across all cases on the T/WT= line, not
    per-pack.

    Mutates ``items`` in-place; returns counters for observability.
    If ``db_path`` doesn't exist, returns early with all-zero counters.
    """
    counters = {"matched": 0, "reconciled": 0, "no_catalog": 0, "no_actual": 0}
    if not db_path.exists():
        return counters
    with sqlite3.connect(str(db_path)) as con:
        catalog: dict[str, tuple[float, float | None]] = {}
        try:
            cur = con.execute(
                "SELECT sku, catalog_wt_lb, tare_lb FROM vendor_catch_weights WHERE vendor = ?",
                (vendor,),
            )
        except sqlite3.OperationalError:
            # vendor_catch_weights table not present in DB (pre-T5a) —
            # enrichment is a no-op rather than a hard failure so the
            # pre-T5a Sysco cache can still be refreshed.
            return counters
        for sku, catalog_wt_lb, tare_lb in cur:
            catalog[str(sku)] = (float(catalog_wt_lb), float(tare_lb) if tare_lb else None)

    for it in items:
        actual_total = it.get("actual_received_lb")
        if actual_total is None:
            counters["no_actual"] += 1
            continue
        qty = it.get("qty")
        if not isinstance(qty, (int, float)) or qty == 0:
            continue
        # Per-pack actual weight (T/WT= reports the summed weight for all
        # cases on the row; reconcile_catch_weight expects per-pack values).
        per_pack_actual = abs(float(actual_total) / float(qty))
        line_total = it.get("line_total")
        if not isinstance(line_total, (int, float)) or line_total <= 0:
            continue
        # Find first catalog match by walking peeled SKUs.
        skus = it.get("skus") or []
        hit: tuple[float, float | None] | None = None
        for sku in skus:
            hit = catalog.get(str(sku))
            if hit:
                break
        if hit is None:
            counters["no_catalog"] += 1
            continue
        counters["matched"] += 1
        catalog_wt_lb, tare_lb = hit
        # Per-pack line dollars for reconciliation input.
        per_pack_total = abs(float(line_total) / float(qty))
        try:
            result = reconcile_catch_weight(
                catalog_wt_lb=catalog_wt_lb,
                actual_received_lb=per_pack_actual,
                invoice_total=per_pack_total,
                threshold=threshold,
                tare_lb=tare_lb,
            )
        except ValueError:
            continue
        if result["reconciled"]:
            it["reconciled_unit_price"] = result["reconciled_unit_price"]
            counters["reconciled"] += 1
    return counters


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        '--backfill', action='store_true',
        help='Re-derive qty from source PDFs for BACKFILL_INVOICES and patch '
             'existing cache rows. Off by default so normal runs do not '
             'silently overwrite any manual corrections. Idempotent and safe '
             'to re-run; use after adding an invoice to the list.',
    )
    ap.add_argument('--dir', type=Path, default=SRC_DIR,
                    help='Directory holding EnterpriseInvoice-*.pdf files.')
    ap.add_argument('--cache', type=Path, default=CACHE,
                    help='Path to vendor_summary.json cache.')
    ap.add_argument('--db', type=Path, default=ROOT / 'data' / 'lariat.db',
                    help='Path to lariat.db SQLite database.')
    args = ap.parse_args()

    src_dir: Path = args.dir
    cache_path: Path = args.cache
    db_path: Path = args.db

    if not src_dir.exists():
        print(f'ERROR: missing source dir {src_dir}', file=sys.stderr)
        return 2

    if not cache_path.exists():
        print(f'ERROR: {cache_path} missing', file=sys.stderr)
        return 2

    cache = json.loads(cache_path.read_text())
    # Snapshot the top-level keys present at load time so the post-write
    # assertion can verify we didn't accidentally drop any of them
    # (rather than hardcoding a list of expected sibling keys).
    initial_top_level_keys = set(cache.keys())
    sysco = cache.setdefault('sysco', {})
    recent = sysco.setdefault('recent_items', [])

    before_count = len(recent)

    # One-time corrections that diverge from the (invoice, description)
    # idempotency key. Only re-applied when --backfill is passed, so the
    # normal ingest path cannot silently clobber hand-edited rows.
    BACKFILL_INVOICES = (
        '759616979',  # T2a: in-PDF duplicates collapsed by old dedup key
        '759632867',  # T2a: same
        '15981556P',  # credit-memo qty sign flip
    )
    backfill_audit: list[tuple[str, str, int, int]] = []
    if args.backfill:
        pdf_qty_index: dict[tuple[str, str], int] = {}
        for inv in BACKFILL_INVOICES:
            pdf_path = src_dir / f'EnterpriseInvoice-{inv}.pdf'
            if not pdf_path.exists():
                continue
            _, _, parsed_items = parse_pdf(pdf_path)
            for it in parsed_items:
                pdf_qty_index[(str(it['invoice']), str(it['description']))] = int(it['qty'])
        for it in recent:
            if it.get('invoice') not in BACKFILL_INVOICES:
                continue
            key = (str(it['invoice']), str(it['description']))
            if key not in pdf_qty_index:
                continue
            new_qty = pdf_qty_index[key]
            old_qty = int(it['qty'])
            if new_qty != old_qty:
                backfill_audit.append((key[0], key[1], old_qty, new_qty))
                it['qty'] = new_qty

    seen: set[tuple[str, str]] = {(it['invoice'], it['description']) for it in recent}

    # Find PDFs we should process.
    pdfs: list[Path] = []
    for fn in sorted(os.listdir(src_dir)):
        if not fn.lower().endswith('.pdf'):
            continue
        # 'EnterpriseInvoice-<inv>.pdf' -> inv.
        m = re.match(r'EnterpriseInvoice-([0-9A-Z]+)\.pdf$', fn)
        if not m:
            continue
        if m.group(1) in TARGET_INVOICES:
            pdfs.append(src_dir / fn)

    added_total = 0
    sqlite_total = 0
    new_dates: list[str] = []
    lariat_db = db_path
    cw_counters_total = {"matched": 0, "reconciled": 0, "no_catalog": 0, "no_actual": 0}
    for pdf in pdfs:
        invoice, delivery_date, items = parse_pdf(pdf)
        # T5b: enrich with catch-weight reconciliation against
        # vendor_catch_weights before writing to the vendor_summary cache.
        # No-op if the DB doesn't exist or the table is pre-T5a.
        cw_counters = enrich_catch_weights(lariat_db, items)
        for k, v in cw_counters.items():
            cw_counters_total[k] += v
        # T5b follow-up: dual-write per-line items to sysco_invoices so the
        # T5b.3 vendor_prices backfill can scan both vendors uniformly. The
        # JSON cache write below still runs — existing consumers of
        # vendor_summary.json are unaffected during this transition.
        sqlite_total += persist_sysco_items_to_sqlite(lariat_db, items, pdf.name)
        new_for_pdf = 0
        for it in items:
            key = (it['invoice'], it['description'])
            if key in seen:
                continue
            seen.add(key)
            recent.append(it)
            new_for_pdf += 1
        added_total += new_for_pdf
        new_dates.append(delivery_date)
        print(
            f'  {pdf.name}: invoice={invoice} date={delivery_date} '
            f'parsed={len(items)} new={new_for_pdf}'
        )
    if sqlite_total:
        print(f'sysco_invoices SQLite rows upserted: {sqlite_total}')
    if cw_counters_total["matched"] or cw_counters_total["reconciled"]:
        print(
            f'catch-weight enrichment: matched={cw_counters_total["matched"]} '
            f'reconciled={cw_counters_total["reconciled"]} '
            f'no_catalog={cw_counters_total["no_catalog"]} '
            f'no_actual={cw_counters_total["no_actual"]}'
        )

    # Update last_invoice_date.
    existing_last = sysco.get('last_invoice_date')
    candidates = list(new_dates)
    if existing_last:
        candidates.append(existing_last)
    if candidates:
        new_last = max(candidates, key=date_key)
        sysco['last_invoice_date'] = new_last
    else:
        new_last = existing_last

    after_count = len(recent)
    print()
    print(f'before recent_items: {before_count}')
    print(f'after  recent_items: {after_count}')
    print(f'added              : {added_total}')
    print(f'new last_invoice_date: {new_last}')
    if backfill_audit:
        print()
        print('in-PDF dedup backfill (qty before -> after):')
        for inv, desc, old_q, new_q in backfill_audit:
            print(f'  {inv}  {desc!r}: {old_q} -> {new_q}')

    # Atomic write.
    tmp = cache_path.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(cache, indent=2, ensure_ascii=False) + '\n')
    os.replace(tmp, cache_path)

    # Validate: re-read. The intent is "atomic write didn't drop any sibling
    # top-level key" — assert against the set we observed at load time
    # rather than hardcoding 'webstaurantstore' (which isn't present on a
    # fresh / minimal seed cache).
    reloaded = json.loads(cache_path.read_text())
    expected_keys = initial_top_level_keys | {'sysco'}
    missing = expected_keys - set(reloaded.keys())
    assert not missing, f'top-level keys lost during write: {sorted(missing)}'
    assert len(reloaded['sysco']['recent_items']) == after_count, \
        'recent_items length mismatch after write'
    print(f'validate: OK (top-level keys preserved: {sorted(reloaded.keys())}, count matches)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
