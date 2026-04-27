#!/usr/bin/env node
// Tests for renderFdaFoodCode — pulls FDA Food Code passages from the
// off-tree data pack into the kitchen-assistant context whenever a
// food-safety question hits FOOD_SAFETY_KEYWORDS.
//
// The data pack lives off-tree (mounted via the data/lariat-data
// symlink) and may be absent on dev machines / CI. Cases (a) and (b)
// gracefully t.skip() when the pack isn't available; case (c) drives
// the helper with a stubbed `deps` so it always runs.
//
// renderFdaFoodCode is async because hybrid retrieval awaits the BGE
// model on the embedding channel — every assertion below either
// awaits the helper or awaits buildGroundedContext, which propagates
// the same Promise.
//
// Run: node --experimental-strip-types --test tests/js/test-kitchen-assistant-datapack.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ctx = await import('../../lib/kitchenAssistantContext.ts');
const datapack = await import('../../lib/datapackSearch.ts');

const skipMsg = 'data pack not mounted';

describe('renderFdaFoodCode — (a) safety question with data pack', { skip: !datapack.available() && skipMsg }, () => {
  it('emits an FDA block with §-cited sections for a thawing question', async () => {
    const out = await ctx.renderFdaFoodCode("what's the rule for thawing frozen chicken?");
    assert.ok(out.text, 'expected non-empty FDA block');
    assert.match(out.text, /FDA FOOD CODE/);
    // Section IDs follow the N-NNN.NN convention (e.g. 3-501.13).
    assert.match(out.text, /\[§ \d-\d+\.\d+\]/);
    assert.ok(out.source);
    assert.equal(out.source.type, 'fda_food_code');
    assert.match(out.source.detail, /\d+ section\(s\)/);
  });

  it('returns at most 3 hits and dedupes by section_id', async () => {
    const out = await ctx.renderFdaFoodCode('cooking temperature poultry');
    // Count the section-id citation lines.
    const citations = out.text.match(/\[§ [^\]]+\]/g) || [];
    assert.ok(citations.length >= 1);
    assert.ok(citations.length <= 3, 'should respect MAX_FDA_HITS');
    const unique = new Set(citations);
    assert.equal(unique.size, citations.length, 'no duplicate section_ids in block');
  });

  it('truncates body text so a single hit cannot blow MAX_CONTEXT_CHARS', async () => {
    const out = await ctx.renderFdaFoodCode('hot holding cold holding temperature control');
    // The whole block + 4-space-indented bodies — each body capped at
    // ~1200 chars + an ellipsis. With <=3 hits and ~80-char headers,
    // the entire block must stay well below MAX_CONTEXT_CHARS (12000).
    assert.ok(out.text.length < 6000, `block too large: ${out.text.length} chars`);
  });

  it('block is reachable via buildGroundedContext on a safety question', async () => {
    // Smoke test that the full pipeline calls the helper; we don't
    // care about other context blocks here, just that the FDA block
    // shows up when FOOD_SAFETY_KEYWORDS matches.
    const { contextText } = await ctx.buildGroundedContext(
      'default',
      "what is the safe holding temp for hot food?"
    );
    assert.match(contextText, /FDA FOOD CODE/);
    assert.match(contextText, /\[§ \d-\d+\.\d+\]/);
  });
});

describe('renderFdaFoodCode — (b) non-safety question', { skip: !datapack.available() && skipMsg }, () => {
  it('emits no FDA block via buildGroundedContext when the question is not a safety question', async () => {
    const { contextText } = await ctx.buildGroundedContext(
      'default',
      'who got the most gold stars this week?'
    );
    assert.doesNotMatch(contextText, /FDA FOOD CODE/);
  });
});

describe('renderFdaFoodCode — (c) data pack unavailable', () => {
  // Stub the datapackSearch surface so available() returns false.
  // This case must run on every machine, mounted or not — the whole
  // point is to verify graceful degradation.
  const stubUnavailable = {
    available: () => false,
    hybrid: async () => {
      throw new Error('hybrid must not be called when unavailable');
    },
    getFdaSection: () => {
      throw new Error('getFdaSection must not be called when unavailable');
    },
  };

  it('returns a graceful no-op (empty text, null source, no exception)', async () => {
    const out = await ctx.renderFdaFoodCode(
      "what's the cooking temp for chicken?",
      stubUnavailable
    );
    assert.equal(out.text, '');
    assert.equal(out.source, null);
  });

  it('does not throw, warn, or call into hybrid when unavailable', async () => {
    // The stub throws if hybrid/getFdaSection are called — exercising
    // the helper with a normal question must not trip those guards.
    await assert.doesNotReject(() =>
      ctx.renderFdaFoodCode('rules for thawing frozen food?', stubUnavailable)
    );
  });

  it('also handles empty/whitespace questions gracefully when unavailable', async () => {
    const a = await ctx.renderFdaFoodCode('', stubUnavailable);
    const b = await ctx.renderFdaFoodCode('   ', stubUnavailable);
    assert.equal(a.text, '');
    assert.equal(b.text, '');
  });

  it('returns empty when hybrid yields zero hits even though pack is available', async () => {
    // Distinct from the unavailable case: data pack is mounted but
    // the query truly has no fused matches. Block must still be
    // skipped cleanly so the LLM doesn't see an empty
    // "FDA FOOD CODE:" header.
    const stubEmpty = {
      available: () => true,
      hybrid: async () => [],
      getFdaSection: () => {
        throw new Error('getFdaSection must not be called when hybrid is empty');
      },
    };
    const out = await ctx.renderFdaFoodCode('zzznoresult', stubEmpty);
    assert.equal(out.text, '');
    assert.equal(out.source, null);
  });
});
