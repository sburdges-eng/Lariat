#!/usr/bin/env python3
"""
Lariat Data Pack — vector embeddings index (Task I3).

Builds dense-vector indexes for retrieval-augmented use cases. Outputs are
stored per-bucket under ``data/lariat-data/indexes/embeddings/<bucket>/``:

    vectors.npy     — float32 array, shape (N, dims), L2-normalized
    metadata.jsonl  — one JSON row per vector, in the same order
                      (id, source, source_pk, text, …source-specific fields)
    manifest.json   — model id, input sha256s, row count, dims, build time

Buckets (assignment is heuristic and lives in BUCKET_QUERIES below):
    recipes      — Wikibooks pages with any "recipe"/"recipes" category
    techniques   — Wikibooks Cookbook pages NOT classified as recipes
    safety       — Wikibooks pages whose categories or title mention safety,
                   food safety, hygiene, or HACCP. Small for now; will grow
                   once FDA Food Code and food_safety HTMLs are normalized.
    ingredients  — USDA foods.description. ~2M rows; opt-in via --bucket
                   ingredients because embedding takes ~10–20 minutes even
                   on MPS.

Model: BAAI/bge-small-en-v1.5 by default. 384 dims, ~134 MB on disk, runs
well on Apple Silicon MPS. BGE's recommended convention is a "query: " /
"passage: " prefix asymmetry at search time only — index-time documents
go in unmodified, and queries are prepended with "Represent this sentence
for searching relevant passages: " (the BGE retrieval instruction). We
record the model id in the manifest so consumers know which prefix to use.

Idempotent: if the manifest's input_sha256 matches the SHA of the source
DB and the model id matches, the bucket is skipped. ``--force`` rebuilds.

CLI:
    python scripts/datapack/build_embeddings_index.py
        # default: builds the small buckets (recipes, techniques, safety)
    python scripts/datapack/build_embeddings_index.py --bucket recipes
    python scripts/datapack/build_embeddings_index.py --bucket all
        # all four — including the long ingredients run
    python scripts/datapack/build_embeddings_index.py --force
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

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


def _default_input_db() -> Path:
    return _default_data_root() / "indexes" / "sqlite" / "lariat_data.db"


def _default_output_root() -> Path:
    return _default_data_root() / "indexes" / "embeddings"


DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"
DEFAULT_BATCH_SIZE = 64


# ---------------------------------------------------------------------------
# Bucket definitions
# ---------------------------------------------------------------------------

# Each bucket is (name, source_table, sql, row_to_text, row_to_metadata).
# row_to_text(row) returns the string we feed the encoder.
# row_to_metadata(row) returns a dict that becomes one line in metadata.jsonl.
#
# The SQL deliberately filters by the same categories logic that places a
# row in this bucket so the row count == the input volume; sanity checks in
# the manifest depend on that invariant.
#
# Wikibooks pages: we match on categories_json (a JSON array) using LIKE on
# the raw text — this is faster than json_each() expansion and avoids the
# need for an FTS index on categories.

_RECIPE_CATEGORY_HINTS = ("recipe",)  # case-insensitive substring on category strings
_SAFETY_CATEGORY_HINTS = ("safety", "hygiene", "haccp", "food safety")
_TECHNIQUE_CATEGORY_HINTS = (
    "technique",
    "method",
    "preparation",
    "kitchen tools",
    "equipment",
)


def _wikibooks_row_to_text(row: sqlite3.Row) -> str:
    title = (row["title"] or "").removeprefix("Cookbook:")
    summary = (row["plain_text_summary"] or "").strip()
    # BGE reads passage as a single string; pre-pending the title gives the
    # encoder useful conditioning for short, ambiguous summaries.
    if summary:
        return f"{title}\n\n{summary}"
    return title


def _wikibooks_row_to_meta(row: sqlite3.Row, *, bucket: str) -> dict[str, Any]:
    return {
        "source": "wikibooks",
        "bucket": bucket,
        "page_id": row["page_id"],
        "title": row["title"],
        "slug": row["slug"],
        "source_url": row["source_url"],
        "summary_excerpt": (row["plain_text_summary"] or "")[:240],
    }


def _usda_row_to_text(row: sqlite3.Row) -> str:
    desc = (row["description"] or "").strip()
    cat = (row["food_category"] or "").strip()
    if cat:
        return f"{desc} — {cat}"
    return desc


def _usda_row_to_meta(row: sqlite3.Row, *, bucket: str) -> dict[str, Any]:
    return {
        "source": "usda",
        "bucket": bucket,
        "fdc_id": row["fdc_id"],
        "data_type": row["data_type"],
        "source_archive": row["source_archive"],
        "description": row["description"],
        "food_category": row["food_category"],
    }


# A "category match" predicate built as a chain of LIKE clauses on
# categories_json. SQLite has no native JSON contains-substring with
# case-insensitive match, so we lower() both sides and OR together.
def _categories_like_clause(hints: tuple[str, ...]) -> str:
    parts = [
        f"LOWER(categories_json) LIKE '%{h.lower()}%'"
        for h in hints
    ]
    return "(" + " OR ".join(parts) + ")"


def _wikibooks_recipes_sql() -> str:
    cat_match = _categories_like_clause(_RECIPE_CATEGORY_HINTS)
    return f"""
        SELECT page_id, title, slug, source_url, plain_text_summary
        FROM wikibooks_pages
        WHERE is_redirect = 0
          AND {cat_match}
        ORDER BY page_id
    """


def _wikibooks_safety_sql() -> str:
    cat_match = _categories_like_clause(_SAFETY_CATEGORY_HINTS)
    title_match = " OR ".join(
        f"LOWER(title) LIKE '%{h}%'" for h in _SAFETY_CATEGORY_HINTS
    )
    return f"""
        SELECT page_id, title, slug, source_url, plain_text_summary
        FROM wikibooks_pages
        WHERE is_redirect = 0
          AND ({cat_match} OR {title_match})
        ORDER BY page_id
    """


def _wikibooks_techniques_sql() -> str:
    # Techniques is the natural complement to recipes within the Cookbook:
    # namespace — anything that's not a recipe and not in the safety bucket.
    # The previous version required an explicit "technique"/"method"/etc
    # category and only matched 10 pages out of ~1,300 non-recipe Cookbook
    # entries; reality is that most non-recipe entries (ingredients,
    # equipment, glossary, cuisine writeups) are useful retrieval targets
    # for a cook looking up "how do I X" and lump well into a "techniques /
    # cooking knowledge" bucket. We exclude policy and feature-request
    # pages that have no on-the-line relevance.
    rec_match = _categories_like_clause(_RECIPE_CATEGORY_HINTS)
    safe_cat = _categories_like_clause(_SAFETY_CATEGORY_HINTS)
    safe_title = " OR ".join(
        f"LOWER(title) LIKE '%{h}%'" for h in _SAFETY_CATEGORY_HINTS
    )
    return f"""
        SELECT page_id, title, slug, source_url, plain_text_summary
        FROM wikibooks_pages
        WHERE is_redirect = 0
          AND title LIKE 'Cookbook:%'
          AND title NOT LIKE 'Cookbook:Policy%'
          AND title NOT LIKE 'Cookbook:Feature requests%'
          AND NOT {rec_match}
          AND NOT ({safe_cat} OR {safe_title})
        ORDER BY page_id
    """


def _usda_ingredients_sql() -> str:
    # Embed all USDA foods with a non-empty description.
    return """
        SELECT fdc_id, data_type, source_archive, description, food_category
        FROM usda_foods
        WHERE description IS NOT NULL AND description != ''
        ORDER BY fdc_id
    """


# Bucket registry: maps name → (sql_fn, text_fn, meta_fn, is_large)
BUCKETS: dict[str, dict[str, Any]] = {
    "recipes": {
        "sql_fn": _wikibooks_recipes_sql,
        "text_fn": _wikibooks_row_to_text,
        "meta_fn": _wikibooks_row_to_meta,
        "is_large": False,
    },
    "techniques": {
        "sql_fn": _wikibooks_techniques_sql,
        "text_fn": _wikibooks_row_to_text,
        "meta_fn": _wikibooks_row_to_meta,
        "is_large": False,
    },
    "safety": {
        "sql_fn": _wikibooks_safety_sql,
        "text_fn": _wikibooks_row_to_text,
        "meta_fn": _wikibooks_row_to_meta,
        "is_large": False,
    },
    "ingredients": {
        "sql_fn": _usda_ingredients_sql,
        "text_fn": _usda_row_to_text,
        "meta_fn": _usda_row_to_meta,
        "is_large": True,
    },
}

SMALL_BUCKETS = tuple(k for k, v in BUCKETS.items() if not v["is_large"])
ALL_BUCKETS = tuple(BUCKETS.keys())


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
    bucket_dir: Path,
    input_sha: str,
    model_id: str,
) -> bool:
    return (
        (bucket_dir / "vectors.npy").exists()
        and (bucket_dir / "metadata.jsonl").exists()
        and manifest.get("input_sha256") == input_sha
        and manifest.get("model_id") == model_id
    )


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------


def _stream_bucket(
    conn: sqlite3.Connection,
    bucket: str,
) -> Iterator[tuple[str, dict[str, Any]]]:
    cfg = BUCKETS[bucket]
    sql = cfg["sql_fn"]()
    text_fn = cfg["text_fn"]
    meta_fn = cfg["meta_fn"]

    # row_factory only on this cursor so other cursors stay tuple-based.
    cur = conn.cursor()
    cur.row_factory = sqlite3.Row
    for row in cur.execute(sql):
        text = text_fn(row)
        if not text or not text.strip():
            continue
        meta = meta_fn(row, bucket=bucket)
        yield text, meta


def _build_bucket(
    *,
    bucket: str,
    conn: sqlite3.Connection,
    output_root: Path,
    model: Any,
    model_id: str,
    input_sha: str,
    batch_size: int,
    force: bool,
) -> dict[str, Any]:
    bucket_dir = output_root / bucket
    bucket_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = bucket_dir / "manifest.json"
    vectors_path = bucket_dir / "vectors.npy"
    metadata_path = bucket_dir / "metadata.jsonl"

    if not force:
        prev = _read_manifest(manifest_path)
        if _is_up_to_date(prev, bucket_dir, input_sha, model_id):
            print(
                f"  ✓ {bucket}: up to date "
                f"({prev.get('rows', '?')} rows, model {model_id})"
            )
            return prev

    print(f"  → {bucket}: collecting passages…")
    t_collect = time.time()
    texts: list[str] = []
    metas: list[dict[str, Any]] = []
    for text, meta in _stream_bucket(conn, bucket):
        texts.append(text)
        metas.append(meta)
    n = len(texts)
    print(f"    collected {n:,} passages in {time.time() - t_collect:.2f}s")

    if n == 0:
        print(f"    (skipping {bucket}: empty corpus)")
        manifest = {
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "bucket": bucket,
            "model_id": model_id,
            "input_sha256": input_sha,
            "rows": 0,
            "dims": None,
            "elapsed_seconds": 0.0,
        }
        _atomic_write_text(manifest_path, json.dumps(manifest, indent=2, sort_keys=True))
        return manifest

    import numpy as np  # local import — heavy module, only needed when building

    print(f"  → {bucket}: encoding (batch={batch_size}, device={model.device})…")
    t_encode = time.time()
    vectors = model.encode(
        texts,
        batch_size=batch_size,
        normalize_embeddings=True,
        show_progress_bar=True,
        convert_to_numpy=True,
    ).astype("float32", copy=False)
    encode_elapsed = time.time() - t_encode
    rate = n / encode_elapsed if encode_elapsed > 0 else float("inf")
    print(
        f"    encoded {n:,} passages in {encode_elapsed:.1f}s "
        f"({rate:,.0f}/s, dims={vectors.shape[1]})"
    )

    # Atomic writes: stage to .tmp paths, then rename. np.save auto-appends
    # ".npy" if the filename doesn't already end in it — we sidestep that by
    # opening the file ourselves and passing the binary handle.
    tmp_vectors = vectors_path.with_suffix(vectors_path.suffix + ".tmp")
    tmp_metadata = metadata_path.with_suffix(metadata_path.suffix + ".tmp")
    # Clean up any leftover .tmp / .tmp.npy files from a prior crashed run.
    for stale in (tmp_vectors, tmp_vectors.with_suffix(tmp_vectors.suffix + ".npy")):
        if stale.exists():
            stale.unlink()
    if tmp_metadata.exists():
        tmp_metadata.unlink()

    with open(tmp_vectors, "wb") as f:
        np.save(f, vectors, allow_pickle=False)
        f.flush()
        os.fsync(f.fileno())
    with open(tmp_metadata, "w", encoding="utf-8") as f:
        for i, m in enumerate(metas):
            row = {"row_id": i, **m}
            f.write(json.dumps(row, ensure_ascii=False, sort_keys=True))
            f.write("\n")
        f.flush()
        os.fsync(f.fileno())

    _atomic_replace(tmp_vectors, vectors_path)
    _atomic_replace(tmp_metadata, metadata_path)

    manifest = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bucket": bucket,
        "model_id": model_id,
        "input_sha256": input_sha,
        "rows": int(n),
        "dims": int(vectors.shape[1]),
        "vectors_bytes": vectors_path.stat().st_size,
        "metadata_bytes": metadata_path.stat().st_size,
        "encode_elapsed_seconds": round(encode_elapsed, 3),
        "encode_rate_per_second": round(rate, 1),
        "batch_size": batch_size,
    }
    _atomic_write_text(manifest_path, json.dumps(manifest, indent=2, sort_keys=True))
    print(
        f"    wrote {vectors_path.name} ({_human_bytes(vectors_path.stat().st_size)}) "
        f"+ {metadata_path.name} ({_human_bytes(metadata_path.stat().st_size)})"
    )
    return manifest


def build(
    *,
    input_db: Path,
    output_root: Path,
    buckets: tuple[str, ...],
    model_id: str,
    batch_size: int,
    force: bool,
) -> dict[str, Any]:
    if not input_db.exists():
        raise FileNotFoundError(f"Input DB missing: {input_db}")

    output_root.mkdir(parents=True, exist_ok=True)

    print(f"  hashing input DB ({_human_bytes(input_db.stat().st_size)})…")
    input_sha = _sha256_file(input_db)

    # Quick up-to-date check across all requested buckets so we can skip the
    # expensive model load if there's nothing to do.
    if not force:
        already_done = []
        for bucket in buckets:
            prev = _read_manifest(output_root / bucket / "manifest.json")
            if _is_up_to_date(prev, output_root / bucket, input_sha, model_id):
                already_done.append(bucket)
        if len(already_done) == len(buckets):
            print("  ✓ All buckets up to date — skipping model load.")
            for bucket in buckets:
                print(f"    {bucket}: rows={_read_manifest(output_root / bucket / 'manifest.json').get('rows', '?')}")
            return {"buckets": list(buckets), "rebuilt": []}

    # Lazy-load the model — pulls torch + sentence-transformers (heavy) and
    # downloads the model weights on first run.
    print(f"  loading model {model_id}…")
    t_model = time.time()
    from sentence_transformers import SentenceTransformer
    import torch
    device = "mps" if torch.backends.mps.is_available() else (
        "cuda" if torch.cuda.is_available() else "cpu"
    )
    model = SentenceTransformer(model_id, device=device)
    print(f"    loaded on {device} in {time.time() - t_model:.1f}s")

    conn = sqlite3.connect(f"file:{input_db}?mode=ro", uri=True)
    try:
        per_bucket: dict[str, dict[str, Any]] = {}
        for bucket in buckets:
            per_bucket[bucket] = _build_bucket(
                bucket=bucket,
                conn=conn,
                output_root=output_root,
                model=model,
                model_id=model_id,
                input_sha=input_sha,
                batch_size=batch_size,
                force=force,
            )
    finally:
        conn.close()

    return {
        "buckets": list(buckets),
        "model_id": model_id,
        "input_sha256": input_sha,
        "per_bucket": per_bucket,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Build dense-vector embedding indexes for retrieval."
    )
    p.add_argument(
        "--input-db",
        type=Path,
        default=_default_input_db(),
        help="Source SQLite DB built by build_sqlite_index.py. "
        "Default: data/lariat-data/indexes/sqlite/lariat_data.db",
    )
    p.add_argument(
        "--output-root",
        type=Path,
        default=_default_output_root(),
        help="Directory under which per-bucket subdirs are created. "
        "Default: data/lariat-data/indexes/embeddings",
    )
    p.add_argument(
        "--bucket",
        choices=("recipes", "techniques", "safety", "ingredients", "all-small", "all"),
        default="all-small",
        help="Which buckets to build. 'all-small' = recipes+techniques+safety "
        "(seconds). 'ingredients' alone is the large opt-in run (~10 min on MPS).",
    )
    p.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"sentence-transformers model id. Default: {DEFAULT_MODEL}",
    )
    p.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"Encoder batch size. Default: {DEFAULT_BATCH_SIZE}",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Ignore existing manifests and rebuild from scratch.",
    )
    return p.parse_args(argv)


def _resolve_buckets(name: str) -> tuple[str, ...]:
    if name == "all":
        return ALL_BUCKETS
    if name == "all-small":
        return SMALL_BUCKETS
    return (name,)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    buckets = _resolve_buckets(args.bucket)
    print("Lariat Data Pack — embeddings index")
    print(f"  input_db:   {args.input_db}")
    print(f"  output_root: {args.output_root}")
    print(f"  model:       {args.model}")
    print(f"  buckets:     {', '.join(buckets)}")
    if args.force:
        print("  force: rebuild requested")
    build(
        input_db=args.input_db,
        output_root=args.output_root,
        buckets=buckets,
        model_id=args.model,
        batch_size=args.batch_size,
        force=args.force,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
