#!/usr/bin/env python3
"""Dev-only: export golden BomExpand fixtures to JSON for Swift parity tests.

Writes to LariatNative/Tests/Fixtures/BomExpand/*.json — not part of any app target.
Re-run after Python oracle changes; commit the JSON alongside test updates.

Usage (from repo root):
  python3 scripts/dev/export_bom_expand_fixtures.py
  python3 scripts/dev/export_bom_expand_fixtures.py --out LariatNative/Tests/Fixtures/BomExpand
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.bom_expand import (  # noqa: E402
    Manifest,
    UnitMismatchError,
    aggregate_demand,
    build_manifest_from_normalized,
    expand_recipe,
    expand_recipe_demand,
    find_manifest_warnings,
)

SCHEMA_VERSION = 1
DEFAULT_OUT = ROOT / "LariatNative" / "Tests" / "Fixtures" / "BomExpand"


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


def leaves_to_list(leaves: dict[tuple[str, str], float]) -> list[list[Any]]:
    return [[ing, unit, qty] for (ing, unit), qty in sorted(leaves.items())]


def nodes_to_list(nodes: dict[tuple[str, str], float]) -> list[list[Any]]:
    return [[slug, unit, qty] for (slug, unit), qty in sorted(nodes.items())]


def salsa_queso_manifest() -> dict[str, Manifest]:
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


def write_fixture(path: Path, doc: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        json.dump(doc, f, indent=2, sort_keys=False)
        f.write("\n")


def export_synthetic_fixtures(out_dir: Path) -> list[str]:
    written: list[str] = []

    # 1 single_leaf_scale
    salsa_only = _mk(
        "blackened_tomato_salsa",
        "Blackened Tomato Salsa",
        20,
        "qt",
        bom=[
            ("roma tomatoes", 11339.8, "g", False),
            ("lime juice", 118.294, "ml", False),
        ],
    )
    manifest = {"blackened_tomato_salsa": salsa_only}
    leaves = expand_recipe(manifest, "blackened_tomato_salsa", qty=10, unit="qt")
    write_fixture(
        out_dir / "single_leaf_scale.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "single_leaf_scale",
            "source_test": "tests/python/test_bom_expand.py::ExpandLeafOnly::test_single_leaf_recipe_scales_linearly",
            "manifest": {k: manifest_to_dict(v) for k, v in manifest.items()},
            "input": {
                "slug": "blackened_tomato_salsa",
                "qty": 10,
                "unit": "qt",
                "mode": "expand_recipe",
            },
            "expect": {"leaves": leaves_to_list(leaves), "tolerance_places": 6},
        },
    )
    written.append("single_leaf_scale")

    # 2–3 queso + salsa
    manifest = salsa_queso_manifest()
    leaves = expand_recipe(manifest, "queso_mac_sauce", qty=22, unit="qt")
    write_fixture(
        out_dir / "queso_embeds_salsa.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "queso_embeds_salsa",
            "source_test": "tests/python/test_bom_expand.py::ExpandWithSubRecipe::test_queso_expansion_pulls_salsa_leaves",
            "manifest": {k: manifest_to_dict(v) for k, v in manifest.items()},
            "input": {"slug": "queso_mac_sauce", "qty": 22, "unit": "qt", "mode": "expand_recipe"},
            "expect": {"leaves": leaves_to_list(leaves), "tolerance_places": 6},
        },
    )
    written.append("queso_embeds_salsa")

    demand = [("queso_mac_sauce", 22, "qt"), ("blackened_tomato_salsa", 4, "qt")]
    leaves = aggregate_demand(manifest, demand)
    write_fixture(
        out_dir / "queso_plus_standalone_salsa.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "queso_plus_standalone_salsa",
            "source_test": "tests/python/test_bom_expand.py::ExpandWithSubRecipe::test_queso_plus_standalone_salsa_aggregates",
            "manifest": {k: manifest_to_dict(v) for k, v in manifest.items()},
            "input": {"demands": demand, "mode": "aggregate_demand"},
            "expect": {"leaves": leaves_to_list(leaves), "tolerance_places": 6},
        },
    )
    written.append("queso_plus_standalone_salsa")

    # 4 cycle_a_b
    a = _mk("a", "A", 10, "qt", sub_recipe_slugs=["b"], bom=[("b", 1, "qt", True)])
    b = _mk("b", "B", 10, "qt", sub_recipe_slugs=["a"], bom=[("a", 1, "qt", True)])
    manifest = {"a": a, "b": b}
    write_fixture(
        out_dir / "cycle_a_b.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "cycle_a_b",
            "source_test": "tests/python/test_bom_expand.py::Errors::test_cycle_detected",
            "manifest": {k: manifest_to_dict(v) for k, v in manifest.items()},
            "input": {"slug": "a", "qty": 5, "unit": "qt", "mode": "expand_recipe"},
            "expect": {
                "error": "RecipeCycleError",
                "message_contains": ["a", "b"],
            },
        },
    )
    written.append("cycle_a_b")

    # 5 unit_mismatch_top
    salsa = _mk(
        "blackened_tomato_salsa",
        "Blackened Tomato Salsa",
        20,
        "qt",
        bom=[("roma tomatoes", 11339.8, "g", False)],
    )
    manifest = {"blackened_tomato_salsa": salsa}
    write_fixture(
        out_dir / "unit_mismatch_top.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "unit_mismatch_top",
            "source_test": "tests/python/test_bom_expand.py::Errors::test_unit_mismatch_top_level",
            "manifest": {k: manifest_to_dict(v) for k, v in manifest.items()},
            "input": {"slug": "blackened_tomato_salsa", "qty": 1, "unit": "lb", "mode": "expand_recipe"},
            "expect": {"error": "UnitMismatchError"},
        },
    )
    written.append("unit_mismatch_top")

    # 6 unit_mismatch_sub_bag
    salsa = _mk(
        "blackened_tomato_salsa",
        "Blackened Tomato Salsa",
        20,
        "qt",
        bom=[("roma tomatoes", 100, "g", False)],
    )
    queso = _mk(
        "queso_mac_sauce",
        "Queso",
        22,
        "qt",
        sub_recipe_slugs=["blackened_tomato_salsa"],
        bom=[("blackened_tomato_salsa", 1, "bag", True)],
    )
    manifest = {"blackened_tomato_salsa": salsa, "queso_mac_sauce": queso}
    write_fixture(
        out_dir / "unit_mismatch_sub_bag.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "unit_mismatch_sub_bag",
            "source_test": "tests/python/test_bom_expand.py::Errors::test_sub_recipe_unit_mismatch_fails_loud",
            "manifest": {k: manifest_to_dict(v) for k, v in manifest.items()},
            "input": {"slug": "queso_mac_sauce", "qty": 22, "unit": "qt", "mode": "expand_recipe"},
            "expect": {
                "error": "UnitMismatchError",
                "message_contains": ["queso_mac_sauce", "blackened_tomato_salsa", "bag"],
            },
        },
    )
    written.append("unit_mismatch_sub_bag")

    # 7 pack_size_bag_to_qt
    gc = _mk(
        "green_chile",
        "Green Chile",
        6,
        "qt",
        bom=[("pork", 12, "lb", False)],
        pack_conversions={"bag": (3.0, "qt")},
    )
    queso = _mk(
        "queso",
        "Queso",
        22,
        "qt",
        sub_recipe_slugs=["green_chile"],
        bom=[("green_chile", 1, "bag", True)],
    )
    manifest = {"green_chile": gc, "queso": queso}
    leaves = expand_recipe(manifest, "queso", qty=22, unit="qt")
    write_fixture(
        out_dir / "pack_size_bag_to_qt.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "pack_size_bag_to_qt",
            "source_test": "tests/python/test_bom_expand.py::PackSizeConversion::test_pack_size_resolves_cross_dimension_boundary",
            "manifest": {k: manifest_to_dict(v) for k, v in manifest.items()},
            "input": {"slug": "queso", "qty": 22, "unit": "qt", "mode": "expand_recipe"},
            "expect": {"leaves": leaves_to_list(leaves), "tolerance_places": 6},
        },
    )
    written.append("pack_size_bag_to_qt")

    # 8 graceful_skip_bad_sub
    gc = _mk("green_chile", "Green Chile", 8, "qt", bom=[("pork", 10, "lb", False)])
    queso = _mk(
        "queso_mac_sauce",
        "Queso",
        22,
        "qt",
        sub_recipe_slugs=["green_chile"],
        bom=[("heavy cream", 3, "qt", False), ("green_chile", 1, "bag", True)],
    )
    manifest = {"green_chile": gc, "queso_mac_sauce": queso}
    warnings: list[str] = []
    leaves = expand_recipe(manifest, "queso_mac_sauce", qty=22, unit="qt", warnings=warnings)
    write_fixture(
        out_dir / "graceful_skip_bad_sub.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "graceful_skip_bad_sub",
            "source_test": "tests/python/test_bom_expand.py::GracefulDegradation::test_incompatible_sub_row_skipped_rest_kept",
            "manifest": {k: manifest_to_dict(v) for k, v in manifest.items()},
            "input": {
                "slug": "queso_mac_sauce",
                "qty": 22,
                "unit": "qt",
                "mode": "expand_recipe",
                "collect_warnings": True,
            },
            "expect": {
                "leaves": leaves_to_list(leaves),
                "warnings": warnings,
                "warning_count": 1,
                "warning_contains": ["green_chile"],
                "tolerance_places": 6,
            },
        },
    )
    written.append("graceful_skip_bad_sub")

    # 9 explicit_sub_recipe_pin
    seasoning = _mk("qb_seasoning", "QB Seasoning", 4, "qt", bom=[("salt", 2, "qt", False)])
    birria = _mk(
        "birria",
        "Birria",
        16,
        "qt",
        sub_recipe_slugs=["qb_seasoning"],
        bom=[("birria seasoning", 1, "qt", True, "qb_seasoning")],
    )
    manifest = {"qb_seasoning": seasoning, "birria": birria}
    leaves = expand_recipe(manifest, "birria", qty=16, unit="qt")
    write_fixture(
        out_dir / "explicit_sub_recipe_pin.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "explicit_sub_recipe_pin",
            "source_test": "tests/python/test_bom_expand.py::ExplicitSubRecipePin::test_pin_binds_child_when_name_mismatches",
            "manifest": {k: manifest_to_dict(v) for k, v in manifest.items()},
            "input": {"slug": "birria", "qty": 16, "unit": "qt", "mode": "expand_recipe"},
            "expect": {"leaves": leaves_to_list(leaves), "tolerance_places": 6},
        },
    )
    written.append("explicit_sub_recipe_pin")

    # 10–11 expand_recipe_demand
    manifest = salsa_queso_manifest()
    nodes = expand_recipe_demand(manifest, [("queso_mac_sauce", 11, "qt")])
    write_fixture(
        out_dir / "expand_recipe_demand_half_batch.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "expand_recipe_demand_half_batch",
            "source_test": "tests/python/test_bom_expand.py::ExpandRecipeDemand::test_sub_recipe_scaled_for_half_batch",
            "manifest": {k: manifest_to_dict(v) for k, v in manifest.items()},
            "input": {"demands": [("queso_mac_sauce", 11, "qt")], "mode": "expand_recipe_demand"},
            "expect": {"nodes": nodes_to_list(nodes), "tolerance_places": 6},
        },
    )
    written.append("expand_recipe_demand_half_batch")

    demands = [("queso_mac_sauce", 22, "qt"), ("blackened_tomato_salsa", 4, "qt")]
    nodes = expand_recipe_demand(manifest, demands)
    write_fixture(
        out_dir / "expand_recipe_demand_compound_salsa.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "expand_recipe_demand_compound_salsa",
            "source_test": "tests/python/test_bom_expand.py::ExpandRecipeDemand::test_two_demands_sharing_sub_recipe_compound",
            "manifest": {k: manifest_to_dict(v) for k, v in manifest.items()},
            "input": {"demands": demands, "mode": "expand_recipe_demand"},
            "expect": {"nodes": nodes_to_list(nodes), "tolerance_places": 6},
        },
    )
    written.append("expand_recipe_demand_compound_salsa")

    # 12 manifest_warning_orphan_sub
    flour = _mk("beer_flour", "Beer Flour", 4, "qt", bom=[("flour", 2, "qt", False)])
    batter = _mk(
        "beer_batter",
        "Beer Batter",
        8,
        "qt",
        sub_recipe_slugs=["beer_flour"],
        bom=[("water", 3, "qt", False)],
    )
    manifest = {"beer_flour": flour, "beer_batter": batter}
    warns = find_manifest_warnings(manifest)
    write_fixture(
        out_dir / "manifest_warning_orphan_sub.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "manifest_warning_orphan_sub",
            "source_test": "tests/python/test_bom_expand.py::ManifestWarnings::test_unreferenced_declared_sub_is_warned",
            "manifest": {k: manifest_to_dict(v) for k, v in manifest.items()},
            "input": {"mode": "find_manifest_warnings"},
            "expect": {
                "warnings": warns,
                "warning_pairs": [["beer_batter", "beer_flour"]],
            },
        },
    )
    written.append("manifest_warning_orphan_sub")

    # 13 cup_to_qt_sub_reference
    aioli = _mk("chipotle_aioli", "Chipotle Aioli", 4, "qt", bom=[("mayo", 3, "qt", False)])
    slaw = _mk(
        "mexi_slaw",
        "Mexi Slaw",
        10,
        "qt",
        sub_recipe_slugs=["chipotle_aioli"],
        bom=[("chipotle_aioli", 4, "cup", True)],
    )
    manifest = {"chipotle_aioli": aioli, "mexi_slaw": slaw}
    leaves = expand_recipe(manifest, "mexi_slaw", qty=10, unit="qt")
    write_fixture(
        out_dir / "cup_to_qt_sub_reference.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "cup_to_qt_sub_reference",
            "source_test": "tests/python/test_bom_expand.py::UnitConversion::test_sub_recipe_compatible_unit_converts",
            "manifest": {k: manifest_to_dict(v) for k, v in manifest.items()},
            "input": {"slug": "mexi_slaw", "qty": 10, "unit": "qt", "mode": "expand_recipe"},
            "expect": {"leaves": leaves_to_list(leaves), "tolerance_places": 6},
        },
    )
    written.append("cup_to_qt_sub_reference")

    # 14 gal_demand_on_qt_recipe
    soup = _mk("soup", "Soup", 8, "qt", bom=[("stock", 6, "qt", False)])
    manifest = {"soup": soup}
    leaves = expand_recipe(manifest, "soup", qty=1, unit="gal")
    write_fixture(
        out_dir / "gal_demand_on_qt_recipe.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "gal_demand_on_qt_recipe",
            "source_test": "tests/python/test_bom_expand.py::UnitConversion::test_top_level_compatible_unit_converts",
            "manifest": {k: manifest_to_dict(v) for k, v in manifest.items()},
            "input": {"slug": "soup", "qty": 1, "unit": "gal", "mode": "expand_recipe"},
            "expect": {"leaves": leaves_to_list(leaves), "tolerance_places": 6},
        },
    )
    written.append("gal_demand_on_qt_recipe")

    return written


def export_real_fixtures(out_dir: Path) -> list[str]:
    written: list[str] = []
    recipe_index = ROOT / "recipes" / "recipe_index.csv"
    normalized = ROOT / "recipes" / "normalized"
    if not recipe_index.exists() or not normalized.is_dir():
        print("WARN: recipes/ missing — skipping real-CSV fixtures", file=sys.stderr)
        return written

    manifest = build_manifest_from_normalized(recipe_index, normalized)

    # 15 pork_chop_marinade_2x — inline manifest subset (full loader test is Wave C)
    if "pork_chop_marinade" in manifest:
        subset = {"pork_chop_marinade": manifest["pork_chop_marinade"]}
        leaves = expand_recipe(subset, "pork_chop_marinade", qty=2, unit="gal")
        write_fixture(
            out_dir / "pork_chop_marinade_2x.json",
            {
                "schema_version": SCHEMA_VERSION,
                "id": "pork_chop_marinade_2x",
                "source_test": "tests/js/test-recipe-calculator.mjs::scales a recipe to the exact leaf totals",
                "manifest_source": {
                    "recipe_index": "recipes/recipe_index.csv",
                    "normalized_dir": "recipes/normalized",
                    "slug": "pork_chop_marinade",
                },
                "manifest": {k: manifest_to_dict(v) for k, v in subset.items()},
                "input": {"slug": "pork_chop_marinade", "qty": 2, "unit": "gal", "mode": "expand_recipe"},
                "expect": {"leaves": leaves_to_list(leaves), "tolerance_places": 6},
            },
        )
        written.append("pork_chop_marinade_2x")
    else:
        print("WARN: pork_chop_marinade missing from manifest", file=sys.stderr)

    # canary — synthetic reproduction of costing-BOM bag mismatch (costing/ absent in checkout)
    gc = _mk("green_chile", "Green Chile", 8, "qt", bom=[("pork", 10, "lb", False)])
    queso = _mk(
        "queso_mac_sauce",
        "Queso / Mac Sauce",
        22,
        "qt",
        sub_recipe_slugs=["green_chile", "blackened_tomato_salsa"],
        bom=[
            ("whole milk", 7570.82, "ml", False),
            ("green_chile", 1, "bag", True),
            ("blackened_tomato_salsa", 2.0, "qt", True),
        ],
    )
    salsa = salsa_queso_manifest()["blackened_tomato_salsa"]
    canary_manifest = {
        "green_chile": gc,
        "queso_mac_sauce": queso,
        "blackened_tomato_salsa": salsa,
    }
    try:
        expand_recipe(canary_manifest, "queso_mac_sauce", qty=4, unit="qt")
        raise RuntimeError("canary fixture must raise UnitMismatchError")
    except UnitMismatchError as exc:
        msg = str(exc)
    write_fixture(
        out_dir / "canary_queso_green_chile_bag.json",
        {
            "schema_version": SCHEMA_VERSION,
            "id": "canary_queso_green_chile_bag",
            "source_test": "tests/python/test_bom_expand.py::ManifestFromCsvs::test_queso_bom_has_known_unit_mismatch",
            "notes": (
                "Synthetic reproduction of historical costing BOM bag→qt gap. "
                "Normalized recipes/ layout uses qt for green_chile and does not "
                "trigger this error; keep fixture until pack_size or BOM is fixed "
                "and oracle test updated."
            ),
            "manifest": {k: manifest_to_dict(v) for k, v in canary_manifest.items()},
            "input": {"slug": "queso_mac_sauce", "qty": 4, "unit": "qt", "mode": "expand_recipe"},
            "expect": {
                "error": "UnitMismatchError",
                "message_contains": ["queso_mac_sauce", "green_chile", "bag"],
                "sample_message": msg,
            },
        },
    )
    written.append("canary_queso_green_chile_bag")

    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    out_dir = args.out.resolve()

    ids = export_synthetic_fixtures(out_dir) + export_real_fixtures(out_dir)
    print(f"Wrote {len(ids)} fixtures to {out_dir}")
    for fid in ids:
        print(f"  - {fid}.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
