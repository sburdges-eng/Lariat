"""Unit conversion tables and normalization for the costing pipeline.

Scope: convert price-per-unit into price-per-base-unit so dissimilar
vendor listings can be compared. Base units are:

  weight → gram (g)
  volume → millilitre (ml)
  count  → each   (ea)

Density-based cross-dimension conversion (e.g. cup → g for flour)
is NOT in this module; handle that in an ingredient-specific density
table or in the BOM layer where the ingredient identity is known.

Conversion factors are defined as "N base-units in one of this unit."
So `WEIGHT_TO_G["lb"] == 453.592` means 1 lb == 453.592 g, and
`price_per_g = price_per_lb / 453.592`.
"""

from __future__ import annotations


# ---------------------------------------------------------------------------
# Conversion tables (base factor = 1 for the canonical base unit)
# ---------------------------------------------------------------------------

WEIGHT_TO_G: dict[str, float] = {
    "mg": 0.001,
    "g": 1.0,
    "gram": 1.0,
    "grams": 1.0,
    "kg": 1000.0,
    "oz": 28.3495231,
    "lb": 453.59237,
    "lbs": 453.59237,
    "pound": 453.59237,
    "pounds": 453.59237,
}

VOLUME_TO_ML: dict[str, float] = {
    "ml": 1.0,
    "l": 1000.0,
    "liter": 1000.0,
    "litre": 1000.0,
    "tsp": 4.92892159,
    "tbsp": 14.78676478,
    "floz": 29.5735296,
    "fl_oz": 29.5735296,
    "fl oz": 29.5735296,
    "cup": 236.5882365,
    "cups": 236.5882365,
    "pt": 473.176473,
    "pint": 473.176473,
    "qt": 946.352946,
    "quart": 946.352946,
    "gal": 3785.411784,
    "gallon": 3785.411784,
}

# Count units. "pk" and "cs" deliberately map to 1 — they are opaque pack
# wrappers whose true per-item quantity is carried on a separate pack_size
# column. Callers that blindly treat pk → 1 ea are already relying on
# pack_size having been applied upstream.
COUNT_TO_EA: dict[str, float] = {
    "ea": 1.0,
    "each": 1.0,
    "pc": 1.0,
    "pcs": 1.0,
    "ct": 1.0,
    "count": 1.0,
    "pk": 1.0,
    "pack": 1.0,
    "cs": 1.0,
    "case": 1.0,
    "bag": 1.0,
    "bottle": 1.0,
    "btl": 1.0,
    "can": 1.0,
    "cn": 1.0,
    "jar": 1.0,
    "bunch": 1.0,
    "box": 1.0,
    "slice": 1.0,
    "sprig": 1.0,
    "clove": 1.0,
    "doz": 12.0,
    "dozen": 12.0,
}


# Synonym normalization — single source of truth for casing, spacing, and
# plural collapse. Keep generous; the costing CSVs come from vendors.
_SYNONYMS: dict[str, str] = {
    "": "",
    "pound": "lb",
    "pounds": "lb",
    "lbs": "lb",
    "ounce": "oz",
    "ounces": "oz",
    "gram": "g",
    "grams": "g",
    "kilogram": "kg",
    "kilograms": "kg",
    "milligram": "mg",
    "milligrams": "mg",
    "liter": "l",
    "litre": "l",
    "liters": "l",
    "millilitre": "ml",
    "milliliter": "ml",
    "milliliters": "ml",
    "teaspoon": "tsp",
    "teaspoons": "tsp",
    "tablespoon": "tbsp",
    "tablespoons": "tbsp",
    "fluid_ounce": "floz",
    "fluid ounce": "floz",
    "fl_oz": "floz",
    "fl oz": "floz",
    "cups": "cup",
    "pint": "pt",
    "pints": "pt",
    "quart": "qt",
    "quarts": "qt",
    "gallon": "gal",
    "gallons": "gal",
    "each": "ea",
    "pcs": "pc",
    "count": "ct",
    "pack": "pk",
    "packs": "pk",
    "case": "cs",
    "cases": "cs",
    "bags": "bag",
    "bottles": "bottle",
    "btl": "bottle",
    "cans": "can",
    "#10 can": "can",
    "#10_can": "can",
    "jars": "jar",
    "bunches": "bunch",
    "boxes": "box",
    "slices": "slice",
    "sprigs": "sprig",
    "cloves": "clove",
    "dozen": "doz",
    "dozens": "doz",
}


def normalize_unit(raw: object) -> str:
    """Lower-case, strip, collapse synonyms. Returns canonical key or ''.

    Callers should treat a '' return as "unknown unit" and skip conversion
    rather than assume a default — silent defaults cause silent cost errors.
    """
    if raw is None:
        return ""
    s = str(raw).strip().lower()
    if not s:
        return ""
    return _SYNONYMS.get(s, s)


def unit_dimension(canon: str) -> str | None:
    """Return 'weight' | 'volume' | 'count' | None for a canonical unit."""
    if canon in WEIGHT_TO_G:
        return "weight"
    if canon in VOLUME_TO_ML:
        return "volume"
    if canon in COUNT_TO_EA:
        return "count"
    return None
