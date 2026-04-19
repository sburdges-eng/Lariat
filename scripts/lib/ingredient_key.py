"""Single source of truth for the normalized ingredient key used across
the mapping engine. Python is authoritative; TypeScript mirrors this
algorithm and is parity-tested against it.

Algorithm: lower-case, strip bracketed prefix like "[JIT]" or "[NEW]",
drop non-alphanumerics, collapse whitespace.

Intentionally NOT fuzzy — if a vendor renames an item materially, treat
it as a new row. Dedup is for casing and punctuation drift, not for
merging semantically-different SKUs.
"""
from __future__ import annotations

import re

import pandas as pd

_BRACKET_PREFIX = re.compile(r"^\s*\[[^\]]*\]\s*")
_NONALNUM = re.compile(r"[^a-z0-9]+")
_WHITESPACE = re.compile(r"\s+")


def normalize_one(value: str | None) -> str:
    """Normalize a single str | None to the canonical ingredient key."""
    if value is None:
        return ""
    s = str(value).lower().strip()
    s = _BRACKET_PREFIX.sub("", s)
    s = _NONALNUM.sub(" ", s)
    s = _WHITESPACE.sub(" ", s).strip()
    return s


def normalize_series(series: "pd.Series") -> "pd.Series":
    """Vectorized equivalent of normalize_one for a pandas Series."""
    if not isinstance(series, pd.Series):
        raise TypeError("normalize_series expects a pandas Series")
    s = series.astype(str).str.lower().str.strip()
    s = s.str.replace(_BRACKET_PREFIX, "", regex=True)
    s = s.str.replace(_NONALNUM, " ", regex=True).str.strip()
    s = s.str.replace(_WHITESPACE, " ", regex=True)
    return s
