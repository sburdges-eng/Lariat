#!/usr/bin/env node
// A buffet mapped only to its sauces is not a buffet.
//
// WHY THIS EXISTS
// ---------------
// `menus/beo_recipe_map.csv` maps a BEO line item to the recipes it consumes.
// For every taco buffet on the map it listed the brines, batters, aiolis and
// slaws and stopped there. `Fish Taco Buffet` mapped to fish brine, beer
// batter, beer flour, chipotle aioli, mexi slaw and pico de gallo — and to no
// fish. The three taco buffets mapped to no tortillas and no cotija. `Trio
// Dips` mapped to no chips. `Green Chile Mac Buffet` mapped to no pasta.
// Separately, `recipes/normalized/chicken_confit.csv` listed garlic, rosemary,
// thyme and EVOO but not the case of chicken legs the recipe book opens with,
// so even the mapped protein resolved to aromatics.
//
// Nothing failed. The cascade did exactly what it was told, and the order
// guide for a 150-cover buyout came back with 60 rows and no protein in any of
// them — a shop that orders from that sheet arrives on service day with slaw
// and no fish.
//
// So: every buffet line item must resolve to at least one real protein or
// starch. A sauce-only mapping fails here instead of failing on the line.
//
// The generic check alone is not enough — `Fish Taco Buffet` also draws AP
// flour from its beer flour, so it would pass the generic rule with no fish in
// it. The named-regression block below pins the specific items the bug report
// found missing.
//
// This walks the CSVs directly rather than driving the cascade engine: the
// defect was in the data, and a data gate should not need Python, a DB, or a
// running hub to say so.
//
// Run: node --experimental-strip-types --test tests/js/test-beo-buffet-protein-starch.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const INDEX_CSV = path.join(REPO_ROOT, 'recipes/recipe_index.csv');
const NORMALIZED_DIR = path.join(REPO_ROOT, 'recipes/normalized');
const MAP_CSV = path.join(REPO_ROOT, 'menus/beo_recipe_map.csv');

// ── What counts as a protein or a starch ─────────────────────────────────────
//
// Matched as a word prefix against the leaf ingredient name, so `tortilla`
// catches "tortilla chips" and `corn` catches "cornmeal" and "cornbread
// mixture" — but neither catches "peppercorn", where the word starts earlier.
//
// Deliberately NOT here: `chip` (it would match "chipotle aioli", making every
// aioli read as a starch), `butt` (it would match "butter"), `crumb` (it would
// match "bleu cheese crumbles") and `anchov` (a dressing's anchovy is not what
// anyone came to eat — a caesar mapped to dressing alone must still fail).
// "pork", "tortilla", "bread" and "panko" already cover the real lines.
const PROTEIN = [
  'chicken', 'beef', 'pork', 'bacon', 'ham', 'sausage', 'turkey', 'lamb',
  'elk', 'fish', 'pangasius', 'catfish', 'trout', 'salmon', 'shrimp', 'crab',
  'lobster', 'egg', 'cheek', 'tenderloin', 'brisket', 'prime rib', 'bean',
  'tofu',
];
const STARCH = [
  'tortilla', 'flour', 'pasta', 'cavatappi', 'campanelle', 'ziti', 'noodle',
  'rice', 'bread', 'bun', 'crouton', 'panko', 'cornmeal', 'corn', 'masa',
  'potato', 'oat', 'grits', 'polenta',
];
const NAMES_PROTEIN_OR_STARCH = new RegExp(`\\b(${[...PROTEIN, ...STARCH].join('|')})`, 'i');

// A stock, a brine, a juice or a thickener carries the word without carrying
// the food: "chicken base", "fish brine" and "cornstarch" are not a protein or
// a starch on the buffet, and a line item resting on one of them is still the
// sauce-only mapping this gate exists to catch.
const NOT_SUBSTANTIVE = /\b(base|stock|brine|juice|pickles?|cornstarch|crumbles)\b/i;

const isSubstantive = (leaf) => NAMES_PROTEIN_OR_STARCH.test(leaf) && !NOT_SUBSTANTIVE.test(leaf);

// What goes IN a taco. A protein, or a vegetarian centre substantial enough to
// be the reason someone ordered it — the Battered Avocado buffet's filling is
// avocado, which is neither a protein nor a starch. Kept separate from STARCH
// on purpose: widening STARCH to cover avocado would let a guacamole-only
// mapping pass the buffet rule above.
const VEGETARIAN_FILLING = ['avocado', 'mushroom', 'rellenos', 'jackfruit', 'paneer'];
const NAMES_A_FILLING = new RegExp(`\\b(${[...PROTEIN, ...VEGETARIAN_FILLING].join('|')})`, 'i');
const isFilling = (leaf) => NAMES_A_FILLING.test(leaf) && !NOT_SUBSTANTIVE.test(leaf);

// ── Which line items are held to the rule ────────────────────────────────────
//
// Anything sold as a buffet, plus the platter-format items that failed the
// same way. Keep additions justified: this is the list the gate protects, and
// an item quietly left off it is an item nobody is checking.
const EXTRA_PLATTER_ITEMS = new Set(['trio dips', 'elote salad']);
const isCheckedItem = (beoItem) =>
  /\bbuffet\b/i.test(beoItem) || EXTRA_PLATTER_ITEMS.has(beoItem.trim().toLowerCase());

// ── CSV + manifest ───────────────────────────────────────────────────────────

/** Minimal reader for these files: no quoted fields, no embedded newlines. */
function readCsv(file) {
  const [head, ...rest] = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '');
  const cols = head.split(',');
  return rest.map((line) => {
    // Only split on the first N-1 commas so a trailing notes field keeps its own.
    const parts = line.split(',');
    const row = {};
    cols.forEach((c, i) => {
      row[c] = i === cols.length - 1 ? parts.slice(i).join(',') : parts[i];
    });
    return row;
  });
}

const norm = (s) => (s ?? '').trim().toLowerCase();

/** slug → { displayName, subSlugs, bom: [{ ingredient, subSlug }] } */
function loadManifest() {
  const manifest = new Map();
  for (const row of readCsv(INDEX_CSV)) {
    const slug = (row.recipe_id ?? '').trim();
    if (!slug) continue;
    manifest.set(slug, {
      slug,
      displayName: (row.recipe_name ?? slug).trim(),
      subSlugs: (row.sub_recipes ?? '').split(';').map((s) => s.trim()).filter(Boolean),
      bom: [],
    });
  }

  for (const [slug, m] of manifest) {
    const file = path.join(NORMALIZED_DIR, `${slug}.csv`);
    if (!fs.existsSync(file)) continue;
    for (const row of readCsv(file)) {
      const ingredient = (row.ingredient ?? '').trim();
      if (!ingredient) continue;
      const notes = norm(row.notes);
      // Mirrors scripts/lib/bom_expand.py::_row_sub_slug — a pinned
      // `(sub-recipe=<slug>)` wins, else a row naming one of the parent's
      // declared sub-recipes resolves to it.
      const pin = notes.match(/\(sub-recipe=([a-z0-9_]+)\)/);
      let subSlug = pin ? pin[1] : null;
      if (!subSlug) {
        const tokens = norm(ingredient).replace(/_/g, ' ');
        subSlug =
          m.subSlugs.find((s) => {
            const child = manifest.get(s);
            return (
              tokens === s.replace(/_/g, ' ') ||
              (child != null && tokens === norm(child.displayName))
            );
          }) ?? null;
      }
      m.bom.push({ ingredient, subSlug });
    }
  }
  return manifest;
}

/** Leaf ingredient names under `slug`, walking sub-recipes. Cycle-guarded. */
function leavesOf(manifest, slug, seen = new Set()) {
  const out = new Set();
  if (seen.has(slug)) return out;
  const m = manifest.get(slug);
  if (!m) return out;
  const nextSeen = new Set(seen).add(slug);
  for (const row of m.bom) {
    if (row.subSlug && manifest.has(row.subSlug)) {
      for (const leaf of leavesOf(manifest, row.subSlug, nextSeen)) out.add(leaf);
    } else {
      out.add(row.ingredient);
    }
  }
  return out;
}

/**
 * beo_item → { slugs, leaves }. Mirrors
 * scripts/lib/beo_pull.py::load_beo_recipe_map: `recipe_id` in the map file is
 * a recipe DISPLAY NAME, resolved against the manifest.
 *
 * A mapping whose `per_count` is an explicit 0 contributes nothing at runtime
 * (`Green Chile Mac Buffet,Green Chilli,0`), so it is not evidence that the
 * item carries anything — it is skipped here for the same reason.
 */
function loadBeoItems(manifest) {
  const displayToSlug = new Map();
  for (const [slug, m] of manifest) {
    const key = norm(m.displayName);
    if (key && !displayToSlug.has(key)) displayToSlug.set(key, slug);
    const slugAsWords = slug.replace(/_/g, ' ');
    if (!displayToSlug.has(slugAsWords)) displayToSlug.set(slugAsWords, slug);
  }

  const items = new Map();
  const unresolved = [];
  for (const row of readCsv(MAP_CSV)) {
    const beoItem = (row.beo_item ?? '').trim();
    const recipeKey = (row.recipe_id ?? '').trim();
    if (!beoItem || !recipeKey) continue;

    const slug = displayToSlug.get(norm(recipeKey));
    if (!slug) {
      unresolved.push(`${beoItem} → ${recipeKey}`);
      continue;
    }
    const perCountRaw = (row.per_count ?? '').trim();
    const perCount = perCountRaw === '' ? null : Number(perCountRaw);

    if (!items.has(beoItem)) items.set(beoItem, { slugs: [], live: [], perCount: new Map() });
    const entry = items.get(beoItem);
    entry.slugs.push(slug);
    entry.perCount.set(slug, perCount);
    if (perCount !== 0) entry.live.push(slug);
  }

  for (const entry of items.values()) {
    entry.leaves = new Set();
    for (const slug of entry.live) {
      for (const leaf of leavesOf(manifest, slug)) entry.leaves.add(leaf);
    }
  }
  return { items, unresolved };
}

const manifest = loadManifest();
const { items, unresolved } = loadBeoItems(manifest);
const checked = [...items.entries()].filter(([beoItem]) => isCheckedItem(beoItem));

/** The leaves of `beoItem`, for an assertion message that shows its work. */
function report(beoItem) {
  const entry = items.get(beoItem);
  return (
    `${beoItem}\n` +
    `  recipes: ${entry.slugs.join(', ') || '(none)'}\n` +
    `  leaves:  ${[...entry.leaves].sort().join(', ') || '(none)'}`
  );
}

function assertCarries(beoItem, needle) {
  const entry = items.get(beoItem);
  assert.ok(entry, `${beoItem} has no row in menus/beo_recipe_map.csv`);
  assert.ok(
    [...entry.leaves].some((leaf) => leaf.toLowerCase().includes(needle)),
    `${beoItem} resolves to no ingredient containing "${needle}".\n${report(beoItem)}`,
  );
}

describe('beo_recipe_map — every buffet carries a protein or a starch', () => {
  it('resolves every recipe named in the map', () => {
    assert.deepEqual(
      unresolved,
      [],
      'menus/beo_recipe_map.csv names recipes that are not in recipes/recipe_index.csv',
    );
  });

  it('finds the buffet line items to check', () => {
    // Guards the guard: a rename or a bad parse that silently emptied this
    // list would make every assertion below vacuous.
    assert.ok(
      checked.length >= 9,
      `expected at least 9 buffet/platter line items, found ${checked.length}`,
    );
  });

  for (const [beoItem] of checked) {
    it(`${beoItem} resolves to a protein or a starch`, () => {
      const entry = items.get(beoItem);
      const substantive = [...entry.leaves].filter(isSubstantive);
      assert.ok(
        substantive.length > 0,
        `${beoItem} maps only to sauces, seasonings and garnishes — nobody eats it.\n` +
          `${report(beoItem)}\n` +
          '  Map it to the protein and the starch it is actually built from.',
      );
    });
  }
});

// A taco is a tortilla with something in it. This rule holds for every taco on
// the map, single or by the pan, so it needs no allowlist — which is what makes
// it worth gating: the map had eleven taco line items and eight of them
// resolved to no tortilla at all.
describe('beo_recipe_map — a taco needs a tortilla and a filling', () => {
  const tacoItems = [...items.keys()].filter((beoItem) => /taco/i.test(beoItem));

  it('finds every taco line item', () => {
    assert.ok(tacoItems.length >= 11, `expected 11+ taco line items, found ${tacoItems.length}`);
  });

  for (const beoItem of tacoItems) {
    it(`${beoItem} carries a tortilla`, () => assertCarries(beoItem, 'tortilla'));

    it(`${beoItem} carries a filling`, () => {
      // The tortilla is itself a starch, so the generic protein-or-starch rule
      // cannot tell a stocked taco from an empty one.
      const filling = [...items.get(beoItem).leaves].filter(isFilling);
      assert.ok(
        filling.length > 0,
        `${beoItem} is a tortilla and a sauce — there is nothing in it.\n${report(beoItem)}`,
      );
    });
  }

  it('corn on the BEO taco buffets, flour on the Baja plate', () => {
    // Two sources, deliberately different dishes — not a discrepancy.
    // docs/Lariat_BEO_Studio_5.html DATA.purchase puts "Tortilla Corn White 4.5
    // Inch" on every BEO taco; winter menu MI-M07 plates Baja on flour.
    for (const beoItem of ['Fish Taco Buffet', 'Battered Fish Taco', 'Barbacoa Taco']) {
      assertCarries(beoItem, 'corn tortillas');
    }
    for (const beoItem of ['Baja Fish Taco', 'Baja Fish Tacos']) {
      assertCarries(beoItem, 'flour tortillas');
    }
  });

  it('the tacos that go out with cotija carry it', () => {
    // Battered Avocado and Baja are deliberately absent. BEO Studio lists the
    // avocado buffet's allergens as "wheat, egg" with no milk, and MI-M07 does
    // not put cotija on the Baja plate.
    for (const beoItem of [
      'Fish Taco Buffet',
      'Battered Fish Taco',
      'Braised Chicken Taco Buffet',
      'Braised Chicken Taco',
      'Barbacoa Taco Buffet',
      'Barbacoa Taco',
      'Carnitas Tacos Buffet',
      'Carnitas taco',
    ]) {
      assertCarries(beoItem, 'cotija');
    }
  });
});

// The specific lines the 2026-09-02 order-guide bug lost. Most of these would
// still pass the generic rule without them — a fish taco buffet draws AP flour
// from its beer flour whether or not anyone ordered fish.
describe('beo_recipe_map — named regressions', () => {
  for (const [beoItem, needle] of [
    ['Fish Taco Buffet', 'pangasius'],
    ['Battered Fish Taco', 'pangasius'],
    ['Baja Fish Tacos', 'pangasius'],
    ['Braised Chicken Taco Buffet', 'chicken thigh'],
    ['Braised Chicken Taco', 'chicken thigh'],
    ['Barbacoa Taco Buffet', 'beef'],
    ['Carnitas Tacos Buffet', 'pork'],
    ['Battered Avocado Taco Buffet', 'avocado'],
    ['Trio Dips', 'tortilla chips'],
    ['Green Chile Mac Buffet', 'cavatappi'],
    ['Elote salad', 'corn'],
    // Winter menu MI-S03: bone-in pork shanks. The map had the Alabama white
    // and the Lariat rub and no pig in the pig wings.
    ['Pig Wings', 'pork shank'],
    // Winter menu MI-SA01 (The Rope Salad) names both of these; the buffet had
    // the dressing and the pepitas and nothing to put them on.
    ['Rope Caesar Salad Buffet', 'leaf lettuce'],
    ['Rope Caesar Salad Buffet', 'cornbread'],
    ['Rope Caesar Salad Buffet', 'cotija'],
    ['Rope Caesar Salad Buffet', 'black beans'],
    ['Cob Salad Buffet', 'bacon'],
    ['Cob Salad Buffet', 'hard boiled eggs'],
  ]) {
    it(`${beoItem} carries ${needle}`, () => assertCarries(beoItem, needle));
  }

  // The braised taco line is shredded thigh (DATA.purchase: "Chicken Thigh
  // Boneless Skinless Controlled Vac"). `chicken_confit` is the frenched-leg
  // confit for Roast Chicken Dinner. Mapping the tacos through the confit is
  // how the first pass at this bug ordered six cases of frenched legs for a
  // taco buffet — a costlier wrong answer than the missing protein it replaced.
  for (const beoItem of ['Braised Chicken Taco', 'Braised Chicken Taco Buffet']) {
    it(`${beoItem} does NOT pull the frenched-leg confit`, () => {
      const entry = items.get(beoItem);
      assert.ok(entry, `${beoItem} has no row in menus/beo_recipe_map.csv`);
      assert.ok(
        !entry.slugs.includes('chicken_confit'),
        `${beoItem} maps through chicken_confit — that is the frenched-leg ` +
          'confit for Roast Chicken Dinner, not the taco braise.\n' +
          report(beoItem),
      );
      assert.deepEqual(
        [...entry.leaves].filter((leaf) => /chicken legs/i.test(leaf)),
        [],
        `${beoItem} resolves to whole chicken legs.\n${report(beoItem)}`,
      );
    });
  }

  // The map bills these rows per plate, not per taco: their `Fish Fillet,0.025`
  // is 0.025 of a 15 lb case = 6 oz, exactly the plate BOM's catfish line. The
  // tortilla count on the same row has to come off the same plate.
  for (const beoItem of ['Baja Fish Tacos', 'Baja Fish Taco']) {
    it(`${beoItem} allocates the plate BOM's tortilla count`, () => {
      const plateRow = readCsv(path.join(NORMALIZED_DIR, 'baja_fish_tacos.csv')).find((r) =>
        /^flour tortillas$/i.test((r.ingredient ?? '').trim()),
      );
      assert.ok(plateRow, 'baja_fish_tacos.csv has no flour tortillas row');
      const entry = items.get(beoItem);
      assert.ok(entry, `${beoItem} has no row in menus/beo_recipe_map.csv`);
      assert.equal(
        entry.perCount.get('flour_tortillas'),
        Number(plateRow.qty),
        `${beoItem} allocates a different tortilla count than the plate BOM ` +
          `(${plateRow.qty} per ea). Both are one plate's worth — keep them in step.`,
      );
    });
  }

  it('Cob Salad Buffet does NOT carry chicken', () => {
    // Winter menu MI-SA02 sells chicken as a $6.00 add-on, not a component.
    // Ordering chicken for every cobb pan is an over-order nothing absorbs.
    const entry = items.get('Cob Salad Buffet');
    const chicken = [...entry.leaves].filter(
      (leaf) => /chicken/i.test(leaf) && !/\b(base|stock)\b/i.test(leaf),
    );
    assert.deepEqual(
      chicken,
      [],
      'Cobb Salad is bacon/egg/avocado/tomato per MI-SA02 — chicken is a paid add-on.\n' +
        report('Cob Salad Buffet'),
    );
  });
});

// Root cause 1: the recipe, not the map. The book (Lariat Recipe Book MASTER
// p27) opens Chicken Confit with "1 case chicken legs, frenched"; the CSV had
// only the aromatics, so every board that expanded it ordered EVOO and herbs
// for a chicken dish with no chicken.
describe('normalized recipes — the protein is in the recipe', () => {
  for (const [slug, needle] of [
    ['chicken_confit', 'chicken'],
    ['roasted_chicken_leg', 'chicken'],
    ['birria', 'beef'],
    ['carnitas', 'pork'],
    ['green_chilli', 'pork'],
    ['low_country_boil', 'shrimp'],
  ]) {
    it(`${slug} lists its protein`, () => {
      const leaves = [...leavesOf(manifest, slug)];
      assert.ok(leaves.length > 0, `${slug} has no BOM rows`);
      assert.ok(
        leaves.some((leaf) => leaf.toLowerCase().includes(needle)),
        `${slug} lists no ingredient containing "${needle}" — leaves: ${leaves.sort().join(', ')}`,
      );
    });
  }
});
