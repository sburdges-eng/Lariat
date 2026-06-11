import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';
import { requirePin } from '../../../lib/pin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const rows = db.prepare(`SELECT id, name, created_at FROM locations ORDER BY id`).all();
  return Response.json(rows);
}

// Seed or rename the venue location (first-run setup, roadmap 3.4).
// Single-venue v2: the common path is renaming the auto-seeded
// 'default' row to the real venue name. An explicit `id` creates or
// renames that row instead. Upsert + audit inside one transaction.
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** @param {Request} req */
export async function POST(req) {
  return withIdempotency(req, () => locationsPostHandler(req));
}

/** @param {Request} req */
async function locationsPostHandler(req) {
  try {
    const pinFail = await requirePin(req);
    if (pinFail) return pinFail;

    let body;
    try {
      body = await req.clone().json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : '';
    if (!name) return Response.json({ error: 'name required' }, { status: 400 });

    const rawId = body?.id != null ? String(body.id).trim() : '';
    const id = rawId || DEFAULT_LOCATION_ID;
    if (!ID_PATTERN.test(id)) {
      return Response.json(
        { error: 'id must be 1–64 chars [a-z0-9_-], starting with a letter or digit' },
        { status: 400 },
      );
    }

    const db = getDb();
    const result = db.transaction(() => {
      const existing = /** @type {{ id: string, name: string } | undefined} */ (
        db.prepare(`SELECT id, name FROM locations WHERE id = ?`).get(id)
      );
      if (existing) {
        db.prepare(`UPDATE locations SET name = ? WHERE id = ?`).run(name, id);
      } else {
        db.prepare(`INSERT INTO locations (id, name) VALUES (?, ?)`).run(id, name);
      }
      postAuditEvent({
        entity: 'locations',
        entity_id: null,
        action: existing ? 'update' : 'insert',
        actor_cook_id: null,
        actor_source: 'api',
        location_id: id,
        payload: { id, name, previous_name: existing ? existing.name : null },
      });
      return { created: !existing };
    })();

    return Response.json({ ok: true, id, name, created: result.created });
  } catch (err) {
    console.error('POST /api/locations failed:', err);
    return Response.json({ error: 'Failed to save location' }, { status: 500 });
  }
}
