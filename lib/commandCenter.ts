// Data layer for the GM Command Center. Consumed by the /command page
// (server-rendered tiles) and /api/command/summary (JSON for mobile +
// scheduled pings + Slack-style alerts).
//
// All numbers are derived — no new tables. Adding a new signal here is
// a SELECT against existing schema, not a migration.

import { getDb } from './db';
import { classifyReadings } from './tempLog';
import { scanExpiringBatches } from './dateMarks';

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
}

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
  };
}
