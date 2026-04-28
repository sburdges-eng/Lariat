// SDS-registry validation (paired with POST /api/sds).
//
// `sds_registry.product_name` is NOT NULL in the schema and the route
// feeds it straight through clip() — which returns null for non-string
// or empty input, which would 500 on the insert. Catch that here with
// a 400 so the client sees a useful error.
//
// Everything else the route accepts (manufacturer, hazard_class,
// storage_location, pdf_path, url, last_reviewed, active, cook_id) is
// optional. We don't validate `url` shape here; the route clips it to
// 300 chars and SQLite stores it as free text.

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

function isNonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

export function validateSds(input: SdsInput): { ok: boolean; reason?: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: 'body must be an object' };
  }
  if (!isNonEmptyString(input.product_name)) {
    return { ok: false, reason: 'product_name is required' };
  }
  return { ok: true };
}
