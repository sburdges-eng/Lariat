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
set to 'sysco' for every row since this CSV is Sysco-sourced;
Shamrock catch-weights will flow in via a sibling ingest (T5b).

Validation:
    - catalog_wt_lb (= sysco_net_wt_lb) MUST be > 0.
    - tare_lb, if present, MUST be >= 0.
    - sku MUST be non-empty after stripping.
    - source is free-text (no CHECK on this table — sources include
      'sysco_catalog', 'user-measured 2026-04-04', etc.).

Idempotency: UPSERT on PRIMARY KEY (vendor, sku); running twice
against the same CSV yields the same row count. Verified by
tests/python/test_ingest_catch_weights.py.
"""
from __future__ import annotations

import argparse
import csv
import sqlite3
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
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
                    f"fields, expected {n_expected} (columns={expected}); "
                    f"offending row={fields!r}"
                )


def _parse_lb(raw: object, *, allow_blank: bool) -> float | None:
    s = str(raw).strip() if raw is not None else ""
    if s == "":
        if allow_blank:
            return None
        raise ValueError("blank value where a number was required")
    return float(s)


def main(db_path: Path, csv_path: Path, vendor: str) -> int:
    if not csv_path.is_file():
        print(f"CSV not found: {csv_path}", file=sys.stderr)
        return 1
    if not db_path.exists():
        print(f"DB not found: {db_path}", file=sys.stderr)
        return 1

    _assert_csv_shape(csv_path)

    df = pd.read_csv(csv_path, dtype=str, keep_default_na=False)
    missing = set(EXPECTED_COLUMNS) - set(df.columns)
    if missing:
        raise ValueError(f"CSV missing required columns: {sorted(missing)}")

    n_read = len(df)
    n_skipped = 0
    validated: list[tuple[str, str, float, float | None, str | None]] = []

    for idx, row in df.iterrows():
        sku = str(row["sku"]).strip()
        if not sku:
            print(f"WARN row {idx}: empty sku; skipping", file=sys.stderr)
            n_skipped += 1
            continue

        try:
            catalog_wt_lb = _parse_lb(row["sysco_net_wt_lb"], allow_blank=False)
        except ValueError as e:
            raise ValueError(
                f"row {idx}: sku={sku!r} sysco_net_wt_lb={row['sysco_net_wt_lb']!r} "
                f"invalid: {e}"
            ) from e
        if catalog_wt_lb <= 0:
            raise ValueError(
                f"row {idx}: sku={sku!r} sysco_net_wt_lb={catalog_wt_lb} must be > 0"
            )

        try:
            tare_lb = _parse_lb(row["tare_lb"], allow_blank=True)
        except ValueError as e:
            raise ValueError(
                f"row {idx}: sku={sku!r} tare_lb={row['tare_lb']!r} invalid: {e}"
            ) from e
        if tare_lb is not None and tare_lb < 0:
            raise ValueError(
                f"row {idx}: sku={sku!r} tare_lb={tare_lb} must be >= 0"
            )

        source_str = str(row["source"]).strip()
        source: str | None = source_str if source_str else None

        validated.append((vendor, sku, catalog_wt_lb, tare_lb, source))

    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("BEGIN")
        for vendor_val, sku, catalog_wt_lb, tare_lb, source in validated:
            conn.execute(
                """
                INSERT INTO vendor_catch_weights (vendor, sku, catalog_wt_lb, tare_lb, source, updated_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(vendor, sku) DO UPDATE SET
                    catalog_wt_lb = excluded.catalog_wt_lb,
                    tare_lb = excluded.tare_lb,
                    source = excluded.source,
                    updated_at = datetime('now')
                """,
                (vendor_val, sku, catalog_wt_lb, tare_lb, source),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    print(
        f"ingest_catch_weights: read={n_read} upserted={len(validated)} skipped={n_skipped}",
        file=sys.stderr,
    )
    return 0


def _cli() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--db", type=Path, default=DEFAULT_DB, help="SQLite DB path")
    p.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="Input CSV path")
    p.add_argument(
        "--vendor",
        type=str,
        default=DEFAULT_VENDOR,
        help="Vendor to associate every row with (the CSV has no vendor column)",
    )
    args = p.parse_args()
    return main(args.db, args.csv, args.vendor)


if __name__ == "__main__":
    raise SystemExit(_cli())
