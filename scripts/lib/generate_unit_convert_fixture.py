#!/usr/bin/env python3
"""Generate the parity fixture consumed by tests/js/test-unit-convert-parity.mjs.

Run from repo root:  python3 scripts/lib/generate_unit_convert_fixture.py

Writes tests/fixtures/unit_convert_parity.json with records of shape:
    {"qty": float, "from_unit": str|None, "to_unit": str|None,
     "g_per_ml": float|None, "expected": float|None}

`expected` is authoritatively computed here in Python using the tables from
scripts/lib/units.py (WEIGHT_TO_G, VOLUME_TO_ML, COUNT_TO_EA, normalize_unit,
unit_dimension). The TS mirror in lib/unitConvert.mjs is tested against this
fixture byte-exact.

Design note: we do NOT add `convert_qty()` to scripts/lib/units.py — the
density-aware cross-dim math is BOM-layer logic and stays out of the unit
module. The conversion algorithm is reproduced inline here (it is the same
algorithm mirrored in lib/unitConvert.mjs).
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.units import (  # noqa: E402
    VOLUME_TO_ML,
    WEIGHT_TO_G,
    normalize_unit,
    unit_dimension,
)


def convert_qty(qty, from_unit, to_unit, g_per_ml):
    """Authoritative convert-qty algorithm. Mirrors lib/unitConvert.mjs exactly.

    Returns a float on success, None on any failure. NaN / inf qty → None.
    """
    if not isinstance(qty, (int, float)) or isinstance(qty, bool):
        return None
    if not math.isfinite(qty):
        return None

    frm = normalize_unit(from_unit)
    to = normalize_unit(to_unit)
    if not frm or not to:
        return None

    # Identity — handled first; works even for count units.
    if frm == to:
        return float(qty)

    from_dim = unit_dimension(frm)
    to_dim = unit_dimension(to)
    if from_dim is None or to_dim is None:
        return None

    if from_dim == "count" or to_dim == "count":
        return None

    if from_dim == to_dim:
        if from_dim == "weight":
            return (qty * WEIGHT_TO_G[frm]) / WEIGHT_TO_G[to]
        # volume
        return (qty * VOLUME_TO_ML[frm]) / VOLUME_TO_ML[to]

    # Cross-dim — need positive, finite density.
    if (
        g_per_ml is None
        or not isinstance(g_per_ml, (int, float))
        or isinstance(g_per_ml, bool)
        or not math.isfinite(g_per_ml)
        or g_per_ml <= 0
    ):
        return None

    if from_dim == "volume" and to_dim == "weight":
        ml = qty * VOLUME_TO_ML[frm]
        g = ml * g_per_ml
        return g / WEIGHT_TO_G[to]

    if from_dim == "weight" and to_dim == "volume":
        g = qty * WEIGHT_TO_G[frm]
        ml = g / g_per_ml
        return ml / VOLUME_TO_ML[to]

    return None


# Cover every branch + realistic BOM × vendor mismatches. Order is stable so
# the fixture is byte-idempotent across regenerations.
CASES: list[tuple[float, object, object, object]] = [
    # ── identity ─────────────────────────────────────────────────────
    (1.0, "lb", "lb", None),
    (0.0, "lb", "lb", None),
    (5.5, "cup", "cup", None),
    (1.0, "ea", "ea", None),                 # count identity is allowed
    (1.0, "LB", "lb", None),                 # normalization: identity after lowercase
    (1.0, " lb ", "lb", None),               # normalization: identity after strip
    (1.0, "Lb", "lb", None),                 # mixed case
    (1.0, "POUND", "lb", None),              # synonym → canonical, same as 'lb' → 'lb'
    # ── weight ↔ weight ──────────────────────────────────────────────
    (1.0, "lb", "oz", None),                 # 16
    (16.0, "oz", "lb", None),                # 1
    (1.0, "kg", "g", None),                  # 1000
    (1000.0, "g", "kg", None),               # 1
    (1.0, "lb", "g", None),                  # 453.59237
    (2.5, "lb", "kg", None),                 # ≈ 1.134
    (1.0, "mg", "g", None),                  # 0.001
    (1.0, "lbs", "lb", None),                # synonym → lb; same-dim identity numerically
    (1.0, "pounds", "oz", None),             # synonym → 16
    # ── volume ↔ volume ──────────────────────────────────────────────
    (1.0, "cup", "tsp", None),               # 48 approx
    (1.0, "cup", "ml", None),                # 236.5882365
    (1.0, "gal", "cup", None),               # 16
    (1.0, "qt", "cup", None),                # 4
    (3.0, "tbsp", "tsp", None),              # 9
    (1.0, "l", "ml", None),                  # 1000
    (1.0, "fl oz", "ml", None),              # 29.5735296
    (1.0, "floz", "tbsp", None),             # 2 approx
    (4.0, "c", "qt", None),                  # bom_expand shorthand c → cup → qt
    (1.0, "#", "oz", None),                  # bom_expand shorthand # → lb → oz
    # ── volume → weight via density ──────────────────────────────────
    # diced onion 0.56 g/ml — 1 cup → ml → g → lb
    (1.0, "cup", "lb", 0.56),
    # water 1.0 g/ml: 1 l → 1000 g → ≈ 2.2046 lb
    (1.0, "l", "lb", 1.0),
    # flour 0.53 g/ml: 2 cup → 2×236.5882365×0.53 g
    (2.0, "cup", "g", 0.53),
    # oil 0.92 g/ml: 1 tbsp → 14.787×0.92 g
    (1.0, "tbsp", "g", 0.92),
    # ── weight → volume via density ──────────────────────────────────
    (1.0, "lb", "cup", 0.56),                # onion reverse
    (1000.0, "g", "l", 1.0),                 # water reverse → 1 l
    # ── cross-dim without density ────────────────────────────────────
    (1.0, "cup", "lb", None),                # missing density → null
    (1.0, "tbsp", "oz", None),               # missing density → null
    (1.0, "lb", "cup", None),                # missing density → null
    (1.0, "cup", "lb", 0.0),                 # zero density → null (ill-defined)
    (1.0, "cup", "lb", -0.5),                # negative density → null
    # ── count rejected ───────────────────────────────────────────────
    (1.0, "ea", "lb", 0.5),                  # count → weight rejected
    (1.0, "lb", "ea", 0.5),                  # weight → count rejected
    (1.0, "case", "lb", 10.0),               # count synonym rejected
    (1.0, "bag", "oz", 2.0),                 # count rejected
    (1.0, "cup", "ea", 1.0),                 # volume → count rejected
    # ── unknown units ────────────────────────────────────────────────
    # NB: "#10 can" is a SYNONYM for "can" (a count unit), so it's
    # count-rejected (count → weight without per-can mass), NOT an
    # unknown-unit case. Listed here for proximity to the other null
    # cases; the path is the same as the "case"/"bag" rows above.
    (1.0, "#10 can", "lb", None),            # count synonym → count-rejected → null
    (1.0, "lb", "blorp", None),              # unknown right → null
    (1.0, "", "lb", None),                   # empty string → null
    (1.0, None, "lb", None),                 # None → null
    (1.0, "lb", None, None),                 # None on to → null
    # ── edge qty values ──────────────────────────────────────────────
    (0.0, "cup", "lb", 0.56),                # qty=0 → 0 (not null!)
    (0.0, "cup", "tsp", None),               # qty=0 same-dim → 0
    (float("nan"), "lb", "oz", None),        # NaN → null
    (float("inf"), "lb", "oz", None),        # inf → null
    (float("-inf"), "cup", "lb", 0.56),      # -inf → null
]


def main() -> int:
    pairs = []
    for qty, from_unit, to_unit, g_per_ml in CASES:
        try:
            expected = convert_qty(qty, from_unit, to_unit, g_per_ml)
        except Exception:  # pragma: no cover — algorithm must be total
            expected = None
        pairs.append(
            {
                "qty": qty if (isinstance(qty, (int, float)) and math.isfinite(qty)) else str(qty),
                "from_unit": from_unit,
                "to_unit": to_unit,
                "g_per_ml": g_per_ml,
                "expected": expected,
            }
        )

    out = ROOT / "tests" / "fixtures" / "unit_convert_parity.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    # sort_keys=True keeps the JSON byte-idempotent regardless of dict
    # insertion order in Python minor versions; allow_nan=False would break
    # on NaN/inf qty sentinels, so we leave the default but already
    # stringified those above.
    out.write_text(
        json.dumps(pairs, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(pairs)} fixture rows to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
