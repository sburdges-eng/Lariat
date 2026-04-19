#!/usr/bin/env python3
"""
Seed costing/vendor_pack_weights.csv from workbook/data/sysco_product_catalog.csv.

Filters to EA/CT/PCE items and outputs with verified=false for all rows
except user-confirmed SKUs.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# User-verified overrides: {sku: (tare_lb, verified_net_weight_g, source)}
VERIFIED_OVERRIDES: dict[str, tuple[float, int, str]] = {
    "7078475": (2.0, 2722, "user-measured 2026-04-04"),
}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--catalog",
        type=Path,
        default=ROOT / "workbook" / "data" / "sysco_product_catalog.csv",
        help="Sysco product catalog CSV",
    )
    p.add_argument(
        "-o", "--output",
        type=Path,
        default=ROOT / "costing" / "vendor_pack_weights.csv",
        help="Output path",
    )
    args = p.parse_args()

    if not args.catalog.is_file():
        print(f"Catalog not found: {args.catalog}", file=sys.stderr)
        return 1

    df = pd.read_csv(args.catalog, dtype={"SUPC": str})

    # Filter to count-based items (EA, CT, PCE)
    count_units = {"EA", "CT", "PCE"}
    mask = df["Unit"].isin(count_units)
    filtered = df[mask].copy()
    print(f"Filtered {len(filtered)} EA/CT/PCE items from {len(df)} total", file=sys.stderr)

    rows: list[dict] = []
    for _, r in filtered.iterrows():
        sku = str(r["SUPC"]).strip()
        ingredient = str(r["Description"]).strip()
        # Pack × Size count = total items per case
        pack_count = int(r["Pack"])
        # Parse size for count: "30 CT" → 30
        size_str = str(r["Size"]).strip()
        import re
        size_match = re.match(r"([\d.]+)", size_str.replace(",", ""))
        size_num = float(size_match.group(1)) if size_match else 1.0
        pack_size = int(pack_count * size_num)
        pack_unit = str(r["Unit"]).strip()
        sysco_net_wt_lb = r["Net Wt"]

        # Check for user-verified override
        if sku in VERIFIED_OVERRIDES:
            tare_lb, verified_g, source = VERIFIED_OVERRIDES[sku]
            rows.append({
                "sku": sku,
                "ingredient": ingredient,
                "pack_size": pack_size,
                "pack_unit": pack_unit,
                "sysco_net_wt_lb": sysco_net_wt_lb,
                "tare_lb": tare_lb,
                "verified_net_weight_g": verified_g,
                "source": source,
                "verified": "true",
            })
        else:
            rows.append({
                "sku": sku,
                "ingredient": ingredient,
                "pack_size": pack_size,
                "pack_unit": pack_unit,
                "sysco_net_wt_lb": sysco_net_wt_lb,
                "tare_lb": "",
                "verified_net_weight_g": "",
                "source": "sysco_catalog",
                "verified": "false",
            })

    out = pd.DataFrame(rows)
    out.to_csv(args.output, index=False)
    verified_count = sum(1 for r in rows if r["verified"] == "true")
    print(f"Wrote {len(out)} rows to {args.output} ({verified_count} verified)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
