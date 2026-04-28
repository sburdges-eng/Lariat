"""Unit tests for scripts.ingest_catering_menu.

Covers the pure transform in ``parse_menu``:
  - Implicit "Passed Apps" category before first banner.
  - Banner rows (no cost) switch ``current`` category.
  - Header row ("Item") is consumed, rows above it are ignored.
  - Dollar / comma in cost cells is normalized.
  - Non-numeric cost cells are skipped (malformed row tolerated).
  - Short rows (len <= COL_COST) and None cells are skipped.
  - Idempotency: parsing the same workbook twice yields the same list.
  - Output shape matches ``CateringMenuItem[]`` from lib/data.ts.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import ingest_catering_menu  # noqa: E402


class FakeSheet:
    def __init__(self, rows: list[tuple]) -> None:
        self._rows = rows

    def iter_rows(self, values_only: bool = False):
        assert values_only is True
        return iter(self._rows)


class FakeWorkbook:
    def __init__(self, rows: list[tuple]) -> None:
        self.active = FakeSheet(rows)


def _row(item=None, cost=None, amount=None) -> tuple:
    # Worksheet columns (0-based): 0..4 leading pad, 5=Item, 6=Cost, 7=Amount.
    return (None, None, None, None, None, item, cost, amount)


def _patched_parse(rows: list[tuple]) -> list[dict]:
    wb = FakeWorkbook(rows)
    with mock.patch.object(ingest_catering_menu.openpyxl, "load_workbook", return_value=wb):
        return ingest_catering_menu.parse_menu(Path("/does/not/exist.xlsx"))


class ParseMenu(unittest.TestCase):
    def test_implicit_passed_apps_before_first_banner(self) -> None:
        rows = [
            _row("Item", "Cost", "Amount"),
            _row("Nashville Slider", 6.0, None),
            _row("Bacon Jam Crostini", 4.5, None),
            _row("Buffet", None, None),
            _row("Trio Dips", 15.0, None),
        ]
        items = _patched_parse(rows)
        self.assertEqual(
            items,
            [
                {"category": "Passed Apps", "name": "Nashville Slider", "cost": 6.0},
                {"category": "Passed Apps", "name": "Bacon Jam Crostini", "cost": 4.5},
                {"category": "Buffet", "name": "Trio Dips", "cost": 15.0},
            ],
        )

    def test_banner_row_switches_category(self) -> None:
        rows = [
            _row("Item", "Cost"),
            _row("Buffet", None),
            _row("Trio Dips", 15.0),
            _row("Desserts", None),
            _row("Brownie Bites", 3.0),
        ]
        items = _patched_parse(rows)
        self.assertEqual({it["category"] for it in items}, {"Buffet", "Desserts"})
        self.assertEqual(items[-1], {"category": "Desserts", "name": "Brownie Bites", "cost": 3.0})

    def test_rows_above_header_are_ignored(self) -> None:
        rows = [
            _row("Some Title", None),
            _row("Subtitle", None),
            _row("Item", "Cost"),
            _row("Buffet", None),
            _row("Trio Dips", 15.0),
        ]
        items = _patched_parse(rows)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["name"], "Trio Dips")

    def test_money_formatting_is_normalized(self) -> None:
        rows = [
            _row("Item", "Cost"),
            _row("Buffet", None),
            _row("Dollar String", "$12.50"),
            _row("Comma Thousands", "$1,250.00"),
            _row("Plain Float", 9.75),
        ]
        items = _patched_parse(rows)
        costs = [it["cost"] for it in items]
        self.assertEqual(costs, [12.5, 1250.0, 9.75])
        for it in items:
            self.assertIsInstance(it["cost"], float)

    def test_malformed_cost_is_skipped(self) -> None:
        rows = [
            _row("Item", "Cost"),
            _row("Buffet", None),
            _row("Bad Cost", "N/A"),
            _row("Good Cost", 5.0),
        ]
        items = _patched_parse(rows)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["name"], "Good Cost")

    def test_short_and_none_rows_skipped(self) -> None:
        # Short row (len <= COL_COST=6) is dropped; None cells skipped.
        rows = [
            _row("Item", "Cost"),
            (None, None, None),  # len=3, < COL_COST
            _row(None, 5.0),
            _row("", 5.0),
            _row("Buffet", None),
            _row("Trio Dips", 15.0),
        ]
        items = _patched_parse(rows)
        self.assertEqual(items, [{"category": "Buffet", "name": "Trio Dips", "cost": 15.0}])

    def test_idempotency(self) -> None:
        rows = [
            _row("Item", "Cost"),
            _row("Nashville Slider", 6.0),
            _row("Buffet", None),
            _row("Trio Dips", 15.0),
        ]
        first = _patched_parse(rows)
        second = _patched_parse(rows)
        self.assertEqual(first, second)

    def test_output_shape_matches_reader_contract(self) -> None:
        # lib/data.ts CateringMenuItem: {category: string, name: string, cost: number}
        rows = [
            _row("Item", "Cost"),
            _row("Buffet", None),
            _row("Trio Dips", 15.0),
        ]
        items = _patched_parse(rows)
        self.assertTrue(items)
        for it in items:
            self.assertEqual(set(it.keys()), {"category", "name", "cost"})
            self.assertIsInstance(it["category"], str)
            self.assertIsInstance(it["name"], str)
            self.assertIsInstance(it["cost"], float)


if __name__ == "__main__":
    unittest.main()
