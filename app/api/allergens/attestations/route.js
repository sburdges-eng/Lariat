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

import { locationFromRequest, locationFromBodyOrRequest } from '../../../../lib/location';
import { requirePin, pinActor } from '../../../../lib/pin';
import { withIdempotency } from '../../../../lib/idempotency';
import {
  getAttestationStatuses,
  getAttestationStatus,
  recordAttestation,
  heuristicAllergensFor,
  resolveAttestor,
  normalizeAllergens,
} from '../../../../lib/allergenAttestations';
import { getRecipeBySlug } from '../../../../lib/data';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

// Response-envelope contract (Contract #1). Every success/handled envelope
// carries this so clients (web + native + the shared DB tooling) can key on
// the shape. Invariants held by this route:
//   - GET.recipes[*].status ∈ {unattested, attested, stale}; an attestation
//     may outlive its recipe and stays visible as 'stale'.
//   - POST stores ONLY the server-computed heuristic allergen list; a
//     submitted `allergens` list is a precondition, not the stored value —
//     a mismatch is rejected 409, never silently overwritten.
//   - The signoff identity is bound to the authenticated PIN actor.
const SCHEMA_VERSION = 'allergen_attestations_v1';

/** @param {Request} req */
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get('slug');
    const location_id = locationFromRequest(req);

    if (slug) {
      const recipe = getAttestationStatus(slug, location_id);
      // Unknown slug with no attestation → 404. An attestation that outlived
      // its recipe stays reachable as 'stale' (Contract #2), matching the
      // list path and the module contract.
      if (!getRecipeBySlug(slug) && !recipe.latest) {
        return Response.json(
          { error: `unknown recipe slug "${slug}"` },
          { status: 404, headers: NO_STORE },
        );
      }
      return Response.json(
        { schemaVersion: SCHEMA_VERSION, location_id, recipes: [recipe] },
        { headers: NO_STORE },
      );
    }

    const recipes = getAttestationStatuses(null, location_id);
    return Response.json(
      { schemaVersion: SCHEMA_VERSION, location_id, recipes },
      { headers: NO_STORE },
    );
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

    // A submitted `allergens` list is an optional PRECONDITION — "I'm signing
    // off on this exact list". It is never stored; the server always records
    // its own heuristic set (Critical #1). Reject a non-array outright.
    if (body.allergens !== undefined && !Array.isArray(body.allergens)) {
      return Response.json({ error: 'allergens must be an array' }, { status: 400 });
    }
    const expected = Array.isArray(body.allergens)
      ? normalizeAllergens(
          body.allergens.filter((/** @type {unknown} */ a) => typeof a === 'string'),
        )
      : undefined;

    // Identity is bound to the authenticated PIN actor (High #2). A signed-in
    // manager account forces the signoff name; the env-PIN override keeps the
    // typed name. requirePin already passed, so the actor is trustworthy.
    const actor = await pinActor(req);
    const { attested_by, actor_id, actor_source } = resolveAttestor(
      actor,
      body.attested_by,
    );
    if (!attested_by) {
      return Response.json({ error: 'missing attested_by' }, { status: 400 });
    }

    const note = typeof body.note === 'string' ? body.note : null;
    const location_id = locationFromBodyOrRequest(body, req);

    // Recipe must be in the cache to attest it. Resolve the current heuristic
    // once and use it both for the precondition check and (via the lib) the
    // stored list, so they can never diverge.
    const heuristic = heuristicAllergensFor(slug);
    if (heuristic === null) {
      return Response.json(
        { error: `unknown recipe slug "${slug}"` },
        { status: 404, headers: NO_STORE },
      );
    }
    if (expected !== undefined && JSON.stringify(expected) !== JSON.stringify(heuristic)) {
      return Response.json(
        {
          schemaVersion: SCHEMA_VERSION,
          error:
            'allergen list changed since it was loaded — refresh before attesting',
          current_allergens: heuristic,
          submitted_allergens: expected,
        },
        { status: 409, headers: NO_STORE },
      );
    }

    const row = recordAttestation({
      recipe_slug: slug,
      location_id,
      attested_by,
      note,
      actor_source,
      actor_id,
    });
    if (!row) {
      return Response.json(
        { error: `unknown recipe slug "${slug}"` },
        { status: 404, headers: NO_STORE },
      );
    }

    const status = getAttestationStatus(slug, location_id);
    return Response.json(
      { schemaVersion: SCHEMA_VERSION, ok: true, attestation: row, recipe: status },
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
