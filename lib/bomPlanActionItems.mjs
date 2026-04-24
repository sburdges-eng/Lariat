// Option 8: pure helpers for plan_placeholder_verify_bid and
// plan_replace_franks action-item proposals.
//
// Kept separate from lib/bomVendorProposals.ts because this is NOT a
// vendor-matching primitive — it builds recommended-action text for
// "flag for user" bom_lines. Deliberately small, no scoring, no
// confidence tiers.
//
// Imported by:
//   - scripts/propose-plan-action-items.mjs (CLI)
//   - tests/js/test-propose-plan-action-items.mjs (unit tests)
//
// Pure module: no DB, no filesystem, no I/O.

/**
 * Hot-sauce-ish candidate anchor tokens for plan_replace_franks rows.
 * Matching is substring on vendor_prices.ingredient (lowercased).
 * Deliberately short and hand-picked — no LLM synonym expansion.
 */
export const HOT_SAUCE_TOKENS = [
  'hot sauce',
  'cayenne sauce',
  'louisiana',
  'buffalo',
];

/** Cap on hot-sauce candidate count in the notes column. */
export const HOT_SAUCE_CANDIDATE_CAP = 5;

/**
 * Scan vendor_prices-shaped rows for hot-sauce candidates (plan_replace_franks).
 *
 * Each input row is expected to have { name, vendor, pack_unit, unit_price }.
 * Returns an array of matching rows sorted unit_price asc, capped.
 * Rows with a null/undefined name are skipped.
 */
export function findHotSauceCandidates(vendorRows) {
  const matches = [];
  for (const r of vendorRows) {
    const lower = (r.name || '').toLowerCase();
    if (!lower) continue;
    const matchedToken = HOT_SAUCE_TOKENS.find((t) => lower.includes(t));
    if (matchedToken) {
      matches.push({ ...r, matched_token: matchedToken });
    }
  }
  matches.sort((a, b) => {
    const ap = a.unit_price ?? Number.POSITIVE_INFINITY;
    const bp = b.unit_price ?? Number.POSITIVE_INFINITY;
    if (ap !== bp) return ap - bp;
    return (a.name || '').localeCompare(b.name || '');
  });
  return matches.slice(0, HOT_SAUCE_CANDIDATE_CAP);
}

/**
 * Build the one-sentence recommended action string for a bom_line.
 * Pure function of (row, hotSauceCandidates).
 *
 * `row` needs: map_status, ingredient, vendor, vendor_ingredient.
 * `hotSauceCandidates` is only consulted when map_status === 'plan_replace_franks'.
 */
export function recommendedActionFor(row, hotSauceCandidates) {
  if (row.map_status === 'plan_placeholder_verify_bid') {
    const vendorStr = row.vendor
      ? `"${row.vendor}"`
      : 'all candidate vendors';
    const targetSku = row.vendor_ingredient
      ? ` (target SKU: "${row.vendor_ingredient}")`
      : '';
    return (
      `confirm vendor bid with ${vendorStr}${targetSku}; ` +
      `update vendor_prices row once bid received; ` +
      `set map_status='mapped'`
    );
  }
  if (row.map_status === 'plan_replace_franks') {
    if (!hotSauceCandidates || hotSauceCandidates.length === 0) {
      return (
        `identify replacement SKU for Frank's product "${row.ingredient}"; ` +
        `NO hot-sauce candidates found in vendor_prices — add a new vendor ` +
        `SKU (or flag for drink/spec sourcing); ` +
        `update bom_line.vendor_ingredient; set map_status='mapped'`
      );
    }
    const candList = hotSauceCandidates
      .map(
        (c) =>
          `${c.name} [${c.vendor}, $${
            typeof c.unit_price === 'number' ? c.unit_price.toFixed(4) : 'n/a'
          }/${c.pack_unit}]`,
      )
      .join('; ');
    return (
      `identify replacement SKU for Frank's product "${row.ingredient}"; ` +
      `candidates: ${candList}; ` +
      `update bom_line.vendor_ingredient; set map_status='mapped'`
    );
  }
  return 'unknown map_status — manual review required';
}

/** Short phrase for the action_needed column. */
export function actionNeededFor(row) {
  if (row.map_status === 'plan_placeholder_verify_bid') return 'verify vendor bid';
  if (row.map_status === 'plan_replace_franks') return 'replace frank-branded SKU';
  return 'manual review';
}

/** Contextual notes column content. */
export function notesFor(row) {
  if (row.map_status === 'plan_placeholder_verify_bid') {
    return (
      'row has placeholder pricing; vendor_ingredient already populated ' +
      'with target SKU name — waiting on vendor to return a bid'
    );
  }
  if (row.map_status === 'plan_replace_franks') {
    return (
      'Frank-branded product referenced by ingredient or vendor_ingredient; ' +
      'not carried by current vendor catalog — needs a replacement ' +
      'SKU decision before costing can complete'
    );
  }
  return '';
}
