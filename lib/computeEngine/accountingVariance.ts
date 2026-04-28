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

/** 'YYYY-MM-DD' → 'YYYY-MM' for month-granular spend filters. */
function toYearMonth(iso: string): string {
  return iso.slice(0, 7);
}

function tableExists(db: Database, name: string): boolean {
  return Boolean(
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name),
  );
}

// ── Actual COGS rollup ──────────────────────────────────────────────

/**
 * Per-vendor monthly amount for a given window. `source` documents which
 * underlying table the number came from so the breakdown is auditable
 * — the field is what gets serialized into accounting_variance.actual_cogs_breakdown_json.
 */
export interface VendorSpendLine {
  vendor: string;
  source: 'shamrock_invoices' | 'sysco_invoices' | 'spend_monthly';
  amount: number;
}

export interface ActualCogsBreakdown {
  total: number;
  per_vendor: VendorSpendLine[];
}

/**
 * Sum line_total from a per-line invoice table within the [monthStart,
 * monthEnd] inclusive YYYY-MM window. Empty result when the table is
 * absent or has no qualifying rows. Pure modulo the DB read.
 */
function sumInvoiceTable(
  db: Database,
  table: string,
  locationId: string,
  monthStart: string,
  monthEnd: string,
): number {
  if (!tableExists(db, table)) return 0;
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(line_total), 0) AS amount
         FROM ${table}
        WHERE location_id = ?
          AND delivery_date IS NOT NULL
          AND substr(delivery_date, 1, 7) >= ?
          AND substr(delivery_date, 1, 7) <= ?`,
    )
    .get(locationId, monthStart, monthEnd) as { amount: number };
  return row?.amount ?? 0;
}

/**
 * Build the actual-COGS breakdown for a given location + window across
 * every vendor we know how to read from.
 *
 * Precedence:
 *   - Shamrock: prefer `shamrock_invoices.line_total` (granular). Fall
 *     back to `spend_monthly.shamrock_total_spend` ONLY when the invoice
 *     table contributes 0 for the entire window — protects against
 *     double-counting an Excel-rolled-up number alongside the same
 *     month's invoice line items.
 *   - Sysco: `sysco_invoices.line_total`. No legacy spend_monthly column
 *     — Sysco never had one. The table itself is created on first
 *     `scripts/ingest_sysco_invoice_pdfs.py` run; we tolerate its
 *     absence and report 0.
 *   - Other vendors: not yet wired. Webstaurant purchases land in
 *     `equipment` (not consumable spend); future per-vendor invoice
 *     tables (e.g. produce, beverage) plug in here.
 *
 * Vendors with $0 in the window are omitted from `per_vendor` so the
 * JSON stays compact.
 *
 * Exported for tests and for any UI that wants to surface the per-vendor
 * detail without re-running the whole variance calc.
 */
export function computeActualCogsBreakdown(
  db: Database,
  locationId: string,
  monthStart: string,
  monthEnd: string,
): ActualCogsBreakdown {
  const lines: VendorSpendLine[] = [];

  // Shamrock: invoice table is preferred. Fall back to spend_monthly
  // only when the invoice contribution is exactly 0 across the window
  // (operator hasn't ingested invoice PDFs yet but the workbook
  // aggregate exists).
  const shamrockInvoices = sumInvoiceTable(
    db, 'shamrock_invoices', locationId, monthStart, monthEnd,
  );
  if (shamrockInvoices > 0) {
    lines.push({ vendor: 'shamrock', source: 'shamrock_invoices', amount: shamrockInvoices });
  } else if (tableExists(db, 'spend_monthly')) {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(shamrock_total_spend), 0) AS amount
           FROM spend_monthly
          WHERE location_id = ?
            AND month >= ? AND month <= ?`,
      )
      .get(locationId, monthStart, monthEnd) as { amount: number };
    if (row.amount > 0) {
      lines.push({ vendor: 'shamrock', source: 'spend_monthly', amount: row.amount });
    }
  }

  // Sysco: only if the invoice table exists. No legacy fallback.
  const sysco = sumInvoiceTable(db, 'sysco_invoices', locationId, monthStart, monthEnd);
  if (sysco > 0) {
    lines.push({ vendor: 'sysco', source: 'sysco_invoices', amount: sysco });
  }

  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { total, per_vendor: lines };
}

// ── Variance ───────────────────────────────────────────────────────

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
 *
 * Actual COGS      = computeActualCogsBreakdown (multi-vendor roll-up
 *                       across shamrock_invoices + sysco_invoices +
 *                       legacy spend_monthly fallback). The per-vendor
 *                       breakdown is JSON-serialized into
 *                       accounting_variance.actual_cogs_breakdown_json
 *                       for auditability.
 *
 * History:
 *   C2 — theoretical now uses `cost_per_yield_unit` (cost per serving),
 *        not `batch_cost` (cost per whole yield). The prior version
 *        over-counted by a factor of `yield` (10–40× typical).
 *   C3 — `spend_monthly` is window-filtered and the resolved
 *        [period_start, period_end] is persisted in the variance row.
 *   §7 — actual_cogs is multi-vendor, sourced from invoice tables
 *        when available. Closes the audit finding that this calc
 *        previously summed only Shamrock's Excel-aggregated spend
 *        and silently ignored Sysco invoice data.
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

    const breakdown = computeActualCogsBreakdown(db, locationId, monthStart, monthEnd);
    const actualCogs = breakdown.total;

    const varianceAmount = actualCogs - theoreticalCogs;
    const variancePct =
      theoreticalCogs > 0 ? (varianceAmount / theoreticalCogs) * 100 : 0;

    db.prepare(
      `INSERT INTO accounting_variance (
         period_start, period_end,
         theoretical_cogs, actual_cogs,
         variance_amount, variance_pct, location_id,
         actual_cogs_breakdown_json
       ) VALUES (
         @period_start, @period_end,
         @theoretical_cogs, @actual_cogs,
         @variance_amount, @variance_pct, @location_id,
         @actual_cogs_breakdown_json
       )`,
    ).run({
      period_start: periodStart,
      period_end: periodEnd,
      theoretical_cogs: theoreticalCogs,
      actual_cogs: actualCogs,
      variance_amount: varianceAmount,
      variance_pct: variancePct,
      location_id: locationId,
      actual_cogs_breakdown_json: JSON.stringify(breakdown.per_vendor),
    });
  })();
}
