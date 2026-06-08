import { getDeadLetter, type DeadLetterBatch } from './cloudBridgeQueue';
import { locationFromRequest } from './location';

export function parseDeadLetterId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export type ScopedDeadLetterTarget =
  | { ok: true; id: number; before: DeadLetterBatch }
  | { ok: false; response: Response };

/**
 * Shared route-side guard for DLQ mutation handlers.
 *
 * Contract:
 * - bad/non-positive ids -> 400
 * - unknown/alive ids -> 404
 * - cross-location guessed ids -> 404 (not 403) to avoid existence leak
 *
 * Mutation semantics (requeue/drop), audit behavior, idempotency wrapping,
 * and success response shaping stay in the route handlers.
 */
export function loadScopedDeadLetterTarget(
  req: Request,
  rawId: unknown,
): ScopedDeadLetterTarget {
  const id = parseDeadLetterId(rawId);
  if (id === null) {
    return {
      ok: false,
      response: Response.json({ error: 'Bad id' }, { status: 400 }),
    };
  }

  const before = getDeadLetter(id);
  if (!before) {
    return {
      ok: false,
      response: Response.json({ error: 'Not found' }, { status: 404 }),
    };
  }

  const callerLocation = locationFromRequest(req);
  if (before.locationId !== callerLocation) {
    return {
      ok: false,
      response: Response.json({ error: 'Not found' }, { status: 404 }),
    };
  }

  return { ok: true, id, before };
}
