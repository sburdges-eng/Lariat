#!/usr/bin/env python3
"""
Lariat Data Pack — unified search API (Task Q1).

One class wraps the SQLite, FTS5, and embedding indexes built by the
sibling ``build_*_index.py`` scripts. Consumers don't touch ATTACH
syntax, BM25 ranker calls, .npy files, or the BGE retrieval prefix —
they get a single ``DataPackSearch`` object with a small surface:

    from scripts.datapack.search import DataPackSearch

    s = DataPackSearch()                    # auto-resolves data root
    s.fts("scrambled eggs", source="usda", limit=5)        # lexical
    s.fts("nutella", source="all", limit=20)               # cross-source
    s.semantic("how do I sharpen a knife", bucket="techniques", limit=5)
    s.hybrid("food allergen labeling", bucket="safety", limit=10)

    s.get_usda_food(fdc_id=171688)          # direct lookup
    s.get_fda_section(section_id="3-501.13")
    s.usda_nutrients_for(fdc_id=171688)     # all nutrients of a food

The class lazy-loads the BGE model and vector files on first use, so
``DataPackSearch().fts(...)`` doesn't pay for sentence-transformers
import unless the caller actually asks for semantic / hybrid search.

Resource lifecycle: the class opens SQLite + FTS connections eagerly
in the constructor (cheap, ~ms) and the model + vectors lazily on
demand. ``close()`` releases the SQLite handles; the class also
implements ``__enter__`` / ``__exit__`` so it can be used as a context
manager.

This module has no CLI — it's a library. To smoke-test from a shell:

    python -c "from scripts.datapack.search import DataPackSearch as D; \\
               s = D(); \\
               print(s.semantic('thawing frozen food', bucket='safety', limit=3))"
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scripts.datapack._io import (  # noqa: E402
    default_data_root as _default_data_root,
)


# BGE retrieval prefix. Documents go in unmodified at index time; queries
# need this prefix to match the asymmetric training of bge-* models. The
# embeddings index manifest records the model id (and therefore implies
# the right prefix), but we hardcode it here since we only support BGE
# right now and parameterizing for future models is YAGNI until then.
_BGE_QUERY_PREFIX = (
    "Represent this sentence for searching relevant passages: "
)

# FTS-side source registry: which FTS5 table backs each source name, and
# how to join back to the source SQLite table to recover full row data.
# usda_foods and wikibooks_pages route the source PK in as the FTS rowid;
# off_products needs the explicit codes side-table; fda has an INTEGER
# PRIMARY KEY rowid we can match directly.
_FTS_SOURCES: dict[str, dict[str, str]] = {
    "usda": {
        "fts_table": "usda_foods_fts",
        "join_sql": (
            "JOIN src.usda_foods AS f ON f.fdc_id = s.rowid"
        ),
        "select_cols": (
            "f.fdc_id AS id, f.description AS title, "
            "f.food_category AS subtitle, f.source_archive AS extra, "
            "'usda' AS source"
        ),
    },
    "off": {
        "fts_table": "off_products_fts",
        "join_sql": (
            "JOIN off_products_codes AS m ON m.fts_rowid = s.rowid "
            "JOIN src.off_products AS f ON f.code = m.code"
        ),
        "select_cols": (
            "f.code AS id, f.product_name AS title, "
            "f.brands AS subtitle, f.brand_owner AS extra, "
            "'off' AS source"
        ),
    },
    "wikibooks": {
        "fts_table": "wikibooks_pages_fts",
        "join_sql": (
            "JOIN src.wikibooks_pages AS f ON f.page_id = s.rowid"
        ),
        "select_cols": (
            "f.page_id AS id, f.title AS title, f.slug AS subtitle, "
            "f.source_url AS extra, 'wikibooks' AS source"
        ),
    },
    "fda": {
        "fts_table": "fda_food_code_sections_fts",
        "join_sql": (
            "JOIN src.fda_food_code_sections AS f ON f.rowid = s.rowid"
        ),
        "select_cols": (
            "f.rowid AS id, f.title AS title, "
            "COALESCE(f.section_id, '') AS subtitle, "
            "COALESCE(f.chapter, f.annex, '') AS extra, "
            "'fda' AS source"
        ),
    },
}


class DataPackSearch:
    """Unified lexical + semantic search over the Lariat data pack indexes."""

    def __init__(
        self,
        *,
        data_root: Path | None = None,
        model_id: str = "BAAI/bge-small-en-v1.5",
    ) -> None:
        self.data_root = data_root or _default_data_root()
        self.model_id = model_id

        self._sqlite_path = self.data_root / "indexes" / "sqlite" / "lariat_data.db"
        self._fts_path = (
            self.data_root / "indexes" / "search" / "fts" / "lariat_fts.db"
        )
        self._embeddings_root = self.data_root / "indexes" / "embeddings"

        if not self._sqlite_path.exists():
            raise FileNotFoundError(
                f"SQLite index missing — run build_sqlite_index.py first: {self._sqlite_path}"
            )
        if not self._fts_path.exists():
            raise FileNotFoundError(
                f"FTS index missing — run build_fts_index.py first: {self._fts_path}"
            )

        # Open the FTS DB (connection used for lexical queries) and ATTACH
        # the source DB read-only so JOINs can route back to source rows
        # in a single statement. Both DBs are on the same volume.
        self._fts = sqlite3.connect(
            f"file:{self._fts_path}?mode=ro", uri=True
        )
        self._fts.row_factory = sqlite3.Row
        self._fts.execute(
            "ATTACH DATABASE ? AS src", (str(self._sqlite_path),)
        )
        # Direct handle on the source DB for lookup-style queries that
        # don't need the FTS tables (cheap to open separately; SQLite
        # connections aren't share-safe across threads anyway).
        self._sql = sqlite3.connect(
            f"file:{self._sqlite_path}?mode=ro", uri=True
        )
        self._sql.row_factory = sqlite3.Row

        # Lazy-loaded resources
        self._model: Any = None
        self._embedding_caches: dict[str, tuple[Any, list[dict[str, Any]]]] = {}

    # ─────────────────────────────────────────────────────────────────────
    # Context manager + cleanup
    # ─────────────────────────────────────────────────────────────────────

    def close(self) -> None:
        try:
            self._fts.close()
        finally:
            self._sql.close()
        self._embedding_caches.clear()
        self._model = None

    def __enter__(self) -> "DataPackSearch":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ─────────────────────────────────────────────────────────────────────
    # FTS5 (lexical)
    # ─────────────────────────────────────────────────────────────────────

    def fts(
        self,
        query: str,
        *,
        source: str = "all",
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Lexical search via FTS5 + BM25.

        ``source`` is one of: ``"usda"``, ``"off"``, ``"wikibooks"``,
        ``"fda"``, or ``"all"`` (which queries each source separately
        and merges by BM25 score; per-source ``limit`` applies before
        merge so the merged list contains up to ``len(sources) * limit``
        rows).

        Result rows have a stable shape across sources:
            {"score": float, "source": str, "id": int|str,
             "title": str, "subtitle": str | None, "extra": str | None}
        """
        if not query or not query.strip():
            return []

        if source == "all":
            results: list[dict[str, Any]] = []
            for s in _FTS_SOURCES:
                results.extend(
                    self._fts_one(query, source=s, limit=limit)
                )
            results.sort(key=lambda r: r["score"])
            return results

        return self._fts_one(query, source=source, limit=limit)

    def _fts_one(
        self,
        query: str,
        *,
        source: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        if source not in _FTS_SOURCES:
            raise ValueError(
                f"Unknown FTS source {source!r}. "
                f"Expected one of {sorted(_FTS_SOURCES)}."
            )
        cfg = _FTS_SOURCES[source]
        sql = (
            f"SELECT bm25({cfg['fts_table']}) AS score, {cfg['select_cols']} "
            f"FROM {cfg['fts_table']} AS s "
            f"{cfg['join_sql']} "
            f"WHERE {cfg['fts_table']} MATCH ? "
            f"ORDER BY score "
            f"LIMIT ?"
        )
        rows = self._fts.execute(sql, (query, limit)).fetchall()
        return [dict(r) for r in rows]

    # ─────────────────────────────────────────────────────────────────────
    # Embeddings (semantic)
    # ─────────────────────────────────────────────────────────────────────

    def semantic(
        self,
        query: str,
        *,
        bucket: str,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Cosine-similarity search over a per-bucket BGE embedding.

        Bucket is one of the directories under
        ``indexes/embeddings/`` (recipes / techniques / safety /
        ingredients). Vectors are L2-normalized at index time, so cosine
        is just the dot product. Returns rows with ``score`` (cosine)
        plus the per-row metadata stored at index time.
        """
        if not query or not query.strip():
            return []

        vectors, metadata = self._load_bucket(bucket)
        model = self._load_model()

        import numpy as np  # local — heavy

        qv = model.encode(
            [_BGE_QUERY_PREFIX + query],
            normalize_embeddings=True,
            convert_to_numpy=True,
        )[0].astype("float32", copy=False)
        sims = vectors @ qv

        if limit >= len(sims):
            top_idx = np.argsort(-sims)
        else:
            # argpartition is O(n); only sort the top-k slice.
            top_idx = np.argpartition(-sims, limit - 1)[:limit]
            top_idx = top_idx[np.argsort(-sims[top_idx])]

        out: list[dict[str, Any]] = []
        for i in top_idx[:limit]:
            row = {"score": float(sims[i]), **metadata[int(i)]}
            out.append(row)
        return out

    def _load_bucket(self, bucket: str) -> tuple[Any, list[dict[str, Any]]]:
        if bucket in self._embedding_caches:
            return self._embedding_caches[bucket]

        bucket_dir = self._embeddings_root / bucket
        vectors_path = bucket_dir / "vectors.npy"
        meta_path = bucket_dir / "metadata.jsonl"
        if not vectors_path.exists() or not meta_path.exists():
            raise FileNotFoundError(
                f"Embeddings for bucket {bucket!r} are missing — run "
                f"build_embeddings_index.py --bucket {bucket}."
            )

        import numpy as np  # local — heavy

        vectors = np.load(vectors_path, mmap_mode="r")
        metadata = [json.loads(line) for line in meta_path.open()]
        if vectors.shape[0] != len(metadata):
            raise RuntimeError(
                f"Embeddings/metadata row count mismatch in bucket "
                f"{bucket!r}: {vectors.shape[0]} vs {len(metadata)}"
            )
        self._embedding_caches[bucket] = (vectors, metadata)
        return self._embedding_caches[bucket]

    def _load_model(self) -> Any:
        if self._model is not None:
            return self._model
        # sentence_transformers / torch are heavy; pull them in only
        # when the caller actually wants a semantic query.
        from sentence_transformers import SentenceTransformer
        import torch

        device = (
            "mps"
            if torch.backends.mps.is_available()
            else ("cuda" if torch.cuda.is_available() else "cpu")
        )
        self._model = SentenceTransformer(self.model_id, device=device)
        return self._model

    # ─────────────────────────────────────────────────────────────────────
    # Hybrid (BM25 + cosine fusion)
    # ─────────────────────────────────────────────────────────────────────

    def hybrid(
        self,
        query: str,
        *,
        bucket: str,
        limit: int = 20,
        rrf_k: int = 60,
    ) -> list[dict[str, Any]]:
        """Reciprocal-rank-fusion of FTS5 + semantic over a single bucket.

        ``bucket`` selects the embedding bucket *and* the matching FTS
        source: recipes / techniques / safety map to the wikibooks /
        wikibooks / fda FTS table respectively (recipes and techniques
        share the wikibooks FTS table; the bucket distinction is purely
        on the embedding side). For ``ingredients`` we use the usda FTS.

        RRF is the simplest fusion that beats either signal alone; the
        ``rrf_k`` constant is the standard 60. Returns one merged list,
        ordered by fused score (higher is better).
        """
        # Bucket → FTS source mapping. Two buckets share one FTS source
        # because the underlying corpus is the same; the embedding
        # bucketing is what gives us topic separation, not the FTS
        # tokenizer.
        fts_source = {
            "recipes": "wikibooks",
            "techniques": "wikibooks",
            "safety": "fda",
            "ingredients": "usda",
        }.get(bucket)
        if fts_source is None:
            raise ValueError(
                f"Unknown bucket {bucket!r}. Expected recipes / "
                f"techniques / safety / ingredients."
            )

        # Pull a wider net than `limit` from each side so the fusion has
        # room to reorder; final list is trimmed to `limit`.
        wide_n = max(limit * 4, 40)
        fts_hits = self._fts_one(query, source=fts_source, limit=wide_n)
        sem_hits = self.semantic(query, bucket=bucket, limit=wide_n)

        # RRF needs a stable key per item. We use the (source, id) tuple
        # for FTS hits and the metadata-derived id for embedding hits.
        # The two sides may use different id schemes for the same row;
        # build a fingerprint that subsumes both.
        def key_for(row: dict[str, Any]) -> tuple[str, Any]:
            # Prefer the most-stable id available in the row.
            for k in ("section_id", "fdc_id", "code", "page_id", "rowid", "id"):
                if k in row and row[k] not in (None, ""):
                    return (k, row[k])
            # Fallback — title is unique enough within a single corpus.
            return ("title", row.get("title"))

        rrf: dict[tuple[str, Any], dict[str, Any]] = {}
        for rank, hit in enumerate(fts_hits):
            k = key_for(hit)
            rrf.setdefault(
                k, {"_fused": 0.0, "_fts": None, "_sem": None, **hit}
            )["_fused"] += 1.0 / (rrf_k + rank)
            rrf[k]["_fts"] = hit
        for rank, hit in enumerate(sem_hits):
            k = key_for(hit)
            rrf.setdefault(
                k, {"_fused": 0.0, "_fts": None, "_sem": None, **hit}
            )["_fused"] += 1.0 / (rrf_k + rank)
            rrf[k]["_sem"] = hit

        ordered = sorted(rrf.values(), key=lambda r: -r["_fused"])
        # Strip internal bookkeeping keys before returning so the result
        # looks like the FTS / semantic outputs the caller already knows.
        out: list[dict[str, Any]] = []
        for r in ordered[:limit]:
            r = dict(r)
            r["score"] = r.pop("_fused")
            r.pop("_fts", None)
            r.pop("_sem", None)
            out.append(r)
        return out

    # ─────────────────────────────────────────────────────────────────────
    # Direct lookups
    # ─────────────────────────────────────────────────────────────────────

    def get_usda_food(self, fdc_id: int) -> dict[str, Any] | None:
        row = self._sql.execute(
            "SELECT * FROM usda_foods WHERE fdc_id = ?", (fdc_id,)
        ).fetchone()
        return dict(row) if row else None

    def usda_nutrients_for(self, fdc_id: int) -> list[dict[str, Any]]:
        rows = self._sql.execute(
            "SELECT nutrient_id, nutrient_name, amount, unit_name "
            "FROM usda_nutrients WHERE fdc_id = ? "
            "ORDER BY nutrient_name",
            (fdc_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_off_product(self, code: str) -> dict[str, Any] | None:
        row = self._sql.execute(
            "SELECT * FROM off_products WHERE code = ?", (code,)
        ).fetchone()
        return dict(row) if row else None

    def get_wikibooks_page(
        self, *, page_id: int | None = None, title: str | None = None
    ) -> dict[str, Any] | None:
        if page_id is not None:
            row = self._sql.execute(
                "SELECT * FROM wikibooks_pages WHERE page_id = ?", (page_id,)
            ).fetchone()
        elif title is not None:
            row = self._sql.execute(
                "SELECT * FROM wikibooks_pages WHERE title = ? LIMIT 1",
                (title,),
            ).fetchone()
        else:
            raise ValueError("provide either page_id or title")
        return dict(row) if row else None

    def get_fda_section(
        self,
        *,
        section_id: str | None = None,
        rowid: int | None = None,
    ) -> dict[str, Any] | None:
        if section_id is not None:
            row = self._sql.execute(
                "SELECT * FROM fda_food_code_sections "
                "WHERE section_id = ? LIMIT 1",
                (section_id,),
            ).fetchone()
        elif rowid is not None:
            row = self._sql.execute(
                "SELECT * FROM fda_food_code_sections WHERE rowid = ?",
                (rowid,),
            ).fetchone()
        else:
            raise ValueError("provide either section_id or rowid")
        return dict(row) if row else None

    # ─────────────────────────────────────────────────────────────────────
    # Stats / introspection
    # ─────────────────────────────────────────────────────────────────────

    def stats(self) -> dict[str, Any]:
        """Return row counts per table + manifest summaries. Useful for
        sanity-checking that the indexes are populated."""
        out: dict[str, Any] = {"sqlite": {}, "fts": {}, "embeddings": {}}
        for tbl in (
            "usda_foods",
            "usda_nutrients",
            "off_products",
            "wikibooks_pages",
            "fda_food_code_sections",
            "off_allergens",
        ):
            out["sqlite"][tbl] = self._sql.execute(
                f"SELECT COUNT(*) FROM {tbl}"
            ).fetchone()[0]
        for tbl in (
            "usda_foods_fts",
            "off_products_fts",
            "wikibooks_pages_fts",
            "fda_food_code_sections_fts",
        ):
            out["fts"][tbl] = self._fts.execute(
                f"SELECT COUNT(*) FROM {tbl}"
            ).fetchone()[0]
        # Embeddings: scan for bucket dirs that have a manifest.
        for child in sorted(self._embeddings_root.iterdir()):
            mf = child / "manifest.json"
            if not mf.exists():
                continue
            try:
                m = json.loads(mf.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            out["embeddings"][child.name] = {
                "rows": m.get("rows"),
                "model_id": m.get("model_id"),
                "dims": m.get("dims"),
            }
        return out
