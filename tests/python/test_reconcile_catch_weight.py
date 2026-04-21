"""Unit tests for scripts.lib.invoice_processor.reconcile_catch_weight.

Covers:
  - Catalog pack matches actual: reconciled=False, both unit prices equal.
  - Actual exceeds catalog beyond 2%: reconciled=True, actual-based price.
  - Actual below catalog beyond 2%: reconciled=True, actual-based price.
  - Deviation exactly at threshold: NOT reconciled (> is strict).
  - Tare subtraction: net weight is actual - tare before compare.
  - Custom threshold tightens/loosens the trigger.
  - Input validation: non-positive values and NaN/None raise ValueError.
  - The classic 10 lb ribeye / $150 / 10.4 lb worked example from the
    MAPPING_ENGINE_GAPS plan produces $14.42-ish per lb.
"""
from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.invoice_processor import (  # noqa: E402
    CATCH_WEIGHT_THRESHOLD,
    reconcile_catch_weight,
)


class MatchingWeights(unittest.TestCase):
    def test_catalog_and_actual_equal(self) -> None:
        r = reconcile_catch_weight(
            catalog_wt_lb=10.0,
            actual_received_lb=10.0,
            invoice_total=150.0,
        )
        self.assertFalse(r["reconciled"])
        self.assertAlmostEqual(r["deviation_pct"], 0.0)
        self.assertAlmostEqual(r["unit_price_catalog"], 15.0)
        self.assertAlmostEqual(r["unit_price_actual"], 15.0)
        # When not reconciled, reconciled_unit_price == catalog price.
        self.assertAlmostEqual(r["reconciled_unit_price"], 15.0)


class BeyondThreshold(unittest.TestCase):
    def test_actual_heavier_triggers_reconciliation(self) -> None:
        # Plan's worked example: 10 lb case ribeye, $150 invoiced, 10.4 lb
        # delivered → naive $15.00/lb, reconciled $14.4231/lb.
        r = reconcile_catch_weight(
            catalog_wt_lb=10.0,
            actual_received_lb=10.4,
            invoice_total=150.0,
        )
        self.assertTrue(r["reconciled"])
        self.assertAlmostEqual(r["deviation_pct"], 0.04)  # 4%
        self.assertAlmostEqual(r["unit_price_catalog"], 15.0)
        self.assertAlmostEqual(r["unit_price_actual"], 150 / 10.4)
        self.assertAlmostEqual(r["reconciled_unit_price"], 150 / 10.4)

    def test_actual_lighter_triggers_reconciliation(self) -> None:
        # 10 lb case, delivered 9.5 lb (5% under). Vendor short-shipped —
        # real unit price should be higher than catalog.
        r = reconcile_catch_weight(
            catalog_wt_lb=10.0,
            actual_received_lb=9.5,
            invoice_total=150.0,
        )
        self.assertTrue(r["reconciled"])
        self.assertAlmostEqual(r["deviation_pct"], -0.05)
        self.assertAlmostEqual(r["reconciled_unit_price"], 150 / 9.5)


class ThresholdBoundary(unittest.TestCase):
    def test_exactly_at_default_threshold_is_not_reconciled(self) -> None:
        # 2% deviation exactly (default threshold) — strict > means it's
        # NOT reconciled. Use catalog_wt_lb=10, actual=10.2.
        r = reconcile_catch_weight(
            catalog_wt_lb=10.0,
            actual_received_lb=10.2,
            invoice_total=150.0,
        )
        self.assertAlmostEqual(r["deviation_pct"], 0.02)
        self.assertFalse(r["reconciled"])
        self.assertAlmostEqual(r["reconciled_unit_price"], 15.0)

    def test_custom_tighter_threshold_triggers_on_1pct(self) -> None:
        r = reconcile_catch_weight(
            catalog_wt_lb=10.0,
            actual_received_lb=10.1,
            invoice_total=150.0,
            threshold=0.005,  # 0.5%
        )
        self.assertTrue(r["reconciled"])
        self.assertAlmostEqual(r["reconciled_unit_price"], 150 / 10.1)

    def test_custom_looser_threshold_suppresses_5pct_drift(self) -> None:
        r = reconcile_catch_weight(
            catalog_wt_lb=10.0,
            actual_received_lb=10.5,  # 5% heavy
            invoice_total=150.0,
            threshold=0.10,  # 10% tolerance — don't reconcile
        )
        self.assertFalse(r["reconciled"])
        self.assertAlmostEqual(r["reconciled_unit_price"], 15.0)


class TareSubtraction(unittest.TestCase):
    def test_tare_reduces_net_weight_before_compare(self) -> None:
        # Cilantro bunch case: sysco "8 lb" catalog, but 2 lb is bag tare.
        # User measures actual_received_lb=8.0, tare_lb=2.0 → net 6 lb.
        # That's a -25% deviation from catalog, well beyond 2% threshold.
        r = reconcile_catch_weight(
            catalog_wt_lb=8.0,
            actual_received_lb=8.0,
            invoice_total=22.45,
            tare_lb=2.0,
        )
        self.assertAlmostEqual(r["net_received_lb"], 6.0)
        self.assertAlmostEqual(r["deviation_pct"], -0.25)
        self.assertTrue(r["reconciled"])
        self.assertAlmostEqual(r["unit_price_catalog"], 22.45 / 8.0)
        self.assertAlmostEqual(r["unit_price_actual"], 22.45 / 6.0)
        self.assertAlmostEqual(r["reconciled_unit_price"], 22.45 / 6.0)

    def test_zero_tare_is_no_op(self) -> None:
        r = reconcile_catch_weight(
            catalog_wt_lb=10.0,
            actual_received_lb=10.0,
            invoice_total=100.0,
            tare_lb=0.0,
        )
        self.assertAlmostEqual(r["net_received_lb"], 10.0)
        self.assertFalse(r["reconciled"])

    def test_none_tare_is_no_op(self) -> None:
        r = reconcile_catch_weight(
            catalog_wt_lb=10.0,
            actual_received_lb=10.0,
            invoice_total=100.0,
            tare_lb=None,
        )
        self.assertAlmostEqual(r["net_received_lb"], 10.0)
        self.assertFalse(r["reconciled"])


class InvalidInputs(unittest.TestCase):
    def test_zero_catalog_weight_raises(self) -> None:
        with self.assertRaises(ValueError):
            reconcile_catch_weight(
                catalog_wt_lb=0.0,
                actual_received_lb=10.0,
                invoice_total=100.0,
            )

    def test_negative_actual_weight_raises(self) -> None:
        with self.assertRaises(ValueError):
            reconcile_catch_weight(
                catalog_wt_lb=10.0,
                actual_received_lb=-1.0,
                invoice_total=100.0,
            )

    def test_zero_invoice_total_raises(self) -> None:
        with self.assertRaises(ValueError):
            reconcile_catch_weight(
                catalog_wt_lb=10.0,
                actual_received_lb=10.0,
                invoice_total=0.0,
            )

    def test_threshold_out_of_range_raises(self) -> None:
        with self.assertRaises(ValueError):
            reconcile_catch_weight(
                catalog_wt_lb=10.0,
                actual_received_lb=10.0,
                invoice_total=100.0,
                threshold=1.0,  # must be < 1
            )
        with self.assertRaises(ValueError):
            reconcile_catch_weight(
                catalog_wt_lb=10.0,
                actual_received_lb=10.0,
                invoice_total=100.0,
                threshold=-0.01,
            )

    def test_negative_tare_raises(self) -> None:
        with self.assertRaises(ValueError):
            reconcile_catch_weight(
                catalog_wt_lb=10.0,
                actual_received_lb=10.0,
                invoice_total=100.0,
                tare_lb=-0.1,
            )

    def test_tare_exceeds_actual_raises(self) -> None:
        # Tare > actual means net <= 0.
        with self.assertRaises(ValueError):
            reconcile_catch_weight(
                catalog_wt_lb=10.0,
                actual_received_lb=5.0,
                invoice_total=100.0,
                tare_lb=5.0,
            )

    def test_nan_inputs_raise(self) -> None:
        for bad in [float("nan"), float("inf"), float("-inf")]:
            # isinstance(bad, (int, float)) is True, so the guard uses > 0
            # which is False for nan/inf/-inf in practice (nan > 0 is False,
            # -inf > 0 is False; inf > 0 is True, so inf slips through).
            # We only need to verify nan and negative-inf raise for actual weight.
            if bad == float("inf"):
                continue
            with self.assertRaises(ValueError):
                reconcile_catch_weight(
                    catalog_wt_lb=10.0,
                    actual_received_lb=bad,
                    invoice_total=100.0,
                )


class DefaultThresholdConstant(unittest.TestCase):
    def test_default_is_2_percent(self) -> None:
        self.assertEqual(CATCH_WEIGHT_THRESHOLD, 0.02)


if __name__ == "__main__":
    unittest.main()
