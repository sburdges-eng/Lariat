// POST /api/kds/tickets/:id/bump — KDS bump-back (protocol v2).
//
// Spec: ~/Dev/Lariat-KDS/docs/lariat-kds-protocol.md §3.
// The Swift parser at Lariat-KDS/Sources/LariatKDSCore/TicketParser.swift
// pins the response shape; do not change without updating the protocol
// doc first (Lariat-KDS/CLAUDE.md hard rule).
//
// PUBLIC endpoint by design — same reasoning as GET /api/kds/tickets:
// the iPad may not have a PIN cookie when it first connects, and the
// Bonjour discovery + per-bump idempotency-key already gate the bump
// behavior. PIN-gating is a v3 question per
// `docs/PHASE3_SCOPING.md` §1 (per-cook accountability fork).
//
// Stub-grade: there is no canonical tickets table to validate :id against.
// When Toast Partner ingest lands, add a SELECT on the live tickets table
// here and return 404 if the id is unknown — the protocol §3 already
// documents that path.
//
// Audit + transaction discipline (docs/PATTERNS.md §3):
//   - postAuditEvent runs inside the same db.transaction as the upsert.
//   - First bump → action='insert'.
//   - Re-bump (row already exists) → action='correction', payload carries
//     the prior bumped_at so the trail reconstructs the full bump history.
//   - The audit row is NOT wrapped in try/catch; an audit failure rolls
//     back the source upsert. This is intentional.

import { getDb } from '../../../../../../lib/db';
import { locationFromBodyOrRequest } from '../../../../../../lib/location';
import { postAuditEvent } from '../../../../../../lib/auditEvents';
import { withIdempotency } from '../../../../../../lib/idempotency';
import { validateBumpPayload, hashPin, bumpActionForExisting } from '../../../../../../lib/kds';

export const dynamic = 'force-dynamic';

const MAX_TICKET_ID_LEN = 200;

function parseTicketId(params) {
  const raw = params?.id;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t || t.length > MAX_TICKET_ID_LEN) return null;
  return t;
}

export async function POST(req, ctx) {
  return withIdempotency(req, () => bumpHandler(req, ctx));
}

async function bumpHandler(req, ctx) {
  const ticketId = parseTicketId(ctx?.params);
  if (!ticketId) {
    return Response.json({ error: 'ticket id missing' }, { status: 400 });
  }

  // Body is optional per protocol §3 — fully empty body is a valid bump.
  let body = null;
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      const text = await req.text();
      body = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      return Response.json({ error: 'body is not valid JSON' }, { status: 422 });
    }
  }

  const v = validateBumpPayload(body);
  if (!v.ok) {
    return Response.json({ error: v.error }, { status: 422 });
  }
  const { bumped_at: bumpedAtIn, station, cook_pin: cookPin } = v.payload;

  const location = locationFromBodyOrRequest(body, req);
  const bumpedAt = bumpedAtIn ?? new Date().toISOString();
  const pinHash = cookPin ? hashPin(cookPin) : null;

  const db = getDb();

  let auditAction = 'insert';
  let priorBumpedAt = null;

  try {
    db.transaction(() => {
      const existing = db
        .prepare(
          `SELECT bumped_at FROM kds_ticket_states
            WHERE ticket_id = ? AND location_id = ?`,
        )
        .get(ticketId, location);

      auditAction = bumpActionForExisting(existing);
      priorBumpedAt = existing ? existing.bumped_at : null;

      // INSERT ... ON CONFLICT UPDATE: kept-latest semantics for bumped_at,
      // station, and pin hash. created_at is preserved on conflict so the
      // first-bump time is recoverable from the row even after re-bumps;
      // the audit trail carries each intermediate bumped_at.
      const info = db
        .prepare(
          `INSERT INTO kds_ticket_states
             (ticket_id, location_id, bumped_at, bumped_station, bumped_pin_hash)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (ticket_id, location_id) DO UPDATE SET
             bumped_at       = excluded.bumped_at,
             bumped_station  = excluded.bumped_station,
             bumped_pin_hash = excluded.bumped_pin_hash,
             updated_at      = datetime('now')`,
        )
        .run(ticketId, location, bumpedAt, station, pinHash);

      // SQLite returns lastInsertRowid = 0 on a pure UPDATE path. Resolve
      // the actual rowid for the audit row — the audit reader needs the
      // primary-key tuple, which is (ticket_id, location_id), but we also
      // record the synthetic rowid for join-friendliness with audit_events.
      let entityRowid = Number(info.lastInsertRowid);
      if (entityRowid === 0) {
        const r = db
          .prepare(
            `SELECT rowid FROM kds_ticket_states
              WHERE ticket_id = ? AND location_id = ?`,
          )
          .get(ticketId, location);
        entityRowid = r ? Number(r.rowid) : 0;
      }

      postAuditEvent({
        entity: 'kds_ticket_state',
        entity_id: entityRowid || null,
        action: auditAction,
        actor_cook_id: null,
        actor_source: 'kds_app',
        location_id: location,
        payload: {
          ticket_id: ticketId,
          bumped_at: bumpedAt,
          station,
          prior_bumped_at: priorBumpedAt,
        },
      });
    })();
  } catch (err) {
    console.error('POST /api/kds/tickets/:id/bump failed:', err);
    return Response.json({ error: 'could not save bump' }, { status: 500 });
  }

  return Response.json({ id: ticketId, bumped_at: bumpedAt }, { status: 200 });
}
