// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb } from '../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../lib/location';
import { withIdempotency } from '../../../lib/idempotency';
import { postAuditEvent } from '../../../lib/auditEvents';
import { appendOp } from '../../../lib/syncFeed';
import { localIdentityFields } from '../../../lib/localIdentity';

export const dynamic = 'force-dynamic';

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

export async function POST(req) {
  return withIdempotency(req, () => checksPostHandler(req));
}

async function checksPostHandler(req) {
  try {
    const body = await req.json();
    const shift_date = clip(body.shift_date, 32);
    const station_id = clip(body.station_id, 64);
    const item = clip(body.item, 300);
    if (!shift_date || !station_id || !item) {
      return Response.json({ error: 'missing fields' }, { status: 400 });
    }
    const loc = locationFromBody(body);
    const status = ['pass', 'fail', 'na'].includes(body.status) ? body.status : null;
    if (!status) {
      return Response.json({ error: 'status must be pass, fail, or na' }, { status: 400 });
    }

    // F15 / FDA §3-301.11: bare-hand-contact-with-RTE attestation.
    // Tri-state: true → 1, false → 0, anything else (undefined/null) → null.
    // NULL means "this line-check item doesn't touch RTE food" (e.g. a
    // raw-only prep task or a cleanup task); the row stays out of the
    // attestation accounting. The UI opts items in by sending the field.
    let gloveAttested = null;
    if (body.glove_change_attested === true) gloveAttested = 1;
    else if (body.glove_change_attested === false) gloveAttested = 0;

    const par = clip(body.par, 64);
    const have = clip(body.have, 64);
    const need = clip(body.need, 64);
    const note = clip(body.note, 1000);
    const cook_id = clip(body.cook_id, 64);
    if (!cook_id) {
      return Response.json({ error: 'cook_id required for line check' }, { status: 400 });
    }

    const db = getDb();

    const stmt = db.prepare(`
      INSERT INTO line_check_entries
        (shift_date, station_id, item, status, par, have, need, note, cook_id, glove_change_attested, location_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // line_check_entries is HACCP-regulated (F15 RTE attestation, pass/fail
    // records that feed station sign-off). docs/PATTERNS.md §3 — every
    // regulated mutation posts one audit_events row inside the same
    // transaction as the source INSERT, so an audit-row failure rolls
    // back the line-check row.
    const info = db.transaction(() => {
      const r = stmt.run(
        shift_date,
        station_id,
        item,
        status,
        par,
        have,
        need,
        note,
        cook_id,
        gloveAttested,
        loc,
      );
      postAuditEvent({
        entity: 'line_check_entries',
        entity_id: Number(r.lastInsertRowid),
        action: 'insert',
        actor_cook_id: cook_id,
        actor_source: 'cook_ui',
        location_id: loc,
        shift_date,
        payload: { station_id, item, status, glove_change_attested: gloveAttested },
      });
      // Cross-host sync feed (audit C2). Stays inside the tx so a feed-
      // append failure rolls back the source INSERT. rowJson snapshots
      // the after-state — the receiver applies via lib/syncApply with
      // family-1 INSERT OR IGNORE semantics. We deliberately exclude
      // `id` from rowJson to dodge cross-host AUTOINCREMENT collisions
      // (audit finding C4 interim mitigation): the receiver assigns its
      // own local id, and op_id is the cross-host idempotency key.
      const identity = localIdentityFields();
      appendOp({
        opId: identity.opId,
        tableName: 'line_check_entries',
        locationId: loc,
        opKind: 'insert',
        rowPk: String(r.lastInsertRowid),
        rowJson: JSON.stringify({
          shift_date,
          station_id,
          item,
          status,
          par,
          have,
          need,
          note,
          cook_id,
          glove_change_attested: gloveAttested,
          location_id: loc,
        }),
        createdAt: identity.createdAt,
        sourceHost: identity.sourceHost,
        sourceStartedAt: identity.sourceStartedAt,
      });
      return r;
    })();

    return Response.json({ ok: true, id: info.lastInsertRowid });
  } catch (err) {
    console.error('POST /api/checks failed:', err);
    return Response.json({ error: 'Failed to save check entry' }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date');
    const station = url.searchParams.get('station');
    const loc = locationFromRequest(req);
    const db = getDb();
    let q = 'SELECT * FROM line_check_entries WHERE location_id = ?';
    const args = [loc];
    if (date) {
      q += ' AND shift_date = ?';
      args.push(date);
    }
    if (station) {
      q += ' AND station_id = ?';
      args.push(station);
    }
    q += ' ORDER BY id DESC LIMIT 500';
    return Response.json(db.prepare(q).all(...args));
  } catch (err) {
    console.error('GET /api/checks failed:', err);
    return Response.json({ error: 'Failed to load checks' }, { status: 500 });
  }
}
