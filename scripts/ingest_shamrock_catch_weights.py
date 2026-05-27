#!/usr/bin/env python3
"""Idempotent UPSERT of vendor_catch_weights rows from Shamrock invoice data.

The seed CSV (data/seeds/shamrock_catch_weights.csv) is curated from
historical Shamrock invoice deliveries — specifically from the
"Actual Weight: XX.XXlbs" line-item annotations that Shamrock uses for
catch-weight (random-weight) proteins, cheeses, and whole poultry.

Each row's `catalog_wt_lb` is derived from the invoice pack_size field
(the vendor's nominal reference weight per pack). This gives the T5b
catch-weight reconciliation path in scripts/lib/invoice_processor.py
a lookup weight so it can compute the actual_received_lb / price
variance for receiving checks.

CSV columns (header row required):
    sku, ingredient, catalog_wt_lb, tare_lb, source, verified

Only sku, catalog_wt_lb, tare_lb, and source are persisted.
The vendor column is hardcoded to 'shamrock' for every row.

Validation:
    - catalog_wt_lb MUST be > 0.
    - tare_lb, if present, MUST be >= 0.
    - sku MUST be non-empty after stripping.

Idempotency: UPSERT on PRIMARY KEY (vendor, sku); running twice
against the same CSV yields the same row count.

Shared skeleton lives in scripts.lib.seed_upsert (debt D2).
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.seed_upsert import (  # noqa: E402
    ColumnSpec,
    SeedSpec,
    assert_csv_shape,
    build_cli,
    seed_upsert_main,
)

EXPECTED_COLUMNS: tuple[str, ...] = (
    "sku",
    "ingredient",
    "catalog_wt_lb",
    "tare_lb",
    "source",
    "verified",
)
DEFAULT_DB = ROOT / "data" / "lariat.db"
DEFAULT_CSV = ROOT / "data" / "seeds" / "shamrock_catch_weights.csv"
VENDOR = "shamrock"


SPEC = SeedSpec(
    script_name="ingest_shamrock_catch_weights",
    table_name="vendor_catch_weights",
    columns=(
        ColumnSpec(csv_name="sku", normalize_to_key=True),
        # Human-facing — read for shape validation, not persisted.
        ColumnSpec(csv_name="ingredient", persist=False, required=False),
        ColumnSpec(
            csv_name="catalog_wt_lb",
            coerce=float,
            validate=lambda v: v > 0,
            validate_msg="must be > 0",
        ),
        ColumnSpec(
            csv_name="tare_lb",
            coerce=float,
            validate=lambda v: v >= 0,
            validate_msg="must be >= 0",
            null_on_empty=True,
        ),
        # source: free-text (no enum check).  Empty -> NULL.
        ColumnSpec(csv_name="source", null_on_empty=True),
        ColumnSpec(csv_name="verified", persist=False, required=False),
    ),
    on_conflict_columns=("vendor", "sku"),
    normalize_fn=lambda s: str(s).strip(),
    injected_columns={"vendor": VENDOR},
    default_db=DEFAULT_DB,
    default_csv=DEFAULT_CSV,
    empty_key_message_override="WARN row {idx}: empty sku; skipping",
)


def _assert_csv_shape(csv_path: Path) -> None:
    """Thin alias for test fixtures."""
    assert_csv_shape(csv_path, EXPECTED_COLUMNS)


def main(db_path: Path, csv_path: Path) -> int:
    return seed_upsert_main(SPEC, db_path, csv_path, vendor=VENDOR)


def _cli() -> int:
    db, csv, _injected = build_cli(SPEC, __doc__)
    return main(db, csv)


if __name__ == "__main__":
    raise SystemExit(_cli())
