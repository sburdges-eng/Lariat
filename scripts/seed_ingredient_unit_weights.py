#!/usr/bin/env python3
"""Idempotent UPSERT of ingredient_unit_weights rows from
data/seeds/ingredient_unit_weights.csv.

Answers "how many grams is one <unit> of <ingredient>" for count units —
the T4 conversion post-pass uses this to bridge count ↔ weight (and
count → volume when combined with ingredient_densities). Mirrors
seed_ingredient_densities.py exactly for validation + idempotency
semantics.

CSV columns (header row required):
    ingredient_name, unit, g_per_unit, source, notes

Validation:
    - g_per_unit MUST be > 0.
    - source MUST be in {'seed','measured','vendor'} or empty (NULL).
    - ingredient_key (post-normalization) MUST be non-empty.
    - unit post-normalize_unit MUST be non-empty AND be a canonical
      count unit (present in COUNT_TO_EA) — this catches typos at seed
      time rather than at conversion time.

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
from scripts.lib.units import COUNT_TO_EA, normalize_unit  # noqa: E402

ALLOWED_SOURCES: frozenset[str] = ALLOWED_SEED_SOURCES
EXPECTED_COLUMNS: tuple[str, ...] = (
    "ingredient_name",
    "unit",
    "g_per_unit",
    "source",
    "notes",
)
DEFAULT_DB = ROOT / "data" / "lariat.db"
DEFAULT_CSV = ROOT / "data" / "seeds" / "ingredient_unit_weights.csv"


SPEC = SeedSpec(
    script_name="seed_ingredient_unit_weights",
    table_name="ingredient_unit_weights",
    columns=(
        ColumnSpec(
            csv_name="ingredient_name",
            db_column="ingredient_key",
            normalize_to_key=True,
        ),
        # unit: normalize_unit() first, then membership check in COUNT_TO_EA.
        # normalize_to_key so composite-PK validation behavior mirrors the
        # ingredient_key column (empty-after-normalize -> raise at seed time).
        # The post_normalize_empty_msg provides the pre-refactor text for an
        # empty-after-normalize unit.
        ColumnSpec(
            csv_name="unit",
            post_normalize=normalize_unit,
            post_normalize_empty_msg="normalizes to empty",
            validate=lambda v: v in COUNT_TO_EA,
            validate_msg=(
                "is not a count unit; densities belong in ingredient_densities.csv"
            ),
        ),
        ColumnSpec(
            csv_name="g_per_unit",
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
        # notes is read (shape validation) but not persisted; CSV keeps
        # provenance for humans, DB stores the number.
        ColumnSpec(csv_name="notes", persist=False, required=False),
    ),
    on_conflict_columns=("ingredient_key", "unit"),
    normalize_fn=normalize_one,
    default_db=DEFAULT_DB,
    default_csv=DEFAULT_CSV,
)


def _assert_csv_shape(csv_path: Path) -> None:
    """Thin alias for test fixtures that imported the pre-refactor helper."""
    assert_csv_shape(csv_path, EXPECTED_COLUMNS)


def main(db_path: Path, csv_path: Path) -> int:
    return seed_upsert_main(SPEC, db_path, csv_path)


def _cli() -> int:
    db, csv, _injected = build_cli(SPEC, __doc__)
    return main(db, csv)


if __name__ == "__main__":
    raise SystemExit(_cli())
