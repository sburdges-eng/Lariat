// 28-day COGS-variance trend reader.
//
// accounting_variance is written by the compute engine
// (lib/computeEngine/accountingVariance.ts). This module is a
// read-only consumer that pulls the most-recent N days for the
// /costing variance-trend tile. No I/O outside the SELECT.
//
// Color buckets reuse the T9 dashboard thresholds (< 2 / 2-5 / >= 5)
// so the tile reads consistently with the existing B1 tile.

import { getDb } from './db.ts';

export interface VarianceTrendPoint {
  periodStart: string;
  periodEnd: string;
  variancePct: number | null;
  varianceAmount: number | null;
  thresholdColor: 'green' | 'yellow' | 'red';
}

export interface VarianceTrend {
  points: VarianceTrendPoint[];
  pCurrent: number | null;
  pAverage: number | null;
  windowDays: number;
  rowsFound: number;
}

function colorFor(pct: number | null): 'green' | 'yellow' | 'red' {
  if (pct === null) return 'green';
  const abs = Math.abs(pct);
  if (abs >= 5) return 'red';
  if (abs >= 2) return 'yellow';
  return 'green';
}

export function getVarianceTrend(
  locationId: string,
  windowDays: number = 28,
): VarianceTrend {
  const db = getDb();

  // Window relative to the latest period_end in the table — picks up
  // "windowDays before the most recent run" rather than "windowDays
  // before today" so a stale DB still renders the most recent N days
  // of data.
  const latest = db
    .prepare(
      `SELECT MAX(period_end) AS latest FROM accounting_variance
       WHERE location_id = ?`,
    )
    .get(locationId) as { latest: string | null };
  if (!latest?.latest) {
    return {
      points: [],
      pCurrent: null,
      pAverage: null,
      windowDays,
      rowsFound: 0,
    };
  }

  const cutoff = new Date(latest.latest);
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
  const cutoffISO = cutoff.toISOString().slice(0, 10);

  const rows = db
    .prepare(
      `SELECT period_start, period_end, variance_amount, variance_pct
       FROM accounting_variance
       WHERE location_id = ? AND period_end >= ?
       ORDER BY period_end ASC`,
    )
    .all(locationId, cutoffISO) as {
    period_start: string;
    period_end: string;
    variance_amount: number | null;
    variance_pct: number | null;
  }[];

  const points: VarianceTrendPoint[] = rows.map((r) => ({
    periodStart: r.period_start,
    periodEnd: r.period_end,
    varianceAmount: r.variance_amount,
    variancePct: r.variance_pct,
    thresholdColor: colorFor(r.variance_pct),
  }));

  const numericPcts = points
    .map((p) => p.variancePct)
    .filter((x): x is number => x !== null);
  const pAverage =
    numericPcts.length === 0
      ? null
      : numericPcts.reduce((s, x) => s + x, 0) / numericPcts.length;
  const lastPoint = points.length > 0 ? points[points.length - 1] : undefined;
  const pCurrent = lastPoint ? lastPoint.variancePct : null;

  return {
    points,
    pCurrent,
    pAverage,
    windowDays,
    rowsFound: rows.length,
  };
}
