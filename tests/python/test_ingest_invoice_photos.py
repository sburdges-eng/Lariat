"""Unit tests for scripts.ingest_invoice_photos.

Covers the pure transform helpers — the OCR pass and DB write path are
exercised manually against the photo corpus; the helpers below turn bbox
JSON into Line/InvoiceGroup records.

  - parse_money: $/N-suffix/comma-decimal OCR variants; rejects junk.
  - parse_date_iso: m/d/yy and m/d/YYYY; rejects out-of-range.
  - rows_from_boxes: y-clustering groups same-row boxes, splits rows.
  - classify: vendor + customer detection, The Blend exclusion signal.
  - parse_sysco_lines: SKU+money rows, derived qty, orphan total rows,
    category banners, group-total skipping.
  - parse_shamrock_lines: column-band zip, fused qty digit on 8-digit SKU,
    fused unit prefix stripping.
  - group_invoices: multi-photo merge by invoice_no, SKU dedupe keeps the
    higher-confidence line.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import ingest_invoice_photos as mod  # noqa: E402


def box(t, x, y, w=0.05, h=0.01):
    return {"t": t, "x": x, "y": y, "w": w, "h": h}


class TestParseMoney(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(mod.parse_money("28.99"), 28.99)

    def test_dollar_and_comma_thousands(self):
        self.assertEqual(mod.parse_money("$2,442.75"), 2442.75)

    def test_ocr_comma_decimal(self):
        self.assertEqual(mod.parse_money("42,69"), 42.69)

    def test_tax_suffix(self):
        self.assertEqual(mod.parse_money("16.46N"), 16.46)
        self.assertEqual(mod.parse_money("30.58 N"), 30.58)

    def test_rejects(self):
        self.assertIsNone(mod.parse_money("60-1.4,"))
        self.assertIsNone(mod.parse_money("250.4"))
        self.assertIsNone(mod.parse_money("4527893"))
        self.assertIsNone(mod.parse_money("CS"))


class TestParseDateIso(unittest.TestCase):
    def test_two_digit_year(self):
        self.assertEqual(mod.parse_date_iso("8/04/25"), "2025-08-04")

    def test_four_digit_year(self):
        self.assertEqual(mod.parse_date_iso("9/3/2025"), "2025-09-03")

    def test_rejects_out_of_range(self):
        self.assertIsNone(mod.parse_date_iso("0/30/2025"))
        self.assertIsNone(mod.parse_date_iso("13/01/2025"))
        self.assertIsNone(mod.parse_date_iso("1/1/1999"))

    def test_rejects_future_date(self):
        self.assertIsNone(mod.parse_date_iso("9/22/2029"))


class TestRowsFromBoxes(unittest.TestCase):
    def test_groups_and_splits(self):
        boxes = [
            box("A", 0.1, 0.100), box("B", 0.5, 0.102),  # same row
            box("C", 0.1, 0.200),                        # new row
        ]
        rows = mod.rows_from_boxes(boxes)
        self.assertEqual([[b["t"] for b in r] for r in rows], [["A", "B"], ["C"]])

    def test_x_sorted_within_row(self):
        boxes = [box("right", 0.8, 0.1), box("left", 0.1, 0.1)]
        rows = mod.rows_from_boxes(boxes)
        self.assertEqual([b["t"] for b in rows[0]], ["left", "right"])

    def test_empty(self):
        self.assertEqual(mod.rows_from_boxes([]), [])


class TestClassify(unittest.TestCase):
    def test_sysco_lariat(self):
        v, c = mod.classify("SYSCO DENVER ... LARIAT TRUCK STOP")
        self.assertEqual((v, c), ("Sysco", "Lariat"))

    def test_blend_excluded_customer(self):
        v, c = mod.classify("Sysco invoice THE BLEND 301 E MAIN")
        self.assertEqual((v, c), ("Sysco", "The Blend"))

    def test_unknown(self):
        v, c = mod.classify("random betting app screenshot")
        self.assertEqual((v, c), (None, None))


class TestParseSyscoLines(unittest.TestCase):
    def _row(self, *tokens, y=0.5):
        return [box(t, 0.05 + 0.1 * i, y) for i, t in enumerate(tokens)]

    def test_basic_line_derived_qty(self):
        rows = [self._row("CS", "25 LB", "DOLE BANANA SLICE IQF", "3717416", "28.99", "57.98")]
        (ln,) = mod.parse_sysco_lines(rows)
        self.assertEqual(ln.sku, "3717416")
        self.assertEqual(ln.qty, 2)
        self.assertEqual(ln.unit_price, 28.99)
        self.assertEqual(ln.line_total, 57.98)
        self.assertIn("BANANA", ln.description)
        self.assertEqual(ln.confidence, "high")

    def test_printed_qty_and_category(self):
        rows = [
            self._row("CANNED & DRY", y=0.4),
            self._row("2", "19 LB", "ALMOND BUTTER SMOOTH", "1174461", "78.95", "157.90", y=0.5),
        ]
        (ln,) = mod.parse_sysco_lines(rows)
        self.assertEqual(ln.qty, 2)
        self.assertEqual(ln.category, "CANNED & DRY")

    def test_orphan_total_row(self):
        rows = [
            self._row("CS", "25LB", "STRAWBERRY DICED", "6699120", "42.69", y=0.5),
            self._row("128.07", y=0.52),
        ]
        (ln,) = mod.parse_sysco_lines(rows)
        self.assertEqual(ln.line_total, 128.07)
        self.assertEqual(ln.qty, 3)

    def test_middle_tax_value_ignored(self):
        rows = [self._row("CS", "TOWEL ROLL COMP360", "4527893", "55.95", "4.56", "55.95")]
        (ln,) = mod.parse_sysco_lines(rows)
        self.assertEqual(ln.unit_price, 55.95)
        self.assertEqual(ln.line_total, 55.95)
        self.assertEqual(ln.qty, 1)

    def test_group_total_skipped(self):
        rows = [self._row("GROUP TOTAL****", "575.04")]
        self.assertEqual(mod.parse_sysco_lines(rows), [])


class TestParseShamrockLines(unittest.TestCase):
    def test_column_zip_with_fused_qty(self):
        rows = [[
            box("42300151", 0.05, 0.30),          # qty 4 fused onto SKU 2300151
            box("RELISH, PICKLE SWT MILD", 0.30, 0.302),
            box("16.46", 0.60, 0.303),
            box("65.84", 0.80, 0.303),
        ]]
        (ln,) = mod.parse_shamrock_lines(rows)
        self.assertEqual(ln.sku, "2300151")
        self.assertEqual(ln.qty, 4)
        self.assertEqual(ln.unit_price, 16.46)
        self.assertEqual(ln.line_total, 65.84)

    def test_fused_unit_prefix(self):
        rows = [[
            box("7 4210061", 0.05, 0.30),
            box("LBHONEY,CLOVER", 0.30, 0.301),
            box("30.58", 0.60, 0.302),
            box("214.06", 0.80, 0.302),
        ]]
        (ln,) = mod.parse_shamrock_lines(rows)
        self.assertEqual(ln.sku, "4210061")
        self.assertEqual(ln.qty, 7)
        self.assertEqual(ln.unit, "LB")
        self.assertEqual(ln.description, "HONEY,CLOVER")

    def test_skew_tolerant_zip(self):
        # description drifts slightly below its SKU (wrinkled paper) —
        # within ~one box height, beyond which it's treated as another row
        rows = [[
            box("1612203", 0.05, 0.40),
            box("TOMATO, 5X6 2 LAYER REFRIG PRS", 0.30, 0.408),
            box("20.14", 0.60, 0.405),
        ]]
        (ln,) = mod.parse_shamrock_lines(rows)
        self.assertEqual(ln.sku, "1612203")
        self.assertIn("TOMATO", ln.description)


class TestGroupInvoices(unittest.TestCase):
    def test_multi_photo_merge_dedupes_by_sku(self):
        hi = mod.Line(sku="111", description="X", qty=1, unit=None, pack_size=None,
                      unit_price=1.0, line_total=1.0, category=None, confidence="high")
        lo = mod.Line(sku="111", description="X?", qty=None, unit=None, pack_size=None,
                      unit_price=None, line_total=None, category=None, confidence="low")
        p1 = mod.PhotoParse(file="IMG_1", vendor="Sysco", customer="Lariat",
                            invoice_no="759000001", invoice_date="2026-01-01",
                            invoice_total=100.0, lines=[lo])
        p2 = mod.PhotoParse(file="IMG_2", vendor="Sysco", customer="Lariat",
                            invoice_no="759000001", invoice_date=None,
                            invoice_total=None, lines=[hi])
        (g,) = mod.group_invoices([p1, p2])
        self.assertEqual(g.files, ["IMG_1", "IMG_2"])
        self.assertEqual(len(g.lines), 1)
        self.assertEqual(g.lines[0].confidence, "high")
        self.assertEqual(g.invoice_total, 100.0)

    def test_no_invoice_no_kept_separate(self):
        p1 = mod.PhotoParse(file="IMG_1", vendor="Shamrock", customer="Lariat",
                            invoice_no=None, invoice_date=None, invoice_total=None, lines=[])
        p2 = mod.PhotoParse(file="IMG_2", vendor="Shamrock", customer="Lariat",
                            invoice_no=None, invoice_date=None, invoice_total=None, lines=[])
        self.assertEqual(len(mod.group_invoices([p1, p2])), 2)


if __name__ == "__main__":
    unittest.main()
