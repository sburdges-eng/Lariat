"""Unit tests for scripts.ingest_webstaurant_purchases.

Covers the pure transform helpers — the script's DB write path is
tightly coupled to sqlite and exercised elsewhere; the transform
helpers below are what turn the spend-report into ``OrderLine`` records.

  - parse_money: handles None, numeric, $/, and blank strings.
  - parse_date_iso: accepts datetime, m/d/Y, Y-m-d, m/d/y; rejects junk.
  - split_product: "ITEM - desc" split, falls back to (",", desc).
  - classify: maps WebstaurantStore category + name into UI bucket.
  - add_years_iso: adds N years, handles Feb 29 edge case.
  - collect_warranties: extracts Safeware EXTWARN lines into
    {order_number: (years, ref)}.
  - dedupe_lines: dedupes by (order_number, item_number), keeping first.
  - iter_order_lines: end-to-end parse through a stubbed openpyxl
    workbook.
"""
from __future__ import annotations

import sys
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import ingest_webstaurant_purchases as mod  # noqa: E402


class FakeSheet:
    def __init__(self, rows: list[tuple]) -> None:
        self._rows = rows

    def iter_rows(self, values_only: bool = False):
        assert values_only is True
        return iter(self._rows)


class FakeWorkbook:
    def __init__(self, sheets: dict[str, list[tuple]]) -> None:
        self._sheets = sheets
        self.sheetnames = list(sheets.keys())

    def __getitem__(self, name):
        return FakeSheet(self._sheets[name])


class ParseMoney(unittest.TestCase):
    def test_handles_none_numeric_and_strings(self) -> None:
        self.assertEqual(mod.parse_money(None), 0.0)
        self.assertEqual(mod.parse_money(12.5), 12.5)
        self.assertEqual(mod.parse_money(10), 10.0)
        self.assertEqual(mod.parse_money("$1,250.00"), 1250.0)
        self.assertEqual(mod.parse_money(""), 0.0)


class ParseDateIso(unittest.TestCase):
    def test_accepts_common_shapes(self) -> None:
        self.assertEqual(mod.parse_date_iso(datetime(2026, 4, 21)), "2026-04-21")
        self.assertEqual(mod.parse_date_iso(date(2026, 4, 21)), "2026-04-21")
        self.assertEqual(mod.parse_date_iso("04/21/2026"), "2026-04-21")
        self.assertEqual(mod.parse_date_iso("2026-04-21"), "2026-04-21")
        self.assertEqual(mod.parse_date_iso("4/21/26"), "2026-04-21")

    def test_rejects_junk(self) -> None:
        self.assertIsNone(mod.parse_date_iso(None))
        self.assertIsNone(mod.parse_date_iso("not-a-date"))


class SplitProduct(unittest.TestCase):
    def test_item_and_desc_split(self) -> None:
        self.assertEqual(
            mod.split_product("ABC123 - Some Fryer with - extra dashes"),
            ("ABC123", "Some Fryer with - extra dashes"),
        )

    def test_no_dash_returns_empty_item(self) -> None:
        self.assertEqual(mod.split_product("NoDashHere"), ("", "NoDashHere"))
        self.assertEqual(mod.split_product(""), ("", ""))


class Classify(unittest.TestCase):
    def test_refrigeration_category_passthrough(self) -> None:
        self.assertEqual(mod.classify("Refrigeration", "Reach-in freezer"), "Refrigeration")

    def test_restaurant_equipment_buckets(self) -> None:
        self.assertEqual(mod.classify("Restaurant Equipment", "40lb Gas Fryer"), "Fryers")
        self.assertEqual(mod.classify("Restaurant Equipment", "Convection Oven"), "Ovens")
        self.assertEqual(mod.classify("Restaurant Equipment", "Combi Oven"), "Ovens")
        self.assertEqual(mod.classify("Restaurant Equipment", "Planetary Mixer"), "Prep & Mixers")
        self.assertEqual(mod.classify("Restaurant Equipment", "Mystery Thing"), "Other")

    def test_smallwares_and_tools(self) -> None:
        self.assertEqual(mod.classify("Tabletop", "Plates"), "Smallwares")
        self.assertEqual(mod.classify("Tools & Hardware", "Wrench"), "Tools")
        self.assertEqual(mod.classify("Unknown", "Whatever"), "Other")


class AddYearsIso(unittest.TestCase):
    def test_adds_years(self) -> None:
        self.assertEqual(mod.add_years_iso("2026-04-21", 4), "2030-04-21")

    def test_feb_29_rolls_back_to_28(self) -> None:
        self.assertEqual(mod.add_years_iso("2024-02-29", 1), "2025-02-28")

    def test_invalid_input_returns_none(self) -> None:
        self.assertIsNone(mod.add_years_iso("not-a-date", 1))
        self.assertIsNone(mod.add_years_iso(None, 1))


class CollectWarranties(unittest.TestCase):
    def _line(self, order, item, desc):
        return mod.OrderLine(
            purchase_date="2026-04-21",
            order_number=order,
            item_number=item,
            description=desc,
            quantity=1,
            wstore_category="Restaurant Equipment",
            purchase_price=0.0,
            user="",
        )

    def test_extracts_years_and_ref(self) -> None:
        lines = [
            self._line(1001, "EXTWARN2YR", "2 Year Extended Warranty Powered by Safeware ABC:12345"),
            self._line(1001, "FRYER1", "40lb Fryer"),
            self._line(1002, "EXTWARN4YR", "4 Year Extended Warranty Powered by Safeware"),
        ]
        out = mod.collect_warranties(lines)
        self.assertEqual(out[1001], (2, "ABC:12345"))
        self.assertEqual(out[1002], (4, None))

    def test_longer_warranty_wins_when_multiple(self) -> None:
        lines = [
            self._line(42, "EXTWARN2YR", "2 Year Extended Warranty Powered by Safeware"),
            self._line(42, "EXTWARN4YR", "4 Year Extended Warranty Powered by Safeware"),
        ]
        out = mod.collect_warranties(lines)
        self.assertEqual(out[42][0], 4)

    def test_non_warranty_lines_ignored(self) -> None:
        lines = [
            self._line(1, "FRYER1", "Fryer"),
            self._line(1, "EXTWARN_MALFORMED", "No years here"),
        ]
        self.assertEqual(mod.collect_warranties(lines), {})


class DedupeLines(unittest.TestCase):
    def _line(self, order, item, desc="x"):
        return mod.OrderLine(
            purchase_date="2026-04-21",
            order_number=order,
            item_number=item,
            description=desc,
            quantity=1,
            wstore_category="Restaurant Equipment",
            purchase_price=0.0,
            user="",
        )

    def test_dedupes_on_order_and_item_keeping_first(self) -> None:
        a = self._line(1, "SKU1", "first")
        b = self._line(1, "SKU1", "dup")
        c = self._line(1, "SKU2", "other")
        out = mod.dedupe_lines([a, b, c])
        self.assertEqual(len(out), 2)
        self.assertIs(out[0], a)
        self.assertIs(out[1], c)

    def test_different_orders_preserved(self) -> None:
        a = self._line(1, "SKU1")
        b = self._line(2, "SKU1")
        self.assertEqual(len(mod.dedupe_lines([a, b])), 2)


class IterOrderLines(unittest.TestCase):
    HEADER = ("Date", "Order Number", "Product", "Quantity", "Category",
              "Purchase Price", "User", "Other")

    def _make_wb(self, rows):
        return FakeWorkbook({"Orders": [self.HEADER, *rows]})

    def test_parses_rows_through_openpyxl_stub(self) -> None:
        wb = self._make_wb([
            ("04/21/2026", 1001, "ABC123 - 40lb Fryer", 1, "Restaurant Equipment",
             "$1,250.00", "sean", None),
            ("04/22/2026", 1002, "EXTWARN2YR - 2 Year Extended Warranty Powered by Safeware",
             1, "Restaurant Equipment", "$99.00", "sean", None),
        ])
        with mock.patch.object(mod.openpyxl, "load_workbook", return_value=wb):
            lines = list(mod.iter_order_lines(Path("/fake.xlsx")))
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[0].item_number, "ABC123")
        self.assertEqual(lines[0].description, "40lb Fryer")
        self.assertEqual(lines[0].purchase_date, "2026-04-21")
        self.assertEqual(lines[0].order_number, 1001)
        self.assertEqual(lines[0].quantity, 1)
        self.assertEqual(lines[0].purchase_price, 1250.0)
        self.assertEqual(lines[1].item_number, "EXTWARN2YR")

    def test_rows_with_bad_date_are_skipped(self) -> None:
        wb = self._make_wb([
            ("not-a-date", 1001, "ABC - X", 1, "Restaurant Equipment", "$0", "u", None),
            ("04/22/2026", 1002, "DEF - Y", 1, "Restaurant Equipment", "$0", "u", None),
        ])
        with mock.patch.object(mod.openpyxl, "load_workbook", return_value=wb):
            lines = list(mod.iter_order_lines(Path("/fake.xlsx")))
        self.assertEqual([ln.order_number for ln in lines], [1002])

    def test_missing_orders_sheet_raises(self) -> None:
        wb = FakeWorkbook({"NotOrders": [self.HEADER]})
        with mock.patch.object(mod.openpyxl, "load_workbook", return_value=wb):
            with self.assertRaises(SystemExit):
                list(mod.iter_order_lines(Path("/fake.xlsx")))


if __name__ == "__main__":
    unittest.main()
