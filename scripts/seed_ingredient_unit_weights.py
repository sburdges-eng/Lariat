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
"""
from __future__ import annotations

import argparse
import csv
import sqlite3
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.ingredient_key import normalize_one  # noqa: E402
from scripts.lib.units import COUNT_TO_EA, normalize_unit  # noqa: E402

ALLOWED_SOURCES: frozenset[str] = frozenset({"seed", "measured", "vendor"})
EXPECTED_COLUMNS: tuple[str, ...] = (
    "ingredient_name",
    "unit",
    "g_per_unit",
    "source",
    "notes",
)
DEFAULT_DB = ROOT / "data" / "lariat.db"
DEFAULT_CSV = ROOT / "data" / "seeds" / "ingredient_unit_weights.csv"


def _assert_csv_shape(csv_path: Path) -> None:
    expected = list(EXPECTED_COLUMNS)
    n_expected = len(expected)
    with csv_path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        try:
            header = next(reader)
        except StopIteration:
            raise ValueError(f"CSV {csv_path} is empty (no header row)")
        if header != expected:
            raise ValueError(
                f"CSV {csv_path} header mismatch: got {header!r}, "
                f"expected {expected!r}"
            )
        for line_no, fields in enumerate(reader, start=2):
            if len(fields) == 0:
                continue
            if len(fields) != n_expected:
                raise ValueError(
                    f"CSV {csv_path} line {line_no}: got {len(fields)} "
                    f"fields, expected {n_expected} "
                    f"(columns={expected}); offending row={fields!r}"
                )


def main(db_path: Path, csv_path: Path) -> int:
    if not csv_path.is_file():
        print(f"CSV not found: {csv_path}", file=sys.stderr)
        return 1
    if not db_path.exists():
        print(f"DB not found: {db_path}", file=sys.stderr)
        return 1

    _assert_csv_shape(csv_path)

    df = pd.read_csv(csv_path, dtype=str, keep_default_na=False)
    required = set(EXPECTED_COLUMNS)
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"CSV missing required columns: {sorted(missing)}")

    n_read = len(df)
    n_skipped = 0
    validated_rows: list[tuple[str, str, float, str | None]] = []

    for idx, row in df.iterrows():
        raw_name = row["ingredient_name"]
        key = normalize_one(raw_name)
        if not key:
            print(
                f"WARN row {idx}: ingredient_name={raw_name!r} normalizes to empty key; skipping",
                file=sys.stderr,
            )
            n_skipped += 1
            continue

        raw_unit = row["unit"]
        unit = normalize_unit(raw_unit)
        if not unit:
            raise ValueError(
                f"row {idx}: ingredient_name={raw_name!r} unit={raw_unit!r} "
                "normalizes to empty"
            )
        if unit not in COUNT_TO_EA:
            raise ValueError(
                f"row {idx}: ingredient_name={raw_name!r} unit={raw_unit!r} "
                f"(canonical={unit!r}) is not a count unit; "
                "densities belong in ingredient_densities.csv"
            )

        g_str = str(row["g_per_unit"]).strip()
        try:
            g_per_unit = float(g_str)
        except ValueError as e:
            raise ValueError(
                f"row {idx}: ingredient_name={raw_name!r} g_per_unit={g_str!r} is not a number"
            ) from e
        if g_per_unit <= 0:
            raise ValueError(
                f"row {idx}: ingredient_name={raw_name!r} g_per_unit={g_per_unit} must be > 0"
            )

        source_str = str(row["source"]).strip()
        if source_str == "":
            source: str | None = None
        elif source_str not in ALLOWED_SOURCES:
            raise ValueError(
                f"row {idx}: ingredient_name={raw_name!r} source={source_str!r} "
                f"not in allowed values {sorted(ALLOWED_SOURCES)}"
            )
        else:
            source = source_str

        _ = str(row["notes"]).strip()  # notes not persisted; CSV keeps provenance

        validated_rows.append((key, unit, g_per_unit, source))

    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("BEGIN")
        for key, unit, g_per_unit, source in validated_rows:
            conn.execute(
                """
                INSERT INTO ingredient_unit_weights (ingredient_key, unit, g_per_unit, source, updated_at)
                VALUES (?, ?, ?, ?, datetime('now'))
                ON CONFLICT(ingredient_key, unit) DO UPDATE SET
                    g_per_unit = excluded.g_per_unit,
                    source = excluded.source,
                    updated_at = datetime('now')
                """,
                (key, unit, g_per_unit, source),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    n_upserted = len(validated_rows)
    print(
        f"seed_ingredient_unit_weights: read={n_read} upserted={n_upserted} skipped={n_skipped}",
        file=sys.stderr,
    )
    return 0


def _cli() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--db", type=Path, default=DEFAULT_DB, help="SQLite DB path")
    p.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="Input CSV path")
    args = p.parse_args()
    return main(args.db, args.csv)


if __name__ == "__main__":
    raise SystemExit(_cli())
