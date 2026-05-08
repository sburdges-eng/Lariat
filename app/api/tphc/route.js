// Time as Public Health Control (F11 / FDA §3-501.19).
//
// POST  /api/tphc   → start a TPHC batch (computes cutoff_at server-side)
// PATCH /api/tphc   → mark a batch as discarded / consumed
// GET   /api/tphc   → active batches + scan (ok / warning / expired)

import { getDb, todayISO } from '../../../lib/db';
import {
  DEFAULT_LOCATION_ID,
  locationFromBody,
  locationFromRequest,
} from '../../../lib/location';
import {
  computeCutoffAt,
  isTphcDiscardReason,
  scanActiveTphc,
  TPHC_DISCARD_REASONS,
  TPHC_KINDS,
  validateTphcCreate,
} from '../../../lib/tphc';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';

export const dynamic = 'force-dynamic';

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

// ── POST /api/tphc ────────────────────────────────────────────────

export async function POST(req) {
  return withIdempotency(req, () => tphcPostHandler(req));
}

async function tphcPostHandler(req) {
  try {
    const body = await req.json();
    const v = validateTphcCreate({
      item: body.item,
      started_at: body.started_at,
      kind: body.kind,
      batch_ref: body.batch_ref,
      station_id: body.station_id,
    });
    if (!v.ok) return Response.json({ error: v.reason }, { status: 400 });

    const item = clip(body.item, 200);
    const started_at = clip(body.started_at, 40);
    const kind = body.kind; // validated above; one of TPHC_KINDS
    const batch_ref = clip(body.batch_ref, 120);
    const station_id = clip(body.station_id, 64);
    const cook_id = clip(body.cook_id, 64);
    const location_id = locationFromBody(body);
    const shift_date = clip(body.shift_date, 10) || todayISO();
    const cutoff_at = computeCutoffAt(started_at, kind);

    const db = getDb();

    const performWrite = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO tphc_entries
          (shift_date, location_id, station_id, item, batch_ref,
           started_at, cutoff_at, cook_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(shift_date, location_id, station_id, item, batch_ref,
             started_at, cutoff_at, cook_id);

      const row = db.prepare('SELECT * FROM tphc_entries WHERE id=?')
        .get(info.lastInsertRowid);

      postAuditEvent({
        entity: 'tphc_entries',
        entity_id: Number(info.lastInsertRowid),
        action: 'insert',
        actor_cook_id: cook_id,
        actor_source: 'cook_ui',
        payload: { ...row, kind },
        shift_date,
        location_id,
        note: `TPHC started: kind=${kind} cutoff=${cutoff_at}`,
      });

      return row;
    });

    const row = performWrite();
    return Response.json({ ok: true, entry: row, kind, cutoff_at });
  } catch (err) {
    console.error('POST /api/tphc failed:', err);
    return Response.json({ error: 'Failed to start TPHC batch' }, { status: 500 });
  }
}

// ── PATCH /api/tphc ───────────────────────────────────────────────

export async function PATCH(req) {
  return withIdempotency(req, () => tphcPatchHandler(req));
}

async function tphcPatchHandler(req) {
  try {
    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      return Response.json({ error: 'id is required' }, { status: 400 });
    }
    const reason = clip(body.discard_reason, 64);
    if (!reason || !isTphcDiscardReason(reason)) {
      return Response.json(
        { error: `discard_reason must be one of: ${TPHC_DISCARD_REASONS.join(', ')}` },
        { status: 400 },
      );
    }
    const cook_id = clip(body.cook_id, 64);

    const db = getDb();
    const now = new Date().toISOString();

    // SELECT (existence) + already-discarded guard + UPDATE + audit must
    // all run in one transaction. Pre-fix the SELECT + guards ran outside
    // the tx, which let two concurrent PATCHes on the same id both pass
    // `discarded_at IS NULL` against the same stale snapshot and double-
    // stamp the row. Returning a tagged shape mirrors the cooling PATCH.
    const performUpdate = db.transaction(() => {
      const existing = db.prepare('SELECT * FROM tphc_entries WHERE id=?').get(id);
      if (!existing) return { status: 404, error: 'unknown tphc entry' };
      if (existing.discarded_at) {
        return { status: 409, error: 'already discarded', entry: existing };
      }

      db.prepare(`
        UPDATE tphc_entries
           SET discarded_at=?, discard_reason=?
         WHERE id=?
      `).run(now, reason, id);

      const updated = db.prepare('SELECT * FROM tphc_entries WHERE id=?').get(id);

      postAuditEvent({
        entity: 'tphc_entries',
        entity_id: id,
        action: 'update',
        actor_cook_id: cook_id,
        actor_source: 'cook_ui',
        payload: updated,
        shift_date: existing.shift_date,
        location_id: existing.location_id,
        note: `discarded: ${reason}`,
      });

      return { status: 200, updated };
    });

    const result = performUpdate();
    if (result.status !== 200) {
      const { status, ...body } = result;
      return Response.json(body, { status });
    }
    return Response.json({ ok: true, entry: result.updated });
  } catch (err) {
    console.error('PATCH /api/tphc failed:', err);
    return Response.json({ error: 'Failed to discard TPHC batch' }, { status: 500 });
  }
}

// ── GET /api/tphc ─────────────────────────────────────────────────

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const location_id = locationFromRequest(req) || DEFAULT_LOCATION_ID;
    const now = url.searchParams.get('now') || new Date().toISOString();

    const db = getDb();
    const active = db.prepare(`
      SELECT * FROM tphc_entries
       WHERE location_id=? AND discarded_at IS NULL
       ORDER BY cutoff_at ASC, id ASC
    `).all(location_id);

    const scan = scanActiveTphc(active, now);
    return Response.json({
      location_id,
      now,
      active,
      scan,
      kinds: TPHC_KINDS,
      discard_reasons: TPHC_DISCARD_REASONS,
    });
  } catch (err) {
    console.error('GET /api/tphc failed:', err);
    return Response.json({ error: 'Failed to load TPHC batches' }, { status: 500 });
  }
}
