"""Unit tests for scripts.ingest_analytics.

Covers the pure helper `is_aggregate_footer_row`, which filters Toast
export aggregate-footer rows (TOTAL, TOTALS, GRAND TOTAL, SUBTOTAL,
TOTAL SALES, plus blank / dash-only strings) out of sales_lines.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.ingest_analytics import is_aggregate_footer_row  # noqa: E402


class IsAggregateFooterRowTrueCases(unittest.TestCase):
    def test_none_is_aggregate(self) -> None:
        self.assertTrue(is_aggregate_footer_row(None))

    def test_empty_string_is_aggregate(self) -> None:
        self.assertTrue(is_aggregate_footer_row(""))

    def test_whitespace_only_is_aggregate(self) -> None:
        self.assertTrue(is_aggregate_footer_row("  "))

    def test_single_dash_is_aggregate(self) -> None:
        self.assertTrue(is_aggregate_footer_row("-"))

    def test_double_dash_is_aggregate(self) -> None:
        self.assertTrue(is_aggregate_footer_row("--"))

    def test_em_dash_is_aggregate(self) -> None:
        self.assertTrue(is_aggregate_footer_row("—"))

    def test_total_uppercase_is_aggregate(self) -> None:
        self.assertTrue(is_aggregate_footer_row("TOTAL"))

    def test_total_lowercase_is_aggregate(self) -> None:
        self.assertTrue(is_aggregate_footer_row("total"))

    def test_totals_with_whitespace_and_casing_is_aggregate(self) -> None:
        self.assertTrue(is_aggregate_footer_row("  Totals  "))

    def test_grand_total_is_aggregate(self) -> None:
        self.assertTrue(is_aggregate_footer_row("GRAND TOTAL"))

    def test_subtotal_mixed_case_is_aggregate(self) -> None:
        self.assertTrue(is_aggregate_footer_row("Subtotal"))

    def test_total_sales_mixed_case_is_aggregate(self) -> None:
        self.assertTrue(is_aggregate_footer_row("Total Sales"))


class IsAggregateFooterRowFalseCases(unittest.TestCase):
    def test_burger_is_not_aggregate(self) -> None:
        self.assertFalse(is_aggregate_footer_row("Burger"))

    def test_coors_is_not_aggregate(self) -> None:
        self.assertFalse(is_aggregate_footer_row("Coors"))

    def test_espresso_martini_is_not_aggregate(self) -> None:
        self.assertFalse(is_aggregate_footer_row("Espresso Martini"))

    def test_baja_fish_tacos_is_not_aggregate(self) -> None:
        self.assertFalse(is_aggregate_footer_row("BAJA FISH TACOS"))

    def test_total_recall_is_not_aggregate(self) -> None:
        # Boundary: contains the substring "Total" but is not a stop-list
        # entry. Verify the check is exact-match (case-folded), not a
        # startswith / contains match.
        self.assertFalse(is_aggregate_footer_row("Total Recall"))


if __name__ == "__main__":
    unittest.main()
