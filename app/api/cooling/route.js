// Two-stage cooling log (F1 / CCP-8).
//
// POST  /api/cooling        → open a cooling batch
// PATCH /api/cooling        → add a stage-1 or stage-2 reading
// GET   /api/cooling        → list today's open + recently closed batches
//
// The library layer (lib/cooling.ts) owns the compliance math — this
// route is just DB I/O + shape validation. We POST an audit_events row
// for every insert/update so the trail survives a later correction.

// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID, locationFromBody, locationFromRequest } from '../../../lib/location';
import {
  classifyCoolingStage,
  scanOpenBatches,
  validateCoolingStart,
} from '../../../lib/cooling';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';
import { appendOp } from '../../../lib/syncFeed';
import { localIdentityFields } from '../../../lib/localIdentity';

export const dynamic = 'force-dynamic';

/** @typedef {import('../../../lib/db').CoolingLogEntry} CoolingRow */

/** @param {unknown} s @param {number} max @returns {string | null} */
const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

/** @param {CoolingRow} row */
function coolingUpdatePayload(row) {
  return {
    id: row.id,
    shift_date: row.shift_date,
    location_id: row.location_id,
    item: row.item,
    station_id: row.station_id,
    started_at: row.started_at,
    start_reading_f: row.start_reading_f,
    stage1_at: row.stage1_at,
    stage1_reading_f: row.stage1_reading_f,
    stage2_at: row.stage2_at,
    stage2_reading_f: row.stage2_reading_f,
    status: row.status,
    breach_reason: row.breach_reason,
    corrective_action: row.corrective_action,
    cook_id: row.cook_id,
    closed_by_cook_id: row.closed_by_cook_id,
  };
}

// ── POST /api/cooling ─────────────────────────────────────────────

/** @param {Request} req */
export async function POST(req) {
  return withIdempotency(req, () => coolingPostHandler(req));
}

/** @param {Request} req */
async function coolingPostHandler(req) {
  try {
    const body = await req.json();
    const v = validateCoolingStart({
      item: body.item,
      started_at: body.started_at,
      start_reading_f: body.start_reading_f ?? null,
    });
    if (!v.ok) return Response.json({ error: v.reason }, { status: 400 });

    const shift_date = clip(body.shift_date, 32) || todayISO();
    const location_id = locationFromBody(body);
    const item = clip(body.item, 200);
    const station_id = clip(body.station_id, 64);
    const cook_id = clip(body.cook_id, 64);
    const started_at = clip(body.started_at, 40);
    const start_reading_f =
      body.start_reading_f === null || body.start_reading_f === undefined
        ? null
        : Number(body.start_reading_f);

    const db = getDb();
    const performWrite = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO cooling_log
          (shift_date, location_id, item, station_id, started_at, start_reading_f, status, cook_id)
        VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?)
      `).run(shift_date, location_id, item, station_id, started_at, start_reading_f, cook_id);

      const row = /** @type {CoolingRow} */ (
        db.prepare('SELECT * FROM cooling_log WHERE id=?').get(info.lastInsertRowid));
      postAuditEvent({
        entity: 'cooling_log',
        entity_id: Number(info.lastInsertRowid),
        action: 'insert',
        actor_cook_id: cook_id,
        actor_source: 'cook_ui',
        payload: row,
        shift_date,
        location_id,
      });

      const identity = localIdentityFields();
      appendOp({
        opId: identity.opId,
        tableName: 'cooling_log',
        locationId: location_id,
        opKind: 'insert',
        rowPk: String(info.lastInsertRowid),
        rowJson: JSON.stringify({
          shift_date,
          location_id,
          item,
          station_id,
          started_at,
          start_reading_f,
          status: 'in_progress',
          cook_id,
        }),
        createdAt: identity.createdAt,
        sourceHost: identity.sourceHost,
        sourceStartedAt: identity.sourceStartedAt,
      });
      return row;
    });

    const row = performWrite();

    return Response.json({ ok: true, entry: row });
  } catch (err) {
    console.error('POST /api/cooling failed:', err);
    return Response.json({ error: 'Failed to open cooling batch' }, { status: 500 });
  }
}

// ── PATCH /api/cooling ────────────────────────────────────────────

/** @param {Request} req */
export async function PATCH(req) {
  return withIdempotency(req, () => coolingPatchHandler(req));
}

/** @param {Request} req */
async function coolingPatchHandler(req) {
  try {
    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      return Response.json({ error: 'id is required' }, { status: 400 });
    }
    const reading_f = body.reading_f === null || body.reading_f === undefined
      ? null
      : Number(body.reading_f);
    const at = clip(body.at, 40);
    const corrective_action = typeof body.corrective_action === 'string'
      ? body.corrective_action.trim()
      : null;
    if (corrective_action && corrective_action.length > 500) {
      return Response.json(
        { error: 'corrective action too long (max 500 chars)' },
        { status: 400 },
      );
    }

    const db = getDb();
    const cook_id = clip(body.cook_id, 64);

    // SELECT + classifyCoolingStage + UPDATE must run in one transaction so
    // two concurrent stage-2 logs can't both decide stage off the same stale
    // pre-update `existing`, producing duplicate stage rows.
    // Caller's location scope, taken from ?location=. Used as a
    // cross-location IDOR guard below.
    const callerLocation = locationFromRequest(req);

    const performUpdate = db.transaction(() => {
      const existing = /** @type {CoolingRow | undefined} */ (
        db.prepare('SELECT * FROM cooling_log WHERE id=?').get(id));
      if (!existing) return { status: 404, error: 'unknown cooling batch' };

      // Cross-location IDOR guard: a cook scoped to site-A must not be
      // able to mutate a cooling batch belonging to site-B by guessing
      // the numeric id. Surfaced as 404 (not 403) so the existence of a
      // batch at another site doesn't leak.
      if (existing.location_id !== callerLocation) {
        return { status: 404, error: 'unknown cooling batch' };
      }

      const decision = classifyCoolingStage({
        row: existing,
        reading_f,
        at,
        corrective_action,
      });
      if (!decision.ok) return { status: 400, error: decision.reason };
      if (decision.status === 'breach' && !corrective_action) {
        return {
          status: 422,
          error: 'breach requires a corrective action note',
          needs_corrective_action: true,
        };
      }

      // Build the update. We only write the stage-appropriate fields; the
      // other stage's columns stay NULL if they were NULL.
      let sql;
      let args;
      if (decision.stage === 1) {
        sql = `UPDATE cooling_log
                 SET stage1_at=?, stage1_reading_f=?, status=?, breach_reason=?,
                     corrective_action=COALESCE(?, corrective_action)
               WHERE id=?`;
        args = [at, reading_f, decision.status, decision.breach_reason, corrective_action, id];
      } else {
        sql = `UPDATE cooling_log
                 SET stage2_at=?, stage2_reading_f=?, status=?, breach_reason=?,
                     corrective_action=COALESCE(?, corrective_action),
                     closed_by_cook_id=?
               WHERE id=?`;
        args = [at, reading_f, decision.status, decision.breach_reason, corrective_action, cook_id, id];
      }

      db.prepare(sql).run(...args);

      const updated = /** @type {CoolingRow} */ (
        db.prepare('SELECT * FROM cooling_log WHERE id=?').get(id));
      postAuditEvent({
        entity: 'cooling_log',
        entity_id: id,
        action: 'update',
        actor_cook_id: cook_id,
        actor_source: 'cook_ui',
        payload: updated,
        shift_date: existing.shift_date,
        location_id: existing.location_id,
        note: decision.breach_reason ? `breach: ${decision.breach_reason}` : null,
      });

      const identity = localIdentityFields();
      appendOp({
        opId: identity.opId,
        tableName: 'cooling_log',
        locationId: existing.location_id,
        opKind: 'update',
        rowPk: String(id),
        rowJson: JSON.stringify(coolingUpdatePayload(updated)),
        createdAt: identity.createdAt,
        sourceHost: identity.sourceHost,
        sourceStartedAt: identity.sourceStartedAt,
      });

      return { status: 200, updated, decision };
    });

    const result = performUpdate();
    if (result.status !== 200) {
      const { status, ...body } = result;
      return Response.json(body, { status });
    }

    // status === 200 always carries decision (ok:true branch) + updated;
    // the transaction's inferred union can't express that, so assert it.
    const ok = /** @type {{ updated: CoolingRow, decision: Extract<import('../../../lib/cooling').StageDecision, { ok: true }> }} */ (result);

    return Response.json({
      ok: true,
      decision: {
        stage: ok.decision.stage,
        status: ok.decision.status,
        breach_reason: ok.decision.breach_reason,
        minutes_elapsed: ok.decision.minutes_elapsed,
      },
      entry: ok.updated,
    });
  } catch (err) {
    console.error('PATCH /api/cooling failed:', err);
    return Response.json({ error: 'Failed to update cooling batch' }, { status: 500 });
  }
}

// ── GET /api/cooling ──────────────────────────────────────────────

/** @param {Request} req */
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date') || todayISO();
    const location_id = locationFromRequest(req) || DEFAULT_LOCATION_ID;
    const includeClosed = url.searchParams.get('all') === '1';

    const db = getDb();
    const openRows = /** @type {CoolingRow[]} */ (db.prepare(`
      SELECT * FROM cooling_log
       WHERE location_id=? AND status='in_progress'
       ORDER BY started_at ASC
    `).all(location_id));

    const scan = scanOpenBatches(openRows, Date.now());

    /** @type {CoolingRow[]} */
    let closed = [];
    if (includeClosed) {
      closed = /** @type {CoolingRow[]} */ (db.prepare(`
        SELECT * FROM cooling_log
         WHERE location_id=? AND shift_date=? AND status != 'in_progress'
         ORDER BY id DESC
      `).all(location_id, date));
    }

    return Response.json({
      date,
      location_id,
      open: openRows,
      scan,
      closed,
    });
  } catch (err) {
    console.error('GET /api/cooling failed:', err);
    return Response.json({ error: 'Failed to load cooling log' }, { status: 500 });
  }
}
