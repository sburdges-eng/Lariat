// @ts-check
// /bar — pour-cost dashboard for cocktail-style recipes.
//
// Manager-facing analytics: "which cocktails are nailing pour-cost target,
// and which are out of whack?" Pulls bar-style recipes from recipes.json,
// joins against recipe_costs (cost_per_yield_unit, batch_cost, yield),
// derives a per-pour cost, and computes pour_cost_pct against the menu price.
//
// Pour-size heuristic (the costing pipeline does NOT track pour size, so we
// must infer; a future task can add a per-recipe `pour_oz` declaration):
//   - yield_unit === 'oz'   → cost_per_pour = cost_per_yield_unit × yield
//                             (assumes the menu pour equals the recipe yield;
//                              typical cocktail yield_qty is 1.5 oz for a
//                              single-serve recipe)
//   - yield_unit === 'each' → cost_per_pour = cost_per_yield_unit
//                             (hand-built per drink)
//   - other (qt, gal, ml…) → fall back to '—' (we lack info to portion)
//
// Industry-standard cocktail pour-cost target is ~18%, with 22% as the
// "out of whack" line. Anything past 22% is bleeding margin.
//
// /bar is NOT in middleware's SENSITIVE_PREFIXES (verified with
//   grep '/bar' middleware.js
// ). It returns 200 without a PIN cookie.

import Link from 'next/link';
import { getRecipes } from '../../lib/data';
import { getDb } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import { formatDollars } from '../../lib/formatMoney';

/** @typedef {import('../../lib/data').Recipe} Recipe */

/**
 * recipes.json documents always carry `category` (see data/cache/recipes.json),
 * and this page also tolerates a forward-spec object shape for `menu_items`
 * ({name,price,size_oz}) alongside the current string[] shape — neither is
 * declared on the shared `Recipe` interface in lib/data.ts (a lib/ typing
 * gap, out of scope for this file). Extend locally rather than widen the
 * shared type, same pattern as app/recipes/page.jsx's RecipeDoc.
 * @typedef {{ name?: string | null, price?: number | null, size_oz?: number | null }} BarMenuItemObj
 * @typedef {string | BarMenuItemObj} BarMenuItem
 * @typedef {Omit<Recipe, 'menu_items'> & { category?: string | null, menu_items?: BarMenuItem[] }} BarRecipe
 */

/**
 * Subset of recipe_costs columns this page actually selects. Reuses the
 * canonical row shape from lib/db.ts rather than re-authoring it.
 * @typedef {Pick<import('../../lib/db').RecipeCost, 'recipe_id' | 'cost_per_yield_unit' | 'batch_cost' | 'yield' | 'yield_unit'>} CostRow
 */

/** @typedef {{ name: string | null, price: number, size_oz: number | null }} MenuRef */

/** @typedef {'red' | 'yellow' | 'green' | 'gray'} Tone */

/**
 * @typedef {{
 *   slug: string,
 *   name: string,
 *   category: string | null,
 *   cost_per_pour: number | null,
 *   menu_price: number | null,
 *   pour_cost_pct: number | null,
 *   gray_reason: string | null,
 *   tone: Tone,
 * }} BarRow
 */

export const dynamic = 'force-dynamic';

// ── thresholds ─────────────────────────────────────────────────────
const POUR_COST_GREEN_MAX = 18; // ≤ 18% green
const POUR_COST_YELLOW_MAX = 22; // 18–22% yellow, > 22% red

/**
 * @param {number | null | undefined} pct
 * @returns {Tone}
 */
function toneFor(pct) {
  if (pct == null || !Number.isFinite(pct)) return 'gray';
  if (pct > POUR_COST_YELLOW_MAX) return 'red';
  if (pct > POUR_COST_GREEN_MAX) return 'yellow';
  return 'green';
}

/** @type {Record<Tone, string>} */
const TONE_COLOR = {
  red: 'var(--red)',
  yellow: 'var(--yellow)',
  green: 'var(--green)',
  gray: 'var(--muted)',
};

/** @type {Record<Tone, number>} */
const TONE_RANK = { red: 0, yellow: 1, green: 2, gray: 3 };

// ── bar-recipe filter ──────────────────────────────────────────────
// Permissive OR: under-collecting is worse than over-collecting; bar
// recipes are sparse and we'd rather show a pasta sauce by mistake than
// hide a cocktail.
const BAR_CATEGORY_RE = /cocktail|drink|beverage|spirit|liquor/i;

/**
 * @param {BarRecipe} r
 * @returns {boolean}
 */
function isBarRecipe(r) {
  if (r?.category && BAR_CATEGORY_RE.test(r.category)) return true;
  if (typeof r?.slug === 'string' && (r.slug.startsWith('cocktail_') || r.slug.startsWith('drink_'))) {
    return true;
  }
  // menu_items can be a string[] (current shape) or {name,price,size_oz}[]
  // (forward-spec). If any entry has a numeric price > 0, treat as bar menu.
  if (Array.isArray(r?.menu_items)) {
    for (const mi of r.menu_items) {
      if (mi && typeof mi === 'object' && typeof mi.price === 'number' && mi.price > 0) return true;
    }
  }
  return false;
}

// ── menu-price extraction ──────────────────────────────────────────
// Take the FIRST menu_item with a numeric price as the pour reference.
// String entries (current shape) carry no price → returns null.
/**
 * @param {BarRecipe} r
 * @returns {MenuRef | null}
 */
function firstMenuPrice(r) {
  if (!Array.isArray(r?.menu_items)) return null;
  for (const mi of r.menu_items) {
    if (mi && typeof mi === 'object' && typeof mi.price === 'number' && mi.price > 0) {
      return { name: mi.name ?? null, price: mi.price, size_oz: mi.size_oz ?? null };
    }
  }
  return null;
}

// ── per-pour cost derivation ───────────────────────────────────────
/**
 * @param {CostRow | null} costRow
 * @param {BarRecipe} recipe
 * @param {MenuRef | null} menuRef
 * @returns {number | null}
 */
function computePourCost(costRow, recipe, menuRef) {
  if (!costRow) return null;
  const cpu = Number(costRow.cost_per_yield_unit);
  const yieldQty = Number(costRow.yield ?? recipe?.yield_qty ?? NaN);
  const yieldUnit = String(costRow.yield_unit ?? recipe?.yield_unit ?? '').toLowerCase();

  if (Number.isFinite(cpu)) {
    if (yieldUnit === 'oz') {
      // Prefer an explicit menu pour size if the menu_item declares one;
      // otherwise assume the recipe yield is one pour.
      const pourOz =
        menuRef && Number.isFinite(Number(menuRef.size_oz)) && Number(menuRef.size_oz) > 0
          ? Number(menuRef.size_oz)
          : Number.isFinite(yieldQty) && yieldQty > 0
            ? yieldQty
            : null;
      if (pourOz != null) return cpu * pourOz;
    }
    if (yieldUnit === 'each') {
      return cpu;
    }
  }
  // qt/gal/ml/etc. — without a declared serves count we can't portion.
  return null;
}

// ── page ───────────────────────────────────────────────────────────
/**
 * @param {{
 *   searchParams: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>,
 * }} props
 */
export default async function BarPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;

  const recipes = /** @type {BarRecipe[]} */ (getRecipes());
  const barRecipes = recipes.filter(isBarRecipe);

  // Pull all cost rows for this location in one query, build a map.
  const db = getDb();
  const costRows = /** @type {CostRow[]} */ (
    db
      .prepare(
        `SELECT recipe_id, cost_per_yield_unit, batch_cost, yield, yield_unit
           FROM recipe_costs
          WHERE location_id = ?`,
      )
      .all(loc)
  );
  /** @type {Map<string, CostRow>} */
  const costByRecipe = new Map();
  for (const row of costRows) costByRecipe.set(row.recipe_id, row);

  const rows = /** @type {BarRow[]} */ (barRecipes.map((r) => {
    const costRow = costByRecipe.get(r.slug) || null;
    const menuRef = firstMenuPrice(r);
    const cost_per_pour = computePourCost(costRow, r, menuRef);
    const menu_price = menuRef?.price ?? null;
    const pour_cost_pct =
      cost_per_pour != null && menu_price != null && menu_price > 0
        ? (cost_per_pour / menu_price) * 100
        : null;
    // Why a gray row has no pour cost — managers need to know whether to
    // add a cost, a menu price, or a portionable yield before they can act.
    const gray_reason =
      pour_cost_pct != null
        ? null
        : !costRow
          ? 'add recipe cost'
          : cost_per_pour == null
            ? 'yield not portionable'
            : 'add menu price';
    return {
      slug: r.slug,
      name: r.name || r.slug,
      category: r.category || null,
      cost_per_pour,
      menu_price,
      pour_cost_pct,
      gray_reason,
      tone: toneFor(pour_cost_pct),
    };
  }));

  // Sort: red > yellow > green > gray, then pour_cost_pct desc within each.
  rows.sort((a, b) => {
    const tr = TONE_RANK[a.tone] - TONE_RANK[b.tone];
    if (tr !== 0) return tr;
    const ap = a.pour_cost_pct ?? -Infinity;
    const bp = b.pour_cost_pct ?? -Infinity;
    return bp - ap;
  });

  const counts = rows.reduce(
    (acc, r) => {
      acc[r.tone] = (acc[r.tone] || 0) + 1;
      return acc;
    },
    { red: 0, yellow: 0, green: 0, gray: 0 },
  );

  const locQ = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';

  return (
    <div>
      <h1>Bar program</h1>
      <p className="subtitle">Cocktail pour costs at a glance</p>
      <p style={{ marginTop: -16, marginBottom: 24 }}>
        <Link href={`/bar/par${locQ}`}>→ Bar par list</Link>
      </p>

      {/* Stats card — one tone-counts summary across all bar recipes */}
      <div className="card mb-20">
        <div className="kpi-label">Pour-cost distribution</div>
        <div className="flex-center-gap" style={{ gap: 24, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ color: TONE_COLOR.green, fontWeight: 700 }}>
            {counts.green} on target
            <span className="meta" style={{ marginLeft: 6 }}>(≤ {POUR_COST_GREEN_MAX}%)</span>
          </span>
          <span style={{ color: TONE_COLOR.yellow, fontWeight: 700 }}>
            {counts.yellow} watch
            <span className="meta" style={{ marginLeft: 6 }}>
              ({POUR_COST_GREEN_MAX}–{POUR_COST_YELLOW_MAX}%)
            </span>
          </span>
          <span style={{ color: TONE_COLOR.red, fontWeight: 700 }}>
            {counts.red} over
            <span className="meta" style={{ marginLeft: 6 }}>(&gt; {POUR_COST_YELLOW_MAX}%)</span>
          </span>
          <span style={{ color: TONE_COLOR.gray, fontWeight: 700 }}>
            {counts.gray} unpriced
            <span className="meta" style={{ marginLeft: 6 }}>(missing cost or menu)</span>
          </span>
        </div>
      </div>

      {/* List */}
      {rows.length === 0 ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Bar setup not ready</h2>
          <p className="meta">
            No bar recipes are ready for pour-cost tracking yet. Add cocktail recipes with menu prices and recipe costs, then this page will sort them.
          </p>
          <p style={{ marginBottom: 0 }}>
            <Link href="/recipes">Open recipes</Link>
          </p>
        </div>
      ) : (
        <div className="stack">
          {rows.map((r) => {
            const color = TONE_COLOR[r.tone];
            return (
              <div
                key={r.slug}
                className="card"
                style={{ borderColor: r.tone === 'gray' ? 'var(--border)' : color }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                      <Link
                        href={`/recipes/${encodeURIComponent(r.slug)}`}
                        style={{ fontWeight: 700, fontSize: 18 }}
                      >
                        {r.name}
                      </Link>
                      {r.category ? (
                        <span
                          className="meta"
                          style={{
                            fontSize: 11,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            border: '1px solid var(--border)',
                            padding: '2px 6px',
                            borderRadius: 4,
                          }}
                        >
                          {r.category}
                        </span>
                      ) : null}
                    </div>
                    <div className="meta" style={{ marginTop: 6, fontSize: 13 }}>
                      Cost{' '}
                      <span style={{ fontWeight: 600 }}>
                        {formatDollars(r.cost_per_pour)}
                      </span>{' '}
                      / pour &middot; Menu{' '}
                      <span style={{ fontWeight: 600 }}>
                        {formatDollars(r.menu_price)}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color,
                      textAlign: 'right',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.pour_cost_pct != null ? (
                      `${r.pour_cost_pct.toFixed(1)}%`
                    ) : (
                      <span className="meta" style={{ fontSize: 12, fontWeight: 600 }}>
                        {r.gray_reason}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
