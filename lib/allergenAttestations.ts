// Allergen attestations — roadmap 3.3.
//
// Recipe allergen flags are HEURISTIC: scripts/rebuild-cache.mjs infers
// them from ingredient names + sub-recipe rollup. This module records a
// manager's signoff ("I verified this recipe's allergen list") as an
// append-only row in `allergen_attestations`, fingerprinted against the
// exact ingredient composition the heuristic reads. A later recipe edit
// changes the fingerprint, which flips the attestation to STALE — it is
// never silently inherited across recipe changes.
//
// Status model per (recipe_slug, location_id), latest row wins:
//   - 'unattested' — no attestation rows exist.
//   - 'attested'   — latest row's fingerprint matches the current
//                    composition.
//   - 'stale'      — latest row exists but the fingerprint no longer
//                    matches (recipe edited, sub-recipe link changed, or
//                    recipe removed from the cache).
//
// Corrections are fresh rows (never UPDATE/DELETE), mirroring the
// audit_events posture. Every insert posts a matching audit_events row
// inside the same transaction via postAuditEvent.

import crypto from 'crypto';
import { getDb } from './db.ts';
import { postAuditEvent } from './auditEvents.ts';
import { getRecipes } from './data.ts';
import type { Recipe } from './data.ts';
import { DEFAULT_LOCATION_ID } from './location.ts';

// ── Row shapes ─────────────────────────────────────────────────────

export interface AllergenAttestationRow {
  id: number;
  recipe_slug: string;
  location_id: string;
  allergens_json: string;
  recipe_fingerprint: string;
  attested_by: string;
  note: string | null;
  created_at: string;
}

export type AttestationStatus = 'unattested' | 'attested' | 'stale';

/** Latest-attestation metadata surfaced next to allergen data. */
export interface AttestationMeta {
  id: number;
  /** The exact allergen list the manager attested (parsed). */
  allergens: string[];
  attested_by: string;
  note: string | null;
  created_at: string;
  recipe_fingerprint: string;
}

export interface RecipeAttestationStatus {
  recipe_slug: string;
  /** Display name from the recipe doc (slug when the recipe is gone). */
  name: string;
  /** Current heuristic allergen set (direct + sub-recipe rollup). */
  heuristic_allergens: string[];
  status: AttestationStatus;
  latest: AttestationMeta | null;
}

// ── Fingerprint ────────────────────────────────────────────────────
//
// The heuristic (scripts/rebuild-cache.mjs) reads ingredient item names
// on the recipe AND on every transitive sub-recipe. So the fingerprint
// covers the whole tree: for each reachable node (cycle-safe, sorted by
// slug) we take its normalized ingredient items + sub-recipe links and
// hash the canonical JSON. Any edit the heuristic would react to —
// ingredient added/renamed/removed, sub-recipe linked/unlinked, anywhere
// in the tree — changes the hash and stales the attestation.

function normalizedItems(recipe: Recipe): string[] {
  return (recipe.ingredients || [])
    .map((ing) => (typeof ing.item === 'string' ? ing.item.trim().toLowerCase() : ''))
    .filter((s) => s.length > 0)
    .sort();
}

/**
 * Fingerprint a recipe's allergen-relevant composition. Returns null when
 * the slug isn't in the recipe cache (deleted / never ingested).
 *
 * `recipes` is injectable for tests; defaults to the live JSON cache.
 */
export function computeRecipeFingerprint(
  slug: string,
  recipes: Recipe[] = getRecipes(),
): string | null {
  const bySlug = new Map<string, Recipe>(recipes.map((r) => [r.slug, r]));
  if (!bySlug.has(slug)) return null;

  // Collect the reachable sub-recipe tree, cycle-safe.
  const seen = new Set<string>();
  const stack = [slug];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === undefined || seen.has(cur)) continue;
    seen.add(cur);
    const node = bySlug.get(cur);
    if (!node) continue; // dangling sub-recipe link — contributes its slug only
    for (const child of node.sub_recipes || []) stack.push(child);
  }

  const canonical = [...seen].sort().map((s) => {
    const node = bySlug.get(s);
    return {
      slug: s,
      ingredients: node ? normalizedItems(node) : [],
      sub_recipes: node ? [...(node.sub_recipes || [])].sort() : [],
    };
  });

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex');
}

// ── Status computation ─────────────────────────────────────────────

function parseAllergensJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    return [];
  }
}

function toMeta(row: AllergenAttestationRow): AttestationMeta {
  return {
    id: row.id,
    allergens: parseAllergensJson(row.allergens_json),
    attested_by: row.attested_by,
    note: row.note,
    created_at: row.created_at,
    recipe_fingerprint: row.recipe_fingerprint,
  };
}

/** Latest attestation row per slug for one location. */
function latestRows(
  locationId: string,
  slugs: string[] | null,
): Map<string, AllergenAttestationRow> {
  const db = getDb();
  // Append-only table: highest id per (location, slug) is the winner.
  const rows = db
    .prepare(
      `SELECT id, recipe_slug, location_id, allergens_json,
              recipe_fingerprint, attested_by, note, created_at
         FROM allergen_attestations
        WHERE location_id = ?
        ORDER BY id DESC`,
    )
    .all(locationId) as AllergenAttestationRow[];
  const wanted = slugs === null ? null : new Set(slugs);
  const latest = new Map<string, AllergenAttestationRow>();
  for (const row of rows) {
    if (wanted && !wanted.has(row.recipe_slug)) continue;
    if (!latest.has(row.recipe_slug)) latest.set(row.recipe_slug, row);
  }
  return latest;
}

/**
 * Attestation status for the given recipe slugs at a location. Pass
 * `slugs = null` for every recipe in the cache. Slugs that aren't in the
 * recipe cache are still returned (an attestation may outlive its recipe)
 * with `status: 'stale'`.
 */
export function getAttestationStatuses(
  slugs: string[] | null,
  locationId: string = DEFAULT_LOCATION_ID,
  recipes: Recipe[] = getRecipes(),
): RecipeAttestationStatus[] {
  const bySlug = new Map<string, Recipe>(recipes.map((r) => [r.slug, r]));
  const targetSlugs = slugs === null ? recipes.map((r) => r.slug) : slugs;
  const latest = latestRows(locationId, slugs === null ? null : targetSlugs);

  return targetSlugs.map((slug) => {
    const recipe = bySlug.get(slug);
    const row = latest.get(slug) ?? null;
    let status: AttestationStatus = 'unattested';
    if (row) {
      const current = computeRecipeFingerprint(slug, recipes);
      status = current !== null && current === row.recipe_fingerprint ? 'attested' : 'stale';
    }
    return {
      recipe_slug: slug,
      name: recipe?.name ?? slug,
      heuristic_allergens: recipe?.allergens ?? [],
      status,
      latest: row ? toMeta(row) : null,
    };
  });
}

/** Single-recipe convenience wrapper over getAttestationStatuses. */
export function getAttestationStatus(
  slug: string,
  locationId: string = DEFAULT_LOCATION_ID,
  recipes: Recipe[] = getRecipes(),
): RecipeAttestationStatus {
  const result = getAttestationStatuses([slug], locationId, recipes)[0];
  if (!result) throw new Error(`getAttestationStatuses dropped slug "${slug}"`);
  return result;
}

// ── Recording ──────────────────────────────────────────────────────

export interface RecordAttestationInput {
  recipe_slug: string;
  location_id?: string;
  /** Attested allergen list. Defaults to the current heuristic set. */
  allergens?: string[];
  /** Manager identifier (name or manager-pin user). Required. */
  attested_by: string;
  note?: string | null;
  /** Audit actor_source; defaults to 'manager_ui'. */
  actor_source?: string;
}

function normalizeAllergens(list: string[]): string[] {
  const out = new Set<string>();
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim().toLowerCase().slice(0, 64);
    if (t) out.add(t);
  }
  return [...out].sort();
}

/**
 * Record one attestation (append-only) plus its audit_events row in a
 * single transaction. Returns null when the recipe isn't in the cache —
 * you can't attest a recipe the heuristic can't see.
 */
export function recordAttestation(
  input: RecordAttestationInput,
  recipes: Recipe[] = getRecipes(),
): AllergenAttestationRow | null {
  const location_id = input.location_id ?? DEFAULT_LOCATION_ID;
  const fingerprint = computeRecipeFingerprint(input.recipe_slug, recipes);
  if (fingerprint === null) return null;

  const recipe = recipes.find((r) => r.slug === input.recipe_slug);
  const allergens = normalizeAllergens(
    input.allergens ?? recipe?.allergens ?? [],
  );
  const attested_by = input.attested_by.trim().slice(0, 100);
  const note =
    typeof input.note === 'string' ? input.note.trim().slice(0, 500) || null : null;

  const db = getDb();
  const performWrite = db.transaction((): AllergenAttestationRow => {
    const info = db
      .prepare(
        `INSERT INTO allergen_attestations
           (recipe_slug, location_id, allergens_json, recipe_fingerprint,
            attested_by, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.recipe_slug,
        location_id,
        JSON.stringify(allergens),
        fingerprint,
        attested_by,
        note,
      );

    const row = db
      .prepare(
        `SELECT id, recipe_slug, location_id, allergens_json,
                recipe_fingerprint, attested_by, note, created_at
           FROM allergen_attestations WHERE id = ?`,
      )
      .get(info.lastInsertRowid) as AllergenAttestationRow;

    postAuditEvent({
      entity: 'allergen_attestation',
      entity_id: row.id,
      action: 'insert',
      actor_cook_id: attested_by,
      actor_source: input.actor_source ?? 'manager_ui',
      payload: row,
      note,
      location_id,
    });

    return row;
  });

  return performWrite();
}
