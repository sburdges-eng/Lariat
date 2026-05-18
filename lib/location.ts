/** Default kitchen location for single-site installs; v2 multi-location uses query param ?location= or ?location_id= */
export const DEFAULT_LOCATION_ID = 'default';

let _legacyEnvWarned = false;

/**
 * Resolve the install's location id from the process environment.
 *
 * Canonical name: `LARIAT_LOCATION_ID` (matches the table column
 * convention `location_id` used everywhere in the schema and matches
 * how the discovery / mDNS paths already read it).
 *
 * Legacy alias: `LARIAT_LOCATION` — still honored but emits a one-shot
 * stderr warning so operators notice and migrate. Documented in
 * docs/INTEGRATION_AUDIT.md §F7 (2026-05-16): both names floated around
 * during the multi-location rollout and split-brain was easy to hit
 * when one process read the new name and another read the old.
 *
 * Resolution order:
 *   1. LARIAT_LOCATION_ID (preferred — wins even if LOCATION is also set)
 *   2. LARIAT_LOCATION (legacy — warns once)
 *   3. DEFAULT_LOCATION_ID
 */
export function locationIdFromEnv(): string {
  const canonical = (process.env.LARIAT_LOCATION_ID || '').trim();
  if (canonical) return canonical;
  const legacy = (process.env.LARIAT_LOCATION || '').trim();
  if (legacy) {
    if (!_legacyEnvWarned) {
      _legacyEnvWarned = true;
       
      console.warn(
        '[lariat] LARIAT_LOCATION is deprecated — rename to LARIAT_LOCATION_ID. ' +
          'Both names are read for now; the legacy alias will be dropped after one release.',
      );
    }
    return legacy;
  }
  return DEFAULT_LOCATION_ID;
}

export function locationFromRequest(req: Request): string {
  try {
    const u = new URL(req.url);
    const q = u.searchParams.get('location') || u.searchParams.get('location_id');
    return q && q.trim() ? q.trim() : DEFAULT_LOCATION_ID;
  } catch {
    return DEFAULT_LOCATION_ID;
  }
}

export function locationFromBody(body: Record<string, unknown> | null | undefined): string {
  if (!body) return DEFAULT_LOCATION_ID;
  const fromId = body.location_id != null ? String(body.location_id).trim() : '';
  if (fromId) return fromId;
  const fromLoc = body.location != null ? String(body.location).trim() : '';
  if (fromLoc) return fromLoc;
  return DEFAULT_LOCATION_ID;
}

/**
 * Prefer the body's location key when actually present; fall back
 * to the URL `?location=` / `?location_id=` query.
 *
 * Replaces the broken pattern:
 *   `locFromBody !== 'default' ? locFromBody : locFromReq`
 * which conflated "body explicitly said 'default'" with "body said
 * nothing" — a body of `{ location_id: 'default' }` would silently
 * fall through to the URL's location instead of being honored.
 *
 * Found via the 2026-05-02 breaker audit (Section 3 P2 #2):
 *   docs/agentic/findings/2026-05-02-locFromBody-default-fallthrough-ambiguity.md
 *
 * Contract:
 *   - body.location_id is a non-empty string → return it (trimmed)
 *   - body.location is a non-empty string → return it (trimmed)
 *   - both absent / blank → fall back to locationFromRequest(req)
 *
 * The "key actually present" check is structural: `typeof === 'string'`
 * + non-empty trim. A bare `null` / `undefined` / `''` body value
 * counts as absent. An explicit `'default'` value is HONORED — that's
 * the bug fix.
 */
export function locationFromBodyOrRequest(
  body: Record<string, unknown> | null | undefined,
  req: Request,
): string {
  if (body) {
    const fromId = body.location_id != null ? String(body.location_id).trim() : '';
    if (fromId) return fromId;
    const fromLoc = body.location != null ? String(body.location).trim() : '';
    if (fromLoc) return fromLoc;
  }
  return locationFromRequest(req);
}
