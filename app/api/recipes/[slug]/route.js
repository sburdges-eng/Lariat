// Recipe management endpoint — GET reads the canonical document,
// PUT persists a management edit.
//
// Storage model. Recipes live in two stores by historical accident:
//   1. data/cache/recipes.json — full document (name, ingredients,
//      procedures, allergens, yield). Read across the app via
//      lib/data.ts::getRecipes().
//   2. entities_recipes (DB) — canonical entity registry (uuid, slug,
//      display_name, yield_qty, yield_unit, category). Does NOT carry
//      ingredients / procedures.
//
// PUT writes both stores. The DB upsert + audit_events row land in one
// db.transaction(...) per docs/PATTERNS.md §3 (regulated mutation —
// recipe edits feed depletion + allergen rollups). The recipes.json
// rewrite happens AFTER the transaction commits and is atomic
// (temp + rename), so a crash mid-write leaves the previous file
// untouched. The pre-existing file-track audit (logAuditAction →
// data/audit/management-actions.jsonl) is preserved — that is the
// management-action track per the two-track audit pattern, distinct
// from the regulated DB track.

import { cookies } from 'next/headers';
import { logAuditAction } from '../../../../lib/auditLog.mjs';
import { withIdempotency } from '../../../../lib/idempotency';
import { getDb } from '../../../../lib/db';
import { locationFromBody } from '../../../../lib/location';
import { postAuditEvent } from '../../../../lib/auditEvents';
import { upsertRecipeEntity, writeRecipeDoc, readRecipeDoc } from '../../../../lib/recipes';

// GET — fetch a recipe by slug.
//
// Reads from data/cache/recipes.json (the canonical document store).
// Returns 200 with `recipe: <doc>` when found, 200 with `recipe: null`
// when the slug isn't in the cache (the JSON cache may not have been
// rebuilt yet — discovery, not error). No PIN gate on reads; sensitive
// surfaces are gated upstream by middleware.js for management routes.
export async function GET(_request, { params }) {
  const { slug } = params;
  const recipe = readRecipeDoc(slug);
  return Response.json({
    success: true,
    slug,
    recipe,
    message: recipe ? 'Recipe loaded' : 'Recipe not found in cache',
  });
}

// PUT — update a recipe (management only).
export async function PUT(request, ctx) {
  return withIdempotency(request, () => recipeSlugPutHandler(request, ctx));
}

async function recipeSlugPutHandler(request, { params }) {
  const { slug } = params;

  // PIN gate — same lariat_pin_ok cookie as middleware.js uses for
  // every other management surface (analytics, costing, purchasing).
  // One cookie, one source of truth.
  const cookieStore = await cookies();
  const pinOk = cookieStore.get('lariat_pin_ok');
  if (pinOk?.value !== '1') {
    return Response.json(
      { error: 'Unauthorized. Management access required.' },
      { status: 403 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return Response.json(
      { error: `Failed to update recipe: ${error.message}` },
      { status: 500 }
    );
  }

  const { name, procedures, allergens, ingredients } = body;

  // Validation — order matters: required-name before array-shape so
  // the test's "missing name" case (which also lacks ingredients)
  // gets the name error first.
  if (!name || !name.trim()) {
    return Response.json(
      { error: 'Recipe name is required' },
      { status: 400 }
    );
  }
  if (!Array.isArray(ingredients)) {
    return Response.json(
      { error: 'Ingredients must be an array' },
      { status: 400 }
    );
  }

  const location_id = locationFromBody(body);

  // Build the recipe document we're persisting. Preserves any
  // additional fields a caller might pass through (yield_qty,
  // yield_unit, station, source) so a future caller doesn't lose
  // metadata. recipes.json itself is the authoritative shape.
  const recipeDoc = {
    slug,
    name: String(name).trim(),
    ingredients,
    procedures: Array.isArray(procedures) ? procedures : [],
    allergens: Array.isArray(allergens) ? allergens : [],
    direct_allergens: Array.isArray(allergens) ? allergens : [],
    yield_qty: body.yield_qty ?? null,
    yield_unit: body.yield_unit ?? null,
    station: body.station ?? null,
    source: body.source ?? 'recipes_api',
  };

  // Derive a single-string `procedure` field too — recipes.json mixes
  // both shapes across legacy entries. Storing both keeps downstream
  // readers happy whether they expect string or array.
  if (Array.isArray(procedures)) {
    recipeDoc.procedure = procedures.join('\n');
  } else if (typeof procedures === 'string') {
    recipeDoc.procedure = procedures;
    recipeDoc.procedures = procedures ? [procedures] : [];
  } else {
    recipeDoc.procedure = '';
  }

  // The management-track file audit (data/audit/management-actions.jsonl)
  // captures the WHO + WHAT of the edit at a coarse grain. Build it
  // up-front so the response can echo it back even when the DB tx
  // succeeds and the JSON rewrite fails — operators see the audit
  // entry that did get recorded.
  const auditEntry = {
    action: 'recipe_edit',
    slug,
    timestamp: new Date().toISOString(),
    changes: {
      name: recipeDoc.name,
      procedures_length: Array.isArray(procedures) ? procedures.length : 0,
      allergens_count: Array.isArray(allergens) ? allergens.length : 0,
      ingredients_count: ingredients.length,
    },
  };

  let entityResult;
  try {
    const db = getDb();
    const performWrite = db.transaction(() => {
      const result = upsertRecipeEntity(db, {
        slug,
        display_name: recipeDoc.name,
        yield_qty:
          typeof recipeDoc.yield_qty === 'number'
            ? recipeDoc.yield_qty
            : recipeDoc.yield_qty != null && recipeDoc.yield_qty !== ''
              ? Number(recipeDoc.yield_qty)
              : null,
        yield_unit: recipeDoc.yield_unit,
        category: null,
        location_id,
      });

      // Audit emission inside the same transaction — a rollback wipes
      // both the entity row and the audit row together.
      // Per docs/PATTERNS.md §3: do NOT wrap in try/catch; an audit
      // failure must propagate so the source row rolls back with it.
      postAuditEvent({
        entity: 'recipes',
        entity_id: null,
        action: result.created ? 'insert' : 'update',
        actor_cook_id: null,
        actor_source: 'management_ui',
        payload: {
          uuid: result.uuid,
          slug,
          display_name: recipeDoc.name,
          changes: auditEntry.changes,
        },
        location_id,
      });

      return result;
    });
    entityResult = performWrite();
  } catch (error) {
    return Response.json(
      { error: `Failed to update recipe: ${error.message}` },
      { status: 500 }
    );
  }

  // Document write happens AFTER the DB tx commits. If this fails
  // we surface a 500 — the entity + audit row are durable, but the
  // operator's edit didn't fully take, and the next save will retry.
  try {
    writeRecipeDoc(recipeDoc);
  } catch (error) {
    return Response.json(
      {
        error: `Failed to update recipe: ${error.message}`,
        partial: { entity_uuid: entityResult.uuid },
      },
      { status: 500 }
    );
  }

  // File-track management audit. Continues to be best-effort: a
  // management-actions.jsonl write failure should NOT roll back the
  // primary persistence. (DB audit above is the authoritative track.)
  try {
    logAuditAction(auditEntry);
  } catch (auditError) {
    console.error('Failed to write management audit log:', auditError);
  }

  return Response.json({
    success: true,
    slug,
    audit: auditEntry,
    entity_uuid: entityResult.uuid,
    created: entityResult.created,
    message: 'Recipe updated successfully',
  });
}
