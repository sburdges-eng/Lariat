"""Sysco order-email ingest — the traps that make this data wrong.

Fixtures use real Sysco line items from the April/May 2026 recovery, because
the failure modes here (catch weight, split orders, shipping) only surface on
realistic rows.
"""

import csv
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.ingest_sysco_order_emails import (  # noqa: E402
    build_items,
    infer_category,
    main,
    merge_into_cache,
    read_rows,
    to_us_date,
)

COLUMNS = [
    'order_number', 'order_date', 'delivery_date', 'supc', 'description',
    'pack_size', 'brand', 'qty', 'unit_price', 'extended_price',
]

# Real lines from the recovered window.
ROWS = [
    # Two order numbers, one email, different delivery dates — the split case.
    ['04488129', '2026-04-01', '2026-04-02', '4002408', 'Mayonnaise Heavy Duty Pail',
     '1/28LB', 'SYSCO RELIANCE', '2', '54.10', '108.20'],
    ['04488128', '2026-04-01', '2026-04-09', '7258790', 'Spice Asian Yuzu Kosho Green',
     '2/17.6OZ', 'YAKAMI ORCHARDS', '1', '59.84', '59.84'],
    # Catch weight: priced per pound, so qty * unit_price != extended_price.
    ['04539197', '2026-04-26', '2026-04-27', '1412392',
     'Pork Chop Bone-in Frenched Long Bone', '1/30LB', 'BHB/NPM',
     '1', '4.876', '146.28'],
    ['04560934', '2026-05-06', '2026-05-07', '3777570',
     'Bacon Shingle Center-cut 7-9 Per Pound Honey', '1/15LB', 'DAILYS',
     '1', '72.99', '72.99'],
]


def write_csv(path, rows):
    with open(path, 'w', newline='', encoding='utf-8') as handle:
        writer = csv.writer(handle)
        writer.writerow(COLUMNS)
        writer.writerows(rows)
    return path


def test_reads_every_line_and_keeps_extended_price(tmp_path):
    items, warnings = build_items(read_rows(write_csv(tmp_path / 'o.csv', ROWS)))
    assert warnings == []
    assert len(items) == 4
    assert sum(i['extended_price'] for i in items) == pytest.approx(387.31, abs=0.01)


def test_catch_weight_line_is_not_recomputed_from_unit_price():
    """1 CS at $4.876/LB invoiced $146.28. Deriving qty * unit_price gives
    $4.88 and understates the line by ~$141 — extended price is the truth."""
    items, _ = build_items([dict(zip(COLUMNS, ROWS[2]))])
    assert items[0]['extended_price'] == pytest.approx(146.28)


def test_one_email_can_carry_several_order_numbers(tmp_path):
    items, _ = build_items(read_rows(write_csv(tmp_path / 'o.csv', ROWS)))
    assert {i['invoice'] for i in items} == {
        '04488129', '04488128', '04539197', '04560934',
    }
    # Same order date, different order number and delivery date.
    same_email = [i for i in items if i['invoice'] in ('04488128', '04488129')]
    assert {i['delivery_date'] for i in same_email} == {'4/2/2026', '4/9/2026'}


def test_rerun_is_idempotent_on_invoice_and_description(tmp_path):
    items, _ = build_items(read_rows(write_csv(tmp_path / 'o.csv', ROWS)))
    cache = {}
    first_appended, first_skipped = merge_into_cache(items, cache)
    second_appended, second_skipped = merge_into_cache(items, cache)

    assert (first_appended, first_skipped) == (4, 0)
    assert (second_appended, second_skipped) == (0, 4)
    assert len(cache['sysco']['recent_items']) == 4


def test_does_not_double_a_row_already_recovered_from_a_pdf(tmp_path):
    """The PDF ingest keys on (invoice, description) too. A line present from
    both sources must land once, or April spend doubles."""
    cache = {'sysco': {'recent_items': [{
        'invoice': '04560934',
        'delivery_date': '5/7/2026',
        'description': 'Bacon Shingle Center-cut 7-9 Per Pound Honey',
        'qty': 1,
        'category': 'Meats',
    }]}}
    items, _ = build_items(read_rows(write_csv(tmp_path / 'o.csv', ROWS)))
    appended, skipped = merge_into_cache(items, cache)
    assert (appended, skipped) == (3, 1)


def test_last_invoice_date_advances_but_never_regresses(tmp_path):
    items, _ = build_items(read_rows(write_csv(tmp_path / 'o.csv', ROWS)))
    cache = {'sysco': {'recent_items': [], 'last_invoice_date': '3/12/2026'}}
    merge_into_cache(items, cache)
    assert cache['sysco']['last_invoice_date'] == '5/7/2026'

    cache = {'sysco': {'recent_items': [], 'last_invoice_date': '12/31/2026'}}
    merge_into_cache(items, cache)
    assert cache['sysco']['last_invoice_date'] == '12/31/2026'


def test_rows_without_qty_or_price_are_skipped_not_zeroed(tmp_path):
    """The 'Did you forget?' suggestion block at the foot of the email has a
    description but no SUPC, qty or price. Zeroing it would put a phantom
    product in the purchase record."""
    bad = list(ROWS) + [
        ['04560934', '2026-05-06', '2026-05-07', '', 'Drink Energy Red Bull',
         '', 'RED BULL', '', '', ''],
    ]
    items, warnings = build_items(read_rows(write_csv(tmp_path / 'o.csv', bad)))
    assert len(items) == 4
    assert any('Red Bull' in w for w in warnings)


def test_missing_column_fails_loudly(tmp_path):
    path = tmp_path / 'bad.csv'
    with open(path, 'w', newline='', encoding='utf-8') as handle:
        writer = csv.writer(handle)
        writer.writerow(['order_number', 'description'])
        writer.writerow(['04560934', 'Bacon'])
    with pytest.raises(ValueError, match='missing required column'):
        read_rows(path)


def test_category_inference_leaves_unknowns_alone():
    assert infer_category('Bacon Shingle Center-cut 7-9 Per Pound Honey') == 'Meats'
    assert infer_category('Cheese Blue Crumbles') == 'Dairy'
    assert infer_category('Container Mfpp 1 Compartment Hinged') == 'Paper'
    assert infer_category('Widget Of Unknown Purpose') == 'Uncategorized'


def test_dates_render_in_the_shape_the_pdf_ingest_writes():
    assert to_us_date('2026-04-09') == '4/9/2026'
    assert to_us_date('2026-12-31') == '12/31/2026'
    assert to_us_date('') == ''


def test_dry_run_writes_nothing(tmp_path, capsys):
    csv_path = write_csv(tmp_path / 'o.csv', ROWS)
    cache_path = tmp_path / 'vendor_summary.json'
    cache_path.write_text('{"sysco": {"recent_items": []}}', encoding='utf-8')

    assert main([str(csv_path), '--cache', str(cache_path), '--dry-run']) == 0
    assert json.loads(cache_path.read_text())['sysco']['recent_items'] == []
    assert 'dry run' in capsys.readouterr().out


def test_write_is_atomic_and_preserves_other_vendors(tmp_path):
    csv_path = write_csv(tmp_path / 'o.csv', ROWS)
    cache_path = tmp_path / 'vendor_summary.json'
    cache_path.write_text(
        json.dumps({'webstaurantstore': {'recent_items': [{'invoice': 'W-1'}]}}),
        encoding='utf-8',
    )

    assert main([str(csv_path), '--cache', str(cache_path)]) == 0
    written = json.loads(cache_path.read_text())
    assert written['webstaurantstore']['recent_items'] == [{'invoice': 'W-1'}]
    assert len(written['sysco']['recent_items']) == 4
    assert not list(tmp_path.glob('*.tmp'))
