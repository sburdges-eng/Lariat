"""Live-CSV canaries for the Grelecki 2026-09-05 order-guide misses.

The kitchen sheet had to say "order by hand" because expanding mapped
recipes dropped the meat, the fish, the tortillas, the chips, and had
no elote recipe at all. These tests pin the live recipe_index +
normalized BOMs + beo_recipe_map so that gap cannot return silently.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.beo_pull import (  # noqa: E402
    InvoiceRow,
    build_demand,
    load_beo_recipe_map,
)
from scripts.lib.bom_expand import (  # noqa: E402
    aggregate_demand,
    build_manifest_from_normalized,
    expand_recipe,
)


def _live_manifest():
    return build_manifest_from_normalized(
        ROOT / "recipes" / "recipe_index.csv",
        ROOT / "recipes" / "normalized",
    )


def _leaf_names(leaves: dict) -> set[str]:
    return {ing for (ing, _unit) in leaves}


class ChickenConfitHasTheChicken(unittest.TestCase):
    def test_confit_bom_includes_redbird_legs(self) -> None:
        manifest = _live_manifest()
        leaves = expand_recipe(manifest, "chicken_confit", qty=1, unit="hotel pan")
        names = _leaf_names(leaves)
        self.assertIn(
            "redbird chicken legs",
            names,
            "chicken_confit procedure Frenchs legs but the BOM had no chicken — "
            "Braised Chicken Taco Buffet therefore ordered garlic and oil only",
        )
        self.assertGreater(leaves[("redbird chicken legs", "case")], 0)


class FishTacoBuffetOrdersFishAndTortillas(unittest.TestCase):
    def test_one_buffet_pulls_pangasius_and_corn_tortillas(self) -> None:
        manifest = _live_manifest()
        lookup, unresolved, scales = load_beo_recipe_map(
            ROOT / "menus" / "beo_recipe_map.csv",
            manifest,
        )
        self.assertFalse(
            any("Elote" in u.menu_item or "elote" in u.reason.lower() for u in unresolved),
        )
        demand, unmapped = build_demand(
            [InvoiceRow("Fish Taco Buffet", 1.0)],
            manifest,
            lookup,
            scales=scales,
        )
        self.assertEqual(unmapped, [])
        leaves = aggregate_demand(manifest, demand)
        names = _leaf_names(leaves)
        self.assertTrue(
            any("pangasius" in n for n in names),
            f"Fish Taco Buffet leaves had no pangasius: {sorted(names)}",
        )
        self.assertTrue(
            any("tortilla" in n for n in names),
            f"Fish Taco Buffet leaves had no tortillas: {sorted(names)}",
        )


class TacoBuffetsShareStaples(unittest.TestCase):
    def test_barbacoa_and_chicken_buffets_pull_cotija_and_tortillas(self) -> None:
        manifest = _live_manifest()
        lookup, _unresolved, scales = load_beo_recipe_map(
            ROOT / "menus" / "beo_recipe_map.csv",
            manifest,
        )
        for item in ("Barbacoa Taco Buffet", "Braised Chicken Taco Buffet"):
            demand, unmapped = build_demand(
                [InvoiceRow(item, 1.0)],
                manifest,
                lookup,
                scales=scales,
            )
            self.assertEqual(unmapped, [], item)
            names = _leaf_names(aggregate_demand(manifest, demand))
            self.assertTrue(any("cotija" in n for n in names), f"{item} missing cotija: {sorted(names)}")
            self.assertTrue(
                any("tortilla" in n for n in names),
                f"{item} missing tortillas: {sorted(names)}",
            )


class TrioDipsOrdersChips(unittest.TestCase):
    def test_twelve_platters_pull_chips(self) -> None:
        manifest = _live_manifest()
        lookup, _unresolved, scales = load_beo_recipe_map(
            ROOT / "menus" / "beo_recipe_map.csv",
            manifest,
        )
        demand, unmapped = build_demand(
            [InvoiceRow("Trio Dips", 12.0)],
            manifest,
            lookup,
            scales=scales,
        )
        self.assertEqual(unmapped, [])
        names = _leaf_names(aggregate_demand(manifest, demand))
        self.assertTrue(
            any("chip" in n for n in names),
            f"Trio Dips (12 platters) had no chips: {sorted(names)}",
        )


class EloteSaladExists(unittest.TestCase):
    def test_elote_is_a_recipe_and_maps(self) -> None:
        manifest = _live_manifest()
        self.assertIn("elote_salad", manifest)
        lookup, unresolved, scales = load_beo_recipe_map(
            ROOT / "menus" / "beo_recipe_map.csv",
            manifest,
        )
        bad = [u for u in unresolved if "elote" in u.menu_item.casefold()]
        self.assertEqual(bad, [])
        demand, unmapped = build_demand(
            [InvoiceRow("Elote Salad", 4.0)],
            manifest,
            lookup,
            scales=scales,
        )
        self.assertEqual(unmapped, [])
        names = _leaf_names(aggregate_demand(manifest, demand))
        self.assertTrue(any("corn" in n for n in names), f"elote had no corn: {sorted(names)}")
        self.assertTrue(
            any("adobo" in n for n in names),
            f"elote must dress with house chipotle aioli (adobo), not a separate mayo pail: {sorted(names)}",
        )
        pins = [row for row in manifest["elote_salad"].bom if row.get("sub_slug") == "chipotle_aioli"]
        self.assertEqual(len(pins), 1, "elote_salad.csv must pin chipotle aioli as a sub-recipe")


if __name__ == "__main__":
    unittest.main()
