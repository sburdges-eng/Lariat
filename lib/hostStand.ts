// Host Stand — pure rule helpers for the FOH waitlist surface.
//
// Operational data, no regulated state. The actual DB writes live in
// the route handlers; this module is the no-I/O contract layer that
// the LaRi prediction builder + the UI render path both consume.

export type WaitlistStatus = 'waiting' | 'seated' | 'left';

export interface WaitlistPartyRow {
  id: number;
  location_id: string;
  party_name: string;
  party_size: number;
  joined_at: string;        // ISO datetime
  status: WaitlistStatus;
  seated_at: string | null;
  left_at: string | null;
  phone: string | null;
  notes: string | null;
}

export const MAX_PARTY_NAME_LENGTH = 80;
export const MAX_PHONE_LENGTH = 32;
export const MAX_NOTES_LENGTH = 500;
export const MAX_PARTY_SIZE = 200;

export interface SanitizedWaitlistInput {
  party_name: string;
  party_size: number;
  phone: string | null;
  notes: string | null;
}

/**
 * Defensively coerce a host-supplied party payload. Returns null when
 * required fields are missing/malformed; caller (route handler) maps
 * null → 400. Truncates over-long strings rather than rejecting them
 * since host stand is a fast-typing surface and a few errant chars
 * shouldn't block a seating.
 */
export function sanitizeWaitlistInput(raw: unknown): SanitizedWaitlistInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const nameRaw = typeof r.party_name === 'string' ? r.party_name.trim() : '';
  if (!nameRaw) return null;
  const party_name = nameRaw.slice(0, MAX_PARTY_NAME_LENGTH);

  const sizeNum = Number(r.party_size);
  if (!Number.isFinite(sizeNum) || sizeNum <= 0) return null;
  const party_size = Math.min(Math.floor(sizeNum), MAX_PARTY_SIZE);

  let phone: string | null = null;
  if (typeof r.phone === 'string') {
    const p = r.phone.trim();
    phone = p ? p.slice(0, MAX_PHONE_LENGTH) : null;
  }

  let notes: string | null = null;
  if (typeof r.notes === 'string') {
    const n = r.notes.trim();
    notes = n ? n.slice(0, MAX_NOTES_LENGTH) : null;
  }

  return { party_name, party_size, phone, notes };
}

const VALID_STATUS_TRANSITIONS: Record<WaitlistStatus, readonly WaitlistStatus[]> = {
  waiting: ['seated', 'left'],
  seated: [],   // terminal
  left: [],     // terminal
};

/**
 * Validate a requested status transition. waiting → seated|left is
 * legal; everything else returns false. Routes use this to reject
 * client mistakes (double-seat, undo a left, etc.) without trusting
 * the client's view of state.
 */
export function isValidStatusTransition(
  current: WaitlistStatus,
  next: WaitlistStatus,
): boolean {
  if (!VALID_STATUS_TRANSITIONS[current]) return false;
  return VALID_STATUS_TRANSITIONS[current].includes(next);
}

export interface WaitlistSummary {
  total: number;
  waiting: number;
  seated_today: number;
  left_today: number;
  avg_wait_minutes: number | null;     // for seated parties today
  longest_wait_minutes: number | null; // longest currently-waiting party
  longest_wait_party_id: number | null;
}

/**
 * Roll up a waitlist for the day. `nowIso` lets tests time-shift —
 * production callers pass `new Date().toISOString()`. Returns nulls
 * for derived stats when the underlying set is empty.
 */
export function summarizeWaitlist(
  parties: readonly WaitlistPartyRow[],
  nowIso: string,
): WaitlistSummary {
  if (!Array.isArray(parties)) {
    return {
      total: 0,
      waiting: 0,
      seated_today: 0,
      left_today: 0,
      avg_wait_minutes: null,
      longest_wait_minutes: null,
      longest_wait_party_id: null,
    };
  }
  const dayPrefix = nowIso.slice(0, 10);   // YYYY-MM-DD

  let waiting = 0;
  let seated_today = 0;
  let left_today = 0;
  let waitSum = 0;
  let waitCount = 0;
  let longest = 0;
  let longestId: number | null = null;

  for (const p of parties) {
    if (p.status === 'waiting') {
      waiting += 1;
      const wait = minutesBetween(p.joined_at, nowIso);
      if (wait > longest) {
        longest = wait;
        longestId = p.id;
      }
    } else if (p.status === 'seated') {
      if (p.seated_at && p.seated_at.startsWith(dayPrefix)) {
        seated_today += 1;
        const wait = minutesBetween(p.joined_at, p.seated_at);
        if (Number.isFinite(wait) && wait >= 0) {
          waitSum += wait;
          waitCount += 1;
        }
      }
    } else if (p.status === 'left') {
      if (p.left_at && p.left_at.startsWith(dayPrefix)) {
        left_today += 1;
      }
    }
  }

  return {
    total: parties.length,
    waiting,
    seated_today,
    left_today,
    avg_wait_minutes: waitCount > 0 ? Math.round(waitSum / waitCount) : null,
    longest_wait_minutes: waiting > 0 ? longest : null,
    longest_wait_party_id: longestId,
  };
}

/**
 * Minutes between two ISO timestamps. Floors to whole minutes. Returns
 * 0 (not negative) when end < start — host workflow doesn't have a
 * meaningful "negative wait" case.
 */
export function minutesBetween(startIso: string, endIso: string): number {
  const a = Date.parse(startIso);
  const b = Date.parse(endIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 60_000));
}
