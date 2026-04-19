# Kitchen Assistant Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the grounded kitchen assistant with full Big 9 allergen matrix, HACCP food safety rules, enriched recipe/menu/sub-recipe context, Sysco vendor and 7shifts labor sources of truth, and a local Ollama training config for Mac M4 16 GB.

**Architecture:** Enrich `data/cache/` JSON files via a new rebuild script that merges 42 normalized recipe CSVs, the allergen matrix (644 evidence rows), menu mappings, HACCP CCPs, and Sysco purchase history. Extend `kitchenAssistantContext.js` to inject richer per-request context (sub-recipe chains, ingredient-level allergens, menu-item-to-recipe resolution, food safety CCPs, vendor order patterns). Harden `ollama.js` system prompt with explicit Big 9 terminology, HACCP temperature gates, and source-of-truth boundaries for Sysco/7shifts. Create an Ollama Modelfile and `mlx-lm` LoRA config for optional on-device fine-tuning.

**Tech Stack:** Node.js (Next.js 14), better-sqlite3, Ollama (llama3.2:3b / llama3.1:8b), mlx-lm (Apple Silicon LoRA), CSV/JSON processing scripts.

**Working branch:** `cursor/fix-build-and-ops-a820` (remote, to be checked out locally)

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `scripts/rebuild-cache.mjs` | Merges recipe index + normalized CSVs + allergen matrix + menu maps + HACCP + Sysco into enriched `data/cache/*.json` |
| `data/cache/menu.json` | Winter menu items with recipe links, stations, dietary tags |
| `data/cache/food_safety.json` | HACCP CCPs with critical limits + temp monitoring points |
| `data/cache/vendor_summary.json` | Sysco purchase patterns (top items, recent orders, categories) |
| `data/cache/labor_summary.json` | 7shifts/Toast labor summary (roles, hours, cost ratios) |
| `data/cache/allergen_matrix.json` | Ingredient-level Big 9 lookup keyed by recipe_id |
| `training/Modelfile` | Ollama Modelfile with baked-in Lariat system prompt |
| `training/generate-qa.mjs` | Generates Q&A JSONL training pairs from restaurant data |
| `training/lariat-qa.jsonl` | Generated training pairs for fine-tuning |
| `training/mlx-lora-config.yaml` | mlx-lm LoRA fine-tuning config for M4 16 GB |
| `training/SETUP.md` | Mac training setup: Ollama install, model pull, Modelfile create, optional LoRA |
| `tests/test-rebuild-cache.mjs` | Tests for rebuild-cache script output correctness |

### Modified files
| File | Changes |
|------|---------|
| `lib/ollama.js` | Hardened system prompt: Big 9 list, HACCP temps, Sysco/7shifts boundaries, cross-contact language |
| `lib/kitchenAssistantContext.js` | Menu-item-to-recipe resolution, sub-recipe expansion, ingredient-level allergen lookup, HACCP CCP context, vendor patterns, labor summary, context budget management |
| `lib/data.js` | New loaders: `getMenu()`, `getFoodSafety()`, `getVendorSummary()`, `getLaborSummary()`, `getAllergenMatrix()` |
| `package.json` | New script: `rebuild-cache` |
| `OPERATIONS.md` | Updated source-of-truth table with Sysco + 7shifts; training section |

---

### Task 1: Check out branch and set up working environment

**Files:**
- Modify: (git state only)

- [ ] **Step 1: Fetch and check out the kitchen assistant branch locally**

```bash
cd /Users/seanburdges/Dev/Lariat
git fetch origin cursor/fix-build-and-ops-a820
git checkout -b cursor/fix-build-and-ops-a820 origin/cursor/fix-build-and-ops-a820
```

- [ ] **Step 2: Install dependencies and verify the app builds**

```bash
npm install
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Verify current cache state**

```bash
node -e "const r = require('./data/cache/recipes.json'); console.log('Recipes:', r.length, '| With allergens:', r.filter(x=>x.allergens?.length).length, '| With procedure:', r.filter(x=>x.procedure?.length>0).length)"
```

Expected: `Recipes: 50 | With allergens: 31 | With procedure: 49`

- [ ] **Step 4: Commit checkpoint (no changes yet)**

No commit needed — just verify clean state with `git status`.

---

### Task 2: Build the enriched cache rebuild script

**Files:**
- Create: `scripts/rebuild-cache.mjs`
- Create: `tests/test-rebuild-cache.mjs`
- Modify: `package.json`

This script replaces the current recipe ingest with a comprehensive merge of all data sources into enriched cache JSON files.

- [ ] **Step 1: Write the test for rebuild-cache output**

```js
// tests/test-rebuild-cache.mjs
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const CACHE = join(ROOT, 'data', 'cache');

describe('rebuild-cache', () => {
  before(() => {
    execSync('node scripts/rebuild-cache.mjs', { cwd: ROOT, stdio: 'pipe' });
  });

  describe('recipes.json', () => {
    let recipes;
    before(() => {
      recipes = JSON.parse(readFileSync(join(CACHE, 'recipes.json'), 'utf8'));
    });

    it('has at least 42 recipes (from normalized CSVs)', () => {
      assert.ok(recipes.length >= 42, `got ${recipes.length}`);
    });

    it('every recipe has required fields', () => {
      for (const r of recipes) {
        assert.ok(r.name, `missing name: ${JSON.stringify(r).slice(0, 80)}`);
        assert.ok(r.slug, `missing slug for ${r.name}`);
        assert.ok(Array.isArray(r.ingredients), `missing ingredients for ${r.name}`);
        assert.ok(Array.isArray(r.allergens), `missing allergens for ${r.name}`);
        assert.ok(Array.isArray(r.procedure), `missing procedure for ${r.name}`);
      }
    });

    it('queso has sub_recipes and menu_items from recipe_index', () => {
      const q = recipes.find(r => r.slug === 'queso_mac_sauce');
      assert.ok(q, 'queso_mac_sauce not found');
      assert.ok(q.sub_recipes?.length >= 2, `sub_recipes: ${q.sub_recipes}`);
      assert.ok(q.menu_items?.length >= 1, `menu_items: ${q.menu_items}`);
      assert.ok(q.station, `missing station`);
      assert.ok(q.yield_qty, `missing yield_qty`);
    });

    it('buttermilk_brine has dairy in big9 allergens', () => {
      const b = recipes.find(r => r.slug === 'buttermilk_brine');
      assert.ok(b, 'buttermilk_brine not found');
      assert.ok(
        b.allergens.some(a => a === 'milk' || a === 'dairy'),
        `allergens: ${b.allergens}`
      );
    });

    it('beer_batter has wheat/gluten allergen', () => {
      const bb = recipes.find(r => r.slug === 'beer_batter');
      assert.ok(bb, 'beer_batter not found');
      assert.ok(
        bb.allergens.some(a => a === 'wheat' || a === 'gluten'),
        `allergens: ${bb.allergens}`
      );
    });

    it('pork_chop_marinade has soy from soy sauce', () => {
      const p = recipes.find(r => r.slug === 'pork_chop_marinade');
      assert.ok(p, 'pork_chop_marinade not found');
      assert.ok(
        p.allergens.some(a => a === 'soybeans' || a === 'soy'),
        `allergens: ${p.allergens}`
      );
    });
  });

  describe('allergen_matrix.json', () => {
    it('exists and has keyed entries', () => {
      const m = JSON.parse(readFileSync(join(CACHE, 'allergen_matrix.json'), 'utf8'));
      assert.ok(typeof m === 'object');
      assert.ok(Object.keys(m).length >= 10, `only ${Object.keys(m).length} recipes`);
      // Each entry is { ingredient, big9_flags[] }
      const queso = m['queso_mac_sauce'];
      assert.ok(Array.isArray(queso), 'queso_mac_sauce missing');
      assert.ok(queso.some(row => row.big9.includes('milk')), 'queso should flag milk');
    });
  });

  describe('menu.json', () => {
    it('exists and has menu items with recipe links', () => {
      const menu = JSON.parse(readFileSync(join(CACHE, 'menu.json'), 'utf8'));
      assert.ok(Array.isArray(menu));
      assert.ok(menu.length >= 20, `only ${menu.length} items`);
      const cornbread = menu.find(m => m.display_name?.includes('Cornbread'));
      assert.ok(cornbread, 'cornbread menu item not found');
      assert.ok(cornbread.station_primary, 'missing station');
    });
  });

  describe('food_safety.json', () => {
    it('has HACCP CCPs with critical limits', () => {
      const fs = JSON.parse(readFileSync(join(CACHE, 'food_safety.json'), 'utf8'));
      assert.ok(fs.ccps?.length >= 10, `only ${fs.ccps?.length} CCPs`);
      const poultry = fs.ccps.find(c => c.ccp_id === 'CCP-4');
      assert.ok(poultry, 'CCP-4 (poultry) missing');
      assert.ok(poultry.critical_limit.includes('165'), `limit: ${poultry.critical_limit}`);
    });
  });

  describe('vendor_summary.json', () => {
    it('has Sysco purchase data', () => {
      const v = JSON.parse(readFileSync(join(CACHE, 'vendor_summary.json'), 'utf8'));
      assert.ok(v.sysco, 'sysco key missing');
      assert.ok(v.sysco.recent_items?.length > 0, 'no recent items');
    });
  });

  describe('labor_summary.json', () => {
    it('has labor breakdown if source files exist', () => {
      const lPath = join(CACHE, 'labor_summary.json');
      if (!existsSync(lPath)) return; // skip if no labor exports yet
      const l = JSON.parse(readFileSync(lPath, 'utf8'));
      assert.ok(l.by_role?.length > 0, 'no role breakdown');
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/test-rebuild-cache.mjs
```

Expected: FAIL — `scripts/rebuild-cache.mjs` does not exist yet.

- [ ] **Step 3: Write the rebuild-cache script**

```js
// scripts/rebuild-cache.mjs
//
// Merges all Lariat data sources into enriched data/cache/*.json files.
// Sources: recipes/recipe_index.csv, recipes/normalized/*.csv,
//          allergens/allergen_matrix.csv, allergens/discovered_*.csv,
//          menus/lariat_winter_menu.csv, menus/toast_recipe_map.csv,
//          food_safety/haccp_checklist_template.csv, food_safety/daily_temp_log_template.csv,
//          data/csv/sysco_purchase_history.csv, data/csv/*_sysco_export_details.csv,
//          dev/exports/*/Labor - *.csv
//
// Run: node scripts/rebuild-cache.mjs
// Or:  npm run rebuild-cache

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

const ROOT = join(import.meta.dirname, '..');
const CACHE = join(ROOT, 'data', 'cache');
const RECIPES_DIR = join(ROOT, 'recipes', 'normalized');
const ALLERGENS_DIR = join(ROOT, 'allergens');
const MENUS_DIR = join(ROOT, 'menus');
const FOOD_SAFETY_DIR = join(ROOT, 'food_safety');
const DATA_CSV = join(ROOT, 'data', 'csv');

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (!lines.length) return [];
  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = (vals[i] || '').trim(); });
    return obj;
  });
}

function parseLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function readCSV(filePath) {
  if (!existsSync(filePath)) return [];
  return parseCSV(readFileSync(filePath, 'utf8'));
}

function writeJSON(name, data) {
  writeFileSync(join(CACHE, name), JSON.stringify(data, null, 2) + '\n');
  console.log(`  wrote ${name}`);
}

// ── 1. Recipe Index ──────────────────────────────────────────────────
console.log('Loading recipe index...');
const recipeIndex = readCSV(join(ROOT, 'recipes', 'recipe_index.csv'));
const indexBySlug = new Map();
for (const row of recipeIndex) {
  indexBySlug.set(row.recipe_id, row);
}

// ── 2. Normalized recipe CSVs ────────────────────────────────────────
console.log('Loading normalized recipes...');
const normalizedSlugs = readdirSync(RECIPES_DIR)
  .filter(f => f.endsWith('.csv'))
  .map(f => f.replace('.csv', ''));

// ── 3. Allergen matrix ───────────────────────────────────────────────
console.log('Loading allergen matrix...');
const allergenMatrixRows = readCSV(join(ALLERGENS_DIR, 'allergen_matrix.csv'));
const BIG9_COLS = ['milk', 'eggs', 'fish', 'shellfish', 'tree_nuts', 'peanuts', 'wheat', 'soybeans', 'sesame'];

const allergenByRecipe = new Map(); // recipe_id -> [{ ingredient, big9: string[] }]
for (const row of allergenMatrixRows) {
  const rid = row.recipe_id;
  if (!rid) continue;
  const flags = BIG9_COLS.filter(col => row[col]?.trim().toUpperCase() === 'X');
  if (!allergenByRecipe.has(rid)) allergenByRecipe.set(rid, []);
  allergenByRecipe.get(rid).push({
    ingredient: row.ingredient || '',
    big9: flags,
    notes: row.notes || '',
  });
}

// Also load discovered allergens for recipes not in the hand-built matrix
const discoveredPath = join(ALLERGENS_DIR, 'discovered_2026-03-29.csv');
const discoveredRows = readCSV(discoveredPath);
const discoveredByRecipe = new Map();
for (const row of discoveredRows) {
  const rid = row.source_id;
  if (!rid) continue;
  if (!discoveredByRecipe.has(rid)) discoveredByRecipe.set(rid, new Set());
  // Normalize tag names to Big 9 standard
  const tag = normalizeAllergenTag(row.allergen_tag);
  if (tag) discoveredByRecipe.get(rid).add(tag);
}

function normalizeAllergenTag(raw) {
  if (!raw) return null;
  const t = raw.toLowerCase().trim();
  const map = {
    'milk': 'milk', 'dairy': 'milk',
    'eggs': 'eggs', 'egg': 'eggs',
    'fish': 'fish',
    'crustacean_shellfish': 'shellfish', 'molluscan_shellfish': 'shellfish', 'shellfish': 'shellfish',
    'tree_nuts': 'tree_nuts', 'nuts': 'tree_nuts',
    'peanuts': 'peanuts',
    'wheat': 'wheat', 'gluten': 'wheat', 'gluten_barley_rye': 'wheat',
    'soybeans': 'soybeans', 'soy': 'soybeans',
    'sesame': 'sesame',
  };
  return map[t] || null;
}

// ── 4. Existing cache recipes (for procedures) ──────────────────────
console.log('Loading existing recipe cache for procedures...');
let existingRecipes = [];
const existingPath = join(CACHE, 'recipes.json');
if (existsSync(existingPath)) {
  existingRecipes = JSON.parse(readFileSync(existingPath, 'utf8'));
}
const existingBySlug = new Map();
for (const r of existingRecipes) {
  existingBySlug.set(r.slug, r);
}

// ── 5. Build enriched recipes ────────────────────────────────────────
console.log('Building enriched recipes...');
const allSlugs = new Set([...normalizedSlugs, ...indexBySlug.keys(), ...existingBySlug.keys()]);
const recipes = [];

for (const slug of allSlugs) {
  const idx = indexBySlug.get(slug) || {};
  const existing = existingBySlug.get(slug);

  // Ingredients from normalized CSV (authoritative) or existing cache
  let ingredients = [];
  const csvPath = join(RECIPES_DIR, `${slug}.csv`);
  if (existsSync(csvPath)) {
    const rows = readCSV(csvPath);
    ingredients = rows.map(r => ({
      item: r.ingredient || '',
      qty: r.qty || '',
      unit: r.unit || '',
      notes: r.notes || '',
    }));
  } else if (existing?.ingredients) {
    ingredients = existing.ingredients;
  }

  // Allergens: merge matrix + discovered + existing
  const allergenSet = new Set();
  const matrixEntries = allergenByRecipe.get(slug) || [];
  for (const entry of matrixEntries) {
    for (const flag of entry.big9) allergenSet.add(flag);
  }
  const disc = discoveredByRecipe.get(slug);
  if (disc) for (const tag of disc) allergenSet.add(tag);
  // Existing tags as fallback
  if (existing?.allergens) {
    for (const a of existing.allergens) {
      const norm = normalizeAllergenTag(a);
      if (norm) allergenSet.add(norm);
    }
  }

  // Procedure from existing cache (already extracted from PDF/workbook)
  const procedure = existing?.procedure || [];

  // Metadata from recipe_index.csv
  const subRecipes = idx.sub_recipes ? idx.sub_recipes.split(';').map(s => s.trim()).filter(Boolean) : [];
  const menuItems = idx.menu_items ? idx.menu_items.split(';').map(s => s.trim()).filter(Boolean) : [];
  const station = idx.station || existing?.source || '';

  recipes.push({
    slug,
    name: idx.recipe_name || existing?.name || slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    category: idx.category || '',
    yield_qty: idx.yield || '',
    yield_unit: idx.yield_unit || '',
    station,
    sub_recipes: subRecipes,
    menu_items: menuItems,
    notes: idx.notes || '',
    ingredients,
    allergens: [...allergenSet].sort(),
    procedure,
  });
}

recipes.sort((a, b) => a.name.localeCompare(b.name));
writeJSON('recipes.json', recipes);

// ── 6. Allergen matrix (ingredient-level) ────────────────────────────
console.log('Building allergen matrix...');
const matrixOut = {};
for (const [rid, entries] of allergenByRecipe) {
  matrixOut[rid] = entries;
}
// Add discovered-only recipes not in hand-built matrix
for (const [rid, tags] of discoveredByRecipe) {
  if (!matrixOut[rid]) {
    matrixOut[rid] = [...tags].map(tag => ({ ingredient: '(heuristic scan)', big9: [tag], notes: 'from discovered_2026-03-29.csv' }));
  }
}
writeJSON('allergen_matrix.json', matrixOut);

// ── 7. Menu ──────────────────────────────────────────────────────────
console.log('Building menu cache...');
const menuRows = readCSV(join(MENUS_DIR, 'lariat_winter_menu.csv'));
const toastMap = readCSV(join(MENUS_DIR, 'toast_recipe_map.csv'));
const toastByRecipe = new Map();
for (const row of toastMap) {
  const rid = row.recipe_id;
  if (!rid) continue;
  if (!toastByRecipe.has(rid)) toastByRecipe.set(rid, []);
  toastByRecipe.get(rid).push({ toast_id: row.toast_item_id, notes: row.notes || '' });
}

const menu = menuRows.map(row => ({
  menu_item_id: row.menu_item_id || '',
  category: row.category || '',
  display_name: row.display_name || '',
  description: row.description || '',
  station_primary: row.station_primary || '',
  station_secondary: row.station_secondary || '',
  dietary: row.dietary || '',
  active: row.active === 'true',
  add_on: row.add_on || '',
}));
writeJSON('menu.json', menu);

// ── 8. Food safety ───────────────────────────────────────────────────
console.log('Building food safety cache...');
const haccpRows = readCSV(join(FOOD_SAFETY_DIR, 'haccp_checklist_template.csv'));
const ccps = haccpRows
  .filter(r => r.ccp_id)
  .map(r => ({
    ccp_id: r.ccp_id,
    critical_control_point: r.critical_control_point || '',
    hazard: r.hazard || '',
    critical_limit: r.critical_limit || '',
    monitoring_procedure: r.monitoring_procedure || '',
    corrective_action: r.corrective_action || '',
  }));

const tempRows = readCSV(join(FOOD_SAFETY_DIR, 'daily_temp_log_template.csv'));
const tempPoints = tempRows
  .filter(r => r.location)
  .map(r => ({
    location: r.location,
    equipment: r.equipment || '',
    target_min_f: r.target_min_f || '',
    target_max_f: r.target_max_f || '',
  }));

writeJSON('food_safety.json', { ccps, temp_monitoring: tempPoints });

// ── 9. Vendor summary (Sysco) ────────────────────────────────────────
console.log('Building vendor summary...');
const syscoDetail = readCSV(join(DATA_CSV, '2026-03-19_sysco_export_details.csv'));
const syscoPurchase = readCSV(join(DATA_CSV, 'sysco_purchase_history.csv'));

// Sysco export details: actual invoice line items
const recentItems = syscoDetail
  .filter(r => r['Item Code'])
  .map(r => ({
    item_code: r['Item Code'],
    description: r['Description'] || '',
    pack_size: r['Pack Size'] || '',
    family: r['Family'] || '',
    group: r['Group'] || '',
    price: r['Price'] || '',
    qty: r['Invoice Qty'] || '',
  }));

// Sysco purchase history: catalog items with pricing
const catalogItems = syscoPurchase
  .filter(r => r.SUPC || r.Desc)
  .slice(0, 200) // cap for cache size
  .map(r => ({
    supc: r.SUPC || '',
    description: r.Desc || '',
    brand: r.Brand || '',
    pack: r.Pack || '',
    size: r.Size || '',
    unit: r.Unit || '',
    case_price: r['Case $'] || '',
    category: r.Cat || '',
  }));

writeJSON('vendor_summary.json', {
  sysco: {
    recent_items: recentItems,
    catalog: catalogItems,
    last_invoice_date: syscoDetail[0]?.['Transaction Date'] || 'unknown',
  },
});

// ── 10. Labor summary (7shifts / Toast exports) ──────────────────────
console.log('Building labor summary...');
const laborExportDir = join(ROOT, 'dev', 'exports');
let laborSummary = null;

if (existsSync(laborExportDir)) {
  // Find most recent export directory
  const exportDirs = readdirSync(laborExportDir)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();

  for (const dir of exportDirs) {
    const summaryPath = join(laborExportDir, dir, 'Labor - Summary _Mar25-Mar26_.csv');
    const byRolePath = join(laborExportDir, dir, 'Labor - By Job Title.csv');

    if (existsSync(summaryPath) && existsSync(byRolePath)) {
      const summaryRows = readCSV(summaryPath);
      const roleRows = readCSV(byRolePath);

      const metrics = {};
      for (const row of summaryRows) {
        if (row.Metric || row['0']) {
          const key = row.Metric || row['0'];
          const val = row.Value || row['1'];
          if (key && val) metrics[key] = val;
        }
      }

      const byRole = roleRows
        .filter(r => (r['Job Title'] || r['0']))
        .map(r => ({
          role: r['Job Title'] || r['0'] || '',
          total_hours: r['Total Hours'] || r['4'] || '',
          total_cost: r['Total Cost'] || r['7'] || '',
          labor_pct_net: r['Labor % (Net)'] || r['8'] || '',
        }));

      laborSummary = {
        period: dir,
        net_sales: metrics['Net Sales'] || '',
        labor_cost: metrics['Labor Cost'] || '',
        by_role: byRole,
      };
      break; // use most recent
    }
  }
}

if (laborSummary) {
  writeJSON('labor_summary.json', laborSummary);
} else {
  console.log('  (no labor exports found, skipping labor_summary.json)');
}

console.log('Done. Enriched cache files written to data/cache/');
```

- [ ] **Step 4: Add the npm script**

In `package.json`, add to scripts:

```json
"rebuild-cache": "node scripts/rebuild-cache.mjs"
```

- [ ] **Step 5: Run the rebuild**

```bash
npm run rebuild-cache
```

Expected: All cache files written without errors.

- [ ] **Step 6: Run the tests**

```bash
node --test tests/test-rebuild-cache.mjs
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/rebuild-cache.mjs tests/test-rebuild-cache.mjs package.json data/cache/
git commit -m "feat: rebuild-cache script merging recipes, allergens, menu, HACCP, Sysco, labor into enriched cache"
```

---

### Task 3: Harden the system prompt in ollama.js

**Files:**
- Modify: `lib/ollama.js`

- [ ] **Step 1: Replace ALLERGEN_BLOCK and GROUNDED_SYSTEM with hardened versions**

Replace the current `ALLERGEN_BLOCK` and `GROUNDED_SYSTEM` constants in `lib/ollama.js` with:

```js
const BIG9_LIST = `The FDA Big 9 allergens are: (1) Milk/dairy, (2) Eggs, (3) Fish, (4) Crustacean shellfish, (5) Tree nuts, (6) Peanuts, (7) Wheat/gluten, (8) Soybeans/soy, (9) Sesame. Cross-contact is ALWAYS possible in this kitchen.`;

const ALLERGEN_BLOCK = `ALLERGEN / DIETARY RULES:
- Recipe allergen tags in CONTEXT are HEURISTIC — scanned from ingredient lists, not lab-verified.
- ${BIG9_LIST}
- NEVER say a dish is "safe" or "free of" any allergen. ALWAYS say: "Based on the recipe, [dish] does/does not list [allergen] in its ingredients, but CROSS-CONTACT IS ALWAYS POSSIBLE. Please confirm with a manager before serving to a guest with allergies."
- If a guest has an allergy, the ONLY correct action is: escalate to a manager on duty. Say this explicitly.
- Ingredient-level allergen details (which specific ingredient triggers which flag) are in CONTEXT when available — cite them.`;

const HACCP_BLOCK = `FOOD SAFETY / HACCP RULES (from Lariat HACCP plan):
- Poultry: internal temp >= 165F for 15 sec (CCP-4)
- Ground beef: internal temp >= 155F for 15 sec (CCP-5)
- Fish: internal temp >= 145F for 15 sec (CCP-6)
- Hot holding: >= 140F; if below 140F for >2 hrs, discard (CCP-7)
- Cooling: 140F->70F in 2 hrs, 70F->41F in 4 hrs (CCP-8)
- Reheating: >= 165F within 2 hrs (CCP-9)
- Cold storage: walk-in <= 41F, freezer <= 0F (CCP-2, CCP-3)
- Receiving: cold items <= 41F on arrival (CCP-1)
If a cook asks about temps or holding times, cite these limits exactly. Do not guess temperatures.`;

const SOURCE_OF_TRUTH_BLOCK = `SOURCE OF TRUTH BOUNDARIES:
- 86 board, inventory, line checks, sign-offs: LIVE from today's database — authoritative for current shift.
- Recipes, ingredients, allergens: from Recipe Hub cache — authoritative for prep/ingredient questions.
- Menu items: from menu cache — authoritative for what's on the menu and which station fires it.
- HACCP / food safety: from the Lariat HACCP plan — authoritative for temp limits and corrective actions.
- Sysco vendor data: from last Sysco invoice/catalog — use for "what do we order" or "what brand" questions. NOT live pricing.
- 7shifts / labor: summary data from most recent export — use for staffing pattern questions. NOT live schedule.
- NOT IN CONTEXT (never invent): live POS totals, Toast sales, real-time pricing, guest counts, revenue, tip data, employee personal info, schedule changes after the export date.`;

const GROUNDED_SYSTEM = `You are a kitchen assistant for The Lariat restaurant, accessed through the Lariat Cockpit app. You help cooks and managers with operational questions during service.

RULES (must follow strictly):
1) Use ONLY the facts in the user message under "CONTEXT (authoritative)". If something is not there, say clearly that it is not in today's Cockpit data and suggest checking Recipe Hub, the 86 board, or asking a manager. DO NOT GUESS OR INVENT.
2) Do not invent inventory counts, 86 items, prices, sales, recipe steps, or allergen info not in CONTEXT.
3) ${ALLERGEN_BLOCK}
4) ${HACCP_BLOCK}
5) ${SOURCE_OF_TRUTH_BLOCK}
6) Be concise — short paragraphs or bullets. Prefer operational clarity over filler. Cooks are busy.
7) When citing a recipe, include the station it's assigned to and any sub-recipes that go into it.
8) When a question touches multiple recipes or menu items, list them with their allergen tags so the cook can compare.
9) If asked about a menu item, resolve it to its recipe(s) using the menu-to-recipe mapping in CONTEXT.`;
```

- [ ] **Step 2: Verify the module still exports correctly**

```bash
node -e "import('./lib/ollama.js').then(m => console.log('exports:', Object.keys(m).join(', ')))"
```

Expected: `exports: ollamaChat, assistantEnabled, getOllamaConfig, ALLERGEN_BLOCK, GROUNDED_SYSTEM`

- [ ] **Step 3: Commit**

```bash
git add lib/ollama.js
git commit -m "feat: harden system prompt with Big 9, HACCP temps, source-of-truth boundaries"
```

---

### Task 4: Extend the context builder with enriched data

**Files:**
- Modify: `lib/kitchenAssistantContext.js`
- Modify: `lib/data.js`

- [ ] **Step 1: Add new loaders to data.js**

Add these exports to `lib/data.js`:

```js
export function getMenu() { return load('menu.json') || []; }
export function getFoodSafety() { return load('food_safety.json') || { ccps: [], temp_monitoring: [] }; }
export function getVendorSummary() { return load('vendor_summary.json') || null; }
export function getLaborSummary() { return load('labor_summary.json') || null; }
export function getAllergenMatrix() { return load('allergen_matrix.json') || {}; }
```

- [ ] **Step 2: Extend buildGroundedContext with menu resolution, sub-recipes, allergen matrix, HACCP, vendor, and labor**

Replace the full `buildGroundedContext` function in `lib/kitchenAssistantContext.js`:

```js
import { getDb, todayISO } from './db.js';
import {
  getStations, getLineCheckTemplate, getRecipes,
  getMenu, getFoodSafety, getVendorSummary, getLaborSummary, getAllergenMatrix,
} from './data.js';

const MAX_86 = 40;
const MAX_INV = 20;
const MAX_RECIPES_IN_CONTEXT = 5;
const MAX_ING_CHARS = 500;
const MAX_CONTEXT_CHARS = 12000; // budget for num_ctx=4096 (~3 chars/token avg)

export function buildGroundedContext(locationId, userQuestion) {
  const date = todayISO();
  const db = getDb();
  const sources = [];

  // ── Live DB: 86s ───────────────────────────────────────────────────
  const active86 = db
    .prepare(
      `SELECT item, station_id, reason, quantity, created_at FROM eighty_six
       WHERE shift_date = ? AND resolved_at IS NULL AND location_id = ?
       ORDER BY id DESC LIMIT ?`
    )
    .all(date, locationId, MAX_86);
  sources.push({ type: 'eighty_six', detail: `${active86.length} active (today)` });

  // ── Live DB: inventory ─────────────────────────────────────────────
  const inv = db
    .prepare(
      `SELECT item, direction, delta, station_id, note, created_at FROM inventory_updates
       WHERE shift_date = ? AND location_id = ?
       ORDER BY id DESC LIMIT ?`
    )
    .all(date, locationId, MAX_INV);
  sources.push({ type: 'inventory', detail: `${inv.length} rows (today)` });

  // ── Live DB: sign-offs ─────────────────────────────────────────────
  const signoffs = db
    .prepare(
      `SELECT station_id, cook_id, created_at FROM station_signoffs
       WHERE shift_date = ? AND location_id = ? ORDER BY id ASC`
    )
    .all(date, locationId);
  sources.push({ type: 'signoffs', detail: `${signoffs.length} sign-off(s) (today)` });

  // ── Live DB: line checks ───────────────────────────────────────────
  const stations = getStations();
  const lineSummary = [];
  for (const s of stations) {
    if (!s.line_check_key) continue;
    const template = getLineCheckTemplate(s.line_check_key);
    if (!template.length) continue;
    const rows = db
      .prepare(
        `SELECT item, status FROM line_check_entries
         WHERE shift_date = ? AND station_id = ? AND location_id = ?
         ORDER BY id ASC`
      )
      .all(date, s.id, locationId);
    const byItem = new Map();
    for (const r of rows) byItem.set(r.item, r.status);
    let done = 0;
    let fail = 0;
    for (const item of template) {
      const st = byItem.get(item);
      if (st === 'pass' || st === 'fail' || st === 'na') {
        done++;
        if (st === 'fail') fail++;
      }
    }
    lineSummary.push({ station: s.name, station_id: s.id, checked: done, total: template.length, fail });
  }
  sources.push({ type: 'line_checks', detail: `${lineSummary.length} station(s) with templates` });

  // ── Cache: recipes (with menu-item resolution) ─────────────────────
  const recipes = getRecipes();
  const menu = getMenu();
  const allergenMatrix = getAllergenMatrix();

  // Expand search: if question matches a menu item name, add its recipe slugs to the search
  const expandedQuestion = expandMenuTerms(userQuestion, menu, recipes);
  const picked = pickRelevantRecipes(expandedQuestion, recipes, MAX_RECIPES_IN_CONTEXT);
  if (picked.length) {
    sources.push({ type: 'recipes', detail: picked.map(r => r.name).join(', ') });
  }

  // Resolve sub-recipes for picked recipes
  const subRecipeSlugs = new Set();
  for (const r of picked) {
    for (const sub of r.sub_recipes || []) subRecipeSlugs.add(sub);
  }
  const subRecipes = recipes.filter(r => subRecipeSlugs.has(r.slug) && !picked.some(p => p.slug === r.slug));
  if (subRecipes.length) {
    sources.push({ type: 'sub_recipes', detail: subRecipes.map(r => r.name).join(', ') });
  }

  // ── Cache: food safety ─────────────────────────────────────────────
  const foodSafety = getFoodSafety();
  const isFoodSafetyQ = /temp|temperature|holding|cool|reheat|haccp|safe|food.?safety|165|155|145|140|41/i.test(userQuestion);
  if (isFoodSafetyQ) {
    sources.push({ type: 'food_safety', detail: `${foodSafety.ccps.length} CCPs` });
  }

  // ── Cache: vendor ──────────────────────────────────────────────────
  const vendorSummary = getVendorSummary();
  const isVendorQ = /sysco|vendor|order|supplier|brand|purchase|catalog|price|case/i.test(userQuestion);
  if (isVendorQ && vendorSummary?.sysco) {
    sources.push({ type: 'vendor_sysco', detail: `${vendorSummary.sysco.recent_items.length} recent items` });
  }

  // ── Cache: labor ───────────────────────────────────────────────────
  const laborSummary = getLaborSummary();
  const isLaborQ = /labor|staff|schedule|7.?shift|hours|overtime|cook.?hours|bartender/i.test(userQuestion);
  if (isLaborQ && laborSummary) {
    sources.push({ type: 'labor', detail: `period ${laborSummary.period}` });
  }

  // ── Build text ─────────────────────────────────────────────────────
  let text = `DATE: ${date} (shift_date in database)\nLOCATION_ID: ${locationId}\n\n`;

  // 86s
  text += 'ACTIVE 86 (unresolved, today):\n';
  if (!active86.length) text += '  (none)\n';
  else for (const e of active86) {
    text += `  - ${e.item}${e.station_id ? ` @ ${e.station_id}` : ''}${e.reason ? ` | ${e.reason}` : ''}${e.quantity ? ` | qty ${e.quantity}` : ''}\n`;
  }

  // Inventory
  text += '\nRECENT INVENTORY UPDATES (today, newest first):\n';
  if (!inv.length) text += '  (none)\n';
  else for (const u of inv) {
    const bits = [u.direction, u.delta, u.station_id, u.note].filter(Boolean).join(' · ');
    text += `  - ${u.item}${bits ? ` | ${bits}` : ''}\n`;
  }

  // Sign-offs
  text += '\nSTATION SIGN-OFFS (today):\n';
  if (!signoffs.length) text += '  (none)\n';
  else for (const so of signoffs) {
    text += `  - ${so.station_id} by ${so.cook_id}\n`;
  }

  // Line checks
  text += '\nLINE CHECK PROGRESS (today):\n';
  for (const ls of lineSummary) {
    text += `  - ${ls.station} (${ls.station_id}): ${ls.checked}/${ls.total} items recorded`;
    if (ls.fail) text += `, ${ls.fail} fail`;
    text += '\n';
  }

  // Recipes with enriched data
  text += '\nRECIPE SNIPPETS (matched from Recipe Hub — use ONLY these for ingredients/allergens):\n';
  if (!picked.length && !subRecipes.length) {
    text += '  (no recipe matched — do not invent recipe or allergen facts)\n';
  } else {
    for (const r of [...picked, ...subRecipes]) {
      const allergens = r.allergens?.length ? r.allergens.join(', ') : 'none tagged';
      const ing = (r.ingredients || [])
        .map(i => `${i.item || ''} ${i.qty != null ? i.qty : ''} ${i.unit || ''}`.trim())
        .join('; ');
      const ingShort = ing.length > MAX_ING_CHARS ? `${ing.slice(0, MAX_ING_CHARS)}...` : ing;
      const stationTag = r.station ? ` | station: ${r.station}` : '';
      const subTag = r.sub_recipes?.length ? ` | uses: ${r.sub_recipes.join(', ')}` : '';
      const menuTag = r.menu_items?.length ? ` | on menu as: ${r.menu_items.join(', ')}` : '';
      const yieldTag = r.yield_qty ? ` | yield: ${r.yield_qty} ${r.yield_unit || ''}` : '';

      text += `  - "${r.name}" (${r.slug})${stationTag}${yieldTag}${subTag}${menuTag}\n`;
      text += `    allergens (Big 9 tags, HEURISTIC): ${allergens}\n`;

      // Ingredient-level allergen detail from matrix
      const matrixEntries = allergenMatrix[r.slug];
      if (matrixEntries?.length) {
        const flagged = matrixEntries.filter(e => e.big9.length > 0);
        if (flagged.length) {
          text += '    allergen detail (ingredient-level):\n';
          for (const e of flagged) {
            text += `      ${e.ingredient} -> ${e.big9.join(', ')}${e.notes ? ` (${e.notes})` : ''}\n`;
          }
        }
      }

      text += `    ingredients: ${ingShort}\n`;

      // Procedure (if present and non-trivial)
      if (r.procedure?.length > 0 && r.procedure.some(s => s.length > 5)) {
        const procText = r.procedure.join(' | ');
        const procShort = procText.length > 300 ? procText.slice(0, 300) + '...' : procText;
        text += `    procedure: ${procShort}\n`;
      }
    }
  }

  // Food safety (conditional)
  if (isFoodSafetyQ && foodSafety.ccps.length) {
    text += '\nHACCP CRITICAL CONTROL POINTS:\n';
    for (const ccp of foodSafety.ccps) {
      text += `  - ${ccp.ccp_id}: ${ccp.critical_control_point} | limit: ${ccp.critical_limit} | corrective: ${ccp.corrective_action}\n`;
    }
  }

  // Vendor (conditional)
  if (isVendorQ && vendorSummary?.sysco) {
    text += `\nSYSCO VENDOR DATA (last invoice: ${vendorSummary.sysco.last_invoice_date}):\n`;
    const items = vendorSummary.sysco.recent_items.slice(0, 15);
    for (const item of items) {
      text += `  - ${item.description} | ${item.pack_size} | ${item.family} | qty: ${item.qty}\n`;
    }
    if (vendorSummary.sysco.recent_items.length > 15) {
      text += `  ... and ${vendorSummary.sysco.recent_items.length - 15} more items\n`;
    }
  }

  // Labor (conditional)
  if (isLaborQ && laborSummary) {
    text += `\nLABOR SUMMARY (period: ${laborSummary.period}, from 7shifts/Toast export):\n`;
    text += `  Net Sales: $${laborSummary.net_sales} | Labor Cost: $${laborSummary.labor_cost}\n`;
    for (const r of (laborSummary.by_role || []).slice(0, 8)) {
      text += `  - ${r.role}: ${r.total_hours} hrs | $${r.total_cost} | ${(parseFloat(r.labor_pct_net) * 100).toFixed(1)}% of net\n`;
    }
  }

  // Boundaries
  text += '\nNOT IN THIS CONTEXT: live POS, Toast real-time totals, real-time vendor pricing, guest counts, revenue, tips, employee personal info, schedule changes after export date.\n';

  // Truncate if over budget
  if (text.length > MAX_CONTEXT_CHARS) {
    text = text.slice(0, MAX_CONTEXT_CHARS) + '\n... (context truncated for token budget)\n';
  }

  return { contextText: text, sources };
}

/** Expand question with recipe slugs if it matches menu item names */
function expandMenuTerms(question, menu, recipes) {
  const q = (question || '').toLowerCase();
  const extra = [];
  for (const item of menu) {
    const name = (item.display_name || '').toLowerCase();
    if (name && name.length > 3 && q.includes(name.slice(0, Math.min(20, name.length)))) {
      // Find recipes that list this menu item
      for (const r of recipes) {
        if (r.menu_items?.some(mi => mi.toLowerCase().includes(name.slice(0, 10)))) {
          extra.push(r.name);
        }
      }
    }
  }
  return extra.length ? `${question} ${extra.join(' ')}` : question;
}

function pickRelevantRecipes(question, recipes, max) {
  const q = (question || '').toLowerCase().trim();
  if (!q || !recipes.length) return [];

  const words = [...new Set(q.split(/\W+/).filter(w => w.length > 2))];
  const scored = recipes.map(r => {
    let score = 0;
    const name = (r.name || '').toLowerCase();
    if (name && q.includes(name)) score += 12;
    for (const w of words) {
      if (name.includes(w)) score += 4;
    }
    // Ingredient match
    for (const i of r.ingredients || []) {
      const it = (i.item || '').toLowerCase();
      for (const w of words) {
        if (it.includes(w)) score += 2;
      }
    }
    // Allergen match
    for (const a of r.allergens || []) {
      if (q.includes(String(a).toLowerCase())) score += 5;
    }
    // Menu item match
    for (const mi of r.menu_items || []) {
      const mil = mi.toLowerCase();
      for (const w of words) {
        if (mil.includes(w)) score += 3;
      }
    }
    // Station match
    if (r.station && q.includes(r.station.toLowerCase())) score += 2;
    return { r, score };
  });

  const top = scored
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(x => x.r);

  if (top.length) return top;

  return recipes.filter(r => nameMatches(r.name, q)).slice(0, max);
}

function nameMatches(name, q) {
  if (!name) return false;
  const n = name.toLowerCase();
  for (let len = Math.min(24, q.length); len >= 4; len--) {
    const sub = q.slice(0, len);
    if (sub.length >= 4 && n.includes(sub)) return true;
  }
  return false;
}
```

- [ ] **Step 3: Verify the app still builds**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add lib/data.js lib/kitchenAssistantContext.js
git commit -m "feat: extend context builder with menu resolution, sub-recipes, allergen matrix, HACCP, Sysco, labor"
```

---

### Task 5: Update OPERATIONS.md source-of-truth table

**Files:**
- Modify: `OPERATIONS.md`

- [ ] **Step 1: Update the source-of-truth cadence table**

Find the existing table in OPERATIONS.md and replace with:

```markdown
## Source-of-truth cadence (Toast, Shamrock, Sysco, 7shifts, spreadsheets)

Decide **which file wins** when two sources disagree. Suggested defaults:

| Source | Typical cadence | Feeds | Ingest command |
|--------|-----------------|-------|----------------|
| **Toast** (POS) | Daily or after each service window | Item sales, payments | `npm run ingest:analytics` |
| **Shamrock** (vendor) | Weekly or when orders close | Spend trends | `npm run ingest:analytics` |
| **Sysco** (vendor) | Per delivery / weekly | Purchase history, catalog, item pricing | `npm run rebuild-cache` (reads `data/csv/sysco_*.csv`) |
| **7shifts** (labor) | Weekly or per schedule publish | Labor hours, cost by role, OT | Export CSVs to `dev/exports/YYYY-MM-DD/Labor - *.csv`, then `npm run rebuild-cache` |
| **Manual spreadsheets** | When KM updates costing or menus | Master Costing, operations workbook | `npm run ingest:costing` |
| **Recipe Hub** (normalized CSVs) | When recipes change | Ingredients, allergens, procedures | `npm run rebuild-cache` |
| **Menu CSVs** | When menu version changes | Menu items, station map, Toast links | `npm run rebuild-cache` |
| **HACCP templates** | Annually or after audit | Food safety CCPs, temp limits | `npm run rebuild-cache` |

Re-run the relevant ingest/rebuild after updating source files; restart the app if it was already running.
```

- [ ] **Step 2: Add training section**

Append to OPERATIONS.md:

```markdown
## Local model training (Mac M4 / Apple Silicon)

See `training/SETUP.md` for full instructions. Quick summary:

1. **Ollama custom model** (recommended first): Uses a Modelfile with the Lariat system prompt baked in. No GPU training needed — just `ollama create lariat-assistant -f training/Modelfile`.
2. **LoRA fine-tuning** (optional, for better grounding): Uses `mlx-lm` on Apple Silicon to fine-tune a small model on Lariat Q&A pairs. Requires ~12 GB RAM for a 3B model.

The assistant works well out of the box with the grounded context approach (no fine-tuning needed). Fine-tuning is for marginal gains in restaurant-specific phrasing and faster inference.
```

- [ ] **Step 3: Commit**

```bash
git add OPERATIONS.md
git commit -m "docs: update source-of-truth table with Sysco, 7shifts; add training section"
```

---

### Task 6: Create Ollama Modelfile and training setup

**Files:**
- Create: `training/Modelfile`
- Create: `training/generate-qa.mjs`
- Create: `training/mlx-lora-config.yaml`
- Create: `training/SETUP.md`

- [ ] **Step 1: Write the Ollama Modelfile**

```dockerfile
# training/Modelfile
# Lariat Kitchen Assistant — custom Ollama model with baked-in system prompt
# Build: ollama create lariat-assistant -f training/Modelfile
# Use:   Set LARIAT_OLLAMA_MODEL=lariat-assistant in .env.local

FROM llama3.2:3b

PARAMETER temperature 0.2
PARAMETER top_p 0.85
PARAMETER num_predict 512
PARAMETER num_ctx 4096
PARAMETER stop "<|eot_id|>"

SYSTEM """You are a kitchen assistant for The Lariat restaurant, accessed through the Lariat Cockpit app. You help cooks and managers with operational questions during service.

RULES (must follow strictly):
1) Use ONLY the facts in the user message under "CONTEXT (authoritative)". If something is not there, say clearly that it is not in today's Cockpit data and suggest checking Recipe Hub, the 86 board, or asking a manager. DO NOT GUESS OR INVENT.
2) Do not invent inventory counts, 86 items, prices, sales, recipe steps, or allergen info not in CONTEXT.
3) ALLERGEN / DIETARY: Recipe allergen tags in CONTEXT are HEURISTIC — scanned from ingredient lists, not lab-verified. The FDA Big 9 allergens are: (1) Milk/dairy, (2) Eggs, (3) Fish, (4) Crustacean shellfish, (5) Tree nuts, (6) Peanuts, (7) Wheat/gluten, (8) Soybeans/soy, (9) Sesame. Cross-contact is ALWAYS possible. NEVER say a dish is "safe" or "free of" any allergen. ALWAYS escalate allergies to a manager on duty.
4) HACCP TEMPS: Poultry >= 165F/15s. Ground beef >= 155F/15s. Fish >= 145F/15s. Hot hold >= 140F. Cooling: 140->70F in 2hr, 70->41F in 4hr. Reheat >= 165F in 2hr. Walk-in <= 41F. Freezer <= 0F.
5) SOURCE BOUNDARIES: 86/inventory/line-checks/sign-offs = live shift data. Recipes/allergens = Recipe Hub cache. Menu = menu cache. HACCP = plan. Sysco = last invoice. Labor = last export. NEVER INVENT: POS totals, sales, pricing, guest counts, tips, schedules.
6) Be concise — bullets preferred. Cooks are busy.
7) Cite station assignments and sub-recipes when discussing a recipe.
8) For menu item questions, resolve to recipe(s) and list allergens.
"""
```

- [ ] **Step 2: Write the Q&A training data generator**

```js
// training/generate-qa.mjs
// Generates JSONL training pairs from Lariat restaurant data.
// These can be used for Ollama fine-tuning or mlx-lm LoRA training.
// Run: node training/generate-qa.mjs

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const CACHE = join(ROOT, 'data', 'cache');

function loadJSON(name) {
  const p = join(CACHE, name);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

const recipes = loadJSON('recipes.json') || [];
const menu = loadJSON('menu.json') || [];
const foodSafety = loadJSON('food_safety.json') || { ccps: [] };
const allergenMatrix = loadJSON('allergen_matrix.json') || {};

const pairs = [];

function addPair(question, answer) {
  pairs.push({ messages: [
    { role: 'user', content: question },
    { role: 'assistant', content: answer },
  ]});
}

// ── Recipe questions ─────────────────────────────────────────────────
for (const r of recipes) {
  // "What's in [recipe]?"
  if (r.ingredients?.length) {
    const ingList = r.ingredients.map(i => `${i.item} (${i.qty} ${i.unit})`).join(', ');
    addPair(
      `What are the ingredients in ${r.name}?`,
      `Based on the Recipe Hub, ${r.name} contains: ${ingList}.${r.yield_qty ? ` Yield: ${r.yield_qty} ${r.yield_unit}.` : ''}${r.station ? ` Station: ${r.station}.` : ''}`
    );
  }

  // "Does [recipe] have allergens?"
  if (r.allergens?.length) {
    const matrix = allergenMatrix[r.slug] || [];
    const flagged = matrix.filter(e => e.big9?.length > 0);
    let detail = '';
    if (flagged.length) {
      detail = ' Ingredient-level detail: ' + flagged.map(e => `${e.ingredient} (${e.big9.join(', ')})`).join('; ') + '.';
    }
    addPair(
      `Does ${r.name} contain any allergens?`,
      `Based on the recipe, ${r.name} has these heuristic allergen tags: ${r.allergens.join(', ')}.${detail} IMPORTANT: These are heuristic tags, not lab-verified. Cross-contact is always possible in this kitchen. Please confirm with a manager before serving to a guest with allergies.`
    );
  }

  // "What sub-recipes go into [recipe]?"
  if (r.sub_recipes?.length) {
    const subNames = r.sub_recipes.map(slug => {
      const sub = recipes.find(s => s.slug === slug);
      return sub ? sub.name : slug;
    });
    addPair(
      `What sub-recipes go into ${r.name}?`,
      `${r.name} uses these sub-recipes: ${subNames.join(', ')}. Make sure these are prepped before building ${r.name}.`
    );
  }

  // Procedure
  if (r.procedure?.length > 0 && r.procedure.some(s => s.length > 5)) {
    addPair(
      `How do I make ${r.name}?`,
      `Procedure for ${r.name}: ${r.procedure.join(' ')}${r.notes ? ` Note: ${r.notes}` : ''}`
    );
  }
}

// ── Menu item questions ──────────────────────────────────────────────
for (const item of menu) {
  if (!item.display_name || !item.active) continue;
  const linkedRecipes = recipes.filter(r =>
    r.menu_items?.some(mi => mi.toLowerCase().includes(item.display_name.toLowerCase().slice(0, 10)))
  );
  if (linkedRecipes.length) {
    const recipeInfo = linkedRecipes.map(r => `${r.name} (allergens: ${r.allergens?.join(', ') || 'none tagged'})`).join('; ');
    addPair(
      `What goes into the ${item.display_name}?`,
      `The ${item.display_name} fires from ${item.station_primary || 'unknown station'}. Related recipes: ${recipeInfo}.${item.dietary ? ` Dietary notes: ${item.dietary}.` : ''}`
    );
  }
}

// ── HACCP questions ──────────────────────────────────────────────────
for (const ccp of foodSafety.ccps) {
  addPair(
    `What's the food safety rule for ${ccp.critical_control_point.toLowerCase()}?`,
    `${ccp.ccp_id} — ${ccp.critical_control_point}: Critical limit is ${ccp.critical_limit}. Monitoring: ${ccp.monitoring_procedure}. If out of range: ${ccp.corrective_action}.`
  );
}

// ── Refusal / boundary questions ─────────────────────────────────────
addPair(
  `What were our sales today?`,
  `I don't have access to live POS or Toast sales data. That information is not in today's Cockpit context. Please check Toast directly or ask a manager for today's sales figures.`
);
addPair(
  `Is the queso safe for someone with a dairy allergy?`,
  `I cannot say any dish is "safe" for an allergy. Based on the recipe, Queso / Mac Sauce lists milk/dairy as an allergen tag (heavy cream, whole milk, american cheese block, shredded cheddar). However, these are heuristic tags — not lab-verified — and cross-contact is always possible. PLEASE ESCALATE TO A MANAGER before serving to a guest with a dairy allergy.`
);
addPair(
  `How many guests did we serve last Friday?`,
  `Guest counts are not in my context. I only have today's operational data (86 board, inventory, line checks) and cached recipe/menu/food safety information. Please check Toast or ask a manager for guest count data.`
);

const outPath = join(import.meta.dirname, 'lariat-qa.jsonl');
const jsonl = pairs.map(p => JSON.stringify(p)).join('\n') + '\n';
writeFileSync(outPath, jsonl);
console.log(`Generated ${pairs.length} Q&A pairs -> ${outPath}`);
```

- [ ] **Step 3: Write the mlx-lm LoRA config**

```yaml
# training/mlx-lora-config.yaml
# LoRA fine-tuning config for mlx-lm on Apple Silicon (M4, 16 GB)
#
# Prerequisites:
#   pip install mlx-lm
#   Convert training data: see SETUP.md
#
# Run:
#   mlx_lm.lora \
#     --model mlx-community/Llama-3.2-3B-Instruct-4bit \
#     --train \
#     --data training/ \
#     --adapter-path training/adapters \
#     --iters 200 \
#     --batch-size 2 \
#     --lora-layers 8 \
#     --learning-rate 1e-5 \
#     --config training/mlx-lora-config.yaml

# Model (4-bit quantized fits in ~4 GB, leaving headroom for context)
model: "mlx-community/Llama-3.2-3B-Instruct-4bit"

# LoRA hyperparameters (conservative for 16 GB)
lora_layers: 8
lora_rank: 8
lora_alpha: 16
lora_dropout: 0.05

# Training
batch_size: 2
iters: 200
learning_rate: 1.0e-5
warmup_steps: 20
grad_checkpoint: true    # saves ~2 GB RAM

# Data
data: "training"
train: "lariat-qa.jsonl"

# Output
adapter_path: "training/adapters"
save_every: 50
```

- [ ] **Step 4: Write SETUP.md**

```markdown
# Lariat Kitchen Assistant — Mac Training Setup

Hardware: Apple M4, 16 GB unified memory.

## 1. Install Ollama

```bash
# Download from https://ollama.com or:
brew install ollama
```

Start Ollama (it runs as a menu bar app on Mac):
```bash
ollama serve   # or just open the Ollama app
```

## 2. Pull a base model

```bash
# Recommended for 16 GB: 3B quantized (fast, fits easily)
ollama pull llama3.2:3b

# Optional: 8B for better quality (slower, uses ~6 GB)
ollama pull llama3.1:8b
```

## 3. Create the Lariat custom model (recommended)

This bakes the restaurant-specific system prompt into the model so it's always active:

```bash
cd /path/to/lariat-cockpit
ollama create lariat-assistant -f training/Modelfile
```

Then set in `.env.local`:
```
LARIAT_ASSISTANT_ENABLED=1
LARIAT_OLLAMA_MODEL=lariat-assistant
```

Restart the app. The assistant now uses the baked-in system prompt + the per-request grounded context.

## 4. Generate training data (for optional LoRA fine-tuning)

First rebuild the cache (if not already done):
```bash
npm run rebuild-cache
```

Then generate Q&A pairs:
```bash
node training/generate-qa.mjs
```

This creates `training/lariat-qa.jsonl` with ~200+ Q&A pairs covering recipes, allergens, menu items, HACCP rules, and refusal boundaries.

## 5. LoRA fine-tuning with mlx-lm (optional)

This is optional — the grounded context approach works well without it. Fine-tuning gives marginal gains in restaurant-specific phrasing.

```bash
# Install mlx-lm
pip install mlx-lm

# Run LoRA training (~10 min on M4, uses ~12 GB RAM)
mlx_lm.lora \
  --model mlx-community/Llama-3.2-3B-Instruct-4bit \
  --train \
  --data training/ \
  --adapter-path training/adapters \
  --iters 200 \
  --batch-size 2 \
  --lora-layers 8 \
  --learning-rate 1e-5

# Fuse adapters into a new model
mlx_lm.fuse \
  --model mlx-community/Llama-3.2-3B-Instruct-4bit \
  --adapter-path training/adapters \
  --save-path training/lariat-fused

# Convert to GGUF for Ollama
mlx_lm.convert --hf-path training/lariat-fused --mlx-path training/lariat-gguf -q
```

Then create an Ollama model from the fused GGUF:
```bash
# Create a Modelfile pointing to the fused model
cat > training/Modelfile.fused << 'EOF'
FROM training/lariat-gguf/model.gguf
PARAMETER temperature 0.2
PARAMETER top_p 0.85
PARAMETER num_predict 512
PARAMETER num_ctx 4096
EOF

ollama create lariat-finetuned -f training/Modelfile.fused
```

Set `LARIAT_OLLAMA_MODEL=lariat-finetuned` in `.env.local`.

## .env.local template

```bash
LARIAT_ASSISTANT_ENABLED=1
LARIAT_OLLAMA_URL=http://127.0.0.1:11434
LARIAT_OLLAMA_MODEL=lariat-assistant
LARIAT_OLLAMA_TIMEOUT_MS=45000
LARIAT_ASSISTANT_TEMPERATURE=0.2
LARIAT_ASSISTANT_MAX_TOKENS=512
LARIAT_ASSISTANT_NUM_CTX=4096
```
```

- [ ] **Step 5: Run the Q&A generator**

```bash
npm run rebuild-cache   # ensure cache is fresh
node training/generate-qa.mjs
```

Expected: `Generated ~200+ Q&A pairs -> training/lariat-qa.jsonl`

- [ ] **Step 6: Commit**

```bash
git add training/
git commit -m "feat: Ollama Modelfile, Q&A training data generator, mlx-lm LoRA config, Mac setup guide"
```

---

### Task 7: Final build verification and integration test

**Files:**
- (no new files)

- [ ] **Step 1: Rebuild cache and run tests**

```bash
npm run rebuild-cache
node --test tests/test-rebuild-cache.mjs
```

Expected: All tests pass.

- [ ] **Step 2: Build the Next.js app**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Smoke test (if Ollama is running)**

```bash
# Start the app
npm run dev &

# Check the assistant endpoint
curl -s http://localhost:3000/api/kitchen-assistant?ping=1 | node -e "process.stdin.on('data', d => console.log(JSON.parse(d)))"

# If enabled and Ollama running, test a grounded query:
curl -s -X POST http://localhost:3000/api/kitchen-assistant \
  -H 'content-type: application/json' \
  -d '{"message": "What allergens are in the queso?"}' | node -e "process.stdin.on('data', d => { const j=JSON.parse(d); console.log('Answer:', j.answer?.slice(0,200)); console.log('Sources:', j.sources); console.log('Disclaimer:', j.disclaimer); })"
```

- [ ] **Step 4: Final commit with all cache files**

```bash
git add -A
git status  # verify no secrets or lock files
git commit -m "chore: rebuild enriched cache files, verify build"
```

---

## Self-Review Checklist

| Spec requirement | Task |
|-----------------|------|
| Merge/checkout branch | Task 1 |
| Enrich recipe cache with normalized CSVs, allergen matrix, sub-recipes, menu items, stations | Task 2 |
| Big 9 allergen hardening in system prompt | Task 3 |
| HACCP food safety rules in system prompt | Task 3 |
| Source-of-truth boundaries (Sysco, 7shifts) in prompt | Task 3 |
| Menu-item-to-recipe resolution in context builder | Task 4 |
| Sub-recipe expansion in context | Task 4 |
| Ingredient-level allergen detail in context | Task 4 |
| HACCP CCP injection for food safety questions | Task 4 |
| Sysco vendor data injection for order questions | Task 4 |
| 7shifts labor summary injection | Task 4 |
| Context budget management (MAX_CONTEXT_CHARS) | Task 4 |
| OPERATIONS.md updated with Sysco + 7shifts | Task 5 |
| Ollama Modelfile with baked system prompt | Task 6 |
| Q&A training data generator | Task 6 |
| mlx-lm LoRA config for M4 16 GB | Task 6 |
| Mac setup guide (SETUP.md) | Task 6 |
| Build verification | Task 7 |
