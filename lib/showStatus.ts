/**
 * Show-marketing status rule module.
 *
 * Single source of truth for: how a free-text status cell from Lauren's
 * xlsx renders as a color/label, and how a row's full status_json maps to
 * exactly one of the six pipeline stages.
 *
 * Design contract (Approach 1, Q4 in spec): unknown values render green
 * with their literal label (never red), so novel vocabulary doesn't break
 * the UI. Lauren is SoT.
 *
 * No I/O. No imports beyond types. Pure.
 */

export type StatusColor = 'green' | 'amber' | 'red' | 'neutral';

export interface StatusBadge {
  color: StatusColor;
  label: string;
}

export const KNOWN_STAGES = [
  'Inquiry',
  'Hold',
  'Offer Out',
  'Confirmed',
  'On Sale',
  'Settled',
] as const;
export type PipelineStage = (typeof KNOWN_STAGES)[number];

const AMBER_TOKENS = new Set(['pending', 'w', 'waiting', 'tentative']);
const GREEN_TOKENS = new Set(['y', 'yes', 'accepted', 'done', 'sent']);
const RED_TOKENS = new Set(['n', 'no']);
const NEUTRAL_TOKENS = new Set(['', '-', '–', '—', 'na', 'n/a']);

/**
 * Map a single status cell (raw xlsx string) to a color/label badge.
 * `column` is reserved for future column-specific rules (currently unused).
 */
export function statusColor(value: unknown, _column: string): StatusBadge {
  const raw = value == null ? '' : String(value).trim();
  const lower = raw.toLowerCase();

  if (NEUTRAL_TOKENS.has(lower)) return { color: 'neutral', label: '—' };
  if (RED_TOKENS.has(lower)) return { color: 'red', label: lower };
  if (AMBER_TOKENS.has(lower)) return { color: 'amber', label: lower };
  if (GREEN_TOKENS.has(lower)) return { color: 'green', label: lower };

  // Numeric strings ("6.0", "0", "12") → count semantics for posts/door_tix.
  const num = Number(raw);
  if (Number.isFinite(num)) {
    if (num <= 0) return { color: 'neutral', label: '—' };
    return { color: 'green', label: String(Math.round(num)) };
  }

  // Anything else: green-with-detail. Approach 1: never red on novelty.
  return { color: 'green', label: raw };
}

type StatusRow = Record<string, unknown>;

function isGreenish(v: unknown): boolean {
  const c = statusColor(v, '').color;
  return c === 'green';
}

/**
 * Map a row's full status_json to one pipeline stage. Exhaustive: every
 * input shape returns one of KNOWN_STAGES. Novel cell values never demote
 * the row below the stage it would have reached with `green`.
 *
 * Rule (top-down — first match wins):
 *   1. dice_email is greenish AND show is past → Settled
 *   2. create_dice_tickets is greenish → On Sale
 *   3. announce_date greenish AND any two of {meta_ads, fb_event, assets, posts} greenish → Confirmed
 *   4. announce_date greenish AND any one marketing field greenish → Offer Out
 *   5. announce_date greenish (alone) → Hold
 *   6. otherwise → Inquiry
 *
 * The "show is past" check in rule 1 is left to the caller (we don't
 * import a clock here); pass `showIsPast=true` from the repo when
 * `show_date < today()`.
 */
export function pipelineStage(
  row: StatusRow | null | undefined,
  showIsPast = false,
): PipelineStage {
  const r = row ?? {};
  if (showIsPast && isGreenish(r.dice_email)) return 'Settled';
  if (isGreenish(r.create_dice_tickets)) return 'On Sale';
  const announced = isGreenish(r.announce_date);
  if (announced) {
    const marketingHits = ['meta_ads', 'fb_event', 'assets', 'posts'].filter((k) =>
      isGreenish(r[k]),
    ).length;
    if (marketingHits >= 2) return 'Confirmed';
    if (marketingHits >= 1) return 'Offer Out';
    return 'Hold';
  }
  return 'Inquiry';
}
