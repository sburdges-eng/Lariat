import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Smoke: module imports cleanly and stubs honour the NOT_IMPLEMENTED
// contract documented in lib/syncFeed.ts. Behaviour is intentionally
// unimplemented in this PR — see docs/multi-instance-sync.md.
//
// Run with: node --experimental-strip-types --test tests/js/test-sync-feed-types.mjs

describe('syncFeed types — import and stub contract', () => {
  it('module imports cleanly', async () => {
    const mod = await import('../../lib/syncFeed.ts');
    assert.equal(typeof mod.appendOp, 'function');
    assert.equal(typeof mod.replaySince, 'function');
  });

  it('appendOp throws NOT_IMPLEMENTED', async () => {
    const { appendOp } = await import('../../lib/syncFeed.ts');
    assert.throws(
      () =>
        appendOp({
          opId: '00000000-0000-7000-8000-000000000000',
          tableName: 'audit_events',
          locationId: 'default',
          opKind: 'insert',
          rowPk: '1',
          rowJson: '{}',
          createdAt: '2026-05-06T00:00:00Z',
          sourceHost: 'lariat-hub.local',
          sourceStartedAt: '2026-05-06T00:00:00Z',
        }),
      /NOT_IMPLEMENTED/,
    );
  });

  it('replaySince throws NOT_IMPLEMENTED', async () => {
    const { replaySince } = await import('../../lib/syncFeed.ts');
    assert.throws(() => replaySince('peer', 0), /NOT_IMPLEMENTED/);
  });
});
