#!/usr/bin/env python3
"""
Lariat Data Pack — SQLite indexer (Task I1).

Loads the four normalized JSONL streams into a single queryable SQLite DB:

    data/lariat-data/indexes/sqlite/
        lariat_data.db    — one DB file with all source tables
        manifest.json     — sha256s of inputs, row counts, build wall-time

Tables (one per normalized stream, plus a small _manifest table):
    usda_foods          — 2.06M rows, PK fdc_id
    usda_nutrients      — 26.8M rows (fdc_id, nutrient_id) composite key
    off_products        — 4.13M rows, PK code
    wikibooks_pages     — 7.8K rows, PK page_id
    off_allergens       — flat key/value JSON for the OFF allergens summary
    _manifest           — per-source input sha256 + row count + loaded_at

The build is fully rebuildable from the JSONL inputs; we never UPDATE rows.
The DB is built into ``lariat_data.db.tmp`` and atomically renamed on success
so a crashed run never leaves a half-built file at the canonical path.

Idempotency: if ``manifest.json`` records the same sha256 for every input
JSONL that's currently on disk, the script exits early. Pass ``--force`` to
rebuild from scratch.

CLI:
    python scripts/datapack/build_sqlite_index.py
    python scripts/datapack/build_sqlite_index.py --force
    python scripts/datapack/build_sqlite_index.py \\
        --input-root  /path/to/normalized \\
        --output-dir  /path/to/indexes/sqlite
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

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


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------


def _default_input_root() -> Path:
    return _default_data_root() / "normalized"


def _default_output_dir() -> Path:
    return _default_data_root() / "indexes" / "sqlite"


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

# DDL is split into (a) bulk-insert tables, (b) post-load indexes. We create
# tables WITHOUT secondary indexes, do the inserts in one big transaction
# per table, then build indexes — index creation on a fully-populated table
# is dramatically faster than maintaining the index per-row during inserts.

DDL_TABLES: tuple[str, ...] = (
    """
    CREATE TABLE usda_foods (
        fdc_id            INTEGER PRIMARY KEY,
        data_type         TEXT,
        source_archive    TEXT,
        description       TEXT,
        food_category     TEXT,
        food_category_id  INTEGER,
        brand_owner       TEXT,
        gtin_upc          TEXT,
        ingredients       TEXT,
        serving_size      REAL,
        serving_size_unit TEXT
    ) WITHOUT ROWID
    """,
    """
    CREATE TABLE usda_nutrients (
        fdc_id         INTEGER NOT NULL,
        nutrient_id    INTEGER NOT NULL,
        nutrient_name  TEXT,
        amount         REAL,
        unit_name      TEXT,
        derivation_id  INTEGER,
        source_archive TEXT
    )
    """,
    """
    CREATE TABLE off_products (
        code                TEXT PRIMARY KEY,
        product_name        TEXT,
        brands              TEXT,
        brand_owner         TEXT,
        ingredients_text    TEXT,
        allergens_tags_json TEXT,
        traces_tags_json    TEXT,
        categories_tags_json TEXT,
        countries_en        TEXT,
        nutriscore_grade    TEXT,
        serving_size        TEXT,
        source_url          TEXT
    ) WITHOUT ROWID
    """,
    """
    CREATE TABLE wikibooks_pages (
        page_id            INTEGER PRIMARY KEY,
        title              TEXT,
        slug               TEXT,
        source_url         TEXT,
        is_redirect        INTEGER,
        redirect_target    TEXT,
        plain_text_summary TEXT,
        wikitext_length    INTEGER,
        categories_json    TEXT
    ) WITHOUT ROWID
    """,
    """
    CREATE TABLE off_allergens (
        key        TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
    ) WITHOUT ROWID
    """,
    """
    CREATE TABLE fda_food_code_sections (
        rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
        section_id  TEXT,
        title       TEXT,
        chapter     TEXT,
        annex       TEXT,
        body        TEXT NOT NULL,
        char_count  INTEGER,
        page_start  INTEGER,
        page_end    INTEGER
    )
    """,
    """
    CREATE TABLE _manifest (
        source         TEXT PRIMARY KEY,
        source_file    TEXT NOT NULL,
        source_sha256  TEXT NOT NULL,
        rows_loaded    INTEGER NOT NULL,
        loaded_at      TEXT NOT NULL,
        elapsed_seconds REAL
    ) WITHOUT ROWID
    """,
)

DDL_INDEXES: tuple[str, ...] = (
    "CREATE INDEX idx_usda_foods_desc ON usda_foods(description)",
    "CREATE INDEX idx_usda_foods_cat ON usda_foods(food_category_id)",
    "CREATE INDEX idx_usda_foods_gtin ON usda_foods(gtin_upc) WHERE gtin_upc IS NOT NULL",
    "CREATE INDEX idx_usda_nutrients_fdc ON usda_nutrients(fdc_id)",
    "CREATE INDEX idx_usda_nutrients_nid ON usda_nutrients(nutrient_id)",
    "CREATE INDEX idx_off_products_name ON off_products(product_name)",
    "CREATE INDEX idx_off_products_brand ON off_products(brand_owner) WHERE brand_owner IS NOT NULL",
    "CREATE INDEX idx_wikibooks_pages_title ON wikibooks_pages(title)",
    "CREATE INDEX idx_wikibooks_pages_slug ON wikibooks_pages(slug)",
    "CREATE INDEX idx_fda_food_code_section_id ON fda_food_code_sections(section_id) WHERE section_id IS NOT NULL",
    "CREATE INDEX idx_fda_food_code_chapter ON fda_food_code_sections(chapter) WHERE chapter IS NOT NULL",
    "CREATE INDEX idx_fda_food_code_annex ON fda_food_code_sections(annex) WHERE annex IS NOT NULL",
)

# Tuned PRAGMAs for bulk inserts. We restore synchronous=NORMAL after the
# build so a deployed copy of the DB is still durable for normal queries —
# during the build we only need atomicity, not per-tx fsync.
PRAGMAS_BUILD: tuple[str, ...] = (
    "PRAGMA journal_mode=WAL",
    "PRAGMA synchronous=OFF",
    "PRAGMA temp_store=MEMORY",
    "PRAGMA cache_size=-262144",  # 256 MB page cache
    "PRAGMA locking_mode=EXCLUSIVE",
)

PRAGMAS_FINALIZE: tuple[str, ...] = (
    "PRAGMA synchronous=NORMAL",
    "PRAGMA wal_checkpoint(TRUNCATE)",
    "PRAGMA optimize",
)

BATCH_SIZE = 50_000


# ---------------------------------------------------------------------------
# JSONL streaming
# ---------------------------------------------------------------------------


def _iter_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    """Yield one parsed JSON object per non-blank line."""
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            yield json.loads(line)


# ---------------------------------------------------------------------------
# Per-source loaders
# ---------------------------------------------------------------------------


def _row_to_usda_food(r: dict[str, Any]) -> tuple:
    return (
        r["fdc_id"],
        r.get("data_type"),
        r.get("source_archive"),
        r.get("description"),
        r.get("food_category"),
        r.get("food_category_id"),
        r.get("brand_owner"),
        r.get("gtin_upc"),
        r.get("ingredients"),
        r.get("serving_size"),
        r.get("serving_size_unit"),
    )


def _row_to_usda_nutrient(r: dict[str, Any]) -> tuple:
    return (
        r["fdc_id"],
        r["nutrient_id"],
        r.get("nutrient_name"),
        r.get("amount"),
        r.get("unit_name"),
        r.get("derivation_id"),
        r.get("source_archive"),
    )


def _row_to_off_product(r: dict[str, Any]) -> tuple:
    return (
        r["code"],
        r.get("product_name"),
        r.get("brands"),
        r.get("brand_owner"),
        r.get("ingredients_text"),
        json.dumps(r.get("allergens_tags") or []),
        json.dumps(r.get("traces_tags") or []),
        json.dumps(r.get("categories_tags") or []),
        r.get("countries_en"),
        r.get("nutriscore_grade"),
        r.get("serving_size"),
        r.get("source_url"),
    )


def _row_to_wikibooks_page(r: dict[str, Any]) -> tuple:
    return (
        r["page_id"],
        r.get("title"),
        r.get("slug"),
        r.get("source_url"),
        1 if r.get("is_redirect") else 0,
        r.get("redirect_target"),
        r.get("plain_text_summary"),
        r.get("wikitext_length"),
        json.dumps(r.get("categories") or []),
    )


def _row_to_fda_food_code_section(r: dict[str, Any]) -> tuple:
    # Skip the AUTOINCREMENT rowid column — SQLite assigns it.
    return (
        r.get("section_id"),
        r.get("title"),
        r.get("chapter"),
        r.get("annex"),
        r.get("body") or "",
        r.get("char_count"),
        r.get("page_start"),
        r.get("page_end"),
    )


# (table, jsonl path key, column count, row mapper)
SOURCES: tuple[tuple[str, str, int, Callable[[dict[str, Any]], tuple]], ...] = (
    ("usda_foods",       "usda/ingredients.jsonl",           11, _row_to_usda_food),
    ("usda_nutrients",   "usda/nutrients.jsonl",              7, _row_to_usda_nutrient),
    ("off_products",     "openfoodfacts/branded_products.jsonl", 12, _row_to_off_product),
    ("wikibooks_pages",  "wikibooks/cookbook_pages.jsonl",    9, _row_to_wikibooks_page),
    ("fda_food_code_sections", "fda_food_code/sections.jsonl", 8, _row_to_fda_food_code_section),
)

# Tables that skip the AUTOINCREMENT rowid in the INSERT (so the column
# count above counts only the named columns the mapper emits). Anything
# not in this dict uses a bare ``INSERT INTO {table} VALUES (?, …)`` form.
NAMED_COLUMN_LOADERS: dict[str, str] = {
    "fda_food_code_sections": (
        "section_id, title, chapter, annex, body, char_count, "
        "page_start, page_end"
    ),
}


def _load_jsonl_table(
    conn: sqlite3.Connection,
    table: str,
    n_cols: int,
    jsonl_path: Path,
    mapper: Callable[[dict[str, Any]], tuple],
) -> int:
    """Stream a JSONL file into ``table`` in batches, return rows inserted."""
    placeholders = ",".join(["?"] * n_cols)
    if table in NAMED_COLUMN_LOADERS:
        sql = f"INSERT INTO {table} ({NAMED_COLUMN_LOADERS[table]}) VALUES ({placeholders})"
    else:
        sql = f"INSERT INTO {table} VALUES ({placeholders})"

    rows = 0
    batch: list[tuple] = []
    cur = conn.cursor()
    cur.execute("BEGIN")
    try:
        for obj in _iter_jsonl(jsonl_path):
            batch.append(mapper(obj))
            if len(batch) >= BATCH_SIZE:
                cur.executemany(sql, batch)
                rows += len(batch)
                batch.clear()
        if batch:
            cur.executemany(sql, batch)
            rows += len(batch)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return rows


def _load_off_allergens(conn: sqlite3.Connection, summary_path: Path) -> int:
    """Flatten the OFF allergens summary JSON into key/value rows."""
    with open(summary_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    rows = [(k, json.dumps(v)) for k, v in data.items()]
    cur = conn.cursor()
    cur.execute("BEGIN")
    try:
        cur.executemany("INSERT INTO off_allergens VALUES (?, ?)", rows)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return len(rows)


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
    db_path: Path,
    expected_inputs: dict[str, str],
) -> bool:
    """Return True iff manifest sha256s match the on-disk JSONL hashes
    AND the DB file already exists at ``db_path``."""
    if not db_path.exists():
        return False
    sources = manifest.get("sources") or {}
    for source_key, expected_sha in expected_inputs.items():
        entry = sources.get(source_key)
        if not entry or entry.get("sha256") != expected_sha:
            return False
    return True


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------


def build(
    *,
    input_root: Path,
    output_dir: Path,
    force: bool = False,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    db_final = output_dir / "lariat_data.db"
    db_tmp = output_dir / "lariat_data.db.tmp"
    manifest_path = output_dir / "manifest.json"

    # Resolve and hash inputs first so we can short-circuit on no-op runs.
    input_paths: dict[str, Path] = {}
    for table, jsonl_rel, _, _ in SOURCES:
        p = input_root / jsonl_rel
        if not p.exists():
            raise FileNotFoundError(f"Missing normalized input: {p}")
        input_paths[table] = p
    off_summary = input_root / "openfoodfacts" / "allergens.json"
    if not off_summary.exists():
        raise FileNotFoundError(f"Missing OFF allergens summary: {off_summary}")
    input_paths["off_allergens"] = off_summary

    print(f"  hashing {len(input_paths)} inputs…")
    input_shas = {k: _sha256_file(v) for k, v in input_paths.items()}

    if not force:
        prev = _read_manifest(manifest_path)
        if _is_up_to_date(prev, db_final, input_shas):
            print("  ✓ Up to date — manifest sha256s match all inputs.")
            print(f"    DB: {db_final} ({_human_bytes(db_final.stat().st_size)})")
            return prev

    # Build into a temp DB next to the final path (same volume → atomic rename).
    if db_tmp.exists():
        db_tmp.unlink()
    db_wal = db_tmp.with_name(db_tmp.name + "-wal")
    db_shm = db_tmp.with_name(db_tmp.name + "-shm")
    for sidecar in (db_wal, db_shm):
        if sidecar.exists():
            sidecar.unlink()

    t_total = time.time()
    conn = sqlite3.connect(str(db_tmp))
    try:
        for stmt in PRAGMAS_BUILD:
            conn.execute(stmt)

        for stmt in DDL_TABLES:
            conn.execute(stmt)

        per_source_stats: dict[str, dict[str, Any]] = {}

        for table, _, n_cols, mapper in SOURCES:
            jsonl_path = input_paths[table]
            print(f"  → {table}  ({_human_bytes(jsonl_path.stat().st_size)} JSONL)")
            t0 = time.time()
            rows = _load_jsonl_table(conn, table, n_cols, jsonl_path, mapper)
            elapsed = time.time() - t0
            rate = rows / elapsed if elapsed > 0 else float("inf")
            print(f"    {rows:,} rows in {elapsed:.1f}s ({rate:,.0f}/s)")
            per_source_stats[table] = {
                "source_file": jsonl_path.name,
                "sha256": input_shas[table],
                "rows_loaded": rows,
                "elapsed_seconds": round(elapsed, 3),
            }

        # OFF allergens summary (small, separate path).
        print("  → off_allergens  (summary JSON)")
        t0 = time.time()
        rows = _load_off_allergens(conn, input_paths["off_allergens"])
        elapsed = time.time() - t0
        print(f"    {rows} rows in {elapsed:.2f}s")
        per_source_stats["off_allergens"] = {
            "source_file": off_summary.name,
            "sha256": input_shas["off_allergens"],
            "rows_loaded": rows,
            "elapsed_seconds": round(elapsed, 3),
        }

        # Persist per-source manifest into the DB itself (queryable + travels
        # with the file).
        cur = conn.cursor()
        cur.execute("BEGIN")
        loaded_at = datetime.now(timezone.utc).isoformat()
        cur.executemany(
            "INSERT INTO _manifest VALUES (?, ?, ?, ?, ?, ?)",
            [
                (
                    src,
                    stats["source_file"],
                    stats["sha256"],
                    stats["rows_loaded"],
                    loaded_at,
                    stats["elapsed_seconds"],
                )
                for src, stats in per_source_stats.items()
            ],
        )
        conn.commit()

        print(f"  → building {len(DDL_INDEXES)} indexes…")
        t0 = time.time()
        for stmt in DDL_INDEXES:
            conn.execute(stmt)
        print(f"    indexes built in {time.time() - t0:.1f}s")

        for stmt in PRAGMAS_FINALIZE:
            conn.execute(stmt)
    finally:
        conn.close()

    # Atomic rename → final path. WAL/SHM sidecars were truncated by the
    # finalize PRAGMAs so we don't need to ship them.
    for sidecar in (db_wal, db_shm):
        if sidecar.exists():
            sidecar.unlink()
    _atomic_replace(db_tmp, db_final)

    total_elapsed = round(time.time() - t_total, 2)
    db_size = db_final.stat().st_size
    print(f"  ✓ Built {db_final} ({_human_bytes(db_size)}) in {total_elapsed}s")

    manifest = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "db_file": db_final.name,
        "db_bytes": db_size,
        "elapsed_seconds": total_elapsed,
        "sources": per_source_stats,
    }
    _atomic_write_text(manifest_path, json.dumps(manifest, indent=2, sort_keys=True))
    return manifest


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build SQLite index from normalized JSONL.")
    p.add_argument(
        "--input-root",
        type=Path,
        default=_default_input_root(),
        help="Directory containing the per-source normalized/<source>/*.jsonl trees. "
        "Default: data/lariat-data/normalized",
    )
    p.add_argument(
        "--output-dir",
        type=Path,
        default=_default_output_dir(),
        help="Directory to write lariat_data.db and manifest.json into. "
        "Default: data/lariat-data/indexes/sqlite",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Ignore existing manifest and rebuild from scratch.",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    print("Lariat Data Pack — SQLite index")
    print(f"  input_root: {args.input_root}")
    print(f"  output_dir: {args.output_dir}")
    if args.force:
        print("  force: rebuild requested")
    build(input_root=args.input_root, output_dir=args.output_dir, force=args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
