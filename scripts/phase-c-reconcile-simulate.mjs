#!/usr/bin/env node
// Phase C §C4 — reconciliation-window SIMULATION.
//
// The real Phase C precondition needs a >=7-consecutive-service-day
// reconciliation window that stays green on all four invariants before the web
// write path is removed (C5). That is calendar time we cannot fast-forward in
// production — but we CAN prove the *tooling* behaves correctly across a window
// by simulating it: build a throwaway DB, write a day's numbers, run the
// nightly reconcile with `--today` pinned to that service day, carry the money
// snapshot forward, and repeat for 8 days. Then run the adversarial cases the
// window exists to catch (a retroactively edited past day, a non-canonical /
// missing actor_source, an un-audited mutation) and assert each flips to FAIL.
//
// This is a self-contained harness — it NEVER touches data/lariat.db. Run:
//   node scripts/phase-c-reconcile-simulate.mjs
// Exit 0 = every night green + every adversarial case correctly caught.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runReconcile } from './phase-c-reconcile.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

// 8 consecutive service days (fixed strings — no Date.now(), deterministic).
export const SERVICE_DAYS = [
  '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09',
  '2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13',
];

// ── schema: a realistic subset the four invariants exercise ──────────
function buildDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
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
      created_at TEXT DEFAULT (datetime('now'))
    );
    -- money + audit-covered (tips are a regulated write with an audit row each)
    CREATE TABLE tip_pool_distributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT DEFAULT 'default',
      shift_date TEXT NOT NULL,
      pool_ref TEXT NOT NULL,
      cook_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    -- money, NOT audit-covered (bulk POS import — like the real sales_lines)
    CREATE TABLE sales_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT DEFAULT 'default',
      shift_date TEXT NOT NULL,
      net_sales REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    -- audit-covered mutation, no actor_source column (reported unattributable)
    CREATE TABLE temp_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      location_id TEXT DEFAULT 'default',
      cook_id TEXT,
      reading_f REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function insertAudit(db, { entity, entityId, day, actorSource = 'cook_ui', action = 'insert' }) {
  db.prepare(
    `INSERT INTO audit_events (shift_date, actor_source, entity, entity_id, action, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(day, actorSource, entity, entityId, action, `${day} 20:00:00`);
}

// Deterministic numbers for service day index k (0-based). Each day:
//  - 3 tip-pool rows (audited), 2 temp readings (audited), 1 POS sales line.
function insertServiceDay(db, day, k) {
  const at = (h) => `${day} ${String(h).padStart(2, '0')}:00:00`;
  const tips = [
    { ref: `p${k}a`, cook: 'c1', cents: 12000 + k * 250 },
    { ref: `p${k}b`, cook: 'c2', cents: 8000 + k * 125 },
    { ref: `p${k}c`, cook: 'c3', cents: 5000 },
  ];
  let tipCents = 0;
  for (const t of tips) {
    const info = db.prepare(
      `INSERT INTO tip_pool_distributions (shift_date, pool_ref, cook_id, kind, amount_cents, created_at)
       VALUES (?, ?, ?, 'tip_pool', ?, ?)`
    ).run(day, t.ref, t.cook, t.cents, at(23));
    insertAudit(db, { entity: 'tip_pool_distributions', entityId: info.lastInsertRowid, day, actorSource: 'manager_ui' });
    tipCents += t.cents;
  }
  for (let i = 0; i < 2; i++) {
    const info = db.prepare(
      `INSERT INTO temp_log (shift_date, cook_id, reading_f, created_at) VALUES (?, ?, ?, ?)`
    ).run(day, `c${i + 1}`, 38 + i, at(9 + i));
    insertAudit(db, { entity: 'temp_log', entityId: info.lastInsertRowid, day, actorSource: 'cook_ui' });
  }
  const salesUsd = 500000 + k * 10000 + 42.5; // non-integer to exercise ROUND
  db.prepare(
    `INSERT INTO sales_lines (shift_date, net_sales, created_at) VALUES (?, ?, ?)`
  ).run(day, salesUsd, at(23));
  return { tipRows: tips.length, tipCents, salesUsd };
}

function fails(results) {
  return results.filter((r) => r.result === 'FAIL');
}

// Run one nightly reconcile (read-only) with `today` pinned to the service day.
function nightly(dbPath, snapshotPath, today) {
  const out = [];
  const { exitCode, results } = runReconcile({
    dbPath, snapshotPath, today, since: null, write: (s) => out.push(s),
  });
  return { pass: exitCode === 0, results, fails: fails(results) };
}

export function simulate({ verbose = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-c-window-sim-'));
  const dbPath = path.join(dir, 'sim.db');
  const snapPath = path.join(dir, 'snapshot.json');
  const log = (s) => { if (verbose) process.stdout.write(s + '\n'); };

  try {
    const db = buildDb(dbPath);
    db.close();

    const nights = [];
    log('Simulated reconciliation window (8 service days)\n');
    log('day         | tip rows | tip $      | POS net $   | past days locked | verdict');
    log('------------+----------+------------+-------------+------------------+--------');

    let cumulative = 0;
    for (let k = 0; k < SERVICE_DAYS.length; k++) {
      const day = SERVICE_DAYS[k];
      const w = buildDbWriter(dbPath);
      const nums = insertServiceDay(w, day, k);
      w.close();
      cumulative += nums.tipCents;

      // Nightly run AT END of `day`: today=day, so `day` itself is exempt
      // (still being written) and every prior day is locked to the snapshot.
      const night = nightly(dbPath, snapPath, day);
      const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
      const lockedDays = Object.keys(snap.tables?.tip_pool_distributions?.days || {}).length;

      nights.push({ day, ...nums, pass: night.pass, lockedDays, fails: night.fails.map((f) => `${f.check}/${f.scope}`) });
      log(
        `${day}  |    ${String(nums.tipRows).padStart(2)}    | ${('$' + (nums.tipCents / 100).toFixed(2)).padStart(10)} | ` +
        `${('$' + nums.salesUsd.toFixed(2)).padStart(11)} | ${String(lockedDays).padStart(16)} | ${night.pass ? 'PASS ✓' : 'FAIL ✗ ' + night.fails.map((f) => f.scope).join(',')}`
      );
    }

    // ── adversarial cases the window exists to catch ──────────────────
    log('\nAdversarial checks (each must be CAUGHT → FAIL):');
    const adversarial = {};

    // 1. Retroactive edit of a PAST day's money (day index 2) after it was locked.
    {
      const w = buildDbWriter(dbPath);
      w.prepare(`UPDATE tip_pool_distributions SET amount_cents = amount_cents + 99999
                 WHERE shift_date = ? AND pool_ref = ?`).run(SERVICE_DAYS[2], `p2a`);
      w.close();
      const r = nightly(dbPath, snapPath, SERVICE_DAYS[7]);
      const drift = r.fails.find((f) => f.check === 'money_checksums' && f.scope === 'tip_pool_distributions');
      adversarial.pastDayTamper = { caught: !!drift && !r.pass, detail: drift?.detail };
      log(`  past-day money tamper (${SERVICE_DAYS[2]}): ${adversarial.pastDayTamper.caught ? 'CAUGHT ✓' : 'MISSED ✗'}`);
    }

    // Rebuild a clean 8-day DB for the remaining independent checks.
    const clean = () => {
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(dbPath + '-wal', { force: true });
      fs.rmSync(dbPath + '-shm', { force: true });
      const db = buildDb(dbPath); db.close();
      for (let k = 0; k < SERVICE_DAYS.length; k++) {
        const w = buildDbWriter(dbPath); insertServiceDay(w, SERVICE_DAYS[k], k); w.close();
      }
    };

    // 2. Non-canonical actor_source on a fresh audit row.
    {
      clean();
      const w = buildDbWriter(dbPath);
      insertAudit(w, { entity: 'tip_pool_distributions', entityId: 1, day: SERVICE_DAYS[7], actorSource: 'rogue_writer' });
      w.close();
      const r = nightly(dbPath, snapPath, SERVICE_DAYS[7]);
      const bad = r.fails.find((f) => f.check === 'canonical_actor_source');
      adversarial.nonCanonicalActor = { caught: !!bad && !r.pass, detail: bad?.detail };
      log(`  non-canonical actor_source 'rogue_writer': ${adversarial.nonCanonicalActor.caught ? 'CAUGHT ✓' : 'MISSED ✗'}`);
    }

    // 3. NULL actor_source (unattributed write).
    {
      clean();
      const w = buildDbWriter(dbPath);
      w.prepare(`INSERT INTO audit_events (shift_date, actor_source, entity, entity_id, action, created_at)
                 VALUES (?, '', 'temp_log', 999, 'insert', ?)`).run(SERVICE_DAYS[7], `${SERVICE_DAYS[7]} 21:00:00`);
      w.close();
      const r = nightly(dbPath, snapPath, SERVICE_DAYS[7]);
      const bad = r.fails.find((f) => f.check === 'writer_attribution' && f.scope === 'audit_events');
      adversarial.unattributedWrite = { caught: !!bad && !r.pass, detail: bad?.detail };
      log(`  empty actor_source (unattributed): ${adversarial.unattributedWrite.caught ? 'CAUGHT ✓' : 'MISSED ✗'}`);
    }

    // 4. Un-audited regulated mutation (a tip row with no audit_events row).
    {
      clean();
      const w = buildDbWriter(dbPath);
      w.prepare(`INSERT INTO tip_pool_distributions (shift_date, pool_ref, cook_id, kind, amount_cents, created_at)
                 VALUES (?, 'ORPHAN', 'c9', 'tip_pool', 4200, ?)`).run(SERVICE_DAYS[7], `${SERVICE_DAYS[7]} 23:30:00`);
      w.close();
      const r = nightly(dbPath, snapPath, SERVICE_DAYS[7]);
      const bad = r.fails.find((f) => f.check === 'audit_coverage' && f.scope === 'tip_pool_distributions');
      adversarial.unauditedMutation = { caught: !!bad && !r.pass, detail: bad?.detail };
      log(`  un-audited tip row (orphan): ${adversarial.unauditedMutation.caught ? 'CAUGHT ✓' : 'MISSED ✗'}`);
    }

    return { nights, adversarial, totalTipCents: cumulative };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function buildDbWriter(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

// ── CLI ──────────────────────────────────────────────────────────────
const invokedAsScript = (() => {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname);
  } catch { return false; }
})();

if (invokedAsScript) {
  const res = simulate({ verbose: true });
  const allNightsGreen = res.nights.every((n) => n.pass);
  const allCaught = Object.values(res.adversarial).every((a) => a.caught);
  process.stdout.write(
    `\nWindow: ${res.nights.length} nights ${allNightsGreen ? 'ALL GREEN ✓' : 'HAD FAILURES ✗'}; ` +
    `adversarial: ${Object.values(res.adversarial).filter((a) => a.caught).length}/${Object.keys(res.adversarial).length} caught.\n` +
    `SIMULATION: ${allNightsGreen && allCaught ? 'PASS' : 'FAIL'}\n`
  );
  process.exit(allNightsGreen && allCaught ? 0 : 1);
}
