#!/usr/bin/env python3
"""Compute ingredient requirements for a BEO client/event.

Walks the recipe graph (via scripts.lib.bom_expand) so nested sub-recipes
roll up correctly — the legacy single-level flatten would silently
under-order anything hidden inside a sub-recipe (e.g. the salsa
consumed by queso).

Exits with:
  0 — success
  2 — success but with warnings (unmapped menu items, unresolved map entries)
  1 — fatal (missing inputs, bad arguments)

Output CSV columns: `ingredient, unit, total_needed, on_hand, to_order, status`.
"""

from __future__ import annotations

import argparse
import csv
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.beo_pull import (  # noqa: E402
    load_beo_recipe_map,
    load_invoice_rows,
    build_demand,
    pull_orders,
    normalize_client,
)
from scripts.lib.bom_expand import (  # noqa: E402
    RecipeCycleError,
    UnitMismatchError,
    UnknownRecipeError,
    build_manifest,
)


# Ingredients we buy ready-made from JP / retail rather than cooking.
# Matched against the exact leaf ingredient name after expansion; no
# substring matching (which previously tagged "Prime Rib Jus" as a
# whole-protein exclusion).
DEFAULT_WHOLE_BUY_EXACT = {
    "prime rib",
    "cupcakes",
    "prime rib carving station",
}


def _latest_bom(root: Path) -> Path | None:
    boms = sorted((root / "costing").glob("bom_*.csv"))
    return boms[-1] if boms else None


def _load_inventory_csv(path: Path) -> dict[tuple[str, str], float]:
    """Read a simple inventory CSV with columns `ingredient, unit, on_hand`.

    Missing columns tolerated: if no `unit` column, all rows pair against
    an empty unit string (matched unit-agnostically in pull_orders)."""
    out: dict[tuple[str, str], float] = {}
    if not path.exists():
        return out
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            ing = (row.get("ingredient") or row.get("Ingredient") or "").strip().lower()
            if not ing:
                continue
            unit = (row.get("unit") or row.get("Unit") or "").strip().lower()
            raw = (row.get("on_hand") or row.get("On Hand") or "").strip()
            try:
                qty = float(raw)
            except ValueError:
                continue
            out[(ing, unit)] = out.get((ing, unit), 0.0) + qty
    return out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--client", required=True, help="Client name (case-insensitive)")
    p.add_argument("--date", default=None, help="Optional event date YYYY-MM-DD")
    p.add_argument("--root", type=Path, default=ROOT)
    p.add_argument(
        "--invoice-csv",
        type=Path,
        default=None,
        help="Default: workbook/data/beo_invoices.csv under --root",
    )
    p.add_argument(
        "--recipes-csv",
        type=Path,
        default=None,
        help="Default: recipes/recipe_index.csv under --root",
    )
    p.add_argument(
        "--bom-csv",
        type=Path,
        default=None,
        help="Default: latest costing/bom_*.csv under --root",
    )
    p.add_argument(
        "--map-csv",
        type=Path,
        default=None,
        help="Default: menus/beo_recipe_map.csv under --root",
    )
    p.add_argument(
        "--inventory-csv",
        type=Path,
        default=None,
        help="Optional: CSV with columns ingredient, unit, on_hand",
    )
    p.add_argument(
        "--qty-in-yield-units",
        action="store_true",
        help="Invoice Qty is already expressed in each recipe's yield unit (e.g. 4 qt). "
             "Default treats Qty as number of batches.",
    )
    p.add_argument("--output", type=Path, default=None)
    args = p.parse_args()

    root = args.root
    invoice_csv = args.invoice_csv or (root / "workbook" / "data" / "beo_invoices.csv")
    recipes_csv = args.recipes_csv or (root / "recipes" / "recipe_index.csv")
    bom_csv = args.bom_csv or _latest_bom(root)
    map_csv = args.map_csv or (root / "menus" / "beo_recipe_map.csv")

    if bom_csv is None:
        print("ERROR: no costing/bom_*.csv found under --root", file=sys.stderr)
        return 1
    for label, path in [("recipes", recipes_csv), ("bom", bom_csv), ("map", map_csv)]:
        if not Path(path).exists():
            print(f"ERROR: missing {label} CSV: {path}", file=sys.stderr)
            return 1
    if not invoice_csv.exists():
        print(f"ERROR: missing invoice CSV: {invoice_csv}", file=sys.stderr)
        return 1

    manifest = build_manifest(recipes_csv, bom_csv)
    beo_map, map_unresolved, map_scales = load_beo_recipe_map(map_csv, manifest)

    for u in map_unresolved:
        print(f"  WARN map entry skipped: {u.menu_item!r} — {u.reason}", file=sys.stderr)

    try:
        invoice_rows = load_invoice_rows(invoice_csv, args.client, event_date=args.date)
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    if not invoice_rows:
        print(
            f"ERROR: no invoice rows matched client {args.client!r}"
            f"{' on ' + args.date if args.date else ''}",
            file=sys.stderr,
        )
        print(
            "  Check for trailing whitespace, case, or misspellings in the Client column.",
            file=sys.stderr,
        )
        return 1

    demand, unmapped = build_demand(
        invoice_rows,
        manifest,
        beo_map,
        qty_in_yield_units=args.qty_in_yield_units,
        scales=map_scales,
    )
    for u in unmapped:
        print(f"  WARN invoice row skipped: {u.menu_item!r} — {u.reason}", file=sys.stderr)

    inventory = _load_inventory_csv(args.inventory_csv) if args.inventory_csv else {}
    try:
        lines = pull_orders(manifest, demand, inventory=inventory)
    except UnitMismatchError as e:
        print(f"ERROR: recipe unit mismatch — {e}", file=sys.stderr)
        print(
            "  Fix the BOM CSV so the sub-recipe line uses the child recipe's yield unit,",
            file=sys.stderr,
        )
        print(
            "  or add a pack-weight conversion in costing/vendor_pack_weights.csv.",
            file=sys.stderr,
        )
        return 1
    except RecipeCycleError as e:
        print(f"ERROR: sub-recipe cycle detected — {e}", file=sys.stderr)
        return 1
    except UnknownRecipeError as e:
        print(f"ERROR: recipe graph incomplete — {e}", file=sys.stderr)
        return 1

    if args.output:
        out_path = args.output
    else:
        d = args.date or date.today().isoformat()
        safe_client = normalize_client(args.client).replace(" ", "_") or "client"
        out_dir = root / "reports"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"beo_order_pull_{safe_client}_{d}.csv"

    with out_path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ingredient", "unit", "total_needed", "on_hand", "to_order", "status"])
        for ln in lines:
            status = "WHOLE-BUY" if ln.ingredient.strip().lower() in DEFAULT_WHOLE_BUY_EXACT else "TO_ORDER"
            if ln.to_order == 0 and ln.total_needed > 0:
                status = "IN_STOCK"
            w.writerow(
                [
                    ln.ingredient,
                    ln.unit,
                    f"{ln.total_needed:.4f}".rstrip("0").rstrip(".") or "0",
                    f"{ln.on_hand:.4f}".rstrip("0").rstrip(".") or "0",
                    f"{ln.to_order:.4f}".rstrip("0").rstrip(".") or "0",
                    status,
                ]
            )

    print(f"Wrote {len(lines)} leaf ingredient rows → {out_path}")

    if unmapped or map_unresolved:
        print(
            f"  {len(unmapped)} invoice row(s) unmapped, {len(map_unresolved)} map entries unresolved.",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
