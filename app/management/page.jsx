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

import { getDb } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import {
  computeUnmapped,
  readLastCostingIngest,
} from '../../lib/costingBenchmarks.mjs';
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

function formatAge(ageMin) {
  if (ageMin == null) return 'no runs on record';
  if (ageMin < 60) return `${ageMin} min ago`;
  if (ageMin < 1440) return `${Math.floor(ageMin / 60)} h ago`;
  return `${Math.floor(ageMin / 1440)} d ago`;
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

function safeGet(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

// ── Page ──

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
  const coverage = safeGet(() => computeDishCoverage(loc), null);
  const unmapped = safeGet(() => computeUnmapped(db, loc), null);
  const compliance = readComplianceUnverified();
  const cleaning = readCleaningToday(db, loc);

  return (
    <div>
      <h1>Management</h1>
      <p className="subtitle">
        At-a-glance rollup. Each tile composes an existing dashboard signal — drill into the linked
        section for detail.
      </p>

      <div className="grid grid-stations" style={{ marginBottom: 24 }}>
        {/* Tile 1 — COGS variance current */}
        <RollupTile
          label="COGS variance (current)"
          value={
            variance && variance.variance_pct != null
              ? `${variance.variance_pct.toFixed(2)}%`
              : '—'
          }
          color={varianceColor(variance?.variance_pct)}
          sub={
            variance
              ? `theoretical $${(variance.theoretical_cogs ?? 0).toFixed(0)} vs actual $${(variance.actual_cogs ?? 0).toFixed(0)}`
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

        {/* Tile 3 — Dish-bridge coverage */}
        <RollupTile
          label="Dish-bridge coverage"
          value={
            coverage && coverage.total_sales_dishes > 0
              ? `${coverage.fully_linked}/${coverage.total_sales_dishes}`
              : '—'
          }
          color={coverageColor(coverage)}
          sub={
            coverage && coverage.total_sales_dishes > 0
              ? `${coverage.unlinked} unlinked · ${coverage.declared_only} no-components`
              : 'no sales dishes on file'
          }
          href="/menu-engineering"
        />

        {/* Tile 4 — Compliance health (curated rules JSONL) */}
        <RollupTile
          label="Compliance rules unverified"
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
          value={unmapped == null ? '—' : unmapped.pack_size_changes_unacknowledged}
          color={packChangeColor(unmapped?.pack_size_changes_unacknowledged)}
          sub={unmapped == null ? 'compute unavailable' : 'acknowledge in Pack-size changes'}
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
      </div>

      <div style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 14, marginBottom: 8 }}>Other management surfaces</h2>
        <ul style={{ fontSize: 13 }}>
          <li><a href="/management/audit-log">Audit log</a> — management actions outside regulated tables</li>
        </ul>
      </div>
    </div>
  );
}
