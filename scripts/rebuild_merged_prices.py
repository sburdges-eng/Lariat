#!/usr/bin/env python3
"""Rebuild the merged prices catalog from all available vendor sources.

Sources (in priority order for dedup):
  1. costing/sysco_line_list_*.csv         (latest dated file)
  2. workbook/data/sysco_product_catalog.csv
  3. workbook/data/shamrock_orders.csv
  4. workbook/data/cross_supplier_pricing.csv
  5. workbook/data/pricing_trends.csv
  6. costing/*_plan_supplement_prices.csv

Deduplication keeps the cheapest unit_price_usd per ingredient, 
prioritizing base units (g, ml, ea) over non-canonical ones (pk, cs).
Dummy / placeholder entries are excluded.
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import date
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.vendor_catalog import CANONICAL_PRICE_COLS, _make_join_key  # noqa: E402
from scripts.lib.units import normalize_unit, unit_dimension, WEIGHT_TO_G, VOLUME_TO_ML, COUNT_TO_EA  # noqa: E402

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_DUMMY_VENDORS = {"dummy", "placeholder", "unknown"}
_DUMMY_SKU_PREFIX = "DUMMY"


def _is_dummy_row(row: dict) -> bool:
    """Return True if a row looks like a dummy/placeholder entry."""
    vendor = str(row.get("vendor", "")).strip().lower()
    if vendor in _DUMMY_VENDORS:
        return True
    sku = str(row.get("sku", "")).strip().upper()
    if sku.startswith(_DUMMY_SKU_PREFIX):
        return True
    notes = str(row.get("notes", "")).lower()
    if "dummy" in notes or "placeholder" in notes:
        return True
    return False


def parse_pack_string(pack_str: str) -> float | None:
    """Parse strings like '1/5/LB', '10/8/PK', '4/5 LB' into a total numeric quantity.

    Returns None if parsing fails.
    """
    if pd.isna(pack_str):
        return None
    pack_str = str(pack_str).upper().strip()

    # Normalize GL -> GAL
    pack_str = re.sub(r"\bGL\b", "GAL", pack_str)
    # Strip trailing size-qualifier like "LBAV" -> treat as LB
    pack_str = re.sub(r"LBAV", "LB", pack_str)

    # Try X/Y/Z pattern (e.g. 6/.5/GAL -> 6*0.5=3)
    m = re.match(r"(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)(?:/(\d+(?:\.\d+)?))?(?:/.*)?", pack_str)
    if m:
        vals = [float(x) for x in m.groups() if x is not None]
        res = 1.0
        for v in vals:
            res *= v
        return res

    # Try "X/Y UNIT" pattern  e.g. 4/5 LB -> 4*5=20
    m = re.match(r"(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)\s+.*", pack_str)
    if m:
        return float(m.group(1)) * float(m.group(2))

    # Try single number + unit  e.g. 25LB -> 25
    m = re.match(r"(\d+(?:\.\d+)?)\s*(?:LB|OZ|GAL|CT|KG|G|EA|PK).*", pack_str)
    if m:
        return float(m.group(1))

    # Try just a number
    try:
        return float(pack_str)
    except ValueError:
        return None


def _extract_pack_unit(pack_str: str) -> str:
    """Best-effort extraction of the unit portion from a pack string."""
    if pd.isna(pack_str):
        return ""
    # Use word boundaries to avoid partial matches like 'G' in 'GL'
    pack_str = str(pack_str).upper().strip()
    for unit, canonical in [
        ("LBAV", "lb"),
        ("LB", "lb"),
        ("OZ", "oz"),
        ("GAL", "gal"),
        ("GL", "gal"),
        ("CT", "ct"),
        ("KG", "kg"),
        ("G", "g"),
        ("EA", "ea"),
        ("PK", "pk"),
        ("CS", "cs"),
    ]:
        if re.search(rf"\b{unit}\b", pack_str):
            return canonical
    return ""


def normalize_unit_price(price: float, unit: str | float) -> tuple[float, str]:
    """Normalize price per unit to price per base unit (g, ml, ea).

    Returns (normalized_price, base_unit).
    """
    if pd.isna(unit):
        return price, ""
    try:
        raw_u = str(unit)
        canon = normalize_unit(raw_u)
        dim = unit_dimension(canon)
        if dim == "weight":
            return price / WEIGHT_TO_G[canon], "g"
        if dim == "volume":
            return price / VOLUME_TO_ML[canon], "ml"
        if dim == "count":
            return price / COUNT_TO_EA[canon], "ea"
    except (ValueError, KeyError):
        pass
    return price, str(unit)


# ---------------------------------------------------------------------------
# Source readers — each returns a list[dict] of canonical rows
# ---------------------------------------------------------------------------

def _read_sysco_line_list(root: Path) -> list[dict]:
    """Source 1: costing/sysco_line_list_*.csv (latest)."""
    files = sorted((root / "costing").glob("sysco_line_list_*.csv"))
    if not files:
        return []
    latest = files[-1]
    print(f"  [1] Sysco line list: {latest.name}")
    df = pd.read_csv(latest, dtype={"sku": str})
    rows: list[dict] = []
    for _, r in df.iterrows():
        up = pd.to_numeric(r.get("unit_price_usd"), errors="coerce")
        pp = pd.to_numeric(r.get("pack_price_usd"), errors="coerce")
        ps = pd.to_numeric(r.get("pack_size"), errors="coerce")
        if pd.isna(up) or up <= 0:
            if pd.notna(pp) and pd.notna(ps) and ps > 0:
                up = pp / ps
            else:
                continue
        rows.append({
            "ingredient": r.get("ingredient"),
            "vendor": r.get("vendor", "sysco"),
            "sku": str(r.get("sku", "")),
            "pack_size": ps if pd.notna(ps) else None,
            "pack_unit": r.get("pack_unit", ""),
            "pack_price_usd": pp if pd.notna(pp) else None,
            "unit_price_usd": up,
            "effective_date": r.get("effective_date", ""),
            "category": r.get("category", ""),
            "notes": "",
        })
    return rows


def _read_sysco_product_catalog(root: Path) -> list[dict]:
    """Source 2: workbook/data/sysco_product_catalog.csv."""
    path = root / "workbook/data/sysco_product_catalog.csv"
    if not path.exists():
        return []
    print(f"  [2] Sysco product catalog: {path.name}")
    df = pd.read_csv(path, dtype={"SUPC": str, "Mfr #": str})
    rows: list[dict] = []
    for _, r in df.iterrows():
        desc = r.get("Description")
        if pd.isna(desc):
            continue

        pack_count = pd.to_numeric(r.get("Pack"), errors="coerce")
        size_str = str(r.get("Size", ""))
        size_val = parse_pack_string(size_str)
        total_pack_size: float | None = None
        if pd.notna(pack_count) and size_val is not None and size_val > 0:
            total_pack_size = float(pack_count) * size_val

        pack_price = pd.to_numeric(r.get("Case $"), errors="coerce")
        unit_raw = r.get("Per Lb")
        unit_price: float | None = None

        # Per Lb column sometimes has "N" meaning not available
        if unit_raw != "N" and pd.notna(unit_raw):
            unit_price = pd.to_numeric(unit_raw, errors="coerce")
            if pd.isna(unit_price):
                unit_price = None

        # Calculate from case price / pack size if we don't have it
        if unit_price is None and pd.notna(pack_price) and total_pack_size and total_pack_size > 0:
            unit_price = float(pack_price) / total_pack_size

        if unit_price is None or unit_price <= 0:
            continue

        rows.append({
            "ingredient": desc,
            "vendor": "sysco",
            "sku": str(r.get("SUPC", "")),
            "pack_size": total_pack_size,
            "pack_unit": r.get("Unit", ""),
            "pack_price_usd": float(pack_price) if pd.notna(pack_price) else None,
            "unit_price_usd": unit_price,
            "effective_date": date.today().isoformat(),
            "category": r.get("Category", ""),
            "notes": "from sysco_product_catalog.csv",
        })
    return rows


def _read_shamrock_orders(root: Path) -> list[dict]:
    """Source 3: workbook/data/shamrock_orders.csv.

    Keep only the latest order per product (by Ship Date).
    """
    path = root / "workbook/data/shamrock_orders.csv"
    if not path.exists():
        return []
    print(f"  [3] Shamrock orders: {path.name}")
    df = pd.read_csv(path, dtype={"Product #": str, "Order #": str})
    df["Ship Date"] = pd.to_datetime(df["Ship Date"], errors="coerce")
    df = df.sort_values("Ship Date", ascending=False)
    latest = df.drop_duplicates(subset=["Description", "Product #"])

    rows: list[dict] = []
    for _, r in latest.iterrows():
        price = pd.to_numeric(r.get("Price"), errors="coerce")
        if pd.isna(price) or price <= 0:
            continue

        pack_size = parse_pack_string(r.get("Pack"))
        unit_str = str(r.get("Unit", "")).upper().strip()

        # Determine unit price
        if unit_str in ("LB", "EA"):
            # Price is already per-unit
            unit_price = float(price)
        elif pack_size and pack_size > 0:
            unit_price = float(price) / pack_size
        else:
            unit_price = float(price)

        eff = ""
        if pd.notna(r["Ship Date"]):
            eff = r["Ship Date"].date().isoformat()

        rows.append({
            "ingredient": r["Description"],
            "vendor": "shamrock",
            "sku": str(r.get("Product #", "")),
            "pack_size": pack_size,
            "pack_unit": _extract_pack_unit(r.get("Pack", "")) or unit_str.lower(),
            "pack_price_usd": float(price) if unit_str == "CS" else None,
            "unit_price_usd": unit_price,
            "effective_date": eff,
            "category": "",
            "notes": "from shamrock_orders.csv",
        })
    return rows


def _read_cross_supplier_pricing(root: Path) -> list[dict]:
    """Source 4: workbook/data/cross_supplier_pricing.csv.

    Each row has both a Shamrock side and a Sysco side.
    """
    path = root / "workbook/data/cross_supplier_pricing.csv"
    if not path.exists():
        return []
    print(f"  [4] Cross-supplier pricing: {path.name}")
    df = pd.read_csv(path, dtype={"Shamrock Prod#": str, "Sysco SUPC": str})

    rows: list[dict] = []
    for _, r in df.iterrows():
        # --- Shamrock side ---
        if pd.notna(r.get("Shamrock Description")):
            sm_price = pd.to_numeric(r.get("Shamrock Price"), errors="coerce")
            sm_unit = str(r.get("Shamrock Unit", "")).upper().strip()
            sm_pack = parse_pack_string(r.get("Shamrock Pack"))

            if pd.notna(sm_price) and sm_price > 0:
                if sm_unit in ("LB", "EA"):
                    sm_up = float(sm_price)
                    sm_pp = None
                elif sm_pack and sm_pack > 0:
                    sm_up = float(sm_price) / sm_pack
                    sm_pp = float(sm_price)
                else:
                    sm_up = float(sm_price)
                    sm_pp = None

                rows.append({
                    "ingredient": r["Shamrock Description"],
                    "vendor": "shamrock",
                    "sku": str(r.get("Shamrock Prod#", "")),
                    "pack_size": sm_pack,
                    "pack_unit": _extract_pack_unit(r.get("Shamrock Pack", "")) or sm_unit.lower(),
                    "pack_price_usd": sm_pp,
                    "unit_price_usd": sm_up,
                    "effective_date": date.today().isoformat(),
                    "category": "",
                    "notes": "from cross_supplier_pricing.csv",
                })

        # --- Sysco side ---
        if pd.notna(r.get("Sysco Description")):
            sy_price = pd.to_numeric(r.get("Sysco Case $"), errors="coerce")
            sy_pack_str = r.get("Sysco Pack")
            sy_pack = parse_pack_string(sy_pack_str)

            if pd.notna(sy_price) and sy_price > 0:
                if sy_pack and sy_pack > 0:
                    sy_up = float(sy_price) / sy_pack
                else:
                    sy_up = float(sy_price)

                rows.append({
                    "ingredient": r["Sysco Description"],
                    "vendor": "sysco",
                    "sku": str(r.get("Sysco SUPC", "")),
                    "pack_size": sy_pack,
                    "pack_unit": _extract_pack_unit(sy_pack_str) if pd.notna(sy_pack_str) else "cs",
                    "pack_price_usd": float(sy_price),
                    "unit_price_usd": sy_up,
                    "effective_date": date.today().isoformat(),
                    "category": "",
                    "notes": "from cross_supplier_pricing.csv",
                })
    return rows


def _read_pricing_trends(root: Path) -> list[dict]:
    """Source 5: workbook/data/pricing_trends.csv.

    Historical pricing with Last Price as the most recent.
    Unit=LB means price is per-lb; Unit=CS means price is per-case.
    """
    path = root / "workbook/data/pricing_trends.csv"
    if not path.exists():
        return []
    print(f"  [5] Pricing trends: {path.name}")
    df = pd.read_csv(path, dtype={"Product #": str})

    rows: list[dict] = []
    for _, r in df.iterrows():
        last_price = pd.to_numeric(r.get("Last Price"), errors="coerce")
        if pd.isna(last_price) or last_price <= 0:
            continue

        desc = r.get("Description")
        if pd.isna(desc):
            continue

        unit_str = str(r.get("Unit", "")).upper().strip()
        pack_size = parse_pack_string(r.get("Pack"))

        if unit_str in ("LB", "EA"):
            # Price is already per-unit
            unit_price = float(last_price)
            pack_price = None
        elif pack_size and pack_size > 0:
            unit_price = float(last_price) / pack_size
            pack_price = float(last_price)
        else:
            unit_price = float(last_price)
            pack_price = None

        eff = str(r.get("Last Order Date", ""))

        rows.append({
            "ingredient": desc,
            "vendor": "shamrock",  # pricing_trends is from Shamrock order history
            "sku": str(r.get("Product #", "")),
            "pack_size": pack_size,
            "pack_unit": _extract_pack_unit(r.get("Pack", "")) or unit_str.lower(),
            "pack_price_usd": pack_price,
            "unit_price_usd": unit_price,
            "effective_date": eff,
            "category": "",
            "notes": "from pricing_trends.csv",
        })
    return rows


def _read_plan_supplements(root: Path) -> list[dict]:
    """Source 6: costing/*_plan_supplement_prices.csv.
    
    These are manually added verified prices for ingredients missing from main catalogs.
    """
    files = sorted((root / "costing").glob("*_plan_supplement_prices.csv"))
    if not files:
        return []
    rows: list[dict] = []
    for sf in files:
        print(f"  [6] Plan supplement: {sf.name}")
        df = pd.read_csv(sf, dtype={"sku": str})
        for _, r in df.iterrows():
            up = pd.to_numeric(r.get("unit_price_usd"), errors="coerce")
            if pd.isna(up) or up <= 0:
                continue
            
            rows.append({
                "ingredient": r.get("ingredient"),
                "vendor": r.get("vendor"),
                "sku": str(r.get("sku", "")),
                "pack_size": pd.to_numeric(r.get("pack_size"), errors="coerce"),
                "pack_unit": r.get("pack_unit", ""),
                "pack_price_usd": pd.to_numeric(r.get("pack_price_usd"), errors="coerce"),
                "unit_price_usd": up,
                "effective_date": r.get("effective_date", ""),
                "category": r.get("category", ""),
                "notes": f"from {sf.name}",
            })
    return rows


# ---------------------------------------------------------------------------
# Main assembly
# ---------------------------------------------------------------------------

def rebuild_merged_prices(root: Path) -> pd.DataFrame:
    """Read all vendor price sources, deduplicate, return canonical DataFrame."""
    print("Scanning vendor price sources...")

    all_rows: list[dict] = []
    all_rows.extend(_read_sysco_line_list(root))
    all_rows.extend(_read_sysco_product_catalog(root))
    all_rows.extend(_read_shamrock_orders(root))
    all_rows.extend(_read_cross_supplier_pricing(root))
    all_rows.extend(_read_pricing_trends(root))
    all_rows.extend(_read_plan_supplements(root))

    if not all_rows:
        print("WARNING: No source rows found!", file=sys.stderr)
        return pd.DataFrame(columns=CANONICAL_PRICE_COLS)

    full_df = pd.DataFrame(all_rows)
    print(f"\n  Raw rows collected: {len(full_df)}")

    # --- Filter out dummy/placeholder entries ---
    dummy_mask = full_df.apply(_is_dummy_row, axis=1)
    n_dummy = dummy_mask.sum()
    if n_dummy:
        print(f"  Dropped {n_dummy} dummy/placeholder rows")
        full_df = full_df[~dummy_mask].copy()

    # --- Coerce numeric columns ---
    for col in ("pack_size", "pack_price_usd", "unit_price_usd"):
        full_df[col] = pd.to_numeric(full_df[col], errors="coerce")

    # --- Drop rows with zero or null unit_price ---
    full_df = full_df[full_df["unit_price_usd"].notna() & (full_df["unit_price_usd"] > 0)].copy()

    # --- Normalize unit prices to base units (g, ml, ea) ---
    print("  Normalizing unit prices to base units...")
    norm_rows = []
    for _, r in full_df.iterrows():
        price, unit = normalize_unit_price(r["unit_price_usd"], r["pack_unit"])
        r["unit_price_usd"] = price
        r["pack_unit"] = unit
        norm_rows.append(r)
    full_df = pd.DataFrame(norm_rows)
    print(f"  Valid priced rows: {len(full_df)}")

    # --- Dedup: cheapest unit price per normalised ingredient key ---
    full_df["_join"] = _make_join_key(full_df["ingredient"].astype(str))

    # Prioritise rows with base units (g, ml, ea) over non-canonical ones (pk, cs)
    full_df["is_base"] = full_df["pack_unit"].isin(["g", "ml", "ea"])
    full_df = full_df.sort_values(["_join", "is_base", "unit_price_usd"], ascending=[True, False, True])

    merged = full_df.drop_duplicates(subset=["_join"], keep="first").copy()
    merged.drop(columns=["_join", "is_base"], inplace=True)

    # --- Ensure output schema ---
    merged = merged[CANONICAL_PRICE_COLS].sort_values("ingredient", key=lambda s: s.str.lower())
    merged = merged.reset_index(drop=True)
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Rebuild merged prices from all vendor sources."
    )
    parser.add_argument("--root", type=Path, default=ROOT, help="Project root")
    parser.add_argument(
        "--date",
        type=str,
        default=date.today().isoformat(),
        help="Date stamp for output file (YYYY-MM-DD)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print stats but don't write")
    args = parser.parse_args()

    # Validate date
    try:
        date.fromisoformat(args.date)
    except ValueError:
        print(f"ERROR: Invalid date: {args.date!r}", file=sys.stderr)
        return 1

    merged = rebuild_merged_prices(args.root)

    print(f"\n  Unique ingredients: {len(merged)}")
    if "vendor" in merged.columns and len(merged):
        print(f"  Vendors: {sorted(merged['vendor'].dropna().unique())}")

    if args.dry_run:
        print("\n  [dry-run] No file written.")
        return 0

    out_path = args.root / "costing" / f"{args.date}_merged_prices.csv"
    merged.to_csv(out_path, index=False)
    print(f"\n  Wrote {len(merged)} rows -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
