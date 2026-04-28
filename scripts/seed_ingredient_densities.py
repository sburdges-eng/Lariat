#!/usr/bin/env python3
"""Idempotent UPSERT of ingredient density rows from data/seeds/ingredient_densities.csv.

The CSV author writes raw human-readable ingredient names; this script
normalizes them into the canonical key via scripts.lib.ingredient_key.normalize_one
(the byte-exact same algorithm used by every other mapping-engine join).

CSV columns (header row required):
    ingredient_name, g_per_ml, source, notes

Validation:
    - g_per_ml MUST be > 0.
    - source MUST be in {'seed','measured','vendor'} or empty (NULL).
    - ingredient_key (post-normalization) MUST be non-empty;
      rows that normalize to "" are skipped with a warning.

Transaction semantics:
    - All UPSERTs wrapped in a single transaction.
    - Any validation failure raises and rolls back the whole batch —
      we fail loud rather than silently emit a partial seed.

Idempotency:
    - UPSERT on PRIMARY KEY(ingredient_key).
    - Running twice against the same CSV yields the same row count
      in the table (verified by test_seed_ingredient_densities.py).

Shared skeleton lives in scripts.lib.seed_upsert (debt D2).
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.ingredient_key import normalize_one  # noqa: E402
from scripts.lib.seed_upsert import (  # noqa: E402
    ALLOWED_SEED_SOURCES,
    ColumnSpec,
    SeedSpec,
    assert_csv_shape,
    build_cli,
    seed_upsert_main,
)

ALLOWED_SOURCES: frozenset[str] = ALLOWED_SEED_SOURCES
EXPECTED_COLUMNS: tuple[str, ...] = (
    "ingredient_name",
    "g_per_ml",
    "source",
    "notes",
)
DEFAULT_DB = ROOT / "data" / "lariat.db"
DEFAULT_CSV = ROOT / "data" / "seeds" / "ingredient_densities.csv"


SPEC = SeedSpec(
    script_name="seed_ingredient_densities",
    table_name="ingredient_densities",
    columns=(
        ColumnSpec(
            csv_name="ingredient_name",
            db_column="ingredient_key",
            normalize_to_key=True,
        ),
        ColumnSpec(
            csv_name="g_per_ml",
            coerce=float,
            validate=lambda v: v > 0,
            validate_msg="must be > 0",
        ),
        # source: empty -> NULL; if non-empty, must be in ALLOWED_SOURCES.
        ColumnSpec(
            csv_name="source",
            null_on_empty=True,
            validate=lambda v: v in ALLOWED_SEED_SOURCES,
            validate_msg=f"not in allowed values {sorted(ALLOWED_SEED_SOURCES)}",
        ),
        # notes is intentionally not stored: the T1/T2a ingredient_densities
        # schema has no `notes` column (unlike ingredient_yields). The CSV
        # keeps provenance for humans; the DB stores the number.
        ColumnSpec(csv_name="notes", persist=False, required=False),
    ),
    on_conflict_columns=("ingredient_key",),
    normalize_fn=normalize_one,
    default_db=DEFAULT_DB,
    default_csv=DEFAULT_CSV,
)


# Back-compat alias for tests that import the pre-refactor helper name.
def _assert_csv_shape(csv_path: Path) -> None:
    """Kept as a thin alias so test fixtures importing the old helper
    name continue to work. Delegates to the shared lib."""
    assert_csv_shape(csv_path, EXPECTED_COLUMNS)


def main(db_path: Path, csv_path: Path) -> int:
    """Seed ingredient_densities from csv_path into sqlite db at db_path.

    Returns 0 on success. Raises on any validation error; the
    transaction rolls back on exception.
    """
    return seed_upsert_main(SPEC, db_path, csv_path)


def _cli() -> int:
    db, csv, injected = build_cli(SPEC, __doc__)
    return main(db, csv)


if __name__ == "__main__":
    raise SystemExit(_cli())
