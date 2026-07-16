#!/usr/bin/env node
// Tests for scripts/phase-c-reconcile.mjs (Phase C §C4 shadow/dual-write
// reconciliation) and scripts/phase-c-backup.sh (Precondition #4 backup +
// restore-verify tooling).
//
// Everything runs against throwaway fixtures in os.tmpdir() — the real
// data/lariat.db and data/audit are NEVER touched. The fixture schema is a
// deliberately small mirror of the lib/db.ts tables the checks care about
// (audit_events + one audit-covered mutation table + one money table),
// NOT the full web schema.
//
// Run: node --test tests/js/test-phase-c-reconcile.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RECONCILE_SCRIPT = path.join(ROOT, 'scripts', 'phase-c-reconcile.mjs');
const BACKUP_SCRIPT = path.join(ROOT, 'scripts', 'phase-c-backup.sh');

const {
  CANONICAL_ACTOR_SOURCES,
  AUDIT_COVERED_TABLES,
  checkWriterAttribution,
  checkAuditCoverage,
  checkMoneyChecksums,
  checkCanonicalActorSources,
  runReconcile,
} = await import('../../scripts/phase-c-reconcile.mjs');

// ── Fixture ─────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);
const D1 = '2026-06-28'; // fixed past days — always < TODAY
const D2 = '2026-06-29';

let workRoot;
before(() => {
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-c4-reconcile-'));
});
after(() => {
  fs.rmSync(workRoot, { recursive: true, force: true });
});

function tmpDir(name) {
  const dir = fs.mkdtempSync(path.join(workRoot, `${name}-`));
  return dir;
}

/**
 * Minimal fixture mirroring the shapes the checks discover:
 *  - audit_events: the A1 trail (actor_source + created_at)
 *  - temp_log: audit-covered mutation table (created_at, no actor_source)
 *  - tip_pool_distributions: money table (amount_cents, shift_date)
 *  - allergen_attestations: audit-covered via singular entity alias
 *  - locations + staff: core tables for the backup verify spot-check
 *  - shadow_writes: fixture-only table with a nullable actor_source column
 *    (the post-C3 shape) to exercise generic PRAGMA-based discovery
 */
function buildFixtureDb(dbPath) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      location_id TEXT DEFAULT 'default',
      actor_cook_id TEXT,
      actor_source TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id INTEGER,
      action TEXT NOT NULL,
      replaces_id INTEGER,
      payload_json TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE temp_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      location_id TEXT DEFAULT 'default',
      cook_id TEXT,
      reading_f REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE tip_pool_distributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT DEFAULT 'default',
      shift_date TEXT NOT NULL,
      pool_ref TEXT NOT NULL,
      cook_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE allergen_attestations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT DEFAULT 'default',
      cook_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE shadow_writes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_source TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    -- audit-covered table with NO timestamp column (bulk/config shape, e.g.
    -- order_guide_items) — cannot be scoped to a --since window.
    CREATE TABLE order_guide_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingredient TEXT NOT NULL
    );
  `);
  return db;
}

function insertAudit(db, { entity, entityId, actorSource = 'cook_ui', day = D1, action = 'insert' }) {
  db.prepare(
    `INSERT INTO audit_events
       (shift_date, actor_source, entity, entity_id, action, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(day, actorSource, entity, entityId, action, `${day} 18:00:00`);
}

/** A green fixture: every mutation row has its audit row, all actor_source canonical. */
function seedGreen(db) {
  db.prepare(`INSERT INTO locations (id, name) VALUES ('default', 'Lariat')`).run();
  insertAudit(db, { entity: 'locations', entityId: 1, actorSource: 'manager_ui' });

  db.prepare(`INSERT INTO staff (name) VALUES ('Sam Cook')`).run();

  db.prepare(
    `INSERT INTO temp_log (shift_date, cook_id, reading_f, created_at)
     VALUES (?, 'c1', 38.2, ?)`
  ).run(D1, `${D1} 09:00:00`);
  insertAudit(db, { entity: 'temp_log', entityId: 1, actorSource: 'cook_ui', day: D1 });

  db.prepare(
    `INSERT INTO tip_pool_distributions
       (shift_date, pool_ref, cook_id, kind, amount_cents, created_at)
     VALUES (?, 'p1', 'c1', 'tip_pool', 12500, ?)`
  ).run(D1, `${D1} 23:00:00`);
  insertAudit(db, { entity: 'tip_pool_distributions', entityId: 1, actorSource: 'manager_ui', day: D1 });

  db.prepare(
    `INSERT INTO tip_pool_distributions
       (shift_date, pool_ref, cook_id, kind, amount_cents, created_at)
     VALUES (?, 'p2', 'c2', 'tip_pool', 8000, ?)`
  ).run(D2, `${D2} 23:00:00`);
  insertAudit(db, { entity: 'tip_pool_distributions', entityId: 2, actorSource: 'native_mac', day: D2 });

  db.prepare(`INSERT INTO allergen_attestations (cook_id, created_at) VALUES ('c1', ?)`)
    .run(`${D1} 10:00:00`);
  insertAudit(db, { entity: 'allergen_attestation', entityId: 1, actorSource: 'manager_ui', day: D1 });

  db.prepare(`INSERT INTO shadow_writes (actor_source, created_at) VALUES ('native_cook', ?)`)
    .run(`${D1} 12:00:00`);
}

function freshGreenDbPath(name) {
  const dir = tmpDir(name);
  const dbPath = path.join(dir, 'fixture.db');
  const db = buildFixtureDb(dbPath);
  seedGreen(db);
  db.close();
  return { dir, dbPath };
}

function openRw(dbPath) {
  return new Database(dbPath);
}

function failures(rows) {
  return rows.filter((r) => r.result === 'FAIL');
}

// ── Canonical actor_source set ──────────────────────────────────────

describe('CANONICAL_ACTOR_SOURCES', () => {
  it('equals the shared actor_source fixture (SSOT)', () => {
    // Single source of truth shared with the native enum; the cross-language
    // gate lives in tests/js/test-actor-source-parity.mjs + ActorSourceTests.swift.
    const expected = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'actor_source_canonical.json'), 'utf8'),
    ).values;
    for (const v of expected) {
      assert.ok(CANONICAL_ACTOR_SOURCES.has(v), `missing canonical value: ${v}`);
    }
    assert.equal(CANONICAL_ACTOR_SOURCES.size, expected.length);
  });

  it('audit-covered table map keys are table names with entity aliases', () => {
    assert.deepEqual(AUDIT_COVERED_TABLES.temp_log, ['temp_log']);
    assert.deepEqual(AUDIT_COVERED_TABLES.allergen_attestations, ['allergen_attestation']);
    assert.deepEqual(AUDIT_COVERED_TABLES.show_deals, ['show_deal']);
  });
});

// ── Check 1: writer attribution ─────────────────────────────────────

describe('checkWriterAttribution', () => {
  it('passes when every actor_source-bearing row is attributed', () => {
    const { dbPath } = freshGreenDbPath('attr-pass');
    const db = openRw(dbPath);
    const rows = checkWriterAttribution(db);
    db.close();
    assert.equal(failures(rows).length, 0);
    assert.ok(rows.some((r) => r.result === 'PASS'));
  });

  it('fails on a day with NULL/empty actor_source rows', () => {
    const { dbPath } = freshGreenDbPath('attr-fail');
    const db = openRw(dbPath);
    db.prepare(`INSERT INTO shadow_writes (actor_source, created_at) VALUES (NULL, ?)`)
      .run(`${D2} 12:00:00`);
    db.prepare(`INSERT INTO shadow_writes (actor_source, created_at) VALUES ('', ?)`)
      .run(`${D2} 13:00:00`);
    const rows = checkWriterAttribution(db);
    db.close();
    const fails = failures(rows);
    assert.equal(fails.length, 1);
    assert.match(fails[0].scope, /shadow_writes/);
    assert.match(fails[0].detail, new RegExp(D2));
    assert.match(fails[0].detail, /2/); // two unattributed rows
  });

  it('reports mutation tables without actor_source as a single INFO list, not FAIL', () => {
    const { dbPath } = freshGreenDbPath('attr-info');
    const db = openRw(dbPath);
    const rows = checkWriterAttribution(db);
    db.close();
    const infos = rows.filter((r) => r.result === 'INFO');
    assert.equal(infos.length, 1);
    assert.match(infos[0].detail, /temp_log/);
    assert.match(infos[0].detail, /tip_pool_distributions/);
    // tables WITH actor_source must not be in the unattributable list
    assert.doesNotMatch(infos[0].detail, /shadow_writes/);
    assert.doesNotMatch(infos[0].detail, /audit_events/);
  });
});

// ── Check 2: audit coverage ─────────────────────────────────────────

describe('checkAuditCoverage', () => {
  it('passes when every covered mutation row has its audit_events row', () => {
    const { dbPath } = freshGreenDbPath('cov-pass');
    const db = openRw(dbPath);
    const rows = checkAuditCoverage(db, {});
    db.close();
    assert.equal(failures(rows).length, 0);
  });

  it('fails on an orphan mutation row and lists example ids', () => {
    const { dbPath } = freshGreenDbPath('cov-fail');
    const db = openRw(dbPath);
    db.prepare(
      `INSERT INTO temp_log (shift_date, cook_id, reading_f, created_at)
       VALUES (?, 'c9', 41.0, ?)`
    ).run(D2, `${D2} 09:00:00`);
    const rows = checkAuditCoverage(db, {});
    db.close();
    const fails = failures(rows);
    assert.equal(fails.length, 1);
    assert.match(fails[0].scope, /temp_log/);
    assert.match(fails[0].detail, /1 orphan/);
    assert.match(fails[0].detail, /\b2\b/); // the orphan row id
  });

  it('honors entity aliases (allergen_attestations ← allergen_attestation)', () => {
    const { dbPath } = freshGreenDbPath('cov-alias');
    const db = openRw(dbPath);
    const rows = checkAuditCoverage(db, {});
    const scoped = rows.filter((r) => r.scope.includes('allergen_attestations'));
    db.close();
    assert.equal(scoped.length, 1);
    assert.equal(scoped[0].result, 'PASS');
  });

  it('a no-timestamp covered table FAILs on full history but is INFO-skipped under --since', () => {
    const { dbPath } = freshGreenDbPath('cov-notimestamp');
    const db = openRw(dbPath);
    // orphan row in a table with no timestamp column
    db.prepare(`INSERT INTO order_guide_items (ingredient) VALUES ('flour')`).run();

    const full = checkAuditCoverage(db, {});
    const ogFull = full.find((r) => r.scope === 'order_guide_items');
    assert.equal(ogFull.result, 'FAIL', 'full-history run flags the orphan');

    const windowed = checkAuditCoverage(db, { since: D1 });
    const ogWin = windowed.find((r) => r.scope === 'order_guide_items');
    db.close();
    assert.equal(ogWin.result, 'INFO', 'windowed run cannot scope it, skips');
    assert.match(ogWin.detail, /no timestamp column/);
  });

  it('--since bounds which mutation rows are checked', () => {
    const { dbPath } = freshGreenDbPath('cov-since');
    const db = openRw(dbPath);
    // orphan BEFORE the window start → out of scope, still green
    db.prepare(
      `INSERT INTO temp_log (shift_date, cook_id, reading_f, created_at)
       VALUES ('2026-01-05', 'c9', 41.0, '2026-01-05 09:00:00')`
    ).run();
    const rows = checkAuditCoverage(db, { since: D1 });
    db.close();
    assert.equal(failures(rows).length, 0);
  });
});

// ── Check 3: money checksums vs snapshot ────────────────────────────

describe('checkMoneyChecksums', () => {
  it('first run has no prior snapshot: passes and emits per-table day sums', () => {
    const { dbPath } = freshGreenDbPath('money-first');
    const db = openRw(dbPath);
    const { rows, snapshot } = checkMoneyChecksums(db, { priorSnapshot: null });
    db.close();
    assert.equal(failures(rows).length, 0);
    const tips = snapshot.tables.tip_pool_distributions;
    assert.ok(tips, 'tip_pool_distributions discovered as money table');
    assert.deepEqual(tips.money_columns, ['amount_cents']);
    assert.equal(tips.days[D1].sums.amount_cents, 12500);
    assert.equal(tips.days[D2].sums.amount_cents, 8000);
  });

  it('unchanged history passes against the prior snapshot', () => {
    const { dbPath } = freshGreenDbPath('money-stable');
    const db = openRw(dbPath);
    const first = checkMoneyChecksums(db, { priorSnapshot: null });
    const second = checkMoneyChecksums(db, { priorSnapshot: first.snapshot });
    db.close();
    assert.equal(failures(second.rows).length, 0);
  });

  it('fails when a PAST day checksum changes; drifted day keeps the old baseline', () => {
    const { dbPath } = freshGreenDbPath('money-tamper');
    const db = openRw(dbPath);
    const first = checkMoneyChecksums(db, { priorSnapshot: null });
    db.prepare(`UPDATE tip_pool_distributions SET amount_cents = 999 WHERE id = 1`).run();
    const second = checkMoneyChecksums(db, { priorSnapshot: first.snapshot });
    const fails = failures(second.rows);
    assert.ok(fails.length >= 1);
    assert.match(fails[0].scope, /tip_pool_distributions/);
    assert.match(fails[0].detail, new RegExp(D1));
    // evidence preserved: the drifted day keeps the ORIGINAL checksum so a
    // third run keeps failing until an operator re-baselines deliberately
    const third = checkMoneyChecksums(db, { priorSnapshot: second.snapshot });
    db.close();
    assert.ok(failures(third.rows).length >= 1, 'third run must still fail');
  });

  it("today's day is exempt (still being written)", () => {
    const { dbPath } = freshGreenDbPath('money-today');
    const db = openRw(dbPath);
    db.prepare(
      `INSERT INTO tip_pool_distributions
         (shift_date, pool_ref, cook_id, kind, amount_cents, created_at)
       VALUES (?, 'p3', 'c3', 'tip_pool', 100, datetime('now'))`
    ).run(TODAY);
    const first = checkMoneyChecksums(db, { priorSnapshot: null });
    assert.equal(first.snapshot.tables.tip_pool_distributions.days[TODAY], undefined,
      'incomplete today must not be snapshotted');
    // more writes land today between runs → still green
    db.prepare(
      `INSERT INTO tip_pool_distributions
         (shift_date, pool_ref, cook_id, kind, amount_cents, created_at)
       VALUES (?, 'p4', 'c4', 'tip_pool', 250, datetime('now'))`
    ).run(TODAY);
    const second = checkMoneyChecksums(db, { priorSnapshot: first.snapshot });
    db.close();
    assert.equal(failures(second.rows).length, 0);
  });

  it('fails when a past day vanishes from history (deleted rows)', () => {
    const { dbPath } = freshGreenDbPath('money-vanish');
    const db = openRw(dbPath);
    const first = checkMoneyChecksums(db, { priorSnapshot: null });
    db.prepare(`DELETE FROM tip_pool_distributions WHERE shift_date = ?`).run(D2);
    const second = checkMoneyChecksums(db, { priorSnapshot: first.snapshot });
    db.close();
    const fails = failures(second.rows);
    assert.ok(fails.length >= 1);
    assert.match(fails[0].detail, new RegExp(D2));
  });
});

// ── Check 4: canonical actor_source set ─────────────────────────────

describe('checkCanonicalActorSources', () => {
  it('passes when all values are canonical', () => {
    const { dbPath } = freshGreenDbPath('canon-pass');
    const db = openRw(dbPath);
    const rows = checkCanonicalActorSources(db);
    db.close();
    assert.equal(failures(rows).length, 0);
  });

  it('fails on a value outside the canonical set', () => {
    const { dbPath } = freshGreenDbPath('canon-fail');
    const db = openRw(dbPath);
    insertAudit(db, { entity: 'temp_log', entityId: 1, actorSource: 'hacked_ui', day: D2 });
    const rows = checkCanonicalActorSources(db);
    db.close();
    const fails = failures(rows);
    assert.equal(fails.length, 1);
    assert.match(fails[0].scope, /audit_events/);
    assert.match(fails[0].detail, /hacked_ui/);
  });
});

// ── runReconcile end-to-end + CLI ───────────────────────────────────

describe('runReconcile', () => {
  it('green fixture → exit 0, prints table + final PASS, writes snapshot', () => {
    const { dir, dbPath } = freshGreenDbPath('e2e-pass');
    const snapshotPath = path.join(dir, 'snap.json');
    const lines = [];
    const res = runReconcile({
      dbPath,
      snapshotPath,
      write: (s) => lines.push(s),
    });
    assert.equal(res.exitCode, 0);
    const out = lines.join('\n');
    assert.match(out, /writer_attribution/);
    assert.match(out, /audit_coverage/);
    assert.match(out, /money_checksums/);
    assert.match(out, /canonical_actor_source/);
    assert.match(out, /RECONCILE: PASS/);
    assert.ok(fs.existsSync(snapshotPath), 'snapshot written');
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    assert.ok(snap.tables.tip_pool_distributions);
  });

  it('red fixture → exit 1 and final FAIL', () => {
    const { dir, dbPath } = freshGreenDbPath('e2e-fail');
    const db = openRw(dbPath);
    insertAudit(db, { entity: 'temp_log', entityId: 1, actorSource: 'rogue_writer', day: D2 });
    db.close();
    const snapshotPath = path.join(dir, 'snap.json');
    const lines = [];
    const res = runReconcile({ dbPath, snapshotPath, write: (s) => lines.push(s) });
    assert.equal(res.exitCode, 1);
    assert.match(lines.join('\n'), /RECONCILE: FAIL/);
  });

  it('--json emits machine-readable results', () => {
    const { dir, dbPath } = freshGreenDbPath('e2e-json');
    const snapshotPath = path.join(dir, 'snap.json');
    const lines = [];
    const res = runReconcile({ dbPath, snapshotPath, json: true, write: (s) => lines.push(s) });
    assert.equal(res.exitCode, 0);
    const parsed = JSON.parse(lines.join('\n'));
    assert.equal(parsed.pass, true);
    assert.ok(Array.isArray(parsed.results));
  });

  it('CLI: opens the DB read-only and exits 0 on the green fixture', () => {
    const { dir, dbPath } = freshGreenDbPath('cli-pass');
    const snapshotPath = path.join(dir, 'snap.json');
    const proc = spawnSync(process.execPath, [
      RECONCILE_SCRIPT, '--db', dbPath, '--snapshot', snapshotPath,
    ], { encoding: 'utf8' });
    assert.equal(proc.status, 0, `stderr: ${proc.stderr}\nstdout: ${proc.stdout}`);
    assert.match(proc.stdout, /RECONCILE: PASS/);
  });

  it('CLI: missing DB file exits non-zero with a clear message', () => {
    const proc = spawnSync(process.execPath, [
      RECONCILE_SCRIPT, '--db', path.join(workRoot, 'nope.db'),
    ], { encoding: 'utf8' });
    assert.notEqual(proc.status, 0);
    assert.match(proc.stderr + proc.stdout, /not found|does not exist|fileMustExist/i);
  });
});

// ── phase-c-backup.sh ───────────────────────────────────────────────

const hasSqlite3 = spawnSync('sqlite3', ['--version'], { encoding: 'utf8' }).status === 0;

describe('phase-c-backup.sh', { skip: hasSqlite3 ? false : 'sqlite3 CLI not installed — skipping backup drill tests' }, () => {
  function makeAuditDir(dir) {
    const auditDir = path.join(dir, 'audit');
    fs.mkdirSync(auditDir, { recursive: true });
    fs.writeFileSync(
      path.join(auditDir, 'management-actions.jsonl'),
      JSON.stringify({ action: 'recipe_edit', timestamp: `${D1}T10:00:00Z` }) + '\n'
    );
    return auditDir;
  }

  function runBackup(args, env = {}) {
    return spawnSync('bash', [BACKUP_SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      cwd: ROOT,
    });
  }

  it('backup then verify → PASS', () => {
    const { dir, dbPath } = freshGreenDbPath('backup-ok');
    const auditDir = makeAuditDir(dir);
    const backupRoot = path.join(dir, 'backups');

    const b = runBackup(['backup', '--db', dbPath, '--audit-dir', auditDir],
      { LARIAT_BACKUP_DIR: backupRoot });
    assert.equal(b.status, 0, `backup failed:\n${b.stdout}\n${b.stderr}`);

    const entries = fs.readdirSync(backupRoot);
    assert.equal(entries.length, 1);
    const backupDir = path.join(backupRoot, entries[0]);
    for (const f of ['lariat.db', 'audit.tar.gz', 'SHA256SUMS', 'manifest.txt']) {
      assert.ok(fs.existsSync(path.join(backupDir, f)), `missing ${f}`);
    }
    // manifest printed to stdout
    assert.match(b.stdout, /lariat\.db/);
    assert.match(b.stdout, /audit\.tar\.gz/);

    const v = runBackup(['verify', backupDir]);
    assert.equal(v.status, 0, `verify failed:\n${v.stdout}\n${v.stderr}`);
    assert.match(v.stdout, /PASS/);
    assert.match(v.stdout, /integrity_check/);
  });

  it('verify fails on a corrupted DB copy', () => {
    const { dir, dbPath } = freshGreenDbPath('backup-corrupt');
    const auditDir = makeAuditDir(dir);
    const backupRoot = path.join(dir, 'backups');

    const b = runBackup(['backup', '--db', dbPath, '--audit-dir', auditDir],
      { LARIAT_BACKUP_DIR: backupRoot });
    assert.equal(b.status, 0, `backup failed:\n${b.stdout}\n${b.stderr}`);

    const backupDir = path.join(backupRoot, fs.readdirSync(backupRoot)[0]);
    const copy = path.join(backupDir, 'lariat.db');
    const buf = fs.readFileSync(copy);
    for (let i = 100; i < 200 && i < buf.length; i++) buf[i] = 0xff;
    fs.writeFileSync(copy, buf);

    const v = runBackup(['verify', backupDir]);
    assert.notEqual(v.status, 0);
    assert.match(v.stdout + v.stderr, /FAIL/);
  });

  it('refuses to back up a missing DB', () => {
    const dir = tmpDir('backup-nodb');
    const auditDir = makeAuditDir(dir);
    const b = runBackup(['backup', '--db', path.join(dir, 'nope.db'), '--audit-dir', auditDir],
      { LARIAT_BACKUP_DIR: path.join(dir, 'backups') });
    assert.notEqual(b.status, 0);
  });
});
