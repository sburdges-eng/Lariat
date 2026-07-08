#!/usr/bin/env python3
"""Dev-only: export golden BeoPull + BeoCascade fixtures for Swift parity tests.

Writes to LariatNative/Tests/Fixtures/BeoCascade/*.json — not part of any app target.

Usage (from repo root):
  python3 scripts/dev/export_beo_fixtures.py
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.bom_expand import Manifest  # noqa: E402
from scripts.lib.beo_pull import (  # noqa: E402
    InvoiceRow,
    build_demand,
    pull_orders,
)

SCHEMA_VERSION = 1
DEFAULT_OUT = ROOT / "LariatNative" / "Tests" / "Fixtures" / "BeoCascade"

# Load build_cascade from CLI module (same as test_beo_cascade_cli.py)
_CLI_PATH = ROOT / "scripts" / "beo_cascade_cli.py"
_spec = importlib.util.spec_from_file_location("beo_cascade_cli", _CLI_PATH)
_mod = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
_spec.loader.exec_module(_mod)  # type: ignore[union-attr]
build_cascade = _mod.build_cascade


def _mk(
    slug: str,
    name: str,
    yield_qty: float,
    yield_unit: str,
    sub_recipe_slugs: list[str] | None = None,
    bom: list[tuple] | None = None,
    pack_conversions: dict | None = None,
) -> Manifest:
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
        allergens=[],
        pack_conversions=dict(pack_conversions or {}),
    )


def manifest_to_dict(m: Manifest) -> dict[str, Any]:
    pack = {k: [v[0], v[1]] for k, v in m.pack_conversions.items()}
    return {
        "slug": m.slug,
        "display_name": m.display_name,
        "yield_qty": m.yield_qty,
        "yield_unit": m.yield_unit,
        "sub_recipe_slugs": list(m.sub_recipe_slugs),
        "bom": list(m.bom),
        "allergens": list(m.allergens),
        "pack_conversions": pack,
    }


def manifests_to_json(manifest: dict[str, Manifest]) -> dict[str, Any]:
    return {k: manifest_to_dict(v) for k, v in manifest.items()}


def order_lines_to_json(lines) -> list[dict[str, Any]]:
    return [
        {
            "ingredient": l.ingredient,
            "unit": l.unit,
            "total_needed": l.total_needed,
            "on_hand": l.on_hand,
            "to_order": l.to_order,
        }
        for l in lines
    ]


def write_fixture(path: Path, doc: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        json.dump(doc, f, indent=2, sort_keys=False)
        f.write("\n")


def queso_salsa_manifest() -> dict[str, Manifest]:
    salsa = _mk(
        "blackened_tomato_salsa",
        "Blackened Tomato Salsa",
        20,
        "qt",
        bom=[
            ("roma tomatoes", 11339.8, "g", False),
            ("cilantro", 2.0, "cup", False),
        ],
    )
    queso = _mk(
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
    return {"blackened_tomato_salsa": salsa, "queso_mac_sauce": queso}


def cascade_manifest() -> dict[str, Manifest]:
    salsa = _mk(
        "salsa_roja",
        "Salsa Roja",
        4.0,
        "qt",
        bom=[
            ("roma tomatoes", 2.0, "lb", False),
            ("jalapeño", 0.5, "lb", False),
        ],
    )
    queso = _mk(
        "queso_blanco",
        "Queso Blanco",
        8.0,
        "qt",
        sub_recipe_slugs=["salsa_roja"],
        bom=[
            ("white american cheese", 3.0, "lb", False),
            ("salsa_roja", 2.0, "qt", True),
        ],
    )
    return {"salsa_roja": salsa, "queso_blanco": queso}


def export_all(out_dir: Path) -> list[str]:
    written: list[str] = []

    # --- BeoPull: normalize_client ---
    write_fixture(
        out_dir / "normalize_client_equivalence.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "normalize_client_equivalence",
            "module": "beo_pull",
            "source_test": "tests/python/test_beo_pull.py::NormalizeClient::test_equivalences",
            "input": {
                "mode": "normalize_client",
                "samples": ["Navratil  ", "navratil", " NAVRATIL", None],
            },
            "expect": {"normalized": ["navratil", "navratil", "navratil", ""]},
        },
    )
    written.append("normalize_client_equivalence")

    manifest = queso_salsa_manifest()
    mj = manifests_to_json(manifest)

    # --- build_demand fixtures ---
    demand, unmapped = build_demand(
        [InvoiceRow("Cupcakes", 1.0)], manifest, {"baked ziti": ["queso_mac_sauce"]}
    )
    write_fixture(
        out_dir / "build_demand_unmapped.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "build_demand_unmapped",
            "module": "beo_pull",
            "source_test": "tests/python/test_beo_pull.py::BuildDemand::test_unmapped_item_reported_not_dropped",
            "manifest": mj,
            "beo_map": {"baked ziti": ["queso_mac_sauce"]},
            "input": {
                "mode": "build_demand",
                "invoice": [["Cupcakes", 1.0]],
            },
            "expect": {"demand": [], "unmapped": [["Cupcakes", ""]]},
        },
    )
    written.append("build_demand_unmapped")

    demand, _ = build_demand(
        [InvoiceRow("Baked Ziti", 1.0)], manifest, {"baked ziti": ["queso_mac_sauce"]}
    )
    write_fixture(
        out_dir / "build_demand_one_batch.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "build_demand_one_batch",
            "module": "beo_pull",
            "source_test": "tests/python/test_beo_pull.py::BuildDemand::test_qty_is_number_of_batches_by_default",
            "manifest": mj,
            "beo_map": {"baked ziti": ["queso_mac_sauce"]},
            "input": {"mode": "build_demand", "invoice": [["Baked Ziti", 1.0]]},
            "expect": {"demand": [["queso_mac_sauce", 22.0, "qt"]], "unmapped": []},
        },
    )
    written.append("build_demand_one_batch")

    demand, _ = build_demand(
        [InvoiceRow("Baked Ziti", 4.0)],
        manifest,
        {"baked ziti": ["queso_mac_sauce"]},
        qty_in_yield_units=True,
    )
    write_fixture(
        out_dir / "build_demand_yield_units.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "build_demand_yield_units",
            "module": "beo_pull",
            "source_test": "tests/python/test_beo_pull.py::BuildDemand::test_qty_in_yield_units_mode",
            "manifest": mj,
            "beo_map": {"baked ziti": ["queso_mac_sauce"]},
            "input": {
                "mode": "build_demand",
                "invoice": [["Baked Ziti", 4.0]],
                "qty_in_yield_units": True,
            },
            "expect": {"demand": [["queso_mac_sauce", 4.0, "qt"]], "unmapped": []},
        },
    )
    written.append("build_demand_yield_units")

    beo_map = {"trio dips": ["blackened_tomato_salsa", "queso_mac_sauce"]}
    demand, unmapped = build_demand(
        [InvoiceRow("Trio Dips", 1.0)],
        manifest,
        beo_map,
        qty_in_yield_units=True,
    )
    write_fixture(
        out_dir / "build_demand_trio_multi_recipe.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "build_demand_trio_multi_recipe",
            "module": "beo_pull",
            "source_test": "tests/python/test_beo_pull.py::BuildDemand::test_single_menu_item_maps_to_multiple_recipes",
            "manifest": mj,
            "beo_map": beo_map,
            "input": {
                "mode": "build_demand",
                "invoice": [["Trio Dips", 1.0]],
                "qty_in_yield_units": True,
            },
            "expect": {
                "demand_slugs": sorted({d[0] for d in demand}),
                "unmapped_count": 0,
            },
        },
    )
    written.append("build_demand_trio_multi_recipe")

    scales = {("green chile mac buffet", "queso_mac_sauce"): 5.5}
    demand, unmapped = build_demand(
        [InvoiceRow("Green Chile Mac Buffet", 4.0)],
        manifest,
        {"green chile mac buffet": ["queso_mac_sauce"]},
        qty_in_yield_units=True,
        scales=scales,
    )
    write_fixture(
        out_dir / "build_demand_per_mapping_scale.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "build_demand_per_mapping_scale",
            "module": "beo_pull",
            "source_test": "tests/python/test_beo_pull.py::BuildDemand::test_per_mapping_scale_factor_overrides_yield_units",
            "manifest": mj,
            "beo_map": {"green chile mac buffet": ["queso_mac_sauce"]},
            "scales": [["green chile mac buffet", "queso_mac_sauce", 5.5]],
            "input": {
                "mode": "build_demand",
                "invoice": [["Green Chile Mac Buffet", 4.0]],
                "qty_in_yield_units": True,
            },
            "expect": {"demand": [["queso_mac_sauce", 22.0, "qt"]], "unmapped": []},
        },
    )
    written.append("build_demand_per_mapping_scale")

    scales = {("trio dips", "queso_mac_sauce"): 2.0}
    demand, _ = build_demand(
        [InvoiceRow("Trio Dips", 3.0)],
        manifest,
        {"trio dips": ["blackened_tomato_salsa", "queso_mac_sauce"]},
        qty_in_yield_units=True,
        scales=scales,
    )
    by_slug = {d[0]: d[1] for d in demand}
    write_fixture(
        out_dir / "build_demand_partial_scale_factor.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "build_demand_partial_scale_factor",
            "module": "beo_pull",
            "source_test": "tests/python/test_beo_pull.py::BuildDemand::test_scale_factor_only_applies_to_its_mapping",
            "manifest": mj,
            "beo_map": {"trio dips": ["blackened_tomato_salsa", "queso_mac_sauce"]},
            "scales": [["trio dips", "queso_mac_sauce", 2.0]],
            "input": {
                "mode": "build_demand",
                "invoice": [["Trio Dips", 3.0]],
                "qty_in_yield_units": True,
            },
            "expect": {
                "demand_by_slug": {
                    "queso_mac_sauce": by_slug["queso_mac_sauce"],
                    "blackened_tomato_salsa": by_slug["blackened_tomato_salsa"],
                },
            },
        },
    )
    written.append("build_demand_partial_scale_factor")

    demand, unmapped = build_demand(
        [InvoiceRow("Queso / Mac Sauce", 1.0)], manifest, {}
    )
    write_fixture(
        out_dir / "build_demand_direct_name_resolution.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "build_demand_direct_name_resolution",
            "module": "beo_pull",
            "source_test": "tests/python/test_beo_pull.py::BuildDemand::test_direct_name_resolution_fallback",
            "manifest": mj,
            "beo_map": {},
            "input": {"mode": "build_demand", "invoice": [["Queso / Mac Sauce", 1.0]]},
            "expect": {"demand": [["queso_mac_sauce", 22.0, "qt"]], "unmapped": []},
        },
    )
    written.append("build_demand_direct_name_resolution")

    # --- pull_orders ---
    beo_map = {
        "baked ziti": ["queso_mac_sauce"],
        "side salsa": ["blackened_tomato_salsa"],
    }
    invoice = [InvoiceRow("Baked Ziti", 1.0), InvoiceRow("Side Salsa", 1.0)]
    demand, _ = build_demand(invoice, manifest, beo_map)
    lines = pull_orders(manifest, demand)
    write_fixture(
        out_dir / "pull_orders_salsa_aggregated.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "pull_orders_salsa_aggregated",
            "module": "beo_pull",
            "source_test": "tests/python/test_beo_pull.py::PullOrders::test_cascade_aggregates_sub_recipe_demand",
            "manifest": mj,
            "beo_map": beo_map,
            "input": {
                "mode": "pull_orders",
                "invoice": [["Baked Ziti", 1.0], ["Side Salsa", 1.0]],
            },
            "expect": {
                "order_guide": order_lines_to_json(lines),
                "tolerance_places": 6,
            },
        },
    )
    written.append("pull_orders_salsa_aggregated")

    demand, _ = build_demand(
        [InvoiceRow("Side Salsa", 1.0)], manifest, {"side salsa": ["blackened_tomato_salsa"]}
    )
    inventory = {("roma tomatoes", "g"): 500.0, ("cilantro", "cup"): 1000.0}
    lines = pull_orders(manifest, demand, inventory=inventory)
    write_fixture(
        out_dir / "pull_orders_inventory_subtract.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "pull_orders_inventory_subtract",
            "module": "beo_pull",
            "source_test": "tests/python/test_beo_pull.py::PullOrders::test_inventory_subtracts_to_order",
            "manifest": mj,
            "beo_map": {"side salsa": ["blackened_tomato_salsa"]},
            "input": {
                "mode": "pull_orders",
                "invoice": [["Side Salsa", 1.0]],
                "inventory": [["roma tomatoes", "g", 500.0], ["cilantro", "cup", 1000.0]],
            },
            "expect": {"order_guide": order_lines_to_json(lines), "tolerance_places": 6},
        },
    )
    written.append("pull_orders_inventory_subtract")

    # --- BeoCascade ---
    cm = cascade_manifest()
    cmj = manifests_to_json(cm)
    beo_map_c = {"queso dip": ["queso_blanco"]}

    result = build_cascade(
        cm,
        beo_map_c,
        [{"item_name": "Queso Dip", "quantity": 2}],
    )
    write_fixture(
        out_dir / "cascade_order_guide_scaled.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "cascade_order_guide_scaled",
            "module": "beo_cascade",
            "source_test": "tests/python/test_beo_cascade_cli.py::BuildCascadeUnit::test_order_guide_totals_are_scaled_correctly",
            "manifest": cmj,
            "beo_map": beo_map_c,
            "input": {
                "mode": "build_cascade",
                "line_items": [{"item_name": "Queso Dip", "quantity": 2}],
            },
            "expect": {
                "order_guide_by_ingredient": {
                    row["ingredient"]: row for row in result["order_guide"]
                },
                "roma_tomatoes_total": result["order_guide"]
                and next(r["total_needed"] for r in result["order_guide"] if r["ingredient"] == "roma tomatoes"),
                "white_cheese_total": next(
                    r["total_needed"] for r in result["order_guide"] if r["ingredient"] == "white american cheese"
                ),
                "tolerance_places": 5,
            },
        },
    )
    written.append("cascade_order_guide_scaled")

    result = build_cascade(
        cm,
        beo_map_c,
        [{"item_name": "Queso Dip", "quantity": 2}],
    )
    write_fixture(
        out_dir / "cascade_prep_demands_nodes.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "cascade_prep_demands_nodes",
            "module": "beo_cascade",
            "source_test": "tests/python/test_beo_cascade_cli.py::BuildCascadeUnit::test_prep_demands_display_name_and_qty",
            "manifest": cmj,
            "beo_map": beo_map_c,
            "input": {
                "mode": "build_cascade",
                "line_items": [{"item_name": "Queso Dip", "quantity": 2}],
            },
            "expect": {
                "prep_demands": result["prep_demands"],
                "slugs": sorted({r["recipe_slug"] for r in result["prep_demands"]}),
                "tolerance_places": 5,
            },
        },
    )
    written.append("cascade_prep_demands_nodes")

    result = build_cascade(
        cm,
        beo_map_c,
        [
            {"item_name": "Queso Dip", "quantity": 2},
            {"item_name": "Mystery", "quantity": 1},
        ],
    )
    write_fixture(
        out_dir / "cascade_unmapped_mystery_item.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "cascade_unmapped_mystery_item",
            "module": "beo_cascade",
            "source_test": "tests/python/test_beo_cascade_cli.py::BuildCascadeUnit::test_unmapped_item_appears_in_unmapped",
            "manifest": cmj,
            "beo_map": beo_map_c,
            "input": {
                "mode": "build_cascade",
                "line_items": [
                    {"item_name": "Queso Dip", "quantity": 2},
                    {"item_name": "Mystery", "quantity": 1},
                ],
            },
            "expect": {
                "unmapped_menu_items": [u["menu_item"] for u in result["unmapped"]],
            },
        },
    )
    written.append("cascade_unmapped_mystery_item")

    result = build_cascade(
        cm,
        beo_map_c,
        [{"item_name": "Queso Dip", "quantity": 2}],
        inventory={("roma tomatoes", "lb"): 1.0},
    )
    write_fixture(
        out_dir / "cascade_inventory_subtract.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "cascade_inventory_subtract",
            "module": "beo_cascade",
            "source_test": "tests/python/test_beo_cascade_cli.py::BuildCascadeUnit::test_inventory_subtracted_in_order_guide",
            "manifest": cmj,
            "beo_map": beo_map_c,
            "input": {
                "mode": "build_cascade",
                "line_items": [{"item_name": "Queso Dip", "quantity": 2}],
                "inventory": [["roma tomatoes", "lb", 1.0]],
            },
            "expect": {
                "roma_row": next(r for r in result["order_guide"] if r["ingredient"] == "roma tomatoes"),
                "tolerance_places": 5,
            },
        },
    )
    written.append("cascade_inventory_subtract")

    broken = _mk(
        "broken_dip",
        "Broken Dip",
        1.0,
        "qt",
        sub_recipe_slugs=["missing_sub"],
        bom=[("missing_sub", 1.0, "qt", True)],
    )
    result = build_cascade(
        {"broken_dip": broken},
        {"broken dip": ["broken_dip"]},
        [{"item_name": "Broken Dip", "quantity": 1}],
    )
    write_fixture(
        out_dir / "cascade_missing_sub_warning.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "cascade_missing_sub_warning",
            "module": "beo_cascade",
            "source_test": "tests/python/test_beo_cascade_cli.py::BuildCascadeUnit::test_missing_sub_recipe_degrades_to_warning",
            "manifest": manifests_to_json({"broken_dip": broken}),
            "beo_map": {"broken dip": ["broken_dip"]},
            "input": {
                "mode": "build_cascade",
                "line_items": [{"item_name": "Broken Dip", "quantity": 1}],
            },
            "expect": {
                "warnings_contain": "missing_sub",
                "warnings": result["warnings"],
            },
        },
    )
    written.append("cascade_missing_sub_warning")

    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    ids = export_all(args.out.resolve())
    print(f"Wrote {len(ids)} fixtures to {args.out}")
    for fid in ids:
        print(f"  - {fid}.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
