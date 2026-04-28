/**
 * Box-office repo — Phase 2 event-ops (SCAFFOLD).
 *
 * One row per ticket-source line in `box_office_lines`. Multiple sources:
 *   - 'dice'        — DICE order (external_ref = order id; deduped on it)
 *   - 'walkup'      — at-the-door cash sale
 *   - 'comp'        — promoter / band comp
 *   - 'will_call'   — phone holds
 *   - 'guestlist'   — house list (owner / staff)
 *
 * Cash custody is regulated; this surface uses lib/auditEvents.ts (DB
 * stream) for writes — NOT lib/auditLog.mjs (file stream). That's the
 * one departure from the stage/sound pattern.
 *
 * Status: SKELETON. Phase 2 fills in:
 *   - createBoxOfficeLine(db, input): writes a single line with audit
 *   - bulkUpsertFromDice(db, lines): idempotent UPDATE on external_ref
 *   - listLinesForShow(db, show_id, location_id): all sources
 *   - settlementSummary(db, show_id, location_id): roll-up join with
 *     shows.status_json.deal + Toast bar/food revenue
 *   - markScanned(db, line_id, scanned_at): door scanner integration
 *
 * See docs/PHASE2_PLAN.md task A3 + B1-B4 for the full task list.
 */

import type { Database } from 'better-sqlite3';
import { postAuditEvent } from './auditEvents.ts';

// ── Types ──────────────────────────────────────────────────────────

export type BoxOfficeSource = 'dice' | 'walkup' | 'comp' | 'will_call' | 'guestlist';

export interface BoxOfficeLine {
  id: number;
  show_id: number;
  location_id: string;
  source: BoxOfficeSource;
  ticket_class: string | null;
  qty: number;
  face_price: number | null;
  fees: number | null;
  external_ref: string | null;
  scanned_at: string | null;
  notes: string | null;
  created_at: string;
}

// ── Reads ──────────────────────────────────────────────────────────

export function listLinesForShow(
  db: Database,
  show_id: number,
  location_id: string,
): BoxOfficeLine[] {
  return db
    .prepare(
      `SELECT * FROM box_office_lines
        WHERE show_id = ? AND location_id = ?
        ORDER BY created_at DESC, id DESC`,
    )
    .all(show_id, location_id) as BoxOfficeLine[];
}

export interface BoxOfficeSummary {
  show_id: number;
  location_id: string;
  total_qty: number;
  total_revenue: number;
  total_fees: number;
  by_source: Record<BoxOfficeSource, { qty: number; revenue: number }>;
  scanned_qty: number;
  unscanned_qty: number;
}

const ZERO_BY_SOURCE = (): Record<BoxOfficeSource, { qty: number; revenue: number }> => ({
  dice: { qty: 0, revenue: 0 },
  walkup: { qty: 0, revenue: 0 },
  comp: { qty: 0, revenue: 0 },
  will_call: { qty: 0, revenue: 0 },
  guestlist: { qty: 0, revenue: 0 },
});

export function summarizeBoxOffice(
  db: Database,
  show_id: number,
  location_id: string,
): BoxOfficeSummary {
  const lines = listLinesForShow(db, show_id, location_id);
  const summary: BoxOfficeSummary = {
    show_id,
    location_id,
    total_qty: 0,
    total_revenue: 0,
    total_fees: 0,
    by_source: ZERO_BY_SOURCE(),
    scanned_qty: 0,
    unscanned_qty: 0,
  };
  for (const l of lines) {
    summary.total_qty += l.qty;
    const rev = (l.face_price ?? 0) * l.qty;
    summary.total_revenue += rev;
    summary.total_fees += l.fees ?? 0;
    const bucket = summary.by_source[l.source];
    bucket.qty += l.qty;
    bucket.revenue += rev;
    if (l.scanned_at) summary.scanned_qty += l.qty;
    else summary.unscanned_qty += l.qty;
  }
  return summary;
}

// ── Writes (SCAFFOLD — one minimum-viable insert path) ────────────

export interface CreateLineInput {
  show_id: number;
  location_id: string;
  source: BoxOfficeSource;
  ticket_class?: string | null;
  qty: number;
  face_price?: number | null;
  fees?: number | null;
  external_ref?: string | null;
  notes?: string | null;
  /** Caller-asserted; fed into audit_events.actor_cook_id. */
  actor_cook_id?: string | null;
}

const VALID_SOURCES: ReadonlySet<BoxOfficeSource> = new Set([
  'dice',
  'walkup',
  'comp',
  'will_call',
  'guestlist',
]);

export function createBoxOfficeLine(
  db: Database,
  input: CreateLineInput,
): BoxOfficeLine {
  if (!Number.isInteger(input.show_id) || input.show_id <= 0) {
    throw new Error('show_id must be a positive integer');
  }
  if (!VALID_SOURCES.has(input.source)) {
    throw new Error(`invalid source: ${input.source}`);
  }
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new Error('qty must be a positive integer');
  }

  const tx = db.transaction((): BoxOfficeLine => {
    const info = db.prepare(
      `INSERT INTO box_office_lines
         (show_id, location_id, source, ticket_class, qty, face_price, fees, external_ref, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.show_id,
      input.location_id,
      input.source,
      input.ticket_class ?? null,
      input.qty,
      input.face_price ?? null,
      input.fees ?? null,
      input.external_ref ?? null,
      input.notes ?? null,
    );
    const id = Number(info.lastInsertRowid);
    const row = db.prepare(`SELECT * FROM box_office_lines WHERE id = ?`).get(id) as BoxOfficeLine;
    postAuditEvent({
      entity: 'box_office_lines',
      entity_id: id,
      action: 'insert',
      actor_cook_id: input.actor_cook_id ?? null,
      actor_source: 'box_office',
      location_id: input.location_id,
      shift_date: new Date().toISOString().slice(0, 10),
      payload: {
        show_id: input.show_id,
        source: input.source,
        ticket_class: input.ticket_class ?? null,
        qty: input.qty,
        face_price: input.face_price ?? null,
        fees: input.fees ?? null,
        external_ref: input.external_ref ?? null,
      },
    });
    return row;
  });
  return tx();
}

/**
 * Mark a single box-office line as scanned at the door.
 *
 * Returns the updated row, or null if no eligible row matched (already
 * scanned, missing, or location mismatch). Audit emission lives inside
 * the same tx as the UPDATE so an audit failure rolls back the scan.
 */
export function markScanned(
  db: Database,
  line_id: number,
  location_id: string,
  actor_cook_id: string | null,
): BoxOfficeLine | null {
  if (!Number.isInteger(line_id) || line_id <= 0) {
    throw new Error('line_id must be a positive integer');
  }

  const tx = db.transaction((): BoxOfficeLine | null => {
    const info = db.prepare(
      `UPDATE box_office_lines
          SET scanned_at = datetime('now')
        WHERE id = ? AND location_id = ? AND scanned_at IS NULL`,
    ).run(line_id, location_id);
    if (info.changes === 0) return null;

    const row = db
      .prepare(`SELECT * FROM box_office_lines WHERE id = ?`)
      .get(line_id) as BoxOfficeLine;

    postAuditEvent({
      entity: 'box_office_lines',
      entity_id: line_id,
      action: 'update',
      actor_cook_id: actor_cook_id ?? null,
      actor_source: 'box_office',
      location_id,
      shift_date: new Date().toISOString().slice(0, 10),
      payload: {
        op: 'mark_scanned',
        show_id: row.show_id,
        source: row.source,
        qty: row.qty,
        external_ref: row.external_ref,
        scanned_at: row.scanned_at,
      },
    });
    return row;
  });
  return tx();
}

// ── Completeness signal ───────────────────────────────────────────

export interface BoxOfficeCompleteness {
  has_any_lines: boolean;
  has_dice_lines: boolean;
  has_walkup_lines: boolean;
  /** 0..1 score: any-lines + dice-lines + walkup-lines (all three milestones for a settled show). */
  score: number;
}

export function boxOfficeCompleteness(summary: BoxOfficeSummary): BoxOfficeCompleteness {
  const has_any_lines = summary.total_qty > 0;
  const has_dice_lines = summary.by_source.dice.qty > 0;
  const has_walkup_lines = summary.by_source.walkup.qty > 0;
  const milestones = [has_any_lines, has_dice_lines, has_walkup_lines].filter(Boolean).length;
  return {
    has_any_lines,
    has_dice_lines,
    has_walkup_lines,
    score: milestones / 3,
  };
}
