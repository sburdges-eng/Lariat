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

## License Compliance

Each source has its own license. See `manifests/source_licenses.json` for
details. All data is used for internal restaurant operations — not redistribution.
