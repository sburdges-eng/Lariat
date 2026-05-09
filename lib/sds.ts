// SDS-registry validation (paired with POST /api/sds).
//
// Safety Data Sheets (formerly MSDS) are required by OSHA's Hazard
// Communication Standard (29 CFR 1910.1200) — the kitchen must keep
// a current SDS for every chemical product on site, accessible to
// workers during their shift. The registry table backs the printable
// binder + the digital-access UI an inspector can pull up at the door.
//
// `sds_registry.product_name` is NOT NULL in the schema; everything
// else is optional. The route still feeds clip()-ed input, but the
// validator now type-checks each field, range-checks length against
// the route's clip() limits (so a 400 surfaces instead of a silent
// truncate), enforces the GHS hazard-class enum (HCS 2012 Annex 1),
// and validates last_reviewed as an ISO date so an inspector's date
// math against the §1910.1200(g)(2)(i) "current" requirement is sound.
//
// Pure module: no I/O, no DB, no clock read.

// ── Citations (single source of truth) ────────────────────────────

/** OSHA HazCom — the SDS regulation itself. */
export const SDS_CITATION =
  'OSHA 29 CFR 1910.1200 — Hazard Communication Standard (HCS 2012, GHS-aligned)';

/** §1910.1200(g) — employer must maintain SDSes for each hazardous
 *  chemical and ensure they are readily accessible to employees in
 *  their work area during each work shift. */
export const SDS_RETENTION_CITATION =
  'OSHA 29 CFR 1910.1200(g) — SDS for each hazardous chemical, accessible to employees on every shift';

// ── GHS hazard-class enum (HCS 2012 Annex 1) ──────────────────────

/**
 * Container-label hazard class. Collapsed to the inspector-facing top
 * level used on Lariat's printed binder index (the SDS itself carries
 * the full GHS category number, e.g. "Flammable liquid, Cat 3"). We
 * accept lowercase or initial-capped on input and canonicalize to
 * lowercase in the normalized value.
 *
 * Source: HCS 2012 / GHS Rev 9 — pictogram → class mapping. "irritant"
 * covers GHS Health Hazard pictogram (exclamation mark) and "toxic"
 * covers the skull-and-crossbones; we keep them split because the
 * binder shelf labels them separately.
 */
export const GHS_HAZARD_CLASSES = [
  'flammable',
  'oxidizer',
  'corrosive',
  'toxic',
  'irritant',
  'health_hazard',     // carcinogen / mutagen / reproductive toxin
  'environmental',
  'compressed_gas',
  'explosive',
] as const;
export type GhsHazardClass = (typeof GHS_HAZARD_CLASSES)[number];

const GHS_HAZARD_SET = new Set<string>(GHS_HAZARD_CLASSES);

// ── Field-length bounds (mirror the route's clip() limits) ────────

export const PRODUCT_NAME_MAX_LEN = 200;
export const MANUFACTURER_MAX_LEN = 200;
export const HAZARD_CLASS_MAX_LEN = 100;
export const STORAGE_LOCATION_MAX_LEN = 200;
export const PDF_PATH_MAX_LEN = 300;
export const URL_MAX_LEN = 300;
export const COOK_ID_MAX_LEN = 64;
export const LAST_REVIEWED_MAX_LEN = 32;

// ── Public input + output shapes ──────────────────────────────────

export interface SdsInput {
  product_name?: unknown;
  manufacturer?: unknown;
  hazard_class?: unknown;
  storage_location?: unknown;
  pdf_path?: unknown;
  url?: unknown;
  last_reviewed?: unknown;
  active?: unknown;
  cook_id?: unknown;
  location_id?: unknown;
}

/**
 * Normalized snapshot the route may use directly. All strings trimmed;
 * absent optional fields are `null`. `hazard_class` is canonicalized
 * to its lowercase enum value when present.
 */
export interface NormalizedSds {
  product_name: string;
  manufacturer: string | null;
  hazard_class: GhsHazardClass | null;
  storage_location: string | null;
  pdf_path: string | null;
  url: string | null;
  last_reviewed: string | null;
  active: 0 | 1 | null;
  cook_id: string | null;
}

export type ValidateResult =
  | { ok: true; value: NormalizedSds }
  | { ok: false; reason: string };

// ── Helpers ───────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HTTP_URL_RE = /^https?:\/\//i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v)
  );
}

function checkOptionalString(
  v: unknown,
  field: string,
  maxLen: number,
): { ok: true; value: string | null } | { ok: false; reason: string } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== 'string') {
    return { ok: false, reason: `${field} must be a string` };
  }
  if (v.length > maxLen) {
    return {
      ok: false,
      reason: `${field} length ${v.length} exceeds the ${maxLen}-char limit`,
    };
  }
  const trimmed = v.trim();
  return { ok: true, value: trimmed.length === 0 ? null : trimmed };
}

// ── Validator ─────────────────────────────────────────────────────

export function validateSds(input: unknown): ValidateResult {
  if (!isPlainObject(input)) {
    return { ok: false, reason: 'body must be an object' };
  }
  const body = input as SdsInput;

  // 1. product_name — required, non-empty, length-bounded.
  if (typeof body.product_name !== 'string') {
    return { ok: false, reason: 'product_name is required' };
  }
  if (body.product_name.length > PRODUCT_NAME_MAX_LEN) {
    return {
      ok: false,
      reason: `product_name length ${body.product_name.length} exceeds the ${PRODUCT_NAME_MAX_LEN}-char limit`,
    };
  }
  const productNameValue = body.product_name.trim();
  if (productNameValue.length === 0) {
    return { ok: false, reason: 'product_name is required' };
  }

  // 2. manufacturer — optional string.
  const mfr = checkOptionalString(body.manufacturer, 'manufacturer', MANUFACTURER_MAX_LEN);
  if (!mfr.ok) return mfr;

  // 3. hazard_class — optional, must be in the GHS enum (case-insensitive).
  let hazardClassValue: GhsHazardClass | null = null;
  if (body.hazard_class !== undefined && body.hazard_class !== null) {
    if (typeof body.hazard_class !== 'string') {
      return { ok: false, reason: 'hazard_class must be a string' };
    }
    if (body.hazard_class.length > HAZARD_CLASS_MAX_LEN) {
      return {
        ok: false,
        reason: `hazard_class length ${body.hazard_class.length} exceeds the ${HAZARD_CLASS_MAX_LEN}-char limit`,
      };
    }
    const candidate = body.hazard_class.trim().toLowerCase();
    if (candidate.length > 0) {
      if (!GHS_HAZARD_SET.has(candidate)) {
        return {
          ok: false,
          reason: `hazard_class must be one of: ${GHS_HAZARD_CLASSES.join(', ')}`,
        };
      }
      hazardClassValue = candidate as GhsHazardClass;
    }
  }

  // 4. storage_location — optional string.
  const storage = checkOptionalString(
    body.storage_location,
    'storage_location',
    STORAGE_LOCATION_MAX_LEN,
  );
  if (!storage.ok) return storage;

  // 5. pdf_path — optional string.
  const pdfPath = checkOptionalString(body.pdf_path, 'pdf_path', PDF_PATH_MAX_LEN);
  if (!pdfPath.ok) return pdfPath;

  // 6. url — optional, must be http(s) if present.
  let urlValue: string | null = null;
  if (body.url !== undefined && body.url !== null) {
    if (typeof body.url !== 'string') {
      return { ok: false, reason: 'url must be a string' };
    }
    if (body.url.length > URL_MAX_LEN) {
      return {
        ok: false,
        reason: `url length ${body.url.length} exceeds the ${URL_MAX_LEN}-char limit`,
      };
    }
    const trimmedUrl = body.url.trim();
    if (trimmedUrl.length > 0) {
      if (!HTTP_URL_RE.test(trimmedUrl)) {
        return { ok: false, reason: 'url must start with http:// or https://' };
      }
      urlValue = trimmedUrl;
    }
  }

  // 7. last_reviewed — optional, must be YYYY-MM-DD.
  let lastReviewedValue: string | null = null;
  if (body.last_reviewed !== undefined && body.last_reviewed !== null) {
    if (typeof body.last_reviewed !== 'string') {
      return { ok: false, reason: 'last_reviewed must be a YYYY-MM-DD string' };
    }
    if (body.last_reviewed.length > LAST_REVIEWED_MAX_LEN) {
      return {
        ok: false,
        reason: `last_reviewed length ${body.last_reviewed.length} exceeds the ${LAST_REVIEWED_MAX_LEN}-char limit`,
      };
    }
    if (!ISO_DATE_RE.test(body.last_reviewed)) {
      return { ok: false, reason: 'last_reviewed must match YYYY-MM-DD' };
    }
    // Round-trip parse to catch non-existent dates like 2026-02-30.
    // Date.parse silently normalizes them (Feb 30 → Mar 2) — the format
    // regex above and a finite-ms check would both pass, leaving the
    // operator-typed string in the DB while the inspector-facing "current
    // SDS" date check sorts/compares against the normalized real date.
    // Mirrors lib/dateMarks.ts::parseDateStrict.
    const parts = body.last_reviewed.split('-').map((p: string) => parseInt(p, 10));
    const y = parts[0]!;
    const m = parts[1]!;
    const d = parts[2]!;
    const ms = Date.UTC(y, m - 1, d);
    const dt = new Date(ms);
    if (
      !Number.isFinite(ms) ||
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== m - 1 ||
      dt.getUTCDate() !== d
    ) {
      return { ok: false, reason: 'last_reviewed is not a real calendar date' };
    }
    lastReviewedValue = body.last_reviewed;
  }

  // 8. active — optional boolean / 0|1.
  let activeValue: 0 | 1 | null = null;
  if (body.active !== undefined && body.active !== null) {
    if (typeof body.active === 'boolean') {
      activeValue = body.active ? 1 : 0;
    } else if (body.active === 0 || body.active === 1) {
      activeValue = body.active;
    } else {
      return { ok: false, reason: 'active must be true/false or 0/1' };
    }
  }

  // 9. cook_id — optional string.
  const cookId = checkOptionalString(body.cook_id, 'cook_id', COOK_ID_MAX_LEN);
  if (!cookId.ok) return cookId;

  return {
    ok: true,
    value: {
      product_name: productNameValue,
      manufacturer: mfr.value,
      hazard_class: hazardClassValue,
      storage_location: storage.value,
      pdf_path: pdfPath.value,
      url: urlValue,
      last_reviewed: lastReviewedValue,
      active: activeValue,
      cook_id: cookId.value,
    },
  };
}
