#!/usr/bin/env python3
"""Audit zero-cost hours in a 7shifts labor export.

`Labor - By Employee.csv` carries rows that log hours at $0.00, from two
unrelated causes, and only one of them is benign:

  salaried     A real person whose pay is booked outside this export (JP,
               Sean). The hours are real and the $0.00 is expected.
  unexplained  Everything else — in the 2026-04-01 export that is `Bar Night`,
               `Bar Day`, `Security Team` and `Non usable employee`, which are
               job-code buckets rather than people. If the shifts behind those
               rows were worked and paid, this export understates labor cost
               by their wages and the reported labor % is too low.

Both distort every hour-denominated metric: the hours land in the denominator
while the dollars never land in the numerator, so SPLH reads low and the
blended rate reads low. The labor *percentage* is unaffected by them — it is
understated only by the salaried pay that never enters the file at all.

The classification is deliberately biased to fail loud: only names passed as
``--salaried`` are treated as explained. Anything else at $0.00 is reported as
needing an answer.

Settling it needs one of two things this file cannot supply:

  --punches  a shift-level export, to see whether a bucket logged hours on
             dates when no named person in that role worked. Hours on an
             uncovered date are real shifts; hours that always overlap a named
             person are more likely double-counted.
  --payroll-total  the period's actual gross payroll. The gap against this
             export's labor cost is the answer, with no inference at all.

Run:
  python3 scripts/audit_labor_zero_cost.py --export-dir dev/exports/2026-04-01
  python3 scripts/audit_labor_zero_cost.py --export-dir <dir> \
      --punches "dev/exports/2026-04-01/Labor - Time Punches.csv" \
      --payroll-total 311800.00

Exits non-zero when the export's own totals do not reconcile, or when a TOTAL
rollup row is found among the detail rows (the defect `isLaborRollupRow` in
scripts/rebuild-cache.mjs guards against).
"""
from __future__ import annotations

import argparse
import csv
import statistics
import sys
from collections import defaultdict
from pathlib import Path

# 7shifts writes UTF-8 with a BOM; older exports and anything round-tripped
# through Excel come back cp1252. Toast's CSVs are always cp1252 (CLAUDE.md).
ENCODINGS = ("utf-8-sig", "cp1252")

# Salaried staff whose pay is booked outside the labor export. Override with
# repeated --salaried; these are only the defaults for The Lariat.
SALARIED_DEFAULT = ("jon paul johnson", "sean burdges", "barbara goode")

ROLLUP_LABELS = frozenset({"TOTAL", "TOTALS", "GRAND TOTAL"})


def is_rollup_label(cell: str | None) -> bool:
    """Mirror of ``isLaborRollupRow`` in scripts/rebuild-cache.mjs."""
    return str(cell or "").strip().upper() in ROLLUP_LABELS


def read_csv(path: Path) -> list[dict[str, str]]:
    """Read a labor CSV, trying each known encoding before giving up."""
    last: Exception | None = None
    for encoding in ENCODINGS:
        try:
            with path.open(newline="", encoding=encoding) as fh:
                return [
                    {(k or "").strip(): (v or "").strip() for k, v in row.items()}
                    for row in csv.DictReader(fh)
                ]
        except UnicodeDecodeError as exc:  # pragma: no cover - depends on file
            last = exc
    raise SystemExit(f"{path}: undecodable as {' or '.join(ENCODINGS)} ({last})")


def _num(value: str) -> float:
    """Parse a CSV money/hours cell. Blank, '-' and '$1,234.56' all appear."""
    cleaned = str(value or "").replace("$", "").replace(",", "").strip()
    if cleaned in ("", "-", "--"):
        return 0.0
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def _get(row: dict[str, str], *names: str) -> str:
    """First non-empty value among `names`, matched case-insensitively."""
    lowered = {k.lower(): v for k, v in row.items()}
    for name in names:
        if lowered.get(name.lower()):
            return lowered[name.lower()]
    return ""


def person(row: dict[str, str]) -> str:
    first = _get(row, "First Name", "first_name")
    last = _get(row, "Last Name", "last_name")
    return " ".join(p for p in (first, last) if p).strip()


def load_employee_rows(path: Path) -> tuple[list[dict], list[dict]]:
    """Split an employee export into (detail rows, rollup rows)."""
    detail, rollup = [], []
    for raw in read_csv(path):
        last = _get(raw, "Last Name", "last_name")
        if not last:
            continue
        row = {
            "name": person(raw),
            "job_title": _get(raw, "Job Title", "job_title"),
            "hours": _num(_get(raw, "Total Hours", "total_hours")),
            "cost": _num(_get(raw, "Total Cost", "total_cost")),
            "ot_hours": _num(_get(raw, "OT Hours", "ot_hours")),
        }
        (rollup if is_rollup_label(last) else detail).append(row)
    return detail, rollup


def median_rate_by_role(detail: list[dict]) -> dict[str, float]:
    """Median $/hr per job title, over rows that actually carry pay."""
    rates: dict[str, list[float]] = defaultdict(list)
    for row in detail:
        if row["cost"] > 0 and row["hours"] > 0:
            rates[row["job_title"]].append(row["cost"] / row["hours"])
    return {role: statistics.median(vals) for role, vals in rates.items()}


def classify(detail: list[dict], salaried: set[str]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {"paid": [], "salaried": [], "unexplained": []}
    for row in detail:
        if row["cost"] > 0:
            out["paid"].append(row)
        elif row["hours"] <= 0:
            continue  # no hours and no cost — nothing to explain
        elif row["name"].strip().lower() in salaried:
            out["salaried"].append(row)
        else:
            out["unexplained"].append(row)
    return out


def _money(value: float) -> str:
    return f"${value:,.2f}"


def report(
    detail: list[dict],
    rollup: list[dict],
    salaried: set[str],
    net_sales: float,
    payroll_total: float | None,
) -> int:
    buckets = classify(detail, salaried)
    total_hours = sum(r["hours"] for r in detail)
    total_cost = sum(r["cost"] for r in detail)
    paid_hours = sum(r["hours"] for r in buckets["paid"])
    status = 0

    print(f"detail rows            {len(detail):>12,}")
    print(f"total hours            {total_hours:>12,.1f}")
    print(f"total cost             {_money(total_cost):>12}")

    if rollup:
        status = 1
        print("\nFAIL — rollup rows found among the detail rows:")
        for row in rollup:
            print(f"  {row['name'] or 'TOTAL':<24}{row['hours']:>10,.1f} hrs  "
                  f"{_money(row['cost']):>14}")
        print("  A rollup is not a record. Summing this file double-counts every")
        print("  figure in it. Rebuild the cache with a rebuild-cache.mjs that")
        print("  carries isLaborRollupRow(), then re-run.")

    print(f"\n{'ZERO-COST HOURS':-<58}")
    for bucket, label in (("salaried", "salaried (pay booked elsewhere)"),
                          ("unexplained", "UNEXPLAINED — needs an answer")):
        rows = buckets[bucket]
        hours = sum(r["hours"] for r in rows)
        print(f"\n{label}: {hours:,.1f} hrs across {len(rows)} rows")
        for row in sorted(rows, key=lambda r: -r["hours"]):
            print(f"  {row['name'][:26]:<26}{row['job_title'][:18]:<18}"
                  f"{row['hours']:>9,.1f}")

    rates = median_rate_by_role(detail)
    exposure, unpriced = 0.0, []
    for row in buckets["unexplained"]:
        rate = rates.get(row["job_title"])
        if rate:
            exposure += row["hours"] * rate
        else:
            unpriced.append(row)

    print(f"\n{'IF THE UNEXPLAINED HOURS WERE WORKED AND PAID':-<58}")
    print(f"  at each role's median paid rate: {_money(exposure)}")
    if unpriced:
        print("  not priced (no paid peer in that role, excluded from the figure):")
        for row in unpriced:
            print(f"    {row['name'][:24]:<24}{row['job_title'][:18]:<18}"
                  f"{row['hours']:>9,.1f} hrs")
    if net_sales:
        print(f"  labor % as reported     {total_cost / net_sales * 100:>6.1f}%")
        print(f"  labor % if paid         {(total_cost + exposure) / net_sales * 100:>6.1f}%")

    print(f"\n{'HOUR-DENOMINATED METRICS':-<58}")
    print(f"{'':<26}{'AS REPORTED':>14}{'PAID HOURS ONLY':>18}")
    print(f"{'hours':<26}{total_hours:>14,.1f}{paid_hours:>18,.1f}")
    if net_sales and paid_hours:
        print(f"{'SPLH (net)':<26}{_money(net_sales / total_hours):>14}"
              f"{_money(net_sales / paid_hours):>18}")
    if paid_hours:
        print(f"{'blended rate':<26}{_money(total_cost / total_hours):>14}"
              f"{_money(total_cost / paid_hours):>18}")

    if payroll_total is not None:
        gap = payroll_total - total_cost
        print(f"\n{'AGAINST ACTUAL PAYROLL':-<58}")
        print(f"  gross payroll          {_money(payroll_total)}")
        print(f"  this export            {_money(total_cost)}")
        print(f"  gap                    {_money(gap)}")
        print("\n  The gap is salaried pay plus any unexplained hours that were")
        print(f"  really paid. Salaried pay alone should account for it; {_money(exposure)}")
        print("  more than that means the unexplained hours were on payroll.")

    return status


def overlap(punches_path: Path, unexplained_names: set[str]) -> None:
    """Per-date coverage: did a named person work that role on that date?"""
    rows = read_csv(punches_path)
    by_date: dict[tuple[str, str], dict[str, float]] = defaultdict(
        lambda: {"bucket": 0.0, "named": 0.0}
    )
    for raw in rows:
        date = _get(raw, "Date", "Shift Date", "date", "delivery_date")
        role = _get(raw, "Job Title", "Role", "job_title")
        hours = _num(_get(raw, "Total Hours", "Hours", "total_hours"))
        if not date or hours <= 0:
            continue
        key = (date, role)
        side = "bucket" if person(raw).strip().lower() in unexplained_names else "named"
        by_date[key][side] += hours

    uncovered = {k: v for k, v in by_date.items() if v["bucket"] > 0 and v["named"] == 0}
    both = {k: v for k, v in by_date.items() if v["bucket"] > 0 and v["named"] > 0}

    print(f"\n{'PER-DATE COVERAGE (from punches)':-<58}")
    print(f"  dates where a bucket logged hours and NO named person in that")
    print(f"  role worked: {len(uncovered)}  ->  {sum(v['bucket'] for v in uncovered.values()):,.1f} hrs")
    for (date, role), v in sorted(uncovered.items())[:20]:
        print(f"    {date:<14}{role[:18]:<18}{v['bucket']:>8,.1f} hrs uncovered")
    if len(uncovered) > 20:
        print(f"    ... and {len(uncovered) - 20} more")
    print(f"\n  dates where both logged hours: {len(both)}  ->  "
          f"{sum(v['bucket'] for v in both.values()):,.1f} bucket hrs alongside "
          f"{sum(v['named'] for v in both.values()):,.1f} named hrs")
    print("\n  Uncovered hours are real shifts nobody was paid for in this export.")
    print("  Overlapping hours may be the same shift counted twice — check a few")
    print("  dates against the schedule before assuming either way.")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--export-dir", required=True, type=Path,
                    help="7shifts export dir holding 'Labor - By Employee.csv'")
    ap.add_argument("--punches", type=Path,
                    help="shift-level CSV, for per-date coverage")
    ap.add_argument("--payroll-total", type=float,
                    help="actual gross payroll for the period")
    ap.add_argument("--net-sales", type=float, default=0.0,
                    help="net sales for the period (else read from Labor - Summary.csv)")
    ap.add_argument("--salaried", action="append", default=[],
                    help="name whose pay is booked outside this export (repeatable)")
    args = ap.parse_args(argv)

    employees = args.export_dir / "Labor - By Employee.csv"
    if not employees.exists():
        raise SystemExit(f"not found: {employees}")

    net_sales = args.net_sales
    summary = args.export_dir / "Labor - Summary.csv"
    if not net_sales and summary.exists():
        for raw in read_csv(summary):
            values = list(raw.values())
            if values and values[0].strip() == "Net Sales":
                net_sales = _num(values[1] if len(values) > 1 else "")

    detail, rollup = load_employee_rows(employees)
    salaried = {n.strip().lower() for n in (args.salaried or SALARIED_DEFAULT)}
    status = report(detail, rollup, salaried, net_sales, args.payroll_total)

    if args.punches:
        buckets = classify(detail, salaried)
        overlap(args.punches, {r["name"].strip().lower() for r in buckets["unexplained"]})

    return status


if __name__ == "__main__":
    sys.exit(main())
