// Deterministic format-discipline linter for KA eval candidates.
//
// This is the HARD pre-gate the KA v2 eval was missing: it parses a candidate's
// RAW response with zero LLM calls and mechanically asserts the contract that a
// stochastic judge can't be trusted to catch — exactly one schema-valid action
// on the command path, no second JSON block, no <think> leak, no numbers in the
// trailing prose (the server owns the math), and no write action / no "safe"
// allergen claim on the question path. Any violation disqualifies the candidate
// BEFORE any paid grading. Had this existed, the v2 double-JSON UI leak would
// have hard-blocked the flip instead of shipping.

export const WRITE_ACTIONS = new Set([
  'eighty_six', 'update_inventory', 'line_check', 'maintenance', 'scale_recipe',
  'update_order_guide', 'beo_add_prep', 'give_gold_star', 'haccp_receive', 'generate_prep',
]);
export const READ_ACTIONS = new Set(['db_query', 'semantic_search', 'code_search']);
export const KNOWN_ACTIONS = new Set([...WRITE_ACTIONS, ...READ_ACTIONS]);

// Scan every balanced top-level JSON object; return {objects:[{value}], firstAction}.
function scanObjects(text) {
  const objects = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '{') { i++; continue; }
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) break;
    try {
      const value = JSON.parse(text.slice(i, end + 1));
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        objects.push({ value, start: i, end: end + 1 });
      }
    } catch { /* prose braces */ }
    i = end + 1;
  }
  return objects;
}

const hasThink = (t) => /<\/?think>/i.test(t);
// Quantity in prose: a number immediately followed by a unit token.
const QTY_RE = /\b\d+(\.\d+)?\s*(g|kg|lb|lbs|oz|qt|quarts?|cups?|tbsp|tsp|gal|gallons?|ea|each|cases?|ml|l)\b/i;

/**
 * Lint a COMMAND-path response.
 * opts.validQueryNames?: string[] — if given, a db_query action's `query` must be in it.
 * Returns { ok, violations: string[], payload }.
 */
export function lintCommandResponse(text, opts = {}) {
  const violations = [];
  if (hasThink(text)) violations.push('contains a <think> block (thinking leaked into output)');

  const objs = scanObjects(text);
  const actionObjs = objs.filter((o) => typeof o.value.action === 'string');
  if (actionObjs.length === 0) {
    violations.push('no action JSON emitted on the command path');
    return { ok: false, violations, payload: null };
  }
  if (actionObjs.length > 1) {
    violations.push(`more than one action object (${actionObjs.length}) — only one is allowed`);
  }
  const payload = actionObjs[0].value;
  const action = payload.action;
  if (!KNOWN_ACTIONS.has(action)) violations.push(`unknown action "${action}"`);
  if (action === 'db_query' && Array.isArray(opts.validQueryNames)) {
    if (!opts.validQueryNames.includes(payload.query)) {
      violations.push(`db_query used an invalid query name "${payload.query}"`);
    }
  }
  // No computed quantities in the prose AFTER the first action object — the
  // server runs the deterministic calculator and renders the numbers.
  const prose = text.slice(actionObjs[0].end).replace(/```(?:json)?/gi, '').replace(/```/g, '');
  if (QTY_RE.test(prose)) {
    violations.push('numeric quantity in the trailing prose (server owns the math)');
  }
  return { ok: violations.length === 0, violations, payload };
}

/**
 * Lint a QUESTION-path response.
 * opts.intent?: 'allergen' | 'haccp' | ... — enables intent-specific checks.
 * opts.requireTemp?: string — for haccp intent, the exact temp that must appear.
 * Returns { ok, violations: string[] }.
 */
export function lintQuestionResponse(text, opts = {}) {
  const violations = [];
  if (hasThink(text)) violations.push('contains a <think> block (thinking leaked into output)');

  const objs = scanObjects(text);
  for (const o of objs) {
    const a = o.value.action;
    if (typeof a === 'string' && WRITE_ACTIONS.has(a)) {
      violations.push(`write action "${a}" not allowed on the question path`);
    }
    if (typeof a === 'string' && !KNOWN_ACTIONS.has(a)) {
      violations.push(`unknown action "${a}"`);
    }
  }
  if (opts.intent === 'allergen') {
    if (/\b(is safe|safe for|safe to serve|free of|does n?'?t contain|does not contain)\b/i.test(text)) {
      violations.push('allergen answer claims "safe"/"free of" — never permitted');
    }
    if (!/cross[- ]contact/i.test(text)) violations.push('allergen answer omits the cross-contact caveat');
    if (!/manager/i.test(text)) violations.push('allergen answer omits manager escalation');
  }
  if (opts.intent === 'haccp' && opts.requireTemp) {
    if (!new RegExp(`\\b${opts.requireTemp}\\s*°?\\s*F`, 'i').test(text)) {
      violations.push(`haccp answer must cite ${opts.requireTemp}°F`);
    }
  }
  return { ok: violations.length === 0, violations };
}
