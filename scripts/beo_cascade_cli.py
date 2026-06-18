#!/usr/bin/env python3
"""Thin JSON-in / JSON-out CLI: BEO line items → order guide + prep demands.

Wraps `bom_expand` and `beo_pull` so the TypeScript layer (Tasks 7/8) can
shell out to get a complete, DB-sourced cascade in one call — mirroring how
`scripts/bom_expand_cli.py` is used by `lib/recipeCalculator.ts`.

Input (stdin, JSON):
    {
        "line_items": [{"item_name": "Battered Fish Taco", "quantity": 40}],
        "root": "/abs/path/to/Lariat",       // optional; defaults to repo root
        "qty_in_yield_units": false,          // optional
        "inventory": [                        // optional
            {"ingredient": "flour", "unit": "lb", "on_hand": 5}
        ]
    }

Output (stdout, JSON):
    {
        "order_guide":  [{"ingredient": "flour", "unit": "lb",
                          "total_needed": 10.0, "on_hand": 5.0, "to_order": 5.0}],
        "prep_demands": [{"recipe_slug": "beer_batter", "display_name": "Beer Batter",
                          "qty": 4.0, "unit": "qt"}],
        "unmapped":     [{"menu_item": "Mystery Dish",
                          "reason": "not in beo_recipe_map and no direct recipe match"}]
    }

On failure: {"error": "..."} to stdout, exit non-zero.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Iterable

# Make `scripts.lib.*` importable when invoked directly.
_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parent
sys.path.insert(0, str(_REPO))

from scripts.lib.bom_expand import (  # noqa: E402
    Manifest,
    RecipeCycleError,
    UnitMismatchError,
    UnknownRecipeError,
    build_manifest_from_normalized,
    expand_recipe_demand,
)
from scripts.lib.beo_pull import (  # noqa: E402
    InvoiceRow,
    Unmapped,
    build_demand,
    load_beo_recipe_map,
    pull_orders,
)


# ---------------------------------------------------------------------------
# Testable core
# ---------------------------------------------------------------------------


def build_cascade(
    manifest: dict[str, Manifest],
    beo_map: dict[str, list[str]],
    line_items: list[dict],
    *,
    qty_in_yield_units: bool = False,
    inventory: dict[tuple[str, str], float] | None = None,
    map_warnings: Iterable[Unmapped] = (),
) -> dict:
    """Pure, testable cascade core.

    Parameters
    ----------
    manifest        slug→Manifest dict (from build_manifest_from_normalized).
    beo_map         normalized menu-item → [recipe_slug, ...] lookup.
    line_items      list of {"item_name": str, "quantity": numeric}.
    qty_in_yield_units  passed through to build_demand.
    inventory       {(ingredient_lower, unit_lower): on_hand_qty} (optional).
    map_warnings    unresolved Unmapped entries from load_beo_recipe_map.

    Returns
    -------
    {
        "order_guide":  list of order-line dicts,
        "prep_demands": list of recipe-node dicts,
        "unmapped":     list of unmapped-item dicts,
    }
    """
    # Convert line_items → InvoiceRow list
    rows = [
        InvoiceRow(menu_item=item["item_name"], qty=float(item["quantity"]), unit="")
        for item in line_items
    ]

    # Aggregate demand triples and collect per-row unmapped entries
    demand, row_unmapped = build_demand(
        rows,
        manifest,
        beo_map,
        qty_in_yield_units=qty_in_yield_units,
    )

    # Order guide (leaf ingredients)
    order_lines = pull_orders(manifest, demand, inventory)
    order_guide = [
        {
            "ingredient": ol.ingredient,
            "unit": ol.unit,
            "total_needed": ol.total_needed,
            "on_hand": ol.on_hand,
            "to_order": ol.to_order,
        }
        for ol in order_lines
    ]

    # Prep board (per-recipe nodes — parents AND sub-recipes)
    nodes = expand_recipe_demand(manifest, demand)
    prep_demands = sorted(
        [
            {
                "recipe_slug": slug,
                "display_name": manifest[slug].display_name,
                "qty": qty,
                "unit": unit,
            }
            for (slug, unit), qty in nodes.items()
        ],
        key=lambda r: (r["display_name"].lower(), r["unit"]),
    )

    # All unmapped: map-level warnings + per-row unmapped
    all_unmapped = list(map_warnings) + row_unmapped
    unmapped = [{"menu_item": u.menu_item, "reason": u.reason} for u in all_unmapped]

    return {"order_guide": order_guide, "prep_demands": prep_demands, "unmapped": unmapped}


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        _fail(f"invalid JSON on stdin: {e}")
        return 2

    if not isinstance(payload, dict):
        _fail("stdin must be a JSON object")
        return 2

    line_items = payload.get("line_items")
    if not isinstance(line_items, list):
        _fail("`line_items` (list of objects) is required")
        return 2

    for i, item in enumerate(line_items):
        if not isinstance(item, dict):
            _fail(f"line_items[{i}] must be an object")
            return 2
        if not isinstance(item.get("item_name"), str) or not item["item_name"]:
            _fail(f"line_items[{i}] missing required string field `item_name`")
            return 2
        try:
            float(item.get("quantity", ""))
        except (TypeError, ValueError):
            _fail(f"line_items[{i}].quantity must be numeric")
            return 2

    root = Path(payload.get("root") or _REPO)
    recipes_csv = root / "recipes" / "recipe_index.csv"
    normalized_dir = root / "recipes" / "normalized"
    map_csv = root / "menus" / "beo_recipe_map.csv"

    if not recipes_csv.exists():
        _fail(f"missing recipe_index.csv at {recipes_csv}")
        return 2
    if not normalized_dir.is_dir():
        _fail(f"missing normalized dir at {normalized_dir}")
        return 2
    if not map_csv.exists():
        _fail(f"missing beo_recipe_map.csv at {map_csv}")
        return 2

    try:
        manifest = build_manifest_from_normalized(recipes_csv, normalized_dir)
    except Exception as e:
        _fail(f"failed to build manifest: {e}")
        return 2

    try:
        beo_map, map_unresolved = load_beo_recipe_map(map_csv, manifest)
    except Exception as e:
        _fail(f"failed to load recipe map: {e}")
        return 2

    # Parse optional inventory list → {(ingredient_lower, unit_lower): float}
    try:
        inventory: dict[tuple[str, str], float] | None = None
        raw_inventory = payload.get("inventory")
        if isinstance(raw_inventory, list) and raw_inventory:
            inventory = {}
            for entry in raw_inventory:
                if isinstance(entry, dict):
                    ing = str(entry.get("ingredient") or "").strip().lower()
                    unit = str(entry.get("unit") or "").strip().lower()
                    try:
                        on_hand = float(entry.get("on_hand", 0))
                    except (TypeError, ValueError):
                        on_hand = 0.0
                    if ing:
                        inventory[(ing, unit)] = on_hand
    except Exception as e:
        _fail(f"failed to parse inventory: {e}")
        return 2

    qty_in_yield_units = bool(payload.get("qty_in_yield_units", False))

    try:
        result = build_cascade(
            manifest,
            beo_map,
            line_items,
            qty_in_yield_units=qty_in_yield_units,
            inventory=inventory,
            map_warnings=map_unresolved,
        )
    except (UnknownRecipeError, UnitMismatchError, RecipeCycleError) as e:
        _fail(str(e))
        return 3
    except Exception as e:
        _fail(f"cascade failed: {e}")
        return 2

    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


def _fail(msg: str) -> None:
    json.dump({"error": msg}, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    sys.exit(main())
