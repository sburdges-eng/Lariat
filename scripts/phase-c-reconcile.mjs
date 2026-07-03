#!/usr/bin/env node
// Phase C §C4 — shadow / dual-write reconciliation checker.
//
// Native (LariatNative) and web writers currently coexist against the same
// data/lariat.db. Before the web write path is removed (C5 waves), the spec
// requires a ≥7-consecutive-service-day reconciliation window, green on four
// invariants (docs/superpowers/specs/2026-07-02-lariat-native-phase-c-schema-
// inversion.md §C4). This script runs those invariants READ-ONLY and prints a
// PASS/FAIL table. Run it nightly during the window:
//
//   node scripts/phase-c-reconcile.mjs [--db path] [--audit-dir path]
//                                      [--since YYYY-MM-DD] [--snapshot path]
//                                      [--json]
//
// Defaults: --db data/lariat.db, --audit-dir data/audit, since=all,
// --snapshot data/cache/phase-c-reconcile-snapshot.json.
//
// READ-ONLY GUARANTEE: the DB is opened with { readonly: true,
// fileMustExist: true }. The ONE write this tool performs is the money-
// checksum snapshot JSON under data/cache/ (never the DB, never data/audit).
//
// The four invariants:
//   1. writer_attribution   — every row in a table that has BOTH a timestamp
//                             column and an actor_source column carries a
//                             non-empty actor_source (grouped per day).
//                             Mutation tables WITHOUT actor_source are listed
//                             once as INFO ("unattributable") — closing that
//                             gap is C1/C3 work, not a C4 failure.
//   2. audit_coverage       — every recent row of an audit-covered mutation
//                             table has a matching audit_events row
//                             (entity/entity_id join; postAuditEvent writes
//                             in the same transaction — lib/auditEvents.ts).
//   3. money_checksums      — per-day SUM checksums over money-bearing
//                             columns must be immutable for PAST days
//                             between runs (compared against the prior
//                             snapshot). Today is exempt (still being
//                             written) and is never snapshotted.
//   4. canonical_actor_source — no row carries an actor_source outside the
//                             canonical set (see CANONICAL_ACTOR_SOURCES).
//
// Exit codes: 0 = all PASS, 1 = at least one FAIL, 2 = usage/environment.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// ── Canonical actor_source set (spec §C3) ───────────────────────────
// Mirrors the C3 ActorSource canonical enum being defined in
// LariatNative/Sources/LariatModel (parallel workstream). Derived from the
// web/scripts codebase by grepping app/** lib/** scripts/** for actor_source
// literals, plus the native writers. Historical rows are NEVER rewritten
// (§C3) — this set governs new writes. Citations (first occurrence):
//   api                        app/api/reservations/[id]/route.js:170
//   beo_client_share           app/api/beo/share/[token]/sign/route.js:74
//   box_office                 lib/boxOfficeRepo.ts:174
//   cook_ui                    app/api/breaks/route.js:121
//   dice_ingest                lib/boxOfficeRepo.ts:372
//   kds_app                    app/api/kds/tickets/[id]/bump/route.js:138
//   kds_login                  app/api/auth/temp-pin/login/route.js:156
//   kitchen_assistant          app/api/kitchen-assistant/route.js:391
//   kitchen_assistant_undo     lib/kitchenAssistantUndo.ts:166
//   management_ui              app/api/recipes/[slug]/route.js:182
//   manager_pin                app/api/gold-stars/[id]/route.ts:67
//   manager_ui                 app/api/auth/temp-pin/revoke/route.js:71
//   pic_ui                     app/api/sick-worker/route.js:102
//   prism_backfill             scripts/import-prism-deals.mjs:416
//   receiving_closed_loop      app/api/receiving/route.js:459
//   receiving_match_resolution app/api/receiving/matches/[id]/route.js:148
//   sales_depletion            lib/salesDepletion.ts:465
//   native_cook / native_mac   LariatNative/Sources/LariatModel/AuditEvent.swift:55-56
// NB: 'export' appears only in doc comments (lib/auditEvents.ts:22,
// lib/db.ts:957) — no code path writes it, so it is NOT canonical.
export const CANONICAL_ACTOR_SOURCES = new Set([
  'api',
  'beo_client_share',
  'box_office',
  'cook_ui',
  'dice_ingest',
  'kds_app',
  'kds_login',
  'kitchen_assistant',
  'kitchen_assistant_undo',
  'management_ui',
  'manager_pin',
  'manager_ui',
  'native_cook',
  'native_mac',
  'pic_ui',
  'prism_backfill',
  'receiving_closed_loop',
  'receiving_match_resolution',
  'sales_depletion',
]);

// ── Audit-covered mutation tables (spec §C4 invariant 2) ────────────
// The audit contract (lib/auditEvents.ts postAuditEvent) writes one
// audit_events row per regulated write, in the SAME transaction, with
// `entity` naming the concept and `entity_id` the source row id. This map
// was derived from every postAuditEvent call site in app/** and lib/**:
// key = mutation table, value = entity string(s) used for that table.
// Most entities equal the table name; six use a singular alias. Entities
// with no backing table (recipes → file-backed; temp_pin / manager_pin_user
// / db_query / code_search → auth+tooling events; beo_event → share-token
// issuance on beo_events) are intentionally absent: there is no row to
// join against.
export const AUDIT_COVERED_TABLES = {
  allergen_attestations: ['allergen_attestation'],   // lib/allergenAttestations.ts:287
  beo_courses: ['beo_course'],                       // app/api/beo/courses/route.js:113
  beo_events: ['beo_events'],                        // app/api/beo/route.js:153
  beo_line_items: ['beo_line_items'],
  beo_prep_tasks: ['beo_prep_tasks'],
  beo_signatures: ['beo_signature'],                 // app/api/beo/share/[token]/sign/route.js:70
  box_office_lines: ['box_office_lines'],
  cleaning_log: ['cleaning_log'],
  cooling_log: ['cooling_log'],
  date_marks: ['date_marks'],
  dining_tables: ['dining_tables'],
  eighty_six: ['eighty_six'],
  equipment_maintenance: ['equipment_maintenance'],
  gold_stars: ['gold_stars'],
  ingredient_maps: ['ingredient_maps'],
  ingredient_masters: ['ingredient_masters'],
  inventory_count_lines: ['inventory_count_lines'],
  inventory_counts: ['inventory_counts'],
  inventory_par: ['inventory_par'],
  inventory_updates: ['inventory_updates'],
  kds_ticket_states: ['kds_ticket_state'],           // app/api/kds/tickets/[id]/bump/route.js:134
  line_check_entries: ['line_check_entries'],
  // locations IS audited (app/api/locations/route.js:61) but with entity_id:
  // null and a TEXT primary key, so the integer-id coverage join can't apply —
  // hasIntegerIdColumn() skips it with an INFO row. Kept here to document that
  // it is an audited surface, not an omission.
  locations: ['locations'],
  order_guide_items: ['order_guide_items'],
  paid_sick_leave_balances: ['paid_sick_leave_balances'],
  performance_reviews: ['performance_reviews'],
  pest_control_log: ['pest_control_log'],
  prep_par: ['prep_par'],
  prep_tasks: ['prep_tasks'],
  preshift_notes: ['preshift_notes'],
  receiving_log: ['receiving_log'],
  reservations: ['reservations'],
  sanitizer_checks: ['sanitizer_checks'],
  sds_registry: ['sds_registry'],
  shift_breaks: ['shift_breaks'],
  show_deals: ['show_deal'],                         // lib/settlementRepo.ts:78
  sick_worker_reports: ['sick_worker_reports'],
  specials_promotions: ['specials_promotion'],       // lib/specialsPromotion.ts:361
  staff_certifications: ['staff_certifications'],
  station_signoffs: ['station_signoffs'],
  temp_log: ['temp_log'],
  thermometer_calibrations: ['thermometer_calibrations'],
  tip_pool_distributions: ['tip_pool_distributions'],
  tphc_entries: ['tphc_entries'],
  // vendor_prices is intentionally EXCLUDED: it is a bulk-import table. The
  // price rows come from ingest scripts (scripts/ingest-costing.mjs,
  // ingest_shamrock_price_list.py, lib/vendorPricesRepo.ts) with no per-row
  // audit_events; only occasional master-id remaps audit (entity
  // 'vendor_prices', lib/vendorMappingRepo.ts). Requiring every row to carry an
  // audit row is therefore a permanent false FAIL — verified against live data
  // (454 legitimately-unaudited import rows). Its remap audit trail still lives
  // in audit_events, just not enforced by the per-row coverage join.
  wage_notices: ['wage_notices'],
};

// Timestamp columns that mark a table as a "mutation table" for invariant 1
// (per spec brief: created_at / inserted_at / updated_at).
const TIMESTAMP_COLUMNS = ['created_at', 'inserted_at', 'updated_at'];

// Money-bearing column heuristic (invariant 3): any *_cents column, plus the
// exact settlement/box-office/receiving column names found in lib/db.ts.
// Deliberately EXCLUDES recompute-mutable costing columns (unit_price,
// pack_price, batch_cost, reconciled_unit_price…) — costing recompute paths
// legitimately rewrite those, and flagging them would drown real drift.
const MONEY_EXACT_NAMES = new Set([
  'net_sales',
  'gross_sales',
  'amount',
  'face_price',
  'fees',
  'invoice_total',
  'total_amount',
]);

// Day-column preference for grouping money sums. Business-date columns win;
// append-only ingestion timestamps are acceptable fallbacks. `updated_at`
// is deliberately NOT here: a table whose only date is updated_at is
// mutable-by-design (e.g. show_deals) and cannot participate in an
// immutability checksum — it gets an INFO row instead.
const MONEY_DAY_COLUMNS = [
  'shift_date', 'business_date', 'date', 'day',
  'created_at', 'imported_at', 'snapshot_at', 'scanned_at', 'inserted_at',
];

// ── Small helpers ───────────────────────────────────────────────────

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function userTables(db) {
  return db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`
    )
    .all()
    .map((r) => r.name);
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map((c) => c.name);
}

// True only when the table has an `id` column declared INTEGER. audit_events.
// entity_id is INTEGER, so the coverage join (a.entity_id = t.id) can only
// match an integer id. A TEXT-id table (e.g. locations.id = 'default') is not
// joinable — and such tables audit with entity_id: null anyway
// (app/api/locations/route.js) — so the coverage check must skip them rather
// than report every row as a false orphan.
function hasIntegerIdColumn(db, table) {
  const idCol = db
    .prepare(`PRAGMA table_info(${JSON.stringify(table)})`)
    .all()
    .find((c) => c.name === 'id');
  return !!idCol && String(idCol.type || '').toUpperCase().includes('INT');
}

function firstPresent(columns, candidates) {
  for (const c of candidates) if (columns.includes(c)) return c;
  return null;
}

function row(check, scope, result, detail) {
  return { check, scope, result, detail };
}

// ── Invariant 1: writer attribution ─────────────────────────────────

export function checkWriterAttribution(db) {
  const rows = [];
  const unattributable = [];
  for (const table of userTables(db)) {
    const cols = tableColumns(db, table);
    const ts = firstPresent(cols, TIMESTAMP_COLUMNS);
    if (!ts) continue; // not a mutation table by the spec's definition
    if (!cols.includes('actor_source')) {
      unattributable.push(table);
      continue;
    }
    const bad = db
      .prepare(
        `SELECT substr(${ts}, 1, 10) AS day, COUNT(*) AS n
         FROM ${JSON.stringify(table)}
         WHERE actor_source IS NULL OR trim(actor_source) = ''
         GROUP BY day ORDER BY day`
      )
      .all();
    if (bad.length === 0) {
      rows.push(row('writer_attribution', table, 'PASS', 'all rows attributed'));
    } else {
      const days = bad.map((b) => `${b.day}: ${b.n} unattributed`).join('; ');
      rows.push(row('writer_attribution', table, 'FAIL', days));
    }
  }
  if (unattributable.length > 0) {
    rows.push(
      row(
        'writer_attribution',
        '(no actor_source)',
        'INFO',
        `${unattributable.length} unattributable mutation tables (C1/C3 work item): ${unattributable.join(', ')}`
      )
    );
  }
  return rows;
}

// ── Invariant 2: audit coverage ─────────────────────────────────────

export function checkAuditCoverage(db, { since } = {}) {
  const rows = [];
  const tables = new Set(userTables(db));
  if (!tables.has('audit_events')) {
    rows.push(row('audit_coverage', 'audit_events', 'FAIL', 'audit_events table is missing'));
    return rows;
  }
  for (const [table, entities] of Object.entries(AUDIT_COVERED_TABLES)) {
    if (!tables.has(table)) continue; // schema subset (tests / older DBs)
    if (!hasIntegerIdColumn(db, table)) {
      rows.push(row('audit_coverage', table, 'INFO', 'no integer id column; join skipped'));
      continue;
    }
    const cols = tableColumns(db, table);
    const ts = firstPresent(cols, TIMESTAMP_COLUMNS);
    // Windowed run (--since) but no timestamp column to scope by: the audit-
    // coverage invariant is about rows written DURING the reconciliation window,
    // and a table with no created/inserted/updated_at can't identify "new" rows.
    // Checking all history here just re-surfaces pre-audit/bulk/config rows
    // (order_guide_items, inventory_par, ingredient_maps…) as permanent FAILs.
    // Skip with an INFO instead. A full-history audit (no --since) still checks.
    if (since && !ts) {
      rows.push(row('audit_coverage', table, 'INFO',
        'no timestamp column — cannot scope to the --since window; skipped'));
      continue;
    }
    const placeholders = entities.map(() => '?').join(', ');
    const sinceClause = since && ts ? `AND substr(t.${ts}, 1, 10) >= ?` : '';
    const params = [...entities];
    if (since && ts) params.push(since);
    const orphans = db
      .prepare(
        `SELECT t.id FROM ${JSON.stringify(table)} t
         WHERE NOT EXISTS (
           SELECT 1 FROM audit_events a
           WHERE a.entity IN (${placeholders}) AND a.entity_id = t.id
         ) ${sinceClause}
         ORDER BY t.id`
      )
      .all(...params)
      .map((r) => r.id);
    if (orphans.length === 0) {
      const scopeNote = since && ts ? `since ${since}` : 'all rows';
      rows.push(row('audit_coverage', table, 'PASS', `no orphans (${scopeNote})`));
    } else {
      const examples = orphans.slice(0, 5).join(', ');
      rows.push(
        row(
          'audit_coverage',
          table,
          'FAIL',
          `${orphans.length} orphan row(s) without audit_events — example ids: ${examples}`
        )
      );
    }
  }
  return rows;
}

// ── Invariant 3: money checksums vs prior snapshot ──────────────────

function discoverMoneyTables(db) {
  const found = [];
  for (const table of userTables(db)) {
    if (table === 'audit_events') continue;
    const cols = tableColumns(db, table);
    const moneyCols = cols.filter(
      (c) => c.endsWith('_cents') || MONEY_EXACT_NAMES.has(c)
    );
    if (moneyCols.length === 0) continue;
    const dayCol = firstPresent(cols, MONEY_DAY_COLUMNS);
    found.push({ table, moneyCols: moneyCols.sort(), dayCol, mutableOnly: !dayCol && cols.includes('updated_at') });
  }
  return found;
}

function computeDailySums(db, table, dayCol, moneyCols) {
  const sumExprs = moneyCols
    .map((c) => `ROUND(COALESCE(SUM(${JSON.stringify(c)}), 0), 6) AS ${JSON.stringify('sum_' + c)}`)
    .join(', ');
  const raw = db
    .prepare(
      `SELECT substr(${JSON.stringify(dayCol)}, 1, 10) AS day, COUNT(*) AS n, ${sumExprs}
       FROM ${JSON.stringify(table)}
       WHERE ${JSON.stringify(dayCol)} IS NOT NULL
       GROUP BY day ORDER BY day`
    )
    .all();
  const days = {};
  for (const r of raw) {
    const sums = {};
    for (const c of moneyCols) sums[c] = r['sum_' + c];
    days[r.day] = { count: r.n, sums };
  }
  return days;
}

function sameChecksum(a, b) {
  if (a.count !== b.count) return false;
  const keys = new Set([...Object.keys(a.sums), ...Object.keys(b.sums)]);
  for (const k of keys) {
    if (a.sums[k] !== b.sums[k]) return false;
  }
  return true;
}

/**
 * Compare current per-day money sums against the prior snapshot. PAST days
 * must be byte-stable; today is exempt and never stored. On drift the
 * returned snapshot keeps the OLD (prior) checksum for the drifted day so
 * subsequent runs keep failing until an operator deliberately re-baselines
 * (delete the snapshot file after investigating).
 */
export function checkMoneyChecksums(db, { priorSnapshot = null, since = null, today = todayISO() } = {}) {
  const rows = [];
  const tables = {};
  const discovered = discoverMoneyTables(db);

  for (const { table, moneyCols, dayCol, mutableOnly } of discovered) {
    if (!dayCol) {
      const why = mutableOnly
        ? 'only updated_at available — mutable by design, excluded from immutability checksum'
        : 'no date-like column — cannot group by day, excluded';
      rows.push(row('money_checksums', table, 'INFO', why));
      continue;
    }
    const allDays = computeDailySums(db, table, dayCol, moneyCols);
    const current = {};
    for (const [day, rec] of Object.entries(allDays)) {
      if (day >= today) continue; // today (and any future-dated rows) exempt
      if (since && day < since) continue;
      current[day] = rec;
    }

    const prior = priorSnapshot?.tables?.[table]?.days ?? null;
    const drifted = [];
    const merged = { ...current };
    if (prior) {
      for (const [day, oldRec] of Object.entries(prior)) {
        if (day >= today) continue;
        if (since && day < since) {
          merged[day] = oldRec; // out of window — carry forward untouched
          continue;
        }
        const newRec = current[day];
        if (!newRec) {
          drifted.push(`${day}: day vanished (was count=${oldRec.count})`);
          merged[day] = oldRec; // preserve evidence
        } else if (!sameChecksum(oldRec, newRec)) {
          drifted.push(
            `${day}: was ${JSON.stringify(oldRec.sums)} (n=${oldRec.count}), ` +
            `now ${JSON.stringify(newRec.sums)} (n=${newRec.count})`
          );
          merged[day] = oldRec; // preserve evidence
        }
      }
    }

    tables[table] = { day_column: dayCol, money_columns: moneyCols, days: merged };

    if (drifted.length > 0) {
      rows.push(row('money_checksums', table, 'FAIL', `past-day drift — ${drifted.join(' | ')}`));
    } else {
      const n = Object.keys(current).length;
      const base = prior ? 'stable vs prior snapshot' : 'baseline captured (no prior snapshot)';
      rows.push(row('money_checksums', table, 'PASS', `${base} — ${n} past day(s)`));
    }
  }

  if (discovered.length === 0) {
    rows.push(row('money_checksums', '(none)', 'INFO', 'no money-bearing tables discovered'));
  }

  const snapshot = {
    version: 1,
    generated_at: new Date().toISOString(),
    today_excluded: today,
    tables,
  };
  return { rows, snapshot };
}

// ── Invariant 4: canonical actor_source set ─────────────────────────

export function checkCanonicalActorSources(db) {
  const rows = [];
  for (const table of userTables(db)) {
    const cols = tableColumns(db, table);
    if (!cols.includes('actor_source')) continue;
    const bad = db
      .prepare(
        `SELECT actor_source AS v, COUNT(*) AS n
         FROM ${JSON.stringify(table)}
         WHERE actor_source IS NOT NULL AND trim(actor_source) <> ''
         GROUP BY actor_source`
      )
      .all()
      .filter((r) => !CANONICAL_ACTOR_SOURCES.has(r.v));
    if (bad.length === 0) {
      rows.push(row('canonical_actor_source', table, 'PASS', 'all values canonical'));
    } else {
      const detail = bad.map((b) => `'${b.v}' (${b.n} row(s))`).join(', ');
      rows.push(row('canonical_actor_source', table, 'FAIL', `non-canonical: ${detail}`));
    }
  }
  return rows;
}

// ── Orchestration ───────────────────────────────────────────────────

function formatTable(results) {
  const header = { check: 'CHECK', scope: 'SCOPE', result: 'RESULT', detail: 'DETAIL' };
  const all = [header, ...results];
  const w = (k) => Math.max(...all.map((r) => String(r[k]).length));
  const cw = w('check');
  const sw = w('scope');
  const rw = w('result');
  const lines = [];
  const fmt = (r) =>
    `${String(r.check).padEnd(cw)} | ${String(r.scope).padEnd(sw)} | ${String(r.result).padEnd(rw)} | ${r.detail}`;
  lines.push(fmt(header));
  lines.push('-'.repeat(cw) + '-+-' + '-'.repeat(sw) + '-+-' + '-'.repeat(rw) + '-+-' + '-'.repeat(6));
  for (const r of results) lines.push(fmt(r));
  return lines;
}

/**
 * Run all four invariants against the DB at `dbPath` (opened READ-ONLY).
 * The only filesystem write is the money-checksum snapshot at
 * `snapshotPath`. Returns { exitCode, results }.
 */
export function runReconcile({
  dbPath,
  auditDir = null,
  since = null,
  snapshotPath,
  json = false,
  write = (s) => process.stdout.write(s + '\n'),
} = {}) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  let results = [];
  try {
    let priorSnapshot = null;
    if (snapshotPath && fs.existsSync(snapshotPath)) {
      try {
        priorSnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      } catch {
        results.push(row('money_checksums', path.basename(snapshotPath), 'INFO',
          'prior snapshot unreadable — treating as first run'));
      }
    }

    results = results.concat(checkWriterAttribution(db));
    results = results.concat(checkAuditCoverage(db, { since }));
    const money = checkMoneyChecksums(db, { priorSnapshot, since });
    results = results.concat(money.rows);
    results = results.concat(checkCanonicalActorSources(db));

    if (auditDir) {
      if (fs.existsSync(auditDir)) {
        const n = fs.readdirSync(auditDir).length;
        results.push(row('audit_jsonl_dir', auditDir, 'INFO', `present, ${n} entrie(s)`));
      } else {
        results.push(row('audit_jsonl_dir', auditDir, 'INFO', 'not present'));
      }
    }

    if (snapshotPath) {
      fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
      fs.writeFileSync(snapshotPath, JSON.stringify(money.snapshot, null, 2) + '\n');
    }
  } finally {
    db.close();
  }

  const pass = !results.some((r) => r.result === 'FAIL');
  if (json) {
    write(JSON.stringify({ pass, db: dbPath, since, results }, null, 2));
  } else {
    for (const line of formatTable(results)) write(line);
    write('');
    write(`RECONCILE: ${pass ? 'PASS' : 'FAIL'}`);
  }
  return { exitCode: pass ? 0 : 1, results };
}

// ── CLI ─────────────────────────────────────────────────────────────

const invokedAsScript = (() => {
  try {
    const argvPath = fs.realpathSync(process.argv[1]);
    const modulePath = fs.realpathSync(new URL(import.meta.url).pathname);
    return argvPath === modulePath;
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  const args = process.argv.slice(2);
  const opts = {
    dbPath: 'data/lariat.db',
    auditDir: 'data/audit',
    since: null,
    snapshotPath: path.join('data', 'cache', 'phase-c-reconcile-snapshot.json'),
    json: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--db') opts.dbPath = args[++i];
    else if (a === '--audit-dir') opts.auditDir = args[++i];
    else if (a === '--since') opts.since = args[++i];
    else if (a === '--snapshot') opts.snapshotPath = args[++i];
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'Usage: node scripts/phase-c-reconcile.mjs [--db path] [--audit-dir path]\n' +
        '         [--since YYYY-MM-DD] [--snapshot path] [--json]\n' +
        'Read-only §C4 reconciliation: writer attribution, audit coverage,\n' +
        'money checksums vs prior snapshot, canonical actor_source set.\n'
      );
      process.exit(0);
    } else {
      process.stderr.write(`phase-c-reconcile: unknown argument ${a}\n`);
      process.exit(2);
    }
  }
  if (opts.since && !/^\d{4}-\d{2}-\d{2}$/.test(opts.since)) {
    process.stderr.write(`phase-c-reconcile: --since must be YYYY-MM-DD, got ${opts.since}\n`);
    process.exit(2);
  }
  if (!fs.existsSync(opts.dbPath)) {
    process.stderr.write(`phase-c-reconcile: DB not found: ${opts.dbPath}\n`);
    process.exit(2);
  }
  const { exitCode } = runReconcile(opts);
  process.exit(exitCode);
}
