"""Reconciliation guard for the Sysco order-email parser.

The parser's whole claim is that every order ties to the total printed in its
own email. That claim rests on one predicate, `residual_is_explainable`, and an
earlier version of it accepted *any* positive residual as shipping — which meant
a half-parsed order reported as reconciled and could win deduplication against a
correct parse of the same order, understating the food numerator with no warning.

These tests pin the boundary so it cannot quietly loosen again.
"""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.parse_sysco_emails import (  # noqa: E402
    SHIPPING_MAX,
    dedupe,
    residual_is_explainable,
)


# Real freight charges observed across the 125-order corpus, with the printed
# total they sat against. None of these may ever be rejected.
@pytest.mark.parametrize('residual,printed_total', [
    (40.99, 1312.23),   # the largest in the corpus, 3.1% of its order
    (33.37, 3683.53),
    (16.20, 757.04),
    (11.45, 260.77),    # small order: 4.4%, above the share cap but under the
                        # absolute one, which is why the share check has a floor
    (0.0, 2524.01),     # no shipping billed
])
def test_real_freight_is_accepted(residual, printed_total):
    assert residual_is_explainable(residual, printed_total)


def test_float_noise_is_tolerated():
    assert residual_is_explainable(-0.005, 100.0)


@pytest.mark.parametrize('residual,printed_total,why', [
    (500.0, 1000.0, 'half the order went missing'),
    (80.0, 160.0, 'small order, half missing — caught by the absolute cap'),
    (200.0, 5000.0, 'large order, one big line dropped'),
    (-5.0, 100.0, 'lines exceed the printed total: only ever a parse defect'),
])
def test_dropped_lines_are_rejected(residual, printed_total, why):
    assert not residual_is_explainable(residual, printed_total), why


def test_none_is_never_explainable():
    """An email with no printed total cannot be reconciled, so it cannot pass."""
    assert not residual_is_explainable(None, 100.0)
    assert not residual_is_explainable(10.0, None)


def test_absolute_cap_is_the_binding_limit_on_small_orders():
    """Below the share-check floor only the absolute cap applies."""
    assert residual_is_explainable(SHIPPING_MAX, 120.0)
    assert not residual_is_explainable(SHIPPING_MAX + 0.01, 120.0)


def _order(num, residual, printed_total, state='allocated', date='2026-07-01', line_sum=0.0):
    return {
        'order_number': num, 'state': state, 'message_date': date,
        'order_date': date, 'line_sum': line_sum, 'email_id': 'e1',
        'printed_total': printed_total, 'email_line_sum': printed_total - residual,
        'residual': residual, 'orders_in_email': 1, 'rows': [],
    }


def test_a_half_parsed_order_cannot_displace_a_good_one():
    """The failure this guard exists to prevent, end to end.

    Both entries are order 04690479. The confirmation parsed cleanly; the later
    allocated email lost half its lines. State rank alone would prefer the
    later, broken one — the guard has to reject it before ranking sees it.
    """
    good = _order('04690479', 0.0, 1000.0, state='confirmation',
                  date='2026-07-01', line_sum=1000.0)
    half_parsed = _order('04690479', 500.0, 1000.0, state='allocated',
                         date='2026-07-02', line_sum=500.0)

    kept, lost = dedupe([good, half_parsed])

    assert [o['line_sum'] for o in kept] == [1000.0]
    # Not reported lost: `lost` is for orders where *every* version broke. This
    # order survived, so the discarded half-parse is not a loss — it is dedupe
    # doing its job.
    assert lost == []


def test_an_order_lost_entirely_is_reported_not_dropped_silently():
    """Every version broken means the order is a real loss, and must surface."""
    kept, lost = dedupe([_order('04690479', 500.0, 1000.0)])
    assert kept == []
    assert [o['order_number'] for o in lost] == ['04690479']
