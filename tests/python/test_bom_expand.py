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
    aggregate_demand,
    aggregate_order_demand,
    build_manifest,
    expand_recipe,
    expand_recipe_demand,
    expand_recipe_orders,
    find_manifest_warnings,
)


def _mk(
    slug: str,
    name: str,
    yield_qty: float,
    yield_unit: str,
    sub_recipe_slugs: list[str] | None = None,
    bom: list[tuple] | None = None,
    allergens: list[str] | None = None,
    pack_conversions: dict | None = None,
) -> Manifest:
    """Shorthand for building a Manifest from literals. Each BOM tuple is
    (ingredient_or_sub_slug, qty, unit, is_sub_recipe[, sub_slug_pin])."""

    def _row(r: tuple) -> dict:
        ing, qty, unit, is_sub = r[0], r[1], r[2], r[3]
        return {
            "ingredient": ing,
            "qty": qty,
            "unit": unit,
            "is_sub_recipe": is_sub,
            "sub_slug": r[4] if len(r) > 4 else None,
        }

    return Manifest(
        slug=slug,
        display_name=name,
        yield_qty=yield_qty,
        yield_unit=yield_unit,
        sub_recipe_slugs=list(sub_recipe_slugs or []),
        bom=[_row(r) for r in (bom or [])],
        allergens=list(allergens or []),
        pack_conversions=dict(pack_conversions or {}),
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


class UnitConversion(unittest.TestCase):
    """Compatible units (same dimension) convert instead of failing loud."""

    def test_sub_recipe_compatible_unit_converts(self) -> None:
        # Parent references a sub-recipe in cup; the sub yields in qt.
        # 4 cup = 1 qt, so this must convert (not raise).
        aioli = _mk("chipotle_aioli", "Chipotle Aioli", 4, "qt",
                    bom=[("mayo", 3, "qt", False)])
        slaw = _mk("mexi_slaw", "Mexi Slaw", 10, "qt",
                   sub_recipe_slugs=["chipotle_aioli"],
                   bom=[("chipotle_aioli", 4, "cup", True)])
        manifest = {"chipotle_aioli": aioli, "mexi_slaw": slaw}
        # 1 batch slaw (10 qt) uses 4 cup = 1 qt aioli = 0.25 aioli batch,
        # so mayo = 3 qt * 0.25 = 0.75 qt.
        out = expand_recipe(manifest, "mexi_slaw", qty=10, unit="qt")
        self.assertAlmostEqual(out["mayo", "qt"], 0.75, places=6)

    def test_top_level_compatible_unit_converts(self) -> None:
        # Demand in gal for a recipe that yields in qt (1 gal = 4 qt).
        soup = _mk("soup", "Soup", 8, "qt", bom=[("stock", 6, "qt", False)])
        out = expand_recipe({"soup": soup}, "soup", qty=1, unit="gal")
        # 1 gal = 4 qt = half a batch → stock 6 * 0.5 = 3 qt.
        self.assertAlmostEqual(out["stock", "qt"], 3.0, places=6)

    def test_incompatible_units_still_fail_loud(self) -> None:
        # lb (weight) vs qt (volume) share no dimension → still raises.
        soup = _mk("soup", "Soup", 8, "qt", bom=[("stock", 6, "qt", False)])
        with self.assertRaises(UnitMismatchError):
            expand_recipe({"soup": soup}, "soup", qty=1, unit="lb")


class GracefulDegradation(unittest.TestCase):
    """A warnings sink degrades a bad BOM row instead of aborting."""

    def _manifest(self):
        gc = _mk("green_chile", "Green Chile", 8, "qt",
                 bom=[("pork", 10, "lb", False)])
        queso = _mk("queso_mac_sauce", "Queso", 22, "qt",
                    sub_recipe_slugs=["green_chile"],
                    bom=[("heavy cream", 3, "qt", False),
                         ("green_chile", 1, "bag", True)])
        return {"green_chile": gc, "queso_mac_sauce": queso}

    def test_incompatible_sub_row_skipped_rest_kept(self) -> None:
        # 'bag' is incompatible with qt. With a sink, skip ONLY the
        # green_chile row and still return the recipe's other leaves.
        manifest = self._manifest()
        warnings: list[str] = []
        out = expand_recipe(manifest, "queso_mac_sauce", qty=22, unit="qt",
                            warnings=warnings)
        self.assertIn(("heavy cream", "qt"), out)   # sibling row kept
        self.assertNotIn(("pork", "lb"), out)       # green_chile branch skipped
        self.assertEqual(len(warnings), 1)
        self.assertIn("green_chile", warnings[0])

    def test_aggregate_demand_skips_bad_recipe_keeps_others(self) -> None:
        manifest = self._manifest()
        manifest["churros"] = _mk("churros", "Churros", 100, "ea",
                                  bom=[("flour", 5, "lb", False)])
        warnings: list[str] = []
        totals = aggregate_demand(
            manifest,
            [("queso_mac_sauce", 22, "qt"), ("churros", 100, "ea")],
            warnings=warnings,
        )
        self.assertIn(("flour", "lb"), totals)        # clean recipe computed
        self.assertIn(("heavy cream", "qt"), totals)  # queso's good rows kept
        self.assertEqual(len(warnings), 1)

    def test_no_sink_preserves_fail_loud(self) -> None:
        with self.assertRaises(UnitMismatchError):
            expand_recipe(self._manifest(), "queso_mac_sauce", qty=22, unit="qt")


class PackSizeConversion(unittest.TestCase):
    """A child recipe may declare a `pack_size` (`<unit>:<factor>:<yield_unit>`)
    so a cross-dimension sub-recipe reference (e.g. parent refs child in 'bag',
    child yields 'qt') resolves deterministically instead of failing loud."""

    def test_pack_size_resolves_cross_dimension_boundary(self) -> None:
        # green_chile yields 6 qt; declares 1 bag = 3 qt. Queso references it
        # in 'bag' (a cross-dimension unit that never converts numerically).
        gc = _mk(
            "green_chile", "Green Chile", 6, "qt",
            bom=[("pork", 12, "lb", False)],
            pack_conversions={"bag": (3.0, "qt")},
        )
        queso = _mk(
            "queso", "Queso", 22, "qt",
            sub_recipe_slugs=["green_chile"],
            bom=[("green_chile", 1, "bag", True)],
        )
        manifest = {"green_chile": gc, "queso": queso}
        # 1 batch queso needs 1 bag = 3 qt green_chile = 0.5 batch (yields 6 qt)
        # → pork 12 lb * 0.5 = 6 lb.
        out = expand_recipe(manifest, "queso", qty=22, unit="qt")
        self.assertAlmostEqual(out["pork", "lb"], 6.0, places=6)

    def test_pack_size_recipe_node_path_also_resolves(self) -> None:
        gc = _mk(
            "green_chile", "Green Chile", 6, "qt",
            bom=[("pork", 12, "lb", False)],
            pack_conversions={"bag": (3.0, "qt")},
        )
        queso = _mk(
            "queso", "Queso", 22, "qt",
            sub_recipe_slugs=["green_chile"],
            bom=[("green_chile", 1, "bag", True)],
        )
        manifest = {"green_chile": gc, "queso": queso}
        nodes = expand_recipe_demand(manifest, [("queso", 22, "qt")])
        # green_chile node recorded at 3 qt (1 bag).
        self.assertAlmostEqual(nodes["green_chile", "qt"], 3.0, places=6)

    def test_pack_size_parsed_from_index_csv(self) -> None:
        import csv as _csv
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            idx = Path(d) / "recipe_index.csv"
            bom = Path(d) / "bom.csv"
            with idx.open("w", newline="") as f:
                w = _csv.writer(f)
                w.writerow(
                    ["recipe_id", "recipe_name", "yield", "yield_unit",
                     "sub_recipes", "notes", "pack_size"]
                )
                w.writerow(["green_chile", "Green Chile", "6", "qt", "", "", "bag:3:qt"])
            with bom.open("w", newline="") as f:
                w = _csv.writer(f)
                w.writerow(["recipe_id", "ingredient", "qty", "unit", "notes"])
                w.writerow(["green_chile", "pork", "12", "lb", ""])
            manifest = build_manifest(idx, bom)
        self.assertEqual(manifest["green_chile"].pack_conversions, {"bag": (3.0, "qt")})

    def test_unconvertible_without_pack_size_names_pack_size(self) -> None:
        # No pack declared: the fail-loud message must name pack_size + a remedy.
        gc = _mk("green_chile", "Green Chile", 6, "qt", bom=[("pork", 12, "lb", False)])
        queso = _mk(
            "queso_mac_sauce", "Queso", 22, "qt",
            sub_recipe_slugs=["green_chile"],
            bom=[("green_chile", 1, "bag", True)],
        )
        with self.assertRaises(UnitMismatchError) as cm:
            expand_recipe({"green_chile": gc, "queso_mac_sauce": queso}, "queso_mac_sauce", 22, "qt")
        msg = str(cm.exception)
        self.assertIn("pack_size", msg)
        self.assertIn("bag", msg)
        self.assertIn("green_chile", msg)


class ExplicitSubRecipePin(unittest.TestCase):
    """A BOM row's notes may carry `(sub-recipe=<slug>)` to bind a child
    deterministically when the ingredient name does not token-match the slug."""

    def test_pin_binds_child_when_name_mismatches(self) -> None:
        # 'birria seasoning' does NOT token-resolve to 'qb_seasoning'; the pin
        # binds it anyway.
        seasoning = _mk("qb_seasoning", "QB Seasoning", 4, "qt", bom=[("salt", 2, "qt", False)])
        birria = _mk(
            "birria", "Birria", 16, "qt",
            sub_recipe_slugs=["qb_seasoning"],
            bom=[("birria seasoning", 1, "qt", True, "qb_seasoning")],
        )
        out = expand_recipe({"qb_seasoning": seasoning, "birria": birria}, "birria", 16, "qt")
        # 1 qt seasoning = 0.25 batch (yields 4 qt) → salt 2 * 0.25 = 0.5 qt.
        self.assertAlmostEqual(out["salt", "qt"], 0.5, places=6)

    def test_pin_parsed_from_notes_marker(self) -> None:
        import csv as _csv
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            idx = Path(d) / "recipe_index.csv"
            bom = Path(d) / "bom.csv"
            with idx.open("w", newline="") as f:
                w = _csv.writer(f)
                w.writerow(["recipe_id", "recipe_name", "yield", "yield_unit", "sub_recipes", "notes"])
                w.writerow(["qb_seasoning", "QB Seasoning", "4", "qt", "", ""])
                w.writerow(["birria", "Birria", "16", "qt", "qb_seasoning", ""])
            with bom.open("w", newline="") as f:
                w = _csv.writer(f)
                w.writerow(["recipe_id", "ingredient", "qty", "unit", "notes"])
                w.writerow(["qb_seasoning", "salt", "2", "qt", ""])
                w.writerow(["birria", "birria seasoning", "1", "qt", "(sub-recipe=qb_seasoning)"])
            manifest = build_manifest(idx, bom)
        row = manifest["birria"].bom[0]
        self.assertEqual(row["sub_slug"], "qb_seasoning")
        self.assertTrue(row["is_sub_recipe"])

    def test_pin_to_unknown_slug_raises(self) -> None:
        birria = _mk(
            "birria", "Birria", 16, "qt",
            bom=[("birria seasoning", 1, "qt", True, "does_not_exist")],
        )
        with self.assertRaises(UnknownRecipeError):
            expand_recipe({"birria": birria}, "birria", 16, "qt")


class ManifestWarnings(unittest.TestCase):
    """`find_manifest_warnings` surfaces a declared sub_recipe that no BOM row
    references (pin or name) — an orphan declaration that would silently never
    be produced."""

    def test_unreferenced_declared_sub_is_warned(self) -> None:
        # beer_batter DECLARES beer_flour as a sub but no BOM row references it.
        flour = _mk("beer_flour", "Beer Flour", 4, "qt", bom=[("flour", 2, "qt", False)])
        batter = _mk(
            "beer_batter", "Beer Batter", 8, "qt",
            sub_recipe_slugs=["beer_flour"],
            bom=[("water", 3, "qt", False)],
        )
        warns = {(w["recipe"], w["sub_slug"]) for w in find_manifest_warnings({"beer_flour": flour, "beer_batter": batter})}
        self.assertIn(("beer_batter", "beer_flour"), warns)

    def test_referenced_sub_is_not_warned(self) -> None:
        flour = _mk("beer_flour", "Beer Flour", 4, "qt", bom=[("flour", 2, "qt", False)])
        batter = _mk(
            "beer_batter", "Beer Batter", 8, "qt",
            sub_recipe_slugs=["beer_flour"],
            bom=[("beer_flour", 1, "qt", True)],
        )
        warns = {(w["recipe"], w["sub_slug"]) for w in find_manifest_warnings({"beer_flour": flour, "beer_batter": batter})}
        self.assertNotIn(("beer_batter", "beer_flour"), warns)

    def test_pinned_sub_is_not_warned(self) -> None:
        seasoning = _mk("qb_seasoning", "QB Seasoning", 4, "qt", bom=[("salt", 2, "qt", False)])
        birria = _mk(
            "birria", "Birria", 16, "qt",
            sub_recipe_slugs=["qb_seasoning"],
            bom=[("birria seasoning", 1, "qt", True, "qb_seasoning")],
        )
        warns = {(w["recipe"], w["sub_slug"]) for w in find_manifest_warnings({"qb_seasoning": seasoning, "birria": birria})}
        self.assertNotIn(("birria", "qb_seasoning"), warns)


class BatchOrdering(unittest.TestCase):
    """Whole-batch ordering for banquets — docs/superpowers/specs/2026-07-28.

    A kitchen orders and preps in batches. The cascade used to hand back a
    fraction nobody can make, or — where a mapping carried no per_count — a
    whole batch multiplied by the piece count.
    """

    def _man(self):
        # slaw: no subs, 12 qt a batch. rub: 2 cup a batch, needs 1 cup of
        # base. oil: 2 qt a batch, also needs base. base is therefore shared
        # by two parents, which is the case that breaks naive rounding.
        return {
            "slaw": _mk("slaw", "Slaw", 12, "qt", bom=[("cabbage", 8, "qt", False)]),
            "base": _mk("base", "Base Rub", 4, "cup", bom=[("paprika", 2, "cup", False)]),
            "rub": _mk("rub", "Hot Rub", 2, "cup",
                       sub_recipe_slugs=["base"],
                       bom=[("base", 1, "cup", True)]),
            "oil": _mk("oil", "Hot Oil", 2, "qt",
                       sub_recipe_slugs=["base"],
                       bom=[("base", 0.5, "cup", True)]),
        }

    def test_rounds_a_part_batch_up_to_one(self):
        # 3.12 qt of a 12 qt batch is a quarter batch; you still make one.
        out = expand_recipe_orders(self._man(), [("slaw", 3.12, "qt")])
        self.assertAlmostEqual(out[("slaw", "qt")], 12.0)

    def test_rounds_up_to_whole_batches_above_one(self):
        out = expand_recipe_orders(self._man(), [("slaw", 30.0, "qt")])
        self.assertAlmostEqual(out[("slaw", "qt")], 36.0)  # 2.5 -> 3 batches

    def test_an_exact_batch_is_not_rounded_up(self):
        out = expand_recipe_orders(self._man(), [("slaw", 12.0, "qt")])
        self.assertAlmostEqual(out[("slaw", "qt")], 12.0)

    def test_half_batch_granularity_for_prep(self):
        # Prep can make a half batch, so a quarter batch rounds to a half...
        out = expand_recipe_orders(self._man(), [("slaw", 3.12, "qt")], granularity=0.5)
        self.assertAlmostEqual(out[("slaw", "qt")], 6.0)
        # ...but 0.78 of a batch rounds UP to a full one, never down to 0.5,
        # which would make less than the event eats.
        out = expand_recipe_orders(self._man(), [("slaw", 9.4, "qt")], granularity=0.5)
        self.assertAlmostEqual(out[("slaw", "qt")], 12.0)

    def test_a_sub_recipe_derives_from_its_parents_rounded_figure(self):
        # One rub batch needs 1 cup of base; base is a 4 cup batch, so the
        # rounded parent still only needs a quarter batch -> one batch.
        out = expand_recipe_orders(self._man(), [("rub", 0.5, "cup")])
        self.assertAlmostEqual(out[("rub", "cup")], 2.0)
        self.assertAlmostEqual(out[("base", "cup")], 4.0)

    def test_a_shared_sub_recipe_is_summed_before_it_is_rounded(self):
        # THE case. rub and oil each pull base. Rounding per branch would
        # order two batches of base; their combined 1.5 cup fits in one.
        out = expand_recipe_orders(
            self._man(), [("rub", 0.5, "cup"), ("oil", 0.5, "qt")]
        )
        self.assertAlmostEqual(out[("base", "cup")], 4.0, msg="should be ONE batch of base")

    def test_consumption_is_left_alone(self):
        # expand_recipe_demand answers a different question and must stay
        # linear — it is what a food-cost number is built from.
        out = expand_recipe_demand(self._man(), [("slaw", 3.12, "qt")])
        self.assertAlmostEqual(out[("slaw", "qt")], 3.12)

    def test_a_batch_is_never_multiplied_by_a_piece_count(self):
        # 50 sliders each needing a trace of a 4 cup bin is one bin, not 50.
        out = expand_recipe_orders(self._man(), [("base", 0.02, "cup")] * 50)
        self.assertAlmostEqual(out[("base", "cup")], 4.0)

    def test_a_mapping_that_consumes_nothing_makes_no_batch(self):
        # A map row of per_count 0 says the item is on the menu but eats none
        # of this recipe. The floor-at-one turned that into a whole 12 qt batch
        # of slaw nobody serves — an order for food the event never eats.
        out = expand_recipe_orders(self._man(), [("slaw", 0.0, "qt")])
        self.assertAlmostEqual(out[("slaw", "qt")], 0.0)

    def test_a_trace_is_still_a_whole_batch(self):
        # The floor is for fractions, not for zero. 0.01 qt is real demand and
        # you cannot make less than a batch to cover it, so this must NOT move.
        out = expand_recipe_orders(self._man(), [("slaw", 0.01, "qt")])
        self.assertAlmostEqual(out[("slaw", "qt")], 12.0)

    def test_a_sub_recipe_of_a_zero_parent_is_not_made(self):
        # The rub eats nothing, so the base it pulls from is not made either —
        # zero has to cascade, or the sub-recipe is prepped for no parent.
        out = expand_recipe_orders(self._man(), [("rub", 0.0, "cup")])
        self.assertAlmostEqual(out[("base", "cup")], 0.0)


class BatchOrderingGraphGuards(unittest.TestCase):
    """The order walk must degrade exactly where the linear walk degrades.

    `_discover_order_graph` records a sub-recipe edge BEFORE it recurses, and
    the recursion can bail out (cycle, non-positive yield) without ever giving
    that child an `edges` entry. The Kahn settle then enqueued a node it had no
    edge list for. `aggregate_demand` degrades to a warning in all these cases;
    the order walk must not be the one path that takes the whole event down.
    """

    def _parent_with_bad_sub(self, sub_yield):
        # p is fine: 4 qt a batch, 2 lb of flour, plus a cup of sub `z`.
        return {
            "p": _mk("p", "Parent", 4, "qt",
                     sub_recipe_slugs=["z"],
                     bom=[("flour", 2, "lb", False), ("z", 1, "cup", True, "z")]),
            "z": _mk("z", "Bad Sub", sub_yield, "cup",
                     bom=[("salt", 1, "tsp", False)]),
        }

    def test_a_zero_yield_sub_degrades_instead_of_dividing_by_zero(self):
        man = self._parent_with_bad_sub(0)
        warns = []
        out = expand_recipe_orders(man, [("p", 1.0, "qt")], 1.0, warnings=warns)
        self.assertAlmostEqual(out[("p", "qt")], 4.0)
        self.assertNotIn(("z", "cup"), out)
        self.assertTrue(any("'z'" in w for w in warns), warns)

    def test_a_negative_yield_sub_degrades_instead_of_keyerror(self):
        man = self._parent_with_bad_sub(-2)
        warns = []
        out = expand_recipe_orders(man, [("p", 1.0, "qt")], 1.0, warnings=warns)
        self.assertAlmostEqual(out[("p", "qt")], 4.0)
        self.assertNotIn(("z", "cup"), out)
        self.assertTrue(any("'z'" in w for w in warns), warns)

    def test_a_dropped_sub_does_not_drop_its_parent(self):
        # The parent still settles and still contributes, mirroring how
        # aggregate_demand keeps the parent's own leaves.
        for sub_yield in (0, -2):
            with self.subTest(sub_yield=sub_yield):
                man = self._parent_with_bad_sub(sub_yield)
                warns = []
                out = expand_recipe_orders(man, [("p", 0.5, "qt")], 1.0, warnings=warns)
                self.assertAlmostEqual(out[("p", "qt")], 4.0)

    def test_a_cycle_omits_only_its_own_component(self):
        # a <-> b cycle; x is independent and must still settle.
        man = {
            "a": _mk("a", "A", 4, "qt", sub_recipe_slugs=["b"],
                     bom=[("b", 1, "qt", True, "b")]),
            "b": _mk("b", "B", 4, "qt", sub_recipe_slugs=["a"],
                     bom=[("a", 1, "qt", True, "a")]),
            "x": _mk("x", "X", 4, "qt", bom=[("sugar", 1, "cup", False)]),
        }
        warns = []
        out = expand_recipe_orders(man, [("a", 4.0, "qt"), ("x", 4.0, "qt")], 1.0, warnings=warns)
        self.assertAlmostEqual(out[("x", "qt")], 4.0)
        self.assertTrue(any("cycle" in w for w in warns), warns)

    def test_an_unsettled_node_is_reported_not_silently_dropped(self):
        # The cycle members vanish from the board. Dropping them quietly means
        # a prep sheet that is short with no signal — say so.
        man = {
            "a": _mk("a", "A", 4, "qt", sub_recipe_slugs=["b"],
                     bom=[("b", 1, "qt", True, "b")]),
            "b": _mk("b", "B", 4, "qt", sub_recipe_slugs=["a"],
                     bom=[("a", 1, "qt", True, "a")]),
        }
        warns = []
        out = expand_recipe_orders(man, [("a", 4.0, "qt")], 1.0, warnings=warns)
        self.assertNotIn(("a", "qt"), out)
        self.assertTrue(
            any("could not be settled" in w and "'a'" in w for w in warns), warns
        )

    def test_a_bad_sub_still_fails_loud_without_a_warnings_sink(self):
        man = self._parent_with_bad_sub(0)
        with self.assertRaises(ValueError):
            expand_recipe_orders(man, [("p", 1.0, "qt")], 1.0)

class BatchFloorScope(unittest.TestCase):
    """The floor is for things you make in batches, not things you count.

    Owner's call: spices, flour, brines and sauces are the target — standard
    service prep that gets used up outside the event even if you over-make it.
    A recipe yielding in `ea` or `case` is not a batch you mix; flooring one
    orders a 60-piece batch to serve 20, or a full case of churros for four.
    """

    def test_a_volume_yield_floors_to_a_whole_batch(self):
        man = {"slaw": _mk("slaw", "Slaw", 12, "qt", bom=[("cabbage", 8, "qt", False)])}
        out = expand_recipe_orders(man, [("slaw", 3.12, "qt")])
        self.assertAlmostEqual(out[("slaw", "qt")], 12.0)

    def test_a_weight_yield_floors_to_a_whole_batch(self):
        man = {"slaw": _mk("slaw", "Mexi Slaw", 5, "lb", bom=[("cabbage", 4, "lb", False)])}
        out = expand_recipe_orders(man, [("slaw", 1.0, "lb")])
        self.assertAlmostEqual(out[("slaw", "lb")], 5.0)

    def test_a_piece_yield_is_left_alone(self):
        # 20 of a 60-piece batch is 20 pieces. You fry what you serve.
        man = {"balls": _mk("balls", "Mac Balls", 60, "ea", bom=[("mac", 2, "qt", False)])}
        out = expand_recipe_orders(man, [("balls", 20.0, "ea")])
        self.assertAlmostEqual(out[("balls", "ea")], 20.0)

    def test_a_case_yield_is_left_alone(self):
        man = {"churros": _mk("churros", "Churros", 1, "case", bom=[("churro", 60, "ea", False)])}
        out = expand_recipe_orders(man, [("churros", 0.0667, "case")])
        self.assertAlmostEqual(out[("churros", "case")], 0.0667, places=4)

    def test_a_hotel_pan_yield_is_left_alone(self):
        man = {"ziti": _mk("ziti", "Baked Ziti", 4, "hotel pan", bom=[("pasta", 5, "lb", False)])}
        out = expand_recipe_orders(man, [("ziti", 1.0, "hotel pan")])
        self.assertAlmostEqual(out[("ziti", "hotel pan")], 1.0)

    def test_a_counted_parent_still_floors_its_measurable_sub(self):
        # The parent passes its raw figure down; the sub is a real batch and
        # floors on its own account.
        man = {
            "balls": _mk("balls", "Mac Balls", 60, "ea",
                         sub_recipe_slugs=["queso"],
                         bom=[("queso", 1, "qt", True, "queso")]),
            "queso": _mk("queso", "Queso", 22, "qt", bom=[("cheese", 20, "lb", False)]),
        }
        out = expand_recipe_orders(man, [("balls", 20.0, "ea")])
        self.assertAlmostEqual(out[("balls", "ea")], 20.0)
        self.assertAlmostEqual(out[("queso", "qt")], 22.0)

    def test_a_measurable_parent_passes_a_floored_figure_to_a_counted_sub(self):
        man = {
            "platter": _mk("platter", "Platter", 4, "qt",
                           sub_recipe_slugs=["skewer"],
                           bom=[("skewer", 10, "ea", True, "skewer")]),
            "skewer": _mk("skewer", "Caprese Skewer", 50, "ea", bom=[("mozz", 2, "lb", False)]),
        }
        out = expand_recipe_orders(man, [("platter", 1.0, "qt")])
        self.assertAlmostEqual(out[("platter", "qt")], 4.0)   # floored to one batch
        self.assertAlmostEqual(out[("skewer", "ea")], 10.0)   # derived, not floored

    def test_prep_granularity_also_respects_the_scope(self):
        man = {"balls": _mk("balls", "Mac Balls", 60, "ea", bom=[("mac", 2, "qt", False)])}
        out = expand_recipe_orders(man, [("balls", 20.0, "ea")], granularity=0.5)
        self.assertAlmostEqual(out[("balls", "ea")], 20.0)


class FlooredLeafDemand(unittest.TestCase):
    """Leaf ingredients for the batches you will actually make.

    aggregate_demand answers "what does the event eat". This answers "what do
    the batches need" — the basis the order guide buys packs against, so the
    guide can never be short of what the prep board says to make.
    """

    def _man(self):
        # slaw: 12 qt a batch, 10 qt cabbage in it — the real coleslaw shape.
        # rub and oil both pull from base, so base is shared by two parents.
        return {
            "slaw": _mk("slaw", "Coleslaw", 12, "qt",
                        bom=[("green cabbage", 10, "qt", False),
                             ("mayonnaise", 6, "cup", False)]),
            "base": _mk("base", "Lariat Rub", 4, "cup", bom=[("paprika", 2, "cup", False)]),
            "rub": _mk("rub", "Hot Rub", 2, "cup",
                       sub_recipe_slugs=["base"],
                       bom=[("base", 1, "cup", True, "base"), ("cayenne", 1, "cup", False)]),
            "oil": _mk("oil", "Hot Oil", 2, "qt",
                       sub_recipe_slugs=["base"],
                       bom=[("base", 0.5, "cup", True, "base")]),
        }

    def test_a_part_batch_buys_a_whole_batch_of_each_leaf(self):
        # The event eats 3.12 qt of a 12 qt batch. You make the batch, so you
        # buy the cabbage for the batch: 10 qt, not 2.6.
        out = aggregate_order_demand(self._man(), [("slaw", 3.12, "qt")])
        self.assertAlmostEqual(out[("green cabbage", "qt")], 10.0)
        self.assertAlmostEqual(out[("mayonnaise", "cup")], 6.0)

    def test_it_never_drops_below_one_batch_of_leaves(self):
        out = aggregate_order_demand(self._man(), [("slaw", 0.01, "qt")])
        self.assertAlmostEqual(out[("green cabbage", "qt")], 10.0)

    def test_a_mapping_that_consumes_nothing_buys_nothing(self):
        # per_count 0 — the event eats no slaw, so it buys no cabbage. Asserted
        # on the quantity, not the key, because whether a zero row is dropped
        # from the guide entirely is a separate call about the board.
        out = aggregate_order_demand(self._man(), [("slaw", 0.0, "qt")])
        self.assertAlmostEqual(out.get(("green cabbage", "qt"), 0.0), 0.0)

    def test_two_batches_buy_two_batches_of_leaves(self):
        out = aggregate_order_demand(self._man(), [("slaw", 13.0, "qt")])
        self.assertAlmostEqual(out[("green cabbage", "qt")], 20.0)

    def test_a_shared_sub_recipes_leaves_are_bought_once(self):
        # rub needs 1 cup of base, oil needs 0.5 — 1.5 cup total, which is one
        # 4 cup batch, which is 2 cup of paprika. Rounding each branch on its
        # own would buy two batches and 4 cup.
        out = aggregate_order_demand(self._man(), [("rub", 0.5, "cup"), ("oil", 0.5, "qt")])
        self.assertAlmostEqual(out[("paprika", "cup")], 2.0)

    def test_a_sub_recipe_row_is_not_also_bought_as_a_leaf(self):
        # `base` is a settled node contributing its own paprika. Counting the
        # parent's "1 cup base" row as an ingredient too would double-order.
        out = aggregate_order_demand(self._man(), [("rub", 0.5, "cup")])
        self.assertNotIn(("base", "cup"), out)

    def test_leaf_units_are_not_converted(self):
        # Matches _expand_into: the row's own unit is the key. A guide that
        # silently re-expressed cup as qt would not match the vendor pack.
        out = aggregate_order_demand(self._man(), [("slaw", 1.0, "qt")])
        self.assertIn(("mayonnaise", "cup"), out)
        self.assertNotIn(("mayonnaise", "qt"), out)

    def test_consumption_is_left_alone(self):
        # The linear channel is the food-cost figure and must not move.
        out = aggregate_demand(self._man(), [("slaw", 3.12, "qt")])
        self.assertAlmostEqual(out[("green cabbage", "qt")], 2.6, places=2)

    def test_a_counted_yield_buys_only_what_it_eats(self):
        # Same scope as the prep board: 20 of a 60-piece batch is 20 pieces,
        # so a third of the batch's leaves.
        man = {"balls": _mk("balls", "Mac Balls", 60, "ea", bom=[("mac", 3, "qt", False)])}
        out = aggregate_order_demand(man, [("balls", 20.0, "ea")])
        self.assertAlmostEqual(out[("mac", "qt")], 1.0)

    def test_a_dropped_recipe_degrades_to_a_warning(self):
        man = {
            "p": _mk("p", "Parent", 4, "qt",
                     sub_recipe_slugs=["z"],
                     bom=[("flour", 2, "lb", False), ("z", 1, "cup", True, "z")]),
            "z": _mk("z", "Bad Sub", 0, "cup", bom=[("salt", 1, "tsp", False)]),
        }
        warns = []
        out = aggregate_order_demand(man, [("p", 1.0, "qt")], 1.0, warnings=warns)
        self.assertAlmostEqual(out[("flour", "lb")], 2.0)
        self.assertNotIn(("salt", "tsp"), out)
        self.assertTrue(any("'z'" in w for w in warns), warns)

    def test_it_still_fails_loud_without_a_warnings_sink(self):
        with self.assertRaises(UnknownRecipeError):
            aggregate_order_demand(self._man(), [("nope", 1.0, "qt")])

    def test_prep_granularity_buys_for_a_half_batch(self):
        out = aggregate_order_demand(self._man(), [("slaw", 3.12, "qt")], granularity=0.5)
        self.assertAlmostEqual(out[("green cabbage", "qt")], 5.0)


if __name__ == "__main__":
    unittest.main()
