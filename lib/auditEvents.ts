// Append-only audit trail (A1).
//
// Every write to a regulated surface posts one row here. Rows are NEVER
// updated or deleted. A correction is a fresh row with `replaces_id`
// pointing at the prior one. The point is that a health inspector or a
// plaintiff's lawyer can reconstruct the full edit history of any record
// without relying on the source tables (which may have moved on).
//
// NB: this module is write-only on purpose. Reads go through a SELECT
// in the API layer — there's no `getAuditTrailFor(entity, id)` here
// because every caller would want slightly different filters (by actor,
// by date range, by action). Keep the surface small.

import type { AuditEvent } from './db.ts';
import { getDb, todayISO } from './db.ts';

export interface AuditEventInput {
  entity: string;                 // 'temp_log' | 'cooling_log' | 'signoff' | ...
  entity_id: number | null;
  action: AuditEvent['action'];
  actor_cook_id: string | null;
  actor_source: string;           // 'cook_ui' | 'pic_ui' | 'api' | 'export' | ...
  replaces_id?: number | null;
  payload?: unknown;              // serialized to JSON
  note?: string | null;
  shift_date?: string;
  location_id?: string;
}

/**
 * Serialize `payload` defensively. The audit row should never fail on
 * a circular or exotic payload — if JSON.stringify throws, we record a
 * stub so the audit trail itself isn't lost.
 */
function safeJson(x: unknown): string | null {
  if (x === undefined) return null;
  if (x === null) return null;
  try {
    return JSON.stringify(x);
  } catch {
    return JSON.stringify({ _audit_serialization_error: true });
  }
}

/**
 * Post one audit event. Returns the new id.
 *
 * This MUST be invoked INSIDE the same transaction that writes the
 * underlying row, so a rollback also rolls back the audit row.
 */
export function postAuditEvent(input: AuditEventInput): number {
  const db = getDb();
  if (!db.inTransaction) {
    console.warn(`postAuditEvent called outside of a transaction context! Entity: ${input.entity}, Action: ${input.action}. This is unsafe and defies atomicity guarantees.`);
  }

  const info = db
    .prepare(
      `INSERT INTO audit_events (
        shift_date, location_id, actor_cook_id, actor_source,
        entity, entity_id, action, replaces_id, payload_json, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.shift_date ?? todayISO(),
      input.location_id ?? 'default',
      input.actor_cook_id,
      input.actor_source,
      input.entity,
      input.entity_id,
      input.action,
      input.replaces_id ?? null,
      safeJson(input.payload),
      input.note ?? null
    );
  return Number(info.lastInsertRowid);
}
