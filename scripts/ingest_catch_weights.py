#!/usr/bin/env python3
"""Idempotent UPSERT of vendor_catch_weights rows from
costing/vendor_pack_weights.csv.

The CSV is produced by scripts/seed_vendor_pack_weights.py (which pulls
from Sysco's product catalog). This script flows the rows into SQLite
so the T5a catch-weight reconciliation path in
scripts/lib/invoice_processor.py can look up the reference weight when
an invoice arrives.

CSV columns (header row required):
    sku, ingredient, pack_size, pack_unit, sysco_net_wt_lb,
    tare_lb, verified_net_weight_g, source, verified

Only sku, sysco_net_wt_lb, tare_lb, and source are persisted —
ingredient / pack_size / pack_unit / verified_net_weight_g / verified
are human-facing / downstream CSV metadata.  The vendor column is
set via the --vendor CLI arg (default 'sysco') for every row since
this CSV is Sysco-sourced; Shamrock catch-weights will flow in via a
sibling ingest (T5b).

Validation:
    - catalog_wt_lb (= sysco_net_wt_lb) MUST be > 0.
    - tare_lb, if present, MUST be >= 0.
    - sku MUST be non-empty after stripping.
    - source is free-text (no CHECK on this table — sources include
      'sysco_catalog', 'user-measured 2026-04-04', etc.).

Idempotency: UPSERT on PRIMARY KEY (vendor, sku); running twice
against the same CSV yields the same row count. Verified by
tests/python/test_ingest_catch_weights.py.

Shared skeleton lives in scripts.lib.seed_upsert (debt D2).
"""
from __future__ import annotations

import argparse
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
    "pack_size",
    "pack_unit",
    "sysco_net_wt_lb",
    "tare_lb",
    "verified_net_weight_g",
    "source",
    "verified",
)
DEFAULT_DB = ROOT / "data" / "lariat.db"
# Versioned seed path. The producer script
# `scripts/seed_vendor_pack_weights.py` writes to ``costing/`` (gitignored,
# regenerated locally), but the in-repo curated source of truth lives
# under ``data/seeds/`` alongside the ingredient_{densities,yields} seeds.
DEFAULT_CSV = ROOT / "data" / "seeds" / "vendor_pack_weights.csv"
DEFAULT_VENDOR = "sysco"


def _register_vendor_arg(p: argparse.ArgumentParser) -> list[str]:
    p.add_argument(
        "--vendor",
        type=str,
        default=DEFAULT_VENDOR,
        help="Vendor to associate every row with (the CSV has no vendor column)",
    )
    return ["vendor"]


SPEC = SeedSpec(
    script_name="ingest_catch_weights",
    table_name="vendor_catch_weights",
    columns=(
        # sku is the PK-piece alongside the injected vendor.  We use
        # normalize_to_key=True with normalize_fn=strip (the default
        # identity in SeedSpec wraps the lambda below) so the shared
        # driver emits the "empty sku; skipping" stderr warning for
        # blank-sku rows rather than failing validation.
        ColumnSpec(csv_name="sku", normalize_to_key=True),
        # Human-facing metadata columns: read for shape validation,
        # not persisted.
        ColumnSpec(csv_name="ingredient", persist=False, required=False),
        ColumnSpec(csv_name="pack_size", persist=False, required=False),
        ColumnSpec(csv_name="pack_unit", persist=False, required=False),
        ColumnSpec(
            csv_name="sysco_net_wt_lb",
            db_column="catalog_wt_lb",
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
        ColumnSpec(csv_name="verified_net_weight_g", persist=False, required=False),
        # source: free-text (no enum check).  Empty -> NULL.
        ColumnSpec(csv_name="source", null_on_empty=True),
        ColumnSpec(csv_name="verified", persist=False, required=False),
    ),
    on_conflict_columns=("vendor", "sku"),
    # sku has no pre-existing normalize function — strip-only.
    normalize_fn=lambda s: str(s).strip(),
    default_db=DEFAULT_DB,
    default_csv=DEFAULT_CSV,
    extra_cli_args=_register_vendor_arg,
)


def _assert_csv_shape(csv_path: Path) -> None:
    """Thin alias for test fixtures that imported the pre-refactor helper."""
    assert_csv_shape(csv_path, EXPECTED_COLUMNS)


def main(db_path: Path, csv_path: Path, vendor: str) -> int:
    return seed_upsert_main(SPEC, db_path, csv_path, vendor=vendor)


def _cli() -> int:
    db, csv, injected = build_cli(SPEC, __doc__)
    return main(db, csv, injected.get("vendor", DEFAULT_VENDOR))


if __name__ == "__main__":
    raise SystemExit(_cli())
