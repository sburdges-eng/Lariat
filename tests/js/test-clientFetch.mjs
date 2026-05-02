#!/usr/bin/env node
// Pin the contract for lib/clientFetch.ts::clientFetch.
//
// Spec: docs/superpowers/specs/2026-05-02-sw-replay-idempotency-design.md
// Plan: ~/.claude/plans/the-five-tasks-you-linear-stardust.md (Phase 2)
//
// Four cases:
//   1. `idempotent: true` → request carries an idempotency-key header
//      (UUIDv4-shape, ≥16 chars).
//   2. No `idempotent` flag → no idempotency-key header injected; bare
//      fetch passthrough preserved.
//   3. Caller-supplied idempotency-key → respected; not overwritten.
//   4. Two opt-in calls in a row → keys differ. The clientFetch
//      contract is "fresh key per call site"; SW replay-resistance
//      comes from the SW reusing the *same* Request object (and its
//      header), not from clientFetch caching keys.
//
// Run: node --experimental-strip-types --test tests/js/test-clientFetch.mjs

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { clientFetch } = await import('../../lib/clientFetch.ts');

const realFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = realFetch;
});

describe('clientFetch', () => {
  let captured;

  beforeEach(() => {
    captured = [];
    globalThis.fetch = async (url, init) => {
      captured.push({ url, headers: new Headers(init?.headers) });
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
  });

  it('injects idempotency-key when idempotent:true', async () => {
    await clientFetch('/api/temp-log', { method: 'POST', body: '{}', idempotent: true });
    const k = captured[0].headers.get('idempotency-key');
    assert.ok(k && k.length >= 16, `expected key ≥16 chars, got ${k}`);
  });

  it('does NOT inject when idempotent flag absent', async () => {
    await clientFetch('/api/x', { method: 'POST', body: '{}' });
    assert.equal(captured[0].headers.get('idempotency-key'), null);
  });

  it('respects caller-supplied idempotency-key', async () => {
    await clientFetch('/api/x', {
      method: 'POST',
      body: '{}',
      idempotent: true,
      headers: { 'idempotency-key': 'caller-supplied-key-xx' },
    });
    assert.equal(
      captured[0].headers.get('idempotency-key'),
      'caller-supplied-key-xx',
    );
  });

  it('generates a fresh key per call (replay-resistance is SW-side, not clientFetch-side)', async () => {
    await clientFetch('/api/x', { method: 'POST', body: '{}', idempotent: true });
    await clientFetch('/api/x', { method: 'POST', body: '{}', idempotent: true });
    assert.notEqual(
      captured[0].headers.get('idempotency-key'),
      captured[1].headers.get('idempotency-key'),
    );
  });
});
