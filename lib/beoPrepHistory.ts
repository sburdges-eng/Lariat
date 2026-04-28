// Pure SQL accessor for beo_prep_history — surfaces past catering-event
// prep records keyed on item name, scoped by location.
//
// Intentionally separate from lib/kitchenAssistantContext.ts so non-KA
// surfaces (BeoBoard sidebar, recipes, menu-engineering) can read the
// same data through one helper instead of re-implementing the queries.
//
// No I/O — caller passes a better-sqlite3 Database handle.

import type Database from 'better-sqlite3';

type DB = Database.Database;

export interface PrepHistoryRow {
  event_date: string | null;
  client: string | null;
  type: string | null;
  amount_qty: string | null;
  prep_day: string | null;
  pre_prep_notes: string | null;
  plating_notes: string | null;
  source: string;
  imported_at: string | null;
}

export interface PrepHistoryMatch {
  item: string;
  history: PrepHistoryRow[];
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;

function clampLimit(n: number | undefined): number {
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  const x = Math.floor(n as number);
  if (x <= 0) return DEFAULT_LIMIT;
  if (x > MAX_LIMIT) return MAX_LIMIT;
  return x;
}

/**
 * Look up prep history for a list of item names. Match is case-insensitive
 * exact (item-equals, not substring) — callers pass the exact `item_name`
 * from `beo_line_items` / `dish_components` / etc.
 *
 * Returns one entry per requested item that has at least one match. Items
 * with no history are omitted.
 */
export function getItemPrepHistory(
  db: DB,
  locationId: string,
  items: string[],
  limit: number = DEFAULT_LIMIT
): PrepHistoryMatch[] {
  const cleaned = Array.from(
    new Set(
      (items || [])
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    )
  );
  if (cleaned.length === 0) return [];

  const cap = clampLimit(limit);
  const stmt = db.prepare(
    `SELECT event_date, client, type, amount_qty,
            prep_day, pre_prep_notes, plating_notes,
            source, imported_at
       FROM beo_prep_history
      WHERE location_id = ?
        AND LOWER(item) = LOWER(?)
      ORDER BY (event_date IS NULL), event_date DESC, id DESC
      LIMIT ?`
  );

  const out: PrepHistoryMatch[] = [];
  for (const item of cleaned) {
    const rows = stmt.all(locationId, item, cap) as PrepHistoryRow[];
    if (rows.length > 0) out.push({ item, history: rows });
  }
  return out;
}

/**
 * Recent catering events (most recent first), grouped by client+event_date.
 * Mirrors the renderer in kitchenAssistantContext.ts but returns structured
 * rows so a UI can render them. Filters to Main Item rows so secondary preps
 * don't bloat the summary.
 */
export interface RecentEvent {
  event_date: string;
  client: string | null;
  items: { item: string; amount_qty: string | null }[];
}

export function getRecentEvents(
  db: DB,
  locationId: string,
  limit: number = DEFAULT_LIMIT
): RecentEvent[] {
  const cap = clampLimit(limit);
  const rows = db
    .prepare(
      `SELECT client, event_date, item, amount_qty
         FROM beo_prep_history
        WHERE location_id = ? AND event_date IS NOT NULL
          AND (type IS NULL OR type = 'Main Item')
        ORDER BY event_date DESC, id ASC`
    )
    .all(locationId) as {
    client: string | null;
    event_date: string;
    item: string;
    amount_qty: string | null;
  }[];

  const byKey = new Map<string, RecentEvent>();
  for (const r of rows) {
    const key = `${r.event_date}|${r.client ?? ''}`;
    let ev = byKey.get(key);
    if (!ev) {
      ev = { event_date: r.event_date, client: r.client, items: [] };
      byKey.set(key, ev);
      if (byKey.size > cap) {
        // already past the cap — but Map keeps insertion order, so the
        // newest events were added first. Stop accumulating.
        break;
      }
    }
    ev.items.push({ item: r.item, amount_qty: r.amount_qty });
  }
  return Array.from(byKey.values()).slice(0, cap);
}
