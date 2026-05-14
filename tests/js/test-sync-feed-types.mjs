import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Module-import smoke test for lib/syncFeed.ts. Behaviour tests live in
// tests/js/test-sync-feed.mjs (TDD coverage of appendOp + replaySince
// + replay_checkpoints + the family-1 idempotency contract).
//
// Run with: node --experimental-strip-types --test tests/js/test-sync-feed-types.mjs

describe('syncFeed module surface', () => {
  it('exports the four call-surface functions', async () => {
    const mod = await import('../../lib/syncFeed.ts');
    assert.equal(typeof mod.appendOp, 'function');
    assert.equal(typeof mod.replaySince, 'function');
    assert.equal(typeof mod.getReplayCheckpoint, 'function');
    assert.equal(typeof mod.setReplayCheckpoint, 'function');
  });
});
