// Backfill entities_employees from existing source tables.
//
// Two sources, both walked in one pass:
//   1. Distinct cook_id strings — manual identity used across HACCP/labor
//      tables (shift_pic, gold_stars, staff_certifications, line_check_entries,
//      etc.). Tagged source='manual'.
//   2. Distinct (chosen_name, first_name, last_name, job_title) tuples
//      from toast_labor_by_job. Tagged source='toast'.
//
// Idempotent: re-running uses the resolver, which finds existing
// external_ids rows and bumps last_seen_at instead of duplicating.
//
// NOTE: this does NOT attempt to merge a Toast labor identity with a
// matching cook_id (e.g. Toast 'Sarah' + manual cook_id 'sarah_j').
// Entity resolution is a Phase-3 task — Phase 2 keeps the mapping
// 1:1 per source.

import { resolveOrCreateEmployee } from '../../lib/entities.ts';
import { makeTally, bumpTally, toastLaborExternalId } from './lib.mjs';

// All tables in lib/db.ts that carry a cook_id TEXT column. Sourced from
// `grep -n "cook_id" lib/db.ts`. Listed explicitly (not derived) so the
// backfill is reviewable: a new cook_id-bearing table requires a code
// change here. This is intentional — we'd rather miss a niche table
// than silently scoop strings from an unfamiliar one.
const COOK_ID_TABLES = [
  'line_check_entries',
  'station_signoffs',
  'eighty_six',
  'inventory_updates',
  'gold_stars',
  'shift_pic',
  'shift_breaks',
  'staff_certifications',
  'preshift_notes',
  'cooling_log',
  'date_marks',
  'receiving_log',
  'sanitizer_checks',
  'sick_worker_reports',
  'cleaning_log',
  'pest_control_log',
  'thermometer_calibrations',
  'tphc_entries',
  'employee_health_acknowledgments',
];

function tableExists(db, name) {
  return Boolean(
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name),
  );
}

function distinctCookIds(db) {
  const seen = new Set();
  for (const t of COOK_ID_TABLES) {
    if (!tableExists(db, t)) continue;
    // cook_id may be variously named on a few tables; the common shape
    // (>90% of usages) is `cook_id`. Skip the non-standard ones — they're
    // typed columns like `actor_cook_id`, `closed_by_cook_id` etc. that
    // are aliases of the same logical identity and would double-count.
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    if (!cols.includes('cook_id')) continue;
    const rows = db.prepare(`SELECT DISTINCT cook_id FROM ${t} WHERE cook_id IS NOT NULL AND TRIM(cook_id) != ''`).all();
    for (const r of rows) seen.add(String(r.cook_id).trim());
  }
  return seen;
}

function distinctToastLaborPeople(db) {
  if (!tableExists(db, 'toast_labor_by_job')) return [];
  return db
    .prepare(
      `SELECT DISTINCT chosen_name, first_name, last_name, job_title
         FROM toast_labor_by_job`,
    )
    .all();
}

/**
 * Backfill employees. Pass `apply: false` to dry-run (counts what would
 * happen without writing). Returns a tally `{ created, reused, skipped, errors }`.
 */
export function backfillEmployees(db, { apply = false } = {}) {
  const tally = makeTally();

  // Source 1: manual cook_ids.
  const cookIds = distinctCookIds(db);
  for (const cookId of cookIds) {
    if (!apply) {
      // dry-run: peek without writing — check if a row already exists.
      const exists = db
        .prepare(
          `SELECT 1 FROM external_ids
            WHERE entity_type='employee' AND source_system='manual'
              AND external_id=? AND location_id='default'`,
        )
        .get(cookId);
      bumpTally(tally, exists ? 'reused' : 'created');
      continue;
    }
    try {
      const r = resolveOrCreateEmployee(db, {
        source_system: 'manual',
        external_id: cookId,
        display_name: cookId,
      });
      bumpTally(tally, r.created ? 'created' : 'reused');
    } catch (err) {
      bumpTally(tally, 'error');
      console.error(`employees: cook_id=${cookId}: ${err.message}`);
    }
  }

  // Source 2: Toast labor.
  const toastPeople = distinctToastLaborPeople(db);
  for (const p of toastPeople) {
    const externalId = toastLaborExternalId(p);
    if (!externalId) {
      bumpTally(tally, 'skipped');
      continue;
    }
    const display =
      (p.chosen_name ?? '').trim() ||
      `${(p.first_name ?? '').trim()} ${(p.last_name ?? '').trim()}`.trim() ||
      externalId;
    if (!apply) {
      const exists = db
        .prepare(
          `SELECT 1 FROM external_ids
            WHERE entity_type='employee' AND source_system='toast'
              AND external_id=? AND location_id='default'`,
        )
        .get(externalId);
      bumpTally(tally, exists ? 'reused' : 'created');
      continue;
    }
    try {
      const r = resolveOrCreateEmployee(db, {
        source_system: 'toast',
        external_id: externalId,
        display_name: display,
        metadata: {
          first_name: p.first_name ?? null,
          last_name: p.last_name ?? null,
          job_title: p.job_title ?? null,
        },
      });
      bumpTally(tally, r.created ? 'created' : 'reused');
    } catch (err) {
      bumpTally(tally, 'error');
      console.error(`employees: toast=${externalId}: ${err.message}`);
    }
  }

  return tally;
}
