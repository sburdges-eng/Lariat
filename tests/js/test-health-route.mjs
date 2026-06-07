#!/usr/bin/env node
// Integration tests for GET /api/health (aggregated launch-day probe).
//
// The route is the launch-smoke checkpoint (`scripts/launch-smoke.sh`)
// and the desktop wrapper's post-install gate, so the response shape
// and the status roll-up logic are load-bearing. This guards against
// drift in either.
//
// Strategy: spin up a temp SQLite DB via setDbPathForTest, point
// resolveDataDir at a tmp dir we control, and toggle env vars to exercise
// the ok / degraded / down paths. Ollama is unreachable in tests by
// design (no Ollama-on-CI requirement) — so the probe is exercised in
// its failure mode and we assert on shape rather than reachability.
//
// Run: node --experimental-strip-types --test tests/js/test-health-route.mjs

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-health-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');
const CACHE_DIR = path.join(TMP_DIR, 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.writeFileSync(
  path.join(CACHE_DIR, 'recipes.json'),
  JSON.stringify([{ id: 1, name: 'Test Burger' }]),
);

// Pin the data dir BEFORE importing the route (probeCache + probeCompliance
// call resolveDataDir at request time, but env-var capture happens once
// per process — set it early so every probe sees the same root).
process.env.LARIAT_DATA_DIR = TMP_DIR;

const db = await import('../../lib/db.ts');
const mdns = await import('../../lib/mdnsDiscovery.ts');
const route = await import('../../app/api/health/route.ts');

db.setDbPathForTest(TMP_DB);

const { GET } = route;
const ORIGINAL_FETCH = globalThis.fetch;

// Snapshot env vars we toggle so we can restore them between cases —
// the route reads env at request time, but other tests in the same
// process may rely on the original values.
const ENV_SNAPSHOT = {
  LARIAT_PIN: process.env.LARIAT_PIN,
  LARIAT_PIN_SECRET: process.env.LARIAT_PIN_SECRET,
  LARIAT_TEST_RELEASE: process.env.LARIAT_TEST_RELEASE,
  LARIAT_TOAST_CLIENT_ID: process.env.LARIAT_TOAST_CLIENT_ID,
  LARIAT_TOAST_CLIENT_SECRET: process.env.LARIAT_TOAST_CLIENT_SECRET,
  LARIAT_7SHIFTS_API_KEY: process.env.LARIAT_7SHIFTS_API_KEY,
  LARIAT_SEVENSHIFTS_API_KEY: process.env.LARIAT_SEVENSHIFTS_API_KEY,
  LARIAT_PRISM_USERNAME: process.env.LARIAT_PRISM_USERNAME,
  LARIAT_PRISM_PASSWORD: process.env.LARIAT_PRISM_PASSWORD,
  LARIAT_OLLAMA_MODEL: process.env.LARIAT_OLLAMA_MODEL,
};

after(() => {
  for (const [k, v] of Object.entries(ENV_SNAPSHOT)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (ORIGINAL_FETCH === undefined) delete globalThis.fetch;
  else globalThis.fetch = ORIGINAL_FETCH;
  db.setDbPathForTest(null);
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function clearOptionalCreds() {
  for (const k of [
    'LARIAT_TOAST_CLIENT_ID',
    'LARIAT_TOAST_CLIENT_SECRET',
    'LARIAT_7SHIFTS_API_KEY',
    'LARIAT_SEVENSHIFTS_API_KEY',
    'LARIAT_PRISM_USERNAME',
    'LARIAT_PRISM_PASSWORD',
  ]) {
    delete process.env[k];
  }
}

// ── shape contract ──────────────────────────────────────────────────

describe('GET /api/health — response shape', { concurrency: false }, () => {
  before(() => {
    process.env.LARIAT_PIN = '1234';
    process.env.LARIAT_PIN_SECRET = 'secret-for-tests';
    clearOptionalCreds();
  });

  it('returns a JSON object with status / version / timestamp / probes', async () => {
    const res = await GET();
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(res.headers.get('cache-control'), 'no-store');

    const body = await res.json();
    assert.equal(typeof body.status, 'string');
    assert.ok(['ok', 'degraded', 'down'].includes(body.status));
    assert.equal(typeof body.version, 'string');
    assert.ok(body.timestamp);
    assert.equal(typeof body.probes, 'object');
  });

  it('each probe carries either {ok:true, detail, ms} or {ok:false, error, ms}', async () => {
    const res = await GET();
    const body = await res.json();
    const expectedProbes = [
      'sqlite',
      'cache',
      'pin_gate',
      'mdns',
      'ollama',
      'compliance',
      'datapack',
      'toast',
      'sevenshifts',
      'prism',
    ];
    for (const name of expectedProbes) {
      assert.ok(body.probes[name], `missing probe: ${name}`);
      const p = body.probes[name];
      assert.equal(typeof p.ok, 'boolean');
      assert.equal(typeof p.ms, 'number');
      if (p.ok) assert.equal(typeof p.detail, 'string');
      else assert.equal(typeof p.error, 'string');
    }
  });

  it('surfaces mDNS advertise conflicts as a degraded discovery probe', async () => {
    process.env.LARIAT_PIN = '1234';
    process.env.LARIAT_PIN_SECRET = 'secret-for-tests';
    mdns._resetWarnedReasonsForTest();
    mdns._resetStatusForTest();
    mdns.warnOnce(
      'Bonjour publish failed',
      new Error('Service name is already in use on the network')
    );

    try {
      const res = await GET();
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.probes.mdns.ok, false);
      assert.equal(body.probes.mdns.code, 'service_name_conflict');
      assert.match(body.probes.mdns.error, /already in use/i);
      assert.notEqual(body.status, 'down');
    } finally {
      mdns._resetStatusForTest();
    }
  });
});

// ── status roll-up ──────────────────────────────────────────────────

describe('GET /api/health — status roll-up', { concurrency: false }, () => {
  it('returns ok (200) when every required and optional probe is green', async () => {
    process.env.LARIAT_PIN = '1234';
    process.env.LARIAT_PIN_SECRET = 'secret-for-tests';
    process.env.LARIAT_TOAST_CLIENT_ID = 'tid';
    process.env.LARIAT_TOAST_CLIENT_SECRET = 'tsec';
    process.env.LARIAT_7SHIFTS_API_KEY = 'sevenshifts-key';
    process.env.LARIAT_PRISM_USERNAME = 'prism-user';
    process.env.LARIAT_PRISM_PASSWORD = 'prism-pass';
    process.env.LARIAT_OLLAMA_MODEL = 'lari-the-kitchen-assistant';
    delete process.env.LARIAT_TEST_RELEASE;

    const compliancePath = path.join(CACHE_DIR, 'compliance.db');
    const datapackPath = path.join(TMP_DIR, 'lariat-data');
    fs.writeFileSync(compliancePath, '');
    fs.mkdirSync(datapackPath, { recursive: true });
    mdns._resetStatusForTest();
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ models: [{ name: 'lari-the-kitchen-assistant:latest' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );

    try {
      const res = await GET();
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(body.status, 'ok');
      assert.equal(body.probes.sqlite.ok, true);
      assert.equal(body.probes.cache.ok, true);
      assert.equal(body.probes.pin_gate.ok, true);
      assert.equal(body.probes.mdns.ok, true);
      assert.equal(body.probes.ollama.ok, true);
      assert.equal(body.probes.compliance.ok, true);
      assert.equal(body.probes.datapack.ok, true);
      assert.equal(body.probes.toast.ok, true);
      assert.equal(body.probes.sevenshifts.ok, true);
      assert.equal(body.probes.prism.ok, true);
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
      fs.rmSync(compliancePath, { force: true });
      fs.rmSync(datapackPath, { recursive: true, force: true });
    }
  });

  it('returns degraded (200) when only optional probes fail', async () => {
    // sqlite + cache reachable, PIN configured, no optional creds set.
    process.env.LARIAT_PIN = '1234';
    process.env.LARIAT_PIN_SECRET = 'secret-for-tests';
    clearOptionalCreds();

    const res = await GET();
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.probes.sqlite.ok, true);
    assert.equal(body.probes.cache.ok, true);
    assert.equal(body.probes.pin_gate.ok, true);
    // Optionals report not-configured as ok:false (degraded), not down.
    assert.equal(body.probes.toast.ok, false);
    assert.equal(body.probes.sevenshifts.ok, false);
    assert.equal(body.probes.prism.ok, false);
    assert.equal(body.status, 'degraded');
  });

  it('returns down (503) when PIN gate is unconfigured (required probe failed)', async () => {
    delete process.env.LARIAT_PIN;
    delete process.env.LARIAT_PIN_SECRET;

    const res = await GET();
    const body = await res.json();

    assert.equal(res.status, 503);
    assert.equal(body.status, 'down');
    assert.equal(body.probes.pin_gate.ok, false);
    assert.match(body.probes.pin_gate.error, /PIN/);
  });

  it('returns 503 when cache is unreadable (required probe failed)', async () => {
    // Re-arm PIN so only cache is the failing required probe.
    process.env.LARIAT_PIN = '1234';
    process.env.LARIAT_PIN_SECRET = 'secret-for-tests';

    const cachePath = path.join(CACHE_DIR, 'recipes.json');
    const saved = fs.readFileSync(cachePath, 'utf8');
    fs.writeFileSync(cachePath, '{"not": "an array"}');

    try {
      const res = await GET();
      const body = await res.json();
      assert.equal(res.status, 503);
      assert.equal(body.status, 'down');
      assert.equal(body.probes.cache.ok, false);
    } finally {
      fs.writeFileSync(cachePath, saved);
    }
  });

  it('ollama probe failure does not flip overall status to down (not a required probe)', async () => {
    // Ollama may or may not be running locally; the contract we care
    // about here is that even if it's down, the overall roll-up stays
    // out of `down` because sqlite + cache + pin_gate are the only
    // probes in the `required` list.
    process.env.LARIAT_PIN = '1234';
    process.env.LARIAT_PIN_SECRET = 'secret-for-tests';

    const res = await GET();
    const body = await res.json();

    // The Ollama probe always carries the ok/ms contract regardless.
    assert.equal(typeof body.probes.ollama.ok, 'boolean');
    assert.equal(typeof body.probes.ollama.ms, 'number');
    // sqlite + cache + pin_gate are OK so status is never down.
    assert.notEqual(body.status, 'down');
  });
});

// ── optional credentials toggle ─────────────────────────────────────

describe('GET /api/health — optional integration credentials', { concurrency: false }, () => {
  it('marks Toast / 7shifts / Prism probes ok when credentials are set', async () => {
    process.env.LARIAT_PIN = '1234';
    process.env.LARIAT_PIN_SECRET = 'secret-for-tests';
    process.env.LARIAT_TOAST_CLIENT_ID = 'tid';
    process.env.LARIAT_TOAST_CLIENT_SECRET = 'tsec';
    process.env.LARIAT_7SHIFTS_API_KEY = 'sevenshifts-key';
    process.env.LARIAT_PRISM_USERNAME = 'prism-user';
    process.env.LARIAT_PRISM_PASSWORD = 'prism-pass';

    const res = await GET();
    const body = await res.json();
    assert.equal(body.probes.toast.ok, true);
    assert.equal(body.probes.sevenshifts.ok, true);
    assert.equal(body.probes.prism.ok, true);
  });

  it('treats LARIAT_SEVENSHIFTS_API_KEY as an alias and warns once (audit F8)', async () => {
    process.env.LARIAT_PIN = '1234';
    process.env.LARIAT_PIN_SECRET = 'secret-for-tests';
    delete process.env.LARIAT_7SHIFTS_API_KEY;
    process.env.LARIAT_SEVENSHIFTS_API_KEY = 'sevenshifts-via-legacy-name';

    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      const res = await GET();
      const body = await res.json();
      assert.equal(body.probes.sevenshifts.ok, true);

      const secondRes = await GET();
      const secondBody = await secondRes.json();
      assert.equal(secondBody.probes.sevenshifts.ok, true);
    } finally {
      console.warn = originalWarn;
    }

    const sevenShiftsWarnings = warnings.filter((line) =>
      line.includes('LARIAT_SEVENSHIFTS_API_KEY is deprecated'),
    );
    assert.equal(sevenShiftsWarnings.length, 1);
    assert.match(sevenShiftsWarnings[0], /LARIAT_7SHIFTS_API_KEY/);
  });
});

// ── test-release channel (offline; no vendor APIs) ──────────────────

describe('GET /api/health — test release runs without vendor APIs', { concurrency: false }, () => {
  after(() => {
    delete process.env.LARIAT_TEST_RELEASE;
  });

  it('neutralizes Toast/7shifts/Prism/datapack probes (no creds) and reports the test channel', async () => {
    process.env.LARIAT_PIN = '1234';
    process.env.LARIAT_PIN_SECRET = 'secret-for-tests';
    clearOptionalCreds();
    process.env.LARIAT_TEST_RELEASE = '1';

    const res = await GET();
    const body = await res.json();

    // External vendor integrations are intentionally disabled — unset creds
    // must report ok (not failing) so they don't degrade a test release.
    for (const k of ['toast', 'sevenshifts', 'prism', 'datapack']) {
      assert.equal(body.probes[k].ok, true, `${k} should be ok (disabled) in a test release`);
      assert.match(body.probes[k].detail, /test release/i);
    }
    assert.equal(body.testRelease, true);
    assert.equal(body.channel, 'test');
    // Required probes still hold → never "down".
    assert.notEqual(res.status, 503);
  });

  it('still reports those probes as failing in the official channel (no creds)', async () => {
    process.env.LARIAT_PIN = '1234';
    process.env.LARIAT_PIN_SECRET = 'secret-for-tests';
    clearOptionalCreds();
    process.env.LARIAT_TEST_RELEASE = '0';

    const res = await GET();
    const body = await res.json();
    assert.equal(body.probes.toast.ok, false);
    assert.equal(body.channel, 'official');
  });
});
