// Pure helpers for the data-pack citation drill-in inside
// KitchenAssistantClient.jsx. Extracted into their own module so the
// nutrient picking, unit formatting, and citation rendering can be
// exercised under `node --test` without rendering React.
//
// All helpers in here are side-effect-free and synchronous.
//
// The unit-formatting + nutrient-priority list is intentionally a
// duplicate of the constants in `lib/kitchenAssistantContext.ts`. The
// task spec says "It's OK to copy the small constants/helpers into the
// client component — don't refactor lib/kitchenAssistantContext.ts to
// share them." If the canonical list ever changes the LLM context the
// user is reading, this file should track it; the duplication is a
// known trade-off, not an oversight.

// ── Citation excerpt sizing ──────────────────────────────────────
//
// FDA Food Code section bodies range from a few hundred chars (most
// short rules) to ~10K chars (long sections with tables). The chat UI
// inlines them directly under the badge so we cap to ~400 chars for
// drill-in readability. Acceptance criteria pin both the cap (<= 400)
// and the section_id surfacing.

export const FDA_BODY_EXCERPT_CHARS = 400;

/**
 * Trim a body to FDA_BODY_EXCERPT_CHARS, appending a single ellipsis
 * when truncated. Returns '' for null/undefined/empty input rather
 * than 'null' or 'undefined'.
 */
export function excerptBody(raw, max = FDA_BODY_EXCERPT_CHARS) {
  if (raw === null || raw === undefined) return '';
  const s = typeof raw === 'string' ? raw : String(raw);
  if (s.length <= max) return s;
  // Cut to max-1 so the ellipsis keeps us at exactly `max` displayed
  // characters. Callers that want a strictly-under cap pass a smaller
  // max; the default is the spec's "under ~400" target.
  return `${s.slice(0, max - 1)}…`;
}

// ── FDA citation rendering ───────────────────────────────────────
//
// Hybrid hits expose either:
//   - the FTS envelope: { source: 'fda', id, title, subtitle (= section_id), extra (= chapter/annex), score }
//   - the semantic envelope: { source: 'fda_food_code', rowid, title, section_id, chapter, annex, score }
// Plus, after the follow-up `op=fda_section&rowid=…` fetch, the
// section row carries `body`, `chapter`, `annex`, `section_id`, `title`.
//
// formatFdaCitation collapses both shapes into a single display object
// the React component can render without further conditionals.

/**
 * Normalize an FDA hit + (optional) follow-up section payload into
 * a citation object the chat UI can render directly.
 *
 *   { title, sectionId, chapter, annex, excerpt, rowid }
 *
 * `body` is whatever the follow-up `?op=fda_section&rowid=…` returned
 * under data.section.body. Pass null if the follow-up failed or hasn't
 * landed yet — the excerpt will be empty and the UI shows a graceful
 * "no body" hint.
 */
export function formatFdaCitation(hit, sectionRow) {
  const safe = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const title = safe(
    (sectionRow && sectionRow.title) ?? (hit && hit.title) ?? ''
  );
  const sectionId = safe(
    (sectionRow && sectionRow.section_id) ?? (hit && hit.subtitle) ?? (hit && hit.section_id) ?? ''
  );
  // Hybrid FTS envelope packs chapter/annex into `extra` as a plain
  // string. Semantic + section-row payloads expose them separately.
  let chapter = safe((sectionRow && sectionRow.chapter) ?? (hit && hit.chapter) ?? '');
  let annex = safe((sectionRow && sectionRow.annex) ?? (hit && hit.annex) ?? '');
  if (!chapter && !annex && hit && typeof hit.extra === 'string' && hit.extra) {
    // Free-form fallback — surface whatever the FTS envelope had.
    chapter = hit.extra;
  }
  const rowid = (() => {
    const candidates = [
      sectionRow && sectionRow.rowid,
      hit && hit.rowid,
      hit && hit.id,
    ];
    for (const v of candidates) {
      if (v === null || v === undefined) continue;
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  })();
  const body = sectionRow && typeof sectionRow.body === 'string' ? sectionRow.body : '';
  return {
    title,
    sectionId,
    chapter,
    annex,
    rowid,
    excerpt: excerptBody(body),
  };
}

// ── USDA nutrient picking + formatting ───────────────────────────

// Mirrors `USDA_NUTRIENT_PRIORITY` in lib/kitchenAssistantContext.ts.
// Any change to the LLM context's priority list should track here so
// the user sees the same nutrients the model saw.
export const NUTRIENT_PRIORITY = [
  'Energy',
  'Protein',
  'Carbohydrate',
  'Total lipid (fat)',
  'Sodium, Na',
  'Sugars, total',
];

// Short, line-cook-friendly labels — same map kitchenAssistantContext
// uses when rendering inline. Anything not in the map renders as the
// canonical USDA name.
export const PRIORITY_DISPLAY = {
  'Total lipid (fat)': 'Fat',
  'Sodium, Na': 'Sodium',
  'Sugars, total': 'Sugars',
};

/**
 * Lowercase the USDA-canonical unit_name strings (mostly uppercase
 * abbreviations) into the conventional human-readable casing the LLM
 * context block uses. Empty / null / undefined → ''. Unknown values
 * pass through unchanged so we don't accidentally drop a unit.
 */
export function formatUnit(unitName) {
  if (!unitName || typeof unitName !== 'string') return '';
  switch (unitName) {
    case 'KCAL': return 'kcal';
    case 'G': return 'g';
    case 'MG': return 'mg';
    case 'UG': return 'µg';
    case 'IU': return 'IU';
    case 'kJ': return 'kJ';
    case 'MG_ATE': return 'mg α-TE';
    case 'SP_GR': return 'sp.gr.';
    default: return unitName;
  }
}

/**
 * Pick the NUTRIENT_PRIORITY subset out of a USDA nutrients array,
 * preserving priority order (Energy first, Sugars last). Match is by
 * case-insensitive prefix because USDA names carry inconsistent
 * trailing commas / units. Each surviving nutrient is annotated with
 * `displayName` (short) and `displayUnit` (lowercased) so the UI
 * doesn't have to redo the lookup.
 *
 * Returns [] for missing / non-array input. Skips entries without a
 * usable amount (null/undefined).
 */
export function pickPriorityNutrients(nutrients) {
  if (!Array.isArray(nutrients) || nutrients.length === 0) return [];
  const out = [];
  for (const wanted of NUTRIENT_PRIORITY) {
    const found = nutrients.find(
      (n) =>
        n &&
        typeof n.nutrient_name === 'string' &&
        n.nutrient_name.toLowerCase().startsWith(wanted.toLowerCase())
    );
    if (!found) continue;
    if (found.amount === null || found.amount === undefined) continue;
    out.push({
      ...found,
      displayName: PRIORITY_DISPLAY[wanted] ?? wanted,
      displayUnit: formatUnit(found.unit_name),
    });
  }
  return out;
}

/**
 * Format a single USDA hit + (optional) nutrients payload into a
 * citation object the chat UI renders directly.
 *
 *   { description, foodCategory, fdcId, brandOwner, nutrients }
 *
 * Where `nutrients` is the priority-picked, short-name + lowercased-
 * unit array from pickPriorityNutrients(). Pass null nutrients if the
 * follow-up fetch failed; the UI shows a "no nutrients" hint.
 */
export function formatUsdaCitation(hit, foodRow, nutrients) {
  const safe = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const description = safe(
    (foodRow && foodRow.description) ??
      (hit && hit.title) ??
      (hit && hit.description) ??
      ''
  );
  const foodCategory = safe(
    (foodRow && foodRow.food_category) ??
      (hit && hit.subtitle) ??
      (hit && hit.food_category) ??
      ''
  );
  const fdcId = (() => {
    const candidates = [
      foodRow && foodRow.fdc_id,
      hit && hit.fdc_id,
      hit && hit.id,
    ];
    for (const v of candidates) {
      if (v === null || v === undefined) continue;
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  })();
  const brandOwner = safe(foodRow && foodRow.brand_owner);
  return {
    description,
    foodCategory,
    fdcId,
    brandOwner,
    nutrients: pickPriorityNutrients(nutrients),
  };
}
