#!/usr/bin/env node
// scripts/ingest-sevenshifts.mjs
//
// Phase-4 ingest: pulls users, shifts, and time-punches from the 7shifts
// v2 API and lands them in raw tables (sevenshifts_users / *_shifts /
// *_time_punches). Each user is resolved through lib/entities.ts so the
// labor records hang off the canonical employee UUID.
//
// Usage:
//   node --experimental-strip-types scripts/ingest-sevenshifts.mjs           # dry-run
//   node --experimental-strip-types scripts/ingest-sevenshifts.mjs --apply
//   node --experimental-strip-types scripts/ingest-sevenshifts.mjs --apply --only=users
//   node --experimental-strip-types scripts/ingest-sevenshifts.mjs --apply \
//        --since=2026-03-01 --until=2026-03-31
//
// Default time window for shifts/time-punches: last 35 days.

import { paginate7shifts } from './sevenshifts_api/client.mjs';

const RESOURCES = ['users', 'shifts', 'time_punches'];

function parseArgs(argv) {
  const args = {
    apply: false,
    only: null,
    since: null,
    until: null,
    location: 'default',
  };
  for (const a of argv.slice(2)) {
    if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.apply = false;
    else if (a.startsWith('--only=')) {
      args.only = a.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith('--since=')) args.since = a.slice('--since='.length);
    else if (a.startsWith('--until=')) args.until = a.slice('--until='.length);
    else if (a.startsWith('--location=')) args.location = a.slice('--location='.length);
    else if (a === '-h' || a === '--help') args.help = true;
    else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function defaultWindow() {
  const now = new Date();
  const until = now.toISOString().slice(0, 10);
  const sinceDate = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
  const since = sinceDate.toISOString().slice(0, 10);
  return { since, until };
}

function printHelp() {
  console.log(`ingest-sevenshifts — pull users/shifts/time-punches from 7shifts

Usage:
  node --experimental-strip-types scripts/ingest-sevenshifts.mjs [flags]

Flags:
  --apply               Write to DB (default: dry-run, prints counts).
  --only=<csv>          Subset of resources: ${RESOURCES.join(', ')}.
  --since=YYYY-MM-DD    Start of shifts/time_punches window (default: 35d ago).
  --until=YYYY-MM-DD    End of window (default: today).
  --location=<id>       Default 'default'.
  -h, --help            Show this help.

Setup: see scripts/sevenshifts_api/README.md.
`);
}

// ── Mappers (pure: API row → DB row) ────────────────────────────────

function userToRow(u, location_id) {
  return {
    seven_id: String(u.id),
    location_id,
    first_name: u.first_name ?? null,
    last_name: u.last_name ?? null,
    preferred_name: u.preferred_name ?? null,
    email: u.email ?? null,
    phone: u.mobile_number ?? u.phone ?? null,
    employee_id: u.employee_id ?? null,
    role_ids_json: Array.isArray(u.role_ids) ? JSON.stringify(u.role_ids) : null,
    hire_date: u.hire_date ?? null,
    active: u.inactive ? 0 : 1,
    raw_json: JSON.stringify(u),
  };
}

function shiftToRow(s, location_id) {
  return {
    seven_id: String(s.id),
    location_id,
    user_seven_id: s.user_id != null ? String(s.user_id) : null,
    role_id: s.role_id != null ? String(s.role_id) : null,
    department_id: s.department_id != null ? String(s.department_id) : null,
    start_at: s.start ?? null,
    end_at: s.end ?? null,
    published: s.published ? 1 : 0,
    deleted: s.deleted ? 1 : 0,
    raw_json: JSON.stringify(s),
  };
}

function punchToRow(p, location_id) {
  // hours_worked: 7shifts emits seconds for clocked totals on some
  // endpoints and decimal hours on others. Compute defensively from
  // clocked_in/out when we have both, fall back to whatever the row
  // carries.
  let hours = null;
  if (p.clocked_in && p.clocked_out) {
    const inMs = Date.parse(p.clocked_in);
    const outMs = Date.parse(p.clocked_out);
    if (Number.isFinite(inMs) && Number.isFinite(outMs) && outMs > inMs) {
      hours = (outMs - inMs) / 3600_000;
    }
  }
  if (hours == null && typeof p.hours === 'number') hours = p.hours;
  return {
    seven_id: String(p.id),
    location_id,
    user_seven_id: p.user_id != null ? String(p.user_id) : null,
    role_id: p.role_id != null ? String(p.role_id) : null,
    clocked_in_at: p.clocked_in ?? null,
    clocked_out_at: p.clocked_out ?? null,
    hours_worked: hours,
    approved: p.approved ? 1 : 0,
    raw_json: JSON.stringify(p),
  };
}

// Exported for unit tests so we don't have to touch a live 7shifts
// account just to assert the mapping is correct.
export const mappers = { userToRow, shiftToRow, punchToRow };

// ── Writers (DB inserts; idempotent via PRIMARY KEY upsert) ─────────

function upsertUser(db, row) {
  db.prepare(
    `INSERT INTO sevenshifts_users
       (seven_id, location_id, employee_uuid, first_name, last_name,
        preferred_name, email, phone, employee_id, role_ids_json,
        hire_date, active, raw_json, ingested_at)
     VALUES (@seven_id, @location_id, @employee_uuid, @first_name, @last_name,
             @preferred_name, @email, @phone, @employee_id, @role_ids_json,
             @hire_date, @active, @raw_json, datetime('now'))
     ON CONFLICT(seven_id, location_id) DO UPDATE SET
       employee_uuid = excluded.employee_uuid,
       first_name = excluded.first_name, last_name = excluded.last_name,
       preferred_name = excluded.preferred_name, email = excluded.email,
       phone = excluded.phone, employee_id = excluded.employee_id,
       role_ids_json = excluded.role_ids_json, hire_date = excluded.hire_date,
       active = excluded.active, raw_json = excluded.raw_json,
       ingested_at = datetime('now')`,
  ).run(row);
}

function upsertShift(db, row) {
  db.prepare(
    `INSERT INTO sevenshifts_shifts
       (seven_id, location_id, user_seven_id, employee_uuid, role_id,
        department_id, start_at, end_at, published, deleted, raw_json,
        ingested_at)
     VALUES (@seven_id, @location_id, @user_seven_id, @employee_uuid, @role_id,
             @department_id, @start_at, @end_at, @published, @deleted, @raw_json,
             datetime('now'))
     ON CONFLICT(seven_id, location_id) DO UPDATE SET
       user_seven_id = excluded.user_seven_id,
       employee_uuid = excluded.employee_uuid,
       role_id = excluded.role_id, department_id = excluded.department_id,
       start_at = excluded.start_at, end_at = excluded.end_at,
       published = excluded.published, deleted = excluded.deleted,
       raw_json = excluded.raw_json, ingested_at = datetime('now')`,
  ).run(row);
}

function upsertPunch(db, row) {
  db.prepare(
    `INSERT INTO sevenshifts_time_punches
       (seven_id, location_id, user_seven_id, employee_uuid, role_id,
        clocked_in_at, clocked_out_at, hours_worked, approved, raw_json,
        ingested_at)
     VALUES (@seven_id, @location_id, @user_seven_id, @employee_uuid, @role_id,
             @clocked_in_at, @clocked_out_at, @hours_worked, @approved, @raw_json,
             datetime('now'))
     ON CONFLICT(seven_id, location_id) DO UPDATE SET
       user_seven_id = excluded.user_seven_id,
       employee_uuid = excluded.employee_uuid, role_id = excluded.role_id,
       clocked_in_at = excluded.clocked_in_at,
       clocked_out_at = excluded.clocked_out_at,
       hours_worked = excluded.hours_worked, approved = excluded.approved,
       raw_json = excluded.raw_json, ingested_at = datetime('now')`,
  ).run(row);
}

// ── Orchestrator ────────────────────────────────────────────────────

async function ingestUsers(db, args, resolver) {
  let pulled = 0;
  let written = 0;
  const userIdToUuid = new Map();
  for await (const u of paginate7shifts('users', { query: { active: 1 } })) {
    pulled++;
    const row = userToRow(u, args.location);
    const display =
      row.preferred_name?.trim() ||
      `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() ||
      row.seven_id;
    if (args.apply) {
      const r = resolver({
        source_system: '7shifts',
        external_id: row.seven_id,
        display_name: display,
        primary_email: row.email,
        primary_phone: row.phone,
        location_id: args.location,
        metadata: {
          first_name: row.first_name, last_name: row.last_name,
          preferred_name: row.preferred_name, employee_id: row.employee_id,
          hire_date: row.hire_date,
        },
      });
      row.employee_uuid = r.uuid;
      upsertUser(db, row);
      written++;
    } else {
      row.employee_uuid = null;
    }
    userIdToUuid.set(row.seven_id, row.employee_uuid);
  }
  return { pulled, written, userIdToUuid };
}

async function ingestShifts(db, args, userIdToUuid) {
  const win = (args.since && args.until) ? { since: args.since, until: args.until } : defaultWindow();
  let pulled = 0;
  let written = 0;
  for await (const s of paginate7shifts('shifts', {
    query: { start_date: win.since, end_date: win.until },
  })) {
    pulled++;
    const row = shiftToRow(s, args.location);
    row.employee_uuid = row.user_seven_id ? userIdToUuid.get(row.user_seven_id) ?? null : null;
    if (args.apply) {
      upsertShift(db, row);
      written++;
    }
  }
  return { pulled, written, window: win };
}

async function ingestPunches(db, args, userIdToUuid) {
  const win = (args.since && args.until) ? { since: args.since, until: args.until } : defaultWindow();
  let pulled = 0;
  let written = 0;
  for await (const p of paginate7shifts('time_punches', {
    query: { clocked_in_gte: `${win.since}T00:00:00Z`, clocked_in_lte: `${win.until}T23:59:59Z` },
  })) {
    pulled++;
    const row = punchToRow(p, args.location);
    row.employee_uuid = row.user_seven_id ? userIdToUuid.get(row.user_seven_id) ?? null : null;
    if (args.apply) {
      upsertPunch(db, row);
      written++;
    }
  }
  return { pulled, written, window: win };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const selected = args.only ?? RESOURCES;
  const unknown = selected.filter((r) => !RESOURCES.includes(r));
  if (unknown.length) {
    console.error(`unknown resources: ${unknown.join(', ')} (known: ${RESOURCES.join(', ')})`);
    process.exit(2);
  }

  const { getDb } = await import('../lib/db.ts');
  const { resolveOrCreateEmployee } = await import('../lib/entities.ts');
  const db = getDb();

  console.log(`ingest-sevenshifts (${args.apply ? 'APPLY' : 'DRY-RUN'})`);
  console.log(`  location=${args.location}`);
  console.log(`  resources=${selected.join(',')}`);

  // Users always run first (or with shifts/punches) so the user→uuid map
  // is populated; if --only=shifts is passed we still need at least the
  // user IDs we already have on disk.
  let userIdToUuid = new Map();
  if (selected.includes('users') || selected.includes('shifts') || selected.includes('time_punches')) {
    if (selected.includes('users')) {
      const u = await ingestUsers(db, args, (input) => resolveOrCreateEmployee(db, input));
      userIdToUuid = u.userIdToUuid;
      console.log(`  users        … pulled=${u.pulled} written=${u.written}`);
    } else {
      const rows = db.prepare(
        `SELECT seven_id, employee_uuid FROM sevenshifts_users WHERE location_id=?`,
      ).all(args.location);
      for (const r of rows) userIdToUuid.set(r.seven_id, r.employee_uuid);
    }
  }
  if (selected.includes('shifts')) {
    const s = await ingestShifts(db, args, userIdToUuid);
    console.log(`  shifts       … pulled=${s.pulled} written=${s.written} window=${s.window.since}..${s.window.until}`);
  }
  if (selected.includes('time_punches')) {
    const p = await ingestPunches(db, args, userIdToUuid);
    console.log(`  time_punches … pulled=${p.pulled} written=${p.written} window=${p.window.since}..${p.window.until}`);
  }

  if (!args.apply) {
    console.log('');
    console.log('(dry-run: no writes. Re-run with --apply to commit.)');
  }
}

// `main()` runs only when invoked directly (not when imported by tests).
const isDirectInvocation =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('ingest-sevenshifts.mjs');
if (isDirectInvocation) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
