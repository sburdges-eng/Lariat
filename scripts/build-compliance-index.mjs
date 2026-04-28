#!/usr/bin/env node
// Build a read-only FTS5 index over data/normalized/compliance_rules.jsonl.
//
// Why an in-tree index instead of folding compliance into the off-tree Data
// Pack pipeline (scripts/datapack/build_*.py): the compliance corpus is
// small (kilobytes) and we want it to be available on every dev machine
// without requiring the SSD to be mounted. The FDA Food Code path goes
// through the off-tree pack and gracefully degrades; this index sits
// alongside it and is always available.
//
// Output: data/cache/compliance.db
//   - table compliance_rules     (one row per JSONL record; full payload as JSON)
//   - virtual table compliance_fts (FTS5 over the searchable text fields)
//   - table _meta                (one-row build metadata: built_at, jsonl_sha, rows)
//
// Idempotent: a re-run with the same input sha256 short-circuits unless
// --force is passed. The DB file is built into a .tmp companion and atomically
// renamed on success.
//
// Usage:
//   node scripts/build-compliance-index.mjs
//   node scripts/build-compliance-index.mjs --force
//   node scripts/build-compliance-index.mjs --jsonl <path> --out <path>

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_JSONL = path.join(ROOT, 'data', 'normalized', 'compliance_rules.jsonl');
const DEFAULT_OUT = path.join(ROOT, 'data', 'cache', 'compliance.db');

function sha256File(p) {
  if (!fs.existsSync(p)) return null;
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}

function safeJsonArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === 'string' || typeof v === 'number');
}

/**
 * Convert a parsed JSONL row to the FTS-indexable text payload.
 *
 * Concatenates the searchable fields with newlines so BM25 ranking treats
 * each section as comparable, plus a separate `audience_text` field so
 * audience-based queries (e.g. "what does a bartender need to know about
 * tipped wage") match strongly without flooding the body field.
 */
export function rowToIndexable(row) {
  const parts = [
    row.plain_language_summary || '',
    safeJsonArray(row.required_actions).join('\n'),
    safeJsonArray(row.prohibited_actions).join('\n'),
    safeJsonArray(row.allowed_actions).join('\n'),
    safeJsonArray(row.exceptions).join('\n'),
    safeJsonArray(row.notes).join('\n'),
  ].filter(Boolean);
  return {
    body: parts.join('\n\n'),
    title: `${row.domain || ''} :: ${row.topic || row.id || ''}`,
    audience_text: safeJsonArray(row.audience).join(', '),
  };
}

const SCHEMA_DDL = [
  `CREATE TABLE compliance_rules (
     id            TEXT PRIMARY KEY,
     domain        TEXT NOT NULL,
     jurisdiction  TEXT NOT NULL,
     topic         TEXT NOT NULL,
     audience      TEXT NOT NULL,                   -- JSON array
     verification_status TEXT NOT NULL,
     payload       TEXT NOT NULL                    -- full JSON record
   )`,
  // Use external-content FTS5 to keep the indexed text in sync with the
  // payload row. Insert via the trigger below so both tables stay aligned
  // on a re-run.
  `CREATE VIRTUAL TABLE compliance_fts USING fts5(
     id UNINDEXED,
     domain UNINDEXED,
     title,
     audience_text,
     body,
     tokenize = 'porter ascii'
   )`,
  `CREATE TABLE _meta (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     built_at TEXT NOT NULL,
     jsonl_sha TEXT NOT NULL,
     row_count INTEGER NOT NULL
   )`,
];

export function readJsonlRows(jsonlPath) {
  const text = fs.readFileSync(jsonlPath, 'utf-8');
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (err) {
        throw new Error(`compliance_rules.jsonl line ${i + 1}: ${(err instanceof Error ? err.message : String(err))}`);
      }
    });
}

/**
 * Pure-ish builder: takes a path to the JSONL and an open Database handle
 * and populates it. Caller owns DB lifecycle. Returns a summary the CLI
 * prints. Test entry point — see test-build-compliance-index.mjs.
 */
export function buildIndex(db, opts) {
  const { jsonlPath, jsonlSha } = opts;
  const rows = readJsonlRows(jsonlPath);

  for (const ddl of SCHEMA_DDL) db.exec(ddl);

  const insRule = db.prepare(`
    INSERT INTO compliance_rules (id, domain, jurisdiction, topic, audience, verification_status, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insFts = db.prepare(`
    INSERT INTO compliance_fts (id, domain, title, audience_text, body)
    VALUES (?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((records) => {
    for (const r of records) {
      const idx = rowToIndexable(r);
      insRule.run(
        r.id,
        r.domain,
        r.jurisdiction,
        r.topic,
        JSON.stringify(safeJsonArray(r.audience)),
        r.verification?.status || 'unverified',
        JSON.stringify(r),
      );
      insFts.run(r.id, r.domain, idx.title, idx.audience_text, idx.body);
    }
  });
  tx(rows);

  db.prepare(
    `INSERT OR REPLACE INTO _meta (id, built_at, jsonl_sha, row_count) VALUES (1, ?, ?, ?)`,
  ).run(new Date().toISOString(), jsonlSha, rows.length);

  return { row_count: rows.length };
}

function readCurrentMeta(outPath) {
  if (!fs.existsSync(outPath)) return null;
  try {
    const db = new Database(outPath, { readonly: true, fileMustExist: true });
    const row = db.prepare(`SELECT built_at, jsonl_sha, row_count FROM _meta WHERE id = 1`).get();
    db.close();
    return row || null;
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const jsonlIdx = args.indexOf('--jsonl');
  const outIdx = args.indexOf('--out');
  const jsonlPath = jsonlIdx >= 0 ? path.resolve(args[jsonlIdx + 1]) : DEFAULT_JSONL;
  const outPath = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : DEFAULT_OUT;

  if (!fs.existsSync(jsonlPath)) {
    console.error(`build-compliance-index: input not found: ${jsonlPath}`);
    process.exit(1);
  }

  const jsonlSha = sha256File(jsonlPath);
  const existing = readCurrentMeta(outPath);
  if (!force && existing && existing.jsonl_sha === jsonlSha) {
    console.log(JSON.stringify({
      mode: 'skipped',
      reason: 'sha256 unchanged',
      out: outPath,
      row_count: existing.row_count,
    }, null, 2));
    return;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmpPath = `${outPath}.tmp`;
  if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath);

  const db = new Database(tmpPath);
  try {
    db.pragma('journal_mode = MEMORY');
    db.pragma('synchronous = OFF');
    const { row_count } = buildIndex(db, { jsonlPath, jsonlSha });
    db.close();

    fs.renameSync(tmpPath, outPath);

    console.log(JSON.stringify({
      mode: existing ? 'rebuilt' : 'built',
      out: outPath,
      row_count,
      jsonl_sha: jsonlSha,
    }, null, 2));
  } catch (err) {
    db.close();
    if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath);
    throw err;
  }
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
