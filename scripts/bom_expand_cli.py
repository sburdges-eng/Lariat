#!/usr/bin/env python3
"""Thin JSON-in / JSON-out CLI over scripts/lib/bom_expand.

Wraps `build_manifest_from_normalized` + `expand_recipe` so Node-side callers
(the kitchen-assistant route) can invoke the authoritative recipe-tree walker
without re-implementing it in TypeScript. One source of truth.

Input (stdin, JSON):
    {
        "recipe_slug": "pork_chop_marinade",
        "qty": 4,                    # in yield_unit OR omit and set multiplier
        "unit": "gal",               # optional; defaults to the recipe's yield_unit
        "multiplier": 2,             # optional; qty = multiplier * recipe.yield_qty
        "root": "/abs/path/to/Lariat"  # optional; defaults to two dirs up from this file
    }

Output (stdout, JSON):
    {
        "recipe_slug": "...",
        "target_qty": 4.0,
        "target_unit": "gal",
        "scale_factor": 4.0,
        "leaf_rows": [
            {"ingredient": "orange juice", "qty": 8.0, "unit": "cup"},
            ...
        ]
    }

On failure, writes `{"error": "..."}` to stdout and exits non-zero.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Make `scripts.lib.bom_expand` importable when invoked directly.
_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parent
sys.path.insert(0, str(_REPO))

from scripts.lib.bom_expand import (  # noqa: E402
    RecipeCycleError,
    UnitMismatchError,
    UnknownRecipeError,
    build_manifest_from_normalized,
    expand_recipe,
)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        _fail(f"invalid JSON on stdin: {e}")
        return 2

    if not isinstance(payload, dict):
        _fail("stdin must be a JSON object")
        return 2

    slug_arg = payload.get("recipe_slug")
    name_arg = payload.get("recipe_name")
    if not ((isinstance(slug_arg, str) and slug_arg) or (isinstance(name_arg, str) and name_arg)):
        _fail("one of `recipe_slug` or `recipe_name` (string) is required")
        return 2

    root = Path(payload.get("root") or _REPO)
    recipes_csv = root / "recipes" / "recipe_index.csv"
    normalized_dir = root / "recipes" / "normalized"

    if not recipes_csv.exists():
        _fail(f"missing recipe_index.csv at {recipes_csv}")
        return 2
    if not normalized_dir.is_dir():
        _fail(f"missing normalized dir at {normalized_dir}")
        return 2

    try:
        manifest = build_manifest_from_normalized(recipes_csv, normalized_dir)
    except Exception as e:
        _fail(f"failed to build manifest: {e}")
        return 2

    if isinstance(slug_arg, str) and slug_arg:
        slug = slug_arg
    else:
        slug = _resolve_name_to_slug(manifest, name_arg)  # type: ignore[arg-type]
        if slug is None:
            _fail(f"no recipe matches name {name_arg!r}")
            return 3

    recipe = manifest.get(slug)
    if recipe is None:
        _fail(f"unknown recipe slug: {slug!r}")
        return 3

    qty = payload.get("qty")
    multiplier = payload.get("multiplier")
    unit = payload.get("unit") or recipe.yield_unit

    if qty is None and multiplier is None:
        _fail("one of `qty` or `multiplier` is required")
        return 2
    if qty is not None and multiplier is not None:
        _fail("pass only one of `qty` or `multiplier`")
        return 2

    if qty is None:
        try:
            mult_f = float(multiplier)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            _fail("multiplier must be numeric")
            return 2
        qty_f = mult_f * recipe.yield_qty
    else:
        try:
            qty_f = float(qty)
        except (TypeError, ValueError):
            _fail("qty must be numeric")
            return 2

    try:
        leaves = expand_recipe(manifest, slug, qty_f, unit)
    except UnknownRecipeError as e:
        _fail(f"unknown sub-recipe: {e}")
        return 3
    except UnitMismatchError as e:
        _fail(f"unit mismatch: {e}")
        return 4
    except RecipeCycleError as e:
        _fail(f"recipe cycle: {e}")
        return 5
    except ValueError as e:
        _fail(f"invalid recipe: {e}")
        return 6

    scale = qty_f / recipe.yield_qty if recipe.yield_qty else 0.0
    out = {
        "recipe_slug": slug,
        "target_qty": qty_f,
        "target_unit": unit,
        "scale_factor": scale,
        "leaf_rows": [
            {"ingredient": ing, "qty": q, "unit": u}
            for (ing, u), q in sorted(leaves.items())
        ],
    }
    json.dump(out, sys.stdout)
    sys.stdout.write("\n")
    return 0


def _fail(msg: str) -> None:
    json.dump({"error": msg}, sys.stdout)
    sys.stdout.write("\n")


def _resolve_name_to_slug(manifest: dict, name: str) -> str | None:
    """Map a human recipe name to its slug. Exact slug match wins; then exact
    display_name match; then case-insensitive token-set equality on either."""
    if not isinstance(name, str) or not name.strip():
        return None
    needle = name.strip()
    if needle in manifest:
        return needle
    for slug, m in manifest.items():
        if m.display_name.lower() == needle.lower():
            return slug
    needle_toks = {t for t in needle.lower().replace("_", " ").split() if t}
    for slug, m in manifest.items():
        disp_toks = {t for t in m.display_name.lower().replace("_", " ").split() if t}
        slug_toks = {t for t in slug.lower().replace("_", " ").split() if t}
        if needle_toks and (needle_toks == disp_toks or needle_toks == slug_toks):
            return slug
    return None


if __name__ == "__main__":
    sys.exit(main())
