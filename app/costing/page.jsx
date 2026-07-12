// @ts-check
// T9 dashboard — three benchmark tiles on a single page:
//   B1 variance (max_variance_pct, colored + top-5 table)
//   B2 unmapped queue (unmapped_pct, colored + first-10 table)
//   B3 ingest age   (minutes since last costing ingest, colored + status)
//
// Thresholds (from docs/MAPPING_ENGINE_GAPS.md T9 acceptance):
//   variance:  green < 2   | yellow 2–5   | red ≥ 5
//   unmapped:  green < 1   | yellow 1–3   | red ≥ 3
//   ingest:    green < 60m | yellow 60–1440m | red ≥ 1440m, NULL, or 'failed'

import Link from 'next/link';
import { getDb } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import { formatDollars } from '../../lib/formatMoney';
import {
  computeCostVariance,
  computeUnmapped,
  readLastCostingIngest,
} from '../../lib/costingBenchmarks.mjs';
import { computeDishCoverage } from '../../lib/dishCostBridge';
import { readLatestAccountingVariance } from '../../lib/computeEngine/index';
import { computeMenuEngineering } from '../../lib/menuEngineering';
import { getVarianceTrend } from '../../lib/varianceTrend';
import AbcTile from './_components/AbcTile';
import VarianceTrend from './_components/VarianceTrend';

/** @typedef {import('../../lib/dishCostBridge.ts').DishCoverageReport} DishCoverageReport */
/** @typedef {import('../../lib/abcRanking.ts').AbcInputRow} AbcInputRow */

export const dynamic = 'force-dynamic';

/** @param {number | null | undefined} maxPct */
function varianceColor(maxPct) {
  if (maxPct == null) return 'var(--green)';
  if (maxPct >= 5) return 'var(--red)';
  if (maxPct >= 2) return 'var(--yellow)';
  return 'var(--green)';
}

/** @param {number | null | undefined} pct */
function unmappedColor(pct) {
  if (pct == null) return 'var(--green)';
  if (pct >= 3) return 'var(--red)';
  if (pct >= 1) return 'var(--yellow)';
  return 'var(--green)';
}

/**
 * @param {number | null | undefined} ageMin
 * @param {string | null | undefined} status
 */
function ingestColor(ageMin, status) {
  if (ageMin == null || status == null || status === 'failed') return 'var(--red)';
  if (ageMin >= 1440) return 'var(--red)';
  if (ageMin >= 60) return 'var(--yellow)';
  return 'var(--green)';
}

// dish-coverage tile color: red if more dishes are unlinked than linked,
// yellow if any are unlinked at all, green when fully wired.
/** @param {DishCoverageReport | null | undefined} c */
function coverageColor(c) {
  if (!c || c.total_sales_dishes === 0) return 'var(--muted)';
  if (c.unlinked > c.fully_linked) return 'var(--red)';
  if (c.unlinked > 0 || c.declared_only > 0 || c.partial > 0) return 'var(--yellow)';
  return 'var(--green)';
}

/** @param {number | null | undefined} ageMin */
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
  const dishCoverage = computeDishCoverage(loc);

  const topVariance = variance.rows.slice(0, 5);
  const firstUnmapped = unmapped.rows.slice(0, 10);

  /** @type {AbcInputRow[]} */
  let menuRows = [];
  try {
    const me = computeMenuEngineering(loc);
    menuRows = me.rows.map((r) => ({
      itemName: r.item_name,
      qty: r.qty,
      costPerUnit: r.cost_per_unit,
      marginPct: r.margin_pct,
      netSales: r.net_sales,
    }));
  } catch (e) {
    console.error('costing: menu-engineering compute failed', e);
  }
  const trend = getVarianceTrend(loc);

  return (
    <div>
      <h1>Cost checks</h1>
      <p className="subtitle">
        Three quick checks before trusting the cost numbers. Each tile turns green when it&rsquo;s in good shape.
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
          {/* D6: excluded-recipe counter. A recipe whose unmatched-lines ratio
              exceeds UNMATCHED_THRESHOLD (default 30%) is pulled from the
              variance aggregate. Surface the count so operators know the
              tile's numerator has a caveat — variance tile only meaningful
              when this counter is 0. */}
          {variance.summary?.excluded_high_unmatched > 0 ? (
            <div style={{ fontSize: 11, marginTop: 4, color: 'var(--yellow)' }}>
              {variance.summary.excluded_high_unmatched} recipe(s) excluded: high unmatched-lines ratio
            </div>
          ) : null}
        </div>

        <div className="card" style={{ borderColor: unmappedColor(unmapped.unmapped_pct) }}>
          <div className="kpi-label">Unmapped BOM lines</div>
          <div className="kpi-value" style={{ color: unmappedColor(unmapped.unmapped_pct) }}>
            {unmapped.unmapped_pct.toFixed(2)}%
          </div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            {unmapped.unmapped_count} of {unmapped.total_items} lines
          </div>
          {/* T6 B2 queue extension: surface the durable "still unacknowledged
              pack-size swap" count alongside the bom-line tile. Source is
              pack_size_changes.acknowledged=0 (never cleared by re-ingest).
              Links into the per-row triage queue at /costing/pack-changes. */}
          {unmapped.pack_size_changes_unacknowledged > 0 ? (
            <div style={{ fontSize: 11, marginTop: 4, color: 'var(--yellow)' }}>
              <Link href="/costing/pack-changes">
                {unmapped.pack_size_changes_unacknowledged} unack'd pack-size swap(s) →
              </Link>
            </div>
          ) : null}
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

        {/* B4 — Dish bridge coverage. Wires Toast dishes through
            recipes.menu_items[] + dish_components → recipe_costs. */}
        <div className="card" style={{ borderColor: coverageColor(dishCoverage) }}>
          <div className="kpi-label">Dish → recipe bridge</div>
          <div className="kpi-value" style={{ color: coverageColor(dishCoverage) }}>
            {dishCoverage.total_sales_dishes > 0
              ? `${dishCoverage.fully_linked} / ${dishCoverage.total_sales_dishes}`
              : '—'}
          </div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            {dishCoverage.unlinked} no link &middot; {dishCoverage.declared_only} no qty
          </div>
          <div style={{ fontSize: 11, marginTop: 4 }}>
            <Link href="/menu-engineering/components" style={{ color: 'var(--blue)' }}>
              edit dish_components →
            </Link>
          </div>
        </div>

        {/* Compute Engine: Accounting Variance */}
        {(() => {
          const v = readLatestAccountingVariance(db, loc);
          return (
            <div className="card" style={{ borderColor: (v && v.variance_pct > 5) ? 'var(--red)' : 'var(--green)' }}>
              <div className="kpi-label">Accounting Variance</div>
              <div className="kpi-value" style={{ color: (v && v.variance_pct > 5) ? 'var(--red)' : 'var(--green)' }}>
                {v ? `${v.variance_pct.toFixed(2)}%` : '—'}
              </div>
              <div style={{ fontSize: 12, marginTop: 6 }}>
                {v ? `${formatDollars(v.variance_amount)} vs ${formatDollars(v.theoretical_cogs)} (Theoretical)` : 'No computation yet'}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Phase-2 task E: master costing tile — ABC contribution +
          28-day COGS variance trend. Both render gracefully when
          their data sources are empty (amber notice, not error). */}
      <div className="grid grid-stations" style={{ marginBottom: 20 }}>
        <AbcTile menuRows={menuRows} />
        <VarianceTrend trend={trend} />
      </div>

      {/* Phase-1 triage links — every queue is one click from the dashboard. */}
      <div className="card form-row" style={{ marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <span style={{ opacity: 0.75, marginRight: 4 }}>Triage queues:</span>
        <Link href="/costing/depletion-exceptions" className="btn">
          Depletion exceptions
        </Link>
        <Link href="/costing/pack-changes" className="btn">
          Pack-size changes
        </Link>
        <Link href="/costing/price-shocks" className="btn">
          Price moves
        </Link>
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
                  <th title="Unmatched BOM lines / total lines; D6 pip when > 0">Unmatched</th>
                </tr>
              </thead>
              <tbody>
                {topVariance.map((r) => (
                  <tr key={r.recipe_id}>
                    <td>
                      {r.recipe_name ?? r.recipe_id}
                      {r.excluded ? (
                        <span style={{ fontSize: 10, marginLeft: 6, color: 'var(--yellow)' }}>
                          (excluded: {r.exclusion_reason})
                        </span>
                      ) : null}
                    </td>
                    <td>{r.variance_pct != null ? `${r.variance_pct.toFixed(2)}%` : '—'}</td>
                    <td>
                      {r.total_lines != null
                        ? (
                          <span
                            style={{
                              color: r.unmatched_lines > 0 ? 'var(--yellow)' : 'inherit',
                            }}
                          >
                            {r.unmatched_lines}/{r.total_lines}
                          </span>
                        )
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* B2 detail — bom_lines + vendor_pack_change unioned; see computeUnmapped. */}
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>First 10 unmapped</h2>
          {firstUnmapped.length === 0 ? (
            <p style={{ fontSize: 13 }}>All BOM lines mapped and priced.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Recipe / SKU</th>
                  <th>Ingredient</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {firstUnmapped.map((r, i) => (
                  <tr key={`${r.kind ?? 'bom'}-${r.recipe_id ?? r.sku ?? ''}-${i}`}>
                    <td>{r.kind ?? 'bom_line'}</td>
                    <td>
                      {r.kind === 'vendor_pack_change'
                        ? `${r.vendor ?? ''} ${r.sku ?? ''}`.trim()
                        : (r.recipe_name ?? r.recipe_id)}
                    </td>
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
