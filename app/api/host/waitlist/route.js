import { getDb } from '../../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../../lib/location';
import { requirePin } from '../../../../lib/pin';
import { withIdempotency } from '../../../../lib/idempotency';
import { logAuditAction } from '../../../../lib/auditLog.mjs';
import { sanitizeWaitlistInput, summarizeWaitlist } from '../../../../lib/hostStand';

export const dynamic = 'force-dynamic';

// Host Stand waitlist endpoint.
//
// GET  — list active + today's seated/left + summary. Used by the
//        host page on mount and on poll.
// POST — add a new waiting party. PIN-gated, idempotent. Logs a
//        file-stream audit row (operational data, not regulated cash
//        custody / HACCP).

export async function GET(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;

  try {
    const u = new URL(req.url);
    const loc = u.searchParams.get('location') || DEFAULT_LOCATION_ID;
    const db = getDb();
    const todayPrefix = new Date().toISOString().slice(0, 10);

    const parties = db
      .prepare(
        `SELECT id, location_id, party_name, party_size, joined_at, status,
                seated_at, left_at, phone, notes
           FROM waitlist_parties
          WHERE location_id = ?
            AND (status = 'waiting'
                 OR (status = 'seated' AND substr(seated_at, 1, 10) = ?)
                 OR (status = 'left'   AND substr(left_at,   1, 10) = ?))
          ORDER BY joined_at`,
      )
      .all(loc, todayPrefix, todayPrefix);

    const nowIso = new Date().toISOString();
    const summary = summarizeWaitlist(parties, nowIso);

    return Response.json({ location_id: loc, parties, summary });
  } catch (err) {
    console.error('GET /api/host/waitlist failed:', err);
    return Response.json({ error: 'Failed to load waitlist' }, { status: 500 });
  }
}

export async function POST(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  return withIdempotency(req, () => waitlistPostHandler(req));
}

async function waitlistPostHandler(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const clean = sanitizeWaitlistInput(body);
  if (!clean) {
    return Response.json(
      { error: 'party_name and party_size (>0) required' },
      { status: 400 },
    );
  }

  const loc =
    typeof body?.location_id === 'string' && body.location_id.trim()
      ? body.location_id.trim()
      : DEFAULT_LOCATION_ID;

  try {
    const db = getDb();
    const id = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO waitlist_parties (location_id, party_name, party_size, phone, notes)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(loc, clean.party_name, clean.party_size, clean.phone, clean.notes);
      const newId = Number(info.lastInsertRowid);
      logAuditAction({
        action: 'waitlist_add',
        waitlist_party_id: newId,
        location_id: loc,
        party_name: clean.party_name,
        party_size: clean.party_size,
      });
      return newId;
    })();

    const row = db
      .prepare(
        `SELECT id, location_id, party_name, party_size, joined_at, status,
                seated_at, left_at, phone, notes
           FROM waitlist_parties WHERE id = ?`,
      )
      .get(id);

    return Response.json({ party: row }, { status: 201 });
  } catch (err) {
    console.error('POST /api/host/waitlist failed:', err);
    return Response.json({ error: 'Failed to add party' }, { status: 500 });
  }
}
