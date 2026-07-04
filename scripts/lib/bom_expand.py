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
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

# Explicit sub-recipe pin: a BOM row's notes may contain `(sub-recipe=<slug>)`
# to bind a child deterministically when the ingredient name doesn't token-match.
_PIN = re.compile(r"\(sub-recipe=([a-z0-9_]+)\)")


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
    # Chef-declared pack→yield conversions for cross-dimension sub-recipe
    # references: {from_unit_lower: (factor, yield_unit_lower)}. E.g.
    # `bag:3:qt` → {"bag": (3.0, "qt")} means 1 bag = 3 qt of this recipe.
    pack_conversions: dict = field(default_factory=dict)


class UnknownRecipeError(KeyError):
    """A slug was referenced but isn't in the manifest."""


class UnitMismatchError(ValueError):
    """A demand unit doesn't match the recipe's yield_unit."""


class RecipeCycleError(ValueError):
    """Sub-recipe graph contains a cycle."""


# ---------------------------------------------------------------------------
# Unit conversion
# ---------------------------------------------------------------------------

# Convert a demand between units WITHIN one dimension (volume or weight).
# Cross-dimension (lb vs qt) or pack/count units (bag, case, ea) return None,
# so the caller can fail loud or, given a warnings sink, degrade gracefully.
_VOLUME_TO_QT = {
    "tsp": 1 / 192, "teaspoon": 1 / 192,
    "tbsp": 1 / 64, "tablespoon": 1 / 64,
    "floz": 1 / 32, "fl oz": 1 / 32,
    "cup": 1 / 4, "c": 1 / 4,
    "pt": 1 / 2, "pint": 1 / 2,
    "qt": 1.0, "quart": 1.0,
    "gal": 4.0, "gallon": 4.0,
    "ml": 0.00105668821, "l": 1.05668821, "liter": 1.05668821, "litre": 1.05668821,
}
_WEIGHT_TO_LB = {
    "oz": 1 / 16, "ounce": 1 / 16,
    "lb": 1.0, "lbs": 1.0, "pound": 1.0, "#": 1.0,
    "g": 0.00220462262, "gram": 0.00220462262,
    "kg": 2.20462262, "kilogram": 2.20462262,
}
_DIMENSIONS = (_VOLUME_TO_QT, _WEIGHT_TO_LB)


def convert_qty(qty: float, from_unit: str, to_unit: str) -> float | None:
    """Convert `qty` from `from_unit` to `to_unit` when both share a dimension
    (all-volume or all-weight). Returns None when they don't — the caller
    decides whether to raise UnitMismatchError or skip with a warning. A
    case-insensitive exact-unit match returns `qty` unchanged."""
    f = from_unit.strip().lower()
    t = to_unit.strip().lower()
    if f == t:
        return qty
    for table in _DIMENSIONS:
        if f in table and t in table:
            return qty * table[f] / table[t]
    return None


def _u(unit: str) -> str:
    return unit.strip().lower()


def _reconcile_sub_unit_qty(sub_m: Manifest, qty: float, from_unit: str) -> float | None:
    """Convert `qty from_unit` into `sub_m.yield_unit`. Same-dimension units
    convert exactly; otherwise the child's declared `pack_size` resolves a
    cross-dimension/pack unit (e.g. 'bag'); otherwise None (caller fails loud
    or degrades). No quantities are ever invented."""
    direct = convert_qty(qty, from_unit, sub_m.yield_unit)
    if direct is not None:
        return direct
    pc = sub_m.pack_conversions.get(_u(from_unit))
    if pc is not None:
        factor, pack_yield_unit = pc
        packed = qty * factor
        if _u(pack_yield_unit) == _u(sub_m.yield_unit):
            return packed
        # pack declares a different (but possibly same-dimension) yield unit.
        return convert_qty(packed, pack_yield_unit, sub_m.yield_unit)
    return None


def _sub_unit_mismatch_msg(
    parent_slug: str, sub_slug: str, sub_m: Manifest, row_unit: str
) -> str:
    return (
        f"recipe {parent_slug!r} BOM references sub-recipe {sub_slug!r} with unit "
        f"{row_unit!r}, but {sub_slug!r} yields in {sub_m.yield_unit!r}; declare a "
        f"pack_size (e.g. '{_u(row_unit)}:N:{_u(sub_m.yield_unit)}') on {sub_slug!r} "
        f"in recipe_index.csv"
    )


# ---------------------------------------------------------------------------
# Expansion
# ---------------------------------------------------------------------------


LeafKey = tuple[str, str]  # (ingredient_name, unit)


def expand_recipe(
    manifest: dict[str, Manifest],
    slug: str,
    qty: float,
    unit: str,
    warnings: list[str] | None = None,
) -> dict[LeafKey, float]:
    """Walk the recipe tree from `slug` and return leaf-ingredient totals
    for producing `qty` of the given `unit`.

    Compatible units (same dimension) are converted. When `warnings` is None
    (default), an unresolvable node raises UnknownRecipeError /
    UnitMismatchError / RecipeCycleError. When `warnings` is a list, the
    offending BOM row is skipped and a message is appended instead, so the
    rest of the tree still expands (graceful degradation).
    """
    out: dict[LeafKey, float] = {}
    _expand_into(manifest, slug, float(qty), unit, out, visited=[], warnings=warnings)
    return out


def aggregate_demand(
    manifest: dict[str, Manifest],
    demands: Iterable[tuple[str, float, str]],
    warnings: list[str] | None = None,
) -> dict[LeafKey, float]:
    """Expand each top-level demand and SUM the leaves.

    `demands` is an iterable of (slug, qty, unit) triples. Duplicate slugs
    are allowed; they compound. With `warnings` None, any expansion error
    short-circuits the whole aggregation (fail-loud); with a warnings list,
    offending BOM rows are skipped and recorded so the rest still sums.
    """
    out: dict[LeafKey, float] = {}
    for slug, qty, unit in demands:
        for key, val in expand_recipe(manifest, slug, qty, unit, warnings=warnings).items():
            out[key] = out.get(key, 0.0) + val
    return out


def expand_recipe_demand(
    manifest: dict[str, Manifest],
    demands: Iterable[tuple[str, float, str]],
    warnings: list[str] | None = None,
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
        _accumulate_recipe_demand(
            manifest, slug, float(qty), unit, out, visited=[], warnings=warnings
        )
    return out


def _accumulate_recipe_demand(
    manifest: dict[str, Manifest],
    slug: str,
    qty: float,
    unit: str,
    out: dict[tuple[str, str], float],
    visited: list[str],
    warnings: list[str] | None = None,
) -> None:
    if slug not in manifest:
        msg = f"recipe {slug!r} is not in the manifest"
        if warnings is None:
            raise UnknownRecipeError(msg)
        warnings.append(msg)
        return
    if slug in visited:
        path = visited[visited.index(slug):] + [slug]
        msg = f"sub-recipe cycle: {' -> '.join(path)}"
        if warnings is None:
            raise RecipeCycleError(msg)
        warnings.append(msg)
        return
    m = manifest[slug]
    if unit != m.yield_unit:
        converted = convert_qty(qty, unit, m.yield_unit)
        if converted is None:
            msg = (
                f"recipe {slug!r} yields in {m.yield_unit!r} but demand asked for "
                f"{qty!r} {unit!r}"
            )
            if warnings is None:
                raise UnitMismatchError(msg)
            warnings.append(msg)
            return
        qty, unit = converted, m.yield_unit
    if m.yield_qty <= 0:
        msg = f"recipe {slug!r} has non-positive yield_qty {m.yield_qty}; cannot scale"
        if warnings is None:
            raise ValueError(msg)
        warnings.append(msg)
        return

    # Record this recipe node.
    out[(slug, unit)] = out.get((slug, unit), 0.0) + qty

    scale = qty / m.yield_qty

    for row in m.bom:
        ingredient = row["ingredient"]
        row_qty = float(row["qty"])
        row_unit = row["unit"]

        sub_slug = row.get("sub_slug")
        if sub_slug is None and (
            row.get("is_sub_recipe") or _could_be_sub(m, ingredient, manifest)
        ):
            sub_slug = _resolve_sub_slug(manifest, m, ingredient)

        if sub_slug is not None and sub_slug not in manifest:
            msg = f"recipe {slug!r} pins sub-recipe {sub_slug!r} which is not in the manifest"
            if warnings is None:
                raise UnknownRecipeError(msg)
            warnings.append(msg)
            continue

        if sub_slug is not None:
            sub_m = manifest[sub_slug]
            demand_qty = row_qty * scale
            if row_unit != sub_m.yield_unit:
                converted = _reconcile_sub_unit_qty(sub_m, demand_qty, row_unit)
                if converted is None:
                    msg = _sub_unit_mismatch_msg(slug, sub_slug, sub_m, row_unit)
                    if warnings is None:
                        raise UnitMismatchError(msg)
                    warnings.append(msg)
                    continue
                demand_qty = converted
            _accumulate_recipe_demand(
                manifest,
                sub_slug,
                demand_qty,
                sub_m.yield_unit,
                out,
                visited + [slug],
                warnings=warnings,
            )
        # Leaf rows: do nothing (leaves are not recipe nodes).


def _expand_into(
    manifest: dict[str, Manifest],
    slug: str,
    qty: float,
    unit: str,
    out: dict[LeafKey, float],
    visited: list[str],
    warnings: list[str] | None = None,
) -> None:
    if slug not in manifest:
        msg = f"recipe {slug!r} is not in the manifest"
        if warnings is None:
            raise UnknownRecipeError(msg)
        warnings.append(msg)
        return
    if slug in visited:
        path = visited[visited.index(slug):] + [slug]
        msg = f"sub-recipe cycle: {' -> '.join(path)}"
        if warnings is None:
            raise RecipeCycleError(msg)
        warnings.append(msg)
        return
    m = manifest[slug]
    if unit != m.yield_unit:
        converted = convert_qty(qty, unit, m.yield_unit)
        if converted is None:
            msg = (
                f"recipe {slug!r} yields in {m.yield_unit!r} but demand asked for "
                f"{qty!r} {unit!r}"
            )
            if warnings is None:
                raise UnitMismatchError(msg)
            warnings.append(msg)
            return
        qty, unit = converted, m.yield_unit
    if m.yield_qty <= 0:
        msg = f"recipe {slug!r} has non-positive yield_qty {m.yield_qty}; cannot scale"
        if warnings is None:
            raise ValueError(msg)
        warnings.append(msg)
        return

    scale = qty / m.yield_qty

    for row in m.bom:
        ingredient = row["ingredient"]
        row_qty = float(row["qty"])
        row_unit = row["unit"]

        sub_slug = row.get("sub_slug")
        if sub_slug is None and (
            row.get("is_sub_recipe") or _could_be_sub(m, ingredient, manifest)
        ):
            sub_slug = _resolve_sub_slug(manifest, m, ingredient)

        if sub_slug is not None and sub_slug not in manifest:
            msg = f"recipe {slug!r} pins sub-recipe {sub_slug!r} which is not in the manifest"
            if warnings is None:
                raise UnknownRecipeError(msg)
            warnings.append(msg)
            continue

        if sub_slug is not None:
            sub_m = manifest[sub_slug]
            demand_qty = row_qty * scale
            if row_unit != sub_m.yield_unit:
                converted = _reconcile_sub_unit_qty(sub_m, demand_qty, row_unit)
                if converted is None:
                    msg = _sub_unit_mismatch_msg(slug, sub_slug, sub_m, row_unit)
                    if warnings is None:
                        raise UnitMismatchError(msg)
                    warnings.append(msg)
                    continue
                demand_qty = converted
            _expand_into(
                manifest,
                sub_slug,
                demand_qty,
                sub_m.yield_unit,
                out,
                visited + [slug],
                warnings=warnings,
            )
        else:
            key: LeafKey = (ingredient, row_unit)
            out[key] = out.get(key, 0.0) + row_qty * scale


# ---------------------------------------------------------------------------
# Sub-recipe name resolution
# ---------------------------------------------------------------------------


def _tokens(s: str) -> set[str]:
    return {t for t in s.strip().lower().replace("_", " ").split() if t}


def _could_be_sub(
    parent: Manifest,
    ingredient: str,
    manifest: dict[str, Manifest] | None = None,
) -> bool:
    """Quick check: is the ingredient name potentially one of the parent's
    declared sub-recipes? Used so a BOM line missing the "(sub-recipe)"
    notes marker still cascades, if the name obviously resolves. When
    `manifest` is provided, the child's display-name tokens are also
    considered (a row may name a sub by its display name, not its slug)."""
    toks = _tokens(ingredient)
    if not toks:
        return False
    for slug in parent.sub_recipe_slugs:
        cands = [_tokens(slug)]
        if manifest is not None:
            sub = manifest.get(slug)
            if sub is not None:
                cands.append(_tokens(sub.display_name))
        if any(toks == c or toks <= c for c in cands):
            return True
    return False


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
            pin = _PIN.search(notes)
            manifest[slug].bom.append(
                {
                    "ingredient": (row.get("ingredient") or "").strip(),
                    "qty": _parse_float(row.get("qty")),
                    "unit": (row.get("unit") or "").strip(),
                    "is_sub_recipe": ("(sub-recipe)" in notes) or bool(pin),
                    "sub_slug": pin.group(1) if pin else None,
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
                pin = _PIN.search(notes)
                m.bom.append(
                    {
                        "ingredient": (row.get("ingredient") or "").strip(),
                        "qty": _parse_float(row.get("qty")),
                        "unit": (row.get("unit") or "").strip(),
                        "is_sub_recipe": ("(sub-recipe)" in notes) or bool(pin),
                        "sub_slug": pin.group(1) if pin else None,
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
            # Optional pack_size column: ";"-separated `<unit>:<factor>:<yield_unit>`
            # specs declared on the child recipe (empty by default).
            pack_conversions: dict = {}
            for spec in (row.get("pack_size") or "").split(";"):
                parts = [p.strip() for p in spec.split(":")]
                if len(parts) == 3 and all(parts):
                    try:
                        pack_conversions[parts[0].lower()] = (
                            float(parts[1]),
                            parts[2].lower(),
                        )
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


# ---------------------------------------------------------------------------
# Manifest integrity warnings
# ---------------------------------------------------------------------------


def find_manifest_warnings(manifest: dict[str, Manifest]) -> list[dict]:
    """Surface each declared `sub_recipe_slugs` entry that NO BOM row of the
    parent references (via an explicit `(sub-recipe=slug)` pin or name
    resolution). An orphan declaration is silently never produced — this makes
    it visible without aborting (it is not a unit mismatch, so it never fails
    loud). Returns `[{"recipe", "sub_slug", "issue"}]`, empty when all clean."""
    out: list[dict] = []
    for slug, m in manifest.items():
        referenced: set[str] = set()
        for row in m.bom:
            pin = row.get("sub_slug")
            if pin:
                referenced.add(pin)
            elif row.get("is_sub_recipe") or _could_be_sub(m, row["ingredient"], manifest):
                resolved = _resolve_sub_slug(manifest, m, row["ingredient"])
                if resolved:
                    referenced.add(resolved)
        for declared in m.sub_recipe_slugs:
            if declared not in referenced:
                out.append(
                    {
                        "recipe": slug,
                        "sub_slug": declared,
                        "issue": f"declares sub-recipe {declared!r} but no BOM row references it",
                    }
                )
    return out
