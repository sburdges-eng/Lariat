// Temp PIN pure rule module — issuance, validation, scope checks.
//
// Per docs/superpowers/specs/2026-05-04-beo-fire-times.md.
// No I/O; route handlers and lib/pin.ts call these helpers and own the DB
// layer themselves. Raw PINs flow through `hashPin` once on issuance and
// once per `login` attempt and are never persisted.

import { createHash } from 'node:crypto';

export const PIN_MIN_LEN = 4;
export const PIN_MAX_LEN = 6;

/** Scopes a temp PIN can be issued with. Coarse string keys, not full RBAC.
 *  Add to this list when introducing a new gated surface; route handlers
 *  reference these by name. */
export const KNOWN_SCOPES = [
  'beo.fire_at_edit',     // course CRUD + line→course binding (BEO fire times)
  'event.box_office',     // door crew: walkup tickets + comp + scan
  'event.sound_config',   // sound engineer: scene save/edit during a show
  'event.stage_setup',    // stage tech: stage config + scene saves
  'menu.prep_history',    // line lead: read-only prep-history lookup
  'menu.specials_edit',   // sandbox specials: create/edit/delete saved specials
  'pic.sick_worker',      // PIC delegate: file/clear sick reports (history stays master-only)
  'pic.staff_certs',      // PIC delegate: record/update staff certs
] as const;
export type KnownScope = (typeof KNOWN_SCOPES)[number];

const KNOWN_SCOPE_SET = new Set<string>(KNOWN_SCOPES);

/** SHA-256(pin) as 64-char hex. Determinism + cheap; the raw PIN is never
 *  stored anywhere — only this hash makes it into temp_pins.pin_hash. */
export function hashPin(pin: string): string {
  return createHash('sha256').update(pin).digest('hex');
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/** PIN must be all digits, length in [PIN_MIN_LEN, PIN_MAX_LEN]. */
export function validatePinFormat(pin: unknown): ValidationResult {
  if (typeof pin !== 'string') return { ok: false, error: 'PIN must be a string' };
  if (pin.length < PIN_MIN_LEN) return { ok: false, error: `PIN too short (min ${PIN_MIN_LEN})` };
  if (pin.length > PIN_MAX_LEN) return { ok: false, error: `PIN too long (max ${PIN_MAX_LEN})` };
  if (!/^[0-9]+$/.test(pin)) return { ok: false, error: 'PIN must be digits only' };
  return { ok: true };
}

/** Fail-closed: any non-canonical or unparseable expires_at is treated as
 *  expired, so a corrupted DB row never grants authority. */
export function isExpired(expires_at: string, now: Date = new Date()): boolean {
  const ms = Date.parse(expires_at);
  if (!Number.isFinite(ms)) return true;
  return ms <= now.getTime();
}

export function parseScopes(scopes_json: string | null | undefined): string[] {
  if (!scopes_json) return [];
  try {
    const v = JSON.parse(scopes_json);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

/** Serialize a scope array to JSON for storage. Throws on unknown scopes —
 *  caller (the issue route) must validate inputs against KNOWN_SCOPES first;
 *  this is a defensive guard to keep junk out of the column. */
export function serializeScopes(scopes: readonly string[]): string {
  for (const s of scopes) {
    if (!KNOWN_SCOPE_SET.has(s)) {
      throw new Error(`unknown scope: ${s}`);
    }
  }
  return JSON.stringify([...scopes]);
}

export function hasScope(scopes: readonly string[], scope: string): boolean {
  return scopes.includes(scope);
}
