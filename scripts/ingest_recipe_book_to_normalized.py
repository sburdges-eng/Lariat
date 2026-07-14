#!/usr/bin/env python3
"""Refresh recipes/normalized/*.csv from a Recipe Book export.

Keeps existing recipe_index slugs and display names; only rewrites per-slug
BOM CSVs from the source book content.

Supports:
  - Nested CSV export (archive/exports.../Recipe Book.csv layout)
  - Plain-text Google Doc export (.txt) — heuristic parser

Usage:
  python3 scripts/ingest_recipe_book_to_normalized.py \\
    --source recipes/raw/lariat-recipe-book-v1-july-2025.txt
  python3 scripts/ingest_recipe_book_to_normalized.py --dry-run --source path.csv
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "recipes" / "recipe_index.csv"
NORMALIZED_DIR = ROOT / "recipes" / "normalized"

# Title in book → recipe_index slug (when auto-match fails).
TITLE_ALIASES: dict[str, str] = {
    "corn bread": "cornbread",
    "green chile": "green_chilli",
    "green chilli": "green_chilli",
    "grilled three cheese sandwich": "three_cheese_grilled_cheese",
    "thai chilli sauce": "thai_chili_sauce",
    "chip aioli": "chipotle_aioli",
    "chipotle aioli": "chipotle_aioli",
    "qb seasoning": "qb_seasoning",
    "q b seasoning": "qb_seasoning",
    "blackened salsa": "blackened_tomato_salsa",
    "queso / mac sauce": "queso_mac_sauce",
    "nashville hot rub": "nashville_hot_rub",
    "special sauce": "special_sauce",
    "fish brine": "fish_brine",
    "chicken flour": "chicken_flour",
    "buttermilk brine": "buttermilk_brine",
    "lariat rub": "lariat_rub",
    "pico de gallo": "pico_de_gallo",
    "green chile large batch": "tomatillo_salsa",
}

# Purchased leaves — never emit (sub-recipe=...) pins. Binding: docs/recipe-chile-chilli.md
LEAF_NEVER_LINK = {
    "green chile",
}

INGREDIENT_ALIASES: dict[str, str] = {
    "blackened salsa": "blackened_tomato_salsa",
    "lariat rub": "lariat_rub",
    "birria seasoning": "qb_seasoning",
    "qb seasoning": "qb_seasoning",
    "5lb cheese block": "american cheese block",
    "5lb bags shredded cheddar": "shredded cheddar",
}


@dataclass
class ParsedRecipe:
    title: str
    ingredients: list[dict[str, str | float | None]] = field(default_factory=list)
    yield_text: str = ""
    procedure: list[str] = field(default_factory=list)


def norm_title(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def slugify(s: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", s.lower())).strip("_")


def load_index() -> tuple[dict[str, dict[str, str]], dict[str, str]]:
    by_id: dict[str, dict[str, str]] = {}
    name_to_id: dict[str, str] = {}
    with INDEX_PATH.open(newline="") as f:
        for row in csv.DictReader(f):
            rid = (row.get("recipe_id") or "").strip()
            if not rid:
                continue
            by_id[rid] = row
            name = (row.get("recipe_name") or "").strip()
            if name:
                name_to_id[norm_title(name)] = rid
    return by_id, name_to_id


def resolve_slug(title: str, name_to_id: dict[str, str]) -> str | None:
    key = norm_title(title)
    if key in TITLE_ALIASES:
        return TITLE_ALIASES[key]
    if key in name_to_id:
        return name_to_id[key]
    slug = slugify(title)
    if slug in name_to_id.values():
        return slug
    for name_key, rid in name_to_id.items():
        if key in name_key or name_key in key:
            return rid
    return None


def parse_nested_csv(path: Path) -> list[ParsedRecipe]:
    recipes: list[ParsedRecipe] = []
    current: ParsedRecipe | None = None
    with path.open(newline="") as f:
        for row in csv.reader(f):
            cells = (row + [""] * 7)[:7]
            a, b, c, *_rest, g = cells[0], cells[1], cells[2], cells[6]
            f_cell = cells[5] if len(cells) > 5 else ""
            if a and f_cell and "scale" in str(f_cell).lower():
                if current:
                    recipes.append(current)
                current = ParsedRecipe(title=str(a).strip())
                continue
            if not current:
                continue
            if a and str(a).strip().lower() == "ingredient":
                continue
            if a and str(a).strip().lower().startswith("yield"):
                current.yield_text = str(a).strip()
                continue
            if a and b not in ("", None):
                try:
                    qty = float(b) if b != "" else None
                except (TypeError, ValueError):
                    qty = None
                current.ingredients.append(
                    {
                        "ingredient": str(a).strip(),
                        "qty": qty,
                        "unit": str(c).strip() if c else "",
                    }
                )
            if g:
                current.procedure.append(str(g).strip())
    if current:
        recipes.append(current)
    return recipes


_QTY_UNIT_ING = re.compile(
    r"^([\d./]+)\s*(lb|lbs|oz|cup|cups|qt|gal|g|kg|ea|bag|bags|bunch|bunches|case|cases|tbsp|tsp|#10 can|boxes?)\b\s*(.*)$",
    re.I,
)
_ING_QTY = re.compile(
    r"^(.+?)\s*[-–]\s*([\d./]+)\s*(.+)$",
    re.I,
)


def _parse_qty(qty_s: str) -> float | None:
    qty_s = qty_s.strip()
    if not qty_s:
        return None
    if "/" in qty_s:
        parts = qty_s.split("/")
        if len(parts) == 2:
            try:
                return float(parts[0]) / float(parts[1])
            except (TypeError, ValueError, ZeroDivisionError):
                return None
    try:
        return float(qty_s)
    except (TypeError, ValueError):
        return None


def _parse_ingredient_line(line: str) -> dict[str, str | float | None] | None:
    line = line.strip()
    if not line or len(line) < 3:
        return None
    low = line.lower()
    if low.startswith(
        (
            "yield",
            "combine",
            "whisk",
            "bake",
            "add ",
            "cook ",
            "transfer",
            "remove",
            "blend",
            "render",
            "season",
            "drain",
            "spread",
            "roast",
            "blacken",
            "bur ",
            "instructions",
            "for ",
        )
    ):
        return None
    m = _QTY_UNIT_ING.match(line)
    if m:
        qty_s, unit, ing = m.group(1), m.group(2), m.group(3).strip()
        qty = _parse_qty(qty_s)
        return {"ingredient": ing or line, "qty": qty, "unit": unit}
    m = _ING_QTY.match(line)
    if m:
        ing, qty_s, rest = m.group(1).strip(), m.group(2), m.group(3).strip()
        parts = rest.split()
        unit = parts[0] if parts else ""
        qty = _parse_qty(qty_s)
        return {"ingredient": ing, "qty": qty, "unit": unit}
    if re.match(r"^[\d./]+\s", line):
        return {"ingredient": line, "qty": None, "unit": ""}
    return None


def parse_txt(path: Path, name_to_id: dict[str, str]) -> list[ParsedRecipe]:
    """Heuristic parser for Google Docs plain-text Recipe Book exports."""
    recipes: list[ParsedRecipe] = []
    current: ParsedRecipe | None = None
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.lower() in {"lariat recipe book", "ingredient"}:
            continue
        slug_guess = resolve_slug(line, name_to_id)
        if slug_guess and _parse_ingredient_line(line) is None and len(line) < 80:
            if current and current.ingredients:
                recipes.append(current)
            current = ParsedRecipe(title=line)
            continue
        if current is None:
            continue
        if line.lower().startswith("yield"):
            current.yield_text = line
            continue
        ing = _parse_ingredient_line(line)
        if ing:
            current.ingredients.append(ing)
        elif line[0].isdigit() and current.ingredients:
            # continuation qty lines without clear pattern — attach as note on last row
            pass
    if current and current.ingredients:
        recipes.append(current)
    return recipes


def ingredient_slug(ingredient: str, index_ids: set[str]) -> str | None:
    key = norm_title(ingredient)
    if key in LEAF_NEVER_LINK:
        return None
    if key in INGREDIENT_ALIASES:
        return INGREDIENT_ALIASES[key]
    slug = slugify(ingredient)
    if slug in index_ids:
        return slug
    for alias_key, alias_slug in INGREDIENT_ALIASES.items():
        if alias_key in key:
            return alias_slug
    for rid in index_ids:
        if slugify(rid) == slug or rid.replace("_", " ") in key:
            return rid
    return None


def portions_for_slug(
    slug: str, parsed: ParsedRecipe, index_row: dict[str, str]
) -> str:
    existing = NORMALIZED_DIR / f"{slug}.csv"
    if existing.exists():
        with existing.open(newline="") as f:
            rows = list(csv.DictReader(f))
            if rows and (rows[0].get("portions_per_batch") or "").strip():
                return rows[0]["portions_per_batch"].strip()
    if parsed.yield_text:
        return parsed.yield_text.replace("Yield:", "").replace("YIELD:", "").strip()
    y = (index_row.get("yield") or "").strip()
    u = (index_row.get("yield_unit") or "").strip()
    if y and u:
        return f"~{y} {u}"
    return ""


def queso_green_chile_note(slug: str, ingredient: str) -> str | None:
    if slug == "queso_mac_sauce" and norm_title(ingredient) == "green chile":
        return "vendor leaf (Sysco/Shamrock) — NOT house green_chilli stew"
    return None


def write_normalized(
    slug: str,
    parsed: ParsedRecipe,
    index_row: dict[str, str],
    index_ids: set[str],
    dry_run: bool,
) -> None:
    out = NORMALIZED_DIR / f"{slug}.csv"
    portions = portions_for_slug(slug, parsed, index_row)
    rows: list[dict[str, str]] = []
    for ing in parsed.ingredients:
        name = str(ing.get("ingredient") or "").strip()
        if not name:
            continue
        qty = ing.get("qty")
        unit = str(ing.get("unit") or "").strip().lower()
        notes_parts: list[str] = []
        sub = ingredient_slug(name, index_ids)
        vendor_note = queso_green_chile_note(slug, name)
        if vendor_note:
            notes_parts.append(vendor_note)
        elif sub and sub != slug:
            notes_parts.append(f"(sub-recipe={sub})")
        rows.append(
            {
                "ingredient": name.lower(),
                "qty": "" if qty is None else str(qty),
                "unit": unit,
                "portions_per_batch": portions,
                "notes": " ".join(notes_parts),
            }
        )
    if not rows:
        print(
            f"  skip {slug}: no ingredients parsed for {parsed.title!r}",
            file=sys.stderr,
        )
        return
    if dry_run:
        print(f"  would write {out.name}: {len(rows)} rows from {parsed.title!r}")
        return
    with out.open("w", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["ingredient", "qty", "unit", "portions_per_batch", "notes"],
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"  wrote {out.name}: {len(rows)} rows")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        required=True,
        help="Recipe Book CSV or TXT export",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    source = args.source if args.source.is_absolute() else ROOT / args.source
    if not source.exists():
        print(f"source not found: {source}", file=sys.stderr)
        print(
            "Copy the iCloud V.1 file into the repo, e.g.:\n"
            "  recipes/raw/lariat-recipe-book-v1-july-2025.txt",
            file=sys.stderr,
        )
        return 1

    by_id, name_to_id = load_index()
    index_ids = set(by_id)

    if source.suffix.lower() == ".csv":
        parsed_recipes = parse_nested_csv(source)
    else:
        parsed_recipes = parse_txt(source, name_to_id)

    updated = 0
    skipped: list[str] = []
    for parsed in parsed_recipes:
        slug = resolve_slug(parsed.title, name_to_id)
        if not slug:
            skipped.append(parsed.title)
            continue
        write_normalized(slug, parsed, by_id[slug], index_ids, args.dry_run)
        updated += 1

    print(f"matched {updated} recipes from {len(parsed_recipes)} titles in source")
    if skipped:
        print(
            f"unmapped titles ({len(skipped)}):",
            ", ".join(skipped[:20]),
            file=sys.stderr,
        )
        if len(skipped) > 20:
            print(f"  ... and {len(skipped) - 20} more", file=sys.stderr)
    return 0 if updated else 1


if __name__ == "__main__":
    raise SystemExit(main())
