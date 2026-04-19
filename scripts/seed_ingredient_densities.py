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
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.ingredient_key import normalize_one  # noqa: E402

ALLOWED_SOURCES: frozenset[str] = frozenset({"seed", "measured", "vendor"})
DEFAULT_DB = ROOT / "data" / "lariat.db"
DEFAULT_CSV = ROOT / "data" / "seeds" / "ingredient_densities.csv"


def main(db_path: Path, csv_path: Path) -> int:
    """Seed ingredient_densities from csv_path into sqlite db at db_path.

    Returns 0 on success. Raises (via sqlite3 or ValueError) on any
    validation error; the transaction rolls back on exception.
    """
    if not csv_path.is_file():
        print(f"CSV not found: {csv_path}", file=sys.stderr)
        return 1
    if not db_path.exists():
        print(f"DB not found: {db_path}", file=sys.stderr)
        return 1

    df = pd.read_csv(csv_path, dtype=str, keep_default_na=False)
    required = {"ingredient_name", "g_per_ml", "source", "notes"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"CSV missing required columns: {sorted(missing)}")

    n_read = len(df)
    n_skipped = 0
    validated_rows: list[tuple[str, float, str | None, str | None]] = []

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

        g_per_ml_str = str(row["g_per_ml"]).strip()
        try:
            g_per_ml = float(g_per_ml_str)
        except ValueError as e:
            raise ValueError(
                f"row {idx}: ingredient_name={raw_name!r} g_per_ml={g_per_ml_str!r} is not a number"
            ) from e
        if g_per_ml <= 0:
            raise ValueError(
                f"row {idx}: ingredient_name={raw_name!r} g_per_ml={g_per_ml} must be > 0"
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

        notes_str = str(row["notes"]).strip()
        notes: str | None = notes_str if notes_str != "" else None

        validated_rows.append((key, g_per_ml, source, notes))

    # Single-transaction UPSERT. On any error the with-block triggers
    # rollback; on clean exit it commits.
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("BEGIN")
        for key, g_per_ml, source, notes in validated_rows:
            conn.execute(
                """
                INSERT INTO ingredient_densities (ingredient_key, g_per_ml, source, updated_at)
                VALUES (?, ?, ?, datetime('now'))
                ON CONFLICT(ingredient_key) DO UPDATE SET
                    g_per_ml = excluded.g_per_ml,
                    source = excluded.source,
                    updated_at = datetime('now')
                """,
                (key, g_per_ml, source),
            )
            # notes is intentionally not stored: the T1/T2a ingredient_densities
            # schema has no `notes` column (unlike ingredient_yields). The CSV
            # keeps provenance for humans; the DB stores the number.
            _ = notes
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    n_upserted = len(validated_rows)
    print(
        f"seed_ingredient_densities: read={n_read} upserted={n_upserted} skipped={n_skipped}",
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
