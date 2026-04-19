"""Shared display formatting for Streamlit UI.

All user-facing text should pass through these helpers so the app
reads like a tool for kitchen managers, not a developer console.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path

import pandas as pd


def humanize(name: str) -> str:
    """Convert snake_case or slug names to Title Case for display.

    'blackened_tomato_salsa' → 'Blackened Tomato Salsa'
    'total_cost_usd'        → 'Total Cost USD'
    """
    return name.replace("_", " ").strip().title()


# Common kitchen fractions — keys are rounded to 4 decimals for matching.
_FRACTIONS: dict[float, str] = {
    0.125: "⅛",
    0.1667: "⅙",
    0.25: "¼",
    0.3333: "⅓",
    0.375: "⅜",
    0.5: "½",
    0.625: "⅝",
    0.6667: "⅔",
    0.75: "¾",
    0.875: "⅞",
}


def fmt_qty(value: float | int | None) -> str:
    """Format a quantity as a kitchen-friendly fraction.

    fmt_qty(0.25)  → '¼'
    fmt_qty(0.5)   → '½'
    fmt_qty(1.5)   → '1 ½'
    fmt_qty(3)     → '3'
    fmt_qty(0.333) → '⅓'
    fmt_qty(None)  → '—'
    """
    if value is None or pd.isna(value):
        return "—"
    if value == 0:
        return "0"
    whole = int(value)
    frac = round(value - whole, 4)
    frac_str = _FRACTIONS.get(frac, "")
    if not frac_str and frac > 0:
        # No exact fraction match — show rounded decimal
        frac_str = str(round(frac, 2)).lstrip("0")
    if whole and frac_str:
        return f"{whole} {frac_str}"
    if whole:
        return str(whole)
    return frac_str or str(round(value, 2))


def fmt_qty_col(df: pd.DataFrame, cols: str | list[str]) -> pd.DataFrame:
    """Convert quantity columns to kitchen fractions for display. Returns a copy."""
    if isinstance(cols, str):
        cols = [cols]
    out = df.copy()
    for col in cols:
        if col in out.columns:
            out[col] = out[col].apply(fmt_qty)
    return out


def fmt_usd(value: float | int | None, decimals: int = 2) -> str:
    """Format a number as USD, rounded to 2 decimals by default.

    fmt_usd(25.6692)  → '$25.67'
    fmt_usd(1231.925) → '$1,231.93'
    fmt_usd(None)     → '—'
    """
    if value is None or pd.isna(value):
        return "—"
    return f"${value:,.{decimals}f}"


# Column header renames for common data patterns.
_COLUMN_RENAMES: dict[str, str] = {
    "recipe_id": "Recipe",
    "ingredient": "Ingredient",
    "total_cost_usd": "Total Cost",
    "unit_cost_usd": "Unit Cost",
    "unit_price_usd": "Unit Price",
    "pack_price_usd": "Pack Price",
    "food_cost_pct": "Food Cost %",
    "menu_price_usd": "Menu Price",
    "contribution_margin": "Margin",
    "qty": "Qty",
    "unit": "Unit",
    "base_qty": "Base Qty",
    "base_unit": "Base Unit",
    "display_unit": "Display Unit",
    "adjusted_qty": "Adjusted Qty",
    "menu_item": "Menu Item",
    "menu_item_id": "Menu Item",
    "event_date": "Event Date",
    "client_name": "Client",
    "guest_count": "Guests",
    "event_name": "Event",
    "status": "Status",
    "station_id": "Station",
    "station_name": "Station",
    "sauce_name": "Sauce",
    "par_qty": "Par",
    "current_qty": "On Hand",
    "on_hand": "On Hand",
    "vendor": "Vendor",
    "category": "Category",
    "notes": "Notes",
    "employee_name": "Employee",
    "role": "Role",
    "hourly_rate_usd": "Rate",
    "total_hours": "Hours",
    "total_pay_usd": "Total Pay",
    "deposit_usd": "Deposit",
    "total_quoted_usd": "Quoted",
    "total_actual_usd": "Actual",
    "vendor_sku": "SKU",
    "description": "Description",
    "winter_headcount": "Winter",
    "shoulder_headcount": "Spring/Fall",
    "summer_headcount": "Summer",
    "winter_hrs_per_week": "Winter Hrs/Wk",
    "shoulder_hrs_per_week": "Spring/Fall Hrs/Wk",
    "summer_hrs_per_week": "Summer Hrs/Wk",
}


def humanize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Rename DataFrame columns from snake_case dev names to human labels.

    Uses the built-in rename map, then falls back to humanize() for unknowns.
    Returns a copy — never mutates the original.
    """
    renamed = {}
    for col in df.columns:
        renamed[col] = _COLUMN_RENAMES.get(col, humanize(col))
    return df.rename(columns=renamed)


def humanize_recipe_col(df: pd.DataFrame, col: str = "recipe_id") -> pd.DataFrame:
    """Title-case a recipe_id column in place for display.

    'blackened_tomato_salsa' → 'Blackened Tomato Salsa'
    Returns a copy.
    """
    if col not in df.columns:
        return df
    out = df.copy()
    out[col] = out[col].apply(lambda x: humanize(str(x)) if pd.notna(x) else x)
    return out


def fmt_usd_col(df: pd.DataFrame, cols: str | list[str]) -> pd.DataFrame:
    """Round USD columns to 2 decimals in a DataFrame. Returns a copy."""
    if isinstance(cols, str):
        cols = [cols]
    out = df.copy()
    for col in cols:
        if col in out.columns:
            out[col] = pd.to_numeric(out[col], errors="coerce").round(2)
    return out


BCG_LABELS = {
    "Star": "Best Seller",
    "Plowhorse": "Workhorse",
    "Puzzle": "Hidden Gem",
    "Dog": "Underperformer",
}

# Season display names — "shoulder" is a data-layer term, never shown to users.
_SEASON_DISPLAY: dict[str, str] = {
    "winter": "Winter",
    "shoulder": "Spring/Fall",
    "summer": "Summer",
}

_SEASON_BY_MONTH: dict[int, str] = {
    1: "Winter", 2: "Winter", 3: "Winter",
    4: "Spring", 5: "Spring",
    6: "Summer", 7: "Summer", 8: "Summer", 9: "Summer",
    10: "Fall", 11: "Fall",
    12: "Winter",
}


def season_display(season_key: str | None = None) -> str:
    """Human-readable season name.

    season_display('shoulder') → 'Spring/Fall'  (for labels covering both)
    season_display()           → 'Spring' or 'Fall' (based on current month)
    """
    if season_key:
        return _SEASON_DISPLAY.get(season_key, humanize(season_key))
    return _SEASON_BY_MONTH.get(date.today().month, "Spring/Fall")


def build_menu_display_map(data_root: Path) -> dict[str, str]:
    """Map menu_item_id -> display_name from latest menu CSV."""
    menus = sorted(Path(data_root).glob("menus/menu_v*.csv"), reverse=True)
    if not menus:
        return {}
    df = pd.read_csv(menus[0], dtype={"menu_item_id": str})
    if "display_name" in df.columns and "menu_item_id" in df.columns:
        return dict(zip(df["menu_item_id"].astype(str), df["display_name"]))
    return {}
