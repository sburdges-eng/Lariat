import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { requirePin } from '../../../lib/pin';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  try {
    const u = new URL(req.url);
    const loc = u.searchParams.get('location') || DEFAULT_LOCATION_ID;
    const db = getDb();

    const salesTotal = db
      .prepare(`SELECT SUM(net_sales) as rev, SUM(quantity_sold) as qty FROM sales_lines WHERE location_id = ?`)
      .get(loc);
    const topItems = db
      .prepare(
        `SELECT item_name, SUM(quantity_sold) as qty, SUM(net_sales) as rev FROM sales_lines WHERE location_id = ? GROUP BY item_name ORDER BY rev DESC LIMIT 15`
      )
      .all(loc);
    const spend = db.prepare(`SELECT month, shamrock_total_spend FROM spend_monthly WHERE location_id = ? ORDER BY month`).all(loc);

    return Response.json({
      location_id: loc,
      sales: { total_revenue: salesTotal?.rev ?? null, total_qty: salesTotal?.qty ?? null },
      top_items: topItems,
      monthly_spend: spend,
    });
  } catch (err) {
    console.error('GET /api/analytics failed:', err);
    return Response.json({ error: 'Failed to load analytics' }, { status: 500 });
  }
}
