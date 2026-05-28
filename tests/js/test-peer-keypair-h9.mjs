#!/usr/bin/env node
// Tests for audit H9 — defaultKeypairPath() is lazy (call-time)
// rather than module-load-time, matching the lazy contract from
// lib/dataDir.ts. Pre-fix, DEFAULT_KEYPAIR_PATH was a top-level
// const captured at import time; a test/Electron flow that set
// LARIAT_DATA_DIR after this module loaded got the wrong path.
//
// Run: node --experimental-strip-types --test tests/js/test-peer-keypair-h9.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

const { defaultKeypairPath, DEFAULT_KEYPAIR_PATH } = await import(
  '../../lib/peerKeypair.ts'
);

test('defaultKeypairPath returns <cwd>/data/peer-keypair.json when env unset', () => {
  delete process.env.LARIAT_DATA_DIR;
  assert.equal(
    defaultKeypairPath(),
    path.join(process.cwd(), 'data', 'peer-keypair.json'),
  );
});

test('defaultKeypairPath honors LARIAT_DATA_DIR set AFTER import (H9 lazy contract)', () => {
  const dataDir = path.join(os.tmpdir(), 'relocated-lariat');
  process.env.LARIAT_DATA_DIR = dataDir;
  try {
    assert.equal(
      defaultKeypairPath(),
      path.join(dataDir, 'peer-keypair.json'),
    );
  } finally {
    delete process.env.LARIAT_DATA_DIR;
  }
});

test('defaultKeypairPath reads env at every call (no captured-value drift)', () => {
  delete process.env.LARIAT_DATA_DIR;
  const a = defaultKeypairPath();
  const otherDataDir = path.join(os.tmpdir(), 'other');
  process.env.LARIAT_DATA_DIR = otherDataDir;
  try {
    const b = defaultKeypairPath();
    assert.notEqual(a, b);
    assert.equal(b, path.join(otherDataDir, 'peer-keypair.json'));
  } finally {
    delete process.env.LARIAT_DATA_DIR;
  }
});

test('legacy DEFAULT_KEYPAIR_PATH const is still exported (back-compat)', () => {
  // Audit H9 deprecates this const but keeps it around for callers
  // that only read it for logging. Confirm it's still importable as
  // a string.
  assert.equal(typeof DEFAULT_KEYPAIR_PATH, 'string');
});
