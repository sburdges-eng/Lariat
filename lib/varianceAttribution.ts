// Variance attribution (roadmap 3.2): "the variance moved — what did we change?"
//
// Read-only evidence gatherer. Given two accounting_variance periods
// (default: the two most recent for the location), it collects the
// operational changes that happened inside the window between them:
//
//   - price_moves            vendor unit prices that moved (first → last
//                            snapshot inside the window, own SQL over
//                            vendor_prices_history — listPriceShocks is
//                            now-relative so it can't serve arbitrary windows)
//   - composition_changes    dish_components rows created/updated in-window
//   - count_corrections      inventory-count lifecycle audit rows
//                            (entity 'inventory_counts' close/reopen
//                            transitions, 'inventory_count_lines' edits)
//                            plus counts closed in-window
//   - unresolved_depletions  sales lines with no dish_components link
//                            (the `sales_depletion_unresolved` shape),
//                            windowed on date-like period_labels
//
// The sections are evidence, not a reconciliation — they need not sum to
// the variance delta. That caveat is part of the payload.

import { getDb } from './db.ts';
import { normalizeDishName } from './dishCostBridge.ts';

export type ThresholdColor = 'green' | 'yellow' | 'red';

export interface VariancePeriod {
  period_start: string | null;
  period_end: string;
  theoretical_cogs: number | null;
  actual_cogs: number | null;
  variance_amount: number | null;
  variance_pct: number | null;
  threshold_color: ThresholdColor;
}

export interface PriceMoveItem {
  vendor: string;
  sku: string;
  ingredient: string;
  first_price: number | null;
  last_price: number | null;
  pct_move: number | null;
  first_at: string;
  last_at: string;
  snapshots: number;
  linked_to_menu: boolean;
}

export interface CompositionChangeItem {
  dish_name: string;
  component: string;
  component_type: string;
  change_kind: 'created' | 'updated';
  changed_at: string;
}

export interface CountCorrectionItem {
  kind: 'audit' | 'count_closed';
  // kind === 'audit'
  entity: string | null;
  entity_id: number | null;
  action: string | null;
  transition: string | null;
  actor_cook_id: string | null;
  // kind === 'count_closed'
  count_id: number | null;
  label: string | null;
  count_date: string | null;
  lines: number | null;
  // both
  at: string;
}

export interface UnresolvedDepletionItem {
  item_name: string;
  period_label: string | null;
  qty_sold: number | null;
  net_sales: number | null;
}

export interface AttributionSection<T> {
  count: number;
  items: T[];
}

export interface UnresolvedDepletionSection
  extends AttributionSection<UnresolvedDepletionItem> {
  note: string | null;
}

export interface VarianceAttribution {
  ok: boolean;
  reason: string | null;
  location_id: string;
  window: { from: string | null; to: string | null };
  variance: {
    baseline: VariancePeriod | null;
    current: VariancePeriod | null;
    delta_amount: number | null;
    delta_pct: number | null;
  };
  price_moves: AttributionSection<PriceMoveItem>;
  composition_changes: AttributionSection<CompositionChangeItem>;
  count_corrections: AttributionSection<CountCorrectionItem>;
  unresolved_depletions: UnresolvedDepletionSection;
  unattributed: boolean;
  caveat: string;
}

// Same buckets as the T9 dashboard / varianceTrend tile (< 2 / 2–5 / >= 5).
export function thresholdColorFor(pct: number | null): ThresholdColor {
  if (pct === null) return 'green';
  const abs = Math.abs(pct);
  if (abs >= 5) return 'red';
  if (abs >= 2) return 'yellow';
  return 'green';
}

const CAVEAT =
  'Attribution is directional: these sections are evidence of what changed ' +
  'inside the window, not a reconciliation — they need not sum to the variance delta.';

const SECTION_LIMIT = 60;

const DATE_LABEL_GLOB = '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';

interface VarianceRow {
  period_start: string | null;
  period_end: string;
  theoretical_cogs: number | null;
  actual_cogs: number | null;
  variance_amount: number | null;
  variance_pct: number | null;
}

function toPeriod(row: VarianceRow): VariancePeriod {
  return {
    period_start: row.period_start,
    period_end: row.period_end,
    theoretical_cogs: row.theoretical_cogs,
    actual_cogs: row.actual_cogs,
    variance_amount: row.variance_amount,
    variance_pct: row.variance_pct,
    threshold_color: thresholdColorFor(row.variance_pct),
  };
}

function emptyPayload(locationId: string, reason: string): VarianceAttribution {
  return {
    ok: false,
    reason,
    location_id: locationId,
    window: { from: null, to: null },
    variance: { baseline: null, current: null, delta_amount: null, delta_pct: null },
    price_moves: { count: 0, items: [] },
    composition_changes: { count: 0, items: [] },
    count_corrections: { count: 0, items: [] },
    unresolved_depletions: { count: 0, items: [], note: null },
    unattributed: true,
    caveat: CAVEAT,
  };
}

/** Most recent variance period_ends for the location — page period-picker fodder. */
export function listRecentVariancePeriods(
  locationId: string,
  limit: number = 7,
): { period_start: string | null; period_end: string }[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT period_start, period_end FROM accounting_variance
        WHERE location_id = ? AND period_end IS NOT NULL
        ORDER BY period_end DESC, id DESC
        LIMIT ?`,
    )
    .all(locationId, Math.max(1, Math.floor(limit))) as {
    period_start: string | null;
    period_end: string;
  }[];
  return rows;
}

function variancePeriodByEnd(
  locationId: string,
  periodEnd: string,
): VarianceRow | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT period_start, period_end, theoretical_cogs, actual_cogs,
              variance_amount, variance_pct
         FROM accounting_variance
        WHERE location_id = ? AND period_end = ?
        ORDER BY id DESC
        LIMIT 1`,
    )
    .get(locationId, periodEnd) as VarianceRow | undefined;
}

function priceMoves(locationId: string, from: string, to: string): PriceMoveItem[] {
  const db = getDb();
  const snaps = db
    .prepare(
      `SELECT vendor, sku, ingredient, unit_price, snapshot_at
         FROM vendor_prices_history
        WHERE location_id = ?
          AND date(snapshot_at) > ? AND date(snapshot_at) <= ?
        ORDER BY snapshot_at ASC, rowid ASC`,
    )
    .all(locationId, from, to) as {
    vendor: string;
    sku: string;
    ingredient: string;
    unit_price: number | null;
    snapshot_at: string;
  }[];

  // Ingredients that appear in dish_components as vendor_items: a price
  // move on these is directly linked to a menu dish.
  const linked = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT vendor_ingredient FROM dish_components
            WHERE location_id = ? AND component_type = 'vendor_item'
              AND vendor_ingredient IS NOT NULL`,
        )
        .all(locationId) as { vendor_ingredient: string }[]
    ).map((r) => r.vendor_ingredient),
  );

  const groups = new Map<string, typeof snaps>();
  for (const s of snaps) {
    const key = `${s.vendor}|${s.sku}|${s.ingredient}`;
    const arr = groups.get(key);
    if (arr) arr.push(s);
    else groups.set(key, [s]);
  }

  const moves: PriceMoveItem[] = [];
  for (const arr of groups.values()) {
    const first = arr[0];
    const last = arr[arr.length - 1];
    if (!first || !last || arr.length < 2) continue;
    if (first.unit_price === last.unit_price) continue; // no move
    const pct =
      first.unit_price != null && last.unit_price != null && first.unit_price !== 0
        ? ((last.unit_price - first.unit_price) / first.unit_price) * 100
        : null;
    moves.push({
      vendor: first.vendor,
      sku: first.sku,
      ingredient: first.ingredient,
      first_price: first.unit_price,
      last_price: last.unit_price,
      pct_move: pct === null ? null : Math.round(pct * 10) / 10,
      first_at: first.snapshot_at,
      last_at: last.snapshot_at,
      snapshots: arr.length,
      linked_to_menu: linked.has(first.ingredient),
    });
  }
  moves.sort(
    (a, b) => Math.abs(b.pct_move ?? 0) - Math.abs(a.pct_move ?? 0),
  );
  return moves.slice(0, SECTION_LIMIT);
}

function compositionChanges(
  locationId: string,
  from: string,
  to: string,
): CompositionChangeItem[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT dish_name, component_type, recipe_slug, vendor_ingredient,
              qty_per_serving, unit, created_at, updated_at
         FROM dish_components
        WHERE location_id = ?
          AND (
            (created_at IS NOT NULL AND date(created_at) > ? AND date(created_at) <= ?)
            OR (updated_at IS NOT NULL AND date(updated_at) > ? AND date(updated_at) <= ?)
          )
        ORDER BY COALESCE(updated_at, created_at) DESC
        LIMIT ?`,
    )
    .all(locationId, from, to, from, to, SECTION_LIMIT) as {
    dish_name: string;
    component_type: string;
    recipe_slug: string | null;
    vendor_ingredient: string | null;
    qty_per_serving: number | null;
    unit: string | null;
    created_at: string | null;
    updated_at: string | null;
  }[];

  return rows.map((r) => {
    const createdInWindow =
      r.created_at != null &&
      r.created_at.slice(0, 10) > from &&
      r.created_at.slice(0, 10) <= to;
    const target = r.component_type === 'recipe' ? r.recipe_slug : r.vendor_ingredient;
    const qty =
      r.qty_per_serving != null ? ` × ${r.qty_per_serving} ${r.unit ?? ''}`.trimEnd() : '';
    return {
      dish_name: r.dish_name,
      component: `${target ?? '(unknown)'}${qty}`,
      component_type: r.component_type,
      change_kind: createdInWindow ? 'created' : 'updated',
      changed_at: (createdInWindow ? r.created_at : r.updated_at ?? r.created_at) ?? '',
    } satisfies CompositionChangeItem;
  });
}

function countCorrections(
  locationId: string,
  from: string,
  to: string,
): CountCorrectionItem[] {
  const db = getDb();

  // Lifecycle + correction audit rows. Close/reopen are written by
  // PATCH /api/inventory/counts/[id] as entity 'inventory_counts',
  // action 'update' with payload {transition: 'close'|'reopen'}; line
  // edits land as entity 'inventory_count_lines', action 'update'
  // (the audit_events CHECK constraint has no bespoke verbs).
  const audits = db
    .prepare(
      `SELECT entity, entity_id, action, actor_cook_id, payload_json, created_at
         FROM audit_events
        WHERE location_id = ?
          AND entity IN ('inventory_counts', 'inventory_count_lines')
          AND action IN ('update', 'correction', 'delete')
          AND date(created_at) > ? AND date(created_at) <= ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(locationId, from, to, SECTION_LIMIT) as {
    entity: string;
    entity_id: number | null;
    action: string;
    actor_cook_id: string | null;
    payload_json: string | null;
    created_at: string;
  }[];

  const auditItems: CountCorrectionItem[] = audits.map((a) => {
    let transition: string | null = null;
    if (a.payload_json) {
      try {
        const payload = JSON.parse(a.payload_json) as Record<string, unknown>;
        if (typeof payload.transition === 'string') transition = payload.transition;
      } catch {
        /* malformed payload — leave transition null */
      }
    }
    return {
      kind: 'audit',
      entity: a.entity,
      entity_id: a.entity_id,
      action: a.action,
      transition,
      actor_cook_id: a.actor_cook_id,
      count_id: null,
      label: null,
      count_date: null,
      lines: null,
      at: a.created_at,
    };
  });

  const closed = db
    .prepare(
      `SELECT c.id, c.label, c.count_date, c.closed_at,
              (SELECT COUNT(*) FROM inventory_count_lines l
                WHERE l.count_id = c.id AND l.location_id = c.location_id) AS lines
         FROM inventory_counts c
        WHERE c.location_id = ?
          AND c.closed_at IS NOT NULL
          AND date(c.closed_at) > ? AND date(c.closed_at) <= ?
        ORDER BY c.closed_at DESC
        LIMIT ?`,
    )
    .all(locationId, from, to, SECTION_LIMIT) as {
    id: number;
    label: string | null;
    count_date: string | null;
    closed_at: string;
    lines: number;
  }[];

  const closedItems: CountCorrectionItem[] = closed.map((c) => ({
    kind: 'count_closed',
    entity: null,
    entity_id: null,
    action: null,
    transition: null,
    actor_cook_id: null,
    count_id: c.id,
    label: c.label,
    count_date: c.count_date,
    lines: c.lines,
    at: c.closed_at,
  }));

  return [...closedItems, ...auditItems].slice(0, SECTION_LIMIT);
}

function unresolvedDepletions(
  locationId: string,
  from: string,
  to: string,
): UnresolvedDepletionSection {
  const db = getDb();

  // Register normalization so the JOIN matches the canonical dish_name storage.
  db.function('normalize_dish_name', { deterministic: true }, (s: unknown) =>
    normalizeDishName(s as string | null | undefined),
  );

  // period_label is date-like ('2026-05-15') for Toast-daily ingests but
  // free-text for some legacy ingests. Only window when this location
  // actually has date-like labels — otherwise fall back to all-time and
  // say so rather than silently returning nothing.
  const dateLike = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM sales_lines
          WHERE location_id = ? AND period_label GLOB '${DATE_LABEL_GLOB}'`,
      )
      .get(locationId) as { n: number }
  ).n;
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM sales_lines WHERE location_id = ?`)
      .get(locationId) as { n: number }
  ).n;

  const windowed = dateLike > 0 || total === 0;

  // Same shape as the registered `sales_depletion_unresolved` db_query.
  const sql = `
    SELECT sl.item_name, sl.period_label,
           SUM(sl.quantity_sold) AS qty_sold,
           ROUND(SUM(sl.net_sales), 2) AS net_sales
      FROM sales_lines sl
      LEFT JOIN dish_components dc
        ON normalize_dish_name(dc.dish_name) = normalize_dish_name(sl.item_name) AND dc.location_id = sl.location_id
     WHERE sl.location_id = ?
       AND dc.id IS NULL
       ${windowed ? `AND sl.period_label GLOB '${DATE_LABEL_GLOB}' AND sl.period_label > ? AND sl.period_label <= ?` : ''}
     GROUP BY sl.item_name, sl.period_label
     ORDER BY net_sales DESC, sl.item_name ASC
     LIMIT ${SECTION_LIMIT}`;

  const items = (
    windowed
      ? db.prepare(sql).all(locationId, from, to)
      : db.prepare(sql).all(locationId)
  ) as UnresolvedDepletionItem[];

  return {
    count: items.length,
    items,
    note: windowed
      ? null
      : 'period_label values for this location are not date-like; showing all-time unresolved depletions instead of the window.',
  };
}

/**
 * Build the variance-attribution payload for a location.
 *
 * Default window: the two most recent accounting_variance periods —
 * baseline = previous, current = latest; window = (baseline.period_end,
 * current.period_end]. Explicit `from`/`to` (both YYYY-MM-DD period_end
 * values) override; if either has no matching variance row the payload
 * comes back `ok: false` with a reason rather than throwing.
 */
export function buildVarianceAttribution(
  locationId: string,
  opts: { from?: string; to?: string } = {},
): VarianceAttribution {
  const hasFrom = typeof opts.from === 'string' && opts.from.length > 0;
  const hasTo = typeof opts.to === 'string' && opts.to.length > 0;

  let baselineRow: VarianceRow | undefined;
  let currentRow: VarianceRow | undefined;

  if (hasFrom || hasTo) {
    if (!hasFrom || !hasTo) {
      return emptyPayload(locationId, 'both from and to are required to pick an explicit window');
    }
    const from = String(opts.from);
    const to = String(opts.to);
    if (from >= to) {
      return emptyPayload(locationId, 'from must be an earlier period_end than to');
    }
    baselineRow = variancePeriodByEnd(locationId, from);
    if (!baselineRow) {
      return emptyPayload(locationId, `no variance period found with period_end ${from}`);
    }
    currentRow = variancePeriodByEnd(locationId, to);
    if (!currentRow) {
      return emptyPayload(locationId, `no variance period found with period_end ${to}`);
    }
  } else {
    const recent = listRecentVariancePeriods(locationId, 2);
    if (recent.length < 2) {
      return emptyPayload(
        locationId,
        'need at least two variance periods for this location to attribute a move',
      );
    }
    const latest = recent[0];
    const previous = recent[1];
    if (!latest || !previous) {
      return emptyPayload(locationId, 'need at least two variance periods for this location to attribute a move');
    }
    currentRow = variancePeriodByEnd(locationId, latest.period_end);
    baselineRow = variancePeriodByEnd(locationId, previous.period_end);
    if (!currentRow || !baselineRow) {
      return emptyPayload(locationId, 'variance periods disappeared mid-read');
    }
  }

  const from = baselineRow.period_end;
  const to = currentRow.period_end;

  const baseline = toPeriod(baselineRow);
  const current = toPeriod(currentRow);
  const deltaAmount =
    baseline.variance_amount != null && current.variance_amount != null
      ? Math.round((current.variance_amount - baseline.variance_amount) * 100) / 100
      : null;
  const deltaPct =
    baseline.variance_pct != null && current.variance_pct != null
      ? Math.round((current.variance_pct - baseline.variance_pct) * 100) / 100
      : null;

  const moves = priceMoves(locationId, from, to);
  const comps = compositionChanges(locationId, from, to);
  const corrections = countCorrections(locationId, from, to);
  const unresolved = unresolvedDepletions(locationId, from, to);

  return {
    ok: true,
    reason: null,
    location_id: locationId,
    window: { from, to },
    variance: { baseline, current, delta_amount: deltaAmount, delta_pct: deltaPct },
    price_moves: { count: moves.length, items: moves },
    composition_changes: { count: comps.length, items: comps },
    count_corrections: { count: corrections.length, items: corrections },
    unresolved_depletions: unresolved,
    unattributed:
      moves.length === 0 &&
      comps.length === 0 &&
      corrections.length === 0 &&
      unresolved.count === 0,
    caveat: CAVEAT,
  };
}
