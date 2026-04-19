import fs from 'fs';
import path from 'path';

const CACHE = path.join(process.cwd(), 'data', 'cache');

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
  procedure?: string | null;
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

interface CacheEntry<T> {
  mtimeMs: number;
  data: T;
}

const _mem = new Map<string, CacheEntry<unknown>>();

function load<T>(name: string): T | null {
  const p = path.join(CACHE, name);
  if (!fs.existsSync(p)) return null;
  const stat = fs.statSync(p);
  const mtimeMs = stat.mtimeMs;
  const cached = _mem.get(name) as CacheEntry<T> | undefined;
  if (cached && cached.mtimeMs === mtimeMs) return cached.data;
  const data = JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  _mem.set(name, { mtimeMs, data });
  return data;
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

export function getStation(id: string): Station | null {
  return getStations().find((s) => s.id === id) || null;
}

export function getRecipeBySlug(slug: string): Recipe | null {
  return getRecipes().find((r) => r.slug === slug) || null;
}
