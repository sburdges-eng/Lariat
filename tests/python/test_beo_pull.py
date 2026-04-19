"""Tests for scripts.lib.beo_pull — BEO order-pull core logic.

These run against synthetic data so they don't drift when the live CSVs
change. The real-data happy path is covered by the bom_expand suite.
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
    normalize_client,
    pull_orders,
)
from scripts.lib.bom_expand import Manifest  # noqa: E402


def _salsa() -> Manifest:
    return Manifest(
        slug="blackened_tomato_salsa",
        display_name="Blackened Tomato Salsa",
        yield_qty=20,
        yield_unit="qt",
        sub_recipe_slugs=[],
        bom=[
            {"ingredient": "roma tomatoes", "qty": 11339.8, "unit": "g", "is_sub_recipe": False},
            {"ingredient": "cilantro", "qty": 2.0, "unit": "cup", "is_sub_recipe": False},
        ],
    )


def _queso() -> Manifest:
    return Manifest(
        slug="queso_mac_sauce",
        display_name="Queso / Mac Sauce",
        yield_qty=22,
        yield_unit="qt",
        sub_recipe_slugs=["blackened_tomato_salsa"],
        bom=[
            {"ingredient": "whole milk", "qty": 7570.82, "unit": "ml", "is_sub_recipe": False},
            {"ingredient": "blackened_tomato_salsa", "qty": 2.0, "unit": "qt", "is_sub_recipe": True},
        ],
    )


def _manifest() -> dict[str, Manifest]:
    return {
        "blackened_tomato_salsa": _salsa(),
        "queso_mac_sauce": _queso(),
    }


class NormalizeClient(unittest.TestCase):
    def test_equivalences(self) -> None:
        self.assertEqual(normalize_client("Navratil  "), normalize_client("navratil"))
        self.assertEqual(normalize_client(" NAVRATIL"), normalize_client("Navratil"))
        self.assertEqual(normalize_client(None), "")


class BuildDemand(unittest.TestCase):
    def test_unmapped_item_reported_not_dropped(self) -> None:
        """Legacy script silently dropped unknown menu items — a common
        cause of missing orders. The new contract is: any row that
        can't resolve shows up in `unmapped`."""
        beo_map = {"baked ziti": ["queso_mac_sauce"]}
        demand, unmapped = build_demand(
            [InvoiceRow("Cupcakes", 1.0)],
            _manifest(),
            beo_map,
        )
        self.assertEqual(demand, [])
        self.assertEqual(len(unmapped), 1)
        self.assertEqual(unmapped[0].menu_item, "Cupcakes")

    def test_qty_is_number_of_batches_by_default(self) -> None:
        """Legacy semantics: Qty=1 for a menu item that maps to queso
        (22 qt yield) means "one batch of queso"."""
        beo_map = {"baked ziti": ["queso_mac_sauce"]}
        demand, _ = build_demand(
            [InvoiceRow("Baked Ziti", 1.0)],
            _manifest(),
            beo_map,
        )
        self.assertEqual(demand, [("queso_mac_sauce", 22.0, "qt")])

    def test_qty_in_yield_units_mode(self) -> None:
        beo_map = {"baked ziti": ["queso_mac_sauce"]}
        demand, _ = build_demand(
            [InvoiceRow("Baked Ziti", 4.0)],
            _manifest(),
            beo_map,
            qty_in_yield_units=True,
        )
        self.assertEqual(demand, [("queso_mac_sauce", 4.0, "qt")])

    def test_single_menu_item_maps_to_multiple_recipes(self) -> None:
        """Trio Dips → [salsa, queso] in beo_recipe_map.csv."""
        beo_map = {
            "trio dips": ["blackened_tomato_salsa", "queso_mac_sauce"],
        }
        demand, unmapped = build_demand(
            [InvoiceRow("Trio Dips", 1.0)],
            _manifest(),
            beo_map,
            qty_in_yield_units=True,  # 1 qt of each, synthetic
        )
        self.assertEqual(unmapped, [])
        self.assertEqual(len(demand), 2)
        slugs = {d[0] for d in demand}
        self.assertEqual(slugs, {"blackened_tomato_salsa", "queso_mac_sauce"})

    def test_direct_name_resolution_fallback(self) -> None:
        """If a menu item isn't in the map but EXACTLY matches a recipe
        display name, resolve it directly. Keeps the pipeline working
        when the map file is incomplete — but the miss still shows up
        via the direct-match branch, not silently dropped."""
        beo_map: dict[str, list[str]] = {}
        demand, unmapped = build_demand(
            [InvoiceRow("Queso / Mac Sauce", 1.0)],
            _manifest(),
            beo_map,
        )
        self.assertEqual(unmapped, [])
        self.assertEqual(demand, [("queso_mac_sauce", 22.0, "qt")])


class PullOrders(unittest.TestCase):
    def test_cascade_aggregates_sub_recipe_demand(self) -> None:
        """The headline property: two BEO lines — one that uses queso
        (which internally uses salsa) and one standalone salsa — must
        produce a SINGLE salsa leaf total, not two separate rows."""
        beo_map = {
            "baked ziti": ["queso_mac_sauce"],
            "side salsa": ["blackened_tomato_salsa"],
        }
        invoice = [
            InvoiceRow("Baked Ziti", 1.0),  # 22 qt queso, embeds 2 qt salsa
            InvoiceRow("Side Salsa", 1.0),  # 20 qt salsa standalone
        ]
        demand, _ = build_demand(invoice, _manifest(), beo_map)
        lines = pull_orders(_manifest(), demand)
        by_ing = {(l.ingredient, l.unit): l for l in lines}
        # Salsa leaves must appear once per (ingredient, unit), summed
        # across (queso's 2/22 share) + (standalone 20 qt of salsa).
        embedded_qt = 22.0 * 2.0 / 22.0  # 2 qt embedded in 22 qt of queso
        total_salsa_qt = embedded_qt + 20.0
        salsa_scale = total_salsa_qt / 20.0
        self.assertAlmostEqual(
            by_ing[("roma tomatoes", "g")].total_needed,
            11339.8 * salsa_scale,
            places=3,
        )
        self.assertAlmostEqual(
            by_ing[("cilantro", "cup")].total_needed,
            2.0 * salsa_scale,
            places=6,
        )
        # And queso's own leaf is present only from the queso branch.
        self.assertAlmostEqual(
            by_ing[("whole milk", "ml")].total_needed,
            7570.82,
            places=3,
        )

    def test_inventory_subtracts_to_order(self) -> None:
        """On-hand inventory reduces to_order; never produces negative.
        Unit match is exact; missing inventory → on_hand=0."""
        beo_map = {"side salsa": ["blackened_tomato_salsa"]}
        demand, _ = build_demand(
            [InvoiceRow("Side Salsa", 1.0)],  # 20 qt of salsa = one batch
            _manifest(),
            beo_map,
        )
        inventory = {
            ("roma tomatoes", "g"): 500.0,     # partial — reduces to_order
            ("cilantro", "cup"): 1000.0,       # excess — clamped at 0
        }
        lines = pull_orders(_manifest(), demand, inventory=inventory)
        by = {(l.ingredient, l.unit): l for l in lines}
        self.assertAlmostEqual(by[("roma tomatoes", "g")].total_needed, 11339.8)
        self.assertAlmostEqual(by[("roma tomatoes", "g")].on_hand, 500.0)
        self.assertAlmostEqual(by[("roma tomatoes", "g")].to_order, 10839.8)
        self.assertAlmostEqual(by[("cilantro", "cup")].total_needed, 2.0)
        self.assertAlmostEqual(by[("cilantro", "cup")].on_hand, 1000.0)
        self.assertEqual(by[("cilantro", "cup")].to_order, 0.0)


if __name__ == "__main__":
    unittest.main()
