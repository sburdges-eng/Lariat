#!/usr/bin/env python3
"""Build the BEO recipe tree — the make-ahead prep breakdown per menu item.

A catering line item like a Battered Fish Taco is not one thing to prep: it's
a Fish Brine, a Beer Batter, Chipotle Aioli (itself mayo + adobo), Mexi Slaw
(itself red cabbage + chipotle aioli), and Pico. This assembles that whole
tree so the BEO board can show, for every item on a party, exactly what has to
be made in house and when.

Sources:
  * ``menus/beo_recipe_map.csv``  — menu item → its component recipes.
  * ``data/cache/recipes.json``   — each recipe's ingredients + sub_recipes.
  * source recipe CSVs in lariat-data-sources — to fill recipes referenced by
    the map but missing from the cache (Birria, Black Bean Corn Succotash).

Every recipe node is *made in house*; an ingredient that is itself a recipe
(Mexi Slaw's "chipotle aioli") is linked so the tree keeps nesting down to the
purchased leaves (red cabbage, mayonnaise, lime). PII-free.

Writes ``data/cache/beo_recipe_tree.json``::

    {
      "menu_items": { "battered fish taco": ["fish_brine","beer_batter", ...] },
      "recipes": {
        "chipotle_aioli": {
          "name": "Chipotle Aioli", "station": "garde",
          "prep_timing": "day_before", "yield_qty": 2, "yield_unit": "cup",
          "ingredients": [
            {"item":"mayonnaise","qty":900,"unit":"g","recipe":null},
            {"item":"adobo puree","qty":150,"unit":"g","recipe":null}
          ],
          "sub_recipes": []
        },
        "mexi_slaw": { ..., "ingredients":[{"item":"chipotle aioli", ...,
                       "recipe":"chipotle_aioli"}], "sub_recipes":["chipotle_aioli"] }
      }
    }
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAP_CSV = ROOT / "menus" / "beo_recipe_map.csv"
RECIPES = ROOT / "data" / "cache" / "recipes.json"
SRC_DIR = Path.home() / "Dev" / "lariat-data-sources" / "Menu & Recipes"
OUT = ROOT / "data" / "cache" / "beo_recipe_tree.json"


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", norm(s)).strip("_")


def clean_name(name: str) -> str:
    """Strip the "QB Recipe (Birria)" cache artifact → "Birria"."""
    m = re.match(r"^\s*QB Recipe \((.+)\)\s*$", name or "")
    return m.group(1) if m else name


# Ingredient names that ARE a sub-recipe but don't match one by name — grounded
# in the recipe's own notes (birria: "birria_seasoning = qb_seasoning").
INGREDIENT_ALIAS = {
    "birria seasoning": "qb_seasoning",
}

# Purchased leaves that must NEVER resolve to a recipe slug — even if a ghost
# cache entry or near-homophone (chile vs chilli) would otherwise match.
# Binding: docs/recipe-chile-chilli.md
LEAF_NEVER_LINK = {
    "green chile",  # Sysco/Shamrock vendor diced chile — not house green_chilli
}


# ── prep timing ──────────────────────────────────────────────────────────
# When each in-house component is made, relative to the event.
OVERNIGHT = {"birria", "fish_brine", "buttermilk_brine", "chicken_confit"}
# Day-before pre-prep: the sauces/rubs/salsas/batters/etc. made in house.
DAY_BEFORE_WORDS = (
    "sauce", "aioli", "salsa", "rub", "dressing", "brine", "batter", "flour",
    "seasoning", "slaw", "relish", "jam", "pickle", "oil", "jus", "confit",
    "queso", "green chilli", "succotash", "remoulade", "chile", "vinaigrette",
    "butter", "marinade", "pepitas",
)


def prep_timing(slug: str, name: str, category: str) -> str:
    if slug in OVERNIGHT:
        return "overnight"
    hay = f"{norm(name)} {norm(category)}"
    if any(w in hay for w in DAY_BEFORE_WORDS):
        return "day_before"
    return "day_of"


# ── fill the gaps the cache is missing but the map references ─────────────
def load_gap_recipe(slug: str) -> dict | None:
    """Read a source recipe CSV → the recipes.json shape (best effort)."""
    path = SRC_DIR / f"{slug}.csv"
    if not path.exists():
        return None
    ingredients = []
    for row in csv.DictReader(path.read_text(encoding="utf-8", errors="replace").splitlines()):
        item = (row.get("ingredient") or "").strip()
        if not item:
            continue
        try:
            qty = float(row.get("qty") or 0)
        except ValueError:
            qty = 0
        ingredients.append({"item": item, "qty": qty, "unit": (row.get("unit") or "").strip()})
    if not ingredients:
        return None
    return {"slug": slug, "name": slug.replace("_", " ").title(),
            "ingredients": ingredients, "sub_recipes": [], "category": "", "station": ""}


# Recipes referenced by the map but absent from recipes.json, plus their
# station/category so timing lands right.
GAP_META = {
    "birria": {"name": "Birria", "station": "braise", "category": "protein"},
    "black_bean_corn_succotash": {"name": "Black Bean Corn Succotash", "station": "garde", "category": "side"},
}


def build() -> dict:
    recipes = json.loads(RECIPES.read_text(encoding="utf-8"))
    by_slug: dict[str, dict] = {}
    by_name: dict[str, str] = {}
    for r in recipes:
        slug = r.get("slug") or slugify(r["name"])
        by_slug[slug] = r
        by_name[norm(r["name"])] = slug

    # Fill gaps from source CSVs (or a minimal stub so the map still resolves).
    for slug, meta in GAP_META.items():
        if slug in by_slug:
            continue
        r = load_gap_recipe(slug) or {"slug": slug, "name": meta["name"], "ingredients": [], "sub_recipes": []}
        r.update(meta)
        by_slug[slug] = r
        by_name[norm(r["name"])] = slug

    def resolve_slug(name: str) -> str | None:
        n = norm(name)
        if n in LEAF_NEVER_LINK:
            return None
        if n in INGREDIENT_ALIAS and INGREDIENT_ALIAS[n] in by_slug:
            return INGREDIENT_ALIAS[n]
        if n in by_name:
            return by_name[n]
        s = slugify(name)
        return s if s in by_slug else None

    # menu item → component recipe slugs
    menu_items: dict[str, list[str]] = {}
    for row in csv.DictReader(MAP_CSV.read_text(encoding="utf-8").splitlines()):
        item, comp = (row.get("beo_item") or "").strip(), (row.get("recipe_id") or "").strip()
        if not item or not comp:
            continue
        # A self-map ("Baked Ziti" → "Baked Ziti") means the recipe *is* the
        # item — keep it if the recipe exists, else skip (nothing to expand).
        slug = resolve_slug(comp)
        if slug:
            menu_items.setdefault(norm(item), [])
            if slug not in menu_items[norm(item)]:
                menu_items[norm(item)].append(slug)

    # Walk out from every referenced recipe, resolving ingredient→sub-recipe
    # links, until the tree is closed.
    wanted: set[str] = set()
    frontier = [s for slugs in menu_items.values() for s in slugs]
    while frontier:
        slug = frontier.pop()
        if slug in wanted or slug not in by_slug:
            continue
        wanted.add(slug)
        r = by_slug[slug]
        # explicit sub_recipes + any ingredient that resolves to a recipe
        for sub in (r.get("sub_recipes") or []):
            s = resolve_slug(sub) or (sub if sub in by_slug else None)
            if s:
                frontier.append(s)
        for ing in (r.get("ingredients") or []):
            s = resolve_slug(ing.get("item", ""))
            if s and s != slug:
                frontier.append(s)

    out_recipes: dict[str, dict] = {}
    for slug in sorted(wanted):
        r = by_slug[slug]
        subs: list[str] = []
        ings = []
        for ing in (r.get("ingredients") or []):
            link = resolve_slug(ing.get("item", ""))
            if link == slug:
                link = None  # never self-nest
            if link:
                subs.append(link)
            # Source recipes leave some qtys blank ("" / "to taste"); always
            # emit a number so the strict JSON consumer never chokes.
            raw_qty = ing.get("qty", 0)
            try:
                qty = float(raw_qty)
            except (TypeError, ValueError):
                qty = 0.0
            ings.append({
                "item": ing.get("item", ""),
                "qty": qty,
                "unit": ing.get("unit", ""),
                "recipe": link,
            })
        name = clean_name(r.get("name", slug.replace("_", " ").title()))
        out_recipes[slug] = {
            "name": name,
            "station": r.get("station", "") or "",
            "category": r.get("category", "") or "",
            "prep_timing": prep_timing(slug, name, r.get("category", "")),
            "yield_qty": r.get("yield_qty"),
            "yield_unit": r.get("yield_unit", "") or "",
            "notes": (r.get("notes") or "").strip(),
            "ingredients": ings,
            "sub_recipes": sorted(set(subs)),
        }

    return {
        "menu_items": dict(sorted(menu_items.items())),
        "recipes": out_recipes,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    tree = build()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(tree, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(tree['menu_items'])} menu items, "
          f"{len(tree['recipes'])} recipes -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
