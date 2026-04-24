import type { Database } from 'better-sqlite3';

/**
 * Options for {@link computeAccountingVariance}. Both dates are
 * `YYYY-MM-DD`; when omitted, the window defaults to the current
 * calendar month ([first-of-month, today]). The resolved window is
 * recorded in the `accounting_variance` row so operators know what
 * period produced the numbers (docs/COMPUTE_ENGINE_REVIEW C3).
 */
export type AccountingVarianceOptions = {
  period_start?: string;
  period_end?: string;
};

function defaultPeriod(): { start: string; end: string } {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return {
    start: `${yyyy}-${mm}-01`,
    end: `${yyyy}-${mm}-${dd}`,
  };
}

/** 'YYYY-MM-DD' → 'YYYY-MM' for month-granular spend_monthly filters. */
function toYearMonth(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Compute and persist one `accounting_variance` row for the given
 * location and time window.
 *
 * Theoretical COGS = Σ (sales_lines.quantity_sold ×
 *                       recipe_costs.cost_per_yield_unit).
 *   `sales_lines` carries no per-row date today — the analytics ingest
 *   deletes and re-inserts one period's worth at a time (see
 *   `scripts/ingest-analytics.mjs`), so "the current contents of
 *   sales_lines for this location" is operationally scoped to the
 *   latest ingest. We sum all rows and trust that convention.
 *   Adding row-level dates is a follow-up schema change; see
 *   docs/COMPUTE_ENGINE_REVIEW C3.
 * Actual COGS      = Σ spend_monthly.shamrock_total_spend filtered to
 *                       [toYearMonth(period_start), toYearMonth(period_end)]
 *                       inclusive. `spend_monthly.month` is stored as
 *                       `YYYY-MM` text.
 *
 * Fixes:
 *   C2 — theoretical now uses `cost_per_yield_unit` (cost per serving),
 *        not `batch_cost` (cost per whole yield). The prior version
 *        over-counted by a factor of `yield` (10–40× typical).
 *   C3 — `spend_monthly` is window-filtered and the resolved
 *        [period_start, period_end] is persisted in the variance row.
 */
export function computeAccountingVariance(
  db: Database,
  locationId: string,
  opts: AccountingVarianceOptions = {},
) {
  const def = defaultPeriod();
  const periodStart = opts.period_start || def.start;
  const periodEnd = opts.period_end || def.end;
  const monthStart = toYearMonth(periodStart);
  const monthEnd = toYearMonth(periodEnd);

  db.transaction(() => {
    const theoreticalRaw = db
      .prepare(
        `SELECT SUM(s.quantity_sold * COALESCE(rc.cost_per_yield_unit, 0))
           AS theoretical_cogs
           FROM sales_lines s
           LEFT JOIN recipe_costs rc
             ON (s.item_name = rc.recipe_name
                 AND rc.location_id = s.location_id)
          WHERE s.location_id = ?`,
      )
      .get(locationId) as { theoretical_cogs: number | null };
    const theoreticalCogs = theoreticalRaw?.theoretical_cogs ?? 0;

    const actualRaw = db
      .prepare(
        `SELECT SUM(shamrock_total_spend) AS actual_cogs
           FROM spend_monthly
          WHERE location_id = ?
            AND month >= ? AND month <= ?`,
      )
      .get(locationId, monthStart, monthEnd) as {
      actual_cogs: number | null;
    };
    const actualCogs = actualRaw?.actual_cogs ?? 0;

    const varianceAmount = actualCogs - theoreticalCogs;
    const variancePct =
      theoreticalCogs > 0 ? (varianceAmount / theoreticalCogs) * 100 : 0;

    db.prepare(
      `INSERT INTO accounting_variance (
         period_start, period_end,
         theoretical_cogs, actual_cogs,
         variance_amount, variance_pct, location_id
       ) VALUES (
         @period_start, @period_end,
         @theoretical_cogs, @actual_cogs,
         @variance_amount, @variance_pct, @location_id
       )`,
    ).run({
      period_start: periodStart,
      period_end: periodEnd,
      theoretical_cogs: theoreticalCogs,
      actual_cogs: actualCogs,
      variance_amount: varianceAmount,
      variance_pct: variancePct,
      location_id: locationId,
    });
  })();
}
