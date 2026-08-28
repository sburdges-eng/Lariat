"""Tests for scripts/audit_labor_zero_cost.py.

The audit exists to answer one question about a 7shifts export — are the
zero-cost hours real unpaid-in-this-file shifts, or bookkeeping artifacts —
so the cases that matter are the ones where a wrong answer changes the labor
percentage: rollup rows counted as people, unexplained buckets quietly folded
in with salaried staff, and rates derived from rows that carry no pay.
"""

from __future__ import annotations

import csv
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.audit_labor_zero_cost import (  # noqa: E402
    _num,
    classify,
    is_rollup_label,
    load_employee_rows,
    main,
    median_rate_by_role,
)

HEADER = [
    "Last Name", "First Name", "Job Title", "Regular Hours", "OT Hours",
    "Total Hours", "Regular Cost", "OT Cost", "Total Cost", "Labor % (Net)",
]

# Shaped like the real 2026-04-01 export: paid bartenders around $14.42/hr, a
# job-code bucket and a salaried GM both logging hours at $0.00, and the TOTAL
# rollup row 7shifts closes the file with.
ROWS = [
    ["Pauly", "Alisha", "Bartender", 831.6, 1.1, 831.6, 11985, 11.81, 11996.81, 0.011],
    ["Martineau", "Calli", "Bartender", 541.8, 0, 541.8, 7883.82, 0, 7883.82, 0.007],
    ["Night", "Bar", "Bartender", 1638.9, 466.2, 2105.1, 0, 0, 0, 0],
    ["johnson", "jon paul", "General Manager", 1400.3, 262, 1662.3, 0, 0, 0, 0],
    ["TOTAL", "", "", 4412.6, 729.3, 5140.8, 19868.82, 11.81, 19880.63, 0],
]


def write_export(directory: Path, rows=ROWS, net_sales: float = 50000.0) -> None:
    with (directory / "Labor - By Employee.csv").open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(HEADER)
        writer.writerows(rows)
    with (directory / "Labor - Summary.csv").open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["Metric", "Value"])
        writer.writerow(["Net Sales", net_sales])


class RollupLabel(unittest.TestCase):
    def test_flags_the_rollup_row_the_export_ends_with(self) -> None:
        for label in ("TOTAL", "total", "  Total  ", "Totals", "Grand Total"):
            self.assertTrue(is_rollup_label(label), label)

    def test_never_flags_a_person_or_a_role(self) -> None:
        for label in ("Mccune", "Pauly", "Totaro", "Cook", "Bartender", "", None):
            self.assertFalse(is_rollup_label(label), label)


class NumberParsing(unittest.TestCase):
    def test_reads_the_shapes_the_export_actually_writes(self) -> None:
        self.assertEqual(_num("$11,996.81"), 11996.81)
        self.assertEqual(_num("831.6"), 831.6)

    def test_blank_and_dash_cells_are_zero_not_a_crash(self) -> None:
        for empty in ("", "   ", "-", "--", None):
            self.assertEqual(_num(empty), 0.0)


class LoadEmployeeRows(unittest.TestCase):
    def test_rollup_row_is_separated_from_the_detail_rows(self) -> None:
        with TemporaryDirectory() as tmp:
            write_export(Path(tmp))
            detail, rollup = load_employee_rows(Path(tmp) / "Labor - By Employee.csv")
        self.assertEqual(len(detail), 4)
        self.assertEqual(len(rollup), 1)
        # Left in, the rollup would nearly double both figures.
        self.assertAlmostEqual(sum(r["hours"] for r in detail), 5140.8, places=1)
        self.assertAlmostEqual(sum(r["cost"] for r in detail), 19880.63, places=2)


class Classify(unittest.TestCase):
    def setUp(self) -> None:
        with TemporaryDirectory() as tmp:
            write_export(Path(tmp))
            self.detail, _ = load_employee_rows(Path(tmp) / "Labor - By Employee.csv")

    def test_splits_salaried_from_unexplained_zero_cost_rows(self) -> None:
        buckets = classify(self.detail, {"jon paul johnson"})
        self.assertEqual([r["name"] for r in buckets["salaried"]], ["jon paul johnson"])
        self.assertEqual([r["name"] for r in buckets["unexplained"]], ["Bar Night"])
        self.assertEqual(len(buckets["paid"]), 2)

    def test_an_unlisted_zero_cost_name_is_unexplained_not_assumed_salaried(self) -> None:
        # Fail loud: only names passed in are treated as explained.
        buckets = classify(self.detail, set())
        self.assertEqual(
            sorted(r["name"] for r in buckets["unexplained"]),
            ["Bar Night", "jon paul johnson"],
        )


class MedianRate(unittest.TestCase):
    def test_rate_ignores_rows_that_carry_no_pay(self) -> None:
        with TemporaryDirectory() as tmp:
            write_export(Path(tmp))
            detail, _ = load_employee_rows(Path(tmp) / "Labor - By Employee.csv")
        rates = median_rate_by_role(detail)
        # Bar Night's 2,105 unpaid hours would drag this toward $6/hr.
        self.assertAlmostEqual(rates["Bartender"], 14.49, places=1)
        self.assertNotIn("General Manager", rates)


class ExitStatus(unittest.TestCase):
    def test_exits_nonzero_while_a_rollup_row_is_present(self) -> None:
        with TemporaryDirectory() as tmp:
            write_export(Path(tmp))
            self.assertEqual(main(["--export-dir", tmp]), 1)

    def test_exits_zero_once_the_export_is_clean(self) -> None:
        with TemporaryDirectory() as tmp:
            write_export(Path(tmp), rows=ROWS[:-1])
            self.assertEqual(main(["--export-dir", tmp]), 0)


if __name__ == "__main__":
    unittest.main()
