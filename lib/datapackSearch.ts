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
 * Semantic / vector search is wired in via `semantic()` below. It
 * uses transformers.js (`@huggingface/transformers`) to encode queries
 * with `BAAI/bge-small-en-v1.5` and dot-products them against the
 * per-bucket `vectors.npy` matrices written by the Python pipeline.
 * Both the model and the per-bucket vectors are lazy-loaded; FTS5
 * callers don't pay any of the ONNX runtime cost.
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
  if (_availableOverride !== null) return _availableOverride;
  return getConn() !== null;
}

export function dataRoot(): string | null {
  // Force resolution if not already done.
  getConn();
  return _resolvedDataRoot;
}

/**
 * Test-only hook: drop the cached connection so the next call reopens.
 * Used by tests that mount/unmount the SSD between cases. Also clears
 * the semantic caches (model + per-bucket vectors) so the next
 * `semantic()` call reloads from scratch — useful for tests that
 * stub out the data root mid-suite.
 */
export function _resetForTest(): void {
  if (_conn) {
    try { _conn.close(); } catch { /* ignore */ }
  }
  _conn = null;
  _resolvedDataRoot = null;
  _bucketCache.clear();
  _modelPromise = null;
  _availableOverride = null;
}

/**
 * Test-only hook: force `available()` to report a fixed value
 * regardless of disk state. Pass `null` to clear the override.
 * Used to exercise the "data pack unavailable" branch on machines
 * where the SSD is mounted.
 */
export function _setAvailableOverrideForTest(value: boolean | null): void {
  _availableOverride = value;
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

// ── Semantic search (BGE via transformers.js) ────────────────────
//
// Mirrors `scripts/datapack/search.py::DataPackSearch.semantic`:
//
//   - model is `BAAI/bge-small-en-v1.5` (384-d, normalized)
//   - documents were encoded with no prefix at index time
//   - queries get the asymmetric retrieval prefix
//     "Represent this sentence for searching relevant passages: "
//   - vectors are L2-normalized, so cosine = dot product
//
// vectors.npy is read once per bucket via a tiny inline NPY-v1 parser.
// Pulling `npyjs` for one ~80-byte header parse isn't worth the dep
// surface — the .npy v1 layout is fully specified, the dtype here is
// always little-endian float32, and the header is a static Python-dict
// literal. If we ever need v2 / v3 support or non-f4 dtypes, swap to
// npyjs at that point.
//
// Lazy-loading: the model pipeline is built once on first `semantic()`
// call (cached in `_modelPromise`); per-bucket vectors+metadata are
// loaded on first reference (cached in `_bucketCache`). Empty/whitespace
// queries short-circuit before touching either cache.

/** Asymmetric retrieval prefix for BGE-* models. Documents go in
 *  unprefixed at index time; queries need this prefix. Hardcoded
 *  here for the same reason as the Python side: we only ever ship
 *  BGE right now. */
const _BGE_QUERY_PREFIX =
  'Represent this sentence for searching relevant passages: ';

const _BGE_MODEL_ID = 'BAAI/bge-small-en-v1.5';

export interface SemanticHit {
  /** Cosine similarity in [-1, 1] — higher is better. */
  score: number;
  /** Bucket name — echoed from the metadata row. */
  bucket: string;
  /** Remaining metadata fields verbatim from `metadata.jsonl`. */
  [key: string]: unknown;
}

interface BucketCacheEntry {
  vectors: Float32Array;
  rows: number;
  dims: number;
  metadata: Array<Record<string, unknown>>;
}

const _bucketCache: Map<string, Promise<BucketCacheEntry | null>> = new Map();
// Promise so concurrent first-callers share one model load.
let _modelPromise: Promise<(t: string[], opts: object) => Promise<{ data: Float32Array }>> | null =
  null;
// Test-only — see `_setAvailableOverrideForTest`.
let _availableOverride: boolean | null = null;

/**
 * Parse the header section of a NumPy v1 .npy file.
 *
 * The .npy v1 layout is:
 *   bytes 0..5   magic "\x93NUMPY"
 *   bytes 6..7   version major, minor (here 1, 0)
 *   bytes 8..9   header length, little-endian uint16
 *   bytes 10..   ASCII Python-dict literal padded with spaces and a
 *                trailing '\n', total length = header_len
 *
 * We refuse anything that isn't `<f4` / not C-order / not 2-D — those
 * inputs aren't produced by `build_embeddings_index.py` and silently
 * mis-parsing them would be worse than throwing.
 *
 * Returns the parsed shape and the byte offset where the matrix
 * payload begins; the caller is responsible for reading
 * rows * dims * 4 bytes starting at dataOffset.
 */
function parseNpyHeader(buf: Buffer): {
  rows: number;
  dims: number;
  dataOffset: number;
} {
  if (
    buf.length < 10 ||
    buf[0] !== 0x93 ||
    buf.toString('ascii', 1, 6) !== 'NUMPY'
  ) {
    throw new Error('not a .npy file (bad magic)');
  }
  const major = buf[6];
  if (major !== 1) {
    throw new Error(`unsupported .npy major version ${major}; expected 1`);
  }
  const headerLen = buf.readUInt16LE(8);
  const dataOffset = 10 + headerLen;
  if (buf.length < dataOffset) {
    throw new Error(`.npy header truncated: need ${dataOffset} bytes, got ${buf.length}`);
  }
  const header = buf.toString('ascii', 10, dataOffset);

  // The header is a Python repr of a dict. We pluck what we need with
  // narrow regexes rather than hand-rolling a Python literal parser.
  const descrMatch = header.match(/'descr'\s*:\s*'([^']+)'/);
  const fortranMatch = header.match(/'fortran_order'\s*:\s*(True|False)/);
  const shapeMatch = header.match(/'shape'\s*:\s*\(([^)]*)\)/);
  if (!descrMatch || !fortranMatch || !shapeMatch) {
    throw new Error(`malformed .npy header: ${header}`);
  }
  if (descrMatch[1] !== '<f4') {
    throw new Error(
      `unsupported .npy dtype ${descrMatch[1]}; expected '<f4' (little-endian float32)`
    );
  }
  if (fortranMatch[1] !== 'False') {
    throw new Error("unsupported .npy fortran_order=True; expected C-order");
  }
  const shapeBody = shapeMatch[1] ?? '';
  const dims = shapeBody
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number.parseInt(s, 10));
  if (dims.length !== 2 || dims.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error(`unsupported .npy shape ${JSON.stringify(dims)}; expected 2-D`);
  }
  const [rows, cols] = dims as [number, number];
  return { rows, dims: cols, dataOffset };
}

/**
 * Read a 2-D `<f4` .npy matrix from disk directly into a Float32Array,
 * without ever holding both the source Buffer and the typed array
 * concurrently. For the ~3 GB ingredients bucket this halves peak
 * memory (3 GB instead of 6 GB) and makes the bucket loadable in
 * the default Node heap (~1.7 GB headroom for everything else).
 *
 * The implementation:
 *   1. Reads the first 4 KB to parse the header (NumPy headers are
 *      always small — typically <200 bytes).
 *   2. Allocates Float32Array(rows * dims).
 *   3. Reads the matrix body straight into the typed array's
 *      underlying ArrayBuffer via a Uint8Array view, in 16 MB
 *      chunks so a single fs.read syscall doesn't have to handle
 *      a multi-GB transfer.
 *
 * Throws on malformed headers, unsupported dtypes/orders/shapes, or
 * truncated data — caller decides whether to cache the failure.
 */
async function loadNpyF32Matrix(
  vectorsPath: string
): Promise<{ data: Float32Array; rows: number; dims: number }> {
  // Lazy import — fs/promises is already loaded by Node in any
  // realistic process, but we keep the require local so this
  // module imports remain identical to the previous shape.
  const { open } = await import('node:fs/promises');
  const fh = await open(vectorsPath, 'r');
  try {
    // 4 KB is more than enough — npy headers max out at 65,535 chars
    // by spec but in practice the build_embeddings_index.py output
    // headers are 50-100 bytes. If we ever bump to v2/v3 this read
    // would need to grow, but parseNpyHeader rejects those anyway.
    const headerBuf = Buffer.alloc(4096);
    const { bytesRead: headerRead } = await fh.read(headerBuf, 0, 4096, 0);
    const head = parseNpyHeader(headerBuf.subarray(0, headerRead));
    const { rows, dims, dataOffset } = head;
    const totalBytes = rows * dims * 4;

    const data = new Float32Array(rows * dims);
    // Wrap the typed array's backing store as a Uint8Array so fs.read
    // can write directly into it. ArrayBuffer of a freshly-allocated
    // Float32Array is 8-byte-aligned, so the view is safe to use.
    const target = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

    const CHUNK = 16 * 1024 * 1024; // 16 MB
    let written = 0;
    while (written < totalBytes) {
      const span = Math.min(CHUNK, totalBytes - written);
      const slice = target.subarray(written, written + span);
      const { bytesRead } = await fh.read(slice, 0, span, dataOffset + written);
      if (bytesRead === 0) {
        throw new Error(
          `.npy data section truncated: read ${written}/${totalBytes} bytes`
        );
      }
      written += bytesRead;
    }

    // Sanity: assert host endianness matches `<f4` (little-endian).
    // x86_64 + Apple Silicon are both little-endian; throwing here on
    // a hypothetical big-endian host is loud-failure rather than
    // silently corrupting all dot-products.
    const probe = new Uint32Array(new Uint8Array([1, 0, 0, 0]).buffer);
    if (probe[0] !== 1) {
      throw new Error('host is big-endian; .npy <f4 byte-swap not implemented');
    }

    return { data, rows, dims };
  } finally {
    await fh.close();
  }
}

function loadBucket(bucket: string): Promise<BucketCacheEntry | null> {
  // Promise-based cache: concurrent first-callers share one load
  // instead of each issuing their own multi-second fs.read against
  // (e.g.) the 3 GB ingredients vectors.npy.
  const cached = _bucketCache.get(bucket);
  if (cached !== undefined) return cached;

  // Resolve the data root via the same path as getConn(). We don't
  // need the SQLite handle here — semantic search only uses the .npy
  // + .jsonl files — but we do need the root.
  const root = _resolvedDataRoot ?? resolveDataRoot();
  if (!root) {
    const nullPromise = Promise.resolve(null);
    _bucketCache.set(bucket, nullPromise);
    return nullPromise;
  }
  const dir = path.join(root, 'indexes', 'embeddings', bucket);
  const vectorsPath = path.join(dir, 'vectors.npy');
  const metaPath = path.join(dir, 'metadata.jsonl');
  if (!fs.existsSync(vectorsPath) || !fs.existsSync(metaPath)) {
    const nullPromise = Promise.resolve(null);
    _bucketCache.set(bucket, nullPromise);
    return nullPromise;
  }

  // Stream the .npy directly into a Float32Array — the ingredients
  // bucket is ~3.0 GB on disk (2.06M descriptions × 384 dims × 4 bytes)
  // and the previous readFileSync + per-element copy double-allocated
  // for ~6 GB peak, which OOM'd a default-heap Node process. The
  // metadata.jsonl is ~450 MB for that bucket; that one we still read
  // up-front because we need every row's metadata anyway and parsing
  // line-by-line would just shift the same allocation onto V8's
  // string heap.
  // Deferred pattern. We need the inner async closure to reference
  // the outer promise (so the catch handler can invalidate the
  // cache slot it actually owns), but a `const promise = (async ...)`
  // self-reference confuses TS's flow analysis. Splitting into an
  // explicit Promise + an async runner with a tiny `done` flag side-
  // steps that and is just as cheap.
  let resolve!: (entry: BucketCacheEntry | null) => void;
  const promise = new Promise<BucketCacheEntry | null>((r) => {
    resolve = r;
  });
  _bucketCache.set(bucket, promise);
  void (async () => {
    try {
      const { data, rows, dims } = await loadNpyF32Matrix(vectorsPath);
      const metaRaw = fs.readFileSync(metaPath, 'utf8');
      const metadata: Array<Record<string, unknown>> = [];
      for (const line of metaRaw.split('\n')) {
        if (!line) continue;
        metadata.push(JSON.parse(line) as Record<string, unknown>);
      }
      if (metadata.length !== rows) {
        throw new Error(
          `bucket ${bucket}: metadata rows ${metadata.length} != vectors rows ${rows}`
        );
      }
      resolve({ vectors: data, rows, dims, metadata });
    } catch (e) {
      // A partially-built bucket (truncated vectors.npy) or a real
      // I/O error is "no hits" rather than a hard error so hybrid
      // callers that probe multiple buckets keep working. Half-
      // written ingredients builds that race a query should succeed
      // on the next call once the build completes.
      if (process.env.DATAPACK_DEBUG) {
        console.warn(`[datapackSearch] failed to load bucket ${bucket}:`, e);
      }
      if (_bucketCache.get(bucket) === promise) _bucketCache.delete(bucket);
      resolve(null);
    }
  })();
  return promise;
}

async function loadModel(): Promise<
  (t: string[], opts: object) => Promise<{ data: Float32Array }>
> {
  if (_modelPromise) return _modelPromise;
  // Dynamic import keeps transformers.js (and its ~30 MB ONNX
  // runtime) out of the cold-start path for FTS-only callers.
  // On rejection (network outage, corrupted cache) we clear the
  // cached promise so the next caller retries — without this, a
  // single transient failure makes semantic() permanently broken
  // for the lifetime of the process.
  const promise = (async () => {
    const { pipeline } = await import('@huggingface/transformers');
    const fe = (await pipeline('feature-extraction', _BGE_MODEL_ID)) as unknown as (
      t: string[],
      opts: object
    ) => Promise<{ data: Float32Array }>;
    return fe;
  })();
  _modelPromise = promise;
  promise.catch(() => {
    if (_modelPromise === promise) _modelPromise = null;
  });
  return promise;
}

/**
 * Cosine-similarity search over a per-bucket BGE embedding index.
 *
 * `bucket` is a directory under `indexes/embeddings/` (recipes /
 * techniques / safety / ingredients). Returns `[]` when:
 *   - the data pack isn't mounted (`available()` is false)
 *   - the bucket has no `vectors.npy` (e.g. ingredients not built yet)
 *   - the query is empty / whitespace
 *
 * Vectors are L2-normalized at index time; we ask transformers.js to
 * normalize the query embedding too, so cosine collapses to a dot
 * product. Top-k is computed via partial sort (heap-equivalent), not a
 * full O(N log N) sort, so this stays fast even on the multi-million-
 * row USDA bucket.
 */
export async function semantic(
  query: string,
  opts: { bucket: string; limit?: number }
): Promise<SemanticHit[]> {
  const trimmed = query?.trim();
  if (!trimmed) return [];
  if (!available()) return [];

  const bucket = opts.bucket;
  const limit = Math.max(1, Math.min(200, opts.limit ?? 20));

  const entry = await loadBucket(bucket);
  if (!entry) return [];

  const model = await loadModel();
  const out = await model([_BGE_QUERY_PREFIX + trimmed], {
    pooling: 'mean',
    normalize: true,
  });
  // transformers.js returns a Tensor; .data is a Float32Array of length
  // dims for a single-input batch. Defensive slice in case the runtime
  // returns the full (1, dims) matrix instead.
  const qv =
    out.data.length === entry.dims
      ? out.data
      : out.data.subarray(0, entry.dims);
  if (qv.length !== entry.dims) {
    throw new Error(
      `query embedding length ${qv.length} != bucket dims ${entry.dims}`
    );
  }

  // Score every row: vectors[i] · qv. Single contiguous Float32Array
  // multiply — no per-row allocations.
  const { vectors, rows, dims } = entry;
  const sims = new Float32Array(rows);
  for (let i = 0; i < rows; i++) {
    let s = 0;
    const base = i * dims;
    for (let j = 0; j < dims; j++) {
      s += vectors[base + j]! * qv[j]!;
    }
    sims[i] = s;
  }

  // Top-k via partial selection: scan once, maintain a sorted insert
  // into a small array of size `limit`. Cheaper than a full sort when
  // limit << rows, which is the common case (limit=20 vs rows≈4k–2M).
  const k = Math.min(limit, rows);
  const topIdx: number[] = [];
  const topScore: number[] = [];
  for (let i = 0; i < rows; i++) {
    const s = sims[i]!;
    if (topIdx.length < k) {
      // Insert in descending order.
      let pos = topIdx.length;
      while (pos > 0 && topScore[pos - 1]! < s) pos--;
      topIdx.splice(pos, 0, i);
      topScore.splice(pos, 0, s);
    } else if (s > topScore[k - 1]!) {
      let pos = k - 1;
      while (pos > 0 && topScore[pos - 1]! < s) pos--;
      topIdx.splice(pos, 0, i);
      topScore.splice(pos, 0, s);
      topIdx.length = k;
      topScore.length = k;
    }
  }

  const hits: SemanticHit[] = [];
  for (let h = 0; h < topIdx.length; h++) {
    const meta = entry.metadata[topIdx[h]!]!;
    hits.push({ score: topScore[h]!, bucket, ...meta } as SemanticHit);
  }
  return hits;
}

// ── Hybrid (BM25 + cosine fusion) ─────────────────────────────────

export type HybridBucket = 'recipes' | 'techniques' | 'safety' | 'ingredients';

export interface HybridHit {
  /** RRF fused score — higher is better. */
  score: number;
  /** Which bucket this query targeted. */
  bucket: HybridBucket;
  /** Allow either source-table envelope (FTS hit shape) or per-bucket
   *  metadata fields (semantic hit shape) to ride along — callers
   *  identify a hit via the per-source id fields. */
  [k: string]: unknown;
}

// Bucket → FTS source mapping. Two buckets share one FTS source
// because the underlying corpus is the same — the embedding bucketing
// gives us topic separation, not the FTS tokenizer. ingredients goes
// to USDA, safety to FDA, the two Wikibooks buckets to wikibooks.
const HYBRID_FTS_SOURCE: Record<HybridBucket, Exclude<FtsSource, 'all'>> = {
  recipes: 'wikibooks',
  techniques: 'wikibooks',
  safety: 'fda',
  ingredients: 'usda',
};

// Pick the most-stable id available from a hit (FTS or semantic). Used
// to dedupe across the two retrieval channels — the same FDA section
// or USDA food can appear in both lists with different envelope shapes.
// Order matters: section_id beats fdc_id beats code beats page_id beats
// rowid beats id beats title. Same priority list as scripts/datapack/
// search.py so the two clients agree on identity for any future
// integration tests.
function hybridKey(row: Record<string, unknown>): string {
  for (const k of [
    'section_id',
    'fdc_id',
    'code',
    'page_id',
    'rowid',
    'id',
  ]) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== '') {
      return `${k}:${v}`;
    }
  }
  const t = row['title'];
  return t !== undefined && t !== null && t !== '' ? `title:${t}` : '';
}

/**
 * Reciprocal-rank-fusion of FTS5 + semantic over a single bucket.
 *
 * `rrfK` is the standard 60. We pull `Math.max(limit * 4, 40)` from
 * each side so the fusion has reorder room, then collapse to `limit`.
 * Returns one merged list ordered by fused score (higher is better).
 *
 * Returns `[]` when:
 *   - the data pack isn't mounted (`available()` is false)
 *   - the per-bucket vectors aren't built
 *   - the query is empty / whitespace
 *   - the BGE model fails to load (caller can retry — model promise
 *     is cleared on rejection)
 */
export async function hybrid(
  query: string,
  opts: { bucket: HybridBucket; limit?: number; rrfK?: number }
): Promise<HybridHit[]> {
  const trimmed = query?.trim();
  if (!trimmed) return [];
  if (!available()) return [];

  const bucket = opts.bucket;
  const ftsSource = HYBRID_FTS_SOURCE[bucket];
  if (!ftsSource) return [];

  const limit = Math.max(1, Math.min(200, opts.limit ?? 20));
  const rrfK = Math.max(1, opts.rrfK ?? 60);
  const wide = Math.max(limit * 4, 40);

  // Pull both channels concurrently so the 30 ms FTS query and the
  // model+vector load (or warm-cache 5 ms) overlap rather than serialize.
  const [ftsHits, semHits] = await Promise.all([
    Promise.resolve(fts(escapeFtsPhrase(trimmed), { source: ftsSource, limit: wide })),
    semantic(trimmed, { bucket, limit: wide }),
  ]);

  // RRF accumulator keyed off hybridKey().
  type FuseEntry = {
    fused: number;
    ftsHit: FtsHit | null;
    semHit: SemanticHit | null;
  };
  const fused = new Map<string, FuseEntry>();

  for (let rank = 0; rank < ftsHits.length; rank++) {
    const h = ftsHits[rank]!;
    const k = hybridKey(h as unknown as Record<string, unknown>);
    if (!k) continue;
    const cur = fused.get(k) ?? { fused: 0, ftsHit: null, semHit: null };
    cur.fused += 1 / (rrfK + rank);
    cur.ftsHit = h;
    fused.set(k, cur);
  }
  for (let rank = 0; rank < semHits.length; rank++) {
    const h = semHits[rank]!;
    const k = hybridKey(h as Record<string, unknown>);
    if (!k) continue;
    const cur = fused.get(k) ?? { fused: 0, ftsHit: null, semHit: null };
    cur.fused += 1 / (rrfK + rank);
    cur.semHit = h;
    fused.set(k, cur);
  }

  const ordered = [...fused.values()].sort((a, b) => b.fused - a.fused);

  // Surface shape matches the FTS hit envelope when available (the
  // route+UI know how to drill into FtsHit by source+id) and falls
  // back to the semantic envelope otherwise. This keeps the existing
  // lookupUrlFor / drill-in plumbing in the UI working unchanged.
  const out: HybridHit[] = [];
  for (const e of ordered.slice(0, limit)) {
    const base = e.ftsHit ?? e.semHit ?? {};
    out.push({ ...(base as Record<string, unknown>), score: e.fused, bucket });
  }
  return out;
}
