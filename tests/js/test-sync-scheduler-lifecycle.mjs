#!/usr/bin/env node
// Tests for lib/syncSchedulerLifecycle.ts.
//
// Run: node --experimental-strip-types --test tests/js/test-sync-scheduler-lifecycle.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

const {
  bootSyncScheduler,
  parsePeersEnv,
  _resetSyncSchedulerLifecycleForTests,
} = await import('../../lib/syncSchedulerLifecycle.ts');

beforeEach(() => {
  _resetSyncSchedulerLifecycleForTests();
});

// ─────────────────────────────────────────────────────────────────
// parsePeersEnv
// ─────────────────────────────────────────────────────────────────

describe('parsePeersEnv', () => {
  it('returns [] for null/undefined/empty/whitespace', () => {
    assert.deepEqual(parsePeersEnv(null), []);
    assert.deepEqual(parsePeersEnv(undefined), []);
    assert.deepEqual(parsePeersEnv(''), []);
    assert.deepEqual(parsePeersEnv('   '), []);
  });

  it('returns [] for malformed JSON', () => {
    assert.deepEqual(parsePeersEnv('not-json{'), []);
  });

  it('returns [] when JSON is not an array', () => {
    assert.deepEqual(parsePeersEnv('{}'), []);
    assert.deepEqual(parsePeersEnv('"a string"'), []);
  });

  it('parses a single well-formed peer', () => {
    const r = parsePeersEnv('[{"baseUrl":"http://a","feedKey":"k1"}]');
    assert.deepEqual(r, [{ baseUrl: 'http://a', feedKey: 'k1' }]);
  });

  it('drops entries missing baseUrl or feedKey', () => {
    const r = parsePeersEnv(
      JSON.stringify([
        { baseUrl: 'http://a', feedKey: 'k1' }, // good
        { baseUrl: 'http://b' },                // missing feedKey
        { feedKey: 'k3' },                      // missing baseUrl
        'not an object',                        // not an object
        null,                                    // null
        { baseUrl: '', feedKey: 'k5' },         // empty baseUrl
      ]),
    );
    assert.equal(r.length, 1);
    assert.equal(r[0].feedKey, 'k1');
  });

  it('preserves optional label', () => {
    const r = parsePeersEnv(
      JSON.stringify([{ baseUrl: 'http://a', feedKey: 'k1', label: 'tablet-1' }]),
    );
    assert.equal(r[0].label, 'tablet-1');
  });

  it('drops empty label string', () => {
    const r = parsePeersEnv(
      JSON.stringify([{ baseUrl: 'http://a', feedKey: 'k1', label: '   ' }]),
    );
    assert.equal(r[0].label, undefined);
  });
});

// ─────────────────────────────────────────────────────────────────
// bootSyncScheduler — idempotency + no-peers no-op + start invocation
// ─────────────────────────────────────────────────────────────────

describe('bootSyncScheduler', () => {
  it('no-op + log when no peers configured', async () => {
    let started = 0;
    await bootSyncScheduler({
      envPeersJson: '',
      customStart: () => {
        started += 1;
        return {
          start: () => {}, stop: () => {},
          gracefulStop: async () => {}, tick: async () => ({ cycles: [] }),
          isRunning: () => false,
        };
      },
      customStop: () => {},
      customLoadKeypair: () => ({ pubKey: Buffer.from('00'.repeat(32), 'hex'), privKey: Buffer.from('00'.repeat(32), 'hex') }),
    });
    assert.equal(started, 0, 'startScheduler must not be called when peers list is empty');
  });

  it('start is called with the parsed peers', async () => {
    let captured;
    await bootSyncScheduler({
      envPeersJson: '[{"baseUrl":"http://a","feedKey":"k1"}]',
      envTickMs: 5000,
      envOurPeerKey: 'us',
      customStart: (opts) => {
        captured = opts;
        return {
          start: () => {}, stop: () => {},
          gracefulStop: async () => {}, tick: async () => ({ cycles: [] }),
          isRunning: () => false,
        };
      },
      customStop: () => {},
      customLoadKeypair: () => ({
        pubKey: Buffer.from('00'.repeat(32), 'hex'),
        privKey: Buffer.from('11'.repeat(32), 'hex'),
      }),
    });
    assert.ok(captured);
    assert.equal(captured.peers.length, 1);
    assert.equal(captured.peers[0].feedKey, 'k1');
    assert.equal(captured.tickMs, 5000);
    assert.equal(captured.ourPubKeyHex, '00'.repeat(32));
    assert.equal(captured.ourPeerKey, 'us');
  });

  it('idempotent — second boot does NOT call start again', async () => {
    let started = 0;
    const opts = {
      envPeersJson: '[{"baseUrl":"http://a","feedKey":"k1"}]',
      customStart: () => {
        started += 1;
        return {
          start: () => {}, stop: () => {},
          gracefulStop: async () => {}, tick: async () => ({ cycles: [] }),
          isRunning: () => false,
        };
      },
      customStop: () => {},
      customLoadKeypair: () => ({
        pubKey: Buffer.from('00'.repeat(32), 'hex'),
        privKey: Buffer.from('11'.repeat(32), 'hex'),
      }),
    };
    await bootSyncScheduler(opts);
    await bootSyncScheduler(opts);
    assert.equal(started, 1);
  });
});
