// @ts-check
import { hasPinCookie } from '../../../../lib/pin';
import { locationFromBodyOrRequest } from '../../../../lib/location';
import { withIdempotency } from '../../../../lib/idempotency';
import { undoKitchenAssistantAction } from '../../../../lib/kitchenAssistantUndo';

export const dynamic = 'force-dynamic';

/**
 * @param {unknown} value
 * @param {number} max
 * @returns {string | null}
 */
function clip(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * @param {Request} req
 * @returns {Promise<Response>}
 */
export async function POST(req) {
  return withIdempotency(req, () => kitchenAssistantUndoPostHandler(req));
}

/**
 * @param {Request} req
 * @returns {Promise<Response>}
 */
async function kitchenAssistantUndoPostHandler(req) {
  /** @type {Record<string, unknown>} */
  let body = {};
  try {
    body = /** @type {Record<string, unknown>} */ (await req.json());
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const hasPin = await hasPinCookie(req);
  if (!hasPin) {
    return Response.json({ error: 'Manager PIN required.' }, { status: 403 });
  }

  const undoAuditId = Number(body?.undo_audit_id);
  const locationId = locationFromBodyOrRequest(body, req);
  const cookId = clip(body?.cook_id, 64);
  const result = undoKitchenAssistantAction({
    auditEventId: undoAuditId,
    locationId,
    cookId,
  });

  if (!result.ok) {
    return Response.json({ error: result.error || 'Could not undo that action.' }, { status: result.status });
  }

  return Response.json({
    ok: true,
    message: result.message || 'Undid last action.',
    correctedAuditId: result.correctedAuditId,
  });
}
