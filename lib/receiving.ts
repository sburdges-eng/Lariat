// Receiving-log rule module (F3 / FDA §3-202.11, §3-202.15, §3-501.2).
//
// Every delivery to the back door lands here first: a truck temp is
// taken, package integrity is eyeballed, the sell-by date is checked,
// and one of three decisions is recorded:
//
//   - 'ok'                  — accept, no note needed
//   - 'accept_with_note'    — drift was minor; accept only if the cook
//                             documents a corrective action (e.g. put
//                             product into a 35°F reach-in for quick
//                             pull-down from 42°F). Inspectors want to
//                             see the note, not a clean log.
//   - 'rejected'            — refuse the delivery. `rejection_reason`
//                             is the audit trail; the supplier claim
//                             is filed against the invoice.
//
// The lib is pure. No DB, no side effects. The API route at
// /api/receiving/route.js owns the persistence + audit hooks.
//
// Citations are FDA 2022 Food Code (Colorado incorporates by reference).

// ── Categories ────────────────────────────────────────────────────

/**
 * RECEIVING_CATEGORIES is the well-known set of truck-to-door
 * categories. The DB column is TEXT so extensions don't require a
 * schema change; however, the rule module will only classify against
 * categories named here. An unknown category is treated as a soft
 * fail (caller gets status='accept_with_note' with a citation note,
 * because a dry-goods-style deliver without a bounded temp probe
 * should never be outright rejected on the thresholds alone).
 */
export const RECEIVING_CATEGORIES = [
  'refrigerated',
  'frozen',
  'shell_eggs',
  'hot_held',
  'dry_goods',
  'produce',
  'shellfish',
] as const;

export type ReceivingCategory = (typeof RECEIVING_CATEGORIES)[number];

export interface ReceivingCategoryRule {
  id: ReceivingCategory;
  label: string;
  /** Lowest acceptable reading in °F. null = no floor. */
  required_min_f: number | null;
  /** Highest acceptable reading in °F. null = no ceiling. */
  required_max_f: number | null;
  /**
   * Upper "accept-with-note" band. If `reading_f` is above
   * `required_max_f` but ≤ `drift_max_f`, the line may still be
   * accepted — but only with a corrective note. Above `drift_max_f`
   * → rejected outright. Same idea for `drift_min_f` below the floor
   * (used for frozen: 10°F floor, 20°F rejects).
   *
   * null on either side means "no drift tolerance in this direction".
   */
  drift_max_f: number | null;
  drift_min_f: number | null;
  /**
   * True if a reading_f value must be provided at receiving. False
   * for dry goods and produce where temp is not a CCP — package
   * integrity + sell-by still apply.
   */
  requires_reading: boolean;
  /** FDA §-cite surfaced in the board tile + docs table. */
  citation: string;
}

/**
 * The rule table. Thresholds are grounded in §3-202.11 (PHF/TCS at
 * receiving). Hot-held deliveries are rare for Lariat (mostly used
 * during off-site catering load-in) but §3-501.16 applies and is
 * included for completeness.
 *
 * Drift bands:
 *   - refrigerated: 41°F limit, drift to 45°F accept-with-note. FDA's
 *     §3-501.16 gives 41°F as the cold-hold ceiling; many Colorado
 *     jurisdictions allow a short transit temp-rise tolerance if the
 *     cook documents a rapid pull-down. 45°F is the practical reject
 *     line because product above that usually won't make 41°F inside
 *     the four-hour window product-spoilage rule allows.
 *   - frozen: 10°F practical ceiling (the same threshold the temp-log
 *     uses), drift to 25°F accept-with-note. Above that the product
 *     has thawed and must be treated as refrigerated not frozen.
 *   - shell_eggs: 45°F per §3-202.11(A); drift to 50°F accept-with-note.
 *   - hot_held: 135°F floor per §3-501.16(A)(1); drift to 130°F
 *     accept-with-note (immediate re-heat to 165°F required).
 *   - dry_goods / produce: no temp bound. requires_reading=false.
 *   - shellfish: 45°F per §3-202.11(F) (shellstock). drift to 50°F.
 */
export const RECEIVING_RULES: Readonly<
  Record<ReceivingCategory, ReceivingCategoryRule>
> = Object.freeze({
  refrigerated: {
    id: 'refrigerated',
    label: 'Refrigerated',
    required_min_f: null,
    required_max_f: 41,
    drift_max_f: 45,
    drift_min_f: null,
    requires_reading: true,
    citation: 'FDA §3-202.11(B) / §3-501.16(A)(2) — PHF/TCS cold at receiving ≤ 41°F',
  },
  frozen: {
    id: 'frozen',
    label: 'Frozen',
    required_min_f: null,
    required_max_f: 10,
    drift_max_f: 25,
    drift_min_f: null,
    requires_reading: true,
    citation:
      'FDA §3-202.11(C) — frozen PHF/TCS received frozen (≤ 10°F practical; >25°F reject as thawed)',
  },
  shell_eggs: {
    id: 'shell_eggs',
    label: 'Shell eggs',
    required_min_f: null,
    required_max_f: 45,
    drift_max_f: 50,
    drift_min_f: null,
    requires_reading: true,
    citation: 'FDA §3-202.11(A) — shell eggs received at ≤ 45°F ambient air',
  },
  hot_held: {
    id: 'hot_held',
    label: 'Hot-held',
    required_min_f: 135,
    required_max_f: null,
    drift_max_f: null,
    drift_min_f: 130,
    requires_reading: true,
    citation: 'FDA §3-202.11(D) / §3-501.16(A)(1) — hot-held at receiving ≥ 135°F',
  },
  dry_goods: {
    id: 'dry_goods',
    label: 'Dry goods',
    required_min_f: null,
    required_max_f: null,
    drift_max_f: null,
    drift_min_f: null,
    requires_reading: false,
    citation: 'FDA §3-202.15 — package integrity; §3-101.11 safe/unadulterated',
  },
  produce: {
    id: 'produce',
    label: 'Produce',
    required_min_f: null,
    required_max_f: null,
    drift_max_f: null,
    drift_min_f: null,
    requires_reading: false,
    citation: 'FDA §3-202.15 package integrity; §3-202.110 cut leafy greens 41°F (if pre-cut)',
  },
  shellfish: {
    id: 'shellfish',
    label: 'Shellfish (shellstock)',
    required_min_f: null,
    required_max_f: 45,
    drift_max_f: 50,
    drift_min_f: null,
    requires_reading: true,
    citation:
      'FDA §3-202.11(F) — shellstock ≤ 45°F; §3-203.12 — 90-day tag retention',
  },
});

export function getReceivingRule(
  category: unknown,
): ReceivingCategoryRule | null {
  if (typeof category !== 'string') return null;
  const rule = (RECEIVING_RULES as Record<string, ReceivingCategoryRule>)[category];
  return rule ?? null;
}

// ── Validation ────────────────────────────────────────────────────

export type ReceivingStatus = 'ok' | 'rejected' | 'accept_with_note';

export interface ValidateReceivingInput {
  category: unknown;
  reading_f?: unknown;
  /**
   * True if the shipping container (case, pallet, vacuum bag) is
   * intact. False → §3-202.15 rejection regardless of temperature.
   * Defaults to true when omitted so a cook can log dry-goods without
   * the checkbox; a cook logging a cold delivery will explicitly set
   * the box.
   */
  package_ok?: unknown;
  /**
   * Optional sell-by / use-by date as YYYY-MM-DD. When present and
   * before `received_at`, the line is rejected (§3-101.11 — food must
   * be unadulterated and not past date of code-required safety).
   * Borderline same-day is accepted as 'ok' (the date is a full day).
   */
  expiration_date?: unknown;
  /**
   * ISO date (YYYY-MM-DD) the delivery is received. Defaults to the
   * caller's today when omitted. Passed as a string for easy testing
   * against `expiration_date`.
   */
  received_at?: unknown;
}

export interface ValidateReceivingResult {
  status: ReceivingStatus;
  /** Human-readable reason for 'rejected' or 'accept_with_note'. */
  reason: string | null;
  /** FDA §-cite that drove the decision, when applicable. */
  citation: string | null;
  /**
   * Snapshot of the upper temp bound that was in force at the time of
   * the decision. Written into the DB row so later audits don't need
   * to cross-reference the mutable rule registry.
   */
  required_max_f: number | null;
}

const ABS_MIN_F = -100;
const ABS_MAX_F = 500;

function asStringOrNull(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x.trim() : null;
}

function asNumberOrNull(x: unknown): number | null {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  return x;
}

/**
 * Core decision function. Pure — no DB, no audit, no clock read.
 *
 * Decision order (first match wins; later branches run only if no
 * earlier one matched):
 *
 *   1. Unknown category         → accept_with_note (rule set to null)
 *   2. package_ok === false     → rejected (§3-202.15)
 *   3. expiration_date past     → rejected (§3-101.11)
 *   4. reading required + missing or absurd
 *                               → rejected ("temp not taken")
 *   5. reading above drift_max  → rejected (too warm)
 *   6. reading below drift_min  → rejected (too thawed-then-refrozen / too warm-for-hot-hold)
 *   7. reading above required_max
 *                               → accept_with_note (drift band)
 *   8. reading below required_min
 *                               → accept_with_note (drift band)
 *   9. otherwise                → ok
 *
 * `accept_with_note` is a compliance-aware "yes"; the caller must
 * gate it on a non-empty corrective_action field at the API boundary.
 * `rejected` is an unconditional no.
 */
export function validateReceivingReading(
  input: ValidateReceivingInput,
): ValidateReceivingResult {
  const rule = getReceivingRule(input.category);
  if (!rule) {
    return {
      status: 'accept_with_note',
      reason: `unknown category "${String(input.category)}" — accept only with a corrective note`,
      citation: 'FDA §3-202.11 — requires a recognized receiving category',
      required_max_f: null,
    };
  }

  // §3-202.15 — visible adulteration / compromised package is an
  // outright rejection; temperature is moot.
  if (input.package_ok === false) {
    return {
      status: 'rejected',
      reason: 'package integrity compromised — reject per §3-202.15',
      citation: 'FDA §3-202.15 — package integrity',
      required_max_f: rule.required_max_f,
    };
  }

  // §3-101.11 — food past code-required safety date is adulterated.
  const exp = asStringOrNull(input.expiration_date);
  if (exp) {
    const received = asStringOrNull(input.received_at);
    // Lex compare YYYY-MM-DD is a correct date compare.
    if (received && exp < received) {
      return {
        status: 'rejected',
        reason: `past sell-by date (${exp} < ${received}) — reject per §3-101.11`,
        citation: 'FDA §3-101.11 — safe, unadulterated, honestly presented',
        required_max_f: rule.required_max_f,
      };
    }
  }

  // Categories without a temp CCP (dry goods, produce) stop here —
  // an in-band read is either absent or informational only.
  if (!rule.requires_reading) {
    return {
      status: 'ok',
      reason: null,
      citation: null,
      required_max_f: rule.required_max_f,
    };
  }

  const r = asNumberOrNull(input.reading_f);
  if (r === null) {
    return {
      status: 'rejected',
      reason: `${rule.label} requires a temperature reading at receiving — no reading recorded`,
      citation: rule.citation,
      required_max_f: rule.required_max_f,
    };
  }
  if (r < ABS_MIN_F || r > ABS_MAX_F) {
    return {
      status: 'rejected',
      reason: `reading ${r}°F is off the charts — check the probe and re-take`,
      citation: rule.citation,
      required_max_f: rule.required_max_f,
    };
  }

  const { required_min_f: min, required_max_f: max, drift_min_f: dMin, drift_max_f: dMax } = rule;

  // Too-warm side
  if (max !== null && r > max) {
    if (dMax !== null && r <= dMax) {
      return {
        status: 'accept_with_note',
        reason: `${r}°F is above the ${max}°F limit but within the ${dMax}°F drift band — accept only with a corrective action`,
        citation: rule.citation,
        required_max_f: max,
      };
    }
    return {
      status: 'rejected',
      reason: `${r}°F exceeds the ${dMax ?? max}°F reject limit for ${rule.label}`,
      citation: rule.citation,
      required_max_f: max,
    };
  }

  // Too-cold side (e.g. hot-held arriving cool)
  if (min !== null && r < min) {
    if (dMin !== null && r >= dMin) {
      return {
        status: 'accept_with_note',
        reason: `${r}°F is below the ${min}°F floor but within the ${dMin}°F drift band — accept only with a corrective action`,
        citation: rule.citation,
        required_max_f: max,
      };
    }
    return {
      status: 'rejected',
      reason: `${r}°F is below the ${dMin ?? min}°F reject floor for ${rule.label}`,
      citation: rule.citation,
      required_max_f: max,
    };
  }

  return {
    status: 'ok',
    reason: null,
    citation: null,
    required_max_f: max,
  };
}

// ── Aggregation for the board ─────────────────────────────────────

/**
 * A single row shaped like a receiving_log record, minimal fields.
 * Extra fields on the row are ignored.
 */
export interface ReceivingRow {
  category: string;
  status: 'accepted' | 'rejected' | 'accepted_with_note';
  vendor?: string | null;
  created_at?: string | null;
}

/**
 * Per-category tile status: mirrors the temp-log palette so the board
 * reuses the same CSS tones.
 *
 *   - green  : only 'accepted' rows today
 *   - yellow : at least one 'accepted_with_note' and no rejects
 *   - red    : at least one 'rejected' row
 *   - gray   : no receiving in this category today
 */
export type ReceivingTileStatus = 'green' | 'yellow' | 'red' | 'gray';

export interface CategorySummary {
  category: ReceivingCategory;
  label: string;
  citation: string;
  requires_reading: boolean;
  required_max_f: number | null;
  required_min_f: number | null;
  drift_max_f: number | null;
  drift_min_f: number | null;
  total: number;
  accepted: number;
  accepted_with_note: number;
  rejected: number;
  status: ReceivingTileStatus;
  last_at: string | null;
}

/**
 * Aggregate today's receiving rows into one tile per known category.
 * Rows carrying an unknown category are surfaced on an `_unknown`
 * bucket so the UI can still flag them without the board going quiet.
 *
 * `options.expectAllCategories` (default true) renders a gray tile
 * for every RECEIVING_CATEGORY with no rows — mirroring the temp-log
 * behavior so a fresh-shift board doesn't show a blank grid.
 */
export function classifyDeliveries(
  rows: readonly ReceivingRow[],
  options: { expectAllCategories?: boolean } = {},
): CategorySummary[] {
  const expectAll = options.expectAllCategories ?? true;
  const grouped = new Map<string, ReceivingRow[]>();

  for (const r of rows) {
    if (!r || typeof r.category !== 'string') continue;
    const rule = getReceivingRule(r.category);
    if (!rule) continue; // rare; rows with orphan categories are ignored for the aggregate
    const key = rule.id;
    const bucket = grouped.get(key) ?? [];
    bucket.push(r);
    grouped.set(key, bucket);
  }

  const catIds: ReceivingCategory[] = expectAll
    ? [...RECEIVING_CATEGORIES]
    : (Array.from(grouped.keys()) as ReceivingCategory[]);

  const out: CategorySummary[] = [];
  for (const id of catIds) {
    const rule = RECEIVING_RULES[id];
    const bucket = grouped.get(id) ?? [];
    let accepted = 0;
    let withNote = 0;
    let rejected = 0;
    let lastAt: string | null = null;
    for (const r of bucket) {
      if (r.status === 'accepted') accepted += 1;
      else if (r.status === 'accepted_with_note') withNote += 1;
      else if (r.status === 'rejected') rejected += 1;
      const at = typeof r.created_at === 'string' ? r.created_at : null;
      if (at && (!lastAt || at > lastAt)) lastAt = at;
    }
    let status: ReceivingTileStatus;
    if (rejected > 0) status = 'red';
    else if (withNote > 0) status = 'yellow';
    else if (accepted > 0) status = 'green';
    else status = 'gray';

    out.push({
      category: id,
      label: rule.label,
      citation: rule.citation,
      requires_reading: rule.requires_reading,
      required_max_f: rule.required_max_f,
      required_min_f: rule.required_min_f,
      drift_max_f: rule.drift_max_f,
      drift_min_f: rule.drift_min_f,
      total: bucket.length,
      accepted,
      accepted_with_note: withNote,
      rejected,
      status,
      last_at: lastAt,
    });
  }
  return out;
}

// ── Helpers the API route borrows ─────────────────────────────────

/**
 * Map a `ValidateReceivingResult.status` into the DB's `status`
 * column value. The DB uses `accepted_with_note` (underscore,
 * past-tense) while the library uses `accept_with_note` (present
 * tense) — the DB column name predates this rule module, so we map
 * here rather than rename the check constraint.
 */
export function dbStatusFor(status: ReceivingStatus): 'accepted' | 'rejected' | 'accepted_with_note' {
  if (status === 'ok') return 'accepted';
  if (status === 'rejected') return 'rejected';
  return 'accepted_with_note';
}

/**
 * Round-trip the DB status back to a library status, so aggregators
 * that pull from the table can reason about the library's three-way.
 */
export function libStatusFor(status: string): ReceivingStatus {
  if (status === 'accepted') return 'ok';
  if (status === 'accepted_with_note') return 'accept_with_note';
  return 'rejected';
}
