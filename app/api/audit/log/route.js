import { cookies } from 'next/headers';
import { getRecentAuditLog, getAuditLogByAction, getAuditLogForRecipe } from '../../../../lib/auditLog.mjs';

// GET /api/audit/log - retrieve audit logs (management only)
export async function GET(request) {
  // Verify management role via the PIN cookie (same gate as
  // middleware.js uses for other sensitive surfaces). One cookie,
  // one source of truth.
  const cookieStore = await cookies();
  const pinOk = cookieStore.get('lariat_pin_ok');

  if (pinOk?.value !== '1') {
    return Response.json(
      { error: 'Unauthorized. Management access required.' },
      { status: 403 }
    );
  }

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
    return Response.json(
      { error: `Failed to retrieve audit logs: ${error.message}` },
      { status: 500 }
    );
  }
}
