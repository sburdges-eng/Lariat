// Wage notices (L7 / C.R.S. §8-4-103 + COMPS §3.3).
//
// POST /api/wage-notices   → register a new wage notice (PIN-gated)
// GET  /api/wage-notices   → latest per cook OR full history for one cook
//
// Notices are payroll-record-class (3-year retention under FLSA).
// Manager-PIN gate on writes; reads are open at the location level.

import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID, locationFromBody, locationFromRequest } from '../../../lib/location';
import { hasPinOrTempPin, pinRequiredForPic } from '../../../lib/pin';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';
import {
  validateNoticeShape,
  requiresNewNotice,
  summarizeFreshness,
} from '../../../lib/wageNotices';

export const dynamic = 'force-dynamic';

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

async function gate(req) {
  if (pinRequiredForPic() && !(await hasPinOrTempPin(req, 'pic.wage_notices'))) {
    return Response.json(
      { error: 'manager PIN required — wage notices are payroll records' },
      { status: 403 },
    );
  }
  return null;
}

// ── POST ─────────────────────────────────────────────────────────

export async function POST(req) {
  const blocked = await gate(req);
  if (blocked) return blocked;
  return withIdempotency(req, () => wageNoticesPostHandler(req));
}

async function wageNoticesPostHandler(req) {
  try {
    const body = await req.json();

    const cook_id = clip(body.cook_id, 64);
    if (!cook_id) {
      return Response.json({ error: 'cook_id is required' }, { status: 400 });
    }

    const reason = typeof body.reason === 'string' ? body.reason.trim() : null;
    const pay_basis = typeof body.pay_basis === 'string' ? body.pay_basis.trim() : null;

    // wage_rate_cents and tip_credit_cents must be integer cents.
    const rawWage = body.wage_rate_cents;
    const rawTip = body.tip_credit_cents == null ? null : body.tip_credit_cents;
    const signed_on = clip(body.signed_on, 10);
    const document_path = clip(body.document_path, 300);
    const location_id = locationFromBody(body);

    const shape = validateNoticeShape({
      reason,
      wage_rate_cents: rawWage,
      pay_basis,
      tip_credit_cents: rawTip,
      signed_on,
      document_path,
    });
    if (!shape.ok) {
      return Response.json({ error: shape.reason }, { status: 400 });
    }

    const db = getDb();

    const performWrite = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO wage_notices
          (location_id, cook_id, reason, wage_rate_cents, pay_basis, tip_credit_cents, document_path, signed_on)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        location_id,
        cook_id,
        reason,
        rawWage,
        pay_basis,
        rawTip,
        document_path,
        signed_on,
      );

      const row = db.prepare('SELECT * FROM wage_notices WHERE id=?').get(info.lastInsertRowid);

      postAuditEvent({
        entity: 'wage_notices',
        entity_id: Number(info.lastInsertRowid),
        action: 'insert',
        actor_cook_id: null,
        actor_source: 'pic_ui',
        payload: row,
        note: `${reason}:${pay_basis}`,
        location_id,
      });

      return row;
    });

    const row = performWrite();
    return Response.json({ ok: true, entry: row });
  } catch (err) {
    console.error('POST /api/wage-notices failed:', err);
    return Response.json({ error: 'Failed to save wage notice' }, { status: 500 });
  }
}

// ── GET ──────────────────────────────────────────────────────────

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const location_id = locationFromRequest(req) || DEFAULT_LOCATION_ID;
    const cook_id = url.searchParams.get('cook_id');
    const today = new Date().toISOString().slice(0, 10);

    const db = getDb();

    if (cook_id) {
      // Full history for one cook, latest first.
      const rows = db.prepare(`
        SELECT * FROM wage_notices
         WHERE location_id=? AND cook_id=?
         ORDER BY signed_on DESC, id DESC
      `).all(location_id, cook_id);
      const latest = rows[0] || null;
      const freshness = latest ? summarizeFreshness([latest], today)[0] : {
        cook_id,
        has_notice: false,
        signed_on: null,
        days_since: null,
        needs_new: true,
      };
      // Demonstrate the requiresNewNotice logic on a hypothetical
      // 'annual' refresh against the current state — UI uses this
      // to render the "Sign new notice" CTA without reproducing the
      // 365-day math.
      const refresh = requiresNewNotice({
        prev: latest,
        next: latest
          ? { ...latest, reason: 'annual', signed_on: today }
          : { reason: 'hire', wage_rate_cents: 0, pay_basis: 'hourly', tip_credit_cents: 0, signed_on: today },
        today,
      });
      return Response.json({ location_id, cook_id, latest, history: rows, freshness, refresh });
    }

    // Latest notice per cook for the location.
    const rows = db.prepare(`
      SELECT w.*
        FROM wage_notices w
        JOIN (
          SELECT cook_id, MAX(signed_on) AS latest
            FROM wage_notices
           WHERE location_id=?
           GROUP BY cook_id
        ) m ON m.cook_id = w.cook_id AND m.latest = w.signed_on
       WHERE w.location_id=?
       ORDER BY w.cook_id ASC, w.id DESC
    `).all(location_id, location_id);

    // Dedupe to one row per cook (in case of same-day duplicates,
    // pick the highest id).
    const byCook = new Map();
    for (const r of rows) {
      const prev = byCook.get(r.cook_id);
      if (!prev || prev.id < r.id) byCook.set(r.cook_id, r);
    }
    const latestPerCook = Array.from(byCook.values());

    const freshness = summarizeFreshness(latestPerCook, today);

    return Response.json({ location_id, latest_per_cook: latestPerCook, freshness });
  } catch (err) {
    console.error('GET /api/wage-notices failed:', err);
    return Response.json({ error: 'Failed to load wage notices' }, { status: 500 });
  }
}
