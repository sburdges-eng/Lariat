// T9 dashboard — three benchmark tiles on a single page:
//   B1 variance (max_variance_pct, colored + top-5 table)
//   B2 unmapped queue (unmapped_pct, colored + first-10 table)
//   B3 ingest age   (minutes since last costing ingest, colored + status)
//
// Thresholds (from docs/MAPPING_ENGINE_GAPS.md T9 acceptance):
//   variance:  green < 2   | yellow 2–5   | red ≥ 5
//   unmapped:  green < 1   | yellow 1–3   | red ≥ 3
//   ingest:    green < 60m | yellow 60–1440m | red ≥ 1440m, NULL, or 'failed'

import { getDb } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import {
  computeCostVariance,
  computeUnmapped,
  readLastCostingIngest,
} from '../../lib/t9Benchmarks.mjs';

export const dynamic = 'force-dynamic';

function varianceColor(maxPct) {
  if (maxPct == null) return 'var(--green)';
  if (maxPct >= 5) return 'var(--red)';
  if (maxPct >= 2) return 'var(--yellow)';
  return 'var(--green)';
}

function unmappedColor(pct) {
  if (pct == null) return 'var(--green)';
  if (pct >= 3) return 'var(--red)';
  if (pct >= 1) return 'var(--yellow)';
  return 'var(--green)';
}

function ingestColor(ageMin, status) {
  if (ageMin == null || status == null || status === 'failed') return 'var(--red)';
  if (ageMin >= 1440) return 'var(--red)';
  if (ageMin >= 60) return 'var(--yellow)';
  return 'var(--green)';
}

function formatAge(ageMin) {
  if (ageMin == null) return 'no runs on record';
  if (ageMin < 60) return `${ageMin} min ago`;
  if (ageMin < 1440) return `${Math.floor(ageMin / 60)} h ago`;
  return `${Math.floor(ageMin / 1440)} d ago`;
}

export default function CostingPage() {
  const loc = DEFAULT_LOCATION_ID;
  const db = getDb();
  const variance = computeCostVariance(db, loc);
  const unmapped = computeUnmapped(db, loc);
  const ingest = readLastCostingIngest(db);

  const topVariance = variance.rows.slice(0, 5);
  const firstUnmapped = unmapped.rows.slice(0, 10);

  return (
    <div>
      <h1>Costing benchmarks</h1>
      <p className="subtitle">
        Pre-deploy gate for the mapping engine. All three tiles must be green before shipping cost-based decisions.
        Run <code style={{ color: 'var(--accent)' }}>npm run ingest:costing</code> to refresh.
      </p>

      {/* B1 / B2 / B3 tiles */}
      <div className="grid grid-stations" style={{ marginBottom: 24 }}>
        <div className="card" style={{ borderColor: varianceColor(variance.max_variance_pct) }}>
          <div className="kpi-label">Cost variance (max)</div>
          <div className="kpi-value" style={{ color: varianceColor(variance.max_variance_pct) }}>
            {variance.max_variance_pct != null ? `${variance.max_variance_pct.toFixed(2)}%` : '—'}
          </div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            mean {variance.mean_variance_pct.toFixed(2)}% &middot; {variance.recipes_over_5pct} recipes &gt; 5%
          </div>
        </div>

        <div className="card" style={{ borderColor: unmappedColor(unmapped.unmapped_pct) }}>
          <div className="kpi-label">Unmapped BOM lines</div>
          <div className="kpi-value" style={{ color: unmappedColor(unmapped.unmapped_pct) }}>
            {unmapped.unmapped_pct.toFixed(2)}%
          </div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            {unmapped.unmapped_count} of {unmapped.total_items} lines
          </div>
        </div>

        <div className="card" style={{ borderColor: ingestColor(ingest.age_minutes, ingest.last_status) }}>
          <div className="kpi-label">Last costing ingest</div>
          <div className="kpi-value" style={{ color: ingestColor(ingest.age_minutes, ingest.last_status) }}>
            {formatAge(ingest.age_minutes)}
          </div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            {ingest.last_run_at ?? '—'} &middot; status {ingest.last_status ?? 'none'}
          </div>
        </div>
      </div>

      {/* B1 detail */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>Top 5 variance</h2>
          {topVariance.length === 0 ? (
            <p style={{ fontSize: 13 }}>
              No variance computable. Needs populated <code>recipe_costs.cost_per_yield_unit</code> and{' '}
              <code>vendor_prices</code> rows.
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Recipe</th>
                  <th>Variance</th>
                </tr>
              </thead>
              <tbody>
                {topVariance.map((r) => (
                  <tr key={r.recipe_id}>
                    <td>{r.recipe_name ?? r.recipe_id}</td>
                    <td>{r.variance_pct.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* B2 detail */}
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>First 10 unmapped</h2>
          {firstUnmapped.length === 0 ? (
            <p style={{ fontSize: 13 }}>All BOM lines mapped and priced.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Recipe</th>
                  <th>Ingredient</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {firstUnmapped.map((r, i) => (
                  <tr key={`${r.recipe_id}-${i}`}>
                    <td>{r.recipe_name ?? r.recipe_id}</td>
                    <td>{r.ingredient}</td>
                    <td>{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
