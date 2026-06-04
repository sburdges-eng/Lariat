#!/usr/bin/env node
// locationFromBodyOrRequest — pin the contract.
//
// Replaces the broken `locFromBody !== 'default' ? locFromBody : locFromReq`
// pattern that was used in /api/specials, /api/specials/saved, and
// /api/kitchen-assistant. The pattern conflated "body explicitly said
// 'default'" with "body said nothing".
//
// Found via the 2026-05-02 breaker audit (Section 3 P2 #2):
//   docs/agentic/findings/2026-05-02-locFromBody-default-fallthrough-ambiguity.md
//
// Run: node --experimental-strip-types --test tests/js/test-location-from-body-or-request.mjs

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  locationFromBodyOrRequest,
  locationIdFromEnv,
  DEFAULT_LOCATION_ID,
} from '../../lib/location.ts';

const LOCATION_ENV_SNAPSHOT = {
  LARIAT_LOCATION_ID: process.env.LARIAT_LOCATION_ID,
  LARIAT_LOCATION: process.env.LARIAT_LOCATION,
};

function req(url) {
  return new Request(url, { method: 'POST' });
}

function restoreLocationEnv() {
  for (const [key, value] of Object.entries(LOCATION_ENV_SNAPSHOT)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearLocationEnv() {
  delete process.env.LARIAT_LOCATION_ID;
  delete process.env.LARIAT_LOCATION;
}

function captureWarnings(run) {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    return { value: run(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

afterEach(() => {
  restoreLocationEnv();
});

describe('locationIdFromEnv — canonical env names', { concurrency: false }, () => {
  it('prefers LARIAT_LOCATION_ID over the legacy LARIAT_LOCATION without warning', () => {
    clearLocationEnv();
    process.env.LARIAT_LOCATION_ID = 'south';
    process.env.LARIAT_LOCATION = 'north';

    const { value, warnings } = captureWarnings(() => locationIdFromEnv());

    assert.equal(value, 'south');
    assert.deepEqual(warnings, []);
  });

  it('honors legacy LARIAT_LOCATION and warns once per process', () => {
    clearLocationEnv();
    process.env.LARIAT_LOCATION = 'north';

    const { value: first, warnings } = captureWarnings(() => {
      const firstValue = locationIdFromEnv();
      const secondValue = locationIdFromEnv();
      return [firstValue, secondValue];
    });

    assert.deepEqual(first, ['north', 'north']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /LARIAT_LOCATION is deprecated/);
    assert.match(warnings[0], /LARIAT_LOCATION_ID/);
  });

  it('falls back to DEFAULT_LOCATION_ID when neither env name is set', () => {
    clearLocationEnv();

    const { value, warnings } = captureWarnings(() => locationIdFromEnv());

    assert.equal(value, DEFAULT_LOCATION_ID);
    assert.deepEqual(warnings, []);
  });
});

describe('locationFromBodyOrRequest — body present', () => {
  it('body { location_id: "south" } returns "south"', () => {
    assert.strictEqual(
      locationFromBodyOrRequest({ location_id: 'south' }, req('http://x/?location=north')),
      'south',
    );
  });

  it('body { location: "south" } returns "south"', () => {
    assert.strictEqual(
      locationFromBodyOrRequest({ location: 'south' }, req('http://x/?location=north')),
      'south',
    );
  });

  it('body { location_id: "default" } HONORS the explicit default', () => {
    // The whole point of the fix — explicit "default" must NOT fall
    // through to the URL's "north".
    assert.strictEqual(
      locationFromBodyOrRequest(
        { location_id: 'default' },
        req('http://x/?location=north'),
      ),
      'default',
    );
  });

  it('whitespace in body location_id is trimmed', () => {
    assert.strictEqual(
      locationFromBodyOrRequest({ location_id: '  south  ' }, req('http://x/')),
      'south',
    );
  });

  it('body { location_id: null } falls through to request', () => {
    assert.strictEqual(
      locationFromBodyOrRequest({ location_id: null }, req('http://x/?location=north')),
      'north',
    );
  });

  it('body { location_id: "" } falls through to request', () => {
    assert.strictEqual(
      locationFromBodyOrRequest({ location_id: '' }, req('http://x/?location=north')),
      'north',
    );
  });

  it('body { location_id: "   " } (whitespace only) falls through', () => {
    assert.strictEqual(
      locationFromBodyOrRequest({ location_id: '   ' }, req('http://x/?location=north')),
      'north',
    );
  });
});

describe('locationFromBodyOrRequest — body absent', () => {
  it('null body falls through to request', () => {
    assert.strictEqual(
      locationFromBodyOrRequest(null, req('http://x/?location=north')),
      'north',
    );
  });

  it('undefined body falls through to request', () => {
    assert.strictEqual(
      locationFromBodyOrRequest(undefined, req('http://x/?location=north')),
      'north',
    );
  });

  it('{} body falls through to request', () => {
    assert.strictEqual(
      locationFromBodyOrRequest({}, req('http://x/?location=north')),
      'north',
    );
  });
});

describe('locationFromBodyOrRequest — both absent', () => {
  it('falls back to DEFAULT_LOCATION_ID', () => {
    assert.strictEqual(
      locationFromBodyOrRequest(null, req('http://x/')),
      DEFAULT_LOCATION_ID,
    );
  });

  it('treats body { location_id: "default" } AND no query as "default"', () => {
    // Same value as the fallback, but the path is "explicit body".
    assert.strictEqual(
      locationFromBodyOrRequest({ location_id: 'default' }, req('http://x/')),
      'default',
    );
  });
});

describe('locationFromBodyOrRequest — old-pattern regression case', () => {
  it('body { location_id: "default" } + URL location=south → "default" (NOT "south")', () => {
    // This is the exact bug the helper closes. The old ternary read:
    //   locFromBody !== 'default' ? locFromBody : locFromReq
    // which would fall through to "south" here. The fixed helper
    // honors the body's explicit value.
    assert.strictEqual(
      locationFromBodyOrRequest(
        { location_id: 'default' },
        req('http://x/?location=south'),
      ),
      'default',
    );
  });
});
