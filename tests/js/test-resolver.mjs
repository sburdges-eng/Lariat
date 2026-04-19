#!/usr/bin/env node
// Unit tests for the test-only ESM resolver hook.
//
// The resolver's job is to let Next.js-style extensionless imports
// work under plain Node during tests. The rules we care about:
//
//   1. Extensionless specifier: try `.js`, `.mjs`, then `.ts` (JS
//      before TS matches what Next's bundler does — if both exist, the
//      .js file is the one that ships, and tests should load the same
//      file the runtime does).
//   2. `.js` specifier must NOT silently resolve to a `.ts` file. An
//      author who wrote `.js` explicitly should get a loader error if
//      the only thing on disk is `.ts` — that matches the behaviour
//      under Next, and catches typos at test time.
//
// We test the resolve function directly (no `register`) by invoking
// it with a stub `nextResolve` so the assertions aren't coupled to
// Node's module loader internals.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { resolve } = await import('./resolver.mjs');

let TMP_DIR;
let parentURL;

before(() => {
  TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-resolver-'));
  // A dummy "parent" file inside the tmp dir so relative specifiers
  // resolve against it.
  const parent = path.join(TMP_DIR, 'parent.mjs');
  fs.writeFileSync(parent, '// parent placeholder\n');
  parentURL = pathToFileURL(parent).href;

  // Fixtures:
  //   both.js + both.ts   — to test .js-over-.ts preference
  //   only-ts.ts          — to test that `./only-ts.js` does NOT remap
  //   mjs-only.mjs        — to test .mjs preference over .ts
  fs.writeFileSync(path.join(TMP_DIR, 'both.js'), 'export const k = "js";\n');
  fs.writeFileSync(path.join(TMP_DIR, 'both.ts'), 'export const k: string = "ts";\n');
  fs.writeFileSync(path.join(TMP_DIR, 'only-ts.ts'), 'export const k: string = "ts";\n');
  fs.writeFileSync(path.join(TMP_DIR, 'mjs-only.mjs'), 'export const k = "mjs";\n');
});

after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

// Stub: capture what the resolver hands off to the next loader.
function makeNext() {
  const calls = [];
  const next = async (specifier, context) => {
    calls.push({ specifier, context });
    return { url: specifier, format: null, shortCircuit: true };
  };
  return { next, calls };
}

describe('resolver — extensionless', () => {
  it('prefers .js over .ts when both exist', async () => {
    const { next, calls } = makeNext();
    const result = await resolve('./both', { parentURL }, next);
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].specifier.endsWith('/both.js'),
      `expected .js, got ${calls[0].specifier}`);
    assert.ok(result);
  });

  it('resolves to .mjs when only .mjs exists', async () => {
    const { next, calls } = makeNext();
    await resolve('./mjs-only', { parentURL }, next);
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].specifier.endsWith('/mjs-only.mjs'),
      `expected .mjs, got ${calls[0].specifier}`);
  });

  it('falls back to .ts when no JS variant exists', async () => {
    const { next, calls } = makeNext();
    await resolve('./only-ts', { parentURL }, next);
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].specifier.endsWith('/only-ts.ts'),
      `expected .ts, got ${calls[0].specifier}`);
  });
});

describe('resolver — explicit .js extension', () => {
  it('does NOT remap ./only-ts.js to only-ts.ts (author gets a loader error)', async () => {
    const { next, calls } = makeNext();
    // The resolver should pass through to nextResolve with the
    // specifier unchanged. Node's default resolver will then fail to
    // find only-ts.js — which is the point.
    await resolve('./only-ts.js', { parentURL }, next);
    assert.strictEqual(calls.length, 1);
    // Specifier handed off should be the original (unmodified) one.
    assert.strictEqual(calls[0].specifier, './only-ts.js');
  });

  it('passes through ./both.js as-is (does not try .ts fallback)', async () => {
    const { next, calls } = makeNext();
    await resolve('./both.js', { parentURL }, next);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].specifier, './both.js');
  });
});

describe('resolver — bare specifiers', () => {
  it('passes bare package names through unchanged', async () => {
    const { next, calls } = makeNext();
    await resolve('node:fs', { parentURL }, next);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].specifier, 'node:fs');
  });
});
