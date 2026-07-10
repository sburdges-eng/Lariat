// @ts-check
// POST /api/auth/temp-pin/issue — mint a scoped, time-boxed temp PIN.
//
// Spec: docs/superpowers/specs/2026-05-04-beo-fire-times.md.
//
// Master-PIN gated: only a manager who already holds lariat_pin_ok can
// hand out temp PINs. The raw PIN is returned in the response ONCE; the
// DB only ever stores SHA-256(pin). If the cook loses the PIN, revoke
// and reissue — there is no recovery.
//
// Not wrapped in withIdempotency: the response body contains the raw
// PIN, and a 24h cache of that secret in idempotency_keys is unaccept-
// able (audit 2026-05-08, Tier-1 HIGH #2). The route is manager-
// triggered from the management UI — there is no SW-replay path that
// would re-fire it — and the handler's own collision-retry loop
// (MAX_COLLISION_RETRIES) covers transient INSERT failures. Allow-
// listed in tests/js/test-idempotency-coverage.mjs.

import { randomInt } from 'node:crypto';
import { json } from '../../../../../lib/routeHelpers';
import { getDb } from '../../../../../lib/db';
import { requirePin } from '../../../../../lib/pin';
import { postAuditEvent } from '../../../../../lib/auditEvents';
import { locationFromBody } from '../../../../../lib/location';
import {
  validatePinFormat,
  serializeScopes,
  KNOWN_SCOPES,
  PIN_MIN_LEN,
  PIN_MAX_LEN,
} from '../../../../../lib/tempPin';
import { hashPinSecure, verifyPin } from '../../../../../lib/pinHash';

export const dynamic = 'force-dynamic';

const MAX_LABEL = 200;
const MAX_COLLISION_RETRIES = 5;

/**
 * @param {unknown} s
 * @param {number} max
 * @returns {string | null}
 */
const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

/**
 * True if `pin` is already the code of an ACTIVE (non-revoked, unexpired) temp
 * PIN in any location. Scan-verify replaces the old DB UNIQUE(pin_hash) check,
 * which salted hashes defeat. Active temp PIN count is small (they expire in
 * hours), so the linear scan is cheap.
 * @param {import('better-sqlite3').Database} db
 * @param {string} pin
 */
function activeCodeInUse(db, pin) {
  const rows = /** @type {{ pin_hash: string }[]} */ (db
    .prepare(
      `SELECT pin_hash FROM temp_pins
        WHERE revoked_at IS NULL
          AND datetime(expires_at) > datetime('now')`,
    )
    .all());
  return rows.some((r) => verifyPin(pin, r.pin_hash));
}

/** @param {number} length */
function generatePin(length) {
  // randomInt(min, max) is exclusive of max. We pad to ensure leading
  // zeros are preserved — '0042' is a valid PIN, not '42'.
  const max = 10 ** length;
  return String(randomInt(0, max)).padStart(length, '0');
}

/**
 * @param {unknown} s
 * @returns {boolean}
 */
function isCanonicalIso(s) {
  if (typeof s !== 'string') return false;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return false;
  return new Date(ms).toISOString() === s;
}

/** @param {Request} req */
export async function POST(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  return issueHandler(req);
}

/** @param {Request} req */
async function issueHandler(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body is not valid JSON' }, { status: 422 });
  }

  const label = clip(body?.label, MAX_LABEL);
  if (!label) return json({ error: 'label required' }, { status: 422 });

  const expiresAt = body?.expires_at;
  if (!isCanonicalIso(expiresAt)) {
    return json(
      { error: 'expires_at must be canonical ISO-8601 UTC' },
      { status: 422 },
    );
  }
  if (Date.parse(expiresAt) <= Date.now()) {
    return json({ error: 'expires_at must be in the future' }, { status: 422 });
  }

  const scopes = Array.isArray(body?.scopes) ? body.scopes : [];
  if (scopes.length === 0) {
    return json({ error: 'scopes required (at least one)' }, { status: 422 });
  }
  for (const s of scopes) {
    if (typeof s !== 'string' || !(/** @type {readonly string[]} */ (KNOWN_SCOPES)).includes(s)) {
      return json({ error: `unknown scope: ${s}` }, { status: 422 });
    }
  }

  const pinLength = (() => {
    const n = Number(body?.pin_length);
    if (!Number.isInteger(n)) return PIN_MIN_LEN; // default = 4
    if (n < PIN_MIN_LEN || n > PIN_MAX_LEN) return PIN_MIN_LEN;
    return n;
  })();

  const location = locationFromBody(body);
  const scopesJson = serializeScopes(scopes);
  const db = getDb();

  // Generate a PIN that doesn't collide with an existing active row.
  // 4-digit PIN, ~50 active = collision odds 0.5% — retry handles it.
  // Salted PBKDF2 hashes are all distinct, so the DB UNIQUE(pin_hash) index
  // can no longer detect a duplicate PIN *code*; scan active rows and verify
  // instead, to keep login unambiguous (audit 2026-07-10 P0-3).
  let pin = '';
  let id = 0;
  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    pin = generatePin(pinLength);
    const fmt = validatePinFormat(pin);
    if (!fmt.ok) continue;
    if (activeCodeInUse(db, pin)) continue;
    const pinHash = hashPinSecure(pin);
    try {
      const result = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO temp_pins (location_id, pin_hash, label, scopes_json, expires_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(location, pinHash, label, scopesJson, expiresAt);
        const newId = Number(info.lastInsertRowid);
        postAuditEvent({
          entity: 'temp_pin',
          entity_id: newId,
          action: 'insert',
          actor_cook_id: null,
          actor_source: 'manager_ui',
          location_id: location,
          payload: { label, expires_at: expiresAt, scopes },
        });
        return newId;
      })();
      id = result;
      break;
    } catch (err) {
      // Backstop only: the scan above already rejects duplicate codes; this
      // catches an astronomically-unlikely salted-hash collision on the
      // still-present UNIQUE(pin_hash) index — pick a new PIN and retry.
      if (String(err).includes('UNIQUE') && attempt < MAX_COLLISION_RETRIES - 1) {
        continue;
      }
      console.error('issue temp PIN failed:', err);
      return json({ error: 'could not issue PIN' }, { status: 500 });
    }
  }

  if (id === 0) {
    return json({ error: 'could not find a free PIN; try again' }, { status: 503 });
  }

  return json(
    { id, pin, label, scopes, expires_at: expiresAt },
    { status: 200 },
  );
}
