// T2 — Display-face token assertions.
// Verifies that tokens.css loads Zilla Slab, --display references it,
// and no CSS source file still hard-codes Instrument Serif.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(import.meta.url), '../../..');

const readCss = (rel) => readFileSync(path.join(root, rel), 'utf8');

const tokens   = readCss('styles/tokens.css');
const globals  = readCss('styles/globals.css');
const uxPolish = readCss('styles/ux-polish.css');
const cookbook = readCss('styles/cookbook.css');

test('tokens.css @import loads Zilla+Slab', () => {
  assert.match(tokens, /Zilla\+Slab/, 'expected Zilla+Slab in @import');
});

test('tokens.css --display references Zilla Slab', () => {
  assert.match(tokens, /--display\s*:[^;]*'Zilla Slab'/, '--display must reference Zilla Slab');
});

const instrumentRe = /Instrument[+ ]Serif/;

test('tokens.css has no Instrument Serif', () => {
  assert.doesNotMatch(tokens, instrumentRe);
});

test('globals.css has no Instrument Serif', () => {
  assert.doesNotMatch(globals, instrumentRe);
});

test('ux-polish.css has no Instrument Serif', () => {
  assert.doesNotMatch(uxPolish, instrumentRe);
});

test('cookbook.css has no Instrument Serif', () => {
  assert.doesNotMatch(cookbook, instrumentRe);
});
