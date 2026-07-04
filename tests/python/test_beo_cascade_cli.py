"""Tests for scripts/beo_cascade_cli.py — JSON-in/JSON-out BEO cascade CLI.

Unit tests use inline fixtures (following test_beo_pull.py style).
Integration test runs the CLI as a subprocess against real repo data.
"""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.bom_expand import Manifest  # noqa: E402
from scripts.lib.beo_pull import Unmapped  # noqa: E402


# ---------------------------------------------------------------------------
# Inline fixtures
# ---------------------------------------------------------------------------

def _salsa() -> Manifest:
    return Manifest(
        slug="salsa_roja",
        display_name="Salsa Roja",
        yield_qty=4.0,
        yield_unit="qt",
        sub_recipe_slugs=[],
        bom=[
            {"ingredient": "roma tomatoes", "qty": 2.0, "unit": "lb", "is_sub_recipe": False},
            {"ingredient": "jalapeño", "qty": 0.5, "unit": "lb", "is_sub_recipe": False},
        ],
    )


def _queso() -> Manifest:
    return Manifest(
        slug="queso_blanco",
        display_name="Queso Blanco",
        yield_qty=8.0,
        yield_unit="qt",
        sub_recipe_slugs=["salsa_roja"],
        bom=[
            {"ingredient": "white american cheese", "qty": 3.0, "unit": "lb", "is_sub_recipe": False},
            {"ingredient": "salsa_roja", "qty": 2.0, "unit": "qt", "is_sub_recipe": True},
        ],
    )


def _manifest() -> dict[str, Manifest]:
    return {
        "salsa_roja": _salsa(),
        "queso_blanco": _queso(),
    }


# ---------------------------------------------------------------------------
# Import build_cascade from the CLI module
# ---------------------------------------------------------------------------

import importlib.util as _ilu
_CLI_PATH = ROOT / "scripts" / "beo_cascade_cli.py"
_spec = _ilu.spec_from_file_location("beo_cascade_cli", _CLI_PATH)
_mod = _ilu.module_from_spec(_spec)  # type: ignore[arg-type]
_spec.loader.exec_module(_mod)  # type: ignore[union-attr]
build_cascade = _mod.build_cascade


# ---------------------------------------------------------------------------
# Unit tests — pure core
# ---------------------------------------------------------------------------

class BuildCascadeUnit(unittest.TestCase):

    def setUp(self) -> None:
        self.manifest = _manifest()
        # queso dip → queso_blanco recipe
        self.beo_map: dict[str, list[str]] = {"queso dip": ["queso_blanco"]}

    def test_manifest_warnings_surfaces_orphan_declared_sub(self) -> None:
        """A recipe that declares a sub_recipe no BOM row references must
        appear in the result's manifest_warnings (not silently dropped)."""
        orphan = Manifest(
            slug="orphan_parent",
            display_name="Orphan Parent",
            yield_qty=4.0,
            yield_unit="qt",
            sub_recipe_slugs=["ghost_sub"],  # declared...
            bom=[{"ingredient": "water", "qty": 1.0, "unit": "qt", "is_sub_recipe": False}],  # ...never referenced
        )
        ghost = Manifest(
            slug="ghost_sub",
            display_name="Ghost Sub",
            yield_qty=2.0,
            yield_unit="qt",
            sub_recipe_slugs=[],
            bom=[{"ingredient": "salt", "qty": 1.0, "unit": "qt", "is_sub_recipe": False}],
        )
        result = build_cascade(
            {"orphan_parent": orphan, "ghost_sub": ghost},
            {"orphan": ["orphan_parent"]},
            [{"item_name": "Orphan", "quantity": 1}],
        )
        self.assertIn("manifest_warnings", result)
        recipes = {w["recipe"] for w in result["manifest_warnings"]}
        self.assertIn("orphan_parent", recipes)
        self.assertTrue(all("issue" in w for w in result["manifest_warnings"]))

    def test_manifest_warnings_scoped_to_event_recipes(self) -> None:
        """An orphan declaration in a recipe THIS event doesn't reach must not
        appear — no noise from an unrelated recipe's data gap."""
        orphan = Manifest(
            slug="orphan_parent", display_name="Orphan Parent",
            yield_qty=4.0, yield_unit="qt", sub_recipe_slugs=["ghost_sub"],
            bom=[{"ingredient": "water", "qty": 1.0, "unit": "qt", "is_sub_recipe": False}],
        )
        ghost = Manifest(
            slug="ghost_sub", display_name="Ghost Sub", yield_qty=2.0, yield_unit="qt",
            sub_recipe_slugs=[],
            bom=[{"ingredient": "salt", "qty": 1.0, "unit": "qt", "is_sub_recipe": False}],
        )
        # Unrelated recipe with its OWN orphan — not in this event.
        other = Manifest(
            slug="other_dish", display_name="Other Dish", yield_qty=4.0, yield_unit="qt",
            sub_recipe_slugs=["other_ghost"],
            bom=[{"ingredient": "flour", "qty": 1.0, "unit": "qt", "is_sub_recipe": False}],
        )
        other_ghost = Manifest(
            slug="other_ghost", display_name="Other Ghost", yield_qty=2.0, yield_unit="qt",
            sub_recipe_slugs=[],
            bom=[{"ingredient": "pepper", "qty": 1.0, "unit": "qt", "is_sub_recipe": False}],
        )
        result = build_cascade(
            {"orphan_parent": orphan, "ghost_sub": ghost, "other_dish": other, "other_ghost": other_ghost},
            {"orphan": ["orphan_parent"]},
            [{"item_name": "Orphan", "quantity": 1}],
        )
        recipes = {w["recipe"] for w in result["manifest_warnings"]}
        self.assertIn("orphan_parent", recipes)
        self.assertNotIn("other_dish", recipes)

    def test_order_guide_contains_leaf_ingredients(self) -> None:
        """order_guide must contain the leaf ingredients from queso + salsa sub-recipe."""
        result = build_cascade(
            self.manifest,
            self.beo_map,
            [{"item_name": "Queso Dip", "quantity": 2}],
        )
        ing_names = {row["ingredient"] for row in result["order_guide"]}
        self.assertIn("roma tomatoes", ing_names)
        self.assertIn("jalapeño", ing_names)
        self.assertIn("white american cheese", ing_names)

    def test_order_guide_totals_are_scaled_correctly(self) -> None:
        """Ordering 2 'batches' of queso (yield=8 qt each) = 16 qt total.
        build_demand: qty=2, not qty_in_yield_units → demand = 2 × 8 = 16 qt queso.
        queso scale = 16 / 8 = 2.
        white american cheese = 3 lb/batch × scale 2 = 6.0 lb.
        Salsa demand = 2 qt/batch × scale 2 = 4 qt.
        Salsa scale = 4 / 4 = 1.
        roma tomatoes = 2 lb/salsa-batch × scale 1 = 2.0 lb."""
        result = build_cascade(
            self.manifest,
            self.beo_map,
            [{"item_name": "Queso Dip", "quantity": 2}],
        )
        by_ing = {row["ingredient"]: row for row in result["order_guide"]}
        self.assertAlmostEqual(by_ing["roma tomatoes"]["total_needed"], 2.0, places=5)
        self.assertAlmostEqual(by_ing["white american cheese"]["total_needed"], 6.0, places=5)

    def test_prep_demands_includes_parent_and_sub_recipe(self) -> None:
        """prep_demands must include BOTH queso_blanco and salsa_roja nodes."""
        result = build_cascade(
            self.manifest,
            self.beo_map,
            [{"item_name": "Queso Dip", "quantity": 2}],
        )
        slugs = {row["recipe_slug"] for row in result["prep_demands"]}
        self.assertIn("queso_blanco", slugs)
        self.assertIn("salsa_roja", slugs)

    def test_prep_demands_display_name_and_qty(self) -> None:
        """prep_demands row has correct display_name and qty."""
        result = build_cascade(
            self.manifest,
            self.beo_map,
            [{"item_name": "Queso Dip", "quantity": 2}],
        )
        by_slug = {row["recipe_slug"]: row for row in result["prep_demands"]}
        # queso_blanco: 2 batches × 8 qt = 16 qt
        self.assertEqual(by_slug["queso_blanco"]["display_name"], "Queso Blanco")
        self.assertAlmostEqual(by_slug["queso_blanco"]["qty"], 16.0, places=5)
        self.assertEqual(by_slug["queso_blanco"]["unit"], "qt")
        # salsa_roja: embedded 2 qt/batch × 2 batches = 4 qt
        self.assertEqual(by_slug["salsa_roja"]["display_name"], "Salsa Roja")
        self.assertAlmostEqual(by_slug["salsa_roja"]["qty"], 4.0, places=5)

    def test_unmapped_item_appears_in_unmapped(self) -> None:
        """A line item not in the map AND not directly resolvable surfaces in unmapped."""
        result = build_cascade(
            self.manifest,
            self.beo_map,
            [
                {"item_name": "Queso Dip", "quantity": 2},
                {"item_name": "Mystery", "quantity": 1},
            ],
        )
        unmapped_names = [u["menu_item"] for u in result["unmapped"]]
        self.assertIn("Mystery", unmapped_names)
        # Known item must NOT be in unmapped
        self.assertNotIn("Queso Dip", unmapped_names)

    def test_map_warnings_surfaced_in_unmapped(self) -> None:
        """map_warnings (unresolved map entries from load_beo_recipe_map) must also appear in unmapped."""
        warning = Unmapped("Ghost Item", "map references 'ghost_recipe', no such recipe")
        result = build_cascade(
            self.manifest,
            self.beo_map,
            [{"item_name": "Queso Dip", "quantity": 2}],
            map_warnings=[warning],
        )
        unmapped_items = [u["menu_item"] for u in result["unmapped"]]
        self.assertIn("Ghost Item", unmapped_items)

    def test_inventory_subtracted_in_order_guide(self) -> None:
        """on_hand inventory reduces to_order; never negative."""
        inventory = {("roma tomatoes", "lb"): 1.0}
        result = build_cascade(
            self.manifest,
            self.beo_map,
            [{"item_name": "Queso Dip", "quantity": 2}],
            inventory=inventory,
        )
        by_ing = {row["ingredient"]: row for row in result["order_guide"]}
        tomatoe_row = by_ing["roma tomatoes"]
        self.assertAlmostEqual(tomatoe_row["on_hand"], 1.0, places=5)
        # total_needed = 2.0 lb (salsa scale=1 → 2 lb/batch); on_hand = 1.0 → to_order = 1.0
        self.assertAlmostEqual(tomatoe_row["to_order"], tomatoe_row["total_needed"] - 1.0, places=5)

    def test_prep_demands_sorted_by_display_name(self) -> None:
        """prep_demands must be sorted by (display_name.lower(), unit)."""
        result = build_cascade(
            self.manifest,
            self.beo_map,
            [{"item_name": "Queso Dip", "quantity": 2}],
        )
        names = [row["display_name"].lower() for row in result["prep_demands"]]
        self.assertEqual(names, sorted(names))

    def test_missing_sub_recipe_degrades_to_warning(self) -> None:
        """build_cascade runs in graceful (warnings-sink) mode: a BOM row that
        references a sub-recipe absent from the manifest must degrade to a
        warning (skip that branch, keep the rest of the event) instead of
        aborting the whole cascade with a raw KeyError. Fail-loud is preserved
        for the no-sink expand_* entry points (see test_bom_expand.py's
        test_pin_to_unknown_slug_raises)."""
        # 'broken_dip' BOM marks 'missing_sub' as a sub-recipe, but
        # 'missing_sub' is NOT present in the manifest dict.
        broken = Manifest(
            slug="broken_dip",
            display_name="Broken Dip",
            yield_qty=1.0,
            yield_unit="qt",
            sub_recipe_slugs=["missing_sub"],
            bom=[
                {"ingredient": "missing_sub", "qty": 1.0, "unit": "qt", "is_sub_recipe": True},
            ],
        )
        manifest_with_gap = {"broken_dip": broken}
        beo_map_with_gap: dict[str, list[str]] = {"broken dip": ["broken_dip"]}

        result = build_cascade(
            manifest_with_gap,
            beo_map_with_gap,
            [{"item_name": "Broken Dip", "quantity": 1}],
        )
        # Did not raise; surfaced the gap as a warning naming the missing sub.
        self.assertTrue(
            any("missing_sub" in w for w in result["warnings"]),
            f"expected a warning naming missing_sub, got {result['warnings']}",
        )


# ---------------------------------------------------------------------------
# Integration test — subprocess against real repo data
# ---------------------------------------------------------------------------

class BeoCascadeCLIIntegration(unittest.TestCase):

    def test_bogus_item_exit_zero_with_unmapped(self) -> None:
        """A completely bogus line item should produce exit 0, valid JSON,
        empty order_guide and prep_demands, and one unmapped entry."""
        payload = json.dumps({
            "line_items": [
                {"item_name": "__definitely_not_a_real_item__", "quantity": 1}
            ]
        })
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "beo_cascade_cli.py")],
            input=payload,
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            result.returncode,
            0,
            msg=f"Expected exit 0; got {result.returncode}. stderr={result.stderr!r}",
        )
        out = json.loads(result.stdout)
        self.assertNotIn("error", out, msg=f"Unexpected error: {out.get('error')}")
        self.assertIn("order_guide", out)
        self.assertIn("prep_demands", out)
        self.assertIn("unmapped", out)
        self.assertEqual(out["order_guide"], [])
        self.assertEqual(out["prep_demands"], [])
        self.assertEqual(len(out["unmapped"]), 1)
        self.assertEqual(
            out["unmapped"][0]["menu_item"],
            "__definitely_not_a_real_item__",
        )

    def test_invalid_json_exits_nonzero(self) -> None:
        """Garbage stdin must exit non-zero and return an error JSON."""
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "beo_cascade_cli.py")],
            input="not valid json{",
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        out = json.loads(result.stdout)
        self.assertIn("error", out)

    def test_missing_line_items_key_exits_nonzero(self) -> None:
        """stdin missing 'line_items' must exit non-zero."""
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "beo_cascade_cli.py")],
            input=json.dumps({"not_line_items": []}),
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        out = json.loads(result.stdout)
        self.assertIn("error", out)


if __name__ == "__main__":
    unittest.main()
