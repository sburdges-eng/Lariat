// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/**
 * /api/peers/sync-since — Ed25519-signed cross-host sync window.
 *
 * GET ?peer_id=<callerKey>&from_op=<rowid>&limit=<n>
 *
 * Headers (all three REQUIRED — no PIN cookie, no master-PIN env override):
 *   X-Lariat-Peer-Pubkey  — raw 32-byte Ed25519 pubkey, hex (64 chars)
 *   X-Lariat-Timestamp    — ISO 8601 timestamp, within ±60s of server clock
 *   X-Lariat-Signature    — ed25519(method+pathname+query+timestamp), hex
 *
 * Auth flow:
 *   1. Validate header shape (presence, hex shape, parseable timestamp).
 *   2. Reject if timestamp falls outside the clock-skew window.
 *   3. Look up the pubkey in peer_trust — reject if absent or revoked.
 *   4. Verify the signature over the canonical signing payload (see
 *      lib/peerTrust.ts::canonicalSigningPayload).
 *   5. Touch peer_trust.last_seen_at (audit trail) — separate from auth.
 *   6. Return replaySince(peerId, fromRowId, limit) result.
 *
 * Every failure returns 401 with a generic body — we deliberately don't
 * surface which check failed to avoid handing a probe an oracle.
 */

import { getDb } from '../../../../lib/db';
import { replaySince } from '../../../../lib/syncFeed';
import { authenticateSyncRequest, touchPeerLastSeen } from '../../../../lib/peerTrust';

export const dynamic = 'force-dynamic';

function parseFromOp(raw) {
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

function parseLimit(raw) {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.floor(n);
}

export async function GET(req) {
  const url = new URL(req.url);
  const db = getDb();

  const auth = authenticateSyncRequest(
    db,
    'GET',
    url.pathname,
    url.search.startsWith('?') ? url.search.slice(1) : url.search,
    {
      pubkeyHex: req.headers.get('x-lariat-peer-pubkey'),
      timestampIso: req.headers.get('x-lariat-timestamp'),
      signatureHex: req.headers.get('x-lariat-signature'),
    },
  );
  if (!auth.ok) {
    return Response.json({ error: 'unauthorized' }, { status: auth.status });
  }

  // Authentication succeeded — record contact for the audit trail.
  // Done outside the auth path so a clock-skew rejection or revoked-peer
  // probe doesn't update last_seen.
  try {
    touchPeerLastSeen(db, auth.peer.pubkey_hex);
  } catch {
    // Non-fatal — the audit-trail touch should never block a valid request.
  }

  const peerId = url.searchParams.get('peer_id');
  if (!peerId || !peerId.trim()) {
    return Response.json({ error: 'peer_id required' }, { status: 400 });
  }

  const fromOp = parseFromOp(url.searchParams.get('from_op'));
  if (fromOp === null) {
    return Response.json({ error: 'from_op must be a non-negative integer' }, { status: 400 });
  }
  const limit = parseLimit(url.searchParams.get('limit'));

  try {
    const page = replaySince(peerId.trim(), fromOp, limit);
    return Response.json({
      peer_id: peerId.trim(),
      from_op: fromOp,
      ops: page.ops,
      next_op: page.nextOp,
      caller_fingerprint: auth.peer.fingerprint,
    });
  } catch (err) {
    console.error('GET /api/peers/sync-since failed:', err);
    return Response.json({ error: 'Failed to load sync window' }, { status: 500 });
  }
}
