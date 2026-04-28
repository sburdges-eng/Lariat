import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { triggerComputeEngine } from '@/lib/computeEngine/index';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get('location') || 'default';

  try {
    const db = getDb();
    
    // Get latest accounting variance snapshot
    const latestVariance = db.prepare(`
      SELECT theoretical_cogs, actual_cogs, variance_amount, variance_pct, snapshot_at
      FROM accounting_variance
      WHERE location_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(locationId);

    // Get latest margin snapshots
    const marginSnapshots = db.prepare(`
      SELECT item_name, margin_pct, quadrant, snapshot_at
      FROM margin_snapshots
      WHERE location_id = ?
      ORDER BY id DESC LIMIT 10
    `).all(locationId);

    return NextResponse.json({
      status: 'ok',
      engine: 'online',
      data: {
        latestVariance,
        marginSnapshots
      }
    });
  } catch (error) {
    console.error('Compute Status Error:', error);
    return NextResponse.json({ status: 'error', message: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get('location') || 'default';
  const periodStart = searchParams.get('period_start') || undefined;
  const periodEnd = searchParams.get('period_end') || undefined;

  // triggerComputeEngine is synchronous (better-sqlite3). Defer via
  // setImmediate so the response flushes first; microtask chaining
  // (`Promise.resolve().then`) runs BEFORE response flush and would
  // block the response on the SQL work. See docs/PATTERNS.md §9.
  setImmediate(() => {
    try {
      triggerComputeEngine(locationId, {
        period_start: periodStart,
        period_end: periodEnd,
      });
    } catch (err) {
      console.error('Compute Engine Trigger Error:', err);
    }
  });

  return NextResponse.json({
    status: 'ok',
    message: 'Compute Engine triggered',
    location_id: locationId,
  });
}
