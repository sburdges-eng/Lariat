// Tonight · Live — pure-rule helpers for the single-pane live-show view.
//
// The shows table holds a row per show keyed on (location_id, show_date).
// "Tonight" is whichever row matches today in that location. The page
// composes stage_setups + sound_scenes + box_office_lines around that
// row; the helpers here keep the day-resolution + box-office aggregation
// outside the route so they're testable without spinning up the API.

export interface ShowRow {
  id: number;
  location_id: string;
  band_name: string;
  show_date: string;       // ISO YYYY-MM-DD
  price: number | null;
  door_tix: string | null;
  status_json: string;
}

export interface BoxOfficeLine {
  id: number;
  show_id: number;
  location_id: string;
  source: 'dice' | 'walkup' | 'comp' | 'will_call' | 'guestlist';
  ticket_class: string | null;
  qty: number;
  face_price: number | null;
  fees: number | null;
  external_ref: string | null;
  scanned_at: string | null;
  notes: string | null;
}

export interface BoxOfficeSummary {
  total_qty: number;
  scanned_qty: number;
  total_face_value: number;
  total_fees: number;
  total_revenue: number;     // face + fees
  by_source: Record<BoxOfficeLine['source'], { qty: number; revenue: number }>;
}

/**
 * Pick tonight's show from a location-scoped list. Sorted by `show_date`
 * is NOT assumed — callers can pass an unordered list and the helper
 * filters by exact match. Returns null when there's no show on the date.
 *
 * `today` must be an ISO date string (YYYY-MM-DD). The route should pass
 * the location's local date, not the server's UTC date, so a 1am
 * after-the-show check shows the right row (yesterday) rather than an
 * empty placeholder (today).
 */
export function resolveTonightShow(rows: ShowRow[], today: string): ShowRow | null {
  if (!rows || rows.length === 0) return null;
  for (const r of rows) {
    if (r.show_date === today) return r;
  }
  return null;
}

/**
 * Pick the show just before tonight's show in the same location, for the
 * "last show set our SPL benchmark / closed with X tickets" context strip.
 * Returns null when there's no prior show, or when no `tonight` is given
 * (in which case the most recent past show is returned anyway — useful
 * for "we're between shows" states).
 */
export function findPreviousShow(rows: ShowRow[], tonightDate: string | null): ShowRow | null {
  if (!rows || rows.length === 0) return null;
  const cutoff = tonightDate ?? '9999-12-31';
  let best: ShowRow | null = null;
  for (const r of rows) {
    if (r.show_date >= cutoff) continue;
    if (!best || r.show_date > best.show_date) best = r;
  }
  return best;
}

/**
 * Aggregate per-source totals + scanned-in count. Comp + guestlist rows
 * contribute to qty but should not inflate revenue (face_price is
 * typically 0 on those, but we don't assume — we just trust the row).
 * `scanned_qty` counts only lines with a non-null scanned_at, the door
 * truth.
 */
export function summarizeBoxOffice(lines: BoxOfficeLine[]): BoxOfficeSummary {
  const by_source: BoxOfficeSummary['by_source'] = {
    dice: { qty: 0, revenue: 0 },
    walkup: { qty: 0, revenue: 0 },
    comp: { qty: 0, revenue: 0 },
    will_call: { qty: 0, revenue: 0 },
    guestlist: { qty: 0, revenue: 0 },
  };
  let total_qty = 0;
  let scanned_qty = 0;
  let total_face = 0;
  let total_fees = 0;

  for (const l of lines || []) {
    const bucket = by_source[l.source];
    if (!bucket) continue; // unknown source — schema check should prevent
    const qty = Number(l.qty) || 0;
    const face = Number(l.face_price) || 0;
    const fees = Number(l.fees) || 0;
    const revenue = qty * face + fees;
    bucket.qty += qty;
    bucket.revenue += revenue;
    total_qty += qty;
    total_face += qty * face;
    total_fees += fees;
    if (l.scanned_at) scanned_qty += qty;
  }

  return {
    total_qty,
    scanned_qty,
    total_face_value: roundCents(total_face),
    total_fees: roundCents(total_fees),
    total_revenue: roundCents(total_face + total_fees),
    by_source: roundBuckets(by_source),
  };
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundBuckets(b: BoxOfficeSummary['by_source']): BoxOfficeSummary['by_source'] {
  const out = {} as BoxOfficeSummary['by_source'];
  for (const k of Object.keys(b) as Array<BoxOfficeLine['source']>) {
    out[k] = { qty: b[k].qty, revenue: roundCents(b[k].revenue) };
  }
  return out;
}

export type AttendanceStatus = 'unset' | 'under' | 'near' | 'at' | 'over';

export interface Attendance {
  scanned_qty: number;
  sold_qty: number;
  capacity: number | null;
  scanned_pct: number | null;   // 0-100+, null when capacity is unset
  sold_pct: number | null;
  status: AttendanceStatus;
}

/**
 * Compute attendance + status from the box-office summary and the venue's
 * configured capacity. status thresholds (against scanned_pct):
 *   under: < 50  · near: 50–79  · at: 80–100  · over: > 100
 * When `capacity` is null/0/non-numeric, status is 'unset' and percent
 * fields are null — the UI tile renders just the raw scanned count in
 * that case.
 *
 * scanned_qty is the door truth (people physically present). sold_qty
 * is the tickets-sold count, which the tile uses as a "still to arrive"
 * delta in the second line.
 */
export function computeAttendance(
  scanned_qty: number | null | undefined,
  sold_qty: number | null | undefined,
  capacity: number | null | undefined,
): Attendance {
  const scanned = Math.max(0, Number(scanned_qty) || 0);
  const sold = Math.max(0, Number(sold_qty) || 0);
  const capNum = Number(capacity);
  const cap = capacity == null || !Number.isFinite(capNum) || capNum <= 0
    ? null
    : Math.floor(capNum);

  if (cap == null) {
    return {
      scanned_qty: scanned,
      sold_qty: sold,
      capacity: null,
      scanned_pct: null,
      sold_pct: null,
      status: 'unset',
    };
  }

  const scannedPct = Math.round((scanned / cap) * 1000) / 10;  // 0.1% precision
  const soldPct = Math.round((sold / cap) * 1000) / 10;

  let status: AttendanceStatus;
  if (scannedPct > 100) status = 'over';
  else if (scannedPct >= 80) status = 'at';
  else if (scannedPct >= 50) status = 'near';
  else status = 'under';

  return {
    scanned_qty: scanned,
    sold_qty: sold,
    capacity: cap,
    scanned_pct: scannedPct,
    sold_pct: soldPct,
    status,
  };
}

/**
 * Parse status_json defensively. Show ingest writes arbitrary JSON; we
 * only read it. Returns an empty object on parse failure so callers can
 * dot-access without guarding.
 */
export function parseStatusJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Pick a human "doors open" time from status_json + price-class
 * defaults. Status JSON shape is owned by the shows-ingest pipeline,
 * which sometimes stores `doors`, `door_time`, `set1`, `set2`, `curfew`
 * fields. We do a best-effort lookup so the tile doesn't render "—" on
 * shows that DO have the data.
 */
export function pickShowTime(
  status: Record<string, unknown>,
  key: 'doors' | 'set1' | 'set2' | 'curfew' | 'door_time',
): string | null {
  const v = status[key];
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (key === 'doors') return pickShowTime(status, 'door_time');
  return null;
}

/**
 * Run-of-show entries come back from stage_setups.run_of_show_json. We
 * accept either an array of {time, label} or a flat array of strings,
 * normalizing to objects so the renderer is uniform.
 */
export interface RunOfShowEntry {
  time: string | null;
  label: string;
}

export function parseRunOfShow(raw: string | null | undefined): RunOfShowEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: RunOfShowEntry[] = [];
  for (const e of parsed) {
    if (typeof e === 'string') {
      const t = e.trim();
      if (t) out.push({ time: null, label: t });
    } else if (e && typeof e === 'object') {
      const obj = e as Record<string, unknown>;
      const label = typeof obj.label === 'string' ? obj.label : typeof obj.text === 'string' ? obj.text : null;
      if (!label) continue;
      const time =
        typeof obj.time === 'string'
          ? obj.time
          : typeof obj.at === 'string'
            ? obj.at
            : null;
      out.push({ time, label });
    }
  }
  return out;
}
