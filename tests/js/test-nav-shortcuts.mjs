#!/usr/bin/env node
// Keyboard hints must be one-to-one. Duplicate shortcut letters make the
// rail and command palette unpredictable.
//
// Run: node --experimental-strip-types --test tests/js/test-nav-shortcuts.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { NAV_ITEMS, NAV_ROUTE_EXCLUSIONS, PALETTE_ITEMS, SIDEBAR_ITEMS, requiresManagerPinPath } = await import(
  '../../app/_components/navRegistry.js'
);

const SETUP_AUTH_ROUTES = ['/install', '/login-pin'];
const MANAGER_PIN_ROUTES = [
  '/analytics',
  '/costing',
  '/purchasing',
  '/menu-engineering',
  '/beo',
  '/management',
  '/booking',
  '/playbook',
  '/shows/tonight',
  '/specials/saved',
  '/host',
];

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

describe('nav route coverage', () => {
  it('explicitly excludes setup and auth routes from the palette', () => {
    assert.equal(Array.isArray(NAV_ROUTE_EXCLUSIONS), true);

    const excluded = new Set(NAV_ROUTE_EXCLUSIONS.map((route) => route.href));
    const palette = new Set(PALETTE_ITEMS.map((route) => route.href));
    const sidebar = new Set(SIDEBAR_ITEMS.map((route) => route.href));

    for (const href of SETUP_AUTH_ROUTES) {
      assert.equal(excluded.has(href), true, `${href} needs a nav exclusion entry`);
      assert.equal(palette.has(href), false, `${href} must stay out of the command palette`);
      assert.equal(sidebar.has(href), false, `${href} must stay out of the sidebar`);
    }
  });
});

describe('manager PIN nav affordance', () => {
  it('identifies the same sensitive page prefixes as the middleware gate', () => {
    assert.equal(typeof requiresManagerPinPath, 'function');

    for (const href of MANAGER_PIN_ROUTES) {
      assert.equal(requiresManagerPinPath(href), true, `${href} should show a PIN affordance`);
    }

    assert.equal(requiresManagerPinPath('/beo/share/public-token'), false);
    assert.equal(requiresManagerPinPath('/recipes'), false);
    assert.equal(requiresManagerPinPath('/specials'), false);
  });

  it('marks registered sensitive routes as manager PIN surfaces', () => {
    const missing = NAV_ITEMS
      .filter((item) => requiresManagerPinPath(item.href))
      .filter((item) => item.managerOnly !== true)
      .map((item) => item.href);

    assert.deepEqual(missing, []);
  });
});
