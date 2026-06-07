/**
 * Vetted SQL catalog for LaRi's `db_query` action.
 *
 * Every entry is a contract:
 *   - LLM picks the `name`, supplies declared `params`.
 *   - Runner (`lib/dbQueryTool.ts::runDbQuery`) binds params, forces
 *     `:location_id` from the request when `locationScoped: true`, applies
 *     `rowCap`, executes inside an audit-wrapping transaction.
 *   - SQL is a literal here — never composed from LLM input.
 *
 * # Schema-validation rule (BINDING)
 *
 * Column names in this file MUST match `lib/db.ts` exactly. The first
 * draft of this registry guessed column names from feature naming (e.g.
 * `temp_log.temp_point_id`) — the real column is `point_id`. There is no
 * runtime check that catches this drift; the SQL just fails at first call.
 * Run `tests/js/test-db-query-tool.mjs` against a real in-memory DB before
 * shipping changes here — that's the canary.
 *
 * Notable name mappings caught in review (don't repeat):
 *   - temp_log:               point_id (NOT temp_point_id), created_at (NOT recorded_at)
 *   - cooling_log:            stage1_at / stage2_at (NOT first/second_check_at)
 *   - receiving_log:          created_at (NOT received_at); status enum is accepted|rejected|accepted_with_note
 *   - prep_tasks:             task (NOT item), status enum (NOT done boolean), assigned_cook_id
 *   - kds_tickets:            order_number (NOT ticket_number), placed_at (NOT opened_at); NO station_id
 *   - sds_registry:           product_name (NOT chemical_name); pdf_path/url (NOT sds_url)
 *   - cleaning_schedule:      last_done (NOT last_done_at); NO assigned_to
 *   - cleaning_log:           completed_at (NOT performed_at), schedule_id (NOT task_id)
 *   - staff_certifications:   cook_id, cert_label, issued_on, expires_on (all `_on`, NOT `_at`)
 *   - tphc_entries:           cutoff_at (NOT max_hours); discarded_at marks closure
 *   - sales_lines:            period_label TEXT (NOT a date column); net_sales (NOT unit_price*qty)
 *   - vendor_prices_history:  pack_price + unit_price + pack_size + pack_unit (NOT a single `price`/`unit`)
 *   - recipe_costs:           recipe_id (IS the slug), batch_cost (NOT total_cost), imported_at
 *   - margin_snapshots:       item_name (NOT recipe_slug); margin_pct + quadrant pre-computed
 *   - sevenshifts_time_punches: clocked_in_at / clocked_out_at; NO hourly_wage column
 *   - accounting_variance:    theoretical_cogs / actual_cogs (NOT expected/actual_cost), variance_pct pre-computed
 *   - sales_depletion_runs:   period_label / sales_rows_processed / depletions_written / applied_at
 *   - audit_events.action:    CHECK constraint allows only ('insert','update','delete','correction','view').
 *                             Use 'view' for reads — the runner already does. 'query' would fail at insert.
 */

import type { DbQuerySpec } from './dbQueryTool.ts';

// ── Cook-tier queries ────────────────────────────────────────────────

const COOK_QUERIES: DbQuerySpec[] = [
  {
    name: 'recent_temp_log',
    tier: 'cook',
    description: 'Recent temperature readings for a temp point (or all points), last N hours.',
    locationScoped: true,
    rowCap: 40,
    params: [
      { name: 'hours', type: 'integer', required: true, min: 1, max: 168, description: 'Look-back window in hours (1–168 = 7d max).' },
      { name: 'point_id', type: 'string', required: false, maxLength: 64, description: 'Optional — filter to one point (e.g. walk_in_cooler).' },
    ],
    sql: `
      SELECT
        id, point_id, reading_f, required_min_f, required_max_f,
        corrective_action, cook_id, created_at
      FROM temp_log
      WHERE location_id = :location_id
        AND created_at >= datetime('now', '-' || :hours || ' hours')
        AND (:point_id IS NULL OR point_id = :point_id)
      ORDER BY created_at DESC
    `,
  },
  {
    name: 'cooling_in_progress',
    tier: 'cook',
    description: 'Active cooling cycles (status=in_progress) with elapsed minutes and stage readings.',
    locationScoped: true,
    rowCap: 30,
    params: [],
    sql: `
      SELECT
        id, item, station_id, started_at,
        CAST(round((julianday('now') - julianday(started_at)) * 24 * 60) AS INTEGER) AS elapsed_min,
        start_reading_f, stage1_at, stage1_reading_f, stage2_at, stage2_reading_f,
        status, breach_reason
      FROM cooling_log
      WHERE location_id = :location_id
        AND status = 'in_progress'
      ORDER BY started_at DESC
    `,
  },
  {
    name: 'recent_receiving',
    tier: 'cook',
    description: 'Items received today (or N days back) with HACCP status and rejection reason if any.',
    locationScoped: true,
    rowCap: 50,
    params: [
      { name: 'days', type: 'integer', required: false, min: 1, max: 30, description: 'Look-back window in days. Default 1 (today only).' },
    ],
    sql: `
      SELECT
        id, vendor, invoice_ref, category, item,
        reading_f, required_max_f, package_ok,
        status, rejection_reason, created_at
      FROM receiving_log
      WHERE location_id = :location_id
        AND created_at >= datetime('now', '-' || COALESCE(:days, 1) || ' days')
      ORDER BY created_at DESC
    `,
  },
  {
    name: 'open_prep_tasks',
    tier: 'cook',
    description: 'Prep tasks not yet done (status in todo, in_progress), optionally filtered by station.',
    locationScoped: true,
    rowCap: 60,
    params: [
      { name: 'station_id', type: 'string', required: false, maxLength: 64, description: 'Optional — filter to one station.' },
    ],
    sql: `
      SELECT
        id, station_id, task, qty, recipe_slug,
        assigned_cook_id, status, started_at, sort_order, created_at
      FROM prep_tasks
      WHERE location_id = :location_id
        AND status IN ('todo','in_progress')
        AND (:station_id IS NULL OR station_id = :station_id)
      ORDER BY sort_order ASC, created_at ASC
    `,
  },
  {
    name: 'kds_open_tickets',
    tier: 'cook',
    description: 'KDS tickets that have not been bumped, with elapsed minutes and line counts.',
    locationScoped: true,
    rowCap: 40,
    params: [],
    sql: `
      SELECT
        t.id, t.order_number, t.destination, t.placed_at,
        CAST(round((julianday('now') - julianday(t.placed_at)) * 24 * 60) AS INTEGER) AS elapsed_min,
        (SELECT COUNT(*) FROM kds_ticket_lines l WHERE l.ticket_id = t.id) AS line_count
      FROM kds_tickets t
      WHERE t.location_id = :location_id
        AND t.bumped_at IS NULL
      ORDER BY t.placed_at ASC
    `,
  },
  {
    name: 'sds_lookup',
    tier: 'cook',
    description: 'Find a Safety Data Sheet by product name or manufacturer. Use for spills, exposures, allergen questions about cleaning chemicals.',
    locationScoped: false,
    rowCap: 10,
    auditOmitValues: ['search'],
    params: [
      { name: 'search', type: 'string', required: true, maxLength: 80, description: 'Product or manufacturer name (partial match).' },
    ],
    sql: `
      SELECT
        id, product_name, manufacturer, hazard_class,
        storage_location, pdf_path, url, last_reviewed, notes
      FROM sds_registry
      WHERE active = 1
        AND (product_name LIKE '%' || :search || '%'
             OR manufacturer LIKE '%' || :search || '%')
      ORDER BY product_name ASC
    `,
  },
  {
    name: 'cleaning_due_today',
    tier: 'cook',
    description: 'Active cleaning tasks due today or overdue.',
    locationScoped: true,
    rowCap: 40,
    params: [],
    sql: `
      SELECT
        s.id, s.area, s.task, s.frequency, s.last_done, s.next_due,
        s.notes
      FROM cleaning_schedule s
      WHERE s.location_id = :location_id
        AND s.active = 1
        AND (s.next_due IS NULL OR date(s.next_due) <= date('now'))
      ORDER BY s.next_due ASC NULLS FIRST
    `,
  },
  {
    name: 'staff_certifications_expiring',
    tier: 'cook',
    description: 'Active staff certifications (food-handler, allergen, TIPS, CFPM) expiring in N days. Default 30.',
    locationScoped: true,
    rowCap: 30,
    params: [
      { name: 'days', type: 'integer', required: false, min: 1, max: 180, description: 'Look-ahead window in days. Default 30.' },
    ],
    sql: `
      SELECT
        id, cook_id, cert_type, cert_label, issuer, cert_number,
        issued_on, expires_on,
        CAST(round(julianday(expires_on) - julianday('now')) AS INTEGER) AS days_until_expiry
      FROM staff_certifications
      WHERE location_id = :location_id
        AND active = 1
        AND expires_on IS NOT NULL
        AND julianday(expires_on) <= julianday('now', '+' || COALESCE(:days, 30) || ' days')
      ORDER BY expires_on ASC
    `,
  },
  {
    name: 'inventory_for_item',
    tier: 'cook',
    description: 'Recent inventory_updates for one ingredient (partial-name match), newest first.',
    locationScoped: true,
    rowCap: 20,
    auditOmitValues: ['item'],
    params: [
      { name: 'item', type: 'string', required: true, maxLength: 100, description: 'Ingredient name (partial match).' },
    ],
    sql: `
      SELECT
        id, item, direction, delta, station_id, note, created_at, cook_id
      FROM inventory_updates
      WHERE location_id = :location_id
        AND item LIKE '%' || :item || '%'
      ORDER BY created_at DESC
    `,
  },
  {
    name: 'equipment_lookup',
    tier: 'cook',
    description: 'Look up kitchen equipment by name, category, or make/model to get model number, serial number, status, vendor, and warranty expiration.',
    locationScoped: true,
    rowCap: 25,
    auditOmitValues: ['search'],
    params: [
      { name: 'search', type: 'string', required: true, maxLength: 100, description: 'Equipment name, category, make, or model (partial match), e.g. "ice machine", "fryer", "Hoshizaki".' },
    ],
    sql: `
      SELECT
        name, category, make_model, model_number, serial_number,
        status, vendor, warranty_expiration
      FROM equipment
      WHERE location_id = :location_id
        AND (
          lower(name) LIKE '%' || lower(:search) || '%'
          OR lower(category) LIKE '%' || lower(:search) || '%'
          OR lower(make_model) LIKE '%' || lower(:search) || '%'
        )
      ORDER BY name ASC
    `,
  },
  {
    name: 'tphc_active',
    tier: 'cook',
    description: 'Time-as-Public-Health-Control items currently on the clock with remaining time to cutoff.',
    locationScoped: true,
    rowCap: 30,
    params: [],
    sql: `
      SELECT
        id, item, batch_ref, station_id, started_at, cutoff_at,
        CAST(round((julianday('now') - julianday(started_at)) * 24 * 60) AS INTEGER) AS elapsed_min,
        CAST(round((julianday(cutoff_at) - julianday('now')) * 24 * 60) AS INTEGER) AS remaining_min,
        cook_id
      FROM tphc_entries
      WHERE location_id = :location_id
        AND discarded_at IS NULL
      ORDER BY cutoff_at ASC
    `,
  },
  {
    name: 'date_marks_expiring',
    tier: 'cook',
    description: 'Date-marked items approaching or past their discard date (default look-ahead 2 days).',
    locationScoped: true,
    rowCap: 40,
    params: [
      { name: 'days', type: 'integer', required: false, min: 0, max: 14, description: 'Days ahead to look (0 = only today/overdue). Default 2.' },
    ],
    sql: `
      SELECT
        id, item, batch_ref, prepared_on, discard_on,
        CAST(julianday(discard_on) - julianday('now') AS INTEGER) AS days_until_discard,
        cook_id
      FROM date_marks
      WHERE location_id = :location_id
        AND discarded_at IS NULL
        AND julianday(discard_on) <= julianday('now', '+' || COALESCE(:days, 2) || ' days')
      ORDER BY discard_on ASC
    `,
  },
  {
    name: 'sanitizer_recent',
    tier: 'cook',
    description: 'Recent sanitizer concentration checks across all points, last N hours.',
    locationScoped: true,
    rowCap: 30,
    params: [
      { name: 'hours', type: 'integer', required: false, min: 1, max: 72, description: 'Look-back in hours. Default 12.' },
    ],
    sql: `
      SELECT
        id, station_id, point_label, chemistry, concentration_ppm,
        required_min_ppm, required_max_ppm, status, corrective_action,
        cook_id, created_at
      FROM sanitizer_checks
      WHERE location_id = :location_id
        AND created_at >= datetime('now', '-' || COALESCE(:hours, 12) || ' hours')
      ORDER BY created_at DESC
    `,
  },
  {
    name: 'beo_prep_status',
    tier: 'cook',
    description: 'Prep tasks for a BEO event with completion status (done=0/1). Joins beo_prep_tasks + beo_events.',
    locationScoped: true,
    rowCap: 60,
    params: [
      { name: 'event_id', type: 'integer', required: true, min: 1, description: 'BEO event ID.' },
    ],
    sql: `
      SELECT
        t.id, t.task, t.due_date, t.done, t.sort_order,
        e.title AS event_title, e.event_date, e.event_time, e.guest_count, e.status AS event_status
      FROM beo_prep_tasks t
      JOIN beo_events e ON e.id = t.event_id AND e.location_id = :location_id
      WHERE t.location_id = :location_id
        AND t.event_id = :event_id
      ORDER BY t.sort_order ASC, t.id ASC
    `,
  },
];

// ── Manager-tier queries (PIN required) ──────────────────────────────

const MANAGER_QUERIES: DbQuerySpec[] = [
  {
    name: 'sales_by_dish',
    tier: 'manager',
    description: 'Quantity sold + net sales per dish, optionally filtered by period_label.',
    locationScoped: true,
    rowCap: 50,
    params: [
      { name: 'period_label', type: 'string', required: false, maxLength: 60, description: 'Optional — exact period_label match (e.g. "2026-05-15", "Week 19"). Omit for all periods.' },
    ],
    sql: `
      SELECT
        item_name,
        SUM(quantity_sold) AS qty,
        ROUND(SUM(net_sales), 2) AS net_sales
      FROM sales_lines
      WHERE location_id = :location_id
        AND (:period_label IS NULL OR period_label = :period_label)
      GROUP BY item_name
      ORDER BY net_sales DESC
    `,
  },
  {
    name: 'sales_by_period',
    tier: 'manager',
    description: 'Total net sales and item count grouped by period_label, newest first.',
    locationScoped: true,
    rowCap: 30,
    params: [],
    sql: `
      SELECT
        period_label,
        ROUND(SUM(net_sales), 2) AS net_sales,
        SUM(quantity_sold) AS items_sold,
        COUNT(DISTINCT item_name) AS distinct_items,
        MAX(imported_at) AS last_imported_at
      FROM sales_lines
      WHERE location_id = :location_id
      GROUP BY period_label
      ORDER BY period_label DESC
    `,
  },
  {
    name: 'vendor_price_history',
    tier: 'manager',
    description: 'Price-change timeline for one ingredient, optionally filtered by vendor.',
    locationScoped: false,
    rowCap: 60,
    auditOmitValues: ['ingredient'],
    params: [
      { name: 'ingredient', type: 'string', required: true, maxLength: 100, description: 'Ingredient/item name (partial match).' },
      { name: 'vendor', type: 'string', required: false, maxLength: 40, description: 'Optional vendor filter (sysco, shamrock, etc.).' },
    ],
    sql: `
      SELECT
        snapshot_at, vendor, ingredient, sku,
        pack_size, pack_unit, pack_price, unit_price,
        category, snapshot_reason, run_id
      FROM vendor_prices_history
      WHERE ingredient LIKE '%' || :ingredient || '%'
        AND (:vendor IS NULL OR LOWER(vendor) = LOWER(:vendor))
      ORDER BY snapshot_at DESC
    `,
  },
  {
    name: 'vendor_price_shocks',
    tier: 'manager',
    description: 'Recent price changes above a percent threshold over the last N days (page-compatible vendor SKU rows).',
    locationScoped: true,
    rowCap: 40,
    params: [
      { name: 'days', type: 'integer', required: false, min: 1, max: 90, description: 'Look-back window in days. Default 14.' },
      { name: 'threshold_pct', type: 'number', required: false, min: 1, max: 500, description: 'Percent change threshold. Default 10.' },
    ],
    sql: `
      WITH points AS (
        SELECT
          vendor, sku, ingredient, category, pack_unit, unit_price,
          snapshot_at AS point_at,
          0 AS source_order,
          id AS row_order
        FROM vendor_prices_history
        WHERE location_id = :location_id
          AND snapshot_at >= datetime('now', '-' || COALESCE(:days, 14) || ' days')
          AND vendor IS NOT NULL
          AND sku IS NOT NULL
          AND unit_price IS NOT NULL
        UNION ALL
        SELECT
          vendor, sku, ingredient, category, pack_unit, unit_price,
          COALESCE(imported_at, datetime('now')) AS point_at,
          1 AS source_order,
          id AS row_order
        FROM vendor_prices
        WHERE location_id = :location_id
          AND COALESCE(imported_at, datetime('now')) >= datetime('now', '-' || COALESCE(:days, 14) || ' days')
          AND vendor IS NOT NULL
          AND sku IS NOT NULL
          AND unit_price IS NOT NULL
      ),
      ranked AS (
        SELECT
          vendor, sku, ingredient, category, pack_unit, unit_price, point_at,
          COUNT(*) OVER (PARTITION BY vendor, sku, ingredient) AS point_count,
          FIRST_VALUE(unit_price) OVER (
            PARTITION BY vendor, sku, ingredient
            ORDER BY point_at ASC, source_order ASC, row_order ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
          ) AS baseline_unit_price,
          FIRST_VALUE(point_at) OVER (
            PARTITION BY vendor, sku, ingredient
            ORDER BY point_at ASC, source_order ASC, row_order ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
          ) AS baseline_at,
          FIRST_VALUE(unit_price) OVER (
            PARTITION BY vendor, sku, ingredient
            ORDER BY point_at DESC, source_order DESC, row_order DESC
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
          ) AS latest_unit_price,
          FIRST_VALUE(point_at) OVER (
            PARTITION BY vendor, sku, ingredient
            ORDER BY point_at DESC, source_order DESC, row_order DESC
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
          ) AS latest_at,
          ROW_NUMBER() OVER (
            PARTITION BY vendor, sku, ingredient
            ORDER BY point_at DESC, source_order DESC, row_order DESC
          ) AS rn
        FROM points
      )
      SELECT
        vendor, sku, ingredient, category, pack_unit,
        baseline_unit_price, baseline_at,
        latest_unit_price, latest_at,
        ROUND(((latest_unit_price - baseline_unit_price) / NULLIF(baseline_unit_price, 0)) * 100, 1) AS delta_pct,
        CASE WHEN latest_unit_price >= baseline_unit_price THEN 'up' ELSE 'down' END AS direction
      FROM ranked
      WHERE rn = 1
        AND point_count >= 2
        AND baseline_unit_price > 0
        AND ABS((latest_unit_price - baseline_unit_price) / baseline_unit_price) * 100 >= COALESCE(:threshold_pct, 10)
      ORDER BY ABS(delta_pct) DESC, ingredient ASC, vendor ASC, sku ASC
    `,
  },
  {
    name: 'recipe_cost_history',
    tier: 'manager',
    description: 'Recipe-cost snapshots for one recipe (by recipe_id slug). recipe_costs is UNIQUE(location, recipe_id) so this returns at most one row per location — useful for the current cost.',
    locationScoped: true,
    rowCap: 5,
    auditOmitValues: ['recipe_id'],
    params: [
      { name: 'recipe_id', type: 'string', required: true, maxLength: 80, description: 'Recipe slug (exact match on recipe_costs.recipe_id).' },
    ],
    sql: `
      SELECT
        recipe_id, recipe_name, category,
        yield, yield_unit, batch_cost, cost_per_yield_unit,
        costed_lines, total_lines, interpretations, imported_at
      FROM recipe_costs
      WHERE location_id = :location_id
        AND recipe_id = :recipe_id
      ORDER BY imported_at DESC
    `,
  },
  {
    name: 'margin_by_dish',
    tier: 'manager',
    description: 'Latest margin snapshot per dish (net_sales vs. cost_per_unit), sorted by margin %.',
    locationScoped: true,
    rowCap: 60,
    params: [],
    sql: `
      SELECT
        item_name, net_sales, cost_per_unit,
        margin_pct, popularity, quadrant, snapshot_at
      FROM margin_snapshots
      WHERE location_id = :location_id
        AND snapshot_at = (
          SELECT MAX(snapshot_at) FROM margin_snapshots WHERE location_id = :location_id
        )
      ORDER BY margin_pct DESC
    `,
  },
  {
    name: 'labor_hours_by_role',
    tier: 'manager',
    description: '7shifts time-punch totals grouped by role_id, last N days.',
    locationScoped: true,
    rowCap: 30,
    params: [
      { name: 'days', type: 'integer', required: false, min: 1, max: 60, description: 'Look-back window. Default 14.' },
    ],
    sql: `
      SELECT
        role_id,
        ROUND(SUM(hours_worked), 2) AS hours,
        COUNT(*) AS punch_count,
        SUM(CASE WHEN approved = 1 THEN 1 ELSE 0 END) AS approved_count
      FROM sevenshifts_time_punches
      WHERE location_id = :location_id
        AND clocked_in_at >= datetime('now', '-' || COALESCE(:days, 14) || ' days')
        AND clocked_out_at IS NOT NULL
      GROUP BY role_id
      ORDER BY hours DESC
    `,
  },
  {
    name: 'audit_log_recent',
    tier: 'manager',
    description: 'Recent audit_events activity. Filter by entity/action/source for narrow scans.',
    locationScoped: true,
    rowCap: 50,
    params: [
      { name: 'hours', type: 'integer', required: false, min: 1, max: 168, description: 'Look-back in hours. Default 24.' },
      { name: 'entity', type: 'string', required: false, maxLength: 40, description: 'Filter by entity (e.g. temp_log, eighty_six, db_query).' },
      { name: 'actor_source', type: 'string', required: false, maxLength: 40, description: 'Filter by source (kitchen_assistant, cook_ui, pic_ui).' },
    ],
    sql: `
      SELECT
        id, created_at, entity, entity_id, action,
        actor_cook_id, actor_source, payload_json, note
      FROM audit_events
      WHERE location_id = :location_id
        AND created_at >= datetime('now', '-' || COALESCE(:hours, 24) || ' hours')
        AND (:entity IS NULL OR entity = :entity)
        AND (:actor_source IS NULL OR actor_source = :actor_source)
      ORDER BY created_at DESC
    `,
  },
  {
    name: 'accounting_variance_recent',
    tier: 'manager',
    description: 'Recent food-cost variance snapshots (theoretical_cogs vs. actual_cogs).',
    locationScoped: true,
    rowCap: 30,
    params: [
      { name: 'days', type: 'integer', required: false, min: 7, max: 365, description: 'Look-back in days. Default 90.' },
    ],
    sql: `
      SELECT
        period_start, period_end, theoretical_cogs, actual_cogs,
        variance_amount, variance_pct, snapshot_at
      FROM accounting_variance
      WHERE location_id = :location_id
        AND date(period_end) >= date('now', '-' || COALESCE(:days, 90) || ' days')
      ORDER BY period_end DESC
    `,
  },
  {
    name: 'beo_revenue_by_month',
    tier: 'manager',
    description: 'Catering revenue rollup by month from BEO line items (unit_cost × quantity).',
    locationScoped: true,
    rowCap: 24,
    params: [],
    sql: `
      SELECT
        substr(e.event_date, 1, 7) AS month,
        COUNT(DISTINCT e.id) AS event_count,
        SUM(e.guest_count) AS total_guests,
        ROUND(SUM(COALESCE(li.unit_cost * li.quantity, 0)), 2) AS revenue
      FROM beo_events e
      LEFT JOIN beo_line_items li ON li.event_id = e.id
      WHERE e.location_id = :location_id
        AND e.event_date IS NOT NULL
      GROUP BY month
      ORDER BY month DESC
    `,
  },
  {
    name: 'sales_depletion_recent',
    tier: 'manager',
    description: 'Recent Phase-3 sales-depletion runs (Toast → BOM ingredient debits) with unresolved-dish counts.',
    locationScoped: true,
    rowCap: 20,
    params: [],
    sql: `
      SELECT
        id, period_label, shift_date,
        sales_rows_processed, depletions_written, unresolved_dish_count,
        applied_at
      FROM sales_depletion_runs
      WHERE location_id = :location_id
      ORDER BY applied_at DESC
    `,
  },
  {
    name: 'ingest_runs_recent',
    tier: 'manager',
    description: 'Recent ingest-pipeline runs and their status (costing, analytics, toast, sevenshifts, prism, unified).',
    locationScoped: false,
    rowCap: 20,
    params: [
      { name: 'kind', type: 'string', required: false, maxLength: 40, description: 'Optional kind filter.' },
    ],
    sql: `
      SELECT
        id, kind, status, started_at, finished_at,
        rows_in, rows_out,
        CAST(round((julianday(COALESCE(finished_at, 'now')) - julianday(started_at)) * 24 * 60 * 60) AS INTEGER) AS duration_sec
      FROM ingest_runs
      WHERE (:kind IS NULL OR kind = :kind)
      ORDER BY started_at DESC
    `,
  },
  {
    name: 'recipe_with_bom',
    tier: 'manager',
    description: 'Full recipe with BOM lines: ingredient, vendor, pack price, unit cost, qty.',
    locationScoped: true,
    rowCap: 100,
    params: [
      { name: 'recipe_id', type: 'string', required: true, maxLength: 128, description: 'Recipe slug (e.g. chicken-parm).' },
    ],
    sql: `
      SELECT
        rc.recipe_id, rc.recipe_name, rc.category, rc.batch_cost,
        rc.yield, rc.yield_unit, rc.cost_per_yield_unit,
        b.ingredient, b.qty, b.unit, b.vendor,
        b.pack_price, b.pack_size, b.vendor_ingredient, b.map_status,
        vp.unit_price, vp.pack_unit
      FROM recipe_costs rc
      JOIN bom_lines b
        ON b.recipe_id = rc.recipe_id AND b.location_id = rc.location_id
      LEFT JOIN vendor_prices vp
        ON vp.ingredient = b.vendor_ingredient
        AND vp.vendor = b.vendor
        AND vp.location_id = rc.location_id
      WHERE rc.recipe_id = :recipe_id
        AND rc.location_id = :location_id
      ORDER BY b.id ASC
    `,
  },
  {
    name: 'sales_depletion_unresolved',
    tier: 'manager',
    description: 'Menu items sold but not linked to any recipe via dish_components. Useful for finding gaps in BOM coverage.',
    locationScoped: true,
    rowCap: 60,
    params: [
      { name: 'period_label', type: 'string', required: false, maxLength: 60, description: 'Optional — exact period_label match (e.g. "2026-05-15"). Omit for all periods.' },
    ],
    sql: `
      SELECT
        sl.item_name, sl.period_label,
        SUM(sl.quantity_sold) AS qty_sold,
        ROUND(SUM(sl.net_sales), 2) AS net_sales
      FROM sales_lines sl
      LEFT JOIN dish_components dc
        ON dc.dish_name = sl.item_name AND dc.location_id = sl.location_id
      WHERE sl.location_id = :location_id
        AND dc.id IS NULL
        AND (:period_label IS NULL OR sl.period_label = :period_label)
      GROUP BY sl.item_name, sl.period_label
      ORDER BY net_sales DESC, sl.item_name ASC, sl.period_label DESC
    `,
  },
  {
    name: 'equipment_maintenance_due',
    tier: 'manager',
    description: 'Equipment with scheduled maintenance due within N days (default 7). Joins equipment + equipment_maintenance_schedule.',
    locationScoped: true,
    rowCap: 40,
    params: [
      { name: 'lookahead_days', type: 'integer', required: false, min: 1, max: 365, description: 'Days ahead to look for due maintenance. Default 7.' },
    ],
    sql: `
      SELECT
        eq.id AS equipment_id, eq.name, eq.category, eq.make_model,
        ms.id AS schedule_id, ms.task, ms.frequency,
        ms.last_done, ms.next_due, ms.notes,
        CAST(round(julianday(ms.next_due) - julianday('now')) AS INTEGER) AS days_until_due
      FROM equipment eq
      JOIN equipment_maintenance_schedule ms ON ms.equipment_id = eq.id
      WHERE eq.location_id = :location_id
        AND eq.status = 'active'
        AND (ms.next_due IS NULL OR date(ms.next_due) <= date('now', '+' || COALESCE(:lookahead_days, 7) || ' days'))
      ORDER BY ms.next_due ASC NULLS FIRST
    `,
  },
];

export const DB_QUERIES: DbQuerySpec[] = [...COOK_QUERIES, ...MANAGER_QUERIES];
