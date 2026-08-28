#!/usr/bin/env python3
"""Parse Sysco order emails (shop-noreply@sysco.com) into line-item CSV.

Why this exists
---------------
`ingest_sysco_order_emails.py` consumes a CSV of Sysco line items. This script
produces that CSV, reading the HTML bodies of the order emails themselves.

The emails are the only complete record of what was actually purchased. The
invoice-PDF archive has holes (April and May 2026 are absent entirely), and the
Sysco ordering site does not export history past a short window.

Reconciliation is the whole point
---------------------------------
Every order must tie to the total printed in its own email. An order that does
not reconcile is **dropped, not guessed** — a mis-parsed order silently poisons
the food-cost denominator, which is exactly the failure this work is correcting.

Seven traps, each of which has produced a wrong number before
------------------------------------------------------------
1. **One email can carry several sellers** under a single total — Sysco Standard
   Delivery, Supplies On The Fly, Everyday Supply Co. Items are attributed to
   the `.item-seller` heading that precedes them in document order, never to the
   email as a whole.
2. **Third-party marketplace lines are not food.** They carry
   `.thirdParty-label` / `.specialty-label` and are tagged so they can be
   excluded from a food-cost numerator.
3. **Ordered != allocated != billed.** `.item-qty-uom` reads
   `<allocated> / <ordered> (<unit price>)` on allocated orders. Out-of-stock
   lines allocate 0 and extend to $0.00. Extended price is authoritative.
4. **Totals exclude tax and include shipping** — a different basis from the
   invoice PDFs. Shipping is a header charge with no SUPC, so line items can sum
   *below* the printed total by exactly the shipping amount. That is recorded as
   a residual, not smeared across the lines.
5. **The same order appears 2-4 times** across Confirmation / Modified /
   Allocated / Shipped. Dedupe on order number, keeping the latest state that
   actually carries reconciling line detail.
6. **Catch-weight lines price per pound, not per case** (`1 CS ($4.876LB)`), so
   `qty * unit_price != extended_price` by design. Extended price is
   authoritative and unit price is never re-derived.
7. **Pack weight is deliberately not parsed** from the pack string, matching
   `ingest_sysco_invoice_pdfs.py`. Weight belongs to `vendor_pack_weights`,
   keyed on SUPC.

Usage
-----
    python scripts/parse_sysco_emails.py <thread_json>... -o out.csv
    python scripts/parse_sysco_emails.py --dir <dir_of_thread_json> -o out.csv

Input is the JSON saved by the Gmail `get_thread` tool at FULL_CONTENT:
`{id, messages: [{id, date, subject, htmlBody, ...}]}`. `htmlBody` may be a
plain string or the `[{text, type}]` wrapper some tool versions emit; both are
accepted.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

# Order state, lowest to highest confidence that the line detail is final.
# "Shipped" outranks "Allocated" only when it carries line detail at all; most
# shipped notices are tracking-number stubs with no items, and those are skipped
# before ranking ever applies.
STATE_RANK = {
    'confirmation': 1,
    'modified': 2,
    'allocated': 3,
    'shipped': 4,
    'unknown': 0,
}

# A cent of drift is float noise; a dollar is a parse defect.
RECONCILE_TOLERANCE = 0.01

# Bounds on the unexplained remainder between the printed total and the parsed
# lines. See `residual_is_explainable` for why an unbounded positive residual is
# the one hole that defeats every other check in this file. The absolute cap is
# set well above the largest freight charge in the corpus ($40.99 across 125
# orders) so no real order is rejected; the share cap tightens it further on
# orders big enough for a share to mean anything.
SHIPPING_MAX = 75.00
SHIPPING_MAX_SHARE = 0.15
SHARE_CHECK_MIN_TOTAL = 300.00

MONEY_RE = re.compile(r'-?[\d,]+\.\d{2}')
# "2986487 | 4/5 LB | IMPERIAL FRESH" -> supc, pack, brand. Brand may be absent.
BRAND_RE = re.compile(r'^\s*(\d{5,9})\s*\|\s*([^|]*?)\s*(?:\|\s*(.*?))?\s*$')
# "Jul 05 2026 03:18 PM | #04690479" -> the order number after the hash.
ORDER_NUM_RE = re.compile(r'#\s*([A-Za-z0-9]+)')
# "Order #04675097 (Sysco Standard Delivery)" -> order number, seller name.
# On multi-order emails this heading is the ONLY per-order delimiter: the header
# block lists every order number, so an email-level number is not attribution.
SELLER_RE = re.compile(r'Order\s*#\s*([A-Za-z0-9]+)\s*\((.*?)\)\s*$')
# "0 CS / 1 CS ($54.67)" or "1 CS ($28.13)" or catch weight "1 CS ($4.876LB)".
QTY_ALLOC_RE = re.compile(
    r'^\s*([\d.]+)\s*([A-Za-z]+)\s*/\s*([\d.]+)\s*([A-Za-z]+)\s*\(\$([\d,.]+)\s*([A-Za-z]*)\s*\)'
)
QTY_PLAIN_RE = re.compile(
    r'^\s*([\d.]+)\s*([A-Za-z]+)\s*\(\$([\d,.]+)\s*([A-Za-z]*)\s*\)'
)


def money(text: str) -> float | None:
    """First dollar figure in `text`, or None. Handles thousands separators."""
    if not text:
        return None
    m = MONEY_RE.search(text.replace('$', ''))
    return float(m.group(0).replace(',', '')) if m else None


def html_of(message: dict) -> str:
    """Return the HTML body, tolerating both wrapper shapes."""
    body = message.get('htmlBody') or message.get('html_body') or ''
    if isinstance(body, list):
        # [{text, type}] — concatenate the html parts, else everything.
        html = [p.get('text', '') for p in body if p.get('type') in ('html', 'text/html')]
        return ''.join(html) if html else ''.join(p.get('text', '') for p in body)
    return body or ''


def classify_state(subject: str) -> str:
    s = (subject or '').lower()
    for key in ('allocated', 'shipped', 'modified', 'confirmation'):
        if key in s:
            return key
    return 'unknown'


def parse_message(message: dict, thread_id: str) -> list[dict]:
    """Parse one email into a list of order dicts (usually one, sometimes several).

    Returns [] when the email carries no line detail (tracking stubs, carrier
    delivery notices), which is normal and not an error.
    """
    html = html_of(message)
    if not html or 'item-name' not in html:
        return []

    soup = BeautifulSoup(html, 'lxml')

    # --- header: order number(s), dates -------------------------------------
    headers = [e.get_text(' ', strip=True) for e in soup.select('.header-item-data')]
    order_nums, dates = [], []
    for h in headers:
        m = ORDER_NUM_RE.search(h)
        if m:
            order_nums.append(m.group(1))
        if re.fullmatch(r'\d{2}/\d{2}/\d{4}', h.strip()):
            dates.append(h.strip())

    # Subject carries the order number when the header does not.
    subject = message.get('subject', '') or ''
    if not order_nums:
        m = ORDER_NUM_RE.search(subject)
        if m:
            order_nums.append(m.group(1))

    order_date = dates[0] if dates else ''
    delivery_date = dates[1] if len(dates) > 1 else (dates[0] if dates else '')
    state = classify_state(subject)

    # --- walk document order, tracking the seller heading in force ----------
    # Sellers are headings interleaved with items; an item belongs to the most
    # recent heading above it, NOT to the email. Splitting on the email is trap 1.
    rows: list[dict] = []
    current_seller = ''
    current_order = ''
    for el in soup.select('.item-seller, .item-name'):
        classes = el.get('class') or []
        if 'item-seller' in classes:
            current_seller = el.get_text(' ', strip=True)
            # The heading carries this section's own order number on multi-order
            # emails. Falling back to the email-level number here silently
            # collapses several orders into one — the printed total still ties,
            # because it is the email grand total, so the error is invisible to
            # the reconciliation check. Attribute per section.
            sm = SELLER_RE.match(current_seller)
            if sm:
                current_order, current_seller = sm.group(1), sm.group(2)
            else:
                current_order = ''
            continue

        # Climb to the smallest ancestor that holds this item's price while
        # still wrapping exactly one item. The name sits in its own nested
        # cell, so stopping at the first <tr> finds a container with no price
        # and silently yields a $0.00 order.
        container = el
        for _ in range(8):
            if container.parent is None:
                break
            container = container.parent
            if (container.select_one('.item-price-wrapper') is not None
                    and len(container.select('.item-name')) == 1):
                break
        else:  # pragma: no cover - layout drift guard
            continue

        def pick(sel: str) -> str:
            node = container.select_one(sel)
            return node.get_text(' ', strip=True) if node else ''

        brand_raw = pick('.item-brand')
        supc = pack = brand = ''
        bm = BRAND_RE.match(brand_raw)
        if bm:
            supc, pack, brand = bm.group(1), bm.group(2), (bm.group(3) or '')

        qty_raw = pick('.item-qty-uom')
        qty_alloc = qty_ord = None
        uom = ''
        unit_price = None
        unit_basis = ''
        am = QTY_ALLOC_RE.match(qty_raw)
        pm = QTY_PLAIN_RE.match(qty_raw)
        if am:
            qty_alloc, uom_a, qty_ord, uom, unit_price, unit_basis = (
                float(am.group(1)), am.group(2), float(am.group(3)),
                am.group(4), float(am.group(5).replace(',', '')), am.group(6),
            )
        elif pm:
            qty_ord = float(pm.group(1))
            uom = pm.group(2)
            unit_price = float(pm.group(3).replace(',', ''))
            unit_basis = pm.group(4)
            qty_alloc = qty_ord

        extended = money(pick('.item-price-wrapper'))

        # No SUPC means this is not a purchased line. The "Did you forget?"
        # suggestion block at the foot of the email has a name but no SUPC,
        # qty or price; zeroing it would put phantom product in the record.
        if not supc:
            continue

        row_html = str(container)
        rows.append({
            'thread_id': thread_id,
            'message_id': message.get('id', ''),
            'message_date': message.get('date', ''),
            'subject': subject,
            'state': state,
            'seller': current_seller or 'Sysco Standard Delivery',
            'order_number': current_order or (order_nums[0] if order_nums else ''),
            'order_date': order_date,
            'delivery_date': delivery_date,
            'supc': supc,
            # `.split()` rather than strip=True alone: Sysco emits `&nbsp;`
            # inside some product names, and a U+00A0 in a description defeats
            # exact-match lookups downstream (an override in
            # classify_sysco_lines.py silently missed one for this reason).
            'description': ' '.join(el.get_text(' ', strip=True).split()),
            'pack_size': pack,
            'brand': brand,
            'qty': qty_alloc if qty_alloc is not None else '',
            'qty_ordered': qty_ord if qty_ord is not None else '',
            'uom': uom,
            'unit_price': unit_price if unit_price is not None else '',
            'unit_basis': unit_basis,
            'extended_price': extended if extended is not None else '',
            'is_third_party': int('thirdParty-label' in row_html or 'specialty-label' in row_html),
            'is_oos': int('oos-label' in row_html),
            'is_substitute': int('substitute-label' in row_html),
        })

    if not rows:
        return []

    # Reconciliation is EMAIL-level: the printed total is the grand total across
    # every order the email covers. Attribution is ORDER-level. Conflating the
    # two is what let a three-order email report as one order and still tie.
    totals = [money(e.get_text(' ', strip=True)) for e in soup.select('.total-price')]
    totals = [t for t in totals if t is not None]
    printed_total = totals[-1] if totals else None

    email_line_sum = round(sum(r['extended_price'] for r in rows if r['extended_price'] != ''), 2)
    residual = round(printed_total - email_line_sum, 2) if printed_total is not None else None

    by_order: dict[str, list[dict]] = {}
    for r in rows:
        by_order.setdefault(r['order_number'], []).append(r)

    return [{
        'order_number': num,
        'state': state,
        'message_date': message.get('date', ''),
        'order_date': orows[0]['order_date'],
        'line_sum': round(sum(r['extended_price'] for r in orows if r['extended_price'] != ''), 2),
        # Email-level facts, repeated on each order so the verdict travels with
        # the order it applies to.
        'email_id': message.get('id', ''),
        'printed_total': printed_total,
        'email_line_sum': email_line_sum,
        'residual': residual,
        'orders_in_email': len(by_order),
        'rows': orows,
    } for num, orows in by_order.items()]


def load_threads(paths: list[Path]) -> list[dict]:
    orders = []
    for p in paths:
        try:
            data = json.loads(p.read_text())
        except Exception as exc:  # noqa: BLE001 - report and continue
            print(f'  ! {p.name}: unreadable ({exc})', file=sys.stderr)
            continue
        thread_id = data.get('id', p.stem)
        for msg in data.get('messages', []):
            orders.extend(parse_message(msg, thread_id))
    return orders


def residual_is_explainable(residual: float | None, printed_total: float | None) -> bool:
    """Is the gap between the printed total and the parsed lines just freight?

    The residual is whatever the printed total has that the lines do not. Two
    very different things land here with the same sign:

    - **shipping** — a real header charge carrying no SUPC, so it can never
      appear as a line. Legitimate, and small: the largest across 125 orders is
      $40.99.
    - **a line the parser dropped** — markup drift hides a price or a SUPC, the
      item vanishes, and its amount silently becomes "residual" instead.

    Accepting any positive residual as shipping cannot tell these apart, and
    that is the one hole that defeats every other check here. A $1,000 order
    with $500 of captured lines would report as *reconciled*, win deduplication
    against a correctly-parsed version of the same order, and understate the
    food numerator by half — with no warning anywhere, because the check meant
    to catch exactly that is the check being fooled.

    So bound it. The absolute cap is what stops a large order quietly losing
    lines. The share cap tightens that on mid-size orders, and applies only
    above `SHARE_CHECK_MIN_TOTAL` because on a genuinely small order flat
    freight is legitimately a large fraction of the total ($11.45 of $260.77 is
    4.4%, and a $50 order would be higher still).

    This is deliberately weaker than the right answer, which is to parse the
    shipping figure the email prints and require the residual to equal it. That
    needs the raw email HTML to build a selector against, which the corpus this
    was reconstructed from no longer includes. Until then a dropped line smaller
    than the cap on a small order still passes; the report prints every nonzero
    residual so it is at least visible.
    """
    if residual is None or printed_total is None:
        return False
    # Lines exceeding the printed total can only ever be a parse defect.
    if residual < -RECONCILE_TOLERANCE:
        return False
    if residual > SHIPPING_MAX:
        return False
    if (printed_total >= SHARE_CHECK_MIN_TOTAL
            and residual > SHIPPING_MAX_SHARE * printed_total):
        return False
    return True


def dedupe(orders: list[dict]) -> tuple[list[dict], list[dict]]:
    """Keep one version per order number: the latest reconciling state (trap 5).

    Returns (kept, dropped_for_non_reconciliation).
    """
    reconciling, broken = [], []
    for o in orders:
        ok = residual_is_explainable(o['residual'], o['printed_total'])
        (reconciling if ok else broken).append(o)

    best: dict[str, dict] = {}
    for o in reconciling:
        key = o['order_number']
        if not key:
            key = f"NOORDER::{o['message_date']}"
        prior = best.get(key)
        rank = (STATE_RANK.get(o['state'], 0), o['message_date'])
        if prior is None or rank > (STATE_RANK.get(prior['state'], 0), prior['message_date']):
            best[key] = o

    # An order whose every version failed to reconcile is a real loss; report it.
    kept_nums = set(best)
    lost = [o for o in broken if o['order_number'] not in kept_nums]
    return list(best.values()), lost


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('files', nargs='*', type=Path)
    ap.add_argument('--dir', type=Path, help='directory of thread JSON files')
    ap.add_argument('-o', '--out', type=Path, required=True, help='line-item CSV out')
    ap.add_argument('--report', type=Path, help='per-order reconciliation CSV out')
    args = ap.parse_args()

    paths = list(args.files)
    if args.dir:
        paths += sorted(args.dir.glob('*.txt')) + sorted(args.dir.glob('*.json'))
    if not paths:
        ap.error('no input files')

    orders = load_threads(paths)
    kept, lost = dedupe(orders)
    kept.sort(key=lambda o: (o['order_date'] or '', o['order_number']))

    fields = [
        'thread_id', 'message_id', 'message_date', 'subject', 'state', 'seller',
        'order_number', 'order_date', 'delivery_date', 'supc', 'description',
        'pack_size', 'brand', 'qty', 'qty_ordered', 'uom', 'unit_price',
        'unit_basis', 'extended_price', 'is_third_party', 'is_oos', 'is_substitute',
    ]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open('w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for o in kept:
            w.writerows(o['rows'])

    if args.report:
        with args.report.open('w', newline='') as fh:
            w = csv.writer(fh)
            w.writerow(['order_number', 'order_date', 'state', 'n_lines', 'line_sum',
                        'orders_in_email', 'email_printed_total', 'email_line_sum',
                        'email_residual', 'message_date'])
            for o in kept:
                w.writerow([o['order_number'], o['order_date'], o['state'],
                            len(o['rows']), f"{o['line_sum']:.2f}", o['orders_in_email'],
                            f"{o['printed_total']:.2f}", f"{o['email_line_sum']:.2f}",
                            f"{o['residual']:.2f}", o['message_date']])

    n_lines = sum(len(o['rows']) for o in kept)
    order_total = round(sum(o['line_sum'] for o in kept), 2)
    # Shipping is charged once per email, not once per order it covers.
    shipping = round(sum(r for r in {o['email_id']: o['residual'] for o in kept}.values()), 2)
    multi = sum(1 for o in kept if o['orders_in_email'] > 1)
    print(f'orders kept       : {len(kept)}')
    print(f'  from multi-order emails: {multi}')
    print(f'line items        : {n_lines}')
    print(f'line-item sum     : ${order_total:,.2f}')
    print(f'shipping residual : ${shipping:,.2f}')
    print(f'total purchases   : ${order_total + shipping:,.2f}')
    if lost:
        print(f'\n!! {len(lost)} order(s) dropped — no version reconciled:', file=sys.stderr)
        for o in lost:
            print(f'   #{o["order_number"]} {o["state"]}: lines ${o["line_sum"]:.2f} '
                  f'vs printed {o["printed_total"]}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
