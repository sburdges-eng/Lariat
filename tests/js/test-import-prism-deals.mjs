// Tests for scripts/import-prism-deals.mjs.
//
// Mirrors the harness in test-import-vendor-prices.mjs: a temp DB path
// is exposed to the spawned CLI by setting CHILD_CWD/data/lariat.db,
// while the in-process test continues using the same file via
// setDbPathForTest. The CLI is run via spawnSync against the temp DB
// so we exercise the actual CLI path, not just internals.
//
// Covers:
//   - Round-trip: write CSV, run importer, query show_deals, assert.
//   - Reject row with no matching show.
//   - Reject row with ambiguous band_name match.
//   - Reject malformed costs_off_top_json.
//   - --dry-run writes nothing.
//   - --overwrite replaces an existing deal; default skips it.
//   - notes column is persisted via upsertDeal.

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

register(new URL('./resolver.mjs', import.meta.url));

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');
const IMPORT_SCRIPT = path.join(REPO_ROOT, 'scripts', 'import-prism-deals.mjs');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-prism-csv-'));
const CHILD_CWD = path.join(TMP_DIR, 'cwd');
fs.mkdirSync(path.join(CHILD_CWD, 'data'), { recursive: true });
const TMP_DB = path.join(CHILD_CWD, 'data', 'lariat.db');
const CSV_DIR = path.join(TMP_DIR, 'csv');
fs.mkdirSync(CSV_DIR, { recursive: true });

const dbMod = await import('../../lib/db.ts');

dbMod.setDbPathForTest(TMP_DB);
dbMod.getDb(); // materialize schema on disk

function openFresh() {
  dbMod.setDbPathForTest(null);
  dbMod.setDbPathForTest(TMP_DB);
  return dbMod.getDb();
}

after(() => {
  dbMod.setDbPathForTest(null);
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

beforeEach(() => {
  const db = openFresh();
  db.exec(`
    DELETE FROM show_deals;
    DELETE FROM shows;
    DELETE FROM ingest_runs;
    DELETE FROM audit_events;
  `);
  // Seed the run row + a deterministic set of historical shows. Mixed
  // dates/names so we can also test ambiguity.
  db.prepare(
    `INSERT INTO ingest_runs (id, kind, started_at, status)
     VALUES (1, 'test', datetime('now'), 'ok')`,
  ).run();
  const shows = [
    [10, 'The Reverb Saints', '2025-09-12'],
    [11, 'Cassette Future', '2025-10-04'],
    [12, 'Holler Mountain', '2025-11-22'],
    // Two shows with the same band on different dates — exact-date match
    // disambiguates.
    [13, 'Doublet', '2025-08-01'],
    [14, 'Doublet', '2025-08-02'],
    // Two shows with the same name on the same date — ambiguous.
    [15, 'Twins', '2025-07-04'],
    [16, 'Twins', '2025-07-04'],
  ];
  const ins = db.prepare(
    `INSERT INTO shows (id, location_id, band_name, show_date, source_row,
                        ingested_at, ingest_run_id)
     VALUES (?, 'default', ?, ?, ?, datetime('now'), 1)`,
  );
  for (const [id, band, date] of shows) ins.run(id, band, date, id);
  dbMod.setDbPathForTest(null);
});

function writeCsv(name, text) {
  const p = path.join(CSV_DIR, name);
  fs.writeFileSync(p, text);
  return p;
}

function runImporter(csvPath, extraArgs = []) {
  return spawnSync(
    'node',
    [IMPORT_SCRIPT, '--csv', csvPath, ...extraArgs],
    { cwd: CHILD_CWD, encoding: 'utf8' },
  );
}

function queryDeals() {
  const db = openFresh();
  const out = db
    .prepare(
      `SELECT show_id, guarantee_cents, vs_pct_after_costs, costs_off_top_json,
              buyout_cents, notes, updated_by_cook_id
         FROM show_deals
        ORDER BY show_id`,
    )
    .all();
  dbMod.setDbPathForTest(null);
  return out;
}

function queryAudit() {
  const db = openFresh();
  const out = db
    .prepare(
      `SELECT entity, action, actor_cook_id, actor_source
         FROM audit_events
        WHERE entity = 'show_deal'
        ORDER BY id`,
    )
    .all();
  dbMod.setDbPathForTest(null);
  return out;
}

const HEADER =
  'band_name,show_date,guarantee,vs_pct_after_costs,costs_off_top_json,buyout,notes\n';

// ── Round-trip ─────────────────────────────────────────────────────

describe('import-prism-deals CLI: round-trip', () => {
  it('imports flat, vs%, and buyout shapes and audits them', () => {
    const csv =
      HEADER +
      'The Reverb Saints,2025-09-12,1000,0.85,"[{""label"":""Sound"",""cents"":5000}]",0,Backfill A\n' +
      'Cassette Future,2025-10-04,1500,,,0,Flat deal\n' +
      'Holler Mountain,2025-11-22,800,0.80,[],250,Includes hospitality\n';
    const p = writeCsv('round-trip.csv', csv);

    const r = runImporter(p);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /wrote 3 deal\(s\)/);

    const deals = queryDeals();
    assert.equal(deals.length, 3);

    const reverb = deals.find((d) => d.show_id === 10);
    assert.equal(reverb.guarantee_cents, 100000);
    assert.equal(reverb.vs_pct_after_costs, 0.85);
    assert.equal(reverb.buyout_cents, 0);
    assert.deepEqual(JSON.parse(reverb.costs_off_top_json), [
      { label: 'Sound', cents: 5000 },
    ]);
    assert.equal(reverb.notes, 'Backfill A');
    assert.equal(reverb.updated_by_cook_id, 'prism-backfill');

    const cassette = deals.find((d) => d.show_id === 11);
    assert.equal(cassette.guarantee_cents, 150000);
    assert.equal(cassette.vs_pct_after_costs, null);
    assert.deepEqual(JSON.parse(cassette.costs_off_top_json), []);

    const holler = deals.find((d) => d.show_id === 12);
    assert.equal(holler.guarantee_cents, 80000);
    assert.equal(holler.vs_pct_after_costs, 0.8);
    assert.equal(holler.buyout_cents, 25000);

    const audit = queryAudit();
    assert.equal(audit.length, 3);
    for (const a of audit) {
      assert.equal(a.action, 'insert');
      assert.equal(a.actor_source, 'prism_backfill');
      assert.equal(a.actor_cook_id, 'prism-backfill');
    }
  });

  it('matches band names case-insensitively after trimming', () => {
    const csv =
      HEADER + '  the REVERB saints  ,2025-09-12,1000,,,0,fuzzy match\n';
    const p = writeCsv('fuzzy.csv', csv);
    const r = runImporter(p);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const deals = queryDeals();
    assert.equal(deals.length, 1);
    assert.equal(deals[0].show_id, 10);
  });
});

// ── Rejections ─────────────────────────────────────────────────────

describe('import-prism-deals CLI: rejections', () => {
  it('rejects a row with no matching show (atomic batch)', () => {
    const csv =
      HEADER +
      'Cassette Future,2025-10-04,1500,,,0,ok row\n' +
      'No Such Band,2025-09-12,1000,,,0,bad row\n';
    const p = writeCsv('no-match.csv', csv);
    const r = runImporter(p);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no show found for "No Such Band"/);
    // Atomic batch: the good row also must not be written.
    assert.equal(queryDeals().length, 0);
  });

  it('rejects a row with an ambiguous band_name match', () => {
    const csv = HEADER + 'Twins,2025-07-04,1000,,,0,ambiguous\n';
    const p = writeCsv('ambig.csv', csv);
    const r = runImporter(p);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /ambiguous match: 2 shows for "Twins"/);
    assert.equal(queryDeals().length, 0);
  });

  it('rejects malformed costs_off_top_json', () => {
    const csv =
      HEADER +
      'Cassette Future,2025-10-04,1500,,"not-json-at-all",0,bad json\n';
    const p = writeCsv('bad-json.csv', csv);
    const r = runImporter(p);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /costs_off_top_json is not valid JSON/);
    assert.equal(queryDeals().length, 0);
  });

  it('rejects costs_off_top_json that parses but has wrong shape', () => {
    const csv =
      HEADER +
      'Cassette Future,2025-10-04,1500,,"[{""label"":""Sound""}]",0,wrong shape\n';
    const p = writeCsv('bad-shape.csv', csv);
    const r = runImporter(p);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /costs_off_top_json\[0\] must be/);
    assert.equal(queryDeals().length, 0);
  });

  it('rejects a vs_pct_after_costs outside [0,1]', () => {
    const csv = HEADER + 'Cassette Future,2025-10-04,1500,1.5,,0,bad pct\n';
    const p = writeCsv('bad-pct.csv', csv);
    const r = runImporter(p);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /vs_pct_after_costs must be blank or a number/);
    assert.equal(queryDeals().length, 0);
  });
});

// ── --dry-run + --overwrite ────────────────────────────────────────

describe('import-prism-deals CLI: flags', () => {
  it('--dry-run writes no rows and exits 0', () => {
    const csv = HEADER + 'Cassette Future,2025-10-04,1500,,,0,dry\n';
    const p = writeCsv('dry.csv', csv);
    const r = runImporter(p, ['--dry-run']);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /DRY RUN/);
    assert.match(r.stdout, /1 would write/);
    assert.equal(queryDeals().length, 0);
  });

  it('skips an existing deal by default and overwrites with --overwrite', () => {
    const csv = HEADER + 'Cassette Future,2025-10-04,1500,,,0,first\n';
    const p = writeCsv('first.csv', csv);
    let r = runImporter(p);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(queryDeals().length, 1);
    assert.equal(queryDeals()[0].guarantee_cents, 150000);

    // Re-run with a different guarantee — default should skip.
    const csv2 = HEADER + 'Cassette Future,2025-10-04,9999,,,0,second\n';
    const p2 = writeCsv('second.csv', csv2);
    r = runImporter(p2);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /1 rows skipped/);
    assert.match(r.stdout, /wrote 0 deal\(s\)/);
    assert.equal(queryDeals()[0].guarantee_cents, 150000); // unchanged

    // Now with --overwrite — should replace + audit as 'correction'.
    r = runImporter(p2, ['--overwrite']);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /wrote 1 deal\(s\)/);
    assert.equal(queryDeals()[0].guarantee_cents, 999900);
    const audit = queryAudit();
    // 1 insert + 1 correction.
    assert.equal(audit.length, 2);
    assert.equal(audit[1].action, 'correction');
  });
});

// ── --encoding ─────────────────────────────────────────────────────

describe('import-prism-deals CLI: --encoding', () => {
  it('rejects an unsupported --encoding label', () => {
    const csv = HEADER + 'Cassette Future,2025-10-04,1500,,,0,enc\n';
    const p = writeCsv('enc-bad.csv', csv);
    const r = runImporter(p, ['--encoding', 'shift-jis']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unsupported --encoding "shift-jis"/);
    assert.equal(queryDeals().length, 0);
  });

  it('warns when reading default UTF-8 (Prism encoding unconfirmed)', () => {
    const csv = HEADER + 'Cassette Future,2025-10-04,1500,,,0,enc\n';
    const p = writeCsv('enc-default.csv', csv);
    const r = runImporter(p);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /reading as UTF-8 \(Prism encoding is unconfirmed/);
  });

  it('reads cp1252-encoded bytes when --encoding cp1252 is passed', () => {
    // Seed an extra show with a non-ASCII band so we can prove the decode
    // happened correctly. The native cp1252 byte for 'é' is 0xE9, which
    // is invalid UTF-8 — so a UTF-8 read of the same bytes produces U+FFFD
    // and the band lookup fails. This test exists to catch a future
    // regression where the flag is silently ignored.
    const dbExtra = openFresh();
    dbExtra
      .prepare(
        `INSERT INTO shows (id, location_id, band_name, show_date, source_row,
                            ingested_at, ingest_run_id)
           VALUES (?, 'default', ?, ?, ?, datetime('now'), 1)`,
      )
      .run(20, 'Café Bleu', '2026-02-14', 20);
    dbMod.setDbPathForTest(null);

    const headerBytes = Buffer.from(HEADER, 'utf-8');
    // Row: "Café Bleu,2026-02-14,500,,,0,enc-cp1252\n" with 0xE9 for 'é'.
    const rowParts = [
      Buffer.from('Caf', 'utf-8'),
      Buffer.from([0xe9]), // 'é' in cp1252
      Buffer.from(' Bleu,2026-02-14,500,,,0,enc-cp1252\n', 'utf-8'),
    ];
    const csvBuf = Buffer.concat([headerBytes, ...rowParts]);
    const p = path.join(CSV_DIR, 'enc-cp1252.csv');
    fs.writeFileSync(p, csvBuf);

    const r = runImporter(p, ['--encoding', 'cp1252']);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const deals = queryDeals();
    assert.equal(deals.length, 1);
    assert.equal(deals[0].show_id, 20);
  });
});
