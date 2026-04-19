"""Canonical schema and join-key helpers for merged vendor price catalogs.

CANONICAL_PRICE_COLS is the column order for any merged_prices CSV
produced by the costing pipeline. Every source reader in
scripts/rebuild_merged_prices.py emits dicts using these keys; the
final DataFrame is projected down to this list before writing.
"""

from __future__ import annotations

import re

import pandas as pd


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


# Strip bracketed prefixes like "[JIT]" / "[NEW]" and common suffix tokens
# before hashing. The goal is to collapse rows that refer to the same
# underlying ingredient even when the vendor description drifts between
# catalogs.
_BRACKET_PREFIX = re.compile(r"^\s*\[[^\]]*\]\s*")
_NONALNUM = re.compile(r"[^a-z0-9]+")


def _make_join_key(series: pd.Series) -> pd.Series:
    """Produce a best-effort dedup key for ingredient descriptions.

    Lower-case, drop bracketed prefix, drop non-alphanumerics, collapse
    whitespace. Intentionally NOT fuzzy — if a vendor renames an item
    materially, treat it as a new row. Dedup is for casing and
    punctuation drift, not for merging semantically-different SKUs.
    """
    if not isinstance(series, pd.Series):
        raise TypeError("_make_join_key expects a pandas Series")
    s = series.astype(str).str.lower().str.strip()
    s = s.str.replace(_BRACKET_PREFIX, "", regex=True)
    s = s.str.replace(_NONALNUM, " ", regex=True).str.strip()
    s = s.str.replace(r"\s+", " ", regex=True)
    return s
