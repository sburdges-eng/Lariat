// The /management rollup's per-tile database readers.
//
// These live here rather than inline in page.jsx so the contract test can
// import the SAME code the page runs. tests/js/test-management-rollup.mjs used
// to declare itself "the contract" while defining its own *LikePage copies of
// this SQL, which is a mirror, not a contract — and the mirror had already
// rotted: its cleaning reader computed a UTC date while the page had moved to
// serviceDate(), and the suite stayed green because its own fixture inserts
// used the same stale expression.
//
// Server-only: imports lib/db and reads the filesystem. Nothing here may be
// pulled into a client bundle.
//
// Each reader isolates its own failure so one bad signal cannot blank the
// whole page — that posture is deliberate and is preserved verbatim.

import fs from 'node:fs';
import path from 'node:path';
import type { Database as DB } from 'better-sqlite3';

import { todayISO } from '../../lib/db.ts';
import { serviceDate } from '../../lib/serviceDate.ts';
import { listDepletionExceptions } from '../../lib/depletionExceptions.ts';
import { listPriceShocks } from '../../lib/vendorPricesRepo.ts';

/**
 * Count unacknowledged pack-size changes. O(1).
 *
 * `pack_size_changes` has no `location_id` column (intentional — vendor SKUs
 * are global per ingest), so no location is bound. Guarded for legacy DBs that
 * predate the table.
 */
export function readPackSizeChangesUnacked(db: DB): number | null {
  try {
    const row = db
      .prepare('SELECT COUNT(*) AS c FROM pack_size_changes WHERE acknowledged = 0')
      .get() as { c: number } | undefined;
    return row?.c ?? 0;
  } catch {
    return null;
  }
}

/** Today's cleaning_log row count for this location, and the day it counted. */
export function readCleaningToday(
  db: DB,
  locationId: string,
): { count: number | null; today: string | null } {
  try {
    // cleaning_log.shift_date follows the service day (wave 1 triad).
    const today = serviceDate();
    const row = db
      .prepare('SELECT COUNT(*) AS c FROM cleaning_log WHERE location_id = ? AND shift_date = ?')
      .get(locationId, today) as { c: number } | undefined;
    return { count: row?.c ?? 0, today };
  } catch {
    return { count: null, today: null };
  }
}

/** Performance reviews on file for this location. */
export function readPerformanceReviewsCount(db: DB, locationId: string): number | null {
  try {
    const row = db
      .prepare('SELECT COUNT(*) AS c FROM performance_reviews WHERE location_id = ?')
      .get(locationId) as { c: number } | undefined;
    return row?.c ?? 0;
  } catch {
    return null;
  }
}

/** Accepted receiving rows with quantity that still need a master ingredient. */
export function readReceivingMatchesCount(db: DB, locationId: string): number | null {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c
           FROM receiving_log r
          WHERE r.location_id = ?
            AND r.status IN ('accepted', 'accepted_with_note')
            AND r.received_qty IS NOT NULL
            AND r.received_qty > 0
            AND r.received_unit IS NOT NULL
            AND TRIM(r.received_unit) <> ''
            AND r.match_status IN ('unmatched', 'ambiguous')`,
      )
      .get(locationId) as { c: number } | undefined;
    return row?.c ?? 0;
  } catch {
    return null;
  }
}

/** Vendor SKUs with a 5%+ move in the same 7-day window as /costing/price-shocks. */
export function readPriceShockSummary(
  db: DB,
  locationId: string,
): { total: number; up: number; down: number } {
  const shocks = listPriceShocks(db, {
    location_id: locationId,
    windowDays: 7,
    minPctMove: 5,
    limit: 100,
  });
  return {
    total: shocks.length,
    up: shocks.filter((s) => s.direction === 'up').length,
    down: shocks.filter((s) => s.direction === 'down').length,
  };
}

/** Current unresolved depletion exception count for this location. */
export function readDepletionIssuesCount(db: DB, locationId: string): number {
  return listDepletionExceptions(db, { location_id: locationId, limit: 100 }).length;
}

/** Active certs that are expired or expiring within 30 days. */
export function readCertWarnings(
  db: DB,
  locationId: string,
): { expired: number; expiringSoon: number; total: number } {
  // expires_on is a calendar date on the cert, not a shift_date — keep UTC
  // todayISO() so "days until expiry" tracks the reporting calendar.
  const today = todayISO();
  const rows = db
    .prepare(
      `SELECT expires_on
         FROM staff_certifications
        WHERE location_id = ?
          AND active = 1
          AND expires_on IS NOT NULL`,
    )
    .all(locationId) as { expires_on: string }[];

  const todayMs = new Date(today + 'T00:00:00Z').getTime();
  let expired = 0;
  let expiringSoon = 0;
  for (const r of rows) {
    const expMs = new Date(r.expires_on + 'T00:00:00Z').getTime();
    if (Number.isNaN(expMs)) continue;
    const days = Math.floor((expMs - todayMs) / 86400000);
    if (days < 0) expired++;
    else if (days <= 30) expiringSoon++;
  }
  return { expired, expiringSoon, total: expired + expiringSoon };
}

/** Count `verification.status === 'unverified'` rows in the curated rules JSONL. */
export function readComplianceUnverified(): {
  unverified: number | null;
  total: number | null;
  missing: boolean;
} {
  const file = path.join(process.cwd(), 'data', 'normalized', 'compliance_rules.jsonl');
  try {
    if (!fs.existsSync(file)) return { unverified: null, total: null, missing: true };
    const txt = fs.readFileSync(file, 'utf8');
    let unverified = 0;
    let total = 0;
    for (const line of txt.split(/\r?\n/)) {
      if (!line.trim()) continue;
      total++;
      try {
        const row = JSON.parse(line);
        if (row?.verification?.status === 'unverified') unverified++;
      } catch {
        /* skip malformed line */
      }
    }
    return { unverified, total, missing: false };
  } catch {
    return { unverified: null, total: null, missing: true };
  }
}
