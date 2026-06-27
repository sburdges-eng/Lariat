"""Unit tests for scripts.lib.bom_expand.

Runs against synthetic recipe + BOM rows so the test doesn't drift when
actual costing CSVs change. The "queso uses blackened salsa" case is the
headline: when a prep list needs both queso AND blackened_tomato_salsa
on their own, salsa demand must be SUMMED, not reported as two separate
lines.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

# Allow running as `python3 -m unittest tests.python.test_bom_expand`
# from the project root without install.
ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.bom_expand import (  # noqa: E402
    Manifest,
    RecipeCycleError,
    UnitMismatchError,
    UnknownRecipeError,
    _convert,
    aggregate_demand,
    build_manifest,
    build_manifest_from_normalized,
    expand_recipe,
    expand_recipe_demand,
)

REAL_INDEX = ROOT / "recipes" / "recipe_index.csv"
REAL_NORMALIZED = ROOT / "recipes" / "normalized"


def _mk(
    slug: str,
    name: str,
    yield_qty: float,
    yield_unit: str,
    sub_recipe_slugs: list[str] | None = None,
    bom: list[tuple[str, float, str, bool]] | None = None,
    allergens: list[str] | None = None,
) -> Manifest:
    """Shorthand for building a Manifest from literals. Each BOM tuple is
    (ingredient_or_sub_slug, qty, unit, is_sub_recipe)."""
    return Manifest(
        slug=slug,
        display_name=name,
        yield_qty=yield_qty,
        yield_unit=yield_unit,
        sub_recipe_slugs=list(sub_recipe_slugs or []),
        bom=[
            {"ingredient": ing, "qty": qty, "unit": unit, "is_sub_recipe": is_sub}
            for (ing, qty, unit, is_sub) in (bom or [])
        ],
        allergens=list(allergens or []),
    )


class ExpandLeafOnly(unittest.TestCase):
    def test_single_leaf_recipe_scales_linearly(self) -> None:
        salsa = _mk(
            "blackened_tomato_salsa",
            "Blackened Tomato Salsa",
            20,
            "qt",
            bom=[
                ("roma tomatoes", 11339.8, "g", False),
                ("lime juice", 118.294, "ml", False),
            ],
            allergens=[],
        )
        manifest = {"blackened_tomato_salsa": salsa}
        out = expand_recipe(manifest, "blackened_tomato_salsa", qty=10, unit="qt")
        # 10 qt is half a batch.
        self.assertAlmostEqual(out["roma tomatoes", "g"], 5669.9, places=3)
        self.assertAlmostEqual(out["lime juice", "ml"], 59.147, places=3)


class ExpandWithSubRecipe(unittest.TestCase):
    def setUp(self) -> None:
        self.salsa = _mk(
            "blackened_tomato_salsa",
            "Blackened Tomato Salsa",
            20,
            "qt",
            bom=[
                ("roma tomatoes", 11339.8, "g", False),
                ("cilantro", 2.0, "cup", False),
            ],
        )
        self.queso = _mk(
            "queso_mac_sauce",
            "Queso / Mac Sauce",
            22,
            "qt",
            sub_recipe_slugs=["blackened_tomato_salsa"],
            bom=[
                ("whole milk", 7570.82, "ml", False),
                ("blackened_tomato_salsa", 2.0, "qt", True),
            ],
        )
        self.manifest = {
            "blackened_tomato_salsa": self.salsa,
            "queso_mac_sauce": self.queso,
        }

    def test_queso_expansion_pulls_salsa_leaves(self) -> None:
        # One full queso batch (22 qt) consumes 2 qt of salsa.
        # 2 qt salsa is 2/20 = 0.1 of a salsa batch.
        out = expand_recipe(self.manifest, "queso_mac_sauce", qty=22, unit="qt")
        self.assertAlmostEqual(out["whole milk", "ml"], 7570.82, places=3)
        self.assertAlmostEqual(out["roma tomatoes", "g"], 1133.98, places=3)
        self.assertAlmostEqual(out["cilantro", "cup"], 0.2, places=6)
        self.assertNotIn(("blackened_tomato_salsa", "qt"), out)

    def test_queso_plus_standalone_salsa_aggregates(self) -> None:
        """The headline case: when the kitchen needs queso AND salsa both,
        total salsa demand is queso-embedded + standalone, summed."""
        demand = [
            ("queso_mac_sauce", 22, "qt"),  # uses 2 qt of salsa internally
            ("blackened_tomato_salsa", 4, "qt"),  # 4 qt of salsa on its own
        ]
        out = aggregate_demand(self.manifest, demand)
        # Total salsa demand = 2 qt (from queso) + 4 qt (standalone) = 6 qt
        # 6/20 = 0.3 of a salsa batch.
        self.assertAlmostEqual(out["roma tomatoes", "g"], 11339.8 * 0.3, places=3)
        self.assertAlmostEqual(out["cilantro", "cup"], 2.0 * 0.3, places=6)
        # And queso's direct leaf still present, only from the queso demand.
        self.assertAlmostEqual(out["whole milk", "ml"], 7570.82, places=3)


class Errors(unittest.TestCase):
    def test_unknown_recipe_fails_loud(self) -> None:
        with self.assertRaises(UnknownRecipeError):
            expand_recipe({}, "no_such_recipe", qty=1, unit="qt")

    def test_cycle_detected(self) -> None:
        a = _mk("a", "A", 10, "qt",
                sub_recipe_slugs=["b"],
                bom=[("b", 1, "qt", True)])
        b = _mk("b", "B", 10, "qt",
                sub_recipe_slugs=["a"],
                bom=[("a", 1, "qt", True)])
        manifest = {"a": a, "b": b}
        with self.assertRaises(RecipeCycleError) as cm:
            expand_recipe(manifest, "a", qty=5, unit="qt")
        self.assertIn("a", str(cm.exception))
        self.assertIn("b", str(cm.exception))

    def test_unit_mismatch_top_level(self) -> None:
        salsa = _mk(
            "blackened_tomato_salsa",
            "Blackened Tomato Salsa",
            20,
            "qt",
            bom=[("roma tomatoes", 11339.8, "g", False)],
        )
        with self.assertRaises(UnitMismatchError):
            expand_recipe({"blackened_tomato_salsa": salsa}, "blackened_tomato_salsa", qty=1, unit="lb")

    def test_sub_recipe_unit_mismatch_fails_loud(self) -> None:
        """Parent BOM says '1 bag' but child yields in qt. Without a pack
        table we refuse to guess — the error names both slugs."""
        salsa = _mk(
            "blackened_tomato_salsa", "Blackened Tomato Salsa", 20, "qt",
            bom=[("roma tomatoes", 100, "g", False)],
        )
        queso = _mk(
            "queso_mac_sauce", "Queso", 22, "qt",
            sub_recipe_slugs=["blackened_tomato_salsa"],
            bom=[("blackened_tomato_salsa", 1, "bag", True)],
        )
        manifest = {"blackened_tomato_salsa": salsa, "queso_mac_sauce": queso}
        with self.assertRaises(UnitMismatchError) as cm:
            expand_recipe(manifest, "queso_mac_sauce", qty=22, unit="qt")
        msg = str(cm.exception)
        self.assertIn("queso_mac_sauce", msg)
        self.assertIn("blackened_tomato_salsa", msg)
        self.assertIn("bag", msg)


class ExpandRecipeDemand(unittest.TestCase):
    """Tests for expand_recipe_demand — per-recipe-node aggregated demand."""

    def setUp(self) -> None:
        self.salsa = _mk(
            "blackened_tomato_salsa",
            "Blackened Tomato Salsa",
            20,
            "qt",
            bom=[
                ("roma tomatoes", 11339.8, "g", False),
                ("cilantro", 2.0, "cup", False),
            ],
        )
        self.queso = _mk(
            "queso_mac_sauce",
            "Queso / Mac Sauce",
            22,
            "qt",
            sub_recipe_slugs=["blackened_tomato_salsa"],
            bom=[
                ("whole milk", 7570.82, "ml", False),
                ("blackened_tomato_salsa", 2.0, "qt", True),
            ],
        )
        self.manifest = {
            "blackened_tomato_salsa": self.salsa,
            "queso_mac_sauce": self.queso,
        }

    def test_leaf_only_recipe_returns_single_node(self) -> None:
        """A recipe with no sub-recipes: result has exactly one entry — the
        recipe itself — with the demanded qty. No leaf ingredients."""
        out = expand_recipe_demand(
            self.manifest,
            [("blackened_tomato_salsa", 10, "qt")],
        )
        self.assertEqual(len(out), 1)
        self.assertAlmostEqual(out[("blackened_tomato_salsa", "qt")], 10.0)

    def test_parent_and_sub_recipe_both_recorded(self) -> None:
        """A recipe with a sub-recipe: both parent and sub-recipe node appear,
        with the sub-recipe scaled correctly."""
        # queso batch = 22 qt; BOM has 2 qt salsa → scale = 22/22 = 1.0
        out = expand_recipe_demand(
            self.manifest,
            [("queso_mac_sauce", 22, "qt")],
        )
        # Parent recorded at demanded qty
        self.assertAlmostEqual(out[("queso_mac_sauce", "qt")], 22.0)
        # Sub-recipe: 2 qt salsa per 22 qt batch × scale(1.0) = 2.0 qt
        self.assertAlmostEqual(out[("blackened_tomato_salsa", "qt")], 2.0)
        # Leaf ingredients must NOT appear
        self.assertNotIn(("roma tomatoes", "g"), out)
        self.assertNotIn(("whole milk", "ml"), out)

    def test_sub_recipe_scaled_for_half_batch(self) -> None:
        """11 qt queso is half a batch (22 qt yield). Sub-recipe salsa demand
        should be half of 2 qt = 1 qt."""
        out = expand_recipe_demand(
            self.manifest,
            [("queso_mac_sauce", 11, "qt")],
        )
        self.assertAlmostEqual(out[("queso_mac_sauce", "qt")], 11.0)
        self.assertAlmostEqual(out[("blackened_tomato_salsa", "qt")], 1.0)

    def test_two_demands_sharing_sub_recipe_compound(self) -> None:
        """Two top-level demands both referencing salsa (one via queso, one
        standalone) must sum the sub-recipe qty, not overwrite."""
        demands = [
            ("queso_mac_sauce", 22, "qt"),   # contributes 2 qt salsa
            ("blackened_tomato_salsa", 4, "qt"),  # contributes 4 qt salsa
        ]
        out = expand_recipe_demand(self.manifest, demands)
        # queso node at 22 qt
        self.assertAlmostEqual(out[("queso_mac_sauce", "qt")], 22.0)
        # salsa: 2 (from queso) + 4 (standalone) = 6 qt
        self.assertAlmostEqual(out[("blackened_tomato_salsa", "qt")], 6.0)

    def test_unknown_slug_raises(self) -> None:
        with self.assertRaises(UnknownRecipeError):
            expand_recipe_demand(self.manifest, [("no_such_recipe", 1, "qt")])

    def test_unit_mismatch_raises(self) -> None:
        with self.assertRaises(UnitMismatchError):
            expand_recipe_demand(
                self.manifest,
                [("blackened_tomato_salsa", 1, "lb")],
            )

    def test_cycle_raises(self) -> None:
        a = _mk("a", "A", 10, "qt",
                sub_recipe_slugs=["b"],
                bom=[("b", 1, "qt", True)])
        b = _mk("b", "B", 10, "qt",
                sub_recipe_slugs=["a"],
                bom=[("a", 1, "qt", True)])
        manifest = {"a": a, "b": b}
        with self.assertRaises(RecipeCycleError):
            expand_recipe_demand(manifest, [("a", 5, "qt")])


class ManifestFromCsvs(unittest.TestCase):
    """Round-trip tests against real recipe_index + BOM CSVs. These guard
    against silent schema drift in the costing CSVs AND pin the current
    known data-integrity gaps so they can't be silently "fixed" by
    weakening the expander."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.recipe_csv = ROOT / "recipes" / "recipe_index.csv"
        cls.boms = sorted((ROOT / "costing").glob("bom_*.csv"))
        if not cls.recipe_csv.exists() or not cls.boms:
            raise unittest.SkipTest("recipe_index or BOM CSVs not present")
        cls.manifest = build_manifest(cls.recipe_csv, cls.boms[-1])

    def test_manifest_loads_and_declares_subs(self) -> None:
        queso = self.manifest.get("queso_mac_sauce")
        self.assertIsNotNone(queso, "queso_mac_sauce missing from manifest")
        self.assertIn("blackened_tomato_salsa", queso.sub_recipe_slugs)
        salsa = self.manifest.get("blackened_tomato_salsa")
        self.assertIsNotNone(salsa)
        self.assertEqual(salsa.yield_unit, "qt")

    def test_salsa_standalone_expansion_runs(self) -> None:
        out = expand_recipe(self.manifest, "blackened_tomato_salsa", qty=4, unit="qt")
        self.assertTrue(out, "salsa expansion produced zero leaves")

    def test_queso_bom_has_known_unit_mismatch(self) -> None:
        """CANARY: queso's BOM references `green_chile` in 'bag', but
        green_chile yields in 'qt'. Until the BOM is corrected (or a
        pack→yield-unit conversion table is added), expansion must raise.
        This test FAILING means either the data was fixed (update the
        test) or the expander started silently coercing (do NOT accept)."""
        with self.assertRaises(UnitMismatchError) as cm:
            expand_recipe(self.manifest, "queso_mac_sauce", qty=4, unit="qt")
        msg = str(cm.exception)
        self.assertIn("queso_mac_sauce", msg)
        self.assertIn("green_chile", msg)
        self.assertIn("bag", msg)


class ConvertUnit(unittest.TestCase):
    def test_convert_volume_exact(self) -> None:
        assert _convert(2, "cup", "qt") == 0.5      # 4 cup = 1 qt
        assert _convert(1, "gal", "qt") == 4.0

    def test_convert_mass_exact(self) -> None:
        assert _convert(1000, "g", "kg") == 1.0
        assert _convert(16, "oz", "lb") == 1.0

    def test_convert_same_unit_passthrough(self) -> None:
        assert _convert(3, "qt", "qt") == 3.0

    def test_convert_cross_dimension_is_none(self) -> None:
        assert _convert(5, "g", "cup") is None       # mass↔volume not convertible
        assert _convert(1, "bag", "qt") is None       # non-dimensional unit


class RealDataMexiSlaw(unittest.TestCase):
    """Real-data test: mexi_slaw sub-recipe boundary (cup→qt) must convert."""

    @classmethod
    def setUpClass(cls) -> None:
        if not REAL_INDEX.exists() or not REAL_NORMALIZED.exists():
            raise unittest.SkipTest("Real recipe data not present")
        cls.manifest = build_manifest_from_normalized(REAL_INDEX, REAL_NORMALIZED)

    def test_mexi_slaw_sub_recipe_unit_now_converts(self) -> None:
        manifest = self.manifest
        leaves = expand_recipe(
            manifest,
            "mexi_slaw",
            manifest["mexi_slaw"].yield_qty,
            manifest["mexi_slaw"].yield_unit,
        )
        assert leaves, "mexi_slaw must expand without UnitMismatchError"


if __name__ == "__main__":
    unittest.main()
