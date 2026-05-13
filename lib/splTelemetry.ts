/**
 * SPL telemetry — pure-rule helpers for the sound-engineer surface.
 *
 * The sound engineer logs dB readings during a show; the UI renders a
 * sparkline and threshold strip beside the autosaver. These helpers do
 * the math without I/O — they're consumed by `SparklineSpl.jsx` and the
 * API summary response. No imports beyond types.
 *
 * Conventions:
 *   - thresholds mirror the AttendanceStatus three-band shape
 *     (green/amber/red) so the UI can reuse the same color vars
 *   - sparklinePath() returns a single SVG `d` string for a polyline,
 *     plus a viewBox + peak index, so the renderer is one <path>
 *   - degenerate inputs (no readings, equal values) never throw —
 *     callers can render the sparkline unconditionally
 *
 * No external deps. The codebase ships no chart library; see
 * app/floor/FloorPlan.jsx for the prevailing inline-SVG idiom.
 */

export interface SplReading {
  id?: number;
  show_id?: number;
  location_id?: string;
  scene_id?: number | null;
  db_value: number;
  taken_at: string;             // ISO-ish timestamp; whatever SQLite emits
  taken_by_cook_id?: string | null;
  notes?: string | null;
}

export type SplStatus = 'green' | 'amber' | 'red' | 'unset';

export interface SplSummary {
  count: number;
  latest: number | null;
  peak: number | null;
  avg_last_n: number | null;
  over_limit_count: number;
  since: string | null;          // taken_at of the oldest reading in the slice
  limit_db: number | null;
}

/**
 * Roll up a chronologically-ordered batch of readings into a single
 * summary object. `limit` is the scene's spl_limit_db; when null the
 * over_limit_count is 0. Callers pass the same list they'll use to draw
 * the sparkline so the numbers line up.
 */
export function summarizeSpl(
  readings: SplReading[] | null | undefined,
  limit: number | null | undefined,
): SplSummary {
  const slice = Array.isArray(readings) ? readings.filter(isReading) : [];
  const lim = isFinitePositive(limit) ? Number(limit) : null;

  if (slice.length === 0) {
    return {
      count: 0,
      latest: null,
      peak: null,
      avg_last_n: null,
      over_limit_count: 0,
      since: null,
      limit_db: lim,
    };
  }

  let peak = -Infinity;
  let sum = 0;
  let over = 0;
  for (const r of slice) {
    const v = Number(r.db_value);
    if (v > peak) peak = v;
    sum += v;
    if (lim != null && v > lim) over += 1;
  }

  const first = slice[0]!;
  const last = slice[slice.length - 1]!;
  return {
    count: slice.length,
    latest: Number(last.db_value),
    peak,
    avg_last_n: round1(sum / slice.length),
    over_limit_count: over,
    since: first.taken_at ?? null,
    limit_db: lim,
  };
}

export interface SparklineOpts {
  width?: number;             // px; default 160
  height?: number;            // px; default 40
  padding?: number;           // px; default 2
  /** Floor of the y-axis (e.g. 60 dB). When unset, scales to the data. */
  yMin?: number;
  yMax?: number;
}

export interface SparklineResult {
  d: string;                  // SVG path data
  viewBox: string;            // "0 0 W H"
  width: number;
  height: number;
  peakIdx: number;            // index of the peak reading; -1 when empty
  /** Y coord of the threshold line when limit fits the y-range; null otherwise. */
  thresholdY: number | null;
  yMin: number;
  yMax: number;
}

/**
 * Build an SVG path for `readings`. Pure math, no DOM. The y-axis floors
 * to yMin/yMax options when given; otherwise it scales to data with a
 * 2 dB padding so a flat trace doesn't render as a zero-amplitude line.
 *
 * When `limit` is inside the y-range, `thresholdY` is the y-coord of
 * the dashed threshold line the renderer should draw.
 */
export function sparklinePath(
  readings: SplReading[] | null | undefined,
  limit: number | null | undefined,
  opts: SparklineOpts = {},
): SparklineResult {
  const width = isFinitePositive(opts.width) ? Number(opts.width) : 160;
  const height = isFinitePositive(opts.height) ? Number(opts.height) : 40;
  const pad = Math.max(0, opts.padding ?? 2);
  const slice = Array.isArray(readings) ? readings.filter(isReading) : [];

  if (slice.length === 0) {
    return {
      d: '',
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      peakIdx: -1,
      thresholdY: null,
      yMin: 0,
      yMax: 0,
    };
  }

  // Y range — explicit overrides win; otherwise scale to data with a
  // 2 dB pad so flat traces draw mid-canvas, not at the bottom edge.
  const values = slice.map((r) => Number(r.db_value));
  let yMin = Number.isFinite(Number(opts.yMin)) ? Number(opts.yMin) : Math.min(...values) - 2;
  let yMax = Number.isFinite(Number(opts.yMax)) ? Number(opts.yMax) : Math.max(...values) + 2;
  if (yMax - yMin < 1) {
    // Degenerate (all equal) — synthesize a 4 dB window centered on the value.
    const center = (yMax + yMin) / 2;
    yMin = center - 2;
    yMax = center + 2;
  }

  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);
  const range = yMax - yMin;

  let peakIdx = 0;
  let peakVal = -Infinity;
  let d = '';
  for (let i = 0; i < slice.length; i += 1) {
    const v = values[i] ?? 0;
    if (v > peakVal) {
      peakVal = v;
      peakIdx = i;
    }
    const x = slice.length === 1
      ? pad + innerW / 2
      : pad + (i / (slice.length - 1)) * innerW;
    const y = pad + innerH - ((v - yMin) / range) * innerH;
    d += `${i === 0 ? 'M' : 'L'}${round1(x)},${round1(y)}`;
  }

  const lim = isFinitePositive(limit) ? Number(limit) : null;
  const thresholdY = lim != null && lim >= yMin && lim <= yMax
    ? round1(pad + innerH - ((lim - yMin) / range) * innerH)
    : null;

  return {
    d,
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    peakIdx,
    thresholdY,
    yMin,
    yMax,
  };
}

/**
 * Map a single reading against a limit to one of the three threshold
 * bands. green <90% of limit, amber 90–100%, red >100%. Mirrors the
 * AttendanceStatus convention in lib/showsTonight.ts so the UI can
 * reuse --green / --yellow / --red CSS vars.
 */
export function splThresholdStatus(
  db_value: number | string | null | undefined,
  limit: number | string | null | undefined,
): SplStatus {
  if (db_value == null || db_value === '') return 'unset';
  const v = Number(db_value);
  if (!Number.isFinite(v)) return 'unset';
  const lim = limit == null || limit === '' ? NaN : Number(limit);
  if (!Number.isFinite(lim) || lim <= 0) return 'green';
  if (v > lim) return 'red';
  if (v >= lim * 0.9) return 'amber';
  return 'green';
}

function isFinitePositive(n: unknown): boolean {
  const num = Number(n);
  return Number.isFinite(num) && num > 0;
}

function isReading(r: unknown): r is SplReading {
  if (!r || typeof r !== 'object') return false;
  const v = (r as { db_value?: unknown }).db_value;
  return Number.isFinite(Number(v));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
