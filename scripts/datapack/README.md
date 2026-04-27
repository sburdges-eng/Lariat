# Lariat Data Pack — Download & Normalization Pipeline

## Overview

Downloads, verifies, and normalizes all culinary reference datasets for the
Lariat kitchen-operations platform. Data lives on an external drive and is
symlinked into the repo at `data/lariat-data`.

## Storage Layout

```
/Volumes/Sean's SSD/lariat-data/      ← physical location (external SSD)
  ↑ symlinked from data/lariat-data/

  raw/                                ← untouched downloads
    usda_fooddata/
    openfoodfacts/
    recipenlg/
    wikibooks_cookbook/
    fda_food_code/
    food_safety/
    flavor_graphs/
    unit_systems/
  normalized/                         ← cleaned JSONL for import
  indexes/                            ← SQLite, FTS, embedding indexes
  manifests/                          ← download logs, checksums, licenses
```

## Quick Start

```bash
# Activate venv
source .venv/bin/activate

# Install data-pack dependencies
pip install -r scripts/datapack/requirements-datapack.txt

# Download everything (resumable, checksummed)
python scripts/datapack/download_all.py

# Download a single source
python scripts/datapack/download_all.py --source usda

# Check download status
python scripts/datapack/download_all.py --status
```

## Data Sources

| # | Source | ~Size | Priority |
|---|--------|-------|----------|
| 1 | USDA FoodData Central | 1–5 GB | P0 |
| 2 | Open Food Facts | 10–50 GB | P1 |
| 3 | RecipeNLG | 1–3 GB | P0 |
| 4 | Wikibooks Cookbook | 100 MB–2 GB | P2 |
| 5 | FDA Food Code | <100 MB | P1 |
| 6 | USDA / FoodSafety.gov | <100 MB | P1 |
| 7 | FlavorDB | 100 MB–2 GB | P2 |
| 8 | Unit conversion registries | <50 MB | P0 |
| 9 | Custom Lariat kitchen data | grows | internal |

## Normalization

After raw archives are downloaded and extracted, the per-source normalizers
under `scripts/datapack/normalize_*.py` turn them into deterministic JSONL
plus a `manifest.json` (sha256 + bytes per output, row counts). Each script
is idempotent: a re-run with matching manifest sha256 short-circuits.

### Pipeline

```
download_all.py
        │
        ▼
extract_and_normalize.py --extract-only
        │
        ├──► normalize_usda.py             ──► normalized/usda/
        ├──► normalize_off.py              ──► normalized/openfoodfacts/
        ├──► normalize_wikibooks.py        ──► normalized/wikibooks/
        └──► normalize_fda_food_code.py    ──► normalized/fda_food_code/
                                              │
                                              ▼
                                      sanity_check.py
                                              │
                                              ▼
                            ┌───────────────────────────────────┐
                            │ build_sqlite_index.py             │
                            │   indexes/sqlite/lariat_data.db   │
                            ├───────────────────────────────────┤
                            │ build_fts_index.py                │
                            │   indexes/search/fts/lariat_fts.db│
                            ├───────────────────────────────────┤
                            │ build_embeddings_index.py         │
                            │   indexes/embeddings/<bucket>/    │
                            │   {vectors.npy,metadata.jsonl}    │
                            └───────────────────────────────────┘
                                              │
                                              ▼
                          Node.js consumers (lib/datapackSearch.ts,
                          /api/datapack/search, /datapack-search)
```

### Commands

```bash
# USDA FoodData Central — emits ingredients.jsonl + nutrients.jsonl
python scripts/datapack/normalize_usda.py
python scripts/datapack/normalize_usda.py --force                 # rebuild
python scripts/datapack/normalize_usda.py --input-root <path>     # custom input

# Open Food Facts — emits branded_products.jsonl + allergens.json
python scripts/datapack/normalize_off.py
python scripts/datapack/normalize_off.py --force

# Wikibooks Cookbook — emits cookbook_pages.jsonl
python scripts/datapack/normalize_wikibooks.py
python scripts/datapack/normalize_wikibooks.py --force
```

Each normalizer streams its input (12.88 GB OFF dump, 25M-row USDA
nutrients) and writes to `data/lariat-data/normalized/<source>/` with an
external-merge-sort pattern that keeps RSS bounded.

### Output schemas

**`normalized/usda/ingredients.jsonl`** — one row per `fdc_id`:

| field | type | notes |
|---|---|---|
| `fdc_id` | int | USDA FoodData Central food id |
| `description` | str | food name |
| `data_type` | str | `branded_food` / `foundation_food` / `survey_fndds_food` / `sr_legacy_food` |
| `food_category_id` | int? | nullable |
| `food_category` | str? | resolved category name |
| `brand_owner` | str? | branded archive only |
| `gtin_upc` | str? | branded archive only |
| `ingredients` | str? | raw ingredients list |
| `serving_size` | float? | |
| `serving_size_unit` | str? | |
| `source_archive` | str | `foundation` / `sr_legacy` / `survey` / `branded` |

**`normalized/usda/nutrients.jsonl`** — one row per `(fdc_id, nutrient_id)`:

| field | type | notes |
|---|---|---|
| `fdc_id` | int | foreign key to ingredients |
| `nutrient_id` | int | USDA nutrient id |
| `nutrient_name` | str | resolved nutrient name |
| `unit_name` | str | e.g. `G`, `MG`, `KCAL` |
| `amount` | float | per 100 g (or per serving for branded) |
| `derivation_id` | int? | |
| `source_archive` | str | mirrors ingredients |

**`normalized/openfoodfacts/branded_products.jsonl`** — sorted by `code` asc:

| field | type | notes |
|---|---|---|
| `code` | str | product barcode (zero-padded) |
| `product_name` | str | |
| `brands` | str | raw OFF brands string |
| `brand_owner` | str | |
| `categories_tags` | list[str] | OFF taxonomy tags |
| `allergens_tags` | list[str] | |
| `traces_tags` | list[str] | |
| `ingredients_text` | str | |
| `serving_size` | str | free-text |
| `nutriscore_grade` | str | `a`–`e` or empty |
| `countries_en` | str | comma-joined country list |
| `source_url` | str | OFF product page |

**`normalized/openfoodfacts/allergens.json`** — aggregate token counts:
`{"allergens": {"en:milk": <n>, …}, "traces": {"en:nuts": <n>, …}}`.

**`normalized/wikibooks/cookbook_pages.jsonl`** — Cookbook-namespace pages
(articles + redirects):

| field | type | notes |
|---|---|---|
| `page_id` | int | |
| `title` | str | full title incl. `Cookbook:` prefix |
| `slug` | str | title without prefix |
| `is_redirect` | bool | |
| `redirect_target` | str? | only for redirects |
| `categories` | list[str] | dedup, order preserved |
| `wikitext_length` | int | bytes of original wikitext |
| `plain_text_summary` | str | stripped plain text (empty for redirects) |
| `source_url` | str | underscored title URL |

### Sanity check

After all normalizers run, validate the outputs end-to-end:

```bash
python scripts/datapack/sanity_check.py
python scripts/datapack/sanity_check.py --verbose
python scripts/datapack/sanity_check.py --samples 10
python scripts/datapack/sanity_check.py --data-root /path/to/lariat-data
```

The script verifies, per source:

1. `manifest.json` exists and parses
2. every output listed in `manifest["outputs"]` exists on disk
3. sha256 of each file matches the manifest
4. byte size of each file matches the manifest
5. JSONL outputs parse on a head+tail spot-check (default 5 lines each end)
6. each spot-checked row carries the expected top-level keys
7. JSONL line counts match `manifest["row_counts"]`
8. `allergens.json` is a JSON object containing both `allergens` and `traces` dicts

Sources without a manifest are reported as `○ SKIP` (partial pipeline, not
a failure). Any other check failure prints the offending source row with
`✗ FAIL: <reason>` and exits 1.

### Disk requirements

| stage | size |
|---|---|
| raw archives | ~16 GB |
| extracted CSVs / XML | ~16 GB |
| normalized JSONL | ~14 GB |
| **total** | **~46 GB** |

All of this lives on the external SSD via the `data/lariat-data` symlink.
Don't put it on the boot disk.

### Indexing

After `sanity_check.py` is green, three index builders take the
normalized JSONL streams and turn them into queryable artefacts. All
three are idempotent (sha256-keyed manifests), built atomically via
`.tmp` + `os.replace`, and skip on no-op runs unless passed `--force`.

```bash
# SQLite — single 4.8 GB DB, 33M+ rows, joinable across sources.
python scripts/datapack/build_sqlite_index.py
# → indexes/sqlite/lariat_data.db
#   tables: usda_foods (2.06M), usda_nutrients (26.85M),
#           off_products (4.13M), wikibooks_pages (7.8K),
#           fda_food_code_sections (1.25K), off_allergens, _manifest

# FTS5 — separate 904 MB DB layered on top via ATTACH; porter+unicode61
# tokenizer, BM25 ranking. Contentless + side-table for OFF (TEXT GTIN
# can't ride along as INTEGER FTS rowid).
python scripts/datapack/build_fts_index.py
# → indexes/search/fts/lariat_fts.db

# Embeddings — BGE-small (BAAI/bge-small-en-v1.5, 384 dims, ~134 MB
# model on first download). Per-bucket vectors.npy (float32, L2-norm)
# + metadata.jsonl. Default builds the small buckets (recipes,
# techniques, safety); ingredients is opt-in.
python scripts/datapack/build_embeddings_index.py                 # all-small
python scripts/datapack/build_embeddings_index.py --bucket safety
python scripts/datapack/build_embeddings_index.py --bucket ingredients
# → indexes/embeddings/<bucket>/{vectors.npy,metadata.jsonl,manifest.json}
```

Per-bucket counts after a full build: recipes 3,771 · techniques 1,328
· safety 949 · ingredients 2,063,746.

### Node.js consumer

`lib/datapackSearch.ts` is the read-only TypeScript client. It opens
`lariat_data.db` + `lariat_fts.db` lazily, wraps the FTS5 + ATTACH
syntax, and exposes a small surface:

| function | purpose |
|---|---|
| `available()` | true iff the data pack is mounted on this machine |
| `fts(q, {source, limit})` | BM25 lexical search (per source or `'all'`) |
| `semantic(q, {bucket, limit})` | cosine search via BGE-small (transformers.js, ONNX) |
| `getUsdaFood(fdc_id)` / `usdaNutrientsFor(fdc_id)` | direct USDA lookup |
| `getOffProduct(code)` | direct OFF lookup |
| `getFdaSection({section_id})` / `getFdaSection({rowid})` | FDA Food Code lookup |
| `getWikibooksPage({page_id})` / `getWikibooksPage({title})` | Wikibooks page lookup |
| `stats()` | row counts per indexed table (sanity / health) |

The HTTP wrapper at `/api/datapack/search` mirrors this surface
(`?op=search&q=…&source=…` for FTS, `?op=usda_food&fdc_id=…` etc. for
direct lookups), and the `/datapack-search` page in the cockpit is a
minimal browser over both. The kitchen assistant context builder
(`lib/kitchenAssistantContext.ts`) calls `fts(question, source: 'fda')`
when the user's question matches `FOOD_SAFETY_KEYWORDS`, then inlines
the §-cited FDA Food Code passages into the LLM context so safety
answers cite the regulatory text.

### Heap budget for ingredients embeddings

`vectors.npy` for the `ingredients` bucket is ~3 GB on disk (2.06M × 384
floats). Loading it via `lib/datapackSearch.semantic({bucket:
'ingredients'})` materializes both the source Buffer and a Float32Array
concurrently — peak ~6 GB. Default Node old-space heap is ~1.7 GB on
64-bit, so any process that calls semantic() with the ingredients
bucket needs `NODE_OPTIONS=--max-old-space-size=8192` (or the equivalent
flag on `node`). The smaller buckets (recipes, techniques, safety) all
fit in default heap. Streaming the .npy header + a chunked matrix read
would halve peak memory; tracked as a follow-up.

### RecipeNLG (manual)

RecipeNLG is **not** wired into the normalizers. The dataset must be
manually downloaded from <https://recipenlg.cs.put.poznan.pl/>; place
`dataset.zip` under `raw/recipenlg/` and extract it there. The GPT-2 model
checkpoint under `raw/recipenlg/model/` was downloaded separately via
`huggingface_hub` — it is **not** used by the data-pack normalizers and is
kept around only for downstream experiments.

## License Compliance

Each source has its own license. See `manifests/source_licenses.json` for
details. All data is used for internal restaurant operations — not redistribution.
