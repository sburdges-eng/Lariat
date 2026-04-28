#!/usr/bin/env node
// Rebuild enriched cache from all available Lariat data sources.
//
// Merges:
//  - Existing data/cache/recipes.json (preserves procedures)
//  - dev/exports/2026-04-01/Recipe Book.csv
//  - recipes/recipe_index.csv + recipes/normalized/*.csv (if present)
//  - allergens/allergen_matrix.csv (if present)
//  - allergens/discovered_2026-03-29.csv (if present)
//  - menus/ winter menu + toast_recipe_map (if present)
//  - dev/exports/2026-04-01/Menu - Winter.csv
//  - food_safety/ templates (if present)
//  - data/csv/ and dev/exports/ Sysco files
//  - dev/exports/2026-04-01/Labor - *.csv
//
// Output: data/cache/{recipes,allergen_matrix,menu,food_safety,vendor_summary,labor_summary}.json
//
// Run: npm run rebuild-cache

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, 'data', 'cache');

// ---------------------------------------------------------------------------
// CSV parser (no deps — handles quoted fields, newlines in quotes)
// ---------------------------------------------------------------------------
function parseCSV(text) {
  const rows = [];
  let i = 0;
  while (i < text.length) {
    const row = [];
    while (i < text.length) {
      if (text[i] === '"') {
        // quoted field
        i++; // skip opening quote
        let field = '';
        while (i < text.length) {
          if (text[i] === '"') {
            if (i + 1 < text.length && text[i + 1] === '"') {
              field += '"';
              i += 2;
            } else {
              i++; // skip closing quote
              break;
            }
          } else {
            field += text[i];
            i++;
          }
        }
        row.push(field);
        if (i < text.length && text[i] === ',') i++;
      } else {
        // unquoted field
        let field = '';
        while (i < text.length && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          field += text[i];
          i++;
        }
        row.push(field);
        if (i < text.length && text[i] === ',') {
          i++;
        }
      }
      // end of row?
      if (i >= text.length || text[i] === '\n' || text[i] === '\r') {
        break;
      }
    }
    // skip line endings
    while (i < text.length && (text[i] === '\n' || text[i] === '\r')) i++;
    if (row.length > 0 && !(row.length === 1 && row[0] === '')) {
      rows.push(row);
    }
  }
  return rows;
}

function tryRead(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf-8');
}

function tryReadJSON(relPath) {
  const text = tryRead(relPath);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// ---------------------------------------------------------------------------
// Ingredient-level allergen knowledge base
// Common restaurant ingredients mapped to Big 9 allergens.
// Big 9: milk, eggs, fish, shellfish, tree_nuts, peanuts, wheat, soybeans, sesame
// ---------------------------------------------------------------------------
const INGREDIENT_ALLERGENS = {
  // Dairy / milk
  'buttermilk': ['milk'], 'heavy cream': ['milk'], 'cream': ['milk'],
  'whole milk': ['milk'], 'milk': ['milk'], 'butter': ['milk'],
  'cheese': ['milk'], 'cheddar': ['milk'], 'pepperjack': ['milk'],
  'mozzarella': ['milk'], 'oaxaca': ['milk'], 'cotija': ['milk'],
  'bleu cheese': ['milk'], 'blue cheese': ['milk'], 'cream cheese': ['milk'],
  'parmesan': ['milk'], 'sour cream': ['milk'], 'yogurt': ['milk'],
  'queso': ['milk'], 'whey': ['milk'], 'casein': ['milk'],
  '5lb cheese block': ['milk'], '5lb bags shredded cheddar': ['milk'],
  'white cheddar': ['milk'],
  // Eggs
  'egg': ['eggs'], 'eggs': ['eggs'], 'mayo': ['eggs'], 'mayonnaise': ['eggs'],
  'aioli': ['eggs'],
  // Fish
  'anchovy': ['fish'], 'anchovies': ['fish'], 'fish sauce': ['fish'],
  'worcestershire': ['fish'], 'catfish': ['fish'], 'trout': ['fish'],
  'fish': ['fish'],
  // Shellfish
  'shrimp': ['shellfish'], 'crab': ['shellfish'], 'lobster': ['shellfish'],
  'oyster': ['shellfish'], 'clam': ['shellfish'],
  // Tree nuts
  'almonds': ['tree_nuts'], 'almond': ['tree_nuts'], 'walnut': ['tree_nuts'],
  'walnuts': ['tree_nuts'], 'pecan': ['tree_nuts'], 'pecans': ['tree_nuts'],
  'cashew': ['tree_nuts'], 'cashews': ['tree_nuts'], 'pistachio': ['tree_nuts'],
  'pine nuts': ['tree_nuts'],
  // Peanuts
  'peanut': ['peanuts'], 'peanuts': ['peanuts'], 'peanut butter': ['peanuts'],
  // Wheat / gluten
  'ap flour': ['wheat'], 'flour': ['wheat'], 'bread': ['wheat'],
  'breadcrumbs': ['wheat'], 'bread crumbs': ['wheat'], 'panko': ['wheat'],
  'flour tortilla': ['wheat'], 'flour tortillas': ['wheat'],
  'wheat tortilla': ['wheat'], 'wheat tortillas': ['wheat'],
  'brioche': ['wheat'], 'bun': ['wheat'],
  'sourdough': ['wheat'], 'pasta': ['wheat'], 'noodle': ['wheat'],
  'baguette': ['wheat'], 'cracker': ['wheat'], 'crackers': ['wheat'],
  'wafer': ['wheat'], 'wafers': ['wheat'], 'vanilla wafer': ['wheat'],
  'vanilla wafers': ['wheat'], 'ciabatta': ['wheat'], 'beer': ['wheat'], 'soy sauce': ['wheat', 'soybeans'],
  // Soybeans / soy
  'soy': ['soybeans'], 'soybean': ['soybeans'], 'tofu': ['soybeans'],
  'edamame': ['soybeans'], 'miso': ['soybeans'], 'tempeh': ['soybeans'],
  'adobo': ['soybeans'], // Adobo paste/sauce contains soy
  'teriyaki': ['soybeans', 'wheat'],
  // Sesame
  'sesame': ['sesame'], 'sesame oil': ['sesame'], 'sesame seeds': ['sesame'],
  'tahini': ['sesame'],
};

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsIngredientPhrase(ingredientName, allergenKey) {
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(allergenKey)}([^a-z0-9]|$)`);
  return pattern.test(ingredientName);
}

// Fuzzy match: check if any key is present as a whole ingredient phrase.
export function inferAllergens(ingredientName) {
  const lower = ingredientName.toLowerCase().trim();
  const found = new Set();

  // Direct match first
  if (INGREDIENT_ALLERGENS[lower]) {
    for (const a of INGREDIENT_ALLERGENS[lower]) found.add(a);
    return [...found];
  }

  // Phrase match. Raw substring matching makes short keys unsafe:
  // "reggiano" contains "egg" but Parmigiano-Reggiano has no eggs.
  for (const [key, allergens] of Object.entries(INGREDIENT_ALLERGENS)) {
    if (containsIngredientPhrase(lower, key)) {
      for (const a of allergens) found.add(a);
    }
  }
  return [...found];
}

// Normalize legacy allergen tags to Big 9 names
function normalizeToBig9(tag) {
  const t = tag.toLowerCase().trim();
  const map = {
    'dairy': 'milk',
    'milk': 'milk',
    'egg': 'eggs',
    'eggs': 'eggs',
    'fish': 'fish',
    'shellfish': 'shellfish',
    'tree_nuts': 'tree_nuts',
    'treenuts': 'tree_nuts',
    'nuts': 'tree_nuts',
    'peanut': 'peanuts',
    'peanuts': 'peanuts',
    'wheat': 'wheat',
    'gluten': 'wheat',
    'gluten_barley_rye': 'wheat',
    'soy': 'soybeans',
    'soybeans': 'soybeans',
    'soybean': 'soybeans',
    'sesame': 'sesame',
  };
  return map[t] || null;
}

// ---------------------------------------------------------------------------
// 1. Build recipes
// ---------------------------------------------------------------------------
function buildRecipes() {
  console.log('  Building recipes...');

  // Start with existing cache
  const existing = tryReadJSON('data/cache/recipes.json') || [];
  const bySlug = new Map();

  for (const r of existing) {
    // Normalize slug to underscores (existing cache may have hyphens)
    const rawSlug = r.slug || slugify(r.name);
    const slug = rawSlug.replace(/-/g, '_');
    bySlug.set(slug, { ...r, slug });
  }

  // Also parse from Recipe Book CSV if available
  const recipeBookCSV = tryRead('dev/exports/2026-04-01/Recipe Book.csv');
  if (recipeBookCSV) {
    const rows = parseCSV(recipeBookCSV);
    let currentRecipe = null;
    let inIngredients = false;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row[0] && !row[1]) continue;

      // Detect recipe header: name in col 0, next row starts with "Ingredient"
      if (
        row[0] &&
        row[0] !== 'Ingredient' &&
        !row[0].startsWith('Yield') &&
        row[0] !== '0' &&
        i + 1 < rows.length &&
        rows[i + 1][0] === 'Ingredient'
      ) {
        // Save current recipe if it's new
        if (currentRecipe) {
          const slug = slugify(currentRecipe.name);
          if (!bySlug.has(slug)) {
            bySlug.set(slug, currentRecipe);
          }
        }
        currentRecipe = {
          name: row[0].trim(),
          slug: slugify(row[0].trim()),
          ingredients: [],
          procedure: [],
          allergens: [],
          source: 'csv',
        };
        inIngredients = false;
        continue;
      }

      if (row[0] === 'Ingredient') {
        inIngredients = true;
        continue;
      }

      if (inIngredients && currentRecipe && row[0]) {
        if (row[0].startsWith('Yield')) {
          inIngredients = false;
          continue;
        }
        if (!row[0].trim()) continue;

        const ingredient = {
          item: row[0].trim(),
          qty: isNaN(parseFloat(row[1])) ? row[1] || '' : parseFloat(row[1]),
          unit: (row[2] || '').trim(),
        };
        currentRecipe.ingredients.push(ingredient);

        // Procedure is in column 6
        const proc = (row[6] || '').trim();
        if (proc && /^\d+\./.test(proc)) {
          currentRecipe.procedure.push(proc);
        }
      }
    }
    // Don't forget the last recipe
    if (currentRecipe) {
      const slug = slugify(currentRecipe.name);
      if (!bySlug.has(slug)) {
        bySlug.set(slug, currentRecipe);
      }
    }
  }

  // Try recipe_index.csv + normalized CSVs (may not exist yet)
  const indexCSV = tryRead('recipes/recipe_index.csv');
  if (indexCSV) {
    console.log('    Found recipes/recipe_index.csv');
    const rows = parseCSV(indexCSV);
    if (rows.length > 1) {
      const header = rows[0];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const obj = {};
        header.forEach((h, idx) => { obj[h.trim()] = (row[idx] || '').trim(); });
        const slug = slugify(obj.recipe_id || obj.recipe_name || '');
        if (!slug) continue;

        const entry = bySlug.get(slug) || {
          name: obj.recipe_name || '',
          slug,
          ingredients: [],
          procedure: [],
          allergens: [],
          source: 'recipe_index',
        };

        // Merge index fields
        if (obj.category) entry.category = obj.category;
        if (obj.yield) entry.yield_qty = parseFloat(obj.yield) || obj.yield;
        if (obj.yield_unit) entry.yield_unit = obj.yield_unit;
        if (obj.station) entry.station = obj.station;
        if (obj.sub_recipes) entry.sub_recipes = obj.sub_recipes.split(';').map(s => s.trim()).filter(Boolean);
        if (obj.menu_items) entry.menu_items = obj.menu_items.split(';').map(s => s.trim()).filter(Boolean);
        if (obj.notes) entry.notes = obj.notes;

        bySlug.set(slug, entry);

        // Try normalized CSV
        const normalCSV = tryRead(`recipes/normalized/${slug}.csv`);
        if (normalCSV) {
          const nRows = parseCSV(normalCSV);
          if (nRows.length > 1) {
            const nHeader = nRows[0];
            entry.ingredients = [];
            for (let j = 1; j < nRows.length; j++) {
              const nObj = {};
              nHeader.forEach((h, idx) => { nObj[h.trim()] = (nRows[j][idx] || '').trim(); });
              entry.ingredients.push({
                item: nObj.ingredient || '',
                qty: parseFloat(nObj.qty) || nObj.qty || '',
                unit: nObj.unit || '',
              });
            }
          }
        }
      }
    }
  }

  // Merge allergen data from allergen_matrix.csv if it exists
  const matrixCSV = tryRead('allergens/allergen_matrix.csv');
  if (matrixCSV) {
    console.log('    Found allergens/allergen_matrix.csv');
    const rows = parseCSV(matrixCSV);
    if (rows.length > 1) {
      const header = rows[0];
      for (let i = 1; i < rows.length; i++) {
        const obj = {};
        header.forEach((h, idx) => { obj[h.trim()] = (rows[i][idx] || '').trim(); });
        const slug = slugify(obj.recipe_id || '');
        const entry = bySlug.get(slug);
        if (!entry) continue;
        const big9Tags = ['milk', 'eggs', 'fish', 'shellfish', 'tree_nuts', 'peanuts', 'wheat', 'soybeans', 'sesame'];
        for (const tag of big9Tags) {
          if (obj[tag] && obj[tag].toUpperCase() === 'X') {
            if (!entry.allergens.includes(tag)) entry.allergens.push(tag);
          }
        }
      }
    }
  }

  // Merge discovered allergens if available
  const discoveredCSV = tryRead('allergens/discovered_2026-03-29.csv');
  if (discoveredCSV) {
    console.log('    Found allergens/discovered_2026-03-29.csv');
    const rows = parseCSV(discoveredCSV);
    if (rows.length > 1) {
      const header = rows[0];
      for (let i = 1; i < rows.length; i++) {
        const obj = {};
        header.forEach((h, idx) => { obj[h.trim()] = (rows[i][idx] || '').trim(); });
        if (obj.scope !== 'normalized_recipe' && obj.scope !== 'recipe') continue;
        const slug = slugify(obj.source_id || '');
        const entry = bySlug.get(slug);
        if (!entry) continue;
        const big9 = normalizeToBig9(obj.allergen_tag || '');
        if (big9 && !entry.allergens.includes(big9)) {
          entry.allergens.push(big9);
        }
      }
    }
  }

  // Normalize all allergen tags to Big 9 and infer from ingredients
  for (const [slug, recipe] of bySlug) {
    // Normalize existing tags
    const normalized = new Set();
    for (const tag of recipe.allergens || []) {
      const big9 = normalizeToBig9(tag);
      if (big9) normalized.add(big9);
    }

    // Infer from ingredients
    for (const ing of recipe.ingredients || []) {
      const inferred = inferAllergens(ing.item || '');
      for (const a of inferred) normalized.add(a);
    }

    recipe.direct_allergens = [...normalized].sort();
    recipe.allergens = recipe.direct_allergens.slice();
  }

  rollupAllergensThroughSubRecipes(bySlug);

  const recipes = [...bySlug.values()];
  console.log(`    Total recipes: ${recipes.length}`);
  return recipes;
}

// ---------------------------------------------------------------------------
// Cascade sub-recipe allergens up to every parent. After this pass,
// `recipe.allergens` is the full set (direct + sub-recipe transitive union),
// and `recipe.direct_allergens` keeps the pre-rollup set for auditing.
//
// A customer asking "is queso dairy-free?" must get an answer that accounts
// for blackened_tomato_salsa's Worcestershire → fish/gluten. This pass is
// the structural fix for that class of food-safety bug.
// ---------------------------------------------------------------------------
function rollupAllergensThroughSubRecipes(bySlug) {
  const fullAllergens = new Map(); // slug -> Set<string>
  const visiting = new Set();

  function resolve(slug, stack) {
    if (fullAllergens.has(slug)) return fullAllergens.get(slug);
    if (visiting.has(slug)) {
      const cycle = [...stack.slice(stack.indexOf(slug)), slug].join(' -> ');
      console.warn(`  WARN allergen rollup: sub-recipe cycle detected (${cycle}); breaking.`);
      // Break the cycle: this node contributes only its direct allergens.
      return new Set();
    }
    const recipe = bySlug.get(slug);
    if (!recipe) return new Set();

    visiting.add(slug);
    const acc = new Set(recipe.direct_allergens || recipe.allergens || []);
    for (const childSlug of recipe.sub_recipes || []) {
      const child = bySlug.get(childSlug);
      if (!child) {
        console.warn(
          `  WARN allergen rollup: ${slug} declares sub-recipe "${childSlug}" which is not in the manifest; skipping.`
        );
        continue;
      }
      for (const a of resolve(childSlug, [...stack, slug])) acc.add(a);
    }
    visiting.delete(slug);
    fullAllergens.set(slug, acc);
    return acc;
  }

  for (const slug of bySlug.keys()) resolve(slug, []);

  for (const [slug, recipe] of bySlug) {
    const full = fullAllergens.get(slug) || new Set(recipe.allergens || []);
    recipe.allergens = [...full].sort();
  }
}

// ---------------------------------------------------------------------------
// 2. Build allergen matrix (keyed by recipe slug)
// ---------------------------------------------------------------------------
function buildAllergenMatrix(recipes) {
  console.log('  Building allergen matrix...');
  const matrix = {};

  // First try allergen_matrix.csv if present
  const matrixCSV = tryRead('allergens/allergen_matrix.csv');
  if (matrixCSV) {
    const rows = parseCSV(matrixCSV);
    if (rows.length > 1) {
      const header = rows[0];
      for (let i = 1; i < rows.length; i++) {
        const obj = {};
        header.forEach((h, idx) => { obj[h.trim()] = (rows[i][idx] || '').trim(); });
        const recipeId = obj.recipe_id || '';
        if (!recipeId) continue;
        if (!matrix[recipeId]) matrix[recipeId] = [];
        const big9 = [];
        for (const tag of ['milk', 'eggs', 'fish', 'shellfish', 'tree_nuts', 'peanuts', 'wheat', 'soybeans', 'sesame']) {
          if (obj[tag] && obj[tag].toUpperCase() === 'X') big9.push(tag);
        }
        matrix[recipeId].push({
          ingredient: obj.ingredient || '',
          big9,
          notes: obj.notes || '',
        });
      }
    }
  }

  // Build from recipes (ingredient-level allergen inference)
  for (const recipe of recipes) {
    const key = recipe.slug;
    if (matrix[key]) continue; // already from CSV

    const entries = [];
    for (const ing of recipe.ingredients || []) {
      const name = ing.item || '';
      if (!name || name.startsWith('Yield') || name.startsWith('Notes')) continue;
      const big9 = inferAllergens(name);
      entries.push({
        ingredient: name,
        big9,
        notes: '',
      });
    }
    if (entries.length > 0) {
      matrix[key] = entries;
    }
  }

  console.log(`    Allergen matrix entries: ${Object.keys(matrix).length}`);
  return matrix;
}

// ---------------------------------------------------------------------------
// 3. Build menu
// ---------------------------------------------------------------------------
function buildMenu() {
  console.log('  Building menu...');
  const items = [];

  // Try the canonical path first
  let menuCSV = tryRead('menus/lariat_winter_menu.csv');

  // Fall back to export
  if (!menuCSV) {
    menuCSV = tryRead('dev/exports/2026-04-01/Menu - Winter.csv');
  }

  if (menuCSV) {
    const rows = parseCSV(menuCSV);
    let currentCategory = '';

    for (const row of rows) {
      // Skip the numeric header row (0,1,2,3)
      if (row[0] === '0' || row[0] === 'Section') continue;

      // Empty row = section break
      if (!row[0] && !row[1] && !row[2]) continue;

      // Category header (only col 0 populated, no item in col 1)
      if (row[0] && !row[1]) {
        currentCategory = row[0].trim();
        continue;
      }

      // Actual menu item: Section, Item, Description, Price
      if (row[0] && row[1]) {
        const category = row[0].trim() || currentCategory;
        const displayName = row[1].trim();
        const description = (row[2] || '').trim();

        if (!displayName || displayName === 'Item') continue;

        // Parse dietary from description (GF, VE, etc.)
        const dietaryMatch = description.match(/\(([^)]*(?:GF|VE|DF|V)[^)]*)\)/);
        const dietary = dietaryMatch ? dietaryMatch[1].trim() : '';

        items.push({
          display_name: displayName,
          category: category.replace(/\s*\(\$\d+\)/, ''), // strip price suffix like ($6)
          description,
          station_primary: inferStation(category),
          station_secondary: '',
          dietary: dietary || '',
          active: true,
          menu_item_id: slugify(displayName),
        });
      }
    }
  }

  // Try toast_recipe_map for menu_item_id enrichment
  const toastMap = tryRead('menus/toast_recipe_map.csv');
  if (toastMap) {
    console.log('    Found menus/toast_recipe_map.csv');
  }

  console.log(`    Menu items: ${items.length}`);
  return items;
}

function inferStation(category) {
  const c = category.toUpperCase();
  if (c.includes('SOUP') || c.includes('SALAD')) return 'garde';
  if (c.includes('SHARE')) return 'fry';
  if (c.includes('MAIN')) return 'grill';
  if (c.includes('SIDE')) return 'fry';
  if (c.includes('DESSERT')) return 'pastry';
  return '';
}

// ---------------------------------------------------------------------------
// 4. Build food safety
// ---------------------------------------------------------------------------
function buildFoodSafety() {
  console.log('  Building food safety...');

  // HACCP Checklist — try canonical path, then generate standard template
  let ccps = [];
  const haccpCSV = tryRead('food_safety/haccp_checklist_template.csv');
  if (haccpCSV) {
    console.log('    Found food_safety/haccp_checklist_template.csv');
    const rows = parseCSV(haccpCSV);
    if (rows.length > 1) {
      const header = rows[0];
      for (let i = 1; i < rows.length; i++) {
        const obj = {};
        header.forEach((h, idx) => { obj[h.trim()] = (rows[i][idx] || '').trim(); });
        ccps.push(obj);
      }
    }
  }

  // If no CSV, use standard restaurant HACCP CCPs
  if (ccps.length === 0) {
    console.warn('    ⚠️  WARNING: food_safety/haccp_checklist_template.csv not found — using GENERIC HACCP defaults.');
    console.warn('       These are standard restaurant CCPs, NOT reviewed for The Lariat. Review and replace ASAP.');
    ccps = generateStandardCCPs();
  }

  // Temp monitoring
  let tempMonitoring = [];
  const tempCSV = tryRead('food_safety/daily_temp_log_template.csv');
  if (tempCSV) {
    console.log('    Found food_safety/daily_temp_log_template.csv');
    const rows = parseCSV(tempCSV);
    if (rows.length > 1) {
      const header = rows[0];
      for (let i = 1; i < rows.length; i++) {
        const obj = {};
        header.forEach((h, idx) => { obj[h.trim()] = (rows[i][idx] || '').trim(); });
        tempMonitoring.push(obj);
      }
    }
  }

  // If no CSV, use standard temp monitoring points
  if (tempMonitoring.length === 0) {
    console.warn('    ⚠️  WARNING: food_safety/daily_temp_log_template.csv not found — using GENERIC temp points.');
    console.warn('       These are standard monitoring locations. Verify they match your actual equipment.');
    tempMonitoring = generateStandardTempPoints();
  }

  console.log(`    CCPs: ${ccps.length}, Temp points: ${tempMonitoring.length}`);
  return { ccps, temp_monitoring: tempMonitoring };
}

function generateStandardCCPs() {
  return [
    {
      ccp_id: 'CCP-1',
      critical_control_point: 'Receiving — Cold Deliveries',
      hazard: 'Biological — pathogen growth from temperature abuse',
      critical_limit: 'Refrigerated items <= 41F; Frozen items solid/frozen',
      monitoring_procedure: 'Check temperature of delivery items with calibrated thermometer',
      corrective_action: 'Reject items above 41F or with signs of thawing',
    },
    {
      ccp_id: 'CCP-2',
      critical_control_point: 'Cold Storage — Walk-in Refrigerator',
      hazard: 'Biological — pathogen growth',
      critical_limit: 'Maintain 35-41F at all times',
      monitoring_procedure: 'Check and log walk-in temp every 4 hours',
      corrective_action: 'Move product to functioning unit; discard if >41F for >4 hrs',
    },
    {
      ccp_id: 'CCP-3',
      critical_control_point: 'Cold Storage — Walk-in Freezer',
      hazard: 'Biological — quality loss, pathogen survival',
      critical_limit: 'Maintain 0F or below',
      monitoring_procedure: 'Check and log freezer temp every 4 hours',
      corrective_action: 'Evaluate product; discard if thawed and refrozen',
    },
    {
      ccp_id: 'CCP-4',
      critical_control_point: 'Cooking — Poultry (chicken, turkey)',
      hazard: 'Biological — Salmonella, Campylobacter survival',
      critical_limit: 'Internal temperature >= 165F for 15 seconds',
      monitoring_procedure: 'Check internal temp of each batch with probe thermometer',
      corrective_action: 'Continue cooking until 165F is reached',
    },
    {
      ccp_id: 'CCP-5',
      critical_control_point: 'Cooking — Ground Meats',
      hazard: 'Biological — E. coli O157:H7',
      critical_limit: 'Internal temperature >= 155F for 17 seconds',
      monitoring_procedure: 'Check internal temp of each batch with probe thermometer',
      corrective_action: 'Continue cooking until 155F is reached',
    },
    {
      ccp_id: 'CCP-6',
      critical_control_point: 'Cooking — Whole Muscle Meats (pork chops, steaks)',
      hazard: 'Biological — Salmonella, parasites',
      critical_limit: 'Internal temperature >= 145F for 15 seconds',
      monitoring_procedure: 'Check internal temp with probe thermometer',
      corrective_action: 'Continue cooking until 145F is reached',
    },
    {
      ccp_id: 'CCP-7',
      critical_control_point: 'Cooking — Fish and Seafood',
      hazard: 'Biological — parasites, Vibrio',
      critical_limit: 'Internal temperature >= 145F for 15 seconds',
      monitoring_procedure: 'Check internal temp with probe thermometer',
      corrective_action: 'Continue cooking until 145F is reached',
    },
    {
      ccp_id: 'CCP-8',
      critical_control_point: 'Hot Holding',
      hazard: 'Biological — pathogen growth in temperature danger zone',
      critical_limit: 'Maintain >= 135F',
      monitoring_procedure: 'Check temps every 2 hours during service',
      corrective_action: 'Reheat to 165F within 2 hours or discard',
    },
    {
      ccp_id: 'CCP-9',
      critical_control_point: 'Cooling',
      hazard: 'Biological — Clostridium perfringens, B. cereus growth',
      critical_limit: '135F to 70F within 2 hours; 70F to 41F within 4 more hours',
      monitoring_procedure: 'Log temp at start, 2-hour mark, and 6-hour mark',
      corrective_action: 'If not 70F by 2 hrs, reheat to 165F and restart cooling',
    },
    {
      ccp_id: 'CCP-10',
      critical_control_point: 'Reheating',
      hazard: 'Biological — pathogen survival during inadequate reheat',
      critical_limit: 'Reheat to >= 165F within 2 hours',
      monitoring_procedure: 'Check internal temp before serving reheated items',
      corrective_action: 'Continue heating or discard if 2-hour window exceeded',
    },
  ];
}

function generateStandardTempPoints() {
  return [
    { location: 'Walk-in Cooler', equipment: 'Main Walk-in', target_min_f: 35, target_max_f: 41 },
    { location: 'Walk-in Freezer', equipment: 'Main Freezer', target_min_f: -10, target_max_f: 0 },
    { location: 'Prep Cooler', equipment: 'Lowboy — Grill Station', target_min_f: 35, target_max_f: 41 },
    { location: 'Prep Cooler', equipment: 'Lowboy — Fry Station', target_min_f: 35, target_max_f: 41 },
    { location: 'Prep Cooler', equipment: 'Lowboy — Garde Station', target_min_f: 35, target_max_f: 41 },
    { location: 'Hot Hold', equipment: 'Steam Table', target_min_f: 135, target_max_f: 180 },
    { location: 'Dishwash', equipment: 'Sanitizer Rinse', target_min_f: 180, target_max_f: 200 },
    { location: 'Bar', equipment: 'Bar Cooler', target_min_f: 35, target_max_f: 41 },
  ];
}

// ---------------------------------------------------------------------------
// 5. Build vendor summary
// ---------------------------------------------------------------------------
function buildVendorSummary() {
  console.log('  Building vendor summary...');

  const catalog = [];
  const recentItems = [];
  let lastInvoiceDate = '';

  // Sysco Purchase History (catalog)
  // Try canonical path first, then exports, then originals
  let syscoPH = tryRead('data/csv/sysco_purchase_history.csv');
  if (!syscoPH) syscoPH = tryRead('dev/exports/2026-04-01/sysco - Sysco Purchase History.csv');
  if (!syscoPH) syscoPH = tryRead('data/originals/sysco/Sysco Purchase History.csv');

  if (syscoPH) {
    const rows = parseCSV(syscoPH);
    // Find F (header) row and P (data) rows
    let headerRow = null;
    for (const row of rows) {
      if (row[0] === 'F') {
        headerRow = row;
        break;
      }
    }
    if (headerRow) {
      for (const row of rows) {
        if (row[0] !== 'P') continue;
        const item = {
          supc: row[1] || '',
          pack: row[7] || '',
          size: row[8] || '',
          unit: row[9] || '',
          brand: row[10] || '',
          description: row[12] || '',
          category: row[13] || '',
          case_price: parseFloat(row[14]) || null,
          stock_status: row[23] || '',
        };
        catalog.push(item);
      }
    }
  }

  // Sysco Invoices (recent items)
  let syscoInv = tryRead('data/csv/2026-03-19_sysco_export_details.csv');
  if (!syscoInv) syscoInv = tryRead('dev/exports/2026-04-01/Sysco Invoices _Feb-Mar 2026_.csv');

  if (syscoInv) {
    const rows = parseCSV(syscoInv);
    // Skip numeric header row, then real header
    let header = null;
    for (const row of rows) {
      const first = row[0];
      if (first === 'Invoice #' || first === 'Transaction Date') {
        header = row;
        continue;
      }
      if (first === '0') continue; // numeric header
      if (header && first) {
        const obj = {};
        header.forEach((h, idx) => { obj[h.trim()] = (row[idx] || '').trim(); });
        recentItems.push({
          invoice: obj['Invoice #'] || obj['Transaction Date'] || '',
          delivery_date: obj['Delivery Date'] || obj['Transaction Date'] || '',
          description: obj['Item Description'] || obj['Description'] || '',
          qty: parseInt(obj['Qty']) || 0,
          category: obj['Category'] || '',
        });
        // Track last invoice date
        const date = obj['Delivery Date'] || obj['Transaction Date'] || '';
        if (date && (!lastInvoiceDate || date > lastInvoiceDate)) {
          lastInvoiceDate = date;
        }
      }
    }
  }

  console.log(`    Catalog items: ${catalog.length}, Recent items: ${recentItems.length}`);

  // WebstaurantStore — vendor total only (no line-item export available)
  const webstaurant = buildWebstaurantSummary();

  return {
    sysco: {
      recent_items: recentItems,
      catalog,
      last_invoice_date: lastInvoiceDate || null,
    },
    ...(webstaurant ? { webstaurantstore: webstaurant } : {}),
  };
}

function buildWebstaurantSummary() {
  // Latest total_spend_*.csv file from data/originals/webstaurantstore/
  const dir = path.join(ROOT, 'data/originals/webstaurantstore');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /^total_spend_\d{4}-\d{2}-\d{2}\.csv$/.test(f)).sort().reverse();
  if (files.length === 0) return null;
  const latest = files[0];
  const text = fs.readFileSync(path.join(dir, latest), 'utf-8');
  const rows = parseCSV(text);
  // Header row 0 has "Grand Total:" in col 2 and the dollar amount in col 3.
  // Data row 2 has TotalSpendFormat col 0, ShippingAddress col 1.
  let grandTotal = null;
  let address = null;
  for (const row of rows) {
    if (row[2] === 'Grand Total: ' || row[2] === 'Grand Total:') {
      const raw = (row[3] || '').replace(/[$,]/g, '');
      grandTotal = parseFloat(raw) || null;
    }
    if (row[0] && row[0].startsWith('$') && row[1] && row[1].includes(',')) {
      address = row[1];
    }
  }
  if (grandTotal == null) return null;
  const asOf = latest.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || null;
  console.log(`    WebstaurantStore total: $${grandTotal.toLocaleString()} (as of ${asOf})`);
  return {
    total_spend: grandTotal,
    shipping_address: address,
    as_of: asOf,
    source_file: latest,
    line_items_available: false,
  };
}

// ---------------------------------------------------------------------------
// 6. Build labor summary (optional — from 7shifts exports)
// ---------------------------------------------------------------------------
function findLatestExportDir() {
  const exportsDir = path.join(ROOT, 'dev', 'exports');
  if (!fs.existsSync(exportsDir)) return null;
  const dirs = fs.readdirSync(exportsDir)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();
  return dirs.length > 0 ? path.join(exportsDir, dirs[0]) : null;
}

function findLaborCSV(dir, prefix) {
  if (!dir) return null;
  const match = fs.readdirSync(dir).find(f => f.startsWith(prefix) && f.endsWith('.csv'));
  return match ? tryRead(path.relative(ROOT, path.join(dir, match))) : null;
}

function buildLaborSummary() {
  console.log('  Building labor summary...');

  const exportDir = findLatestExportDir();
  if (!exportDir) {
    console.log('    No export directories found — skipping');
    return null;
  }
  console.log(`    Using exports from: ${path.basename(exportDir)}`);

  const summaryCSV = findLaborCSV(exportDir, 'Labor - Summary');
  const byJobCSV = findLaborCSV(exportDir, 'Labor - By Job Title');
  const byEmployeeCSV = findLaborCSV(exportDir, 'Labor - By Employee');

  if (!summaryCSV && !byJobCSV && !byEmployeeCSV) {
    console.log('    No labor CSV files found — skipping');
    return null;
  }

  const result = {
    period: path.basename(exportDir),
    net_sales: 0,
    gross_sales: 0,
    labor_cost: 0,
    labor_pct_net: 0,
    labor_pct_gross: 0,
    splh_net: 0,
    splh_gross: 0,
    by_role: [],
    by_employee: [],
  };

  if (summaryCSV) {
    const rows = parseCSV(summaryCSV);
    for (const row of rows) {
      if (row[0] === '0' || row[0] === 'Metric') continue;
      const metric = row[0]?.trim();
      const value = row[1]?.trim();
      if (!metric || !value) continue;
      const num = parseFloat(value);
      switch (metric) {
        case 'Net Sales': result.net_sales = num; break;
        case 'Gross Sales': result.gross_sales = num; break;
        case 'Labor Cost': result.labor_cost = num; break;
        case 'Labor % (Net)': result.labor_pct_net = num; break;
        case 'Labor % (Gross)': result.labor_pct_gross = num; break;
        case 'SPLH (Net)': result.splh_net = num; break;
        case 'SPLH (Gross)': result.splh_gross = num; break;
      }
    }
  }

  if (byJobCSV) {
    const rows = parseCSV(byJobCSV);
    for (const row of rows) {
      if (row[0] === '0' || row[0] === 'Job Title') continue;
      if (!row[0]?.trim()) continue;
      result.by_role.push({
        job_title: row[0].trim(),
        regular_hours: parseFloat(row[1]) || 0,
        ot_hours: parseFloat(row[2]) || 0,
        total_hours: parseFloat(row[3]) || 0,
        regular_cost: parseFloat(row[4]) || 0,
        ot_cost: parseFloat(row[5]) || 0,
        total_cost: parseFloat(row[6]) || 0,
        labor_pct_net: parseFloat(row[7]) || 0,
        labor_pct_gross: parseFloat(row[8]) || 0,
      });
    }
  }

  if (byEmployeeCSV) {
    const rows = parseCSV(byEmployeeCSV);
    for (const row of rows) {
      if (row[0] === '0' || row[0] === 'Last Name') continue;
      if (!row[0]?.trim()) continue;
      result.by_employee.push({
        last_name: row[0].trim(),
        first_name: (row[1] || '').trim(),
        job_title: (row[2] || '').trim(),
        regular_hours: parseFloat(row[3]) || 0,
        ot_hours: parseFloat(row[4]) || 0,
        total_hours: parseFloat(row[5]) || 0,
        regular_cost: parseFloat(row[6]) || 0,
        ot_cost: parseFloat(row[7]) || 0,
        total_cost: parseFloat(row[8]) || 0,
        labor_pct_net: parseFloat(row[9]) || 0,
      });
    }
  }

  console.log(`    Net sales: $${result.net_sales.toLocaleString()}, Roles: ${result.by_role.length}, Employees: ${result.by_employee.length}`);
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  console.log('Rebuilding enriched cache...');
  console.log(`  Root: ${ROOT}`);
  console.log(`  Cache: ${CACHE}`);

  fs.mkdirSync(CACHE, { recursive: true });

  // 1. Recipes
  const recipes = buildRecipes();
  fs.writeFileSync(
    path.join(CACHE, 'recipes.json'),
    JSON.stringify(recipes, null, 2)
  );
  console.log(`  Wrote recipes.json (${recipes.length} recipes)`);

  // 2. Allergen matrix
  const allergenMatrix = buildAllergenMatrix(recipes);
  fs.writeFileSync(
    path.join(CACHE, 'allergen_matrix.json'),
    JSON.stringify(allergenMatrix, null, 2)
  );
  console.log(`  Wrote allergen_matrix.json (${Object.keys(allergenMatrix).length} entries)`);

  // 3. Menu
  const menu = buildMenu();
  fs.writeFileSync(
    path.join(CACHE, 'menu.json'),
    JSON.stringify(menu, null, 2)
  );
  console.log(`  Wrote menu.json (${menu.length} items)`);

  // 4. Food safety
  const foodSafety = buildFoodSafety();
  fs.writeFileSync(
    path.join(CACHE, 'food_safety.json'),
    JSON.stringify(foodSafety, null, 2)
  );
  console.log(`  Wrote food_safety.json (${foodSafety.ccps.length} CCPs, ${foodSafety.temp_monitoring.length} temp points)`);

  // 5. Vendor summary
  const vendorSummary = buildVendorSummary();
  fs.writeFileSync(
    path.join(CACHE, 'vendor_summary.json'),
    JSON.stringify(vendorSummary, null, 2)
  );
  console.log(`  Wrote vendor_summary.json`);

  // 6. Labor summary (conditional)
  const laborSummary = buildLaborSummary();
  if (laborSummary) {
    fs.writeFileSync(
      path.join(CACHE, 'labor_summary.json'),
      JSON.stringify(laborSummary, null, 2)
    );
    console.log(`  Wrote labor_summary.json`);
  }

  console.log('Done.');
}

const isMain = (() => {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return import.meta.url === new URL(`file://${path.resolve(arg)}`).href;
  } catch {
    return false;
  }
})();

if (isMain) main();
