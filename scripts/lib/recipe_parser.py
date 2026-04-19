"""
Shared logic for parsing and flattening the nested Lariat recipe_book.csv format.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd


def flatten_recipes(recipe_path: Path) -> pd.DataFrame:
    """Parses the nested recipe_book.csv into a flat DataFrame."""
    try:
        # col_0 to col_6 are the default sanitized headers from extract_workbook.py
        df = pd.read_csv(recipe_path)
    except Exception:
        return pd.DataFrame()

    flat_data = []
    current_recipe = None

    for _, row in df.iterrows():
        val0 = str(row.iloc[0]).strip()
        if not val0 or val0 == "nan" or val0 == "Ingredient":
            continue

        # Check if this is a recipe header (Scale: is in col 5)
        # Based on workbook/data/recipe_book.csv structure
        if len(row) > 5 and str(row.iloc[5]).strip() == "Scale:":
            current_recipe = val0
            continue

        if current_recipe and val0:
            flat_data.append(
                {
                    "recipe": current_recipe,
                    "ingredient": val0,
                    "qty": pd.to_numeric(row.iloc[1], errors="coerce"),
                    "unit": str(row.iloc[2]).strip(),
                }
            )

    return pd.DataFrame(flat_data)
