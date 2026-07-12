import fs from 'fs';
import path from 'path';
import { resolveDataDir } from './dataDir.ts';

// CACHE is the on-disk root for JSON snapshots populated by
// `npm run ingest` / `rebuild-cache`. Tests override via
// `setCacheRootForTest()` so they can write under tmpdir without
// trampling `data/cache/` in the working tree.
//
// Mirrors lib/db.ts: honor LARIAT_DATA_DIR for relocated installs so the
// SQLite root and the JSON-cache root stay in sync. Without this, the
// app could read JSON cache from ./data/cache while SQLite resolves to
// the env-overridden directory — a split-brain that masquerades as
// "recipes look stale even though I just re-ingested."
let _cacheOverride: string | null = null;
function cacheRoot(): string {
  // resolveDataDir() reads env at call time, so tests that set
  // LARIAT_DATA_DIR after import (via cache-busting dynamic-import)
  // pick up the new value without the module remembering its module-
  // load resolution.
  return _cacheOverride ?? path.join(resolveDataDir(), 'cache');
}

/** Test-only — re-points the cache root and flushes in-memory state. */
export function setCacheRootForTest(rootDir: string | null): void {
  _cacheOverride = rootDir;
  _mem.clear();
  _degraded.clear();
}

// ── Cached JSON types ──────────────────────────────────────────────

export interface Station {
  id: string;
  name: string;
  line: string;
  line_check_key: string | null;
  setup_key?: string | null;
}

export interface StaffMember {
  id: string;
  first: string;
  last: string;
  role?: string;
  active?: boolean;
}

export interface Ingredient {
  item: string;
  qty?: number | string | null;
  unit?: string | null;
}

export interface Recipe {
  slug: string;
  name: string;
  station?: string | null;
  yield_qty?: number | string | null;
  yield_unit?: string | null;
  ingredients: Ingredient[];
  /**
   * Mixed shape in data/cache/recipes.json: most recipes (73/77) store a
   * string[] of steps; a few legacy docs store a single prose string.
   */
  procedure?: string | string[] | null;
  /** Recipe category (e.g. "sauces", "mains"); present on every cached recipe doc. */
  category?: string | null;
  /** Full allergen set: direct inference + union over sub-recipe tree. Use for UI. */
  allergens?: string[];
  /** Allergens inferred only from this recipe's own ingredients (pre-rollup). */
  direct_allergens?: string[];
  menu_items?: string[];
  sub_recipes?: string[];
  source?: string | null;
}

export interface MenuItem {
  display_name: string;
  category?: string;
  price?: number | null;
  recipe_slug?: string;
}

export interface FoodSafetyData {
  ccps: Record<string, string>[];
  temp_monitoring: Record<string, string>[];
}

export interface VendorSummary {
  sysco?: {
    recent_items?: { description: string; category?: string; pack_size?: string; price?: number }[];
    last_invoice_date?: string;
  };
  [key: string]: unknown;
}

export interface LaborSummary {
  period?: string;
  net_sales?: number;
  gross_sales?: number;
  labor_cost?: number;
  labor_pct_net?: number;
  labor_pct_gross?: number;
  splh_net?: number;
  splh_gross?: number;
  by_role?: {
    job_title?: string;
    role?: string;
    regular_hours?: number;
    ot_hours?: number;
    total_hours?: number;
    regular_cost?: number;
    ot_cost?: number;
    total_cost?: number;
    labor_pct_net?: number;
    labor_pct_gross?: number;
  }[];
  by_employee?: {
    last_name?: string;
    first_name?: string;
    job_title?: string;
    regular_hours?: number;
    ot_hours?: number;
    total_hours?: number;
    regular_cost?: number;
    ot_cost?: number;
    total_cost?: number;
    labor_pct_net?: number;
  }[];
}

export interface AllergenEntry {
  ingredient: string;
  big9?: string[];
}

export type AllergenMatrix = Record<string, AllergenEntry[]>;

// ── In-memory cache with mtime invalidation ────────────────────────
//
// Behavior (GH #252):
//   - Happy path: parse JSON, cache by (name, mtimeMs), return data.
//   - Parse failure (partial flush, hand-edit corrupted JSON):
//       * If `_mem` already has a prior-good entry → log a one-time warning
//         per broken mtime, register the file in `_degraded`, and return
//         the LAST-KNOWN-GOOD data. The `|| {}` / `|| []` getters below
//         continue to work, but instead of silently flipping "no allergens
//         tagged" / "no stations" on a malformed file the app keeps
//         serving yesterday's parse until the file is repaired.
//       * If there is no prior-good entry → fall back to `null` as before
//         (matches the original behavior — getters degrade to []/{}).
//
// Operators learn about the degraded state via `getCacheHealth()` (called
// by the freshness banner / `/api/data/health`).

interface CacheEntry<T> {
  mtimeMs: number;
  data: T;
}

interface DegradedEntry {
  /** mtimeMs of the broken file we tried (and failed) to parse. */
  mtimeMs: number;
  /** Error message — surfaced to ops via /api/data/health. */
  reason: string;
}

const _mem = new Map<string, CacheEntry<unknown>>();
const _degraded = new Map<string, DegradedEntry>();

function load<T>(name: string): T | null {
  const p = path.join(cacheRoot(), name);
  if (!fs.existsSync(p)) return null;
  const stat = fs.statSync(p);
  const mtimeMs = stat.mtimeMs;
  const cached = _mem.get(name) as CacheEntry<T> | undefined;
  if (cached && cached.mtimeMs === mtimeMs) return cached.data;
  let data: T;
  try {
    data = JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (cached) {
      const prior = _degraded.get(name);
      if (!prior || prior.mtimeMs !== mtimeMs) {
        // One warning per (name, broken mtime) — repeated calls against
        // the same broken file don't spam the log.
        console.error(
          `lib/data: failed to parse ${name} at mtime=${mtimeMs}; serving last-known-good from mtime=${cached.mtimeMs}.`,
          err,
        );
      }
      _degraded.set(name, { mtimeMs, reason });
      return cached.data;
    }
    console.error(`lib/data: failed to parse ${name} (no last-known-good; serving empty fallback):`, err);
    _degraded.set(name, { mtimeMs, reason });
    return null;
  }
  _mem.set(name, { mtimeMs, data });
  _degraded.delete(name);
  return data;
}

// ── Cache-health surface ───────────────────────────────────────────

export interface CacheHealthEntry {
  /** Filename relative to data/cache, e.g. "allergen_matrix.json". */
  name: string;
  /** mtimeMs of the broken file (last attempt). */
  mtimeMs: number;
  /** JSON.parse error message. */
  reason: string;
  /** True iff a prior good parse is still being served. */
  hasLastKnownGood: boolean;
}

export interface CacheHealth {
  degraded: CacheHealthEntry[];
}

/**
 * Snapshot of which cache files are currently failing to parse, for the
 * freshness banner / GET /api/data/health. Empty `degraded` means every
 * touched file parsed cleanly on its most recent attempt.
 *
 * Pure read of the in-memory state — does not trigger any disk IO.
 */
export function getCacheHealth(): CacheHealth {
  const degraded: CacheHealthEntry[] = [];
  for (const [name, info] of _degraded.entries()) {
    degraded.push({
      name,
      mtimeMs: info.mtimeMs,
      reason: info.reason,
      hasLastKnownGood: _mem.has(name),
    });
  }
  return { degraded };
}

// ── Public API ─────────────────────────────────────────────────────

export function getStations(): Station[] {
  return load<Station[]>('stations.json') || [];
}

export function getStaff(): StaffMember[] {
  return load<StaffMember[]>('staff.json') || [];
}

export function getRecipes(): Recipe[] {
  return load<Recipe[]>('recipes.json') || [];
}

export function getSetups(): Record<string, unknown> {
  return load<Record<string, unknown>>('setups.json') || {};
}

export function getLineCheckTemplate(key: string): string[] {
  const all = load<Record<string, string[]>>('line_checks.json') || {};
  return all[key] || [];
}

export function getMenu(): MenuItem[] {
  return load<MenuItem[]>('menu.json') || [];
}

export function getFoodSafety(): FoodSafetyData {
  return load<FoodSafetyData>('food_safety.json') || { ccps: [], temp_monitoring: [] };
}

export function getVendorSummary(): VendorSummary | null {
  return load<VendorSummary>('vendor_summary.json') || null;
}

export function getLaborSummary(): LaborSummary | null {
  return load<LaborSummary>('labor_summary.json') || null;
}

export function getAllergenMatrix(): AllergenMatrix {
  return load<AllergenMatrix>('allergen_matrix.json') || {};
}

export function getClosings(): Record<string, string[]> {
  return load<Record<string, string[]>>('closings.json') || {};
}

export interface WeeklyPrep {
  by_day: Record<string, string[]>;
  by_category: Record<string, string[]>;
}

export function getWeeklyPrep(): WeeklyPrep {
  return load<WeeklyPrep>('weekly_prep.json') || { by_day: {}, by_category: {} };
}

export interface CateringMenuItem {
  category: string;
  name: string;
  cost: number;
}

export function getCateringMenu(): CateringMenuItem[] {
  return load<CateringMenuItem[]>('catering_menu.json') || [];
}

export interface OrderGuideItem {
  supc: string;
  description: string;
  pack_size: string | null;
  brand: string | null;
  unit: string | null;
  category: string | null;
  location: string | null;
  par: string | null;
}

export function getOrderGuide(): OrderGuideItem[] {
  const wrapped = load<{ items?: OrderGuideItem[] }>('order_guide.json');
  return wrapped?.items || [];
}

export function getStation(id: string): Station | null {
  return getStations().find((s) => s.id === id) || null;
}

export function getRecipeBySlug(slug: string): Recipe | null {
  return getRecipes().find((r) => r.slug === slug) || null;
}
