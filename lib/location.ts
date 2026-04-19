/** Default kitchen location for single-site installs; v2 multi-location uses query param ?location= or ?location_id= */
export const DEFAULT_LOCATION_ID = 'default';

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
