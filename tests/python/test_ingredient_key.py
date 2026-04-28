"""Unit tests for scripts.lib.ingredient_key and the vendor_catalog back-compat wrapper.

The Python normalizer is the authoritative source for the canonical
ingredient key used across the mapping engine. This suite guards three
invariants:

  1. normalize_one and normalize_series produce identical output for
     every row in the parity fixture's INPUTS list.
  2. normalize_one is idempotent: normalize_one(normalize_one(x)) == normalize_one(x).
  3. The back-compat wrapper vendor_catalog._make_join_key still returns
     identical output to the new normalize_series, so existing callers
     (scripts/rebuild_merged_prices.py) aren't silently broken.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

# Allow running as `python3 -m unittest tests.python.test_ingredient_key`
# from the project root without install.
ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pandas as pd  # noqa: E402

from scripts.lib.generate_ingredient_key_fixture import INPUTS  # noqa: E402
from scripts.lib.ingredient_key import normalize_one, normalize_series  # noqa: E402
from scripts.lib.vendor_catalog import _make_join_key  # noqa: E402


class NormalizeOneHandlesEdgeCases(unittest.TestCase):
    def test_none_returns_empty_string(self) -> None:
        self.assertEqual(normalize_one(None), "")

    def test_empty_string_returns_empty(self) -> None:
        self.assertEqual(normalize_one(""), "")

    def test_whitespace_only_returns_empty(self) -> None:
        self.assertEqual(normalize_one("   "), "")

    def test_bracket_prefix_stripped(self) -> None:
        self.assertEqual(normalize_one("[JIT] Yellow Onion"), "yellow onion")
        self.assertEqual(normalize_one("[NEW] Heavy Cream"), "heavy cream")

    def test_non_alphanumeric_collapsed_to_space(self) -> None:
        self.assertEqual(normalize_one("Queso-Fresco"), "queso fresco")
        self.assertEqual(normalize_one("Milk 2%"), "milk 2")

    def test_unicode_letters_treated_as_non_alnum(self) -> None:
        # "ñ" is intentionally dropped — [a-z0-9] is ASCII-only in both
        # languages. This pin is the byte-parity contract with TS.
        self.assertEqual(normalize_one("Poblano & Jalapeño"), "poblano jalape o")


class NormalizeSeriesMatchesOne(unittest.TestCase):
    def test_series_matches_scalar_on_every_fixture_row(self) -> None:
        # Drop None because pandas.Series(None) -> string 'None' after
        # .astype(str), which is *not* normalize_one(None) semantics.
        # normalize_one handles None explicitly; normalize_series is
        # documented as vectorized for non-None strings. So we compare
        # on the non-None subset.
        non_none = [v for v in INPUTS if v is not None]
        series = pd.Series(non_none)
        series_out = list(normalize_series(series))
        scalar_out = [normalize_one(v) for v in non_none]
        self.assertEqual(series_out, scalar_out)


class NormalizeOneIsIdempotent(unittest.TestCase):
    def test_every_fixture_input(self) -> None:
        for value in INPUTS:
            first = normalize_one(value)
            second = normalize_one(first)
            self.assertEqual(
                first,
                second,
                f"normalize_one not idempotent for input={value!r}: "
                f"first={first!r}, second={second!r}",
            )


class BackCompatWrapperStillWorks(unittest.TestCase):
    def test_make_join_key_delegates_to_normalize_series(self) -> None:
        non_none = [v for v in INPUTS if v is not None]
        series = pd.Series(non_none)
        wrapper_out = list(_make_join_key(series))
        direct_out = list(normalize_series(series))
        self.assertEqual(wrapper_out, direct_out)

    def test_make_join_key_raises_on_non_series(self) -> None:
        with self.assertRaises(TypeError):
            _make_join_key(["not", "a", "series"])  # type: ignore[arg-type]


class NormalizeSeriesRejectsNonSeries(unittest.TestCase):
    def test_type_error_on_list(self) -> None:
        with self.assertRaises(TypeError):
            normalize_series(["not", "a", "series"])  # type: ignore[arg-type]


class NormalizeSeriesPreservesNaN(unittest.TestCase):
    def test_series_preserves_nan_through_astype_str(self) -> None:
        """NaN / pd.NA pass through normalize_series unchanged as float NaN.

        pandas 3.x changed Series.astype(str) to preserve NaN sentinels —
        pandas 2.x would coerce them to the string 'nan' / 'na', which
        silently grouped unrelated missing-ingredient rows under a shared
        key during downstream joins. The new behavior is more correct:
        missing ingredients form unique singletons (NaN != NaN per IEEE
        754) rather than false-merging.

        Callers who need a canonical key for missing ingredients must
        pre-fill the series (e.g. ``series.fillna("")``) BEFORE calling
        ``normalize_series``. rebuild_merged_prices.py already guards
        every numeric field with ``pd.isna`` and the groupby on this
        column now treats each NaN as its own bucket — strictly better
        than the 2.x 'nan'-string false-merge.

        This test was previously NormalizeSeriesPinsNaNBehavior and pinned
        the pandas-2.x coercion; flipped to the pass-through contract
        after the pandas 3.x upgrade.
        """
        series = pd.Series(["Yellow Onion", float("nan"), pd.NA, "Heavy Cream"])
        result = list(normalize_series(series))
        self.assertEqual(result[0], "yellow onion")
        self.assertTrue(pd.isna(result[1]), f"float NaN should pass through; got {result[1]!r}")
        self.assertTrue(pd.isna(result[2]), f"pd.NA should pass through; got {result[2]!r}")
        self.assertEqual(result[3], "heavy cream")

    def test_fillna_then_normalize_produces_empty_string_key(self) -> None:
        """Documents the recommended caller pattern for missing ingredients."""
        series = pd.Series(["Yellow Onion", float("nan"), pd.NA])
        prefilled = series.fillna("")
        result = list(normalize_series(prefilled))
        self.assertEqual(result, ["yellow onion", "", ""])


if __name__ == "__main__":
    unittest.main()
