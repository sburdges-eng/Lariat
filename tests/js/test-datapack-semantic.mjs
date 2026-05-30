#!/usr/bin/env node
// Tests for lib/datapackSearch.semantic — BGE vector retrieval over
// the Lariat data pack, via @huggingface/transformers (transformers.js).
// Run: node --experimental-strip-types --test tests/js/test-datapack-semantic.mjs
//
// Like the FTS test file, every case that needs the data pack on disk
// is gated by `available()` and skips cleanly when the SSD isn't
// mounted, so this file never goes red on a stripped-down machine.
//
// First-run cost: transformers.js downloads its ONNX copy of
// BAAI/bge-small-en-v1.5 (~30 MB) into the npm cache. Subsequent runs
// hit the local cache. Tests use a generous timeout for the first
// case so the download doesn't trip Node's default test timeout.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  available,
  semantic,
  _resetForTest,
  _setAvailableOverrideForTest,
} from '../../lib/datapackSearch.ts';

const skipMsg = 'data pack not mounted';

describe('lib/datapackSearch.semantic — empty query short-circuits', () => {
  it('returns [] for empty string without loading the model', async () => {
    // Soft-verify the lazy-load contract: empty queries return [] in
    // microseconds. We don't assert that the model wasn't loaded
    // (other tests in the suite may have loaded it), but the call
    // itself must complete synchronously-fast.
    const t0 = performance.now();
    const r = await semantic('', { bucket: 'recipes' });
    const dt = performance.now() - t0;
    assert.deepEqual(r, []);
    assert.ok(
      dt < 50,
      `empty query should return immediately, took ${dt.toFixed(1)}ms`
    );
  });

  it('returns [] for whitespace-only query', async () => {
    const r = await semantic('   \n\t  ', { bucket: 'recipes' });
    assert.deepEqual(r, []);
  });
});

describe(
  'lib/datapackSearch.semantic — recipes bucket',
  { skip: !available() && skipMsg, timeout: 180_000 },
  () => {
    it('returns ranked hits for an egg-related query', async () => {
      const hits = await semantic('vegetarian breakfast with eggs', {
        bucket: 'recipes',
        limit: 5,
      });
      assert.ok(hits.length > 0, 'should return at least one hit');
      assert.ok(hits.length <= 5, 'should respect the limit');

      // Cosine sims for BGE-small over a single-domain corpus typically
      // land in [0.4, 0.85] for a relevant query. Reject obvious junk.
      assert.ok(
        hits[0].score > 0.4,
        `top score ${hits[0].score} too low — model or prefix mismatch?`
      );
      assert.ok(hits[0].score <= 1.0001, 'cosine must be ≤ 1');

      // Sorted descending.
      for (let i = 1; i < hits.length; i++) {
        assert.ok(
          hits[i - 1].score >= hits[i].score,
          'hits must be sorted by descending score'
        );
      }

      // Bucket field is echoed.
      assert.equal(hits[0].bucket, 'recipes');

      // Top-3 should mention eggs in title or summary. We check
      // case-insensitively across the metadata fields the recipes
      // bucket carries.
      const top3 = hits.slice(0, 3);
      const eggish = top3.some((h) => {
        const blob = JSON.stringify(h).toLowerCase();
        return blob.includes('egg');
      });
      assert.ok(eggish, `expected an egg-mentioning recipe in top 3, got: ${
        top3.map((h) => h.title ?? h.slug).join(' | ')
      }`);
    });

    it('subsequent calls reuse the bucket cache (faster than first)', async () => {
      // The model+bucket are now warm. A second call should be
      // dominated by inference, not file I/O — usually well under
      // the first-call cost. We assert a generous bound to keep the
      // test stable across machines.
      const t0 = performance.now();
      await semantic('how to fold an omelet', {
        bucket: 'recipes',
        limit: 3,
      });
      const dt = performance.now() - t0;
      assert.ok(
        dt < 30_000,
        `warm semantic call took ${dt.toFixed(0)}ms — caches not warming?`
      );
    });
  }
);

describe(
  'lib/datapackSearch.semantic — missing bucket',
  { skip: !available() && skipMsg },
  () => {
    it('returns [] for a bucket name with no vectors.npy', async () => {
      // We pick a name that's vanishingly unlikely to exist on disk.
      // The contract says: missing per-bucket files → [], no throw.
      const hits = await semantic('any query at all', {
        bucket: 'this-bucket-does-not-exist-zzz',
        limit: 5,
      });
      assert.deepEqual(hits, []);
    });
  }
);

describe('lib/datapackSearch.semantic — data pack unavailable', () => {
  it('returns [] when available() is forced to false', async () => {
    // Spoof the availability check via the test-only override so we
    // can exercise the early-exit branch on a machine where the SSD
    // is otherwise mounted. The override is cleared by _resetForTest.
    _setAvailableOverrideForTest(false);
    try {
      const hits = await semantic('eggs', { bucket: 'recipes', limit: 3 });
      assert.deepEqual(hits, []);
    } finally {
      _resetForTest();
    }
  });
});

describe('lib/datapackSearch.semantic — local embeddings disabled', () => {
  it('returns [] without loading transformers.js', async () => {
    const prev = process.env.LARIAT_DISABLE_LOCAL_EMBEDDINGS;
    process.env.LARIAT_DISABLE_LOCAL_EMBEDDINGS = '1';
    try {
      const hits = await semantic('eggs', { bucket: 'recipes', limit: 3 });
      assert.deepEqual(hits, []);
    } finally {
      if (prev === undefined) delete process.env.LARIAT_DISABLE_LOCAL_EMBEDDINGS;
      else process.env.LARIAT_DISABLE_LOCAL_EMBEDDINGS = prev;
    }
  });
});
