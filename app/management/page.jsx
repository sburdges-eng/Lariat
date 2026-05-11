// /management — GM rollup dashboard.
//
// Six read-only tiles composed from already-shipped helpers. No new
// business logic, no new schema, no new APIs. Each tile must render a
// graceful empty state on a fresh DB rather than throwing — server
// component, force-dynamic so it always reflects current DB state.
//
// PIN-gated by middleware.js (/management is in SENSITIVE_PREFIXES).

import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';

import { getDb } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import { readLastCostingIngest } from '../../lib/costingBenchmarks.mjs';
import { computeDishCoverage } from '../../lib/dishCostBridge';
import { readLatestAccountingVariance } from '../../lib/computeEngine/index';

import RollupTile from './_components/RollupTile';

export const dynamic = 'force-dynamic';

// ── Color rules (matches /costing where overlapping; documented in PR body) ──

function varianceColor(pct) {
  if (pct == null) return 'var(--muted)';
  if (pct >= 5) return 'var(--red)';
  if (pct >= 2) return 'var(--yellow)';
  return 'var(--green)';
}

function ingestColor(ageMin, status) {
  if (ageMin == null || status == null || status === 'failed') return 'var(--red)';
  if (ageMin >= 1440) return 'var(--red)';
  if (ageMin >= 60) return 'var(--yellow)';
  return 'var(--green)';
}

function coverageColor(c) {
  if (!c || c.total_sales_dishes === 0) return 'var(--muted)';
  if (c.unlinked > c.fully_linked) return 'var(--red)';
  if (c.unlinked > 0 || c.declared_only > 0 || c.partial > 0) return 'var(--yellow)';
  return 'var(--green)';
}

function complianceColor(unverified) {
  if (unverified == null) return 'var(--muted)';
  if (unverified > 20) return 'var(--red)';
  if (unverified > 0) return 'var(--yellow)';
  return 'var(--green)';
}

function packChangeColor(n) {
  if (n == null) return 'var(--muted)';
  if (n > 0) return 'var(--yellow)';
  return 'var(--green)';
}

function cleaningColor(n) {
  if (n == null) return 'var(--muted)';
  if (n === 0) return 'var(--yellow)';
  return 'var(--green)';
}

function reviewColor(n) {
  if (n == null) return 'var(--muted)';
  if (n === 0) return 'var(--yellow)';
  return 'var(--green)';
}

function formatAge(ageMin) {
  if (ageMin == null) return 'no runs on record';
  if (ageMin < 60) return `${ageMin} min ago`;
  if (ageMin < 1440) return `${Math.floor(ageMin / 60)} h ago`;
  return `${Math.floor(ageMin / 1440)} d ago`;
}

/**
 * Format `snapshot_at` (SQLite `datetime('now')` → "YYYY-MM-DD HH:MM:SS",
 * UTC, no zone) for the variance tile sub-line. Returns null on bad input
 * so the tile renders cleanly without a trailing " · as of —".
 */
function formatSnapshotAt(value) {
  if (typeof value !== 'string' || !value) return null;
  // datetime('now') has no 'Z'; treat as UTC for parsing, render in local.
  const iso = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Count unacknowledged pack-size changes. O(1) — replaces the prior
 * `computeUnmapped()` call that scanned every bom_lines row on each page
 * load. `pack_size_changes` has no `location_id` column (intentional —
 * vendor SKUs are global per ingest), so the location parameter is
 * accepted for symmetry but not bound. Guarded for legacy DBs that
 * predate the table.
 */
function readPackSizeChangesUnacked(db) {
  try {
    const row = db
      .prepare('SELECT COUNT(*) AS c FROM pack_size_changes WHERE acknowledged = 0')
      .get();
    return row?.c ?? 0;
  } catch {
    return null;
  }
}

// ── Per-tile readers (each isolates failure so one bad signal can't blank the page) ──

/** Count `verification.status === 'unverified'` rows in the curated rules JSONL. */
function readComplianceUnverified() {
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
      } catch { /* skip malformed line */ }
    }
    return { unverified, total, missing: false };
  } catch {
    return { unverified: null, total: null, missing: true };
  }
}

/** Today's cleaning_log row count for the current location. Inline read — not new business logic. */
function readCleaningToday(db, locationId) {
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const row = db.prepare(
      `SELECT COUNT(*) AS c FROM cleaning_log WHERE location_id = ? AND shift_date = ?`,
    ).get(locationId, today);
    return { count: row?.c ?? 0, today };
  } catch {
    return { count: null, today: null };
  }
}

/** Total performance reviews on file for the current location. */
function readPerformanceReviewsCount(db, locationId) {
  try {
    const row = db.prepare(
      `SELECT COUNT(*) AS c FROM performance_reviews WHERE location_id = ?`,
    ).get(locationId);
    return row?.c ?? 0;
  } catch {
    return null;
  }
}

function safeGet(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

// ── Page ──

// Hard cap — `computeDishCoverage` scans `dish_components` + `sales_lines`.
// Above this many distinct sales dishes, skip the read so the page stays
// snappy and surface a "view full report" prompt instead.
// TODO(management): introduce dish_coverage_snapshots populated by the
// compute engine and read from that table here. Tracked separately — out
// of scope for the rollup-tile PR.
const DISH_COVERAGE_CAP = 500;

export default function ManagementRollupPage({ searchParams }) {
  // Server component — read location from the query string so the
  // dashboard scopes to the same site the rest of the UI is viewing.
  // Client-side useLocation() pushes ?location=… on every nav.
  const locParam = searchParams?.location;
  const loc =
    typeof locParam === 'string' && locParam.trim()
      ? locParam.trim()
      : DEFAULT_LOCATION_ID;

  const db = getDb();

  // Each helper call is isolated so a single thrown read can't blank the dashboard.
  const variance = safeGet(() => readLatestAccountingVariance(db, loc), null);
  const ingest = safeGet(() => readLastCostingIngest(db), { last_run_at: null, last_status: null, age_minutes: null });

  // Cheap pre-check: how many distinct sales dishes are on file? If it
  // exceeds the cap, skip the full coverage scan so the page stays
  // responsive on large fleets.
  const dishCount = safeGet(
    () => db.prepare(
      `SELECT COUNT(DISTINCT item_name) AS c FROM sales_lines WHERE location_id = ?`,
    ).get(loc)?.c ?? 0,
    0,
  );
  const coverageCapped = dishCount > DISH_COVERAGE_CAP;
  const coverage = coverageCapped
    ? null
    : safeGet(() => computeDishCoverage(loc), null);

  const packChangesUnacked = readPackSizeChangesUnacked(db);
  const compliance = readComplianceUnverified();
  const cleaning = readCleaningToday(db, loc);
  const reviewsCount = readPerformanceReviewsCount(db, loc);

  const varianceSnapshot = formatSnapshotAt(variance?.snapshot_at);

  return (
    <div>
      <h1>Management</h1>
      <p className="subtitle">
        Your numbers at a glance. Tap any card to dig in.
      </p>

      <div className="grid grid-stations" style={{ marginBottom: 24 }}>
        {/* Tile 1 — Food cost vs. target (accounting variance) */}
        <RollupTile
          label="Food cost vs. target"
          value={
            variance && variance.variance_pct != null
              ? `${variance.variance_pct.toFixed(2)}%`
              : '—'
          }
          color={varianceColor(variance?.variance_pct)}
          sub={
            variance
              ? `theoretical $${(variance.theoretical_cogs ?? 0).toFixed(0)} vs actual $${(variance.actual_cogs ?? 0).toFixed(0)}${varianceSnapshot ? ` · as of ${varianceSnapshot}` : ''}`
              : 'no compute run yet'
          }
          href="/costing"
        />

        {/* Tile 2 — Costing ingest freshness */}
        <RollupTile
          label="Costing freshness"
          value={formatAge(ingest.age_minutes)}
          color={ingestColor(ingest.age_minutes, ingest.last_status)}
          sub={ingest.last_status ? `last status: ${ingest.last_status}` : 'never ingested'}
          href="/costing"
        />

        {/* Tile 3 — Menu items costed (capped to keep page load O(1)) */}
        <RollupTile
          label="Menu items costed"
          value={
            coverageCapped
              ? '—'
              : coverage && coverage.total_sales_dishes > 0
                ? `${coverage.fully_linked}/${coverage.total_sales_dishes}`
                : '—'
          }
          color={coverageCapped ? 'var(--muted)' : coverageColor(coverage)}
          sub={
            coverageCapped
              ? `${dishCount} dishes — too many to scan inline`
              : coverage && coverage.total_sales_dishes > 0
                ? `${coverage.unlinked} unlinked · ${coverage.declared_only} no-components`
                : 'no sales dishes on file'
          }
          note={coverageCapped ? 'open menu performance for full report' : null}
          href="/menu-engineering"
        />

        {/* Tile 4 — Unverified rules (curated rules JSONL) */}
        <RollupTile
          label="Unverified rules"
          value={compliance.unverified == null ? '—' : compliance.unverified}
          color={complianceColor(compliance.unverified)}
          sub={
            compliance.missing
              ? null
              : `of ${compliance.total} curated rules`
          }
          note={compliance.missing ? 'rules file not present on this checkout' : null}
          href="/food-safety"
        />

        {/* Tile 5 — Pack-size unack'd */}
        <RollupTile
          label="Pack-size changes unack'd"
          value={packChangesUnacked == null ? '—' : packChangesUnacked}
          color={packChangeColor(packChangesUnacked)}
          sub={packChangesUnacked == null ? 'compute unavailable' : 'acknowledge in Pack-size changes'}
          href="/costing/pack-changes"
        />

        {/* Tile 6 — Cleaning today */}
        <RollupTile
          label="Cleaning logged today"
          value={cleaning.count == null ? '—' : cleaning.count}
          color={cleaningColor(cleaning.count)}
          sub={cleaning.today ? `for ${cleaning.today}` : 'cleaning_log unavailable'}
          href="/food-safety"
        />

        {/* Tile 7 — Staff Reviews */}
        <RollupTile
          label="Staff reviews"
          value={reviewsCount == null ? '—' : reviewsCount}
          color={reviewColor(reviewsCount)}
          sub={reviewsCount == null ? 'reviews unavailable' : 'total reviews on record'}
          href="/management/performance-reviews"
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 14, marginBottom: 8 }}>More tools</h2>
        <ul style={{ fontSize: 13 }}>
          <li><Link href="/management/performance-reviews">Staff reviews</Link> — log and view performance</li>
          <li><Link href="/management/audit-log">Audit log</Link> — management actions outside regulated tables</li>
          <li><Link href="/management/cloud-bridge">Cloud bridge</Link> — stuck snapshots heading to corp</li>
          {/* Static design reference — the LaRiOS drop. Plain <a> because the
              target is served straight out of public/, not a Next route. */}
          <li><a href="/design-atlas/">Design Atlas</a> — LaRiOS prototypes and reference renders</li>
        </ul>
      </div>
    </div>
  );
}
