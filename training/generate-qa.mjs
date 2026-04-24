#!/usr/bin/env node
/**
 * generate-qa.mjs
 *
 * Reads data/cache/*.json and produces JSONL training pairs for the
 * Lariat kitchen assistant.  Output: training/lariat-qa.jsonl
 *
 * Usage:
 *   node training/generate-qa.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(ROOT, 'data', 'cache');
const OUT = join(__dirname, 'lariat-qa.jsonl');

/* ---------- helpers ---------- */

function load(name) {
  try {
    return JSON.parse(readFileSync(join(CACHE, name), 'utf-8'));
  } catch {
    console.warn(`  [skip] ${name} not found or invalid`);
    return null;
  }
}

function pair(user, assistant) {
  return JSON.stringify({
    messages: [
      { role: 'user', content: user },
      { role: 'assistant', content: assistant },
    ],
  });
}

function fmtIngredients(ingredients) {
  return ingredients
    .map((i) => `- ${i.qty} ${i.unit} ${i.item}`)
    .join('\n');
}

/* ---------- load data ---------- */

const recipes = load('recipes.json') || [];
const allergenMatrix = load('allergen_matrix.json') || {};
const menu = load('menu.json') || [];
const foodSafety = load('food_safety.json') || {};
const ccps = foodSafety.ccps || [];
const setups = load('setups.json') || {};
const stations = load('stations.json') || [];
const lineChecks = load('line_checks.json') || {};

const lines = [];

/* ---------- 1. Ingredient questions ---------- */

for (const r of recipes) {
  if (!r.ingredients?.length) continue;

  const ingList = fmtIngredients(r.ingredients);
  const yieldStr =
    r.yield_qty && r.yield_unit
      ? `\n\nYield: ${r.yield_qty} ${r.yield_unit}`
      : '';
  const stationStr = r.station ? `\nStation: ${r.station}` : '';

  lines.push(
    pair(
      `What are the ingredients in ${r.name}?`,
      `**${r.name}** ingredients:\n${ingList}${yieldStr}${stationStr}`
    )
  );
}

/* ---------- 2. Allergen questions ---------- */

for (const r of recipes) {
  if (!r.allergens?.length) continue;

  const tags = r.allergens.join(', ');

  // Try to pull ingredient-level detail from the allergen matrix
  let detail = '';
  const matrixKey = Object.keys(allergenMatrix).find(
    (k) =>
      k === r.slug ||
      k.replace(/_\d+$/, '') === r.slug ||
      r.slug?.startsWith(k.replace(/_\d+$/, ''))
  );
  if (matrixKey) {
    const entries = allergenMatrix[matrixKey].filter(
      (e) => e.big9?.length > 0
    );
    if (entries.length) {
      detail =
        '\n\nIngredient-level detail:\n' +
        entries
          .map((e) => `- ${e.ingredient} -> ${e.big9.join(', ')}`)
          .join('\n');
    }
  }

  lines.push(
    pair(
      `Does ${r.name} contain allergens?`,
      `**${r.name}** allergen tags: ${tags}.${detail}\n\nCross-contact is always possible in a shared kitchen. For any guest allergy concern, escalate to a manager.`
    )
  );
}

/* ---------- 3. Sub-recipe questions ---------- */

for (const r of recipes) {
  if (!r.sub_recipes?.length) continue;

  const subList = r.sub_recipes.map((s) => `- ${s.replace(/_/g, ' ')}`).join('\n');
  const stationStr = r.station ? `\nStation: ${r.station}` : '';

  lines.push(
    pair(
      `What sub-recipes go into ${r.name}?`,
      `**${r.name}** uses these sub-recipes:\n${subList}${stationStr}`
    )
  );
}

/* ---------- 4. Procedure questions ---------- */

for (const r of recipes) {
  if (!r.procedure?.length) continue;

  // Some recipes store procedure as a single free-text string rather than an
  // array of numbered steps. Coerce both shapes into a newline-joined string.
  const steps = Array.isArray(r.procedure) ? r.procedure.join('\n') : String(r.procedure);
  const stationStr = r.station ? `\nStation: ${r.station}` : '';

  lines.push(
    pair(
      `How do I make ${r.name}?`,
      `**${r.name}** procedure:\n${steps}${stationStr}`
    )
  );
}

/* ---------- 5. Menu-item-to-recipe questions ---------- */

// Build a map: menu item display name -> recipes that reference it
const menuRecipeMap = new Map();
for (const r of recipes) {
  if (!r.menu_items?.length) continue;
  for (const mi of r.menu_items) {
    const key = mi.toLowerCase().trim();
    if (key === 'multiple' || key === '') continue;
    if (!menuRecipeMap.has(key)) menuRecipeMap.set(key, []);
    menuRecipeMap.get(key).push(r);
  }
}

for (const [menuItem, linkedRecipes] of menuRecipeMap) {
  // Format a nice answer
  const recipeLines = linkedRecipes
    .map((r) => {
      const parts = [`- **${r.name}**`];
      if (r.station) parts[0] += ` (station: ${r.station})`;
      if (r.allergens?.length)
        parts.push(`  Allergens: ${r.allergens.join(', ')}`);
      if (r.sub_recipes?.length)
        parts.push(
          `  Sub-recipes: ${r.sub_recipes.map((s) => s.replace(/_/g, ' ')).join(', ')}`
        );
      return parts.join('\n');
    })
    .join('\n');

  // Title-case the menu item
  const displayName = menuItem.replace(/\b\w/g, (c) => c.toUpperCase());

  lines.push(
    pair(
      `What goes into ${displayName}?`,
      `**${displayName}** is made from these recipes:\n${recipeLines}\n\nFor allergen concerns, cross-contact is always possible — escalate to a manager.`
    )
  );
}

/* ---------- 6. HACCP / food safety questions ---------- */

for (const ccp of ccps) {
  const answer = [
    `**${ccp.ccp_id}: ${ccp.critical_control_point}**`,
    `- Hazard: ${ccp.hazard}`,
    `- Critical limit: ${ccp.critical_limit}`,
    `- Monitoring: ${ccp.monitoring_procedure}`,
    `- Corrective action: ${ccp.corrective_action}`,
  ].join('\n');

  lines.push(
    pair(
      `What's the food safety rule for ${ccp.critical_control_point.toLowerCase()}?`,
      answer
    )
  );
}

/* ---------- 7. Refusal examples ---------- */

lines.push(
  pair(
    'What were last night\'s sales numbers?',
    'I don\'t have access to POS or sales data. That information isn\'t available in the Cockpit. Check Toast reports or ask a manager for last night\'s sales.'
  )
);

lines.push(
  pair(
    'Is the Caesar salad safe for someone with a fish allergy?',
    'I cannot say any dish is "safe" for an allergy. The Caesar Salad recipe data shows **fish** as an allergen tag (likely from anchovy in the dressing). Cross-contact is always possible in our kitchen. Please escalate this to a manager before serving to the guest.'
  )
);

lines.push(
  pair(
    'How many guests did we serve last Friday?',
    'I don\'t have access to guest count or cover data. That information isn\'t tracked in the Cockpit. Check Toast analytics or ask a manager for cover counts.'
  )
);

/* ---------- 8. Setup questions ---------- */

for (const [tabName, tasks] of Object.entries(setups)) {
  const steps = tasks.map((t) => `- ${t}`).join('\n');
  lines.push(
    pair(
      `How do I set up the ${tabName}?`,
      `**${tabName} Setup**:\n${steps}`
    )
  );
  
  // Alternative question format
  const shortName = tabName.split('-').pop().trim();
  lines.push(
    pair(
      `What is the setup procedure for ${shortName}?`,
      `**${tabName} Setup**:\n${steps}`
    )
  );
}

/* ---------- 9. Line check questions ---------- */

for (const station of stations) {
  if (!station.line_check_key || !lineChecks[station.line_check_key]) continue;
  
  const items = lineChecks[station.line_check_key];
  const itemList = items.map((i) => `- ${i}`).join('\n');
  
  lines.push(
    pair(
      `What goes on the ${station.name} line check?`,
      `The **${station.name}** line check requires the following items:\n${itemList}`
    )
  );
  
  lines.push(
    pair(
      `List the prep items needed for ${station.name}.`,
      `The **${station.name}** line check requires the following items:\n${itemList}`
    )
  );
}

/* ---------- write output ---------- */

writeFileSync(OUT, lines.join('\n') + '\n', 'utf-8');

console.log(`Wrote ${lines.length} training pairs to ${OUT}`);
console.log(`  - Ingredient Qs:    ${recipes.filter((r) => r.ingredients?.length).length}`);
console.log(`  - Allergen Qs:      ${recipes.filter((r) => r.allergens?.length).length}`);
console.log(`  - Sub-recipe Qs:    ${recipes.filter((r) => r.sub_recipes?.length).length}`);
console.log(`  - Procedure Qs:     ${recipes.filter((r) => r.procedure?.length).length}`);
console.log(`  - Menu-item Qs:     ${menuRecipeMap.size}`);
console.log(`  - HACCP CCP Qs:     ${ccps.length}`);
console.log(`  - Station Setup Qs: ${Object.keys(setups).length * 2}`);
console.log(`  - Line Checks Qs:   ${stations.filter((s) => s.line_check_key).length * 2}`);
console.log(`  - Refusal examples: 3`);
