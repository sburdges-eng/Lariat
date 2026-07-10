// KDS bump-back rule module (v2 protocol — Lariat-KDS/docs/lariat-kds-protocol.md §3).
//
// Pure module: validation, station-slug recognition, PIN hashing, and the
// canonical response shape. No I/O — the route owns the db.transaction.
// Per docs/PATTERNS.md §1 (HACCP rule-module shape), thresholds and
// citations live exactly once, here.
//
// The Swift parser at Lariat-KDS/Sources/LariatKDSCore/TicketParser.swift
// fails closed on any drift in the response shape; treat `BumpResponse`
// as the binding contract and do not change field names without updating
// the protocol doc first (Lariat-KDS/CLAUDE.md hard rule).

import { hashPinSecure } from './pinHash.ts';

/** Known station slugs from protocol §2. Unknown values are accepted —
 *  KDS renders them with the default chip — so this list is informational. */
export const KNOWN_STATIONS = ['grill', 'sides', 'bar'] as const;
export type KnownStation = (typeof KNOWN_STATIONS)[number];

/** Lowercased non-empty string. KDS protocol §2 normalizes to lowercase. */
export function isStationSlug(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s === s.toLowerCase();
}

/** Canonical ISO-8601 UTC: `YYYY-MM-DDTHH:mm:ss[.fff]Z`. Accepts both
 *  bare-seconds (protocol §3's own request example; the Swift client's
 *  default ISO8601DateFormatter never emits fractional seconds) and
 *  millisecond precision (Date.toISOString()'s own output, used for
 *  GET /api/kds/tickets' placed_at). Rejects any other separator or
 *  offset form (e.g. a space separator, or a non-Z offset). */
const ISO_8601_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

export function isIso8601Utc(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  if (!ISO_8601_UTC_RE.test(s)) return false;
  return Number.isFinite(Date.parse(s));
}

/** Salted PBKDF2 hash of the cook PIN (audit 2026-07-10 P0-3). bumped_pin_hash
 *  is write-only attribution — nothing reads or groups by it — so per-bump
 *  salting is safe and keeps a copied DB from yielding the raw cook PINs. The
 *  raw PIN is never stored; only this hash makes it to kds_ticket_states. */
export function hashPin(pin: string): string {
  return hashPinSecure(pin);
}

export interface BumpPayload {
  /** ISO-8601 UTC, or null to let the route stamp server-now. */
  bumped_at: string | null;
  /** Lowercased slug, or null if the KDS doesn't know. */
  station: string | null;
  /** Raw PIN (will be hashed before storage), or null for anonymous bumps. */
  cook_pin: string | null;
}

export type ValidationResult =
  | { ok: true; payload: BumpPayload }
  | { ok: false; error: string };

/**
 * Parse the POST body. All three fields are optional per protocol §3 —
 * a fully empty body is a valid bump (server stamps the time, station and
 * cook are recorded as unknown). Anything *present* must match the rules.
 *
 * The intent is to accept generously and reject loudly: a rogue field type
 * (e.g. `bumped_at: 1717000000`) is a 422, not a silent coercion. Cooks
 * tap fast; we want the KDS bug to surface to a developer, not a cook.
 */
export function validateBumpPayload(body: unknown): ValidationResult {
  if (body === null || body === undefined) {
    return { ok: true, payload: { bumped_at: null, station: null, cook_pin: null } };
  }
  if (typeof body !== 'object') {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;

  let bumped_at: string | null = null;
  if (b.bumped_at !== undefined && b.bumped_at !== null) {
    if (!isIso8601Utc(b.bumped_at)) {
      return { ok: false, error: 'bumped_at must be a canonical ISO-8601 UTC string' };
    }
    bumped_at = b.bumped_at as string;
  }

  let station: string | null = null;
  if (b.station !== undefined && b.station !== null) {
    if (!isStationSlug(b.station)) {
      return { ok: false, error: 'station must be a non-empty lowercased slug' };
    }
    station = b.station as string;
  }

  let cook_pin: string | null = null;
  if (b.cook_pin !== undefined && b.cook_pin !== null) {
    if (typeof b.cook_pin !== 'string' || b.cook_pin.length === 0) {
      return { ok: false, error: 'cook_pin must be a non-empty string when present' };
    }
    cook_pin = b.cook_pin;
  }

  return { ok: true, payload: { bumped_at, station, cook_pin } };
}

/** Wire-format response per protocol §3. The Swift parser pins these names. */
export interface BumpResponse {
  id: string;
  bumped_at: string;
}

/** Action the audit row should record for a bump.
 *  - 'insert' on the first bump for a ticket
 *  - 'correction' on a re-bump (cook tapped twice; kept-latest semantics) */
export type BumpAuditAction = 'insert' | 'correction';

export function bumpActionForExisting(existing: { bumped_at: string } | null | undefined): BumpAuditAction {
  return existing ? 'correction' : 'insert';
}
