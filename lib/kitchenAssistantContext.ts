import { getDb, todayISO } from './db.ts';
import {
  getStations,
  getLineCheckTemplate,
  getRecipes,
  getMenu,
  getFoodSafety,
  getVendorSummary,
  getLaborSummary,
  getAllergenMatrix,
  getStaff,
} from './data.ts';
import type {
  Recipe,
  AllergenMatrix,
  Station,
  StaffMember,
  FoodSafetyData,
  VendorSummary,
  LaborSummary,
} from './data.ts';
import type { Database as DB } from 'better-sqlite3';
import * as datapackSearch from './datapackSearch.ts';
import type { FdaSection, HybridHit } from './datapackSearch.ts';
import { renderCompliance } from './complianceSearch.ts';

const MAX_86 = 40;
const MAX_INV = 20;
const MAX_RECIPES_IN_CONTEXT = 5;
const MAX_ING_CHARS = 500;
const MAX_CONTEXT_CHARS = 12000;

const FOOD_SAFETY_KEYWORDS = [
  'temp', 'temperature', 'holding', 'cool', 'reheat', 'haccp',
  'safe', 'food safety', '165', '155', '145', '140', '41',
];
// High-precision triggers for the USDA ingredients bucket. Cold-loading
// the ingredients vectors costs ~20s on first hit, so generic words
// ('food', 'cook', 'how much') are deliberately excluded — false
// positives would burn that latency for non-ingredient questions.
// Keep this list disjoint from FOOD_SAFETY_KEYWORDS; both gates can
// fire on the same question, but the wording shouldn't be ambiguous
// enough that a single word lights both up.
const INGREDIENT_KEYWORDS = [
  'ingredient', 'protein', 'calorie', 'kcal', 'carb', 'fiber',
  'sodium', 'sugar', 'grams', 'gluten', 'vegan', 'vegetarian',
  'nutrition', 'allergen', 'substitute', 'yield', 'shrinkage',
  'total lipid', 'total fat',
];
const HISTORY_KEYWORDS = ['often', 'history', 'frequent', 'always', 'most', 'past'];
const VENDOR_KEYWORDS = [
  'sysco', 'vendor', 'order', 'supplier', 'brand', 'purchase', 'catalog', 'case',
];
const LABOR_KEYWORDS = [
  'labor', 'staff', 'schedule', '7shift', 'hours', 'overtime',
];
const GOLD_STAR_KEYWORDS = [
  'recognition', 'gold star', 'gold', 'award', 'praise', 'kudos', 'star',
];
const PERFORMANCE_KEYWORDS = [
  'review', 'performance', 'evaluation', 'metric', 'rating', 'feedback', 'appraisal',
];
const EQUIPMENT_KEYWORDS = [
  // Status / maintenance triggers (original set).
  'equipment', 'warranty', 'maintenance', 'service', 'broken', 'repair', 'down',
  // Spec / identity triggers — so "what model/serial/brand is X" trips the gate.
  'model', 'serial', 'spec', 'manufacturer', 'brand',
  // Low-collision equipment nouns, so plain "tell me about the walk-in" fires.
  // Deliberately NOT gated: 'oven' / 'range' / 'grill' / 'broiler' / 'make' —
  // they collide with cooking language ("preheat the oven", "orange" contains
  // "range", "make the sauce"). Those still resolve in renderEquipmentSpecs
  // once the gate is tripped by a spec/status word.
  'ice machine', 'ice maker', 'fryer', 'walk-in', 'walk in', 'freezer',
  'fridge', 'refrigerat', 'cooler', 'reach-in', 'prep table', 'lowboy',
  'dishwasher', 'dish machine', 'warewash', 'mixer', 'slicer', 'salamander',
  'griddle', 'flat top', 'convection', 'combi', 'steamer',
];
const CATERING_KEYWORDS = [
  'beo', 'catering', 'cater', 'wedding', 'event', 'buffet', 'banquet',
  'reception', 'rehearsal', 'birthday', 'party', 'graduation', 'shower',
];
const PREP_PLANNING_KEYWORDS = [
  'prep', 'pre-prep', 'pre prep', 'plate', 'plating', 'scale', 'portion',
];
// Manager-level legal / policy questions ground against the in-tree
// compliance index built by scripts/build-compliance-index.mjs from
// data/normalized/compliance_rules.jsonl. Keep the list narrow:
// the index is small but the index lookup is BM25-ranked text search,
// so generic words ("rule", "policy") would over-trigger noise.
const COMPLIANCE_KEYWORDS = [
  // Labor
  'overtime', 'wage', 'minimum wage', 'tip', 'tips', 'tipped',
  'sick leave', 'hfwa', 'meal break', 'rest break', 'comps order',
  'final paycheck', 'youth labor', 'minor', 'equal pay',
  // Liquor
  'liquor', 'alcohol', 'id check', 'fake id', 'underage',
  'visibly intoxicated', 'over-served', 'overserved', 'dram shop',
  'responsible vendor', 'refusal of service',
  // Security
  'bouncer', 'door security', 'use of force', 'detain', 'restrain',
  'patron search', 'bag check', 'eject', 'remove patron',
  // Cross-cutting
  'compliance', 'colorado law', 'cdle', 'cdor',
];

const STALE_BEO_WINDOW_DAYS = 2;
const REPEAT_86_WINDOW_DAYS = 7;
const REPEAT_86_MIN_DAYS = 3;
const WARRANTY_WINDOW_DAYS = 30;

const MAX_FAILED_LINE_ITEMS = 20;
const MAX_MISSING_SIGNOFFS = 10;
const MAX_EQUIPMENT_DOWN = 15;
const MAX_STALE_BEO = 20;
const MAX_REPEAT_86 = 10;
const MAX_GOLD_STARS = 10;
const MAX_PERFORMANCE_REVIEWS = 15;
const MAX_WARRANTIES = 10;
const MAX_EQUIPMENT_SPECS = 12;
const MAX_BEO_PREP_RECENT_EVENTS = 5;
const MAX_BEO_PREP_ITEM_HISTORY = 5;

const DAILY_SALES_TREND_WINDOW_DAYS = 7;

export interface ContextSource {
  type: string;
  detail: string;
}

export interface GroundedContext {
  contextText: string;
  sources: ContextSource[];
}

/**
 * Auth tier + future-extensibility knob for `buildGroundedContext`.
 *
 * The audit fix for GH #247 introduced this so the cook-tier (no PIN) and
 * manager-tier (signed PIN cookie) callers can drive the same context
 * pipeline with different visibility. New gates should default to "false"
 * (cook-tier) and widen only when `hasPin` is true.
 */
export interface BuildGroundedContextOpts {
  /**
   * True when the caller presented a valid signed PIN cookie. Gates the
   * manager-tier renderers (labor summary, sales velocity, daily sales
   * trend, performance reviews, gold stars) so an unauthenticated LAN
   * client cannot read regulated / HR / financial data via the LLM prompt.
   *
   * Defaults to `false` (cook-tier) — see the kitchen-assistant route for
   * the threading.
   */
  hasPin?: boolean;
}

/**
 * Coordinator: assembles every grounded context section into one prompt
 * blob. Per-section rendering is delegated to renderXxxContext() helpers
 * defined below; this function is only responsible for ordering, gating
 * conditional sections on keyword matches, and the final char-budget
 * truncation. See "Helpers" / "Render helpers" sections below for the
 * actual section logic.
 */
export async function buildGroundedContext(
  locationId: string,
  userQuestion: string,
  opts: BuildGroundedContextOpts = {}
): Promise<GroundedContext> {
  // The cook-tier path is the default. The route widens to manager-tier
  // only when `hasPinCookie(req)` returned true — see GH #247.
  const hasPin = opts.hasPin === true;
  const date = todayISO();
  const db = getDb();
  const sources: ContextSource[] = [];
  const qLower = (userQuestion || '').toLowerCase().trim();

  // Recipe selection: picked + subRecipes are also needed for the
  // up-front `recipes` source push, so the resolver stays inline.
  const recipes = getRecipes();
  const menu = getMenu();
  const allergenMatrix = getAllergenMatrix();
  const menuMatchedSlugs = resolveMenuItemsToRecipes(qLower, menu, recipes);
  const picked = pickRelevantRecipes(qLower, recipes, MAX_RECIPES_IN_CONTEXT, menuMatchedSlugs);
  const subRecipes = collectSubRecipes(picked, recipes);
  const stations = getStations();

  let text = `DATE: ${date} (shift_date in database)\nLOCATION_ID: ${locationId}\n\n`;
  const append = (section: { text: string; source: ContextSource | null }): void => {
    text += section.text;
    if (section.source) sources.push(section.source);
  };
  const appendMulti = (section: MultiSourceSection): void => {
    text += section.text;
    if (section.sources.length) sources.push(...section.sources);
  };

  // Source-push order mirrors the pre-refactor function exactly:
  //   eighty_six, inventory, signoffs, line_checks, recipes,
  //   staff_roster (during text build), then everything else in
  //   text-build order. Tests assert sources order, so this matters.
  const active86 = renderActive86s(db, locationId, date);
  const inventory = renderInventoryUpdates(db, locationId, date);
  const signoffs = renderStationSignoffs(db, locationId, date);
  const lineCheckProgress = renderLineCheckProgress(db, locationId, date, stations);
  if (active86.source) sources.push(active86.source);
  if (inventory.source) sources.push(inventory.source);
  if (signoffs.source) sources.push(signoffs.source);
  if (lineCheckProgress.source) sources.push(lineCheckProgress.source);
  if (picked.length) {
    sources.push({
      type: 'recipes',
      detail: [...picked, ...subRecipes].map((r) => r.name).join(', '),
    });
  }

  text += active86.text;
  text += inventory.text;
  append(renderStaffRoster(getStaff()));
  text += signoffs.text;
  text += lineCheckProgress.text;
  append(renderLineCheckFailures(db, locationId, date));
  append(renderMissingSignoffs(db, locationId, date, stations));
  append(renderEquipmentDown(db, locationId));
  append(renderRepeat86s(db, locationId));
  // Manager-tier (#247): sales aggregates reveal POS totals + per-item
  // velocity that an unauthenticated LAN client must not read. The
  // SOURCE_BOUNDARIES system prompt in lib/ollama.ts also lists "live
  // POS / Toast sales data" as NOT available — keeping these renderers
  // behind the PIN gate is what makes that promise true for cook-tier.
  if (hasPin) {
    append(renderSalesVelocity(db, locationId));
    append(renderDailySalesTrend(db, locationId, date));
  }
  text += renderRecipeBlock(picked, subRecipes, allergenMatrix);

  // ── Conditional sections (gated on keyword matches) ──────────────
  if (matchesKeywords(qLower, FOOD_SAFETY_KEYWORDS)) {
    appendMulti(await renderFoodSafetyContext(userQuestion, getFoodSafety()));
  }
  if (matchesKeywords(qLower, INGREDIENT_KEYWORDS)) {
    append(await renderUsdaIngredients(userQuestion));
  }
  if (matchesKeywords(qLower, HISTORY_KEYWORDS)) {
    append(renderHistorical86s(db, locationId));
  }
  appendMulti(renderBeoPrepHistory(db, locationId, qLower));
  if (matchesKeywords(qLower, VENDOR_KEYWORDS)) {
    append(renderVendorSummaryBlock(getVendorSummary()));
  }
  if (matchesKeywords(qLower, LABOR_KEYWORDS)) {
    if (hasPin) {
      append(renderLaborSummaryBlock(getLaborSummary()));
    } else {
      // Manager-tier (#247): never inject 7shifts labor cost / hours /
      // per-employee data into a cook-tier prompt. Replace with a sentinel
      // line so the LLM tells the cook to ask a manager rather than
      // hallucinating numbers from training data.
      text +=
        '\nLABOR SUMMARY: not available at this auth tier — tell the cook to ask a manager for labor figures.\n';
    }
  }
  if (matchesKeywords(qLower, COMPLIANCE_KEYWORDS)) {
    append(renderCompliance(userQuestion));
  }

  // ── BEO events + stale prep + order guide ────────────────────────
  append(renderBeoEvents(db, locationId, date));
  append(renderStaleBeoPrep(db, locationId, date));
  append(renderOrderGuide(db, locationId));

  if (matchesKeywords(qLower, GOLD_STAR_KEYWORDS)) {
    if (hasPin) {
      append(renderGoldStars(db, locationId));
    } else {
      text +=
        '\nGOLD STAR RECOGNITION: not available at this auth tier — tell the cook to ask a manager about recognition history.\n';
    }
  }
  if (matchesKeywords(qLower, PERFORMANCE_KEYWORDS)) {
    if (hasPin) {
      append(renderPerformanceReviews(db, locationId));
    } else {
      text +=
        '\nPERFORMANCE REVIEWS: not available at this auth tier — performance review data is manager-only.\n';
    }
  }
  if (matchesKeywords(qLower, EQUIPMENT_KEYWORDS)) {
    append(renderEquipmentSpecs(db, locationId, qLower));
    append(renderWarrantyAlerts(db, locationId));
  }

  // The trailing "not in this context" line is what the LLM uses to refuse
  // questions whose answer would require manager-tier data. It needs to
  // describe the *actual* injection for this tier, not a static superset —
  // otherwise the model learns to ignore SOURCE_BOUNDARIES from drift.
  text += hasPin
    ? '\nNOT IN THIS CONTEXT: live POS, vendor pricing, full menu engineering, items not listed above.\n'
    : '\nNOT IN THIS CONTEXT: live POS, Toast totals, vendor pricing, labor figures, recognition + performance review data, items not listed above.\n';

  // ── Context budget truncation ────────────────────────────────────
  if (text.length > MAX_CONTEXT_CHARS) {
    text = text.slice(0, MAX_CONTEXT_CHARS - 30) + '\n… [context truncated]\n';
  }

  return { contextText: text, sources };
}

// ── Helpers ──────────────────────────────────────────────────────────

function collectSubRecipes(picked: Recipe[], recipes: Recipe[]): Recipe[] {
  const subRecipeSlugs = new Set<string>();
  for (const r of picked) {
    for (const slug of r.sub_recipes || []) {
      if (!picked.some((p) => p.slug === slug)) subRecipeSlugs.add(slug);
    }
  }
  const out: Recipe[] = [];
  for (const slug of subRecipeSlugs) {
    const found = recipes.find((r) => r.slug === slug);
    if (found) out.push(found);
  }
  return out;
}

function resolveMenuItemsToRecipes(
  qLower: string,
  menu: { display_name: string }[],
  recipes: Recipe[]
): Set<string> {
  const matchedSlugs = new Set<string>();

  const mentionedMenuItems: string[] = [];
  for (const mi of menu) {
    const name = (mi.display_name || '').toLowerCase();
    if (name.length > 2 && qLower.includes(name)) {
      mentionedMenuItems.push(mi.display_name);
    }
  }

  for (const r of recipes) {
    for (const mi of r.menu_items || []) {
      const miLower = (mi || '').toLowerCase();
      if (miLower.length > 2 && qLower.includes(miLower)) {
        matchedSlugs.add(r.slug);
      }
    }
  }

  for (const miName of mentionedMenuItems) {
    for (const r of recipes) {
      for (const rmi of r.menu_items || []) {
        if (rmi.toLowerCase() === miName.toLowerCase()) {
          matchedSlugs.add(r.slug);
        }
      }
    }
  }

  return matchedSlugs;
}

function formatRecipeSnippet(r: Recipe, allergenMatrix: AllergenMatrix, isSub: boolean): string {
  const type = isSub ? 'SUB-RECIPE' : 'RECIPE';
  const allergens = (r.allergens || []).join(', ') || 'none tagged';
  const ing = (r.ingredients || [])
    .map((i) => `${i.item || ''} ${i.qty != null ? i.qty : ''} ${i.unit || ''}`.trim())
    .join('; ');
  const ingShort = ing.length > MAX_ING_CHARS ? `${ing.slice(0, MAX_ING_CHARS)}...` : ing;

  let out = `<${type} name="${r.name}" slug="${r.slug || 'no-slug'}">\n`;
  if (r.station) out += `  STATION: ${r.station}\n`;
  if (r.yield_qty) out += `  YIELD: ${r.yield_qty} ${r.yield_unit || ''}\n`;
  if (r.menu_items?.length) out += `  MENU ITEMS: ${r.menu_items.join(', ')}\n`;
  if (r.sub_recipes?.length) out += `  SUB-RECIPES: ${r.sub_recipes.join(', ')}\n`;
  out += `  ALLERGENS (TAGS): ${allergens}\n`;
  out += `  INGREDIENTS: ${ingShort}\n`;

  const matrixEntries = allergenMatrix[r.slug] || [];
  const flagged = matrixEntries.filter((e) => e.big9?.length);
  if (flagged.length) {
    out += `  ALLERGEN DETAIL (INGREDIENT-LEVEL):\n`;
    for (const entry of flagged) {
      out += `    ${entry.ingredient} -> ${(entry.big9 || []).join(', ')}\n`;
    }
  }
  
  out += `</${type}>\n\n`;

  return out;
}

function matchesKeywords(qLower: string, keywords: string[]): boolean {
  for (const kw of keywords) {
    if (qLower.includes(kw)) return true;
  }
  return false;
}

function pickRelevantRecipes(
  question: string,
  recipes: Recipe[],
  max: number,
  menuMatchedSlugs: Set<string>
): Recipe[] {
  const q = (question || '').toLowerCase().trim();
  if (!q || !recipes.length) return [];

  const words = [...new Set(q.split(/\W+/).filter((w) => w.length > 2))];
  const scored = recipes.map((r) => {
    let score = 0;

    if (menuMatchedSlugs.has(r.slug)) score += 15;

    const name = (r.name || '').toLowerCase();
    if (name && q.includes(name)) score += 12;
    for (const w of words) {
      if (name.includes(w)) score += 4;
    }

    for (const mi of r.menu_items || []) {
      const miLower = (mi || '').toLowerCase();
      if (miLower && q.includes(miLower)) score += 10;
      for (const w of words) {
        if (miLower.includes(w)) score += 3;
      }
    }

    const station = (r.station || '').toLowerCase();
    for (const w of words) {
      if (station.includes(w)) score += 2;
    }

    for (const i of r.ingredients || []) {
      const it = (i.item || '').toLowerCase();
      for (const w of words) {
        if (it.includes(w)) score += 2;
      }
    }

    for (const a of r.allergens || []) {
      if (q.includes(String(a).toLowerCase())) score += 5;
    }

    return { r, score };
  });

  const top = scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.r);

  if (top.length) return top;

  return recipes.filter((r) => nameMatches(r.name, q)).slice(0, max);
}

function nameMatches(name: string, q: string): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  for (let len = Math.min(24, q.length); len >= 4; len--) {
    const sub = q.slice(0, len);
    if (sub.length >= 4 && n.includes(sub)) return true;
  }
  return false;
}

// ── Oversight renderers ──────────────────────────────────────────────
//
// Each returns { text, source }. `text` is '' and `source` null when the
// section has no rows — the caller skips empty output to keep the prompt tight.

interface OversightSection {
  text: string;
  source: ContextSource | null;
}

function renderLineCheckFailures(db: DB, locationId: string, date: string): OversightSection {
  const rows = db
    .prepare(
      `SELECT station_id, item, note, cook_id FROM line_check_entries
       WHERE shift_date = ? AND location_id = ? AND status = 'fail'
       ORDER BY station_id, id ASC LIMIT ?`
    )
    .all(date, locationId, MAX_FAILED_LINE_ITEMS) as {
    station_id: string;
    item: string;
    note: string | null;
    cook_id: string | null;
  }[];
  if (!rows.length) return { text: '', source: null };
  let text = '\nLINE CHECK FAILURES (today, itemized — manager should address):\n';
  for (const r of rows) {
    const bits = [r.note, r.cook_id ? `by ${r.cook_id}` : null].filter(Boolean).join(' · ');
    text += `  - [${r.station_id}] ${r.item}${bits ? ` | ${bits}` : ''}\n`;
  }
  return { text, source: { type: 'line_check_failures', detail: `${rows.length} failure(s)` } };
}

function renderMissingSignoffs(
  db: DB,
  locationId: string,
  date: string,
  stations: Station[]
): OversightSection {
  const signedOff = new Set(
    (db
      .prepare(
        `SELECT DISTINCT station_id FROM station_signoffs
         WHERE shift_date = ? AND location_id = ?`
      )
      .all(date, locationId) as { station_id: string }[]).map((r) => r.station_id)
  );
  const missing = stations
    .filter((s) => s.line_check_key && !signedOff.has(s.id))
    .slice(0, MAX_MISSING_SIGNOFFS);
  if (!missing.length) return { text: '', source: null };
  let text = '\nSTATIONS WITHOUT SIGN-OFF (today — line-check stations only):\n';
  for (const s of missing) text += `  - ${s.name} (${s.id})\n`;
  return { text, source: { type: 'missing_signoffs', detail: `${missing.length} station(s)` } };
}

function renderEquipmentDown(db: DB, locationId: string): OversightSection {
  const rows = db
    .prepare(
      `SELECT e.id, e.name, e.category, e.status,
              m.service_date AS last_service_date, m.type AS last_service_type, m.notes AS last_service_notes
       FROM equipment e
       LEFT JOIN equipment_maintenance m
         ON m.equipment_id = e.id
         AND m.id = (SELECT MAX(id) FROM equipment_maintenance WHERE equipment_id = e.id)
       WHERE e.location_id = ? AND e.status != 'active'
       ORDER BY e.name ASC LIMIT ?`
    )
    .all(locationId, MAX_EQUIPMENT_DOWN) as {
    id: number;
    name: string;
    category: string;
    status: string;
    last_service_date: string | null;
    last_service_type: string | null;
    last_service_notes: string | null;
  }[];
  if (!rows.length) return { text: '', source: null };
  let text = '\nEQUIPMENT OUT OF SERVICE:\n';
  for (const r of rows) {
    text += `  - ${r.name} (${r.category}) — status: ${r.status}\n`;
    if (r.last_service_date) {
      const svcBits = [r.last_service_type, r.last_service_notes].filter(Boolean).join(' · ');
      text += `    last service: ${r.last_service_date}${svcBits ? ` (${svcBits})` : ''}\n`;
    }
  }
  return { text, source: { type: 'equipment_down', detail: `${rows.length} unit(s)` } };
}

function renderStaleBeoPrep(db: DB, locationId: string, date: string): OversightSection {
  const rows = db
    .prepare(
      `SELECT t.task, t.due_date, e.title, e.event_date, e.id AS event_id
       FROM beo_prep_tasks t
       JOIN beo_events e ON e.id = t.event_id
       WHERE t.location_id = ?
         AND t.done = 0
         AND date(e.event_date) >= date(?)
         AND date(e.event_date) <= date(?, '+' || ? || ' days')
       ORDER BY date(e.event_date) ASC, t.sort_order ASC
       LIMIT ?`
    )
    .all(locationId, date, date, STALE_BEO_WINDOW_DAYS, MAX_STALE_BEO) as {
    task: string;
    due_date: string | null;
    title: string;
    event_date: string;
    event_id: number;
  }[];
  if (!rows.length) return { text: '', source: null };
  let text = `\nSTALE BEO PREP (events within ${STALE_BEO_WINDOW_DAYS} day(s), still PENDING):\n`;
  for (const r of rows) {
    text += `  - [${r.event_date}] ${r.title} (BEO ${r.event_id}): ${r.task}\n`;
  }
  return { text, source: { type: 'beo_prep_stale', detail: `${rows.length} pending task(s)` } };
}

function renderRepeat86s(db: DB, locationId: string): OversightSection {
  const rows = db
    .prepare(
      `SELECT item, COUNT(DISTINCT shift_date) AS days
       FROM eighty_six
       WHERE location_id = ?
         AND date(shift_date) >= date('now', '-' || ? || ' days')
       GROUP BY item
       HAVING days >= ?
       ORDER BY days DESC, item ASC
       LIMIT ?`
    )
    .all(locationId, REPEAT_86_WINDOW_DAYS, REPEAT_86_MIN_DAYS, MAX_REPEAT_86) as {
    item: string;
    days: number;
  }[];
  if (!rows.length) return { text: '', source: null };
  let text = `\nREPEAT 86s (≥${REPEAT_86_MIN_DAYS} of last ${REPEAT_86_WINDOW_DAYS} days — systemic issue):\n`;
  for (const r of rows) text += `  - ${r.item}: 86'd ${r.days} day(s)\n`;
  return { text, source: { type: 'eighty_six_repeat', detail: `${rows.length} item(s)` } };
}

function renderGoldStars(db: DB, locationId: string): OversightSection {
  // Schema lives in initSchema (lib/db.ts) — do NOT run DDL in a read-path
  // helper. This was throwing when a caller wrapped buildGroundedContext in
  // a db.transaction (nested transactions not allowed on better-sqlite3).
  const rows = db
    .prepare(
      `SELECT cook_name, reason, stars, awarded_date FROM gold_stars
       WHERE location_id = ?
       ORDER BY id DESC LIMIT ?`
    )
    .all(locationId, MAX_GOLD_STARS) as {
    cook_name: string;
    reason: string;
    stars: number;
    awarded_date: string;
  }[];
  if (!rows.length) return { text: '', source: null };
  let text = '\nRECENT GOLD STARS (recognition):\n';
  for (const r of rows) {
    text += `  - [${r.awarded_date}] ${r.cook_name} (${r.stars}★): ${r.reason}\n`;
  }
  return { text, source: { type: 'gold_stars', detail: `${rows.length} recognition(s)` } };
}

function renderPerformanceReviews(db: DB, locationId: string): OversightSection {
  const rows = db
    .prepare(
      `SELECT cook_name, cook_uuid, review_date, punctuality_score, technique_score, speed_score, notes, reviewer_name
       FROM performance_reviews
       WHERE location_id = ?
       ORDER BY review_date DESC, id DESC LIMIT ?`
    )
    .all(locationId, MAX_PERFORMANCE_REVIEWS) as {
    cook_name: string;
    cook_uuid: string | null;
    review_date: string;
    punctuality_score: number;
    technique_score: number;
    speed_score: number;
    notes: string | null;
    reviewer_name: string;
  }[];
  if (!rows.length) return { text: '', source: null };
  let text = '\nRECENT PERFORMANCE REVIEWS (staff evaluations):\n';
  for (const r of rows) {
    const uuid = r.cook_uuid ? ` [uuid:${r.cook_uuid}]` : '';
    text += `  - [${r.review_date}] ${r.cook_name}${uuid} | scores: on-time=${r.punctuality_score}, tech=${r.technique_score}, speed=${r.speed_score} | by ${r.reviewer_name}`;
    if (r.notes) text += ` | notes: ${r.notes}`;
    text += '\n';
  }
  return { text, source: { type: 'performance_reviews', detail: `${rows.length} evaluation(s)` } };
}

function renderWarrantyAlerts(db: DB, locationId: string): OversightSection {
  const rows = db
    .prepare(
      `SELECT name, category, warranty_expiration FROM equipment
       WHERE location_id = ?
         AND warranty_expiration IS NOT NULL
         AND warranty_expiration != ''
         AND date(warranty_expiration) >= date('now')
         AND date(warranty_expiration) <= date('now', '+' || ? || ' days')
       ORDER BY date(warranty_expiration) ASC
       LIMIT ?`
    )
    .all(locationId, WARRANTY_WINDOW_DAYS, MAX_WARRANTIES) as {
    name: string;
    category: string;
    warranty_expiration: string;
  }[];
  if (!rows.length) return { text: '', source: null };
  let text = `\nWARRANTY EXPIRATIONS (next ${WARRANTY_WINDOW_DAYS} days):\n`;
  for (const r of rows) {
    text += `  - ${r.name} (${r.category}) — expires ${r.warranty_expiration}\n`;
  }
  return { text, source: { type: 'warranty_alerts', detail: `${rows.length} item(s)` } };
}

// Maps regular-English equipment terms to precise SQL filters. Category
// matches (Fryers / Ovens / Refrigeration) are high-precision; ice and dish
// units use full-phrase NAME matches so a bare "ice" can't drag in
// "Choice" / "Dicer" / "Device" line items. `cat:` → category LIKE,
// everything else → name LIKE.
const EQUIPMENT_SPEC_SYNONYMS: { phrases: string[]; likes: string[] }[] = [
  { phrases: ['fryer'], likes: ['cat:fryers', 'name:fryer'] },
  { phrases: ['oven', 'convection', 'combi'], likes: ['cat:ovens', 'name:oven'] },
  { phrases: ['salamander', 'griddle', 'flat top', 'broiler'], likes: ['name:griddle', 'name:salamander', 'name:broiler'] },
  { phrases: ['steamer'], likes: ['name:steamer'] },
  { phrases: ['mixer'], likes: ['name:mixer'] },
  { phrases: ['slicer'], likes: ['name:slicer'] },
  { phrases: ['dishwasher', 'dish machine', 'warewash'], likes: ['name:dishwash', 'name:dish machine', 'name:warewash'] },
  {
    phrases: ['walk-in', 'walk in', 'freezer', 'fridge', 'refrigerat', 'cooler', 'reach-in', 'prep table', 'lowboy'],
    likes: ['cat:refrigeration', 'name:freezer', 'name:cooler'],
  },
  { phrases: ['ice machine', 'ice maker', 'ice bin', 'ice cuber'], likes: ['name:ice machine', 'name:ice maker', 'name:ice bin'] },
];

/**
 * Deterministic backstop to the `equipment_lookup` db_query: when the cook
 * asks about a specific unit ("what model is the fryer", "serial of the
 * walk-in"), inject the matching specs straight into CONTEXT so the answer
 * doesn't hinge on the small model choosing to call the analytical tool.
 * Returns empty when the question only carries a generic status word
 * (e.g. "is anything broken?") — renderEquipmentDown / renderWarrantyAlerts
 * cover those.
 */
function renderEquipmentSpecs(db: DB, locationId: string, qLower: string): OversightSection {
  const nameLikes = new Set<string>();
  const catLikes = new Set<string>();
  for (const grp of EQUIPMENT_SPEC_SYNONYMS) {
    if (!grp.phrases.some((p) => qLower.includes(p))) continue;
    for (const l of grp.likes) {
      if (l.startsWith('cat:')) catLikes.add(l.slice(4));
      else nameLikes.add(l.slice(5));
    }
  }
  if (!nameLikes.size && !catLikes.size) return { text: '', source: null };

  const clauses: string[] = [];
  const binds: (string | number)[] = [locationId];
  for (const c of catLikes) {
    clauses.push('lower(category) LIKE ?');
    binds.push(`%${c}%`);
  }
  for (const n of nameLikes) {
    clauses.push('lower(name) LIKE ?');
    binds.push(`%${n}%`);
  }
  binds.push(MAX_EQUIPMENT_SPECS);

  const rows = db
    .prepare(
      `SELECT name, category, make_model, model_number, status, vendor
       FROM equipment
       WHERE location_id = ? AND (${clauses.join(' OR ')})
       ORDER BY name ASC LIMIT ?`
    )
    .all(...binds) as {
    name: string;
    category: string;
    make_model: string | null;
    model_number: string | null;
    status: string;
    vendor: string | null;
  }[];
  if (!rows.length) return { text: '', source: null };

  let text = '\nEQUIPMENT SPECS (matched to your question):\n';
  for (const r of rows) {
    const model = r.make_model || r.model_number || 'no model on file';
    const extras = [
      r.status && r.status !== 'active' ? `status: ${r.status}` : null,
      r.vendor ? `vendor: ${r.vendor}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    text += `  - ${r.name} (${r.category}) — model: ${model}${extras ? ` · ${extras}` : ''}\n`;
  }
  return { text, source: { type: 'equipment_specs', detail: `${rows.length} unit(s)` } };
}

// ── Always-on / coordinator render helpers ──────────────────────────
//
// Each block extracted from the inline body of buildGroundedContext.
// All return { text, source } (or MultiSourceSection where multiple
// pushes are needed). Pure where possible — DB-backed helpers take
// the better-sqlite3 handle so tests can drive an in-memory DB.

/**
 * Active 86s for the given shift_date. Always emits a header (and a
 * source row reporting the count, including zero) — the absence of
 * 86s is itself signal for the assistant.
 */
export function renderActive86s(
  db: DB,
  locationId: string,
  date: string
): OversightSection {
  const rows = db
    .prepare(
      `SELECT item, station_id, reason, quantity, created_at FROM eighty_six
       WHERE shift_date = ? AND resolved_at IS NULL AND location_id = ?
       ORDER BY id DESC LIMIT ?`
    )
    .all(date, locationId, MAX_86) as {
    item: string;
    station_id: string | null;
    reason: string | null;
    quantity: string | null;
    created_at: string;
  }[];
  let text = 'ACTIVE 86 (unresolved, today):\n';
  if (!rows.length) text += '  (none)\n';
  else {
    for (const e of rows) {
      text += `  - ${e.item}${e.station_id ? ` @ ${e.station_id}` : ''}${e.reason ? ` | ${e.reason}` : ''}${e.quantity ? ` | qty ${e.quantity}` : ''}\n`;
    }
  }
  return { text, source: { type: 'eighty_six', detail: `${rows.length} active (today)` } };
}

/**
 * Recent inventory updates for the shift_date. Same always-on contract
 * as renderActive86s — emits header even when empty so the prompt's
 * structure stays predictable.
 */
export function renderInventoryUpdates(
  db: DB,
  locationId: string,
  date: string
): OversightSection {
  const rows = db
    .prepare(
      `SELECT item, direction, delta, station_id, note, created_at FROM inventory_updates
       WHERE shift_date = ? AND location_id = ?
       ORDER BY id DESC LIMIT ?`
    )
    .all(date, locationId, MAX_INV) as {
    item: string;
    direction: string | null;
    delta: string | null;
    station_id: string | null;
    note: string | null;
    created_at: string;
  }[];
  let text = '\nRECENT INVENTORY UPDATES (today, newest first):\n';
  if (!rows.length) text += '  (none)\n';
  else {
    for (const u of rows) {
      const bits = [u.direction, u.delta, u.station_id, u.note].filter(Boolean).join(' · ');
      text += `  - ${u.item}${bits ? ` | ${bits}` : ''}\n`;
    }
  }
  return { text, source: { type: 'inventory', detail: `${rows.length} rows (today)` } };
}

/**
 * Station sign-offs for the day. Always-on; the LLM uses this to
 * reason about station coverage and who closed what.
 */
export function renderStationSignoffs(
  db: DB,
  locationId: string,
  date: string
): OversightSection {
  const rows = db
    .prepare(
      `SELECT station_id, cook_id, created_at FROM station_signoffs
       WHERE shift_date = ? AND location_id = ? ORDER BY id ASC`
    )
    .all(date, locationId) as {
    station_id: string;
    cook_id: string;
    created_at: string;
  }[];
  let text = '\nSTATION SIGN-OFFS (today):\n';
  if (!rows.length) text += '  (none)\n';
  else {
    for (const so of rows) {
      text += `  - ${so.station_id} by ${so.cook_id}\n`;
    }
  }
  return { text, source: { type: 'signoffs', detail: `${rows.length} sign-off(s) (today)` } };
}

/**
 * Per-station line-check progress (checked vs template count, fail
 * count). Reads station list + per-station JSON cache template and
 * cross-references against line_check_entries rows. Always emits
 * the header even when zero stations have templates loaded.
 */
export function renderLineCheckProgress(
  db: DB,
  locationId: string,
  date: string,
  stations: Station[]
): OversightSection {
  interface LineSummary {
    station: string;
    station_id: string;
    checked: number;
    total: number;
    fail: number;
  }
  const lineSummary: LineSummary[] = [];
  for (const s of stations) {
    if (!s.line_check_key) continue;
    const template = getLineCheckTemplate(s.line_check_key);
    if (!template.length) continue;
    const rows = db
      .prepare(
        `SELECT item, status FROM line_check_entries
         WHERE shift_date = ? AND station_id = ? AND location_id = ?
         ORDER BY id ASC`
      )
      .all(date, s.id, locationId) as { item: string; status: string }[];
    const byItem = new Map<string, string>();
    for (const r of rows) byItem.set(r.item, r.status);
    let done = 0;
    let fail = 0;
    for (const item of template) {
      const st = byItem.get(item);
      if (st === 'pass' || st === 'fail' || st === 'na') {
        done++;
        if (st === 'fail') fail++;
      }
    }
    lineSummary.push({
      station: s.name,
      station_id: s.id,
      checked: done,
      total: template.length,
      fail,
    });
  }
  let text = '\nLINE CHECK PROGRESS (today, from database vs template counts):\n';
  for (const ls of lineSummary) {
    text += `  - ${ls.station} (${ls.station_id}): ${ls.checked}/${ls.total} items recorded`;
    if (ls.fail) text += `, ${ls.fail} fail`;
    text += '\n';
  }
  return {
    text,
    source: { type: 'line_checks', detail: `${lineSummary.length} station(s) with templates` },
  };
}

/**
 * Active staff roster (filters out members with active === false).
 * Pure — takes the loaded staff list as a parameter so tests can drive
 * it without touching the JSON cache. Returns an empty section when
 * no active staff are present (the original was conditional on
 * roster.length too).
 */
export function renderStaffRoster(staff: StaffMember[]): OversightSection {
  const roster = staff.filter((s) => s.active !== false);
  if (!roster.length) return { text: '', source: null };
  let text =
    '\nACTIVE STAFF ROSTER (Use exact full names for Gold Stars or HR actions):\n';
  for (const s of roster) {
    text += `  - ${s.first} ${s.last} (ID: ${s.id})\n`;
  }
  return { text, source: { type: 'staff_roster', detail: `${roster.length} active staff` } };
}

/**
 * Top-15 sales velocity by item_name across the location's full
 * sales_lines history. Conditional in the original — empty rows
 * skip the header.
 */
export function renderSalesVelocity(db: DB, locationId: string): OversightSection {
  const rows = db
    .prepare(
      `SELECT item_name, SUM(quantity_sold) as qty FROM sales_lines
       WHERE location_id = ?
       GROUP BY item_name ORDER BY qty DESC LIMIT 15`
    )
    .all(locationId) as { item_name: string; qty: number }[];
  if (!rows.length) return { text: '', source: null };
  let text = '\nSALES VELOCITY (Historical volume to calculate dynamic prep against):\n';
  for (const s of rows) {
    if (s.qty) text += `  - ${s.item_name}: ${Math.round(s.qty)} units sold\n`;
  }
  return { text, source: { type: 'sales_velocity', detail: 'Top 15 items' } };
}

/**
 * Recipe XML block (recipes + sub-recipes). Pure — takes the already-
 * resolved selection as input. Recipe selection itself stays inline
 * in the coordinator because the resolver outputs (`picked`,
 * `subRecipes`) are also needed for the up-front `recipes` source push.
 */
function renderRecipeBlock(
  picked: Recipe[],
  subRecipes: Recipe[],
  allergenMatrix: AllergenMatrix
): string {
  let text =
    '\nRECIPES (Isolated in XML tags - do not cross-reference ingredients between tags):\n';
  if (!picked.length) {
    text += '  (no recipe matched — do not invent recipe or allergen facts)\n';
    return text;
  }
  for (const r of picked) text += formatRecipeSnippet(r, allergenMatrix, false);
  if (subRecipes.length) {
    text += '  SUB-RECIPES (referenced by above):\n';
    for (const r of subRecipes) text += formatRecipeSnippet(r, allergenMatrix, true);
  }
  return text;
}

/**
 * HACCP / FDA Food Code grounding. The original gated both the
 * operational CCP block (from data/cache/food_safety.json) and the
 * regulatory FDA Food Code block (from the data pack) on a single
 * FOOD_SAFETY_KEYWORDS check. We preserve that coupling here so the
 * coordinator only has one branch.
 *
 * Async because renderFdaFoodCode awaits BGE on the embedding channel.
 * Returns MultiSourceSection because it can push two sources
 * (food_safety + fda_food_code) when both blocks fire.
 */
export async function renderFoodSafetyContext(
  userQuestion: string,
  safety: FoodSafetyData
): Promise<MultiSourceSection> {
  let text = '';
  const sources: ContextSource[] = [];
  const ccpBlock = renderHaccpCcps(safety);
  text += ccpBlock.text;
  if (ccpBlock.source) sources.push(ccpBlock.source);
  const fda = await renderFdaFoodCode(userQuestion);
  text += fda.text;
  if (fda.source) sources.push(fda.source);
  return { text, sources };
}

/**
 * HACCP CCP block from the static food_safety.json cache. Pure — takes
 * the loaded FoodSafetyData object so tests can drive a small fixture
 * without touching the JSON cache.
 */
export function renderHaccpCcps(safety: FoodSafetyData): OversightSection {
  const ccps = safety.ccps || [];
  if (!ccps.length) return { text: '', source: null };
  let text = '\nHACCP CRITICAL CONTROL POINTS:\n';
  for (const c of ccps) {
    text += `  - [${c.ccp_id}] ${c.critical_control_point}\n`;
    text += `    hazard: ${c.hazard} | limit: ${c.critical_limit}\n`;
    text += `    monitor: ${c.monitoring_procedure}\n`;
    text += `    corrective: ${c.corrective_action}\n`;
  }
  return { text, source: { type: 'food_safety', detail: `${ccps.length} CCP(s)` } };
}

/**
 * Lifetime 86 frequency aggregation. Conditional — only fires when
 * the question matches HISTORY_KEYWORDS in the coordinator. Returns
 * empty when no historical 86s exist.
 */
export function renderHistorical86s(db: DB, locationId: string): OversightSection {
  const rows = db
    .prepare(
      `SELECT item, COUNT(*) as freq FROM eighty_six
       WHERE location_id = ?
       GROUP BY item ORDER BY freq DESC LIMIT 15`
    )
    .all(locationId) as { item: string; freq: number }[];
  if (!rows.length) return { text: '', source: null };
  let text = '\nHISTORICAL 86 FREQUENCY (Lifetime):\n';
  for (const h of rows) {
    text += `  - ${h.item}: 86'd ${h.freq} times\n`;
  }
  return {
    text,
    source: { type: 'eighty_six_history', detail: `Top ${rows.length} flagged` },
  };
}

/**
 * Vendor / Sysco recent-items block. Pure — takes the loaded
 * VendorSummary cache object. Renders the first 15 sysco items plus
 * the optional last_invoice_date footer. Empty / missing summary →
 * graceful no-op.
 */
export function renderVendorSummaryBlock(
  vendor: VendorSummary | null
): OversightSection {
  if (!vendor?.sysco?.recent_items?.length) return { text: '', source: null };
  const items = vendor.sysco.recent_items.slice(0, 15);
  let text = '\nSYSCO RECENT ITEMS (top 15):\n';
  for (const v of items) {
    const parts = [
      v.description,
      v.category,
      v.pack_size,
      v.price != null ? `$${v.price}` : null,
    ]
      .filter(Boolean)
      .join(' | ');
    text += `  - ${parts}\n`;
  }
  if (vendor.sysco.last_invoice_date) {
    text += `  last invoice: ${vendor.sysco.last_invoice_date}\n`;
  }
  return {
    text,
    source: { type: 'vendor_summary', detail: `${items.length} Sysco item(s)` },
  };
}

/**
 * Labor summary block (period totals + by-role + top-10 employees by
 * hours). Pure — takes the loaded LaborSummary cache object. Falls
 * back to "loaded" detail when period is missing (matches the
 * pre-refactor behaviour exactly).
 */
export function renderLaborSummaryBlock(
  labor: LaborSummary | null
): OversightSection {
  if (!labor) return { text: '', source: null };
  let text = '\nLABOR SUMMARY (from 7shifts export):\n';
  text += `  period: ${labor.period || 'n/a'}\n`;
  text += `  net sales: $${(labor.net_sales || 0).toLocaleString()}\n`;
  text += `  labor cost: $${(labor.labor_cost || 0).toLocaleString()} (${((labor.labor_pct_net || 0) * 100).toFixed(1)}% of net)\n`;
  if (labor.splh_net) text += `  SPLH (net): $${labor.splh_net}\n`;
  if (labor.by_role?.length) {
    text += '  by role:\n';
    for (const r of labor.by_role) {
      const otHrs = r.ot_hours || 0;
      const ot = otHrs > 0 ? ` (${otHrs.toFixed(0)} OT)` : '';
      text += `    - ${r.job_title || r.role}: ${(r.total_hours || 0).toFixed(0)} hrs${ot}, $${(r.total_cost || 0).toLocaleString()} (${((r.labor_pct_net || 0) * 100).toFixed(1)}% net)\n`;
    }
  }
  if (labor.by_employee?.length) {
    text += '  by employee (top 10 by hours):\n';
    const sorted = [...labor.by_employee]
      .sort((a, b) => (b.total_hours || 0) - (a.total_hours || 0))
      .slice(0, 10);
    for (const e of sorted) {
      const eOtHrs = e.ot_hours || 0;
      const ot = eOtHrs > 0 ? ` (${eOtHrs.toFixed(0)} OT)` : '';
      text += `    - ${e.first_name} ${e.last_name} (${e.job_title}): ${(e.total_hours || 0).toFixed(0)} hrs${ot}, $${(e.total_cost || 0).toLocaleString()}\n`;
    }
  }
  return {
    text,
    source: { type: 'labor_summary', detail: labor.period || 'loaded' },
  };
}

/**
 * Upcoming BEO events (banquets / parties) in the next window plus
 * their prep tasks. Conditional — empty / no upcoming events skip
 * the header.
 */
export function renderBeoEvents(
  db: DB,
  locationId: string,
  date: string
): OversightSection {
  const beos = db
    .prepare(
      `SELECT * FROM beo_events WHERE location_id = ?
         AND date(event_date) >= date(?)
         ORDER BY event_date ASC LIMIT 5`
    )
    .all(locationId, date) as {
    id: number;
    title: string;
    event_date: string;
    guest_count: number;
    notes: string;
  }[];
  if (!beos.length) return { text: '', source: null };
  let text = '\nUPCOMING BANQUETS & PARTIES (BEO):\n';
  const beoIds = beos.map((b) => b.id);
  // SQLite rejects `IN ()`; the outer beos.length guard above ensures
  // beoIds is non-empty, but a defensive short-circuit here lets the
  // query shape stay stable if this block is ever called on an empty list.
  const placeholders = beoIds.map(() => '?').join(',');
  const allTasks = beoIds.length
    ? (db
        .prepare(
          `SELECT * FROM beo_prep_tasks WHERE event_id IN (${placeholders}) ORDER BY sort_order`
        )
        .all(...beoIds) as { event_id: number; task: string; done: number }[])
    : [];
  for (const b of beos) {
    text += `  - [BEO ID: ${b.id}] ${b.title} on ${b.event_date} (Covers: ${b.guest_count || 'TBD'})\n`;
    if (b.notes) text += `    Notes: ${b.notes}\n`;
    const pts = allTasks.filter((t) => t.event_id === b.id);
    if (pts.length) {
      text += `    Prep List:\n`;
      for (const pt of pts) {
        text += `      [${pt.done ? 'DONE' : 'PENDING'}] ${pt.task}\n`;
      }
    } else {
      text += `    Prep List: (none yet)\n`;
    }
  }
  return {
    text,
    source: { type: 'beo_events', detail: `${beos.length} upcoming party(s)` },
  };
}

/**
 * Order guide (top 20 items by ingredient name). Conditional — empty
 * order_guide_items skip the header.
 */
export function renderOrderGuide(db: DB, locationId: string): OversightSection {
  const rows = db
    .prepare(
      `SELECT * FROM order_guide_items WHERE location_id = ?
       ORDER BY ingredient LIMIT 20`
    )
    .all(locationId) as { ingredient: string; base_qty: number; unit: string }[];
  if (!rows.length) return { text: '', source: null };
  let text = '\nORDER GUIDE (Items required for upcoming sysco drops):\n';
  for (const og of rows) {
    text += `  - ${og.ingredient} (Target: ${og.base_qty} ${og.unit})\n`;
  }
  return { text, source: { type: 'order_guide', detail: `${rows.length} item(s)` } };
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtInt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

// YoY join works because Toast exports group 2 rows whose shift_date is
// exactly one calendar year before the matching group 1 row.
export function renderDailySalesTrend(
  db: DB,
  locationId: string,
  date: string
): OversightSection {
  const rows = db
    .prepare(
      `SELECT g1.shift_date, g1.net_sales, g1.orders, g1.guests,
              g2.net_sales AS yoy_net_sales,
              g2.orders    AS yoy_orders,
              g2.guests    AS yoy_guests
       FROM toast_sales_daily g1
       LEFT JOIN toast_sales_daily g2
         ON g2.location_id = g1.location_id
        AND g2.comparison_group = 2
        AND date(g2.shift_date) = date(g1.shift_date, '-1 year')
       WHERE g1.location_id = ?
         AND g1.comparison_group = 1
         AND date(g1.shift_date) <= date(?)
         AND date(g1.shift_date) >= date(?, '-' || ? || ' days')
       ORDER BY g1.shift_date DESC
       LIMIT ?`
    )
    .all(
      locationId,
      date,
      date,
      DAILY_SALES_TREND_WINDOW_DAYS,
      DAILY_SALES_TREND_WINDOW_DAYS
    ) as {
    shift_date: string;
    net_sales: number | null;
    orders: number | null;
    guests: number | null;
    yoy_net_sales: number | null;
    yoy_orders: number | null;
    yoy_guests: number | null;
  }[];
  if (!rows.length) return { text: '', source: null };

  let text = `\nDAILY SALES TREND (last ${DAILY_SALES_TREND_WINDOW_DAYS} days, Toast):\n`;
  let yoyMatches = 0;
  for (const r of rows) {
    const base = `${fmtUsd(r.net_sales)} / ${fmtInt(r.orders)} orders / ${fmtInt(r.guests)} guests`;
    let yoy = '';
    if (r.yoy_net_sales != null || r.yoy_orders != null || r.yoy_guests != null) {
      yoyMatches += 1;
      const yoyBase = `${fmtUsd(r.yoy_net_sales)} / ${fmtInt(r.yoy_orders)} / ${fmtInt(r.yoy_guests)}`;
      let deltaPct = '';
      if (r.net_sales != null && r.yoy_net_sales != null && r.yoy_net_sales !== 0) {
        const pct = ((r.net_sales - r.yoy_net_sales) / r.yoy_net_sales) * 100;
        const sign = pct >= 0 ? '+' : '';
        deltaPct = `, ${sign}${pct.toFixed(1)}% YoY`;
      }
      yoy = ` (YoY: ${yoyBase}${deltaPct})`;
    }
    text += `  - ${r.shift_date}: ${base}${yoy}\n`;
  }
  const detail =
    yoyMatches > 0
      ? `${rows.length} day(s), ${yoyMatches} with YoY`
      : `${rows.length} day(s)`;
  return { text, source: { type: 'daily_sales_trend', detail } };
}

interface MultiSourceSection {
  text: string;
  sources: ContextSource[];
}

// ── FDA Food Code grounding ─────────────────────────────────────────
//
// Pulls the top-N most relevant sections from the off-tree data pack's
// fda_food_code_sections table whenever a food-safety question hits
// the FOOD_SAFETY_KEYWORDS gate. The data pack lives on an external
// SSD and is absent on most dev machines / in CI; in that case
// `datapackSearch.available()` returns false and this helper silently
// no-ops with `{text:'', source:null}` so the rest of the context
// builder is unaffected.
//
// Retrieval uses datapackSearch.hybrid() over the safety bucket: BM25
// + BGE-small cosine fused via reciprocal-rank-fusion. Hybrid handles
// natural-language questions ("what's the cooking temp for chicken?")
// directly — the previous FTS-only path needed a token-OR workaround
// because phrasing the whole question as one FTS5 phrase yielded zero
// hits.
//
// Body text is truncated to MAX_FDA_BODY_CHARS so a single hit
// (some sections have ~10k-char Annex 3 commentary) can't blow past
// the overall MAX_CONTEXT_CHARS budget. Hits are deduped by
// section_id because the corpus has paired regulatory + Annex 3
// entries with the same id; we keep the first (= best fused) match.

const MAX_FDA_HITS = 3;
const MAX_FDA_BODY_CHARS = 1200;

interface DatapackSearchDeps {
  available: () => boolean;
  hybrid: typeof datapackSearch.hybrid;
  getFdaSection: typeof datapackSearch.getFdaSection;
}

/**
 * Truncate a string to at most `n` UTF-16 code units while avoiding
 * splitting a surrogate pair (which would otherwise leave a lone high
 * surrogate at the tail and corrupt downstream UTF-8 encoding).
 * The FDA corpus is ASCII so this is defensive, not load-bearing.
 */
function truncateSafe(s: string, n: number): string {
  if (s.length <= n) return s;
  let end = n;
  const code = s.charCodeAt(end - 1);
  // Lone high surrogate at the tail — drop it.
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${s.slice(0, end)}…`;
}

/**
 * Pull a string field from a hybrid hit. Hybrid hits surface either
 * the FTS envelope (when both channels matched a row) or the
 * per-bucket semantic metadata envelope (when only the embedding
 * side scored it). The two name fields differently — `subtitle`
 * (FTS) vs `section_id` (semantic) for the FDA section id, etc. —
 * so we look up each field by both names and return the first
 * non-empty hit.
 */
function pickHybridField(
  h: HybridHit,
  ...candidates: string[]
): string {
  for (const k of candidates) {
    const v = h[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * Render the FDA Food Code grounding block. Exported so tests can
 * exercise it directly without spinning up the full grounded-context
 * graph. `deps` is an injection seam for tests — production callers
 * should always use the default real datapackSearch module.
 *
 * Async because hybrid retrieval needs to await the BGE model
 * (transformers.js, ONNX) on the embedding channel; the FTS channel
 * is synchronous but we await both together via Promise.all inside
 * datapackSearch.hybrid().
 */
export async function renderFdaFoodCode(
  question: string,
  deps: DatapackSearchDeps = datapackSearch
): Promise<OversightSection> {
  if (!deps.available()) return { text: '', source: null };

  const trimmed = (question || '').trim();
  if (!trimmed) return { text: '', source: null };

  // Hybrid retrieval handles natural-language questions directly —
  // datapackSearch.hybrid() runs the FTS query through escapeFtsPhrase
  // internally, so we never pass raw user text to the FTS5 parser.
  const hits = await deps.hybrid(trimmed, {
    bucket: 'safety',
    // Pull more than MAX_FDA_HITS so the dedupe-by-section_id pass
    // below has room: the safety bucket frequently surfaces paired
    // regulatory + Annex 3 entries with the same section_id, and we
    // keep only the first (highest-RRF) per pair.
    limit: MAX_FDA_HITS * 2,
  });
  if (!hits.length) return { text: '', source: null };

  // Dedupe by section_id. Hybrid hits are pre-sorted by descending
  // RRF score, so first-write wins keeps the better fused match.
  const seen = new Set<string>();
  const unique: HybridHit[] = [];
  for (const h of hits) {
    const sectionId = pickHybridField(h, 'subtitle', 'section_id');
    if (sectionId && seen.has(sectionId)) continue;
    if (sectionId) seen.add(sectionId);
    unique.push(h);
    if (unique.length >= MAX_FDA_HITS) break;
  }
  if (!unique.length) return { text: '', source: null };

  let text = '\nFDA FOOD CODE (regulatory text — cite § when answering):\n';
  for (const h of unique) {
    const sectionId = pickHybridField(h, 'subtitle', 'section_id') || '(no §)';
    const title = pickHybridField(h, 'title') || '(untitled)';
    const where = pickHybridField(h, 'extra', 'chapter', 'annex');
    // The hybrid hit's id field varies — FTS envelope uses `id`,
    // semantic envelope uses `rowid`. Either way, we want the
    // INTEGER fda_food_code_sections.rowid for the body lookup.
    const rowidRaw = h.id ?? h.rowid;
    const rowid = typeof rowidRaw === 'number' ? rowidRaw : Number(rowidRaw);
    const sec = Number.isFinite(rowid)
      ? ((deps.getFdaSection({ rowid }) as FdaSection | null) ?? null)
      : null;
    const body = sec?.body ? truncateSafe(sec.body, MAX_FDA_BODY_CHARS) : '';
    text += `  - [§ ${sectionId}] ${title}${where ? ` (${where})` : ''}\n`;
    if (body) text += `    ${body.replace(/\n/g, '\n    ')}\n`;
  }

  return {
    text,
    source: { type: 'fda_food_code', detail: `${unique.length} section(s)` },
  };
}

// Surfaces past catering-event prep data from beo_prep_history.
//   (a) catering/prep keyword → recent events summary so the AI can
//       reason about scaling baselines and what we typically prep.
//   (b) any prior prep item name appears in the question → surface
//       that item's prep history (last N events that prepped it) so
//       the AI can reference past prep_day / pre_prep / plating notes.
// Both branches are best-effort — silently empty if the table has no
// matches. qLower must already be lowercased + trimmed.
export function renderBeoPrepHistory(
  db: DB,
  locationId: string,
  qLower: string
): MultiSourceSection {
  let text = '';
  const sources: ContextSource[] = [];

  const isCateringQ =
    matchesKeywords(qLower, CATERING_KEYWORDS) ||
    matchesKeywords(qLower, PREP_PLANNING_KEYWORDS);

  if (isCateringQ) {
    const recentEvents = db
      .prepare(
        `SELECT client, event_date,
                GROUP_CONCAT(item || ' (' || COALESCE(amount_qty, '?') || ')', ', ') AS items
           FROM (
             SELECT client, event_date, item, amount_qty
               FROM beo_prep_history
              WHERE location_id = ? AND event_date IS NOT NULL
                AND (type IS NULL OR type = 'Main Item')
              ORDER BY event_date DESC, id ASC
           )
           GROUP BY client, event_date
           ORDER BY event_date DESC
           LIMIT ?`
      )
      .all(locationId, MAX_BEO_PREP_RECENT_EVENTS) as {
      client: string | null;
      event_date: string;
      items: string;
    }[];
    if (recentEvents.length) {
      text += '\nRECENT BEO EVENTS (prep history, most recent first):\n';
      for (const ev of recentEvents) {
        const who = ev.client || 'unknown client';
        text += `  - ${ev.event_date} ${who}: ${ev.items}\n`;
      }
      sources.push({
        type: 'beo_prep_history_recent',
        detail: `${recentEvents.length} event(s)`,
      });
    }
  }

  if (qLower.length >= 4) {
    const itemHits = db
      .prepare(
        `SELECT DISTINCT item FROM beo_prep_history
          WHERE location_id = ? AND item IS NOT NULL`
      )
      .all(locationId) as { item: string }[];
    const matched = itemHits
      .filter((r) => r.item && qLower.includes(r.item.toLowerCase()))
      .map((r) => r.item);
    if (matched.length) {
      const placeholders = matched.map(() => '?').join(',');
      const detail = db
        .prepare(
          `SELECT item, client, event_date, amount_qty,
                  pre_prep_notes, plating_notes, prep_day
             FROM beo_prep_history
            WHERE location_id = ?
              AND item IN (${placeholders})
            ORDER BY (event_date IS NULL), event_date DESC, id DESC
            LIMIT ?`
        )
        .all(locationId, ...matched, MAX_BEO_PREP_ITEM_HISTORY) as {
        item: string;
        client: string | null;
        event_date: string | null;
        amount_qty: string | null;
        pre_prep_notes: string | null;
        plating_notes: string | null;
        prep_day: string | null;
      }[];
      if (detail.length) {
        text += '\nMATCHED ITEM PREP HISTORY:\n';
        for (const d of detail) {
          const parts = [
            `${d.event_date || '?'}`,
            d.client || 'unknown',
            `${d.item} × ${d.amount_qty ?? '?'}`,
          ];
          if (d.prep_day) parts.push(`prep:${d.prep_day}`);
          if (d.pre_prep_notes) parts.push(`pre:${d.pre_prep_notes}`);
          if (d.plating_notes) parts.push(`plating:${d.plating_notes}`);
          text += `  - ${parts.join(' | ')}\n`;
        }
        sources.push({
          type: 'beo_prep_history_item',
          detail: `${detail.length} hit(s) for ${matched.length} item(s)`,
        });
      }
    }
  }

  return { text, sources };
}

// ── USDA Foods (ingredients) grounding ───────────────────────────────
//
// Surfaces top-N USDA Foundation/SR-Legacy/Survey rows from the data
// pack whenever an ingredient/nutrient/yield question hits the
// INGREDIENT_KEYWORDS gate. The bucket is huge (~3 GB of vectors,
// 2.06M descriptions × 384 dims) and takes ~20s to cold-load on the
// first call; warm calls are millisecond-scale. The keyword gate
// keeps generic kitchen chatter from paying that latency.
//
// Hits are deduped by fdc_id (FTS + semantic envelopes can both
// surface the same food row), then for each surviving hit we fetch
// nutrients via deps.usdaNutrientsFor(fdc_id) and render the same
// NUTRIENT_PRIORITY subset the /datapack-search UI uses. Format is
// citation-friendly so the LLM is encouraged to quote `fdc_id N` when
// it answers — keeps groundedness verifiable.
//
// Body (the nutrient line) is bounded by MAX_USDA_BODY_CHARS so a
// single hit can't blow MAX_CONTEXT_CHARS; with MAX_USDA_HITS=4 and a
// ~400 char ceiling per body, the whole block stays under ~2K chars.

const MAX_USDA_HITS = 4;
const MAX_USDA_BODY_CHARS = 400;

// Match the /datapack-search client's NUTRIENT_PRIORITY order. Exact
// nutrient names from USDA are inconsistent on commas/units, so we
// match by case-insensitive prefix the same way the UI does.
//
// NOTE: this constant is duplicated at app/kitchen-assistant/citationHelpers.js
// (the chat-UI client component, which can't import from `lib/` cleanly via
// its current 'use client' shape). Keep these two copies in sync — the guard
// test in tests/js/test-kitchen-assistant-citations.mjs asserts deep-equal.
// Exported (rather than module-private) so the guard test can read it.
export const USDA_NUTRIENT_PRIORITY = [
  'Energy',
  'Protein',
  'Carbohydrate',
  'Total lipid (fat)',
  'Sodium, Na',
  'Sugars, total',
];

interface UsdaSearchDeps {
  available: () => boolean;
  hybrid: typeof datapackSearch.hybrid;
  usdaNutrientsFor: typeof datapackSearch.usdaNutrientsFor;
}

/**
 * Pull the fdc_id from a hybrid hit. The two envelopes name it
 * differently — FTS uses `id` (number), semantic uses `fdc_id`
 * (number). Returns NaN if neither is a finite number, in which case
 * the caller should skip the hit.
 */
function pickFdcId(h: HybridHit): number {
  const candidates: unknown[] = [h.fdc_id, h.id];
  for (const v of candidates) {
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

// USDA's `unit_name` column is mostly uppercase (`KCAL`, `G`, `MG`,
// `UG`, `IU`, `MG_ATE`, `SP_GR`) with one mixed-case outlier (`kJ`).
// Empirically the eight distinct values in the normalized nutrients
// jsonl are: G, IU, KCAL, MG, MG_ATE, SP_GR, UG, kJ. We rewrite to the
// conventional human-readable casing so the LLM sees `109 kcal` rather
// than `109 KCAL`. Anything unexpected passes through unchanged.
//
// NOTE: this mapping is duplicated at app/kitchen-assistant/citationHelpers.js
// as `formatUnit`. Keep the two copies in sync — the guard test in
// tests/js/test-kitchen-assistant-citations.mjs asserts the same input/output
// behaviour for both. Exported so the guard test can compare directly.
export function formatUnit(unitName: string | null | undefined): string {
  if (!unitName) return '';
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

// Short, LLM-friendly inline labels for the priority nutrients. USDA's
// canonical names are verbose ("Total lipid (fat)", "Sodium, Na",
// "Sugars, total"); we keep the canonical forms in USDA_NUTRIENT_PRIORITY
// (used as a case-insensitive prefix match against nutrient_name) but
// render the compact label here. Anything not in the map passes through.
//
// NOTE: duplicated at app/kitchen-assistant/citationHelpers.js as
// `PRIORITY_DISPLAY`. Keep in sync — the guard test in
// tests/js/test-kitchen-assistant-citations.mjs asserts deep-equal.
export const PRIORITY_DISPLAY: Record<string, string> = {
  'Total lipid (fat)': 'Fat',
  'Sodium, Na': 'Sodium',
  'Sugars, total': 'Sugars',
};

/**
 * Format the NUTRIENT_PRIORITY subset for one food as a single
 * inline line. Returns '' if no priority nutrient was reported.
 * Each nutrient is rendered as "<short name> <amount> <unit>"
 * separated by ' · ' to mirror the FDA block's compact aesthetic.
 */
function formatPriorityNutrients(nutrients: datapackSearch.UsdaNutrient[]): string {
  if (!Array.isArray(nutrients) || !nutrients.length) return '';
  const parts: string[] = [];
  for (const wanted of USDA_NUTRIENT_PRIORITY) {
    const found = nutrients.find(
      (n) =>
        typeof n.nutrient_name === 'string' &&
        n.nutrient_name.toLowerCase().startsWith(wanted.toLowerCase())
    );
    if (!found) continue;
    if (found.amount == null) continue;
    const displayName = PRIORITY_DISPLAY[wanted] ?? wanted;
    const unitText = formatUnit(found.unit_name);
    const unit = unitText ? ` ${unitText}` : '';
    parts.push(`${displayName} ${found.amount}${unit}`);
  }
  return parts.join(' · ');
}

/**
 * Render the USDA ingredients grounding block. Exported so tests can
 * exercise it directly without spinning up buildGroundedContext.
 * `deps` is the test-injection seam — production callers should
 * always use the default real datapackSearch module.
 *
 * Async because hybrid retrieval awaits the BGE model on the
 * embedding channel and the (potentially +20s) cold-load of the
 * ingredients vector pack.
 */
export async function renderUsdaIngredients(
  question: string,
  deps: UsdaSearchDeps = datapackSearch
): Promise<OversightSection> {
  if (!deps.available()) return { text: '', source: null };

  const trimmed = (question || '').trim();
  if (!trimmed) return { text: '', source: null };

  // Pull more than MAX_USDA_HITS so the dedupe-by-fdc_id pass below
  // has reorder room — both the FTS and semantic channels can surface
  // the same food row, and we keep the first (highest-RRF) per pair.
  const hits = await deps.hybrid(trimmed, {
    bucket: 'ingredients',
    limit: MAX_USDA_HITS * 2,
  });
  if (!hits.length) return { text: '', source: null };

  // Dedupe by fdc_id, preserving RRF order. Hits are pre-sorted by
  // descending fused score, so first-write wins keeps the better match.
  const seen = new Set<number>();
  const unique: { hit: HybridHit; fdcId: number }[] = [];
  for (const h of hits) {
    const fdcId = pickFdcId(h);
    if (!Number.isFinite(fdcId)) continue;
    if (seen.has(fdcId)) continue;
    seen.add(fdcId);
    unique.push({ hit: h, fdcId });
    if (unique.length >= MAX_USDA_HITS) break;
  }
  if (!unique.length) return { text: '', source: null };

  let text =
    '\nUSDA INGREDIENTS (per-100g unless noted; cite fdc_id when answering):\n';
  let rendered = 0;
  for (const { hit, fdcId } of unique) {
    const description =
      pickHybridField(hit, 'title', 'description') || '(no description)';
    const category = pickHybridField(hit, 'subtitle', 'food_category');
    const archive = pickHybridField(hit, 'extra', 'source_archive');
    const dataType = pickHybridField(hit, 'data_type');

    // Header line: fdc_id citation + description + (category · archive).
    // The combination of data_type and source_archive is what the UI
    // shows after the bullet; both can be sparse so we filter empties.
    const meta = [dataType, archive].filter(Boolean).join(' · ');
    const header = `  - [fdc_id ${fdcId}] ${description}${
      category || meta ? ` (${[category, meta].filter(Boolean).join(' · ')})` : ''
    }\n`;

    const nutrients = deps.usdaNutrientsFor(fdcId);
    const nutrientLine = formatPriorityNutrients(nutrients);
    const body = nutrientLine
      ? `    ${truncateSafe(nutrientLine, MAX_USDA_BODY_CHARS)}\n`
      : '';

    text += header + body;
    rendered += 1;
  }

  if (!rendered) return { text: '', source: null };

  return {
    text,
    source: { type: 'usda_ingredients', detail: `${rendered} food(s)` },
  };
}
