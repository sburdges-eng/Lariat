// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { getDb } from '../../../../../../lib/db';
import { postAuditEvent } from '../../../../../../lib/auditEvents';
import { withIdempotency } from '../../../../../../lib/idempotency';
import {
  isValidShareTokenShape,
  sanitizeSignedName,
  clipUserAgent,
  extractClientIp,
} from '../../../../../../lib/beoShare';

export const dynamic = 'force-dynamic';

/** @typedef {{ params: Promise<{ token?: string }> | { token?: string } }} RouteCtx */

// PUBLIC route. The guest with the share URL signs the BEO doc.
// Recording is append-only (mirrors audit_events) — multiple signers
// (e.g. event planner + venue contact) all leave separate rows.
//
// Audit event runs inside the same db.transaction as the INSERT so a
// signature row can never exist without a matching audit_events row.

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
export async function POST(req, ctx) {
  return withIdempotency(req, () => handler(req, ctx));
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
async function handler(req, ctx) {
  const params = await ctx?.params;
  const token = params?.token;
  if (!isValidShareTokenShape(token)) {
    return Response.json({ error: 'invalid token' }, { status: 404 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const signedName = sanitizeSignedName(body?.signed_name);
  if (!signedName) {
    return Response.json({ error: 'signed_name required' }, { status: 400 });
  }

  const db = getDb();
  const event = /** @type {{ id: number, location_id: string } | undefined} */ (db
    .prepare(
      `SELECT id, location_id
         FROM beo_events
        WHERE share_token = ?
          AND share_revoked_at IS NULL
          AND (share_expires_at IS NULL OR datetime(share_expires_at) > datetime('now'))`,
    )
    .get(token));
  if (!event) return Response.json({ error: 'not found' }, { status: 404 });

  const ipAddr = extractClientIp(req);
  const userAgent = clipUserAgent(req.headers.get('user-agent'));

  let signatureId;
  try {
    signatureId = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO beo_signatures (event_id, location_id, signed_name, ip_addr, user_agent)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(event.id, event.location_id, signedName, ipAddr, userAgent);
      const newId = Number(info.lastInsertRowid);
      postAuditEvent({
        entity: 'beo_signature',
        entity_id: newId,
        action: 'insert',
        actor_cook_id: null,
        actor_source: 'beo_client_share',
        location_id: event.location_id,
        payload: { signed_name: signedName, ip_addr: ipAddr },
        note: 'client signature on BEO share link',
      });
      return newId;
    })();
  } catch (err) {
    console.error('POST /api/beo/share/[token]/sign failed:', err);
    return Response.json({ error: 'failed to record signature' }, { status: 500 });
  }

  return Response.json({ signature_id: signatureId, signed_name: signedName });
}
