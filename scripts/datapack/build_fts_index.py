#!/usr/bin/env python3
"""
Lariat Data Pack — SQLite FTS5 search index (Task I2).

Builds a separate full-text-search SQLite database alongside the main data
DB. Stores FTS5 virtual tables for the three text-bearing source tables in
``lariat_data.db`` and exposes BM25 ranking via FTS5's built-in ``bm25()``
ranking function.

Output:
    data/lariat-data/indexes/search/fts/
        lariat_fts.db   — contentless FTS5 index, rowid = source PK
        manifest.json   — sha256 of the input DB, row counts, build wall-time

Indexed tables (rowid = source primary key, FTS5 contentless mode):
    usda_foods_fts          rowid = usda_foods.fdc_id
        columns: description, food_category, brand_owner, ingredients
    off_products_fts        rowid = INTEGER hash of off_products.code
        columns: product_name, brands, brand_owner, ingredients_text
        — also stores a code_text column so callers can recover the GTIN
        without a join (FTS5 rowid must be INTEGER; code is a TEXT GTIN
        with leading zeros, which is why we hash + carry the original).
    wikibooks_pages_fts     rowid = wikibooks_pages.page_id
        columns: title, plain_text_summary

Query pattern (Python):
    conn = sqlite3.connect('lariat_fts.db')
    conn.execute("ATTACH 'lariat_data.db' AS src")
    rows = conn.execute('''
        SELECT f.fdc_id, f.description, bm25(usda_foods_fts) AS score
        FROM usda_foods_fts AS s
        JOIN src.usda_foods AS f ON f.fdc_id = s.rowid
        WHERE usda_foods_fts MATCH 'scrambled eggs'
        ORDER BY score LIMIT 10
    ''')

Idempotency: ``manifest.json`` records the sha256 of the input
``lariat_data.db``. If the input hash and FTS DB are unchanged, exit early.

CLI:
    python scripts/datapack/build_fts_index.py
    python scripts/datapack/build_fts_index.py --force
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scripts.datapack._io import (  # noqa: E402
    atomic_replace as _atomic_replace,
    atomic_write_text as _atomic_write_text,
    default_data_root as _default_data_root,
    human_bytes as _human_bytes,
    sha256_file as _sha256_file,
)


def _default_input_db() -> Path:
    return _default_data_root() / "indexes" / "sqlite" / "lariat_data.db"


def _default_output_dir() -> Path:
    return _default_data_root() / "indexes" / "search" / "fts"


# ---------------------------------------------------------------------------
# FTS5 schema
# ---------------------------------------------------------------------------

# We use contentless mode (content='') — FTS5 stores its own copy of the
# indexed text, decoupled from the source DB so callers can ship the FTS DB
# alone and rebuild it without touching lariat_data.db. The unicode61
# tokenizer plus `porter` stemmer covers English well enough for retrieval.
_TOKENIZE = "porter unicode61"


def _ddl_fts_tables() -> tuple[str, ...]:
    return (
        f"""
        CREATE VIRTUAL TABLE usda_foods_fts USING fts5(
            description,
            food_category,
            brand_owner,
            ingredients,
            content='',
            tokenize='{_TOKENIZE}'
        )
        """,
        f"""
        CREATE VIRTUAL TABLE off_products_fts USING fts5(
            product_name,
            brands,
            brand_owner,
            ingredients_text,
            content='',
            tokenize='{_TOKENIZE}'
        )
        """,
        # FTS5 contentless mode does not store any column data, including
        # UNINDEXED columns — SELECTs return NULL for every column. Since
        # off_products has no INTEGER PK we can route into the FTS rowid,
        # we keep an explicit fts_rowid → code map alongside the FTS index
        # so callers can recover the GTIN of a hit and join back to
        # src.off_products.
        """
        CREATE TABLE off_products_codes (
            fts_rowid INTEGER PRIMARY KEY,
            code      TEXT NOT NULL UNIQUE
        )
        """,
        f"""
        CREATE VIRTUAL TABLE wikibooks_pages_fts USING fts5(
            title,
            plain_text_summary,
            content='',
            tokenize='{_TOKENIZE}'
        )
        """,
        """
        CREATE TABLE _manifest (
            source         TEXT PRIMARY KEY,
            source_table   TEXT NOT NULL,
            input_sha256   TEXT NOT NULL,
            rows_indexed   INTEGER NOT NULL,
            indexed_at     TEXT NOT NULL,
            elapsed_seconds REAL
        ) WITHOUT ROWID
        """,
    )


# Tuned for write-heavy build. Restored at the end via FINALIZE PRAGMAs.
PRAGMAS_BUILD: tuple[str, ...] = (
    "PRAGMA journal_mode=WAL",
    "PRAGMA synchronous=OFF",
    "PRAGMA temp_store=MEMORY",
    "PRAGMA cache_size=-262144",
    "PRAGMA locking_mode=EXCLUSIVE",
)

PRAGMAS_FINALIZE: tuple[str, ...] = (
    "PRAGMA synchronous=NORMAL",
    "PRAGMA wal_checkpoint(TRUNCATE)",
    "PRAGMA optimize",
)


# ---------------------------------------------------------------------------
# Per-source population
# ---------------------------------------------------------------------------

# Each tuple is (fts_table, source_table, select_sql, log_label).
# The SELECT is run via ATTACH so the source DB stays read-only.
SOURCE_POPULATIONS: tuple[tuple[str, str, str, str], ...] = (
    (
        "usda_foods_fts",
        "usda_foods",
        """
        INSERT INTO usda_foods_fts(rowid, description, food_category,
                                   brand_owner, ingredients)
        SELECT fdc_id,
               COALESCE(description, ''),
               COALESCE(food_category, ''),
               COALESCE(brand_owner, ''),
               COALESCE(ingredients, '')
        FROM src.usda_foods
        """,
        "usda_foods",
    ),
    (
        "off_products_fts",
        "off_products",
        # Two INSERTs: the FTS5 rowid is assigned via ROW_NUMBER() over a
        # deterministic order (ORDER BY code), and off_products_codes uses
        # the same windowed row number so its fts_rowid → code mapping
        # matches exactly. The runner executes the list as a transaction.
        [
            """
            INSERT INTO off_products_fts(rowid, product_name, brands,
                                         brand_owner, ingredients_text)
            SELECT ROW_NUMBER() OVER (ORDER BY code),
                   COALESCE(product_name, ''),
                   COALESCE(brands, ''),
                   COALESCE(brand_owner, ''),
                   COALESCE(ingredients_text, '')
            FROM src.off_products
            """,
            """
            INSERT INTO off_products_codes(fts_rowid, code)
            SELECT ROW_NUMBER() OVER (ORDER BY code), code
            FROM src.off_products
            """,
        ],
        "off_products",
    ),
    (
        "wikibooks_pages_fts",
        "wikibooks_pages",
        """
        INSERT INTO wikibooks_pages_fts(rowid, title, plain_text_summary)
        SELECT page_id,
               COALESCE(title, ''),
               COALESCE(plain_text_summary, '')
        FROM src.wikibooks_pages
        WHERE is_redirect = 0
        """,
        "wikibooks_pages (non-redirects only)",
    ),
)


# ---------------------------------------------------------------------------
# Manifest helpers
# ---------------------------------------------------------------------------


def _read_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _is_up_to_date(
    manifest: dict[str, Any],
    fts_db_path: Path,
    input_sha: str,
) -> bool:
    return (
        fts_db_path.exists()
        and manifest.get("input_sha256") == input_sha
    )


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------


def build(
    *,
    input_db: Path,
    output_dir: Path,
    force: bool = False,
) -> dict[str, Any]:
    if not input_db.exists():
        raise FileNotFoundError(f"Input DB missing: {input_db}")

    output_dir.mkdir(parents=True, exist_ok=True)
    fts_final = output_dir / "lariat_fts.db"
    fts_tmp = output_dir / "lariat_fts.db.tmp"
    manifest_path = output_dir / "manifest.json"

    print(f"  hashing input DB ({_human_bytes(input_db.stat().st_size)})…")
    input_sha = _sha256_file(input_db)

    if not force:
        prev = _read_manifest(manifest_path)
        if _is_up_to_date(prev, fts_final, input_sha):
            print("  ✓ Up to date — input sha256 matches manifest.")
            print(f"    FTS DB: {fts_final} ({_human_bytes(fts_final.stat().st_size)})")
            return prev

    # Clean stale tmp + sidecars from a prior crash.
    if fts_tmp.exists():
        fts_tmp.unlink()
    for sidecar_suffix in ("-wal", "-shm"):
        sidecar = fts_tmp.with_name(fts_tmp.name + sidecar_suffix)
        if sidecar.exists():
            sidecar.unlink()

    t_total = time.time()
    conn = sqlite3.connect(str(fts_tmp))
    try:
        for stmt in PRAGMAS_BUILD:
            conn.execute(stmt)

        # ATTACH the source DB read-only so we don't risk mutating it.
        # Use parameterized ATTACH so apostrophes in the path (e.g. "Sean's
        # SSD") don't break the SQL string. Bare path is fine — ATTACH does
        # not need a file: URI to be read-only at the OS level here.
        conn.execute("ATTACH DATABASE ? AS src", (str(input_db),))

        for stmt in _ddl_fts_tables():
            conn.execute(stmt)

        per_source_stats: dict[str, dict[str, Any]] = {}

        for fts_table, source_table, insert_sql, label in SOURCE_POPULATIONS:
            src_rows = conn.execute(
                f"SELECT COUNT(*) FROM src.{source_table}"
                + (
                    " WHERE is_redirect=0"
                    if source_table == "wikibooks_pages"
                    else ""
                )
            ).fetchone()[0]
            print(f"  → {fts_table}  ({src_rows:,} rows from {label})")

            # insert_sql is either a single SQL string or a list of strings
            # to run inside one transaction (e.g. off_products needs both an
            # FTS insert and a parallel codes-table insert).
            statements = (
                [insert_sql] if isinstance(insert_sql, str) else list(insert_sql)
            )

            t0 = time.time()
            conn.execute("BEGIN")
            try:
                for stmt in statements:
                    conn.execute(stmt)
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            elapsed = time.time() - t0

            indexed = conn.execute(
                f"SELECT COUNT(*) FROM {fts_table}"
            ).fetchone()[0]
            rate = indexed / elapsed if elapsed > 0 else float("inf")
            print(f"    {indexed:,} rows indexed in {elapsed:.1f}s ({rate:,.0f}/s)")

            per_source_stats[fts_table] = {
                "source_table": source_table,
                "rows_indexed": indexed,
                "elapsed_seconds": round(elapsed, 3),
            }

        # Persist manifest into the FTS DB itself.
        loaded_at = datetime.now(timezone.utc).isoformat()
        conn.executemany(
            "INSERT INTO _manifest VALUES (?, ?, ?, ?, ?, ?)",
            [
                (
                    fts_table,
                    stats["source_table"],
                    input_sha,
                    stats["rows_indexed"],
                    loaded_at,
                    stats["elapsed_seconds"],
                )
                for fts_table, stats in per_source_stats.items()
            ],
        )
        conn.commit()

        # FTS5 stores the index in the same DB; an explicit optimize merges
        # segments for faster queries.
        for fts_table in (k for k in per_source_stats):
            conn.execute(f"INSERT INTO {fts_table}({fts_table}) VALUES('optimize')")
        conn.commit()

        conn.execute("DETACH DATABASE src")
        for stmt in PRAGMAS_FINALIZE:
            conn.execute(stmt)
    finally:
        conn.close()

    # Rename → final path.
    for sidecar_suffix in ("-wal", "-shm"):
        sidecar = fts_tmp.with_name(fts_tmp.name + sidecar_suffix)
        if sidecar.exists():
            sidecar.unlink()
    _atomic_replace(fts_tmp, fts_final)

    total_elapsed = round(time.time() - t_total, 2)
    db_size = fts_final.stat().st_size
    print(f"  ✓ Built {fts_final} ({_human_bytes(db_size)}) in {total_elapsed}s")

    manifest = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fts_db_file": fts_final.name,
        "fts_db_bytes": db_size,
        "input_db_file": input_db.name,
        "input_sha256": input_sha,
        "elapsed_seconds": total_elapsed,
        "tokenizer": _TOKENIZE,
        "sources": per_source_stats,
    }
    _atomic_write_text(manifest_path, json.dumps(manifest, indent=2, sort_keys=True))
    return manifest


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Build SQLite FTS5 search index from lariat_data.db."
    )
    p.add_argument(
        "--input-db",
        type=Path,
        default=_default_input_db(),
        help="Path to the source SQLite DB built by build_sqlite_index.py. "
        "Default: data/lariat-data/indexes/sqlite/lariat_data.db",
    )
    p.add_argument(
        "--output-dir",
        type=Path,
        default=_default_output_dir(),
        help="Directory to write lariat_fts.db and manifest.json into. "
        "Default: data/lariat-data/indexes/search/fts",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Ignore existing manifest and rebuild from scratch.",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    print("Lariat Data Pack — FTS5 search index")
    print(f"  input_db:   {args.input_db}")
    print(f"  output_dir: {args.output_dir}")
    if args.force:
        print("  force: rebuild requested")
    build(input_db=args.input_db, output_dir=args.output_dir, force=args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
