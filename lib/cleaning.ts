// Cleaning-log validation (paired with POST /api/cleaning).
//
// The route accepts either `item` OR `task` (they fall back to each
// other) as the identifier of what was cleaned. Everything else is
// optional with sane defaults applied by the route. So validation
// here pins exactly the contract the route relies on:
//
//   1. At least one of `item` or `task` must be a non-empty string.
//   2. If `notes` is present, it must be a string (empty-string OK;
//      the route trims + clips downstream).
//
// Keep the surface minimal — the SQLite NOT NULL / CHECK constraints
// and the route's clip() helpers catch anything else.

export interface CleaningLogInput {
  item?: unknown;
  task?: unknown;
  schedule_id?: unknown;
  area?: unknown;
  completed_at?: unknown;
  cook_id?: unknown;
  verified_by_cook_id?: unknown;
  notes?: unknown;
  done?: unknown;
}

function isNonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

export function validateCleaningLog(
  input: CleaningLogInput,
): { ok: boolean; reason?: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: 'body must be an object' };
  }
  if (!isNonEmptyString(input.item) && !isNonEmptyString(input.task)) {
    return { ok: false, reason: 'item or task is required' };
  }
  if (input.notes !== undefined && input.notes !== null && typeof input.notes !== 'string') {
    return { ok: false, reason: 'notes must be a string' };
  }
  return { ok: true };
}
