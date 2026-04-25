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
        ├──► normalize_usda.py        ──► normalized/usda/
        ├──► normalize_off.py         ──► normalized/openfoodfacts/
        └──► normalize_wikibooks.py   ──► normalized/wikibooks/
                                              │
                                              ▼
                                      sanity_check.py
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
