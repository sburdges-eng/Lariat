#!/usr/bin/env python3
"""Generate the parity fixture consumed by tests/js/test-ingredient-key-parity.mjs.

Run from repo root:  python3 scripts/lib/generate_ingredient_key_fixture.py

Writes tests/fixtures/ingredient_key_parity.json with (input, expected)
pairs. Every input the Python normalizer sees is captured with its exact
expected output, so the TS mirror can be tested against the same ground
truth without re-running Python at test time.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Allow running as `python3 scripts/lib/generate_ingredient_key_fixture.py`
# from the repo root without install. Matches the sys.path convention used
# in scripts/seed_vendor_pack_weights.py and scripts/rebuild_merged_prices.py.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.ingredient_key import normalize_one  # noqa: E402


# Cover every branch of the algorithm. Add rows freely — the fixture
# is the contract between Python and TS.
INPUTS = [
    "",
    "   ",
    "Yellow Onion",
    "YELLOW ONION",
    "yellow  onion",
    "[JIT] Yellow Onion",
    "[NEW] Heavy Cream",
    "[REPLACED] Ribeye, 10lb case",
    "Heinz Ketchup 1 gal",
    "Ribeye (10# avg)",
    "Salmon, Atlantic — 8oz portion",
    "Tomato, Roma 25# case",
    "olive oil, extra virgin",
    "Canola Oil — 35# JIB",
    "Cilantro, fresh bunch",
    "Poblano",
    "poblano",
    " Poblano ",
    "Poblano!",
    "Poblano???",
    "Poblano & Jalapeño",
    "Poblano / Jalapeño",
    "Heavy Cream 40% MF",
    "Milk 2%",
    "Milk, 2%",
    "SYSCO 7078475 — GROUND BEEF 80/20",
    "SYSCO 7078475  GROUND BEEF 80/20",
    "Queso fresco",
    "Queso-Fresco",
    None,  # normalize_one handles None
]


def main() -> int:
    pairs = [{"input": value, "expected": normalize_one(value)} for value in INPUTS]
    out = ROOT / "tests" / "fixtures" / "ingredient_key_parity.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(pairs, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(pairs)} fixture rows to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
