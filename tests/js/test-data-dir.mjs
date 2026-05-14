#!/usr/bin/env node
// Tests for lib/dataDir.ts — the shared LARIAT_DATA_DIR resolver.
//
// Run: node --experimental-strip-types --test tests/js/test-data-dir.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const { resolveDataDir, dataPath } = await import('../../lib/dataDir.ts');

test('resolveDataDir returns cwd/data when env is unset', () => {
  delete process.env.LARIAT_DATA_DIR;
  assert.equal(resolveDataDir(), path.join(process.cwd(), 'data'));
});

test('resolveDataDir returns env-resolved absolute path when set', () => {
  process.env.LARIAT_DATA_DIR = '/tmp/lariat-data';
  try {
    assert.equal(resolveDataDir(), '/tmp/lariat-data');
  } finally {
    delete process.env.LARIAT_DATA_DIR;
  }
});

test('resolveDataDir treats whitespace-only env as unset', () => {
  process.env.LARIAT_DATA_DIR = '   ';
  try {
    assert.equal(resolveDataDir(), path.join(process.cwd(), 'data'));
  } finally {
    delete process.env.LARIAT_DATA_DIR;
  }
});

test('resolveDataDir resolves relative paths against cwd', () => {
  process.env.LARIAT_DATA_DIR = 'subdir/data';
  try {
    assert.equal(resolveDataDir(), path.resolve('subdir/data'));
  } finally {
    delete process.env.LARIAT_DATA_DIR;
  }
});

test('resolveDataDir reads env at every call (not captured at import)', () => {
  delete process.env.LARIAT_DATA_DIR;
  const a = resolveDataDir();
  process.env.LARIAT_DATA_DIR = '/tmp/other-data';
  try {
    const b = resolveDataDir();
    assert.notEqual(a, b);
    assert.equal(b, '/tmp/other-data');
  } finally {
    delete process.env.LARIAT_DATA_DIR;
  }
});

test('dataPath joins segments after the resolved root', () => {
  delete process.env.LARIAT_DATA_DIR;
  assert.equal(
    dataPath('cache', 'allergen_matrix.json'),
    path.join(process.cwd(), 'data', 'cache', 'allergen_matrix.json'),
  );
});

test('dataPath honors env override too', () => {
  process.env.LARIAT_DATA_DIR = '/tmp/dx';
  try {
    assert.equal(dataPath('exports', 'foo.html'), '/tmp/dx/exports/foo.html');
  } finally {
    delete process.env.LARIAT_DATA_DIR;
  }
});

test('dataPath with no segments returns the data dir itself', () => {
  delete process.env.LARIAT_DATA_DIR;
  assert.equal(dataPath(), path.join(process.cwd(), 'data'));
});
