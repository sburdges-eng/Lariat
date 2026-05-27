#!/usr/bin/env python3
"""Ingest Toast Inc. subscription invoices (Toast as a vendor billing Lariat).

Source: PDFs from `data/originals/Toast/Invoices/` (or, as long as the pre-scrub
archive remains, `~/Dev/_archives/lariat-pre-scrub-2026-04-18/archive/originals_legacy_2026-04-18/Toast/Invoices/`).

Three format variants observed across 2021-2025:

  Format A (2021-2023, header "QTY Item Rate Amount"):
      <qty> <item words> $<rate> $<amount>
      e.g.  2 Handheld Monthly Software Subscription $20.00 $40.00
      Negative qty + parenthesized amount for credits:
            -8 Handheld Monthly Software Subscription $20.00 ($160.00)

  Format B (2024, header "Product Name Rate QTY Amount Tax Rate Tax Amount"):
      <item words> $<rate> <qty> $<amount> <tax%> $<tax_amount>

  Format C (2025+, header "Product Name Rate QTY Amount"):
      <item words> $<rate> <qty> $<amount>

Date formats: MM/DD/YYYY (2021-2023) and "Mon DD YYYY" (2024+).

Outputs (all deterministic, regenerated every run):
  data/cache/toast_invoices.json          — structured headers + lines
  data/imports/toast-invoices/headers.csv — one row per invoice
  data/imports/toast-invoices/lines.csv   — one row per line item

Run:
  .venv/bin/python scripts/ingest_toast_invoices.py
  .venv/bin/python scripts/ingest_toast_invoices.py --dir <path-to-pdf-dir>
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DEFAULT_DIR_CANDIDATES = [
    ROOT / "data" / "originals" / "Toast" / "Invoices",
    Path.home()
    / "Dev"
    / "_archives"
    / "lariat-pre-scrub-2026-04-18"
    / "archive"
    / "originals_legacy_2026-04-18"
    / "Toast"
    / "Invoices",
]

CACHE_OUT = ROOT / "data" / "cache" / "toast_invoices.json"
IMPORTS_DIR = ROOT / "data" / "imports" / "toast-invoices"

# Resolve venv-installed pdfplumber when invoked outside `.venv/bin/python`.
try:
    import pdfplumber  # type: ignore
except ImportError:
    venv_site = ROOT / ".venv" / "lib"
    for p in venv_site.glob("python3.*/site-packages"):
        sys.path.insert(0, str(p))
    import pdfplumber  # type: ignore

# ── Parsing ──────────────────────────────────────────────────────────────────

INV_NO_RE = re.compile(r"#(INV\d+)")
INV_DATE_RE = re.compile(r"Invoice Date:\s*(.+)")
INV_TOTAL_RE = re.compile(r"Invoice Total\s+\$?([\d,]+\.\d{2})")
TOTAL_DUE_RE = re.compile(r"Total Due:\s*\$?([\d,]+\.\d{2})")

HEADER_A = re.compile(r"^QTY\s+Item\s+Rate\s+Amount(?:\s+Tax Rate\s+Tax Amount)?\s*$", re.IGNORECASE)
HEADER_B_C = re.compile(r"^Product Name\s+Rate\s+QTY\s+Amount", re.IGNORECASE)

# Format A:  "<qty> <words> $<rate> $<amount>"  with optional trailing "<tax%> $<tax>".
# Amount can be in (parens) for credits.
LINE_A = re.compile(
    r"^(-?\d+)\s+(.+?)\s+\$([\d,]+\.\d{2})\s+\(?\$?([\d,]+\.\d{2})\)?(?:\s+\d+%\s+\(?\$?[\d,]+\.\d{2}\)?)?\s*$"
)

# Format B/C:  "<words> $<rate> <qty> $<amount>  [maybe more]"
LINE_BC = re.compile(
    r"^(.+?)\s+\$([\d,]+\.\d{2})\s+(-?\d+)\s+\(?\$?([\d,]+\.\d{2})\)?(?:\s+.*)?$"
)

SKIP_PREFIXES = (
    "Service Date:",
    "Subtotal",
    "Shipping Total",
    "Tax Total",
    "Invoice Total",
    "Less Deposits",
    "Less Credits",
    "Less Payments",
    "Note that",
    "subject to",
    "open a ticket",
    "Support@toasttab",
    "Bill To",
    "Ship To",
    "Customer",
    "Special Terms",
)


def parse_date(raw: str) -> str:
    """Return YYYY-MM-DD from either MM/DD/YYYY or 'Mon DD YYYY'."""
    raw = raw.strip().split("\n", 1)[0].strip()
    for fmt in ("%m/%d/%Y", "%b %d %Y", "%B %d %Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            pass
    raise ValueError(f"unrecognized date: {raw!r}")


def to_float(s: str, *, paren_negates: bool = False, original: str = "") -> float:
    v = float(s.replace(",", ""))
    if paren_negates and original.strip().startswith("("):
        v = -v
    return v


@dataclass
class Line:
    invoice_no: str
    invoice_date: str
    item: str
    qty: int
    rate: float
    amount: float


@dataclass
class Header:
    invoice_no: str
    invoice_date: str
    invoice_total: float
    line_count: int
    pdf_path: str


def parse_pdf(path: Path) -> tuple[Header, list[Line]]:
    with pdfplumber.open(path) as pdf:
        text = "\n".join((page.extract_text() or "") for page in pdf.pages)

    inv_no_m = INV_NO_RE.search(text)
    if not inv_no_m:
        raise ValueError(f"{path.name}: no invoice number found")
    inv_no = inv_no_m.group(1)

    inv_date_m = INV_DATE_RE.search(text)
    if not inv_date_m:
        raise ValueError(f"{path.name}: no invoice date found")
    inv_date = parse_date(inv_date_m.group(1))

    inv_total_m = INV_TOTAL_RE.search(text)
    inv_total = float(inv_total_m.group(1).replace(",", "")) if inv_total_m else 0.0

    # Detect line-format by header.
    fmt = None
    for raw in text.split("\n"):
        if HEADER_A.match(raw.strip()):
            fmt = "A"
            break
        if HEADER_B_C.match(raw.strip()):
            fmt = "BC"
            break
    if fmt is None:
        raise ValueError(f"{path.name}: no recognized line-item header")

    lines: list[Line] = []
    seen_header = False
    for raw in text.split("\n"):
        s = raw.strip()
        if not s:
            continue
        if not seen_header:
            if (fmt == "A" and HEADER_A.match(s)) or (fmt == "BC" and HEADER_B_C.match(s)):
                seen_header = True
            continue
        if any(s.startswith(p) for p in SKIP_PREFIXES):
            continue

        if fmt == "A":
            m = LINE_A.match(s)
            if not m:
                continue
            qty = int(m.group(1))
            item = m.group(2).strip()
            rate = to_float(m.group(3))
            amount = to_float(m.group(4), paren_negates=True, original=s.split("$")[-1])
            # Re-check parens on the amount portion specifically:
            if "(" in s.split(item)[-1]:
                amount = -abs(amount)
        else:  # fmt == "BC"
            m = LINE_BC.match(s)
            if not m:
                continue
            item = m.group(1).strip()
            rate = to_float(m.group(2))
            qty = int(m.group(3))
            amount = to_float(m.group(4))
            if "($" in s:
                amount = -abs(amount)

        lines.append(
            Line(
                invoice_no=inv_no,
                invoice_date=inv_date,
                item=item,
                qty=qty,
                rate=rate,
                amount=amount,
            )
        )

    header = Header(
        invoice_no=inv_no,
        invoice_date=inv_date,
        invoice_total=inv_total,
        line_count=len(lines),
        pdf_path=str(path),
    )
    return header, lines


# ── Drivers ──────────────────────────────────────────────────────────────────


def resolve_dir(arg: str | None) -> Path:
    if arg:
        p = Path(arg).expanduser()
        if not p.is_dir():
            raise SystemExit(f"--dir not found: {p}")
        return p
    for cand in DEFAULT_DIR_CANDIDATES:
        if cand.is_dir():
            return cand
    raise SystemExit(
        "No Toast invoice dir found. Tried:\n  " + "\n  ".join(str(c) for c in DEFAULT_DIR_CANDIDATES)
    )


def write_outputs(headers: list[Header], lines: list[Line]) -> None:
    CACHE_OUT.parent.mkdir(parents=True, exist_ok=True)
    IMPORTS_DIR.mkdir(parents=True, exist_ok=True)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "invoice_count": len(headers),
        "line_count": len(lines),
        "headers": [asdict(h) for h in headers],
        "lines": [asdict(l) for l in lines],
    }
    CACHE_OUT.write_text(json.dumps(payload, indent=2))

    with (IMPORTS_DIR / "headers.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["invoice_no", "invoice_date", "invoice_total", "line_count", "pdf_path"])
        for h in headers:
            w.writerow([h.invoice_no, h.invoice_date, f"{h.invoice_total:.2f}", h.line_count, h.pdf_path])

    with (IMPORTS_DIR / "lines.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["invoice_no", "invoice_date", "item", "qty", "rate", "amount"])
        for l in lines:
            w.writerow([l.invoice_no, l.invoice_date, l.item, l.qty, f"{l.rate:.2f}", f"{l.amount:.2f}"])


def print_summary(headers: list[Header], lines: list[Line]) -> None:
    if not headers:
        print("No invoices parsed.")
        return
    headers_sorted = sorted(headers, key=lambda h: h.invoice_date)
    total = sum(h.invoice_total for h in headers)
    span = (headers_sorted[0].invoice_date, headers_sorted[-1].invoice_date)

    # Per-line-total reconciliation (sanity check)
    by_inv: dict[str, float] = {}
    for l in lines:
        by_inv[l.invoice_no] = by_inv.get(l.invoice_no, 0.0) + l.amount
    mismatches = []
    for h in headers:
        diff = round(by_inv.get(h.invoice_no, 0.0) - h.invoice_total, 2)
        if abs(diff) > 0.01:
            mismatches.append((h.invoice_no, h.invoice_total, by_inv.get(h.invoice_no, 0.0), diff))

    # Spend by item
    by_item: dict[str, float] = {}
    qty_by_item: dict[str, int] = {}
    for l in lines:
        by_item[l.item] = by_item.get(l.item, 0.0) + l.amount
        qty_by_item[l.item] = qty_by_item.get(l.item, 0) + l.qty
    by_item_sorted = sorted(by_item.items(), key=lambda kv: -kv[1])

    # Spend by year
    by_year: dict[str, float] = {}
    for h in headers:
        y = h.invoice_date[:4]
        by_year[y] = by_year.get(y, 0.0) + h.invoice_total

    print(f"\nParsed {len(headers)} invoices, {len(lines)} line items.")
    print(f"Date span: {span[0]} → {span[1]}")
    print(f"Total Toast subscription spend: ${total:,.2f}\n")

    print("Spend by year:")
    for y, v in sorted(by_year.items()):
        print(f"  {y}  ${v:>10,.2f}")

    print("\nSpend by line item (top 10):")
    for item, v in by_item_sorted[:10]:
        print(f"  ${v:>10,.2f}  {qty_by_item[item]:>5} units  {item}")

    if mismatches:
        print("\n[!] Line-sum vs invoice-total mismatches (rounding or parser miss):")
        for inv, total, sum_, diff in mismatches:
            print(f"  {inv}  total=${total:.2f}  sum=${sum_:.2f}  diff=${diff:+.2f}")
    else:
        print("\nAll invoice totals reconcile to summed line items.")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dir", help="Override input PDF directory")
    args = ap.parse_args()

    src = resolve_dir(args.dir)
    pdfs = sorted(src.glob("INV*.pdf"))
    if not pdfs:
        raise SystemExit(f"No INV*.pdf files in {src}")
    print(f"Reading {len(pdfs)} invoices from {src}")

    headers: list[Header] = []
    lines: list[Line] = []
    errors = []
    for pdf in pdfs:
        try:
            h, ls = parse_pdf(pdf)
            headers.append(h)
            lines.extend(ls)
        except Exception as e:  # noqa: BLE001
            errors.append((pdf.name, str(e)))

    write_outputs(headers, lines)
    print_summary(headers, lines)

    print(f"\nWrote: {CACHE_OUT.relative_to(ROOT)}")
    print(f"Wrote: {(IMPORTS_DIR / 'headers.csv').relative_to(ROOT)}")
    print(f"Wrote: {(IMPORTS_DIR / 'lines.csv').relative_to(ROOT)}")

    if errors:
        print(f"\n[!] {len(errors)} parse failures:")
        for name, msg in errors:
            print(f"  {name}: {msg}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
