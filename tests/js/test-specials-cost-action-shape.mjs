#!/usr/bin/env node
// /api/specials cost_special payload-shape guard.
//
// Closes §6 P3 from the 2026-05-02 breaker audit
// (docs/agentic/findings/2026-05-02-cost-special-payload-shape-not-validated.md).
//
// Pre-fix the route only checked `Array.isArray(payload.ingredients)`.
// Per-element item/unit/qty types were not validated, so an LLM-emitted
// payload like `[{item:null, qty:1, unit:'lb'}, {item:'tomato', unit:['tbsp']}]`
// would round-trip into the SQL LIKE query and the breakdown row.
//
// Post-fix the route filters bad-shape rows before calling
// computeSandboxCost. This test asserts the filter is at the route
// boundary by reading the route source — runtime invocation needs an
// Ollama stub which is out of scope here.
//
// Run: node --experimental-strip-types --test tests/js/test-specials-cost-action-shape.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTE_PATH = path.resolve(__dirname, '../../app/api/specials/route.js');
const SRC = fs.readFileSync(ROUTE_PATH, 'utf-8');

describe('cost_special payload-shape guard', () => {
  it('extracts a `cleaned` array via .filter before computeSandboxCost', () => {
    // The cost_special block has been replaced with a filter that
    // drops non-string item / non-string unit / non-finite qty rows.
    const block = SRC.slice(SRC.indexOf("payload.action === 'cost_special'"));
    assert.match(
      block,
      /const cleaned = payload\.ingredients\.filter/,
      'route must filter ingredients before compute',
    );
  });

  it('cleaned filter requires typeof item === "string" and non-empty trim', () => {
    const block = SRC.slice(SRC.indexOf("payload.action === 'cost_special'"));
    assert.match(block, /typeof i\.item === 'string'/);
    assert.match(block, /i\.item\.trim\(\)/);
  });

  it('cleaned filter requires typeof unit === "string"', () => {
    const block = SRC.slice(SRC.indexOf("payload.action === 'cost_special'"));
    assert.match(block, /typeof i\.unit === 'string'/);
  });

  it('cleaned filter requires Number.isFinite(Number(qty))', () => {
    const block = SRC.slice(SRC.indexOf("payload.action === 'cost_special'"));
    assert.match(block, /Number\.isFinite\(Number\(i\.qty\)\)/);
  });

  it('computeSandboxCost is called with cleaned, not raw ingredients', () => {
    const block = SRC.slice(SRC.indexOf("payload.action === 'cost_special'"));
    assert.match(
      block,
      /computeSandboxCost\(locationId, cleaned\)/,
      'cleaned (not payload.ingredients) flows into compute',
    );
  });
});
