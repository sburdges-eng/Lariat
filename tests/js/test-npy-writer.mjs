#!/usr/bin/env node
// Round-trip + spec tests for scripts/lib/npy.mjs.
//
// Run: node --test tests/js/test-npy-writer.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const npy = await import('../../scripts/lib/npy.mjs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-npy-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe('npyV1Header', () => {
  it('starts with magic + version 1', () => {
    const h = npy.npyV1Header(3, 4);
    assert.equal(h[0], 0x93);
    assert.equal(h.toString('ascii', 1, 6), 'NUMPY');
    assert.equal(h[6], 1);
    assert.equal(h[7], 0);
  });

  it('total header length is a multiple of 16', () => {
    for (const [r, d] of [[1, 1], [3, 4], [46, 384]]) {
      const h = npy.npyV1Header(r, d);
      assert.equal(h.length % 16, 0, `rows=${r} dims=${d}`);
    }
  });

  it('header descr/order/shape match spec literal', () => {
    const h = npy.npyV1Header(2, 3);
    const dictText = h.toString('ascii', 10);
    assert.match(dictText, /'descr': '<f4'/);
    assert.match(dictText, /'fortran_order': False/);
    assert.match(dictText, /'shape': \(2, 3\)/);
    assert.equal(dictText[dictText.length - 1], '\n');
  });

  it('rejects negative or non-integer dims', () => {
    assert.throws(() => npy.npyV1Header(-1, 3));
    assert.throws(() => npy.npyV1Header(3, -1));
    assert.throws(() => npy.npyV1Header(3.5, 3));
  });
});

describe('writeNpyF32Matrix', () => {
  it('writes a parseable file (header + body match)', () => {
    const data = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
    const out = path.join(TMP, 'small.npy');
    npy.writeNpyF32Matrix(out, data, 2, 3);

    const buf = fs.readFileSync(out);
    assert.equal(buf[0], 0x93);
    assert.equal(buf.toString('ascii', 1, 6), 'NUMPY');
    const headerLen = buf.readUInt16LE(8);
    const dataOffset = 10 + headerLen;

    const body = new Float32Array(buf.buffer, buf.byteOffset + dataOffset, 6);
    assert.deepEqual(Array.from(body), [1, 2, 3, 4, 5, 6]);
  });

  it('rejects size mismatch', () => {
    assert.throws(
      () => npy.writeNpyF32Matrix(path.join(TMP, 'x.npy'), new Float32Array(5), 2, 3),
      /data length 5 != rows\*dims/,
    );
  });

  it('rejects non-Float32Array', () => {
    assert.throws(
      () => npy.writeNpyF32Matrix(path.join(TMP, 'x.npy'), [1, 2, 3, 4, 5, 6], 2, 3),
      /must be a Float32Array/,
    );
  });

  it('handles 0-row matrix (header only, no body)', () => {
    const out = path.join(TMP, 'empty.npy');
    npy.writeNpyF32Matrix(out, new Float32Array(0), 0, 384);
    const buf = fs.readFileSync(out);
    const headerLen = buf.readUInt16LE(8);
    assert.equal(buf.length, 10 + headerLen);
  });
});

// Round-trip against the existing consumer parser at
// lib/datapackSearch.ts — verifies the in-tree compliance vectors
// will load via the same path the off-tree Data Pack uses.
describe('round-trip with datapackSearch parser', () => {
  it('writes a file that the consumer parser accepts', async () => {
    // Numpy reference values (3 rows × 4 dims). Picking small
    // distinct values so a misaligned read would surface obviously.
    const data = new Float32Array([
      0.1, 0.2, 0.3, 0.4,
      0.5, 0.6, 0.7, 0.8,
      0.9, 1.0, 1.1, 1.2,
    ]);
    const out = path.join(TMP, 'roundtrip.npy');
    npy.writeNpyF32Matrix(out, data, 3, 4);

    // Re-implement just enough of the consumer header parse to
    // assert compatibility without pulling the whole transformers.js
    // import chain. This mirrors lib/datapackSearch.ts::parseNpyHeader.
    const buf = fs.readFileSync(out);
    assert.equal(buf[0], 0x93);
    assert.equal(buf.toString('ascii', 1, 6), 'NUMPY');
    const major = buf[6];
    assert.equal(major, 1);
    const headerLen = buf.readUInt16LE(8);
    const dataOffset = 10 + headerLen;
    const header = buf.toString('ascii', 10, dataOffset);
    const descrMatch = header.match(/'descr'\s*:\s*'([^']+)'/);
    const fortranMatch = header.match(/'fortran_order'\s*:\s*(True|False)/);
    const shapeMatch = header.match(/'shape'\s*:\s*\(([^)]*)\)/);
    assert.ok(descrMatch && fortranMatch && shapeMatch);
    assert.equal(descrMatch[1], '<f4');
    assert.equal(fortranMatch[1], 'False');
    const dims = shapeMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number.parseInt(s, 10));
    assert.deepEqual(dims, [3, 4]);

    const body = new Float32Array(
      buf.buffer.slice(buf.byteOffset + dataOffset, buf.byteOffset + dataOffset + 12 * 4),
    );
    for (let i = 0; i < 12; i++) {
      assert.ok(Math.abs(body[i] - data[i]) < 1e-6, `index ${i}`);
    }
  });
});
