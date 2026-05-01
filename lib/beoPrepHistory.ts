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

export interface PrepMedian {
  /** Lower-cased canonical key (matches Map key). Use for diagnostics only. */
  key: string;
  /** The exact-cased input item the median was computed for. */
  item: string;
  /** Median of numeric `amount_qty` values across matching rows. */
  median: number;
  /** Count of rows that contributed numeric values to the median. */
  samples: number;
  /** Total matching rows including non-numeric `amount_qty` (e.g. "as needed"). */
  total_rows: number;
}

/**
 * Parse `amount_qty` (TEXT in the DB — operators sometimes type "as needed",
 * "TBD", "30 ea", or just "30") into a positive finite number. Returns
 * `null` if the value can't be coerced or is non-positive. Strips a single
 * trailing unit token so "30 ea" / "50 lb" still yield 30 / 50.
 */
function parseAmountQty(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  // Common shape: "<number>[ <unit>]". Take the leading numeric token.
  // Also accept thousands-separator commas ("1,000", "2,500 ea") so large
  // catering quantities aren't silently truncated to the leading digits.
  const m = trimmed.match(
    /^(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)/
  );
  if (!m || !m[1]) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function median(sorted: number[]): number {
  // Caller passes a sorted array; trust-the-caller pattern keeps this hot.
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Batch median lookup: for each requested item, return the median of its
 * historical prep quantities (case-insensitive exact match on `item`).
 *
 * Returned Map is keyed by `lower(item).trim()`. Items with zero numeric
 * samples are omitted from the map — callers distinguish "no data" via
 * `map.has(key)` rather than a sentinel value.
 *
 * Median is computed in JS (SQLite has no MEDIAN aggregate). Numeric
 * coercion happens via `parseAmountQty` so descriptive values like
 * "as needed" are excluded from the population, not silently treated as 0.
 */
export function getPrepMedianForItems(
  db: DB,
  locationId: string,
  items: string[]
): Map<string, PrepMedian> {
  const out = new Map<string, PrepMedian>();
  const cleaned: { key: string; item: string }[] = [];
  const seenKeys = new Set<string>();
  for (const raw of items || []) {
    if (typeof raw !== 'string') continue;
    const item = raw.trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    cleaned.push({ key, item });
  }
  if (cleaned.length === 0) return out;

  const stmt = db.prepare(
    `SELECT amount_qty FROM beo_prep_history
      WHERE location_id = ? AND LOWER(item) = ?`
  );

  for (const { key, item } of cleaned) {
    const rows = stmt.all(locationId, key) as { amount_qty: string | null }[];
    if (rows.length === 0) continue;
    const nums: number[] = [];
    for (const r of rows) {
      const n = parseAmountQty(r.amount_qty);
      if (n !== null) nums.push(n);
    }
    if (nums.length === 0) continue;
    nums.sort((a, b) => a - b);
    out.set(key, {
      key,
      item,
      median: median(nums),
      samples: nums.length,
      total_rows: rows.length,
    });
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

export interface RecipePrepHistoryRow extends PrepHistoryRow {
  item: string;
}

/**
 * Look up prep history rows whose `item` text relates to a recipe name,
 * via case-insensitive substring matching in either direction:
 *
 *   - BEO `item` contains the recipe name  (e.g. recipe "Tacos" →
 *     items "Carnitas Tacos Buffet", "Fish Taco Buffet")
 *   - Recipe name contains the BEO `item`  (e.g. recipe "Aji Verde" →
 *     items "Aji", "Aji verde")
 *
 * Reason for both directions: BEO sheets are hand-typed and routinely
 * abbreviate ("Aji" vs the recipe "Aji Verde") OR pluralize/expand
 * ("Carnitas Tacos Buffet" vs the recipe "Tacos"). A single-direction
 * LIKE catches one but misses the other.
 *
 * Returns rows ordered most-recent-first (NULL event_date last). The
 * matched `item` text is included on each row so the UI can show
 * "as 'Aji verde'" when the BEO variant differs from the recipe name.
 *
 * Recipe names shorter than `MIN_RECIPE_NAME_LEN` characters return
 * empty — a 1- or 2-letter recipe would substring-match nearly every
 * BEO row and the result would be useless.
 */
const MIN_RECIPE_NAME_LEN = 3;

export function getRecipePrepHistory(
  db: DB,
  locationId: string,
  recipeName: string,
  limit: number = DEFAULT_LIMIT
): RecipePrepHistoryRow[] {
  const name = (recipeName || '').trim();
  if (name.length < MIN_RECIPE_NAME_LEN) return [];

  const cap = clampLimit(limit);
  const lower = name.toLowerCase();

  // Pull all rows for the location and filter the bidirectional substring
  // match in JS. Doing this in SQL would require LIKE wildcards in both
  // directions and escape-handling for `%`/`_` in BOTH the recipe name
  // AND the BEO item text — easy to get wrong. Volume is small
  // (single-location prep_history rarely exceeds a few thousand rows)
  // so the round-trip + JS filter is faster than careful escaping.
  const allRows = db
    .prepare(
      `SELECT item, event_date, client, type, amount_qty,
              prep_day, pre_prep_notes, plating_notes,
              source, imported_at
         FROM beo_prep_history
        WHERE location_id = ? AND item IS NOT NULL
        ORDER BY (event_date IS NULL), event_date DESC, id DESC`
    )
    .all(locationId) as RecipePrepHistoryRow[];

  const matched: RecipePrepHistoryRow[] = [];
  for (const r of allRows) {
    const itemLower = r.item.toLowerCase();
    // Direction A: BEO item contains the recipe name.
    // Direction B: recipe name contains the BEO item, but only if the
    //   BEO item is at least MIN_RECIPE_NAME_LEN chars — shorter items
    //   would substring-match nearly every recipe and produce noise.
    if (
      itemLower.includes(lower) ||
      (itemLower.length >= MIN_RECIPE_NAME_LEN && lower.includes(itemLower))
    ) {
      matched.push(r);
      if (matched.length >= cap) break;
    }
  }
  return matched;
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
