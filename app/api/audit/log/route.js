import { getRecentAuditLog, getAuditLogByAction, getAuditLogForRecipe } from '../../../../lib/auditLog.mjs';
import { hasPinCookie, pinRequiredForPic } from '../../../../lib/pin';

// Force dynamic — the handler reads request.url and the audit JSONL
// from disk on every call, so static prerender at build time can't
// produce a useful response and surfaces a 500 in build logs.
export const dynamic = 'force-dynamic';

// GET /api/audit/log - retrieve audit logs (management only).
//
// Pre-fix this route did `pinOk?.value !== '1'`, which silently rejected
// the HMAC-signed cookie format (`v1.<base64>`) introduced in
// lib/pinCookie.ts. With LARIAT_PIN_SECRET configured every legitimate
// manager would 403 here. The fix uses the canonical hasPinCookie()
// helper from lib/pin.ts so legacy and signed cookies are both
// validated through the same path as middleware.js.

async function requirePin(req) {
  if (pinRequiredForPic() && !(await hasPinCookie(req))) {
    return Response.json(
      { error: 'Unauthorized. Management access required.' },
      { status: 401 },
    );
  }
  return null;
}

export async function GET(request) {
  const pinFail = await requirePin(request);
  if (pinFail) return pinFail;

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const slug = searchParams.get('slug');
    const limit = parseInt(searchParams.get('limit') || '100');

    let logs;

    if (action) {
      logs = getAuditLogByAction(action);
    } else if (slug) {
      logs = getAuditLogForRecipe(slug);
    } else {
      logs = getRecentAuditLog(limit);
    }

    return Response.json({
      success: true,
      count: logs.length,
      logs: logs.slice(0, limit),
    });
  } catch (error) {
    // Don't echo error.message to the caller — it can leak SQL, file
    // paths, or other internals. Server logs keep the detail; the
    // client gets a generic 500.
    console.error('GET /api/audit/log failed:', error);
    return Response.json(
      { error: 'Failed to retrieve audit logs' },
      { status: 500 }
    );
  }
}
