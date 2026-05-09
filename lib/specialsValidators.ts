// Pure validators for the specials persistence layer. No I/O, no DB,
// no HTTP — every consumer is responsible for surfacing the error
// shape it needs.

export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

const NAME_MIN = 1;
const NAME_MAX = 200;
const SLUG_RE = /^[a-z0-9-]+$/;
const SLUG_MAX = 80;
const YIELD_UNIT_MAX = 32;

const ALLOWED_PATCH_KEYS = new Set(['name', 'scratch_notes']);

// Length caps on user-editable text fields, applied at the route layer
// before INSERT / UPDATE. Operator-generous bounds — clipping prevents
// runaway disk usage from pasted-in essays without surfacing an error
// in the kitchen UI. ai_answer is intentionally NOT capped here: the
// LLM occasionally produces several KB of markdown for complex specials,
// and clipping mid-response would corrupt the recipe / cost breakdown.
// Audit reference: docs/audit/2026-05-08-codebase-audit.md §5.
export const SCRATCH_NOTES_MAX = 4000;
export const PANTRY_TEXT_MAX = 4000;
export const PROMPT_TEXT_MAX = 2000;

export function clipText(input: unknown, max: number): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  return input.length <= max ? input : input.slice(0, max);
}

export function validateName(input: unknown): Result<string> {
  if (typeof input !== 'string') return { ok: false, error: 'name must be a string' };
  const trimmed = input.trim();
  if (trimmed.length < NAME_MIN) return { ok: false, error: 'name required' };
  if (trimmed.length > NAME_MAX) return { ok: false, error: `name max ${NAME_MAX} chars` };
  return { ok: true, value: trimmed };
}

export function validateSlug(input: unknown): Result<string> {
  if (typeof input !== 'string') return { ok: false, error: 'slug must be a string' };
  if (input.length < 1 || input.length > SLUG_MAX) {
    return { ok: false, error: `slug 1–${SLUG_MAX} chars` };
  }
  if (!SLUG_RE.test(input)) return { ok: false, error: 'slug must match ^[a-z0-9-]+$' };
  return { ok: true, value: input };
}

export function validateYieldQty(input: unknown): Result<number> {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return { ok: false, error: 'yield_qty must be a positive finite number' };
  }
  return { ok: true, value: input };
}

export function validateYieldUnit(input: unknown): Result<string> {
  if (typeof input !== 'string') return { ok: false, error: 'yield_unit must be a string' };
  const trimmed = input.trim();
  if (trimmed.length < 1) return { ok: false, error: 'yield_unit required' };
  if (trimmed.length > YIELD_UNIT_MAX) {
    return { ok: false, error: `yield_unit max ${YIELD_UNIT_MAX} chars` };
  }
  return { ok: true, value: trimmed };
}

export type PatchKeyResult = { ok: true; rejected: [] } | { ok: false; rejected: string[] };

export function validatePatchKeys(body: Record<string, unknown>): PatchKeyResult {
  const keys = Object.keys(body);
  if (keys.length === 0) return { ok: false, rejected: [] };
  const rejected = keys.filter((k) => !ALLOWED_PATCH_KEYS.has(k));
  if (rejected.length > 0) return { ok: false, rejected };
  return { ok: true, rejected: [] };
}

export function coerceJsonField(input: unknown): Result<string | null> {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input === 'string') {
    try {
      JSON.parse(input);
      return { ok: true, value: input };
    } catch {
      return { ok: false, error: 'not valid JSON' };
    }
  }
  if (typeof input === 'object') {
    try {
      return { ok: true, value: JSON.stringify(input) };
    } catch {
      return { ok: false, error: 'not serializable' };
    }
  }
  return { ok: false, error: 'must be JSON string, object, or null' };
}
