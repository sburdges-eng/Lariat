"""Recipe BOM expansion — the single canonical sub-recipe cascade helper.

Why this module exists:
  Multiple call sites (prep sheet, BEO order pull, costing ingest, allergen
  rollup, 86 cascade) each had their own (missing) notion of "follow sub-
  recipes into their leaf ingredients." That produced under-ordering,
  under-prepping, miscosted menus, and a dangerous allergen-merge gap. This
  module is the one place where the recipe graph gets walked; every caller
  reads the output.

Contract:
  - `build_manifest(recipe_index_csv, bom_csv)` reads the two authoritative
    files and returns `dict[slug, Manifest]`.
  - `expand_recipe(manifest, slug, qty, unit)` returns a flat dict keyed by
    (leaf_ingredient_name, unit) summing qty at those leaves.
  - `aggregate_demand(manifest, demands)` does the same for a LIST of
    top-level demands — this is the case that lets
    queso+salsa roll up correctly instead of producing two separate salsa
    rows (one hidden inside queso, one standalone).

Errors always name the offending slugs and (where relevant) the conflicting
units. Silent coercion is forbidden — see AGENTS.md rule #4.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class Manifest:
    slug: str
    display_name: str
    yield_qty: float
    yield_unit: str
    sub_recipe_slugs: list[str] = field(default_factory=list)
    bom: list[dict] = field(default_factory=list)
    allergens: list[str] = field(default_factory=list)
    # keys = from-unit (lowercased), value = (factor: float, to_unit_lower: str)
    pack_conversions: dict = field(default_factory=dict)


class UnknownRecipeError(KeyError):
    """A slug was referenced but isn't in the manifest."""


class UnitMismatchError(ValueError):
    """A demand unit doesn't match the recipe's yield_unit."""


class RecipeCycleError(ValueError):
    """Sub-recipe graph contains a cycle."""


# ---------------------------------------------------------------------------
# Expansion
# ---------------------------------------------------------------------------


LeafKey = tuple[str, str]  # (ingredient_name, unit)

# ---------------------------------------------------------------------------
# Same-dimension unit conversion (volume base = qt, mass base = g)
# ---------------------------------------------------------------------------

_VOLUME = {
    "tsp": 1 / 192,
    "tbsp": 1 / 64,
    "fl_oz": 1 / 32,
    "cup": 1 / 4,
    "pint": 1 / 2,
    "qt": 1.0,
    "gal": 4.0,
}
_MASS = {"g": 1.0, "kg": 1000.0, "oz": 28.349523125, "lb": 453.59237}


def _u(unit: str) -> str:
    return unit.strip().lower().replace(" ", "_")


def _convert(qty: float, from_unit: str, to_unit: str) -> "float | None":
    """Convert qty between same-dimension units (volume↔volume, mass↔mass).
    Returns None when the units are cross-dimension or non-dimensional."""
    f, t = _u(from_unit), _u(to_unit)
    if f == t:
        return float(qty)
    for table in (_VOLUME, _MASS):
        if f in table and t in table:
            return float(qty) * table[f] / table[t]
    return None


def _reconcile_sub_unit(
    parent_slug: str,
    sub_slug: str,
    sub_m: "Manifest",
    row_qty: float,
    row_unit: str,
) -> "tuple[float, str]":
    """Return (qty, unit) for a sub-recipe BOM row expressed in the child's yield unit.

    Same-dimension units convert exactly; otherwise the child's declared pack_size is
    tried; otherwise fail loud naming the missing pack_size."""
    if row_unit == sub_m.yield_unit:
        return float(row_qty), row_unit
    converted = _convert(row_qty, row_unit, sub_m.yield_unit)
    if converted is None:
        pc = sub_m.pack_conversions.get(_u(row_unit))
        if pc and _u(pc[1]) == _u(sub_m.yield_unit):
            converted = float(row_qty) * pc[0]
    if converted is None:
        raise UnitMismatchError(
            f"recipe {parent_slug!r} BOM references sub-recipe {sub_slug!r} with unit "
            f"{row_unit!r}, but {sub_slug!r} yields in {sub_m.yield_unit!r}; declare a "
            f"pack_size (e.g. '{_u(row_unit)}:N:{_u(sub_m.yield_unit)}') on {sub_slug!r} "
            f"in recipe_index.csv"
        )
    return converted, sub_m.yield_unit


def expand_recipe(
    manifest: dict[str, Manifest],
    slug: str,
    qty: float,
    unit: str,
) -> dict[LeafKey, float]:
    """Walk the recipe tree from `slug` and return leaf-ingredient totals
    for producing `qty` of the given `unit`.

    Raises UnknownRecipeError / UnitMismatchError / RecipeCycleError.
    """
    out: dict[LeafKey, float] = {}
    _expand_into(manifest, slug, float(qty), unit, out, visited=[])
    return out


def aggregate_demand(
    manifest: dict[str, Manifest],
    demands: Iterable[tuple[str, float, str]],
) -> dict[LeafKey, float]:
    """Expand each top-level demand and SUM the leaves.

    `demands` is an iterable of (slug, qty, unit) triples. Duplicate slugs
    are allowed; they compound. Any expansion error short-circuits the
    whole aggregation (fail-loud).
    """
    out: dict[LeafKey, float] = {}
    for slug, qty, unit in demands:
        for key, val in expand_recipe(manifest, slug, qty, unit).items():
            out[key] = out.get(key, 0.0) + val
    return out


def expand_recipe_demand(
    manifest: dict[str, Manifest],
    demands: Iterable[tuple[str, float, str]],
) -> dict[tuple[str, str], float]:
    """Aggregate per-recipe-node demand across top-level demands.

    Returns {(slug, yield_unit): total_qty} for EVERY recipe and sub-recipe
    node that must be produced to satisfy `demands`, summed. Leaf ingredients
    are NOT included (that is `aggregate_demand`'s job). Duplicate top-level
    slugs compound. Same error semantics as `expand_recipe`
    (UnknownRecipeError / UnitMismatchError / RecipeCycleError / non-positive
    yield ValueError)."""
    out: dict[tuple[str, str], float] = {}
    for slug, qty, unit in demands:
        _accumulate_recipe_demand(manifest, slug, float(qty), unit, out, visited=[])
    return out


def _accumulate_recipe_demand(
    manifest: dict[str, Manifest],
    slug: str,
    qty: float,
    unit: str,
    out: dict[tuple[str, str], float],
    visited: list[str],
) -> None:
    if slug not in manifest:
        raise UnknownRecipeError(f"recipe {slug!r} is not in the manifest")
    if slug in visited:
        path = visited[visited.index(slug):] + [slug]
        raise RecipeCycleError(
            f"sub-recipe cycle: {' -> '.join(path)}"
        )
    m = manifest[slug]
    if unit != m.yield_unit:
        raise UnitMismatchError(
            f"recipe {slug!r} yields in {m.yield_unit!r} but demand asked for "
            f"{qty!r} {unit!r}"
        )
    if m.yield_qty <= 0:
        raise ValueError(
            f"recipe {slug!r} has non-positive yield_qty {m.yield_qty}; "
            f"cannot scale"
        )

    # Record this recipe node.
    out[(slug, unit)] = out.get((slug, unit), 0.0) + qty

    scale = qty / m.yield_qty

    for row in m.bom:
        ingredient = row["ingredient"]
        row_qty = float(row["qty"])
        row_unit = row["unit"]

        sub_slug = (
            _resolve_sub_slug(manifest, m, ingredient)
            if (row.get("is_sub_recipe") or _could_be_sub(m, ingredient))
            else None
        )

        if sub_slug is not None:
            sub_m = manifest[sub_slug]
            row_qty, row_unit = _reconcile_sub_unit(slug, sub_slug, sub_m, row_qty, row_unit)
            _accumulate_recipe_demand(
                manifest,
                sub_slug,
                row_qty * scale,
                sub_m.yield_unit,
                out,
                visited + [slug],
            )
        # Leaf rows: do nothing (leaves are not recipe nodes).


def _expand_into(
    manifest: dict[str, Manifest],
    slug: str,
    qty: float,
    unit: str,
    out: dict[LeafKey, float],
    visited: list[str],
) -> None:
    if slug not in manifest:
        raise UnknownRecipeError(f"recipe {slug!r} is not in the manifest")
    if slug in visited:
        path = visited[visited.index(slug):] + [slug]
        raise RecipeCycleError(
            f"sub-recipe cycle: {' -> '.join(path)}"
        )
    m = manifest[slug]
    if unit != m.yield_unit:
        raise UnitMismatchError(
            f"recipe {slug!r} yields in {m.yield_unit!r} but demand asked for "
            f"{qty!r} {unit!r}"
        )
    if m.yield_qty <= 0:
        raise ValueError(
            f"recipe {slug!r} has non-positive yield_qty {m.yield_qty}; "
            f"cannot scale"
        )

    scale = qty / m.yield_qty

    for row in m.bom:
        ingredient = row["ingredient"]
        row_qty = float(row["qty"])
        row_unit = row["unit"]

        sub_slug = (
            _resolve_sub_slug(manifest, m, ingredient)
            if (row.get("is_sub_recipe") or _could_be_sub(m, ingredient))
            else None
        )

        if sub_slug is not None:
            sub_m = manifest[sub_slug]
            row_qty, row_unit = _reconcile_sub_unit(slug, sub_slug, sub_m, row_qty, row_unit)
            _expand_into(
                manifest,
                sub_slug,
                row_qty * scale,
                sub_m.yield_unit,
                out,
                visited + [slug],
            )
        else:
            key: LeafKey = (ingredient, row_unit)
            out[key] = out.get(key, 0.0) + row_qty * scale


# ---------------------------------------------------------------------------
# Sub-recipe name resolution
# ---------------------------------------------------------------------------


def _tokens(s: str) -> set[str]:
    return {t for t in s.strip().lower().replace("_", " ").split() if t}


def _could_be_sub(parent: Manifest, ingredient: str) -> bool:
    """Quick check: is the ingredient name potentially one of the parent's
    declared sub-recipes? Used so a BOM line missing the "(sub-recipe)"
    notes marker still cascades, if the name obviously resolves."""
    toks = _tokens(ingredient)
    if not toks:
        return False
    return any(
        toks == _tokens(slug) or toks <= _tokens(slug)
        for slug in parent.sub_recipe_slugs
    )


def _resolve_sub_slug(
    manifest: dict[str, Manifest],
    parent: Manifest,
    ingredient: str,
) -> str | None:
    """Map a parent's BOM-line ingredient name to one of its declared
    sub-recipe slugs. Matching is restricted to the parent's own
    `sub_recipe_slugs` list so "green chile" (ingredient) can never
    accidentally resolve to "Green Chili" (menu dish).

    Match order:
      1. Exact slug (after underscoring).
      2. Token-set equality vs slug tokens or display-name tokens.
      3. Token-subset: ingredient tokens are a subset of slug or display
         tokens. Permits "blackened salsa" → "blackened_tomato_salsa".
    """
    if not parent.sub_recipe_slugs:
        return None
    ing_toks = _tokens(ingredient)
    if not ing_toks:
        return None
    ing_slug_form = ingredient.strip().lower().replace(" ", "_")

    # Pass 1: exact slug
    if ing_slug_form in parent.sub_recipe_slugs:
        return ing_slug_form

    best: str | None = None
    best_overlap = -1

    for slug in parent.sub_recipe_slugs:
        sub = manifest.get(slug)
        display_toks = _tokens(sub.display_name) if sub else set()
        slug_toks = _tokens(slug)
        # Pass 2: equality
        if ing_toks == slug_toks or ing_toks == display_toks:
            return slug
        # Pass 3: subset — track overlap size to avoid picking a looser
        # match when a tighter one exists.
        for cand in (slug_toks, display_toks):
            if ing_toks and ing_toks <= cand:
                overlap = len(ing_toks & cand)
                if overlap > best_overlap:
                    best = slug
                    best_overlap = overlap

    return best


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------


def _parse_float(raw: object) -> float:
    s = "" if raw is None else str(raw).strip()
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def build_manifest(
    recipe_index_csv: Path,
    bom_csv: Path,
) -> dict[str, Manifest]:
    """Read `recipes/recipe_index.csv` and a `costing/bom_*.csv` and return
    a slug→Manifest dict suitable for `expand_recipe` / `aggregate_demand`."""
    recipe_index_csv = Path(recipe_index_csv)
    bom_csv = Path(bom_csv)

    manifest = _load_recipe_index(recipe_index_csv)

    with bom_csv.open(newline="") as f:
        for row in csv.DictReader(f):
            slug = (row.get("recipe_id") or "").strip()
            if slug not in manifest:
                continue
            notes = (row.get("notes") or "").lower()
            manifest[slug].bom.append(
                {
                    "ingredient": (row.get("ingredient") or "").strip(),
                    "qty": _parse_float(row.get("qty")),
                    "unit": (row.get("unit") or "").strip(),
                    "is_sub_recipe": "(sub-recipe)" in notes,
                }
            )

    return manifest


def build_manifest_from_normalized(
    recipe_index_csv: Path,
    normalized_dir: Path,
) -> dict[str, Manifest]:
    """Build the manifest from `recipes/recipe_index.csv` plus the per-slug
    `recipes/normalized/<slug>.csv` files (the layout Lariat actually ships).

    Each normalized CSV has columns `ingredient, qty, unit, portions_per_batch, notes`.
    Missing slug files are skipped (recipe_index may include recipes whose BOM
    hasn't been normalized yet) — the Manifest's `.bom` is left empty.
    """
    recipe_index_csv = Path(recipe_index_csv)
    normalized_dir = Path(normalized_dir)
    manifest = _load_recipe_index(recipe_index_csv)

    for slug, m in manifest.items():
        slug_csv = normalized_dir / f"{slug}.csv"
        if not slug_csv.exists():
            continue
        with slug_csv.open(newline="") as f:
            for row in csv.DictReader(f):
                notes = (row.get("notes") or "").lower()
                m.bom.append(
                    {
                        "ingredient": (row.get("ingredient") or "").strip(),
                        "qty": _parse_float(row.get("qty")),
                        "unit": (row.get("unit") or "").strip(),
                        "is_sub_recipe": "(sub-recipe)" in notes,
                    }
                )

    return manifest


def _load_recipe_index(recipe_index_csv: Path) -> dict[str, Manifest]:
    manifest: dict[str, Manifest] = {}
    with recipe_index_csv.open(newline="") as f:
        for row in csv.DictReader(f):
            slug = (row.get("recipe_id") or "").strip()
            if not slug:
                continue
            subs = [
                s.strip()
                for s in (row.get("sub_recipes") or "").split(";")
                if s.strip()
            ]
            pack_conversions: dict = {}
            for spec in (row.get("pack_size") or "").split(";"):
                parts = [p.strip().lower() for p in spec.split(":")]
                if len(parts) == 3 and parts[0] and parts[2]:
                    try:
                        pack_conversions[parts[0]] = (float(parts[1]), parts[2])
                    except ValueError:
                        pass
            manifest[slug] = Manifest(
                slug=slug,
                display_name=(row.get("recipe_name") or slug).strip(),
                yield_qty=_parse_float(row.get("yield")),
                yield_unit=(row.get("yield_unit") or "").strip(),
                sub_recipe_slugs=subs,
                pack_conversions=pack_conversions,
            )
    return manifest
