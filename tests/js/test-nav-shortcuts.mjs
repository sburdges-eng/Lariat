#!/usr/bin/env node
// Keyboard hints must be one-to-one. Duplicate shortcut letters make the
// rail and command palette unpredictable.
//
// Run: node --experimental-strip-types --test tests/js/test-nav-shortcuts.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

register(new URL('./resolver.mjs', import.meta.url));

const { NAV_ITEMS, NAV_ROUTE_EXCLUSIONS, PALETTE_ITEMS, SIDEBAR_ITEMS, requiresManagerPinPath } = await import(
  '../../app/_components/navRegistry.js'
);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP_DIR = path.join(REPO_ROOT, 'app');
const PAGE_FILE_NAMES = new Set(['page.js', 'page.jsx', 'page.ts', 'page.tsx']);
const SETUP_AUTH_ROUTES = ['/install', '/login-pin'];
const MANAGER_PIN_ROUTES = [
  '/analytics',
  '/costing',
  '/purchasing',
  '/menu-engineering',
  '/beo',
  '/management',
  '/morning',
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

function walkPageFiles(dir) {
  const pageFiles = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      pageFiles.push(...walkPageFiles(fullPath));
    } else if (entry.isFile() && PAGE_FILE_NAMES.has(entry.name)) {
      pageFiles.push(fullPath);
    }
  }
  return pageFiles;
}

function routeFromPageFile(pageFile) {
  const relativePath = path.relative(APP_DIR, pageFile);
  const segments = relativePath.split(path.sep);
  segments.pop();

  const routeSegments = segments.filter((segment) => {
    if (segment.startsWith('(') && segment.endsWith(')')) return false;
    return !segment.startsWith('@');
  });

  return routeSegments.length === 0 ? '/' : `/${routeSegments.join('/')}`;
}

function staticAppPageRoutes() {
  return [
    ...new Set(
      walkPageFiles(APP_DIR)
        .map(routeFromPageFile)
        .filter((href) => !href.includes('['))
    ),
  ].sort();
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

  it('registers or explicitly excludes every non-dynamic app page', () => {
    const covered = new Set([
      ...NAV_ITEMS.map((item) => item.href),
      ...NAV_ROUTE_EXCLUSIONS.map((route) => route.href),
    ]);
    const missing = staticAppPageRoutes().filter((href) => !covered.has(href));

    assert.deepEqual(missing, []);
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
