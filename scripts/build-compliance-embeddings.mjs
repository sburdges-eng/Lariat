#!/usr/bin/env node
// Build BGE embeddings over the in-tree compliance corpus.
//
// Companion to scripts/build-compliance-index.mjs (which builds the
// FTS5 BM25 index). Kept as a separate script so the FTS5-only build
// path doesn't have to pull in @huggingface/transformers (~30 MB ONNX
// runtime). Run order:
//
//   1. node scripts/build-compliance-index.mjs       # always
//   2. node scripts/build-compliance-embeddings.mjs  # optional, slow first run
//
// The runtime client (lib/complianceSearch.ts) gracefully degrades
// to BM25-only if the vectors file is missing, so step 2 is opt-in
// per machine.
//
// Output:
//   data/cache/compliance.vectors.npy       — N × 384 float32, L2-normalized
//   data/cache/compliance.vectors.ids.json  — { ids: string[], built_from_db_sha, model }
//
// Idempotent: if the compliance.db file hash matches what's recorded
// in the ids.json sidecar, the embed step short-circuits unless
// --force is passed.
//
// Usage:
//   node scripts/build-compliance-embeddings.mjs
//   node scripts/build-compliance-embeddings.mjs --force
//   node scripts/build-compliance-embeddings.mjs --db <path> --out-dir <dir>

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { writeNpyF32Matrix } from './lib/npy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_DB = path.join(ROOT, 'data', 'cache', 'compliance.db');
const DEFAULT_OUT_DIR = path.join(ROOT, 'data', 'cache');

const MODEL_ID = 'BAAI/bge-small-en-v1.5';
const EXPECTED_DIMS = 384;

function sha256File(p) {
  if (!fs.existsSync(p)) return null;
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}

function vectorsPaths(outDir) {
  return {
    npy: path.join(outDir, 'compliance.vectors.npy'),
    ids: path.join(outDir, 'compliance.vectors.ids.json'),
  };
}

function readSidecar(idsPath) {
  if (!fs.existsSync(idsPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(idsPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Read every (id, body) pair from a compliance.db. Body is the same
 * text the FTS5 index ranks against, so the semantic and lexical
 * indexes score over identical inputs.
 *
 * Returns rows ordered by id ASC for determinism (a re-build with
 * the same DB produces the same vectors.npy byte-for-byte modulo
 * floating-point nondeterminism in transformers.js).
 */
export function readBodies(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare(
        `SELECT compliance_fts.id AS id, compliance_fts.body AS body
           FROM compliance_fts
           ORDER BY id ASC`,
      )
      .all();
    return rows;
  } finally {
    db.close();
  }
}

/**
 * Encode N bodies to an N×dims Float32Array using transformers.js
 * BGE feature-extraction with mean pooling and L2 normalization.
 *
 * Documents are encoded WITHOUT the asymmetric retrieval prefix —
 * the prefix goes on the query side at search time. This matches
 * the convention used by lib/datapackSearch.ts and the BGE model
 * card.
 */
export async function encodeBodies(bodies) {
  const { pipeline } = await import('@huggingface/transformers');
  const fe = await pipeline('feature-extraction', MODEL_ID);
  const out = new Float32Array(bodies.length * EXPECTED_DIMS);
  for (let i = 0; i < bodies.length; i++) {
    const result = await fe([bodies[i]], { pooling: 'mean', normalize: true });
    const v = result.data;
    if (v.length !== EXPECTED_DIMS) {
      throw new Error(
        `embed: row ${i} returned ${v.length} dims, expected ${EXPECTED_DIMS}`,
      );
    }
    out.set(v, i * EXPECTED_DIMS);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dbIdx = args.indexOf('--db');
  const outIdx = args.indexOf('--out-dir');
  const dbPath = dbIdx >= 0 ? path.resolve(args[dbIdx + 1]) : DEFAULT_DB;
  const outDir = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : DEFAULT_OUT_DIR;

  if (!fs.existsSync(dbPath)) {
    console.error(`build-compliance-embeddings: compliance.db not found at ${dbPath}`);
    console.error('Run scripts/build-compliance-index.mjs first.');
    process.exit(1);
  }

  const dbSha = sha256File(dbPath);
  const { npy: npyPath, ids: idsPath } = vectorsPaths(outDir);
  const sidecar = readSidecar(idsPath);
  if (!force && sidecar && sidecar.built_from_db_sha === dbSha && fs.existsSync(npyPath)) {
    console.log(JSON.stringify({
      mode: 'skipped',
      reason: 'db sha unchanged',
      out: npyPath,
      row_count: sidecar.ids.length,
    }, null, 2));
    return;
  }

  const rows = readBodies(dbPath);
  if (rows.length === 0) {
    console.error('build-compliance-embeddings: compliance.db has zero rows; nothing to embed.');
    process.exit(1);
  }

  console.error(`embedding ${rows.length} compliance rows via ${MODEL_ID} ...`);
  const bodies = rows.map((r) => r.body);
  const ids = rows.map((r) => r.id);

  const startedAt = Date.now();
  const matrix = await encodeBodies(bodies);
  const elapsedMs = Date.now() - startedAt;

  fs.mkdirSync(outDir, { recursive: true });
  writeNpyF32Matrix(npyPath, matrix, rows.length, EXPECTED_DIMS);
  fs.writeFileSync(
    idsPath,
    JSON.stringify(
      {
        built_at: new Date().toISOString(),
        built_from_db_sha: dbSha,
        model: MODEL_ID,
        dims: EXPECTED_DIMS,
        ids,
      },
      null,
      2,
    ),
  );

  console.log(JSON.stringify({
    mode: sidecar ? 'rebuilt' : 'built',
    out: npyPath,
    row_count: rows.length,
    dims: EXPECTED_DIMS,
    elapsed_ms: elapsedMs,
  }, null, 2));
}

const isMain = (() => {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return import.meta.url === new URL(`file://${path.resolve(arg)}`).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  await main();
}
