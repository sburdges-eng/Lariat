// BEO course pure rule module (T5).
//
// Spec: docs/superpowers/specs/2026-05-04-beo-fire-times.md.
// No I/O — the route handler owns the db.transaction. This file is the
// single place that decides what a valid course payload looks like and
// what the next sort_order should be for a given event.

const COURSE_LABEL_MAX = 80;
const NOTES_MAX = 2000;

/** Canonical ISO-8601 UTC: round-trips through Date.toISOString().
 *  Same strictness as the KDS protocol §2 / Swift parser convention. */
export function isIso8601Utc(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return false;
  return new Date(ms).toISOString() === s;
}

export interface CoursePayload {
  course_label: string;
  fire_at: string;       // canonical ISO-8601 UTC
  notes: string | null;
  sort_order: number | null;
}

export type ValidationResult =
  | { ok: true; payload: CoursePayload }
  | { ok: false; error: string };

/** Validate a POST/PATCH body for a beo_courses row. event_id and
 *  location_id are NOT checked here — they're route-level concerns. */
export function validateCoursePayload(body: unknown): ValidationResult {
  if (body === null || typeof body !== 'object') {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;

  const courseLabel = typeof b.course_label === 'string' ? b.course_label.trim() : '';
  if (!courseLabel) {
    return { ok: false, error: 'course_label required' };
  }
  if (courseLabel.length > COURSE_LABEL_MAX) {
    return { ok: false, error: `course_label too long (max ${COURSE_LABEL_MAX})` };
  }

  if (!isIso8601Utc(b.fire_at)) {
    return { ok: false, error: 'fire_at must be a canonical ISO-8601 UTC string' };
  }
  const fireAt = b.fire_at as string;

  let notes: string | null = null;
  if (b.notes !== undefined && b.notes !== null) {
    if (typeof b.notes !== 'string') {
      return { ok: false, error: 'notes must be a string when present' };
    }
    const t = b.notes.trim();
    if (t.length > NOTES_MAX) {
      return { ok: false, error: `notes too long (max ${NOTES_MAX})` };
    }
    notes = t || null;
  }

  let sortOrder: number | null = null;
  if (b.sort_order !== undefined && b.sort_order !== null) {
    const n = Number(b.sort_order);
    if (!Number.isInteger(n) || n < 0) {
      return { ok: false, error: 'sort_order must be a non-negative integer' };
    }
    sortOrder = n;
  }

  return {
    ok: true,
    payload: { course_label: courseLabel, fire_at: fireAt, notes, sort_order: sortOrder },
  };
}

/** Resolve sort_order when the caller doesn't supply one: append at the
 *  end of the event's existing courses. Returns 0 for a fresh event. */
export function nextSortOrder(existingMax: number | null | undefined): number {
  if (typeof existingMax !== 'number' || !Number.isFinite(existingMax)) return 0;
  return Math.max(0, existingMax) + 10;
}

/** Helper for the line-item PATCH path: course_id may be a number, null
 *  (clear binding), or absent (no change). Validates and normalizes. */
export type CourseIdPatch =
  | { kind: 'absent' }
  | { kind: 'clear' }
  | { kind: 'set'; course_id: number };

export function parseCourseIdPatch(body: Record<string, unknown> | null | undefined): CourseIdPatch {
  if (!body || !('course_id' in body)) return { kind: 'absent' };
  const v = body.course_id;
  if (v === null) return { kind: 'clear' };
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('course_id must be a positive integer or null');
  }
  return { kind: 'set', course_id: n };
}
