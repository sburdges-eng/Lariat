#!/usr/bin/env node
// Keyboard hints must be one-to-one. Duplicate shortcut letters make the
// rail and command palette unpredictable.
//
// Run: node --experimental-strip-types --test tests/js/test-nav-shortcuts.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { PALETTE_ITEMS, SIDEBAR_ITEMS } = await import('../../app/_components/navRegistry.js');

function duplicateShortcuts(items) {
  const seen = new Map();
  const dupes = [];
  for (const item of items) {
    if (!item.shortcut) continue;
    const key = item.shortcut.toUpperCase();
    if (seen.has(key)) dupes.push(`${key}: ${seen.get(key)} / ${item.id}`);
    else seen.set(key, item.id);
  }
  return dupes;
}

describe('nav shortcuts', () => {
  it('has no duplicate shortcut keys in the sidebar', () => {
    assert.deepEqual(duplicateShortcuts(SIDEBAR_ITEMS), []);
  });

  it('has no duplicate shortcut keys in the command palette', () => {
    assert.deepEqual(duplicateShortcuts(PALETTE_ITEMS), []);
  });
});
