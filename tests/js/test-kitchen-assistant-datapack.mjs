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
// Run: node --experimental-strip-types --test tests/js/test-kitchen-assistant-datapack.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ctx = await import('../../lib/kitchenAssistantContext.ts');
const datapack = await import('../../lib/datapackSearch.ts');

const skipMsg = 'data pack not mounted';

describe('renderFdaFoodCode — (a) safety question with data pack', { skip: !datapack.available() && skipMsg }, () => {
  it('emits an FDA block with §-cited sections for a thawing question', () => {
    const out = ctx.renderFdaFoodCode("what's the rule for thawing frozen chicken?");
    assert.ok(out.text, 'expected non-empty FDA block');
    assert.match(out.text, /FDA FOOD CODE/);
    // Section IDs follow the N-NNN.NN convention (e.g. 3-501.13).
    assert.match(out.text, /\[§ \d-\d+\.\d+\]/);
    assert.ok(out.source);
    assert.equal(out.source.type, 'fda_food_code');
    assert.match(out.source.detail, /\d+ section\(s\)/);
  });

  it('returns at most 3 hits and dedupes by section_id', () => {
    const out = ctx.renderFdaFoodCode('cooking temperature poultry');
    // Count the section-id citation lines.
    const citations = out.text.match(/\[§ [^\]]+\]/g) || [];
    assert.ok(citations.length >= 1);
    assert.ok(citations.length <= 3, 'should respect MAX_FDA_HITS');
    const unique = new Set(citations);
    assert.equal(unique.size, citations.length, 'no duplicate section_ids in block');
  });

  it('truncates body text so a single hit cannot blow MAX_CONTEXT_CHARS', () => {
    const out = ctx.renderFdaFoodCode('hot holding cold holding temperature control');
    // The whole block + 4-space-indented bodies — each body capped at
    // ~1200 chars + an ellipsis. With <=3 hits and ~80-char headers,
    // the entire block must stay well below MAX_CONTEXT_CHARS (12000).
    assert.ok(out.text.length < 6000, `block too large: ${out.text.length} chars`);
  });

  it('block is reachable via buildGroundedContext on a safety question', () => {
    // Smoke test that the full pipeline calls the helper; we don't
    // care about other context blocks here, just that the FDA block
    // shows up when FOOD_SAFETY_KEYWORDS matches.
    const { contextText } = ctx.buildGroundedContext(
      'default',
      "what is the safe holding temp for hot food?"
    );
    assert.match(contextText, /FDA FOOD CODE/);
    assert.match(contextText, /\[§ \d-\d+\.\d+\]/);
  });
});

describe('renderFdaFoodCode — (b) non-safety question', { skip: !datapack.available() && skipMsg }, () => {
  it('emits no FDA block via buildGroundedContext when the question is not a safety question', () => {
    const { contextText } = ctx.buildGroundedContext(
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
    fts: () => {
      throw new Error('fts must not be called when unavailable');
    },
    escapeFtsPhrase: (s) => `"${s}"`,
    getFdaSection: () => {
      throw new Error('getFdaSection must not be called when unavailable');
    },
  };

  it('returns a graceful no-op (empty text, null source, no exception)', () => {
    const out = ctx.renderFdaFoodCode("what's the cooking temp for chicken?", stubUnavailable);
    assert.equal(out.text, '');
    assert.equal(out.source, null);
  });

  it('does not throw, warn, or call into FTS when unavailable', () => {
    // The stub throws if fts/getFdaSection are called — exercising the
    // helper with a normal question must not trip those guards.
    assert.doesNotThrow(() =>
      ctx.renderFdaFoodCode('rules for thawing frozen food?', stubUnavailable)
    );
  });

  it('also handles empty/whitespace questions gracefully when unavailable', () => {
    const a = ctx.renderFdaFoodCode('', stubUnavailable);
    const b = ctx.renderFdaFoodCode('   ', stubUnavailable);
    assert.equal(a.text, '');
    assert.equal(b.text, '');
  });

  it('returns empty when fts yields zero hits even though pack is available', () => {
    // Distinct from the unavailable case: data pack is mounted but
    // the query truly has no FTS matches. Block must still be skipped
    // cleanly so the LLM doesn't see an empty "FDA FOOD CODE:" header.
    const stubEmpty = {
      available: () => true,
      fts: () => [],
      escapeFtsPhrase: (s) => `"${s}"`,
      getFdaSection: () => {
        throw new Error('getFdaSection must not be called when fts is empty');
      },
    };
    const out = ctx.renderFdaFoodCode('zzznoresult', stubEmpty);
    assert.equal(out.text, '');
    assert.equal(out.source, null);
  });
});
