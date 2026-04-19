"""
Colorado COMPS Order #39 Compliance Logic for Lariat BOH.
Handles OT, Split-Shifts, and Break validation.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass
class Shift:
    employee_id: str
    start_time: datetime
    end_time: datetime
    is_meal_taken: bool = False


class ComplianceEngine:
    MIN_WAGE = 14.42  # 2024 Colorado Minimum Wage

    def __init__(self, shifts: list[Shift]):
        self.shifts = sorted(shifts, key=lambda x: x.start_time)

    def get_daily_hours(self, date_str: str) -> float:
        day_shifts = [s for s in self.shifts if s.start_time.strftime("%Y-%m-%d") == date_str]
        total_seconds = sum((s.end_time - s.start_time).total_seconds() for s in day_shifts)
        return total_seconds / 3600.0

    def check_ot_12hr(self, date_str: str) -> bool:
        """Flag if daily hours exceed 12."""
        return self.get_daily_hours(date_str) > 12.0

    def check_split_shift(self, date_str: str) -> bool:
        """
        COMPS #39: A split shift is a schedule interrupted by non-paid, non-working
        periods (other than meal periods).
        """
        day_shifts = [s for s in self.shifts if s.start_time.strftime("%Y-%m-%d") == date_str]
        if len(day_shifts) < 2:
            return False

        for i in range(len(day_shifts) - 1):
            gap = (day_shifts[i + 1].start_time - day_shifts[i].end_time).total_seconds() / 3600.0
            if gap > 1.0:
                return True
        return False

    def validate_breaks(self, shift: Shift) -> dict[str, Any]:
        """Validate rest and meal periods based on duration."""
        duration = (shift.end_time - shift.start_time).total_seconds() / 3600.0
        issues: list[str] = []
        results: dict[str, Any] = {
            "rest_periods_required": int(duration // 4),
            "meal_period_required": duration > 5.0,
            "compliant": True,
            "issues": issues,
        }

        if results["meal_period_required"] and not shift.is_meal_taken:
            results["compliant"] = False
            issues.append("Missing 30m unpaid meal break")

        return results
