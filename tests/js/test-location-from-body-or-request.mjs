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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { locationFromBodyOrRequest, DEFAULT_LOCATION_ID } from '../../lib/location.ts';

function req(url) {
  return new Request(url, { method: 'POST' });
}

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
