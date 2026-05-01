// Minimal NumPy v1 .npy writer for 2-D `<f4` (little-endian float32)
// matrices. Mirrors the parser shape used at runtime in
// lib/datapackSearch.ts::parseNpyHeader so the in-tree compliance
// embeddings live-load with the same code path the off-tree Data
// Pack uses.
//
// We support only one shape (2-D, float32, C-order, little-endian)
// because that's the only shape the consumer parser accepts. Any
// other input shape is a programming error caught by the consumer
// at load time, not silent breakage.
//
// Reference: https://numpy.org/doc/stable/reference/generated/numpy.lib.format.html

import fs from 'node:fs';

/**
 * Build the 10-byte preamble + ASCII header for a 2-D `<f4` array,
 * padded to a 16-byte multiple per the .npy v1 spec.
 *
 * Returns the full Buffer (preamble + header + trailing newline).
 */
export function npyV1Header(rows, dims) {
  if (!Number.isInteger(rows) || rows < 0)
    throw new Error(`npyV1Header: rows must be a non-negative integer, got ${rows}`);
  if (!Number.isInteger(dims) || dims < 0)
    throw new Error(`npyV1Header: dims must be a non-negative integer, got ${dims}`);

  const dictBody = `{'descr': '<f4', 'fortran_order': False, 'shape': (${rows}, ${dims}), }`;
  // Per spec, total header length (10 magic+version+len bytes + the
  // ASCII dict) must be a multiple of 16. The dict ends with '\n'.
  const PREAMBLE_LEN = 10;
  let padded = dictBody;
  // Pad with spaces, leaving room for trailing '\n'.
  while ((PREAMBLE_LEN + padded.length + 1) % 16 !== 0) padded += ' ';
  padded += '\n';
  if (padded.length > 0xffff) {
    throw new Error(`npyV1Header: header too large for v1 (${padded.length} bytes); use v2`);
  }

  const buf = Buffer.alloc(PREAMBLE_LEN + padded.length);
  buf[0] = 0x93;
  buf.write('NUMPY', 1, 'ascii');
  buf[6] = 1; // major
  buf[7] = 0; // minor
  buf.writeUInt16LE(padded.length, 8);
  buf.write(padded, PREAMBLE_LEN, 'ascii');
  return buf;
}

/**
 * Write a 2-D `<f4` matrix at `filePath`. `data` is a Float32Array
 * of length rows*dims, C-order. The .npy file is written via a
 * temp+rename so a partial write never leaves a corrupt file in
 * place for the consumer.
 */
export function writeNpyF32Matrix(filePath, data, rows, dims) {
  if (!(data instanceof Float32Array)) {
    throw new Error('writeNpyF32Matrix: data must be a Float32Array');
  }
  if (data.length !== rows * dims) {
    throw new Error(
      `writeNpyF32Matrix: data length ${data.length} != rows*dims (${rows}*${dims}=${rows * dims})`,
    );
  }

  const header = npyV1Header(rows, dims);
  const body = Buffer.from(data.buffer, data.byteOffset, data.byteLength);

  const tmp = `${filePath}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, header);
    if (body.byteLength > 0) fs.writeSync(fd, body);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}
