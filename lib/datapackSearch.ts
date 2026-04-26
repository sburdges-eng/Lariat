/**
 * Read-only client for the Lariat Data Pack indexes.
 *
 * Wraps the SQLite + FTS5 indexes built by the Python pipeline at
 * `scripts/datapack/`. Lariat consumers (API routes, the kitchen
 * assistant context builder, etc.) call this module instead of
 * touching ATTACH syntax or the raw FTS5 query format directly.
 *
 * The data pack lives off-tree on the external SSD and is pulled in
 * via the `data/lariat-data` symlink, so this module is a NO-OP on
 * machines where that symlink isn't set up — the connection stays
 * lazy and `available()` returns false. Importing this module never
 * throws, so it's safe to wire into routes that may run on dev
 * machines without the data pack mounted.
 *
 * Semantic / vector search is intentionally out of scope here —
 * better-sqlite3 is synchronous and great for FTS5 BM25, but BGE
 * inference belongs either in the existing Python pipeline (call
 * scripts/datapack/search.py from a sidecar process) or in
 * transformers.js (separate decision). FTS5 with a porter stemmer
 * already covers the bulk of the lookup use cases.
 */

import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Resolve the data root the same way the Python pipeline does:
// prefer the in-repo symlink at data/lariat-data, fall back to the
// hard-coded SSD path. We don't try to write either; if neither
// exists the module reports unavailable and every call no-ops.
const SYMLINK_PATH = path.join(process.cwd(), 'data', 'lariat-data');
const DIRECT_PATH = "/Volumes/Sean's SSD/lariat-data";

function resolveDataRoot(): string | null {
  try {
    if (fs.existsSync(SYMLINK_PATH)) {
      return fs.realpathSync(SYMLINK_PATH);
    }
  } catch {
    // ignore — fall through to direct path probe
  }
  if (fs.existsSync(DIRECT_PATH)) {
    return DIRECT_PATH;
  }
  return null;
}

let _conn: DB | null = null;
let _resolvedDataRoot: string | null = null;

/**
 * Lazily open the FTS database with the source DB ATTACHed read-only.
 * Returns null when the data pack isn't on disk on this machine.
 *
 * Both DBs live on the SSD; opening over the symlink is fine because
 * SQLite resolves the path before the file open. Both connections are
 * read-only — passing readonly:true plus opening with `mode=ro` URIs
 * is a belt-and-braces guarantee that an API misuse can't mutate the
 * indexes.
 */
function getConn(): DB | null {
  if (_conn) return _conn;
  const root = resolveDataRoot();
  if (!root) return null;

  const sqlitePath = path.join(root, 'indexes', 'sqlite', 'lariat_data.db');
  const ftsPath = path.join(root, 'indexes', 'search', 'fts', 'lariat_fts.db');
  if (!fs.existsSync(sqlitePath) || !fs.existsSync(ftsPath)) return null;

  const conn = new Database(ftsPath, { readonly: true, fileMustExist: true });
  // Names with apostrophes ("Sean's SSD") need to be parameterized so
  // the SQL string-literal doesn't terminate early. better-sqlite3's
  // .prepare() supports bound params on ATTACH.
  conn.prepare('ATTACH DATABASE ? AS src').run(sqlitePath);
  // Belt-and-braces query-only enforcement at the SQLite layer.
  conn.pragma('query_only = ON');

  _conn = conn;
  _resolvedDataRoot = root;
  return conn;
}

export function available(): boolean {
  return getConn() !== null;
}

export function dataRoot(): string | null {
  // Force resolution if not already done.
  getConn();
  return _resolvedDataRoot;
}

/**
 * Test-only hook: drop the cached connection so the next call reopens.
 * Used by tests that mount/unmount the SSD between cases.
 */
export function _resetForTest(): void {
  if (_conn) {
    try { _conn.close(); } catch { /* ignore */ }
  }
  _conn = null;
  _resolvedDataRoot = null;
}

// ── FTS5 search ──────────────────────────────────────────────────

export type FtsSource = 'usda' | 'off' | 'wikibooks' | 'fda' | 'all';

export interface FtsHit {
  /** BM25 score — lower is better (FTS5 convention). */
  score: number;
  /** Which source this hit came from. */
  source: 'usda' | 'off' | 'wikibooks' | 'fda';
  /** Stable id from the source: fdc_id (number), code (string),
   *  page_id (number), or fda rowid (number). */
  id: number | string;
  /** Display title (description / product name / page title / section title). */
  title: string | null;
  /** Subtitle: food category / brands / slug / section_id. */
  subtitle: string | null;
  /** Free-form extra context: source archive, brand owner, source url,
   *  chapter or annex. */
  extra: string | null;
}

/**
 * Per-source FTS query templates. We keep these as full SQL strings
 * (not composed at query time) so the prepared-statement cache hits.
 * The MATCH parameter and LIMIT are bound; everything else is fixed.
 *
 * Hits routes back to source row data via the FTS rowid (or, for OFF,
 * via the off_products_codes side-table since OFF's GTIN code is
 * TEXT and can't ride along as the FTS rowid).
 */
const FTS_SQL: Record<Exclude<FtsSource, 'all'>, string> = {
  usda: `
    SELECT bm25(usda_foods_fts) AS score,
           f.fdc_id           AS id,
           f.description      AS title,
           f.food_category    AS subtitle,
           f.source_archive   AS extra,
           'usda'             AS source
    FROM usda_foods_fts AS s
    JOIN src.usda_foods AS f ON f.fdc_id = s.rowid
    WHERE usda_foods_fts MATCH ?
    ORDER BY score
    LIMIT ?
  `,
  off: `
    SELECT bm25(off_products_fts) AS score,
           f.code         AS id,
           f.product_name AS title,
           f.brands       AS subtitle,
           f.brand_owner  AS extra,
           'off'          AS source
    FROM off_products_fts AS s
    JOIN off_products_codes AS m ON m.fts_rowid = s.rowid
    JOIN src.off_products AS f ON f.code = m.code
    WHERE off_products_fts MATCH ?
    ORDER BY score
    LIMIT ?
  `,
  wikibooks: `
    SELECT bm25(wikibooks_pages_fts) AS score,
           f.page_id    AS id,
           f.title      AS title,
           f.slug       AS subtitle,
           f.source_url AS extra,
           'wikibooks'  AS source
    FROM wikibooks_pages_fts AS s
    JOIN src.wikibooks_pages AS f ON f.page_id = s.rowid
    WHERE wikibooks_pages_fts MATCH ?
    ORDER BY score
    LIMIT ?
  `,
  fda: `
    SELECT bm25(fda_food_code_sections_fts) AS score,
           f.rowid                        AS id,
           f.title                        AS title,
           COALESCE(f.section_id, '')      AS subtitle,
           COALESCE(f.chapter, f.annex, '') AS extra,
           'fda'                          AS source
    FROM fda_food_code_sections_fts AS s
    JOIN src.fda_food_code_sections AS f ON f.rowid = s.rowid
    WHERE fda_food_code_sections_fts MATCH ?
    ORDER BY score
    LIMIT ?
  `,
};

/**
 * BM25 lexical search over one source or 'all'.
 *
 * `query` is the FTS5 MATCH expression — phrase queries with double
 * quotes ("scrambled eggs"), boolean operators (AND OR NOT), and
 * column filters (title:nutella) all work. The caller is responsible
 * for sanitizing user input enough to avoid FTS5 syntax errors;
 * `escapeFtsPhrase` below wraps an arbitrary string as a quoted
 * phrase so unsafe chars never reach the parser.
 *
 * Returns `[]` when the data pack isn't available on this machine.
 */
export function fts(
  query: string,
  opts: { source?: FtsSource; limit?: number } = {}
): FtsHit[] {
  const conn = getConn();
  if (!conn) return [];

  const trimmed = query?.trim();
  if (!trimmed) return [];

  const source = opts.source ?? 'all';
  const limit = Math.max(1, Math.min(200, opts.limit ?? 20));

  if (source === 'all') {
    const merged: FtsHit[] = [];
    for (const s of ['usda', 'off', 'wikibooks', 'fda'] as const) {
      merged.push(...ftsOne(conn, s, trimmed, limit));
    }
    merged.sort((a, b) => a.score - b.score);
    return merged;
  }

  return ftsOne(conn, source, trimmed, limit);
}

function ftsOne(
  conn: DB,
  source: Exclude<FtsSource, 'all'>,
  query: string,
  limit: number
): FtsHit[] {
  const sql = FTS_SQL[source];
  return conn.prepare(sql).all(query, limit) as FtsHit[];
}

/**
 * Wrap an arbitrary string as a single FTS5 phrase. The input is
 * scrubbed of double quotes (FTS5 has no escape mechanism within
 * phrases), then surrounded with quotes so meta characters like
 * AND/OR/-/* are matched literally. Use this when surfacing user
 * input directly to FTS5; skip it when the caller wants operator
 * support.
 */
export function escapeFtsPhrase(s: string): string {
  return `"${s.replace(/"/g, '')}"`;
}

// ── Direct lookups ───────────────────────────────────────────────

export interface UsdaFood {
  fdc_id: number;
  data_type: string | null;
  source_archive: string | null;
  description: string | null;
  food_category: string | null;
  food_category_id: number | null;
  brand_owner: string | null;
  gtin_upc: string | null;
  ingredients: string | null;
  serving_size: number | null;
  serving_size_unit: string | null;
}

export interface UsdaNutrient {
  nutrient_id: number;
  nutrient_name: string | null;
  amount: number | null;
  unit_name: string | null;
}

export interface OffProduct {
  code: string;
  product_name: string | null;
  brands: string | null;
  brand_owner: string | null;
  ingredients_text: string | null;
  allergens_tags_json: string | null;
  traces_tags_json: string | null;
  categories_tags_json: string | null;
  countries_en: string | null;
  nutriscore_grade: string | null;
  serving_size: string | null;
  source_url: string | null;
}

export interface FdaSection {
  rowid: number;
  section_id: string | null;
  title: string | null;
  chapter: string | null;
  annex: string | null;
  body: string;
  char_count: number | null;
  page_start: number | null;
  page_end: number | null;
}

export interface WikibooksPage {
  page_id: number;
  title: string | null;
  slug: string | null;
  source_url: string | null;
  is_redirect: 0 | 1 | null;
  redirect_target: string | null;
  plain_text_summary: string | null;
  wikitext_length: number | null;
  categories_json: string | null;
}

export function getUsdaFood(fdcId: number): UsdaFood | null {
  const conn = getConn();
  if (!conn) return null;
  const row = conn
    .prepare('SELECT * FROM src.usda_foods WHERE fdc_id = ?')
    .get(fdcId) as UsdaFood | undefined;
  return row ?? null;
}

export function usdaNutrientsFor(fdcId: number): UsdaNutrient[] {
  const conn = getConn();
  if (!conn) return [];
  return conn
    .prepare(
      `SELECT nutrient_id, nutrient_name, amount, unit_name
       FROM src.usda_nutrients
       WHERE fdc_id = ?
       ORDER BY nutrient_name`
    )
    .all(fdcId) as UsdaNutrient[];
}

export function getOffProduct(code: string): OffProduct | null {
  const conn = getConn();
  if (!conn) return null;
  const row = conn
    .prepare('SELECT * FROM src.off_products WHERE code = ?')
    .get(code) as OffProduct | undefined;
  return row ?? null;
}

export function getFdaSection(
  arg: { section_id: string } | { rowid: number }
): FdaSection | null {
  const conn = getConn();
  if (!conn) return null;
  if ('section_id' in arg) {
    const row = conn
      .prepare(
        'SELECT rowid, * FROM src.fda_food_code_sections ' +
          'WHERE section_id = ? LIMIT 1'
      )
      .get(arg.section_id) as FdaSection | undefined;
    return row ?? null;
  }
  const row = conn
    .prepare('SELECT rowid, * FROM src.fda_food_code_sections WHERE rowid = ?')
    .get(arg.rowid) as FdaSection | undefined;
  return row ?? null;
}

export function getWikibooksPage(
  arg: { page_id: number } | { title: string }
): WikibooksPage | null {
  const conn = getConn();
  if (!conn) return null;
  if ('page_id' in arg) {
    const row = conn
      .prepare('SELECT * FROM src.wikibooks_pages WHERE page_id = ?')
      .get(arg.page_id) as WikibooksPage | undefined;
    return row ?? null;
  }
  const row = conn
    .prepare('SELECT * FROM src.wikibooks_pages WHERE title = ? LIMIT 1')
    .get(arg.title) as WikibooksPage | undefined;
  return row ?? null;
}

// ── Stats ────────────────────────────────────────────────────────

/** Row counts per indexed table. Useful for the sanity panel and
 *  build-readiness probes. Returns null when the data pack isn't
 *  available. */
export function stats(): {
  sqlite: Record<string, number>;
  fts: Record<string, number>;
} | null {
  const conn = getConn();
  if (!conn) return null;
  const sqlite: Record<string, number> = {};
  for (const tbl of [
    'usda_foods',
    'usda_nutrients',
    'off_products',
    'wikibooks_pages',
    'fda_food_code_sections',
    'off_allergens',
  ]) {
    sqlite[tbl] = (
      conn.prepare(`SELECT COUNT(*) AS n FROM src.${tbl}`).get() as { n: number }
    ).n;
  }
  const fts: Record<string, number> = {};
  for (const tbl of [
    'usda_foods_fts',
    'off_products_fts',
    'wikibooks_pages_fts',
    'fda_food_code_sections_fts',
  ]) {
    fts[tbl] = (
      conn.prepare(`SELECT COUNT(*) AS n FROM ${tbl}`).get() as { n: number }
    ).n;
  }
  return { sqlite, fts };
}
