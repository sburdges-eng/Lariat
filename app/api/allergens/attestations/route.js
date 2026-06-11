// @ts-check
// Allergen attestations — roadmap 3.3.
//
//   GET  /api/allergens/attestations[?slug=…]   status list (per recipe)
//   POST /api/allergens/attestations            attest (manager PIN-gated)
//
// GET is a cook-readable food-safety surface (same posture as the
// allergen-lookup page itself): it returns each recipe's heuristic
// allergen set plus its attestation status — verified / heuristic-only /
// stale — so a line cook can see WHETHER the list has manager signoff.
//
// POST is PIN-gated in-route via requirePin (the same shape every other
// regulated mutation uses — see app/api/recipes/[slug]/photos). The
// insert is append-only: corrections are fresh rows, and the matching
// audit_events row is posted inside the same transaction by
// lib/allergenAttestations.ts.

import { locationFromRequest, locationFromBody } from '../../../../lib/location';
import { requirePin } from '../../../../lib/pin';
import { withIdempotency } from '../../../../lib/idempotency';
import {
  getAttestationStatuses,
  getAttestationStatus,
  recordAttestation,
} from '../../../../lib/allergenAttestations';
import { getRecipeBySlug } from '../../../../lib/data';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

/** @param {Request} req */
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get('slug');
    const location_id = locationFromRequest(req);

    if (slug) {
      if (!getRecipeBySlug(slug)) {
        return Response.json(
          { error: `unknown recipe slug "${slug}"` },
          { status: 404, headers: NO_STORE },
        );
      }
      const recipe = getAttestationStatus(slug, location_id);
      return Response.json({ location_id, recipes: [recipe] }, { headers: NO_STORE });
    }

    const recipes = getAttestationStatuses(null, location_id);
    return Response.json({ location_id, recipes }, { headers: NO_STORE });
  } catch (err) {
    console.error('GET /api/allergens/attestations failed:', err);
    return Response.json(
      { error: 'Could not load allergen attestations' },
      { status: 500 },
    );
  }
}

/** @param {Request} req */
export async function POST(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  return withIdempotency(req, () => attestHandler(req));
}

/** @param {Request} req */
async function attestHandler(req) {
  try {
    /** @type {Record<string, unknown>} */
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'invalid JSON body' }, { status: 400 });
    }

    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    if (!slug) {
      return Response.json({ error: 'missing slug' }, { status: 400 });
    }
    const attested_by =
      typeof body.attested_by === 'string' ? body.attested_by.trim() : '';
    if (!attested_by) {
      return Response.json({ error: 'missing attested_by' }, { status: 400 });
    }
    if (body.allergens !== undefined && !Array.isArray(body.allergens)) {
      return Response.json({ error: 'allergens must be an array' }, { status: 400 });
    }
    const allergens = Array.isArray(body.allergens)
      ? body.allergens.filter((/** @type {unknown} */ a) => typeof a === 'string')
      : undefined;
    const note = typeof body.note === 'string' ? body.note : null;
    const location_id = locationFromBody(body);

    const row = recordAttestation({
      recipe_slug: slug,
      location_id,
      allergens,
      attested_by,
      note,
      actor_source: 'manager_ui',
    });
    if (!row) {
      return Response.json(
        { error: `unknown recipe slug "${slug}"` },
        { status: 404, headers: NO_STORE },
      );
    }

    const status = getAttestationStatus(slug, location_id);
    return Response.json(
      { ok: true, attestation: row, recipe: status },
      { status: 201, headers: NO_STORE },
    );
  } catch (err) {
    console.error('POST /api/allergens/attestations failed:', err);
    return Response.json(
      { error: 'Could not record allergen attestation' },
      { status: 500 },
    );
  }
}
