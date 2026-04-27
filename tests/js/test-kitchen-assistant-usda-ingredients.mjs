#!/usr/bin/env node
// Tests for renderUsdaIngredients — pulls USDA Foods rows (Foundation,
// SR-Legacy, Survey, Branded) from the off-tree data pack into the
// kitchen-assistant context whenever an ingredient/nutrient/yield
// question hits INGREDIENT_KEYWORDS.
//
// The data pack lives off-tree (mounted via the data/lariat-data
// symlink) and may be absent on dev machines / CI. Cases (a), (b),
// and (e) gracefully t.skip() when the pack isn't available; cases
// (c) and (d) drive the helper with stubbed `deps` so they always run.
//
// renderUsdaIngredients is async because hybrid retrieval awaits the
// BGE model on the embedding channel — every assertion below either
// awaits the helper or awaits buildGroundedContext, which propagates
// the same Promise.
//
// First-call cost: the ingredients bucket is ~3 GB and takes ~20 s to
// cold-load. Tests reuse the same module import, so only the first
// retrieval pays that cost.
//
// Run: node --experimental-strip-types --test tests/js/test-kitchen-assistant-usda-ingredients.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ctx = await import('../../lib/kitchenAssistantContext.ts');
const datapack = await import('../../lib/datapackSearch.ts');

const skipMsg = 'data pack not mounted';

describe('renderUsdaIngredients — (a) ingredient question with data pack', { skip: !datapack.available() && skipMsg }, () => {
  it('emits a USDA block with [fdc_id …] markers for a chicken-protein question', async () => {
    const out = await ctx.renderUsdaIngredients(
      'how much protein is in chicken breast?'
    );
    assert.ok(out.text, 'expected non-empty USDA block');
    assert.match(out.text, /USDA INGREDIENTS/);
    assert.match(out.text, /\[fdc_id \d+\]/);
    assert.ok(out.source);
    assert.equal(out.source.type, 'usda_ingredients');
    assert.match(out.source.detail, /\d+ food\(s\)/);
    // Unit casing — USDA's raw `unit_name` is uppercase (`KCAL`); the
    // renderer must normalise to the conventional `kcal` form.
    assert.match(out.text, /kcal/);
    assert.doesNotMatch(out.text, /KCAL/);
    // Display-name shortening — the verbose "Total lipid (fat)" /
    // "Sodium, Na" / "Sugars, total" labels are rewritten to the
    // compact "Fat" / "Sodium" / "Sugars" forms. We can't guarantee any
    // single one is on the chicken breast result, but the long-form
    // strings should never appear.
    assert.doesNotMatch(out.text, /Total lipid \(fat\)/);
    assert.doesNotMatch(out.text, /Sodium, Na/);
    assert.doesNotMatch(out.text, /Sugars, total/);
  });

  it('renders priority nutrients inline on the body line', async () => {
    const out = await ctx.renderUsdaIngredients(
      'calories and protein in cooked salmon'
    );
    // At least one of the priority nutrients should show up across
    // the rendered hits — Energy and Protein are reported on virtually
    // every Foundation/SR-Legacy row.
    assert.match(out.text, /Energy|Protein/);
    // Inline separator format `A · B · C`.
    assert.match(out.text, / · /);
  });

  it('caps hits at MAX_USDA_HITS (4) and dedupes by fdc_id', async () => {
    const out = await ctx.renderUsdaIngredients('white rice cooked');
    const citations = out.text.match(/\[fdc_id \d+\]/g) || [];
    assert.ok(citations.length >= 1);
    assert.ok(
      citations.length <= 4,
      `expected ≤4 hits, got ${citations.length}`
    );
    const unique = new Set(citations);
    assert.equal(
      unique.size,
      citations.length,
      'no duplicate fdc_id in block'
    );
  });

  it('keeps the whole block well under MAX_CONTEXT_CHARS', async () => {
    const out = await ctx.renderUsdaIngredients(
      'gluten free vegan substitute for butter'
    );
    // 4 hits × ~400-char body cap + ~80-char headers leaves the block
    // far under the 12 000-char overall budget.
    assert.ok(
      out.text.length < 4000,
      `block too large: ${out.text.length} chars`
    );
  });
});

describe('renderUsdaIngredients — (b) non-ingredient question via buildGroundedContext', { skip: !datapack.available() && skipMsg }, () => {
  it('emits no USDA block on a question that does not match INGREDIENT_KEYWORDS', async () => {
    const { contextText } = await ctx.buildGroundedContext(
      'default',
      'who got the most gold stars this week?'
    );
    assert.doesNotMatch(contextText, /USDA INGREDIENTS/);
  });
});

describe('renderUsdaIngredients — (c) data pack unavailable', () => {
  // Stub the datapackSearch surface so available() returns false.
  // This case must run on every machine, mounted or not — the whole
  // point is to verify graceful degradation.
  const stubUnavailable = {
    available: () => false,
    hybrid: async () => {
      throw new Error('hybrid must not be called when unavailable');
    },
    usdaNutrientsFor: () => {
      throw new Error('usdaNutrientsFor must not be called when unavailable');
    },
  };

  it('returns a graceful no-op (empty text, null source, no exception)', async () => {
    const out = await ctx.renderUsdaIngredients(
      'how much protein in chicken?',
      stubUnavailable
    );
    assert.equal(out.text, '');
    assert.equal(out.source, null);
  });

  it('does not throw, warn, or call into hybrid when unavailable', async () => {
    await assert.doesNotReject(() =>
      ctx.renderUsdaIngredients('calories in rice', stubUnavailable)
    );
  });

  it('also handles empty/whitespace questions gracefully when unavailable', async () => {
    const a = await ctx.renderUsdaIngredients('', stubUnavailable);
    const b = await ctx.renderUsdaIngredients('   ', stubUnavailable);
    assert.equal(a.text, '');
    assert.equal(b.text, '');
  });
});

describe('renderUsdaIngredients — (d) hybrid yields zero hits with pack available', () => {
  // Distinct from the unavailable case: data pack is mounted but the
  // query truly has no fused matches. Block must still be skipped
  // cleanly so the LLM doesn't see an empty "USDA INGREDIENTS:" header.
  const stubEmpty = {
    available: () => true,
    hybrid: async () => [],
    usdaNutrientsFor: () => {
      throw new Error('usdaNutrientsFor must not be called when hybrid is empty');
    },
  };

  it('returns empty when hybrid yields zero hits', async () => {
    const out = await ctx.renderUsdaIngredients('zzznoresult', stubEmpty);
    assert.equal(out.text, '');
    assert.equal(out.source, null);
  });

  it('also short-circuits on empty/whitespace questions before calling hybrid', async () => {
    // Use a stub where hybrid throws — the empty-question guard runs
    // before the hybrid call, so this must not reject.
    const stubHybridThrows = {
      available: () => true,
      hybrid: async () => {
        throw new Error('hybrid must not be called for empty query');
      },
      usdaNutrientsFor: () => {
        throw new Error('usdaNutrientsFor must not be called for empty query');
      },
    };
    const a = await ctx.renderUsdaIngredients('', stubHybridThrows);
    const b = await ctx.renderUsdaIngredients('   ', stubHybridThrows);
    assert.equal(a.text, '');
    assert.equal(b.text, '');
  });
});

describe('renderUsdaIngredients — (e) buildGroundedContext smoke', { skip: !datapack.available() && skipMsg }, () => {
  it('emits the USDA block on a recipe-yield question that matches INGREDIENT_KEYWORDS', async () => {
    // 'yield' is in INGREDIENT_KEYWORDS so the gate should fire.
    const { contextText } = await ctx.buildGroundedContext(
      'default',
      'what is the cooked yield for chicken breast?'
    );
    assert.match(contextText, /USDA INGREDIENTS/);
    assert.match(contextText, /\[fdc_id \d+\]/);
  });
});
