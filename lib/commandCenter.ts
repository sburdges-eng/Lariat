// Data layer for the GM Command Center. Consumed by the /command page
// (server-rendered tiles) and /api/command/summary (JSON for mobile +
// scheduled pings + Slack-style alerts).
//
// All numbers are derived — no new tables. Adding a new signal here is
// a SELECT against existing schema, not a migration.

import { getDb } from './db';
import { classifyReadings } from './tempLog';
import { scanExpiringBatches } from './dateMarks';
import { listPriceShocks } from './vendorPricesRepo';
import { listMarginDeltas } from './marginDeltas';

export interface CommandSummary {
  shift_date: string;
  yesterday: string;
  location_id: string;
  sales: {
    yesterday_net: number;
    orders: number;
    guests: number;
    avg7_net: number;
    avg7_orders: number;
    delta_pct: number;
  };
  eighty_six: number;
  inventory: {
    low_par: number;
    par_total: number;
    open_counts: number;
  };
  labor: {
    open_breaks: number;
    cert_expiring_30d: number;
    cert_expired: number;
  };
  food_safety: {
    temp_breaches: number;
    temp_readings: number;
    date_marks_expired: number;
    date_marks_due_today: number;
    cleaning_overdue: number;
    cleaning_due_today: number;
  };
  preshift_notes: number;
  events_today: number;
  events_guests: number;
  reservations: {
    booked: number;
    seated: number;
    completed: number;
    no_show: number;
    cancelled: number;
    total: number;
  };
  prep: {
    todo: number;
    in_progress: number;
    done: number;
    skipped: number;
    rush: number;
  };
  price_moves: {
    total: number;
    up: number;
    down: number;
  };
  margin_moves: {
    total: number;
    up: number;
    down: number;
  };
  dining_tables: {
    open: number;
    seated: number;
    dirty: number;
    closed: number;
    total: number;
    seats_total: number;
    seats_seated: number;
  };
  waste: {
    today: number;
    last_7d: number;
  };
}

/**
 * One actionable item derived from a CommandSummary.
 *
 * Intentionally string-based for the message field so a notification
 * surface (Slack, SMS, push) can render it directly. The source field
 * is a stable key for grouping and dedupe — a Slack integration that
 * wants to suppress a repeating "expired date marks" alert can dedupe
 * by `source`.
 */
export interface CommandAlert {
  severity: 'red' | 'amber';
  source: string;        // stable kebab-case key
  message: string;       // human-readable, line-cook plain English
  count: number;         // the number behind the alert
}

const RED_NO_SHOW_THRESHOLD = 3;
const AMBER_SALES_DROP_PCT = -0.15;

function yesterdayISO(today: string): string {
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function summarize(locationId: string, today: string): CommandSummary {
  const db = getDb();
  const yesterday = yesterdayISO(today);

  const yRow =
    (db
      .prepare(
        `SELECT net_sales, orders, guests
           FROM toast_sales_daily
          WHERE location_id = ? AND comparison_group = 1 AND shift_date = ?`,
      )
      .get(locationId, yesterday) as
      | { net_sales: number | null; orders: number | null; guests: number | null }
      | undefined) || { net_sales: 0, orders: 0, guests: 0 };

  const trailing =
    (db
      .prepare(
        `SELECT AVG(net_sales) AS avg_sales, AVG(orders) AS avg_orders
           FROM (
             SELECT net_sales, orders FROM toast_sales_daily
              WHERE location_id = ? AND comparison_group = 1
                AND shift_date < ?
              ORDER BY shift_date DESC LIMIT 7
           )`,
      )
      .get(locationId, today) as { avg_sales: number | null; avg_orders: number | null }) || {
      avg_sales: 0,
      avg_orders: 0,
    };

  const eightySix = (db
    .prepare(
      `SELECT COUNT(*) AS c FROM eighty_six
        WHERE location_id = ? AND shift_date = ? AND resolved_at IS NULL`,
    )
    .get(locationId, today) as { c: number }).c;

  const lowRows = db
    .prepare(
      `SELECT p.ingredient
         FROM inventory_par p
         JOIN (
           SELECT l1.ingredient, l1.sku, l1.on_hand_qty
             FROM inventory_count_lines l1
            WHERE l1.location_id = ?
              AND l1.counted_at = (
                SELECT MAX(l2.counted_at)
                  FROM inventory_count_lines l2
                 WHERE l2.location_id = l1.location_id
                   AND l2.ingredient = l1.ingredient
                   AND COALESCE(l2.sku,'') = COALESCE(l1.sku,'')
              )
         ) AS latest
           ON latest.ingredient = p.ingredient
          AND COALESCE(latest.sku,'') = COALESCE(p.sku,'')
        WHERE p.location_id = ?
          AND p.par_qty IS NOT NULL
          AND latest.on_hand_qty IS NOT NULL
          AND latest.on_hand_qty < p.par_qty`,
    )
    .all(locationId, locationId) as Array<{ ingredient: string }>;

  const parTotal = (db
    .prepare(`SELECT COUNT(*) AS c FROM inventory_par WHERE location_id = ?`)
    .get(locationId) as { c: number }).c;
  const openCounts = (db
    .prepare(
      `SELECT COUNT(*) AS c FROM inventory_counts
        WHERE location_id = ? AND closed_at IS NULL`,
    )
    .get(locationId) as { c: number }).c;

  const breaks = db
    .prepare(
      `SELECT ended_at, waived FROM shift_breaks
        WHERE location_id = ? AND shift_date = ?`,
    )
    .all(locationId, today) as Array<{ ended_at: string | null; waived: number }>;
  const openBreaks = breaks.filter((b) => !b.ended_at && !b.waived).length;

  const certs = db
    .prepare(
      `SELECT expires_on FROM staff_certifications
        WHERE location_id = ? AND expires_on IS NOT NULL AND active = 1`,
    )
    .all(locationId) as Array<{ expires_on: string }>;
  const now = new Date(today + 'T00:00:00').getTime();
  let expired = 0;
  let soon = 0;
  for (const c of certs) {
    const exp = new Date(c.expires_on + 'T00:00:00').getTime();
    const days = Math.floor((exp - now) / 86400000);
    if (days < 0) expired += 1;
    else if (days <= 30) soon += 1;
  }

  const temps = db
    .prepare(
      `SELECT id, point_id, reading_f, required_min_f, required_max_f,
              corrective_action, created_at
         FROM temp_log
        WHERE location_id = ? AND shift_date = ?`,
    )
    .all(locationId, today) as Parameters<typeof classifyReadings>[0];
  const tempBreaches = classifyReadings(temps, { expectAllPoints: false }).filter(
    (t) => t.status === 'red',
  ).length;

  // Active (un-discarded) date marks at this location. scanExpiringBatches
  // classifies each as 'expired' (past due, must toss now), 'due_today'
  // (toss before close of business), or 'ok'.
  const dmRows = db
    .prepare(
      `SELECT id, item, prepared_on, discard_on, discarded_at
         FROM date_marks
        WHERE location_id = ? AND discarded_at IS NULL`,
    )
    .all(locationId) as Array<{
      id: number;
      item: string;
      prepared_on: string;
      discard_on: string;
      discarded_at: string | null;
    }>;
  const expiringBatches = scanExpiringBatches(dmRows, today);
  const dateMarksExpired = expiringBatches.filter((b) => b.status === 'expired').length;
  const dateMarksDueToday = expiringBatches.filter((b) => b.status === 'due_today').length;

  // Active cleaning schedule rows where next_due is past or today.
  // archived_at is added at runtime by initSchema, so we filter it
  // here too — retired rows shouldn't show as overdue.
  const cleaningCounts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN next_due IS NOT NULL AND next_due < ? THEN 1 ELSE 0 END) AS overdue,
         SUM(CASE WHEN next_due = ? THEN 1 ELSE 0 END) AS due_today
         FROM cleaning_schedule
        WHERE location_id = ? AND active = 1 AND archived_at IS NULL`,
    )
    .get(today, today, locationId) as { overdue: number | null; due_today: number | null };
  const cleaningOverdue = Number(cleaningCounts.overdue) || 0;
  const cleaningDueToday = Number(cleaningCounts.due_today) || 0;

  const preshiftCount = (db
    .prepare(
      `SELECT COUNT(*) AS c FROM preshift_notes
        WHERE location_id = ? AND shift_date = ?`,
    )
    .get(locationId, today) as { c: number }).c;

  const events = db
    .prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(guest_count), 0) AS guests
         FROM beo_events
        WHERE location_id = ? AND event_date = ?
          AND COALESCE(status,'') NOT IN ('cancelled','canceled')`,
    )
    .get(locationId, today) as { c: number; guests: number };

  // Today's book by status. reservation_at is TEXT 'YYYY-MM-DD HH:MM' so a
  // date-prefix match pulls every booking for today regardless of seating
  // time. cancelled bookings are surfaced separately, not in the total.
  const resRows = db
    .prepare(
      `SELECT status, COUNT(*) AS c FROM reservations
        WHERE location_id = ?
          AND substr(reservation_at, 1, 10) = ?
        GROUP BY status`,
    )
    .all(locationId, today) as Array<{ status: string; c: number }>;
  const reservations = {
    booked: 0, seated: 0, completed: 0, no_show: 0, cancelled: 0, total: 0,
  };
  for (const r of resRows) {
    if (Object.prototype.hasOwnProperty.call(reservations, r.status)) {
      (reservations as Record<string, number>)[r.status] = r.c;
    }
  }
  reservations.total =
    reservations.booked + reservations.seated + reservations.completed + reservations.no_show;

  // Prep board for today: status counts + a 'rush' count (priority 1 or 2
  // and not yet done). Mirrors the inline rollup in app/command/page.jsx.
  const prepRows = db
    .prepare(
      `SELECT status, priority FROM prep_tasks
        WHERE location_id = ? AND shift_date = ?`,
    )
    .all(locationId, today) as Array<{ status: string; priority: number | null }>;
  const prep = { todo: 0, in_progress: 0, done: 0, skipped: 0, rush: 0 };
  for (const r of prepRows) {
    if (Object.prototype.hasOwnProperty.call(prep, r.status)) {
      const p = prep as Record<string, number>;
      p[r.status] = (p[r.status] ?? 0) + 1;
    }
    if (
      (r.priority === 1 || r.priority === 2) &&
      (r.status === 'todo' || r.status === 'in_progress')
    ) {
      prep.rush += 1;
    }
  }

  // Vendor price + dish-level margin moves over the last 7 days at >= 5%.
  // Same options the page passes — keep the GM dashboard and the JSON
  // endpoint pointed at the same window so the numbers don't disagree.
  const priceShocks = listPriceShocks(db, {
    location_id: locationId, windowDays: 7, minPctMove: 5, limit: 100,
  });
  const marginDeltas = listMarginDeltas(db, {
    location_id: locationId, windowDays: 7, minPctMove: 5, limit: 100,
  });
  const price_moves = {
    total: priceShocks.length,
    up: priceShocks.filter((r) => r.direction === 'up').length,
    down: priceShocks.filter((r) => r.direction === 'down').length,
  };
  const margin_moves = {
    total: marginDeltas.length,
    up: marginDeltas.filter((r) => r.direction === 'up').length,
    down: marginDeltas.filter((r) => r.direction === 'down').length,
  };

  // Waste log: count of inventory_updates with direction='waste' for
  // today and the rolling 7-day window. Mirrors the rollup that the
  // /inventory/waste page surfaces in its 7-day card.
  const wasteToday = (db
    .prepare(
      `SELECT COUNT(*) AS c FROM inventory_updates
        WHERE location_id = ? AND direction = 'waste' AND shift_date = ?`,
    )
    .get(locationId, today) as { c: number }).c;
  const since7 = (() => {
    const d = new Date(today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 6);
    return d.toISOString().slice(0, 10);
  })();
  const waste7d = (db
    .prepare(
      `SELECT COUNT(*) AS c FROM inventory_updates
        WHERE location_id = ? AND direction = 'waste' AND shift_date >= ?`,
    )
    .get(locationId, since7) as { c: number }).c;
  const waste = { today: wasteToday, last_7d: waste7d };

  // Dining-room floor: status counts + seat occupancy. 'dirty' is the
  // bussing-needed signal; 'seated' rolls capacity into seats_seated.
  const tableRows = db
    .prepare(
      `SELECT status, COALESCE(capacity, 0) AS capacity FROM dining_tables
        WHERE location_id = ?`,
    )
    .all(locationId) as Array<{ status: string; capacity: number }>;
  const dining_tables = {
    open: 0, seated: 0, dirty: 0, closed: 0,
    total: tableRows.length, seats_total: 0, seats_seated: 0,
  };
  for (const r of tableRows) {
    if (Object.prototype.hasOwnProperty.call(dining_tables, r.status)) {
      const t = dining_tables as Record<string, number>;
      t[r.status] = (t[r.status] ?? 0) + 1;
    }
    dining_tables.seats_total += Number(r.capacity) || 0;
    if (r.status === 'seated') {
      dining_tables.seats_seated += Number(r.capacity) || 0;
    }
  }

  const yesterdayNet = Number(yRow.net_sales) || 0;
  const avg7 = Number(trailing.avg_sales) || 0;
  const deltaPct = avg7 > 0 ? (yesterdayNet - avg7) / avg7 : 0;

  return {
    shift_date: today,
    yesterday,
    location_id: locationId,
    sales: {
      yesterday_net: yesterdayNet,
      orders: Number(yRow.orders) || 0,
      guests: Number(yRow.guests) || 0,
      avg7_net: avg7,
      avg7_orders: Number(trailing.avg_orders) || 0,
      delta_pct: deltaPct,
    },
    eighty_six: eightySix,
    inventory: {
      low_par: lowRows.length,
      par_total: parTotal,
      open_counts: openCounts,
    },
    labor: {
      open_breaks: openBreaks,
      cert_expiring_30d: soon,
      cert_expired: expired,
    },
    food_safety: {
      temp_breaches: tempBreaches,
      temp_readings: temps.length,
      date_marks_expired: dateMarksExpired,
      date_marks_due_today: dateMarksDueToday,
      cleaning_overdue: cleaningOverdue,
      cleaning_due_today: cleaningDueToday,
    },
    preshift_notes: preshiftCount,
    events_today: events.c,
    events_guests: Number(events.guests) || 0,
    reservations,
    prep,
    price_moves,
    margin_moves,
    dining_tables,
    waste,
  };
}

/**
 * Convert a summary into a prioritized list of actionable alerts.
 *
 * Red = "fix this before service or before close." These are the
 * food-safety, regulatory, and customer-impact signals (out-of-range
 * temps, expired marks, overdue cleaning, items 86'd, expired certs,
 * pile of no-shows).
 *
 * Amber = "watch this." Trending or upcoming signals that don't
 * require immediate intervention but should land in the GM's eye
 * before the line opens.
 *
 * Order: red first, then amber. Within each tier the order is the
 * sequence below — most-load-bearing first.
 */
export function alertsFor(s: CommandSummary): CommandAlert[] {
  const out: CommandAlert[] = [];
  const push = (a: CommandAlert) => { if (a.count > 0) out.push(a); };

  // ── Red: food-safety / regulatory / customer-impact ────────────
  push({
    severity: 'red', source: 'temp-breaches',
    count: s.food_safety.temp_breaches,
    message: `${s.food_safety.temp_breaches} temp reading${s.food_safety.temp_breaches === 1 ? '' : 's'} out of range`,
  });
  push({
    severity: 'red', source: 'date-marks-expired',
    count: s.food_safety.date_marks_expired,
    message: `${s.food_safety.date_marks_expired} expired date mark${s.food_safety.date_marks_expired === 1 ? '' : 's'} — toss now`,
  });
  push({
    severity: 'red', source: 'cleaning-overdue',
    count: s.food_safety.cleaning_overdue,
    message: `${s.food_safety.cleaning_overdue} cleaning task${s.food_safety.cleaning_overdue === 1 ? '' : 's'} overdue`,
  });
  push({
    severity: 'red', source: 'cert-expired',
    count: s.labor.cert_expired,
    message: `${s.labor.cert_expired} expired cert${s.labor.cert_expired === 1 ? '' : 's'}`,
  });
  push({
    severity: 'red', source: 'eighty-six',
    count: s.eighty_six,
    message: `${s.eighty_six} item${s.eighty_six === 1 ? '' : 's'} 86’d`,
  });
  if (s.reservations.no_show >= RED_NO_SHOW_THRESHOLD) {
    out.push({
      severity: 'red', source: 'reservation-no-shows',
      count: s.reservations.no_show,
      message: `${s.reservations.no_show} reservation no-show${s.reservations.no_show === 1 ? '' : 's'}`,
    });
  }

  // ── Amber: trending / upcoming ─────────────────────────────────
  if (s.sales.avg7_net > 0 && s.sales.delta_pct < AMBER_SALES_DROP_PCT) {
    out.push({
      severity: 'amber', source: 'sales-down',
      count: 1,
      message: `Sales ${(s.sales.delta_pct * 100).toFixed(0)}% vs 7-day avg`,
    });
  }
  push({
    severity: 'amber', source: 'date-marks-due-today',
    count: s.food_safety.date_marks_due_today,
    message: `${s.food_safety.date_marks_due_today} date mark${s.food_safety.date_marks_due_today === 1 ? '' : 's'} due today`,
  });
  push({
    severity: 'amber', source: 'cleaning-due-today',
    count: s.food_safety.cleaning_due_today,
    message: `${s.food_safety.cleaning_due_today} cleaning task${s.food_safety.cleaning_due_today === 1 ? '' : 's'} due today`,
  });
  push({
    severity: 'amber', source: 'inventory-low-par',
    count: s.inventory.low_par,
    message: `${s.inventory.low_par} item${s.inventory.low_par === 1 ? '' : 's'} below par`,
  });
  push({
    severity: 'amber', source: 'inventory-open-counts',
    count: s.inventory.open_counts,
    message: `${s.inventory.open_counts} open inventory count${s.inventory.open_counts === 1 ? '' : 's'}`,
  });
  push({
    severity: 'amber', source: 'open-breaks',
    count: s.labor.open_breaks,
    message: `${s.labor.open_breaks} open break${s.labor.open_breaks === 1 ? '' : 's'}`,
  });
  push({
    severity: 'amber', source: 'cert-expiring-30d',
    count: s.labor.cert_expiring_30d,
    message: `${s.labor.cert_expiring_30d} cert${s.labor.cert_expiring_30d === 1 ? '' : 's'} expiring in 30d`,
  });
  push({
    severity: 'amber', source: 'prep-rush',
    count: s.prep.rush,
    message: `${s.prep.rush} rush prep task${s.prep.rush === 1 ? '' : 's'}`,
  });
  push({
    severity: 'amber', source: 'reservations-to-seat',
    count: s.reservations.booked,
    message: `${s.reservations.booked} reservation${s.reservations.booked === 1 ? '' : 's'} still to seat`,
  });
  push({
    severity: 'amber', source: 'tables-dirty',
    count: s.dining_tables.dirty,
    message: `${s.dining_tables.dirty} dirty table${s.dining_tables.dirty === 1 ? '' : 's'}`,
  });
  push({
    severity: 'amber', source: 'price-moves',
    count: s.price_moves.total,
    message: `${s.price_moves.total} vendor price move${s.price_moves.total === 1 ? '' : 's'} this week`,
  });
  push({
    severity: 'amber', source: 'margin-moves',
    count: s.margin_moves.total,
    message: `${s.margin_moves.total} dish margin move${s.margin_moves.total === 1 ? '' : 's'} this week`,
  });

  return out;
}
