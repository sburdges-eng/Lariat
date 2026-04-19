"""Canonical schema and join-key helpers for merged vendor price catalogs.

CANONICAL_PRICE_COLS is the column order for any merged_prices CSV
produced by the costing pipeline. Every source reader in
scripts/rebuild_merged_prices.py emits dicts using these keys; the
final DataFrame is projected down to this list before writing.
"""

from __future__ import annotations

import pandas as pd

from scripts.lib.ingredient_key import normalize_series


CANONICAL_PRICE_COLS: list[str] = [
    "ingredient",
    "vendor",
    "sku",
    "pack_size",
    "pack_unit",
    "pack_price_usd",
    "unit_price_usd",
    "effective_date",
    "category",
    "notes",
]


def _make_join_key(series: pd.Series) -> pd.Series:
    """Back-compat wrapper. New code should import normalize_series directly."""
    return normalize_series(series)
