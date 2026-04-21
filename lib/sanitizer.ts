// Sanitizer concentration validation (F4 / FDA §4-703.11).
//
// Three-compartment sinks, wiping-cloth buckets, and warewasher final
// rinses all have chemistry-specific ppm bands that the line must hit
// or the surface is NOT actually sanitized. We encode those bands
// here — once — so the API route and any future UI share the same
// truth. The underlying standards are in the 2022 FDA Food Code,
// Colorado incorporates by reference (6 CCR 1010-2 §3-101).
//
// Chlorine acceptable concentration depends on water temperature; at
// colder wash water you need more ppm to get the same kill. We keep a
// simple two-band approximation here (≥75°F vs <75°F) — labels on
// commercial sanitizers follow the same break. A full lookup against
// pH / chemistry would be over-engineering for a cook on the line.

export const CHEMISTRIES = ['chlorine', 'quat', 'iodine', 'other'] as const;
export type Chemistry = (typeof CHEMISTRIES)[number];

export interface ConcentrationBand {
  min_ppm: number;
  max_ppm: number;
  /** Human-readable label for the "why" shown to the cook if out of range. */
  label: string;
}

/**
 * Band selector for a given chemistry + water temperature. Returns the
 * acceptable ppm range per FDA §4-703.11.
 *
 * - Chlorine: 50–100 ppm at ≥75°F; 75–100 ppm below that. (Manufacturer
 *   labels sometimes allow down to 25 ppm at hotter temps — we use the
 *   FDA minimum, not the label minimum, because this log is for the
 *   inspector and the inspector works off the Code.)
 * - Quaternary ammonia: 150–400 ppm per label, kept generic here. Labels
 *   vary, but 200 ppm is the Code's inspection target so that's the
 *   middle of our window.
 * - Iodine: 12.5–25 ppm.
 * - Other: NULL band — we store the reading but don't classify.
 */
export function bandFor(
  chemistry: Chemistry,
  water_temp_f: number | null,
): ConcentrationBand | null {
  if (chemistry === 'chlorine') {
    const hot = water_temp_f !== null && water_temp_f >= 75;
    if (hot) {
      return { min_ppm: 50, max_ppm: 100, label: 'chlorine @≥75°F' };
    }
    return { min_ppm: 75, max_ppm: 100, label: 'chlorine @<75°F' };
  }
  if (chemistry === 'quat') {
    return { min_ppm: 150, max_ppm: 400, label: 'quaternary ammonia' };
  }
  if (chemistry === 'iodine') {
    return { min_ppm: 12.5, max_ppm: 25, label: 'iodine' };
  }
  return null; // 'other' — can't classify
}

// ── Validation ────────────────────────────────────────────────────

export type ValidateResult =
  | { ok: true }
  | { ok: false; reason: string };

// Probes that read outside this window are lying. Real sanitizer test
// strips top out around 500 ppm; a "1500 ppm" reading is always a
// misread or a wrong probe, not a real event.
const ABSOLUTE_MIN_PPM = 0;
const ABSOLUTE_MAX_PPM = 1000;

export interface SanitizerCheckInput {
  chemistry: unknown;
  concentration_ppm: unknown;
  water_temp_f?: unknown;
  point_label: unknown;
}

export function validateSanitizerCheck(x: SanitizerCheckInput): ValidateResult {
  if (!CHEMISTRIES.includes(x.chemistry as Chemistry)) {
    return {
      ok: false,
      reason: `chemistry must be one of: ${CHEMISTRIES.join(', ')}`,
    };
  }
  const c = x.concentration_ppm;
  if (typeof c !== 'number' || !Number.isFinite(c)) {
    return { ok: false, reason: 'concentration_ppm must be a number' };
  }
  if (c < ABSOLUTE_MIN_PPM || c > ABSOLUTE_MAX_PPM) {
    return {
      ok: false,
      reason: `concentration ${c} ppm is off the charts — re-test with a fresh strip`,
    };
  }
  const label = typeof x.point_label === 'string' ? x.point_label.trim() : '';
  if (!label) {
    return {
      ok: false,
      reason: 'point_label is required (e.g. "dish pit final rinse", "wiping bucket — grill")',
    };
  }
  const wt = x.water_temp_f;
  if (wt !== null && wt !== undefined) {
    if (typeof wt !== 'number' || !Number.isFinite(wt)) {
      return { ok: false, reason: 'water_temp_f must be a number or omitted' };
    }
    if (wt < -20 || wt > 220) {
      return { ok: false, reason: `water_temp_f ${wt}°F is out of plausible range` };
    }
  }
  return { ok: true };
}

// ── Classification ────────────────────────────────────────────────

export type SanitizerStatus = 'ok' | 'low' | 'high';

export interface ClassifyResult {
  status: SanitizerStatus;
  band: ConcentrationBand | null;
  required_min_ppm: number | null;
  required_max_ppm: number | null;
  breach_reason: string | null;
}

/**
 * Classify a validated reading as ok / low / high. "other" chemistry
 * always returns ok — we record the reading but can't judge it.
 */
export function classifySanitizer(
  chemistry: Chemistry,
  concentration_ppm: number,
  water_temp_f: number | null,
): ClassifyResult {
  const band = bandFor(chemistry, water_temp_f);
  if (!band) {
    return {
      status: 'ok',
      band: null,
      required_min_ppm: null,
      required_max_ppm: null,
      breach_reason: null,
    };
  }
  if (concentration_ppm < band.min_ppm) {
    return {
      status: 'low',
      band,
      required_min_ppm: band.min_ppm,
      required_max_ppm: band.max_ppm,
      breach_reason: `${band.label} read ${concentration_ppm} ppm (min ${band.min_ppm})`,
    };
  }
  if (concentration_ppm > band.max_ppm) {
    return {
      status: 'high',
      band,
      required_min_ppm: band.min_ppm,
      required_max_ppm: band.max_ppm,
      breach_reason: `${band.label} read ${concentration_ppm} ppm (max ${band.max_ppm})`,
    };
  }
  return {
    status: 'ok',
    band,
    required_min_ppm: band.min_ppm,
    required_max_ppm: band.max_ppm,
    breach_reason: null,
  };
}

/**
 * Well-known default check points. Kitchens vary, but these are the
 * surfaces FDA and CO inspectors expect evidence for on every shift.
 */
export const DEFAULT_POINTS = [
  { id: 'dish_final_rinse', label: 'Dish pit final rinse', chemistry: 'chlorine' as Chemistry },
  { id: 'wiping_bucket_line', label: 'Wiping bucket — line', chemistry: 'quat' as Chemistry },
  { id: 'wiping_bucket_grill', label: 'Wiping bucket — grill', chemistry: 'quat' as Chemistry },
  { id: 'three_comp_sink', label: 'Three-comp sink', chemistry: 'quat' as Chemistry },
] as const;
