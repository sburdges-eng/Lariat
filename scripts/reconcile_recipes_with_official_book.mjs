#!/usr/bin/env node
// One-shot reconciliation of data/cache/recipes.json against the canonical
// normalized/ CSVs and the Lariat Recipe Book Official PDF (2026-04-18).
//
// - Merges noisy/duplicate slugs into their canonical twins, preserving
//   procedures where the canonical lacks one.
// - Adds procedures from the PDF for recipes missing them.
// - Seeds canonical entries for slugs present in recipe_index.csv but absent
//   from recipes.json.
// - Drops garbage entries.
//
// Run once, then `npm run rebuild-cache`.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RECIPES_JSON = path.join(ROOT, 'data/cache/recipes.json');

// Noise slug -> canonical slug. Procedure preferred from whichever side has one.
const MERGE_MAP = {
  corn_bread: 'cornbread',
  santa_fe_caesar_dressing: 'santa_fe_caesar',
  aji_verde_large_batch: 'aji_verde',
  grilled_three_cheese_sandwich: 'three_cheese_grilled_cheese',
  thai_chilli_sauce: 'thai_chili_sauce',
  thai_chili: 'thai_chili_sauce',
  corndog_batter_large_batch: 'corndog_batter',
  chip_aioli: 'chipotle_aioli',
  lariat_rub_large_batch: 'lariat_rub',
  green_chile_large_batch: 'green_chile',
  green_chilli: 'green_chile',
  q_b_seasoning: 'qb_seasoning',
  qb_recipe_birria: 'birria',
  birria_qb_recipe: 'birria',
  qb_recipe: 'birria',
  beer_batter_large_batch: 'beer_batter',
  mesa_melt_southwest_beer_cheese: 'mesa_melt',
  lemon_thyme_vinagrette: 'lemon_thyme_vinaigrette',
  cobb_dressing_herb_bleu_cheese: 'cobb_dressing',
  pork_chop_marinade_southwestern_rye: 'pork_chop_marinade',
  jalape_o_cheddar_cornbread: 'cornbread',
  coleslaw_dressing: 'coleslaw',
};

// Pure garbage — no canonical target, drop outright.
const DROP = new Set(['ingredients']);

// Procedures sourced directly from Lariat Recipe Book Official.pdf (2026-04-18).
// Stored as newline-joined strings so they match the app's existing shape.
const PROCEDURES = {
  tomato_soup: [
    'In a heavy pot or rondeau over medium heat, melt butter.',
    'Add onions and a pinch of salt; cook 8-10 minutes, stirring, until translucent and tender.',
    'Add garlic and cook 30 seconds more, just until fragrant.',
    'Add white wine and thyme sprigs.',
    'Simmer 5-6 minutes, reducing the wine by about one-third.',
    'Stir in stock.',
    'Simmer gently for 15-20 minutes.',
    'Stir in heavy cream; reduce heat to low. Season with salt and pepper.',
  ].join('\n'),

  mesa_melt: [
    '1. Prepare the Roux: In a medium saucepan, melt the butter over medium heat. Whisk in the flour and cook for 1-2 minutes, until lightly golden and aromatic.',
    '2. Incorporate Beer: Slowly pour in the beer while whisking continuously. Allow it to foam, then simmer for 1-2 minutes until slightly thickened.',
    '3. Add Milk: Whisk in the milk or half-and-half, stirring until smooth and gently thickened.',
    '4. Melt the Cheeses: Reduce heat to medium-low. Add cheddar, pepper jack, and cream cheese gradually, whisking until fully melted and smooth.',
    '5. Integrate Flavors: Stir in roasted Hatch chiles, chipotle, smoked paprika, cumin, garlic powder, onion powder, and salt. Mix thoroughly.',
    '6. Adjust Consistency: For a thinner sauce, add small increments of milk or beer. For thicker consistency, continue simmering gently.',
    '7. Hold Warm for Service: Keep over low heat or in a warm holding unit. Avoid boiling once cheese is added.',
  ].join('\n'),

  mexi_slaw: 'Combine ingredients.',

  miso_honey: 'Whisk miso, honey, and water together until smooth. PDF p37 source is ambiguous on line 2 ingredient name — honey inferred from recipe title. Verify in kitchen.',

  // Gap fillers for canonical slugs that had no procedure:
  beer_flour: 'Disperse vodka/stout mix into bowl. Incorporate equal parts flour gradually into bowl (DRY YOUR WET). Whisk until consistency is smooth and runs off whisk (no clumping/dripping).',

  qb_seasoning: 'Combine ingredients and mix.',

  thai_chili_sauce: 'Combine Mae Ploy, soy sauce, honey, furikake, and sriracha. Whisk until uniform.',

  three_cheese_grilled_cheese: [
    'Cream Cheese Spread: Combine cream cheese, Double Gloucester or cheddar, heavy cream, and salt in food processor. Blend until smooth. Set aside.',
    'Garlic Spread: Combine mayonnaise, garlic, and salt in a small bowl; stir until blended. Set aside.',
    'Lay out artisan bread slices on parchment paper or large cutting board.',
    'Place 2 slices of cheddar on 4 bread slices. Place 2 slices of provolone on the remaining bread slices.',
    'Equally spoon cream cheese spread on the provolone-side slices. Gently smooth over each slice.',
    'Press cheddar side and provolone side together.',
    'Heat a large skillet over medium heat for 5 minutes, until hot.',
    'Brush both sides of the sandwiches with garlic spread.',
    'Grill sandwiches for 2 minutes on each side, until cheese is melted and bread is golden brown.',
  ].join('\n'),
};

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

function hasProcedure(r) {
  const p = r && r.procedure;
  if (!p) return false;
  if (Array.isArray(p)) return p.length > 0;
  return String(p).trim().length > 0;
}

function main() {
  const recipes = loadJSON(RECIPES_JSON);
  const bySlug = new Map(recipes.map((r) => [r.slug, r]));

  let merged = 0, dropped = 0, seeded = 0, procAdded = 0;

  // 1. Merge noise -> canonical
  for (const [noise, canon] of Object.entries(MERGE_MAP)) {
    const n = bySlug.get(noise);
    if (!n) continue;
    const c = bySlug.get(canon);
    if (c) {
      if (!hasProcedure(c) && hasProcedure(n)) c.procedure = n.procedure;
      // Keep any menu_items / sub_recipes from either side
      const unionArr = (a, b) => [...new Set([...(a || []), ...(b || [])])];
      c.menu_items = unionArr(c.menu_items, n.menu_items);
      c.sub_recipes = unionArr(c.sub_recipes, n.sub_recipes);
    } else {
      // Canonical missing: promote the noisy record to canonical slug
      n.slug = canon;
      bySlug.set(canon, n);
      seeded++;
    }
    bySlug.delete(noise);
    merged++;
  }

  // 2. Drop garbage
  for (const slug of DROP) {
    if (bySlug.delete(slug)) dropped++;
  }

  // 3. Add procedures where missing / for new recipes
  for (const [slug, proc] of Object.entries(PROCEDURES)) {
    let r = bySlug.get(slug);
    if (!r) {
      // Seed a stub; rebuild-cache will fill ingredients from the CSV.
      r = { slug, name: slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), ingredients: [], allergens: [], source: 'official_book_2026-04-18' };
      bySlug.set(slug, r);
      seeded++;
    }
    if (!hasProcedure(r)) {
      r.procedure = proc;
      procAdded++;
    }
  }

  // 4. Sort by slug for diff-friendly output
  const out = [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  writeJSON(RECIPES_JSON, out);

  console.log(`Merged: ${merged}, Dropped: ${dropped}, Seeded: ${seeded}, Procedures added: ${procAdded}`);
  console.log(`Total recipes after reconcile: ${out.length}`);
}

main();
