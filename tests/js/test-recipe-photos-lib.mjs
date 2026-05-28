#!/usr/bin/env node
// Unit tests for lib/recipePhotos.ts — pure-disk storage helper.
//
// Covers:
//   - storePhoto sanitizes the slug (path separators, dots stripped).
//   - extFromMime falls back to the mime-canonical extension when the
//     original filename has no extension.
//   - storePhoto returns size_bytes matching the input buffer length.
//
// Run: node --experimental-strip-types --test tests/js/test-recipe-photos-lib.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ORIGINAL_CWD = process.cwd();
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-recipe-photos-lib-'));
process.chdir(TMP_DIR);

const lib = await import('../../lib/recipePhotos.ts');

after(() => {
  process.chdir(ORIGINAL_CWD);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('storePhoto — slug sanitization', () => {
  it('strips path separators from the slug so files cannot escape the uploads root', async () => {
    const bytes = Buffer.from('not-actually-an-image');
    const stored = await lib.storePhoto('../../evil/path', bytes, 'image/png', 'x.png');
    // Stored path must live under data/uploads/recipes/, not above it.
    // realpath both sides because macOS can expose the same temp path
    // through multiple root prefixes; we care about logical containment.
    const realUploadsRoot = fs.realpathSync(path.join(TMP_DIR, 'data', 'uploads', 'recipes'));
    const realStored = fs.realpathSync(stored.stored_path);
    assert.ok(
      realStored.startsWith(realUploadsRoot + path.sep),
      `stored_path should be inside ${realUploadsRoot}, got ${realStored}`,
    );
    // The sanitized slug should contain no separators or dots.
    const rel = realStored.slice(realUploadsRoot.length + 1);
    const slugSegment = rel.split(path.sep)[0];
    assert.ok(!slugSegment.includes('/') && !slugSegment.includes('\\') && !slugSegment.includes('..'),
      `slug segment should be sanitized, got "${slugSegment}"`);
  });
});

describe('storePhoto — extension derivation', () => {
  it('falls back to the mime-canonical extension when the original name has none', async () => {
    const bytes = Buffer.from('dummy-bytes');
    const stored = await lib.storePhoto('plated_eggs', bytes, 'image/webp', 'no_ext_here');
    assert.ok(stored.stored_path.endsWith('.webp'),
      `expected .webp extension fallback, got ${stored.stored_path}`);
  });

  it('uses the original filename extension when present', async () => {
    const bytes = Buffer.from('dummy-bytes');
    const stored = await lib.storePhoto('plated_eggs', bytes, 'image/jpeg', 'IMG_4422.JPG');
    assert.ok(stored.stored_path.toLowerCase().endsWith('.jpg'),
      `expected .jpg from original filename, got ${stored.stored_path}`);
  });
});

describe('storePhoto — size and contents', () => {
  it('returns size_bytes matching the input buffer length', async () => {
    const bytes = Buffer.alloc(123, 0x42);
    const stored = await lib.storePhoto('sized', bytes, 'image/png', 'a.png');
    assert.equal(stored.size_bytes, 123);
    const onDisk = fs.readFileSync(stored.stored_path);
    assert.equal(onDisk.byteLength, 123);
  });
});
