// Staff certifications (L3). CFPM, food-handler, TIPS, allergen.
//
// GET   /api/certifications            → list for a location (optional scope to one cook)
// POST  /api/certifications            → record a new cert (PIN-gated)
// PATCH /api/certifications            → update expiry / deactivate (PIN-gated)
//
// Writes are PIC-level because they gate scheduling — adding a fake
// CFPM record so an under-qualified cook can take lead is the obvious
// abuse here. Reads are open (anyone may see who has what).

import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID, locationFromBody, locationFromRequest } from '../../../lib/location';
import { hasPinCookie, pinRequiredForPic } from '../../../lib/pin';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';

export const dynamic = 'force-dynamic';

const CERT_TYPES = new Set(['cfpm', 'food_handler', 'tips', 'allergen', 'other']);

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

async function gate(req) {
  if (pinRequiredForPic() && !(await hasPinCookie(req))) {
    return Response.json(
      { error: 'manager PIN required — certifications are PIC authority' },
      { status: 403 },
    );
  }
  return null;
}

// ── GET ──────────────────────────────────────────────────────────

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const location_id = locationFromRequest(req) || DEFAULT_LOCATION_ID;
    const cook_id = url.searchParams.get('cook_id');

    const db = getDb();
    let sql = `SELECT * FROM staff_certifications WHERE location_id=?`;
    const args = [location_id];
    if (cook_id) {
      sql += ' AND cook_id=?';
      args.push(cook_id);
    }
    sql += ' ORDER BY active DESC, expires_on IS NULL, expires_on ASC, id ASC';
    const rows = db.prepare(sql).all(...args);
    return Response.json({ location_id, rows });
  } catch (err) {
    console.error('GET /api/certifications failed:', err);
    return Response.json({ error: 'Failed to load certifications' }, { status: 500 });
  }
}

// ── POST ─────────────────────────────────────────────────────────

export async function POST(req) {
  const blocked = await gate(req);
  if (blocked) return blocked;
  return withIdempotency(req, () => certificationsPostHandler(req));
}

async function certificationsPostHandler(req) {
  try {
    const body = await req.json();
    const cook_id = clip(body.cook_id, 64);
    if (!cook_id) return Response.json({ error: 'cook_id required' }, { status: 400 });
    const cert_type = clip(body.cert_type, 32);
    if (!cert_type || !CERT_TYPES.has(cert_type)) {
      return Response.json(
        { error: 'cert_type must be one of: cfpm, food_handler, tips, allergen, other' },
        { status: 400 },
      );
    }
    const cert_label = clip(body.cert_label, 120);
    if (!cert_label) {
      return Response.json({ error: 'cert_label required' }, { status: 400 });
    }
    const issuer = clip(body.issuer, 120);
    const cert_number = clip(body.cert_number, 120);
    const issued_on = clip(body.issued_on, 10);
    const expires_on = clip(body.expires_on, 10);
    const document_path = clip(body.document_path, 300);
    const location_id = locationFromBody(body);

    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (issued_on && !dateRe.test(issued_on)) {
      return Response.json({ error: 'issued_on must be YYYY-MM-DD' }, { status: 400 });
    }
    if (expires_on && !dateRe.test(expires_on)) {
      return Response.json({ error: 'expires_on must be YYYY-MM-DD' }, { status: 400 });
    }

    const db = getDb();
    const performWrite = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO staff_certifications
          (location_id, cook_id, cert_type, cert_label, issuer, cert_number,
           issued_on, expires_on, document_path, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        location_id,
        cook_id,
        cert_type,
        cert_label,
        issuer,
        cert_number,
        issued_on,
        expires_on,
        document_path,
      );
      
      const row = db.prepare('SELECT * FROM staff_certifications WHERE id=?').get(info.lastInsertRowid);
      
      postAuditEvent({
        entity: 'staff_certifications',
        entity_id: Number(info.lastInsertRowid),
        action: 'insert',
        actor_cook_id: null,
        actor_source: 'pic_ui',
        payload: row,
        location_id,
      });

      return row;
    });

    const row = performWrite();
    return Response.json({ ok: true, entry: row });
  } catch (err) {
    console.error('POST /api/certifications failed:', err);
    return Response.json({ error: 'Failed to record certification' }, { status: 500 });
  }
}

// ── PATCH ────────────────────────────────────────────────────────

export async function PATCH(req) {
  const blocked = await gate(req);
  if (blocked) return blocked;
  return withIdempotency(req, () => certificationsPatchHandler(req));
}

async function certificationsPatchHandler(req) {
  try {
    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      return Response.json({ error: 'id required' }, { status: 400 });
    }
    const db = getDb();
    const existing = db.prepare('SELECT * FROM staff_certifications WHERE id=?').get(id);
    if (!existing) {
      return Response.json({ error: 'unknown certification' }, { status: 404 });
    }
    // Patchable columns — nothing else.
    const cols = ['cert_label', 'issuer', 'cert_number', 'issued_on', 'expires_on', 'document_path'];
    const sets = [];
    const args = [];
    for (const c of cols) {
      if (c in body) {
        sets.push(`${c}=?`);
        args.push(clip(body[c], c === 'document_path' ? 300 : 120));
      }
    }
    if ('active' in body) {
      sets.push('active=?');
      args.push(body.active ? 1 : 0);
    }
    if (sets.length === 0) {
      return Response.json({ error: 'nothing to update' }, { status: 400 });
    }
    sets.push("updated_at=datetime('now')");
    args.push(id);
    const performUpdate = db.transaction(() => {
      db.prepare(`UPDATE staff_certifications SET ${sets.join(', ')} WHERE id=?`).run(...args);
      const updated = db.prepare('SELECT * FROM staff_certifications WHERE id=?').get(id);
      
      postAuditEvent({
        entity: 'staff_certifications',
        entity_id: id,
        action: 'update',
        actor_cook_id: null,
        actor_source: 'pic_ui',
        payload: updated,
        location_id: existing.location_id,
      });

      return updated;
    });

    const updated = performUpdate();
    return Response.json({ ok: true, entry: updated });
  } catch (err) {
    console.error('PATCH /api/certifications failed:', err);
    return Response.json({ error: 'Failed to update certification' }, { status: 500 });
  }
}
