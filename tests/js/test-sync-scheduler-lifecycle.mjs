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
  isAllowedBaseUrl,
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
// Audit M2 — baseUrl scheme + private-host whitelist
// ─────────────────────────────────────────────────────────────────

describe('isAllowedBaseUrl', () => {
  it('accepts public http and https URLs', () => {
    assert.equal(isAllowedBaseUrl('http://api.lariat.example', false), true);
    assert.equal(isAllowedBaseUrl('https://api.lariat.example', false), true);
  });

  it('rejects file:// (no SSRF / arbitrary file read)', () => {
    assert.equal(isAllowedBaseUrl('file:///etc/passwd', false), false);
    assert.equal(isAllowedBaseUrl('file:///etc/passwd', true), false); // still rejected even with allowPrivate
  });

  it('rejects javascript: and data: pseudo-schemes', () => {
    assert.equal(isAllowedBaseUrl('javascript:alert(1)', false), false);
    assert.equal(isAllowedBaseUrl('data:text/plain,abc', false), false);
  });

  it('rejects malformed URLs', () => {
    assert.equal(isAllowedBaseUrl('not a url', false), false);
    assert.equal(isAllowedBaseUrl('', false), false);
  });

  it('rejects loopback and metadata-service hosts when allowPrivate is false', () => {
    assert.equal(isAllowedBaseUrl('http://localhost:3000', false), false);
    assert.equal(isAllowedBaseUrl('http://127.0.0.1:3000', false), false);
    assert.equal(isAllowedBaseUrl('http://[::1]:3000', false), false);
    assert.equal(isAllowedBaseUrl('http://169.254.169.254/latest/meta-data/', false), false);
  });

  it('rejects RFC1918 private hosts when allowPrivate is false', () => {
    assert.equal(isAllowedBaseUrl('http://10.0.0.1', false), false);
    assert.equal(isAllowedBaseUrl('http://192.168.1.42', false), false);
    assert.equal(isAllowedBaseUrl('http://172.16.0.1', false), false);
    assert.equal(isAllowedBaseUrl('http://172.31.255.255', false), false);
    assert.equal(isAllowedBaseUrl('http://172.15.0.1', false), true, '172.15 is NOT private');
  });

  it('rejects .local hostnames (mDNS) when allowPrivate is false', () => {
    assert.equal(isAllowedBaseUrl('http://lariat-tablet-1.local', false), false);
  });

  it('accepts loopback + LAN-private hosts when allowPrivate is true (LAN sync opt-in)', () => {
    assert.equal(isAllowedBaseUrl('http://localhost:3000', true), true);
    assert.equal(isAllowedBaseUrl('http://192.168.1.42:3000', true), true);
    assert.equal(isAllowedBaseUrl('http://lariat-tablet-1.local', true), true);
  });
});

describe('parsePeersEnv — M2 baseUrl filtering', () => {
  const prev = process.env.LARIAT_SYNC_ALLOW_PRIVATE;
  beforeEach(() => {
    delete process.env.LARIAT_SYNC_ALLOW_PRIVATE;
  });
  // restore
   
  globalThis.afterAll?.(() => {
    if (prev !== undefined) process.env.LARIAT_SYNC_ALLOW_PRIVATE = prev;
  });

  it('drops file:// entries', () => {
    const r = parsePeersEnv(JSON.stringify([
      { baseUrl: 'file:///etc/passwd', feedKey: 'evil' },
      { baseUrl: 'https://api.lariat.example', feedKey: 'good' },
    ]));
    assert.equal(r.length, 1);
    assert.equal(r[0].feedKey, 'good');
  });

  it('drops private hosts unless LARIAT_SYNC_ALLOW_PRIVATE=1', () => {
    const peers = JSON.stringify([
      { baseUrl: 'http://192.168.1.42', feedKey: 'lan' },
      { baseUrl: 'https://api.lariat.example', feedKey: 'pub' },
    ]);
    delete process.env.LARIAT_SYNC_ALLOW_PRIVATE;
    let r = parsePeersEnv(peers);
    assert.equal(r.length, 1);
    assert.equal(r[0].feedKey, 'pub');
    // With the LAN opt-in, both are kept.
    process.env.LARIAT_SYNC_ALLOW_PRIVATE = '1';
    try {
      r = parsePeersEnv(peers);
      assert.equal(r.length, 2);
    } finally {
      delete process.env.LARIAT_SYNC_ALLOW_PRIVATE;
    }
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
