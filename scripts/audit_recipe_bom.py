#!/usr/bin/env python3
"""Audit recipe index ↔ normalized BOM integrity.

Fails loud on:
  - index slug missing normalized CSV (and orphan normalized CSVs)
  - declared sub_recipes not referenced by any BOM pin/name (beer_flour allowlisted)
  - expand warnings that skip a declared sub-recipe (portion/pack_size class)
  - BOM sub-recipe notes without ``(sub-recipe=<slug>)`` when name won't resolve
  - vendor ``green chile`` linked to a recipe in the BEO tree (ghost stew guard)
  - acceptance regressions: mexican_dinner / birria / queso chile rule
"""
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.bom_expand import (  # noqa: E402
    _PIN,
    _resolve_sub_slug,
    build_manifest_from_normalized,
    expand_recipe,
    find_manifest_warnings,
)

INDEX = ROOT / "recipes" / "recipe_index.csv"
NORMALIZED = ROOT / "recipes" / "normalized"
BEO_TREE = ROOT / "data" / "cache" / "beo_recipe_tree.json"

# beer_batter wet BOM intentionally omits beer_flour — dry mix at service.
ALLOWLIST_UNREFERENCED_SUBS = frozenset({"beer_flour"})

# Vendor diced chile must stay a purchased leaf, never house green_chilli.
LEAF_NEVER_LINK = frozenset({"green chile"})

_UNPINNED_SUB = re.compile(r"\(sub-recipe\)(?!=)", re.I)


def _load_index_slugs() -> list[str]:
    with INDEX.open(newline="") as f:
        return [
            (row.get("recipe_id") or "").strip()
            for row in csv.DictReader(f)
            if (row.get("recipe_id") or "").strip()
        ]


def audit_index_csv_pairing(errors: list[str]) -> None:
    slugs = _load_index_slugs()
    seen: set[str] = set()
    for slug in slugs:
        if slug in seen:
            errors.append(f"duplicate recipe_id in index: {slug!r}")
        seen.add(slug)
        csv_path = NORMALIZED / f"{slug}.csv"
        if not csv_path.exists():
            errors.append(f"index slug {slug!r} has no normalized CSV at {csv_path.name}")

    for path in sorted(NORMALIZED.glob("*.csv")):
        slug = path.stem
        if slug not in seen:
            errors.append(f"orphan normalized CSV {path.name} — not in recipe_index")


def audit_declared_sub_references(manifest: dict, errors: list[str]) -> None:
    for w in find_manifest_warnings(manifest):
        sub = w["sub_slug"]
        if sub in ALLOWLIST_UNREFERENCED_SUBS:
            continue
        errors.append(
            f"{w['recipe']!r} declares sub-recipe {sub!r} but no BOM row references it"
        )


def audit_unpinned_sub_notes(manifest: dict, errors: list[str]) -> None:
    for slug, m in manifest.items():
        for row in m.bom:
            notes = (row.get("notes") or "") if "notes" in row else ""
            # normalized loader doesn't keep notes on bom dict — re-read from pattern
            # via is_sub_recipe + sub_slug only. Re-scan normalized CSV for notes.
            pass

    for slug in manifest:
        slug_csv = NORMALIZED / f"{slug}.csv"
        if not slug_csv.exists():
            continue
        parent = manifest[slug]
        with slug_csv.open(newline="") as f:
            for row in csv.DictReader(f):
                notes = row.get("notes") or ""
                if not _UNPINNED_SUB.search(notes):
                    continue
                if _PIN.search(notes):
                    continue
                ing = (row.get("ingredient") or "").strip()
                resolved = _resolve_sub_slug(manifest, parent, ing)
                if resolved is None:
                    errors.append(
                        f"{slug!r} BOM {ing!r} marks sub-recipe without "
                        f"(sub-recipe=<slug>) and name does not resolve"
                    )


def audit_expand_skips(manifest: dict, errors: list[str]) -> None:
    for slug, m in manifest.items():
        if not m.sub_recipe_slugs or m.yield_qty <= 0:
            continue
        warns: list[str] = []
        expand_recipe(manifest, slug, m.yield_qty, m.yield_unit, warnings=warns)
        for msg in warns:
            errors.append(f"expand {slug!r} at {m.yield_qty} {m.yield_unit}: {msg}")


def audit_beo_green_chile(errors: list[str]) -> None:
    if not BEO_TREE.exists():
        errors.append(f"missing BEO tree cache: {BEO_TREE}")
        return
    data = json.loads(BEO_TREE.read_text())
    recipes = data.get("recipes") or {}

    def walk(recipe_slug: str, stack: list[str]) -> None:
        node = recipes.get(recipe_slug)
        if not node:
            return
        for ing in node.get("ingredients") or []:
            item = (ing.get("item") or "").strip().lower()
            linked = ing.get("recipe")
            if item in LEAF_NEVER_LINK and linked:
                errors.append(
                    f"BEO tree {recipe_slug!r} links leaf {item!r} → recipe {linked!r} "
                    f"(must stay null — vendor leaf, not house stew)"
                )
            if linked and linked in recipes and linked not in stack:
                walk(linked, stack + [linked])

    for slug in recipes:
        walk(slug, [slug])


def audit_acceptance(manifest: dict, errors: list[str]) -> None:
    # mexican_dinner must expand past tortillas/lime into plated subs.
    md_warns: list[str] = []
    md_leaves = expand_recipe(manifest, "mexican_dinner", 1.0, "menu", warnings=md_warns)
    if md_warns:
        for w in md_warns:
            errors.append(f"mexican_dinner expand: {w}")
    md_names = {k[0].lower() for k in md_leaves}
    for needle in ("beef cheeks", "tomato", "cabbage", "rice", "black beans"):
        if not any(needle in n for n in md_names):
            errors.append(
                f"mexican_dinner expand missing expected leaf containing {needle!r}"
            )

    # birria must expand qb_seasoning leaves, not opaque birria seasoning.
    bi_warns: list[str] = []
    bi_leaves = expand_recipe(manifest, "birria", 16.0, "qt", warnings=bi_warns)
    if bi_warns:
        for w in bi_warns:
            errors.append(f"birria expand: {w}")
    bi_names = {k[0].lower() for k in bi_leaves}
    if "birria seasoning" in bi_names:
        errors.append("birria expand still has opaque leaf 'birria seasoning'")
    if "chili powder" not in bi_names:
        errors.append("birria expand missing qb_seasoning leaf 'chili powder'")

    # queso: vendor green chile leaf, no pork from house stew.
    q_warns: list[str] = []
    q_leaves = expand_recipe(manifest, "queso_mac_sauce", 22.0, "qt", warnings=q_warns)
    if q_warns:
        for w in q_warns:
            errors.append(f"queso_mac_sauce expand: {w}")
    q_names = {k[0].lower() for k in q_leaves}
    if not any("green chile" in n for n in q_names):
        errors.append("queso_mac_sauce expand missing vendor 'green chile' leaf")
    if any("pork" in n for n in q_names):
        errors.append("queso_mac_sauce expand must not include pork (house stew guard)")


def run_audit() -> list[str]:
    errors: list[str] = []
    audit_index_csv_pairing(errors)
    manifest = build_manifest_from_normalized(INDEX, NORMALIZED)
    audit_declared_sub_references(manifest, errors)
    audit_unpinned_sub_notes(manifest, errors)
    audit_expand_skips(manifest, errors)
    audit_beo_green_chile(errors)
    audit_acceptance(manifest, errors)
    return errors


def main() -> int:
    errors = run_audit()
    if errors:
        print("recipe BOM audit FAILED:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    print("recipe BOM audit OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
