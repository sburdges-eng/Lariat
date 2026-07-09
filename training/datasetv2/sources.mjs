// Dataset v2 sources — real Lariat entities + the *production* prompt
// builders, so every training example matches the serving format
// byte-for-byte. This module is the single bridge to app code:
//   - GROUNDED_SYSTEM / buildGroundedContext / renderQueryCatalog are
//     imported live from lib/ (same --experimental-strip-types mechanism
//     as training/eval/run-eval.mjs);
//   - the per-turn directive blocks are EXTRACTED from
//     app/api/kitchen-assistant/route.js at load time (template-literal
//     decode) rather than copied, so they cannot drift from production.
//
// MUST run with LARIAT_DATA_DIR pointing at the snapshot dir created by
// training/gcp/preflight.sh — never at the live data/ dir.
import Database from 'better-sqlite3';
import { join, dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

if (!process.env.LARIAT_DATA_DIR) {
  throw new Error('dataset v2 must run with LARIAT_DATA_DIR pointing at training/gcp/snapshot');
}
const SNAP = resolve(process.env.LARIAT_DATA_DIR);
if (!SNAP.includes('snapshot')) {
  throw new Error(`refusing to run against non-snapshot data dir: ${SNAP}`);
}

const { GROUNDED_SYSTEM } = await import('../../lib/ollama.ts');
const { buildGroundedContext } = await import('../../lib/kitchenAssistantContext.ts');
const { renderQueryCatalog, listQueriesForTier } = await import('../../lib/dbQueryTool.ts');

export const GROUNDED = GROUNDED_SYSTEM;
export const LOCATION = 'default';

export async function realContext(message, { hasPin = false } = {}) {
  const { contextText } = await buildGroundedContext(LOCATION, message, { hasPin });
  return contextText;
}

export function catalogFor(tier) {
  return renderQueryCatalog(tier);
}

export function querySpecs(tier) {
  return listQueriesForTier(tier);
}

// ── directive blocks, extracted verbatim from route.js ─────────────────────

const ROUTE_SRC = readFileSync(join(REPO, 'app', 'api', 'kitchen-assistant', 'route.js'), 'utf8');

// Decode the body of a JS template literal starting at `marker` up to the
// first unescaped backtick. Handles \n \t \` \\ \$ escapes (the only ones
// route.js uses in these blocks).
function extractTemplateBlock(marker) {
  const start = ROUTE_SRC.indexOf(marker);
  if (start < 0) throw new Error(`route.js drift: marker not found: ${marker}`);
  let out = '';
  for (let i = start; i < ROUTE_SRC.length; i++) {
    const ch = ROUTE_SRC[i];
    if (ch === '\\') {
      const nx = ROUTE_SRC[i + 1];
      out += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx;
      i++;
      continue;
    }
    if (ch === '`') return out;
    out += ch;
  }
  throw new Error(`route.js drift: unterminated template literal after ${marker}`);
}

export const ACTION_DIRECTIVE = '\n\n' + extractTemplateBlock('ACTION ENGINE DIRECTIVE:');
if (!ACTION_DIRECTIVE.includes('Schemas (use exactly one):')) {
  throw new Error('route.js drift: ACTION ENGINE DIRECTIVE lost its schema list');
}

const READ_ACTION_EXCEPTION = 'if the read-only db_query catalog or semantic_search action is the right tool';
const rawAnswerFormat = extractTemplateBlock('ANSWER FORMAT:');
export const ANSWER_FORMAT = '\n\n' + rawAnswerFormat.replace('${readActionException}', READ_ACTION_EXCEPTION);
if (ANSWER_FORMAT.includes('${')) {
  throw new Error('route.js drift: ANSWER FORMAT gained an unhandled interpolation');
}

// route.js builds this block inline (not a template we can extract cleanly);
// keep in sync with app/api/kitchen-assistant/route.js `semanticSearchCatalog`.
export const SEMANTIC_CATALOG = `
SEMANTIC SEARCH ACTION:
- For fuzzy recipe, BEO, or kitchen audit-memory lookup, you may emit:
  { "action": "semantic_search", "query": "natural language search text", "limit": 6 }
- This action is read-only and available at cook tier.
- Use it when exact names are missing, for example "that wedding cake recipe with the cherry filling".`;
if (!ROUTE_SRC.includes('SEMANTIC SEARCH ACTION:')) {
  throw new Error('route.js drift: semantic search catalog block not found');
}

// ── exact route.js user-message template ────────────────────────────────────

export function buildRuntimeUserMessage({ contextText, tier = 'cook', history = '', message, directive = '' }) {
  const historyBlock = history ? `\n---\n${history}\n` : '\n';
  let u = `CONTEXT (authoritative — only use these facts for operational claims):\n\n${contextText}\n\n${catalogFor(tier)}\n${SEMANTIC_CATALOG}${historyBlock}---\nCOOK MESSAGE:\n${message}`;
  if (directive) u += directive;
  return u;
}

// ── entity loading ──────────────────────────────────────────────────────────

function harvestClientNames(beoEvents) {
  const names = new Set();
  for (const e of beoEvents) {
    if (e.contact_name) names.add(e.contact_name.trim());
    if (e.title) {
      const t = e.title.replace(/\s*Event\s*$/i, '').trim();
      // skip generic titles that aren't client names
      if (t && !/^(rodeo|brunch|wedding|holiday|private|party)\b/i.test(t)) names.add(t);
    }
    const m = /Client:\s*([^\n]+)/i.exec(e.notes || '');
    if (m) {
      names.add(m[1].trim());
      for (const part of m[1].split(/\s*(?:&|,|\band\b)\s*/i)) {
        const p = part.trim();
        if (p.length > 2) names.add(p);
      }
    }
  }
  return [...names];
}

export function loadSources() {
  const db = new Database(join(SNAP, 'lariat.db'), { readonly: true });
  const recipes = JSON.parse(readFileSync(join(SNAP, 'cache', 'recipes.json'), 'utf8'));
  const allergenMatrix = JSON.parse(readFileSync(join(SNAP, 'cache', 'allergen_matrix.json'), 'utf8'));
  const stations = JSON.parse(readFileSync(join(SNAP, 'cache', 'stations.json'), 'utf8'));
  const orderGuideItems = db.prepare(
    'SELECT ingredient, base_qty, unit, vendor FROM order_guide_items WHERE location_id = ?'
  ).all(LOCATION);
  const beoEvents = db.prepare('SELECT * FROM beo_events').all();
  const eightySix = db.prepare('SELECT item, reason FROM eighty_six LIMIT 200').all();
  // roster for give_gold_star targets — first names only (never full PII rows)
  const staff = db.prepare('SELECT display_name FROM entities_employees WHERE active = 1 LIMIT 100').all()
    .map((r) => ({ name: String(r.display_name || '').split(/\s+/)[0] }))
    .filter((r) => r.name.length > 1);
  const complianceRules = readFileSync(join(SNAP, 'normalized', 'compliance_rules.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  const clientNames = harvestClientNames(beoEvents);
  db.close();
  return {
    recipes, allergenMatrix, stations, orderGuideItems, beoEvents,
    eightySix, staff, complianceRules, clientNames,
  };
}
