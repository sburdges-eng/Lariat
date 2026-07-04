"""BEO order-pull core logic.

Given a list of BEO invoice rows (menu item + quantity), resolves each
line to recipe slugs, expands sub-recipes via `bom_expand`, and returns
aggregated leaf-ingredient demand. Unmapped items are surfaced to the
caller rather than silently dropped (AGENTS.md rule #4).

CLI in `scripts/beo_order_pull.py` wraps this module.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from scripts.lib.bom_expand import (
    Manifest,
    aggregate_demand,
)


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class InvoiceRow:
    menu_item: str
    qty: float
    unit: str = ""  # optional; ignored unless qty_in_yield_units mode


@dataclass(frozen=True)
class Unmapped:
    menu_item: str
    reason: str


@dataclass(frozen=True)
class OrderLine:
    ingredient: str
    unit: str
    total_needed: float
    on_hand: float
    to_order: float


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def normalize_client(s: str | None) -> str:
    """Case-fold + strip so `"Navratil  "` and `"navratil"` compare equal.

    The legacy script used strict equality and silently produced empty
    CSVs for common trailing-whitespace mistakes."""
    if s is None:
        return ""
    return str(s).strip().casefold()


def _norm_name(s: str | None) -> str:
    return "" if s is None else str(s).strip().casefold()


# ---------------------------------------------------------------------------
# Load the beo_item → recipe_slug map
# ---------------------------------------------------------------------------


def load_beo_recipe_map(
    csv_path: Path,
    manifest: dict[str, Manifest],
) -> tuple[dict[str, list[str]], list[Unmapped], dict[tuple[str, str], float]]:
    """Return (lookup, unresolved, scales).

    The CSV has columns `beo_item, recipe_id[, per_count]`, where `recipe_id`
    in the source file is actually a RECIPE DISPLAY NAME (e.g. "Queso / Mac
    Sauce"), not a slug. We resolve to slugs by matching against
    `manifest[slug].display_name` case-insensitively. Any map entry that
    doesn't resolve is returned in `unresolved` — the caller decides
    whether to fail or warn.

    The optional `per_count` column is a per-mapping scale factor: how many
    of the recipe's YIELD UNITS one BEO line-item count produces (e.g. one
    "pan" of Green Chile Mac = 5.5 qt of queso). It is returned in `scales`,
    keyed by `(normalized_menu_item, slug)`. Rows without a `per_count`
    fall back to the caller's default interpretation (unchanged behavior).

    Multiple rows per `beo_item` are permitted; all mapped recipes are
    attached to that menu item.
    """
    csv_path = Path(csv_path)
    lookup: dict[str, list[str]] = {}
    unresolved: list[Unmapped] = []
    scales: dict[tuple[str, str], float] = {}
    if not csv_path.exists():
        return lookup, [Unmapped("(whole map file)", f"not found: {csv_path}")], scales

    display_to_slug: dict[str, str] = {}
    for slug, m in manifest.items():
        key = _norm_name(m.display_name)
        if key and key not in display_to_slug:
            display_to_slug[key] = slug
        display_to_slug.setdefault(_norm_name(slug.replace("_", " ")), slug)

    with csv_path.open(newline="") as f:
        for row in csv.DictReader(f):
            menu_item = (row.get("beo_item") or "").strip()
            recipe_key = (row.get("recipe_id") or "").strip()
            if not menu_item or not recipe_key:
                continue
            slug = display_to_slug.get(_norm_name(recipe_key))
            if slug is None:
                unresolved.append(
                    Unmapped(menu_item, f"map references {recipe_key!r}, no such recipe")
                )
                continue
            name_key = _norm_name(menu_item)
            lookup.setdefault(name_key, []).append(slug)
            raw_pc = (row.get("per_count") or "").strip()
            if raw_pc:
                try:
                    scales[(name_key, slug)] = float(raw_pc)
                except ValueError:
                    pass  # malformed → ignore, fall back to default scaling

    return lookup, unresolved, scales


# ---------------------------------------------------------------------------
# Demand construction
# ---------------------------------------------------------------------------


def build_demand(
    invoice_rows: Iterable[InvoiceRow],
    manifest: dict[str, Manifest],
    beo_map: dict[str, list[str]],
    *,
    qty_in_yield_units: bool = False,
    scales: dict[tuple[str, str], float] | None = None,
) -> tuple[list[tuple[str, float, str]], list[Unmapped]]:
    """Convert invoice rows to demand triples.

    Scaling precedence, per (menu_item, recipe) mapping:
      1. `scales[(name_key, slug)]` present  → qty * per_count in yield units
         (the BEO count times an explicit per-mapping portion factor).
      2. `qty_in_yield_units=True`           → qty as-is in yield units.
      3. default                             → qty * yield_qty (batch counts).

    Unmapped menu items are reported; they do NOT raise.
    """
    demand: list[tuple[str, float, str]] = []
    unmapped: list[Unmapped] = []
    for row in invoice_rows:
        name_key = _norm_name(row.menu_item)
        if not name_key:
            continue

        slugs = beo_map.get(name_key)
        if not slugs:
            # Try direct recipe-name / slug resolution as a last resort so
            # the pull still works when the map file hasn't been updated.
            direct = _direct_resolve(name_key, manifest)
            if direct:
                slugs = [direct]
            else:
                unmapped.append(Unmapped(row.menu_item, "not in beo_recipe_map and no direct recipe match"))
                continue

        for slug in slugs:
            m = manifest.get(slug)
            if m is None:
                unmapped.append(Unmapped(row.menu_item, f"map points to unknown slug {slug!r}"))
                continue
            per_count = scales.get((name_key, slug)) if scales else None
            if per_count is not None:
                # Explicit per-mapping scale: BEO count → recipe yield units.
                demand.append((slug, float(row.qty) * per_count, m.yield_unit))
            elif qty_in_yield_units:
                demand_unit = row.unit.strip() or m.yield_unit
                demand.append((slug, float(row.qty), demand_unit))
            else:
                demand.append((slug, float(row.qty) * float(m.yield_qty), m.yield_unit))
    return demand, unmapped


def _direct_resolve(name_key: str, manifest: dict[str, Manifest]) -> str | None:
    for slug, m in manifest.items():
        if _norm_name(m.display_name) == name_key:
            return slug
        if _norm_name(slug.replace("_", " ")) == name_key:
            return slug
    return None


# ---------------------------------------------------------------------------
# Pull orders (main entry)
# ---------------------------------------------------------------------------


def pull_orders(
    manifest: dict[str, Manifest],
    demand: list[tuple[str, float, str]],
    inventory: dict[tuple[str, str], float] | None = None,
    warnings: list[str] | None = None,
) -> list[OrderLine]:
    """Aggregate demand across recipes (with sub-recipe cascade) and
    subtract on-hand inventory. Returns one OrderLine per leaf
    ingredient + unit, sorted by ingredient name for stable diffs.

    `inventory` is a dict keyed by `(ingredient_name_lower, unit_lower)`
    for precision. Callers that only have ingredient names can pass
    `(name_lower, "")` and we'll match regardless of unit as a fallback.
    """
    totals = aggregate_demand(manifest, demand, warnings=warnings)
    out: list[OrderLine] = []
    for (ing, unit), qty in totals.items():
        on_hand = _lookup_inventory(inventory, ing, unit) if inventory else 0.0
        to_order = max(0.0, qty - on_hand)
        out.append(
            OrderLine(
                ingredient=ing,
                unit=unit,
                total_needed=qty,
                on_hand=on_hand,
                to_order=to_order,
            )
        )
    out.sort(key=lambda r: (r.ingredient.lower(), r.unit.lower()))
    return out


def _lookup_inventory(
    inventory: dict[tuple[str, str], float] | None,
    ingredient: str,
    unit: str,
) -> float:
    if not inventory:
        return 0.0
    key = (ingredient.strip().lower(), unit.strip().lower())
    if key in inventory:
        return inventory[key]
    # Unit-agnostic fallback: same ingredient regardless of unit.
    any_unit = (ingredient.strip().lower(), "")
    if any_unit in inventory:
        return inventory[any_unit]
    return 0.0


# ---------------------------------------------------------------------------
# Invoice CSV loader
# ---------------------------------------------------------------------------


def load_invoice_rows(
    csv_path: Path,
    client: str,
    *,
    event_date: str | None = None,
) -> list[InvoiceRow]:
    """Read `workbook/data/beo_invoices.csv` (or equivalent) filtered by
    client (case-insensitive, trimmed). Returns InvoiceRow list.

    Expected columns: `Client, Menu Item, Qty` plus optional
    `Event Date, Unit`. Missing optional columns use sensible defaults.
    """
    csv_path = Path(csv_path)
    if not csv_path.exists():
        raise FileNotFoundError(f"invoice CSV not found: {csv_path}")
    want_client = normalize_client(client)
    want_date = None if event_date is None else event_date.strip()

    rows: list[InvoiceRow] = []
    with csv_path.open(newline="") as f:
        for raw in csv.DictReader(f):
            if normalize_client(raw.get("Client")) != want_client:
                continue
            if want_date is not None:
                ed = (raw.get("Event Date") or raw.get("event_date") or "").strip()
                if ed and ed != want_date:
                    continue
            menu_item = (raw.get("Menu Item") or raw.get("menu_item") or "").strip()
            if not menu_item:
                continue
            qty_raw = (raw.get("Qty") or raw.get("qty") or "").strip()
            try:
                qty = float(qty_raw)
            except ValueError:
                continue
            unit = (raw.get("Unit") or raw.get("unit") or "").strip()
            rows.append(InvoiceRow(menu_item=menu_item, qty=qty, unit=unit))
    return rows
