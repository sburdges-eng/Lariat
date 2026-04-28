"""Unit tests for scripts.ingest_drive_kitchen_ops.

Covers the pure extractors by stubbing the IO boundary:
  - extract_closings: section-header regex, key_map normalization,
    house close-out cleanup (banner + numbering + joke filter).
  - extract_weekly_prep: day-grouped (Weekly Prep.docx) + category-grouped
    (Prep list.docx) lists, header row and "Tab N" lines discarded.
  - extract_order_guide: SUPC / Desc / Size / Brand / Unit / Cat /
    Location / Par header mapping, float SUPC coerced to int-string,
    blank rows skipped, output wrapper-less items list.
  - Output shape matches lib/data.ts readers (closings is str->list[str],
    weekly_prep is {by_day, by_category}, order_guide items match
    OrderGuideItem keys).
  - Idempotency: re-running extractors yields the same structures.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import ingest_drive_kitchen_ops as mod  # noqa: E402


class FakeSheet:
    def __init__(self, rows: list[tuple]) -> None:
        self._rows = rows

    def iter_rows(self, values_only: bool = False):
        assert values_only is True
        return iter(self._rows)


class FakeWorkbook:
    def __init__(self, rows: list[tuple]) -> None:
        self.active = FakeSheet(rows)


class ExtractClosings(unittest.TestCase):
    def _run(self, positions_lines, procedures_lines):
        def fake_paragraphs(path: Path) -> list[str]:
            name = path.name
            if name == "Closing checklist_ Positions_.docx":
                return positions_lines
            if name == "Closing procedures.docx":
                return procedures_lines
            raise AssertionError(f"unexpected docx read: {name}")

        with mock.patch.object(mod, "docx_paragraphs", side_effect=fake_paragraphs):
            return mod.extract_closings()

    def test_section_headers_split_into_station_keys(self) -> None:
        out = self._run(
            [
                "Closing checklist: Garde",
                "Wipe station",
                "Wrap pans",
                "Closing list: Fry",
                "Filter oil",
                "Closing checklist: Grill/Saute",
                "Scrape grill",
                "Closing list: Expo",
                "Stock to-go",
            ],
            ["Closing procedures", "Take out trash"],
        )
        self.assertEqual(out["garde"], ["Wipe station", "Wrap pans"])
        self.assertEqual(out["fry"], ["Filter oil"])
        self.assertEqual(out["grill_saute"], ["Scrape grill"])
        self.assertEqual(out["expo"], ["Stock to-go"])
        self.assertEqual(out["house"], ["Take out trash"])

    def test_house_strips_banner_numbering_and_joke(self) -> None:
        out = self._run(
            ["Closing checklist: Garde", "Wipe station"],
            [
                "Closing procedures",
                "1. Turn off hoods",
                "2) Lock walk-in",
                "Go home and get bitches",
                "Sweep the line",
            ],
        )
        self.assertEqual(
            out["house"],
            ["Turn off hoods", "Lock walk-in", "Sweep the line"],
        )

    def test_output_shape_matches_reader_contract(self) -> None:
        # lib/data.ts: Record<string, string[]>
        out = self._run(
            ["Closing checklist: Garde", "Wipe"],
            ["Closing procedures", "Shut off gas"],
        )
        for k, v in out.items():
            self.assertIsInstance(k, str)
            self.assertIsInstance(v, list)
            for item in v:
                self.assertIsInstance(item, str)


class ExtractWeeklyPrep(unittest.TestCase):
    def _run(self, weekly_lines, prep_lines):
        def fake_paragraphs(path: Path) -> list[str]:
            name = path.name
            if name == "Weekly Prep.docx":
                return weekly_lines
            if name == "Prep list.docx":
                return prep_lines
            raise AssertionError(f"unexpected docx read: {name}")

        with mock.patch.object(mod, "docx_paragraphs", side_effect=fake_paragraphs):
            return mod.extract_weekly_prep()

    def test_day_grouped_and_category_grouped(self) -> None:
        out = self._run(
            [
                "Tab 1",
                "Weekly prep monday",
                "Portion chicken",
                "Blanch green beans",
                "Weekly prep tuesday",
                "Braise short rib",
            ],
            [
                "Prep list",
                "Sauces",
                "BBQ sauce",
                "Ranch",
                "Proteins",
                "Chicken breast",
            ],
        )
        self.assertEqual(out["by_day"]["Monday"], ["Portion chicken", "Blanch green beans"])
        self.assertEqual(out["by_day"]["Tuesday"], ["Braise short rib"])
        self.assertEqual(out["by_category"]["Sauces"], ["BBQ sauce", "Ranch"])
        self.assertEqual(out["by_category"]["Proteins"], ["Chicken breast"])

    def test_tab_header_and_prep_list_banner_dropped(self) -> None:
        out = self._run(
            ["Tab 1", "Weekly prep wednesday", "Stock up"],
            ["Prep list", "Dressings", "Caesar"],
        )
        self.assertIn("Wednesday", out["by_day"])
        self.assertNotIn("Tab 1", out["by_day"])
        self.assertEqual(out["by_category"]["Dressings"], ["Caesar"])

    def test_output_shape_matches_weekly_prep_contract(self) -> None:
        # lib/data.ts WeeklyPrep: {by_day, by_category} each Record<string,string[]>
        out = self._run(
            ["Weekly prep monday", "A"],
            ["Prep list", "Sauces", "B"],
        )
        self.assertEqual(set(out.keys()), {"by_day", "by_category"})
        for k, v in out["by_day"].items():
            self.assertIsInstance(k, str)
            self.assertIsInstance(v, list)
        for k, v in out["by_category"].items():
            self.assertIsInstance(k, str)
            self.assertIsInstance(v, list)

    def test_idempotency(self) -> None:
        weekly = ["Weekly prep monday", "X"]
        prep = ["Prep list", "Sauces", "Y"]
        first = self._run(weekly, prep)
        second = self._run(weekly, prep)
        self.assertEqual(first, second)


class ExtractOrderGuide(unittest.TestCase):
    HEADER = ("SUPC", "Desc", "Size", "Brand", "Unit", "Cat", "Location", "On Hand", "Par", "Need")

    def _run(self, data_rows):
        wb = FakeWorkbook([self.HEADER, *data_rows])
        with mock.patch.object(mod.openpyxl, "load_workbook", return_value=wb):
            return mod.extract_order_guide()

    def test_supc_float_is_coerced_to_integer_string(self) -> None:
        items = self._run([
            (5844220.0, "Bean Black", "6/CT", "BrandX", "CS", "Pantry", "Dry", 2, "3", None),
        ])
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["supc"], "5844220")
        self.assertEqual(items[0]["description"], "Bean Black")

    def test_blank_and_missing_rows_skipped(self) -> None:
        items = self._run([
            (None, None, None, None, None, None, None, None, None, None),
            (12345, None, "x", "y", "z", "c", "l", 0, "1", 0),  # missing desc
            (67890, "", "x", "y", "z", "c", "l", 0, "1", 0),    # empty desc
            (99999, "Good Item", "x", "y", "z", "c", "l", 0, "1", 0),
        ])
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["supc"], "99999")

    def test_output_shape_matches_order_guide_contract(self) -> None:
        # lib/data.ts OrderGuideItem keys.
        items = self._run([
            (12345, "Ketchup", "1/GAL", "Heinz", "CS", "Pantry", "Dry", 1, "2", None),
        ])
        self.assertEqual(len(items), 1)
        self.assertEqual(
            set(items[0].keys()),
            {"supc", "description", "pack_size", "brand", "unit", "category", "location", "par"},
        )
        self.assertIsInstance(items[0]["supc"], str)
        self.assertIsInstance(items[0]["description"], str)

    def test_blank_cells_become_none(self) -> None:
        items = self._run([
            (12345, "Thing", None, None, None, None, None, None, None, None),
        ])
        self.assertEqual(len(items), 1)
        rec = items[0]
        self.assertIsNone(rec["pack_size"])
        self.assertIsNone(rec["brand"])
        self.assertIsNone(rec["unit"])
        self.assertIsNone(rec["category"])
        self.assertIsNone(rec["location"])
        self.assertIsNone(rec["par"])

    def test_idempotency(self) -> None:
        rows = [(12345, "A", "1", "B", "CS", "Pantry", "Dry", 0, "2", 0)]
        first = self._run(rows)
        second = self._run(rows)
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
