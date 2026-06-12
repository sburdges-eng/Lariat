/**
 * Read-only search client for the in-tree compliance index.
 *
 * The index lives at `data/cache/compliance.db` and is built by
 * `scripts/build-compliance-index.mjs` from `data/normalized/compliance_rules.jsonl`.
 *
 * Two reasons this index lives in-tree (not in the off-tree Data Pack
 * reached through `data/lariat-data` or `LARIAT_DATA_ROOT`):
 *   1. The compliance corpus is small enough (kilobytes) to ship with
 *      the repo - we don't need the per-bucket vector layout the Data
 *      Pack uses for its multi-GB sources.
 *   2. Compliance grounding should be available on every dev machine,
 *      not just the production Mac mini with the SSD mounted. The Data
 *      Pack client (lib/datapackSearch.ts) is graceful-degraded for
 *      machines without the SSD; this client is the always-available
 *      counterpart.
 *
 * The KA context builder (lib/kitchenAssistantContext.ts) calls
 * `renderCompliance(question)` from this module under the labor /
 * liquor / security keyword gates. No vendor-PII risk: the corpus is
 * either public (CO statutes) or Lariat house-policy.
 */

import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { resolveDataDir } from './dataDir.ts';

function defaultDbPath(): string {
  return path.join(resolveDataDir(), 'cache', 'compliance.db');
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'done',
  'how', 'what', 'when', 'where', 'why', 'who', 'which',
  'i', 'we', 'you', 'they', 'them', 'us', 'our', 'your',
  'this', 'that', 'these', 'those', 'it', 'its',
  'as', 'if', 'than', 'then', 'so',
]);

export interface ComplianceRule {
  id: string;
  domain: string;
  jurisdiction: string;
  topic: string;
  audience: string[];
  verification_status: string;
  payload: ComplianceRulePayload;
}

export interface ComplianceRulePayload {
  id: string;
  domain: string;
  jurisdiction: string;
  topic: string;
  audience: string[];
  plain_language_summary: string;
  required_actions: string[];
  prohibited_actions: string[];
  allowed_actions: string[];
  exceptions: string[];
  escalation: {
    manager_required?: boolean;
    police_required?: boolean;
    ems_required?: boolean;
    documentation_required?: boolean;
  };
  source: {
    title: string;
    publisher: string;
    url: string;
    effective_date: string;
    retrieved_date: string;
  };
  verification: {
    status: string;
    last_verified: string;
    review_interval_days: number;
  };
  notes: string[];
}

let _conn: DB | null = null;
let _availableOverride: boolean | null = null;
let _dbPathOverride: string | null = null;

function dbPath(): string {
  return _dbPathOverride ?? defaultDbPath();
}

function getConn(): DB | null {
  if (_conn) return _conn;
  const p = dbPath();
  if (!fs.existsSync(p)) return null;
  try {
    const conn = new Database(p, { readonly: true, fileMustExist: true });
    conn.pragma('query_only = ON');
    _conn = conn;
    return conn;
  } catch {
    return null;
  }
}

export function available(): boolean {
  if (_availableOverride !== null) return _availableOverride;
  return getConn() !== null;
}

export interface SearchOptions {
  /** Cap on returned rows (default 5, max 25). */
  limit?: number;
  /** Restrict to one or more domains, e.g. ['labor_law', 'liquor_law']. */
  domains?: string[];
}

export interface SearchHit {
  id: string;
  domain: string;
  jurisdiction: string;
  topic: string;
  audience: string[];
  verification_status: string;
  /** BM25 rank (lower = better; SQLite FTS5 convention). */
  bm25: number;
  /** Decoded payload - full rule. */
  rule: ComplianceRulePayload;
}

export function searchCompliance(
  query: string,
  opts: SearchOptions = {},
): SearchHit[] {
  const conn = getConn();
  if (!conn) return [];
  const q = (query || '').trim();
  if (!q) return [];

  const limit = Math.max(1, Math.min(25, opts.limit ?? 5));
  const sanitized = q
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized) return [];

  const allTokens = sanitized.split(' ').filter((t) => t.length > 1);
  const tokens = allTokens.filter((t) => !STOP_WORDS.has(t));
  if (tokens.length === 0) return [];
  const matchExpr = tokens.map((t) => `${t}*`).join(' OR ');

  let sql = `
    SELECT cr.id, cr.domain, cr.jurisdiction, cr.topic, cr.audience,
           cr.verification_status, cr.payload, bm25(compliance_fts) AS bm25
      FROM compliance_fts
      JOIN compliance_rules cr ON cr.id = compliance_fts.id
     WHERE compliance_fts MATCH ?
  `;
  const params: Array<string> = [matchExpr];
  if (opts.domains && opts.domains.length > 0) {
    sql += ` AND cr.domain IN (${opts.domains.map(() => '?').join(',')})`;
    for (const d of opts.domains) params.push(d);
  }
  sql += ' ORDER BY bm25(compliance_fts) ASC LIMIT ?';
  params.push(String(limit));

  try {
    const rows = conn.prepare(sql).all(...params) as Array<{
      id: string;
      domain: string;
      jurisdiction: string;
      topic: string;
      audience: string;
      verification_status: string;
      payload: string;
      bm25: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      domain: r.domain,
      jurisdiction: r.jurisdiction,
      topic: r.topic,
      audience: JSON.parse(r.audience),
      verification_status: r.verification_status,
      bm25: r.bm25,
      rule: JSON.parse(r.payload) as ComplianceRulePayload,
    }));
  } catch {
    return [];
  }
}

export interface ComplianceContextBlock {
  text: string;
  source: { type: string; detail: string } | null;
}

export function renderCompliance(
  question: string,
  opts: SearchOptions = {},
): ComplianceContextBlock {
  const hits = searchCompliance(question, { limit: opts.limit ?? 3, domains: opts.domains });
  if (hits.length === 0) return { text: '', source: null };

  let text = '\nCOLORADO COMPLIANCE (verify before acting):\n';
  for (const h of hits) {
    const r = h.rule;
    text += `  - [${h.id}] ${r.topic} (${r.domain})\n`;
    text += `    summary: ${r.plain_language_summary}\n`;
    if (r.required_actions.length > 0) {
      text += `    required: ${r.required_actions.slice(0, 3).join('; ')}\n`;
    }
    if (r.prohibited_actions.length > 0) {
      text += `    prohibited: ${r.prohibited_actions.slice(0, 3).join('; ')}\n`;
    }
    if (r.escalation?.manager_required) text += '    escalation: manager required\n';
    if (r.escalation?.police_required) text += '    escalation: police required\n';
    if (r.escalation?.ems_required) text += '    escalation: EMS required\n';
    text += `    source: ${r.source.title}\n`;
    text += `    verification: ${h.verification_status}\n`;
  }
  text += '  NOTE: rows tagged "unverified" or "internal_house_policy_draft" are reference only - verify with counsel before treating as authoritative.\n';

  return {
    text,
    source: {
      type: 'compliance',
      detail: `${hits.length} CO compliance rule(s)`,
    },
  };
}

const _BGE_QUERY_PREFIX =
  'Represent this sentence for searching relevant passages: ';
const _BGE_MODEL_ID = 'BAAI/bge-small-en-v1.5';

interface VectorsCache {
  vectors: Float32Array;
  ids: string[];
  rows: number;
  dims: number;
}

let _vectorsCachePromise: Promise<VectorsCache | null> | null = null;
let _modelPromise:
  | Promise<(_t: string[], _opts: object) => Promise<{ data: Float32Array }>>
  | null = null;
let _vectorsPathOverride: string | null = null;
let _idsPathOverride: string | null = null;

function vectorsPaths(): { npy: string; ids: string } {
  const dir = path.dirname(dbPath());
  return {
    npy: _vectorsPathOverride ?? path.join(dir, 'compliance.vectors.npy'),
    ids: _idsPathOverride ?? path.join(dir, 'compliance.vectors.ids.json'),
  };
}

function parseNpyHeaderLocal(buf: Buffer): {
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
  if (major !== 1) throw new Error(`unsupported .npy major version ${major}`);
  const headerLen = buf.readUInt16LE(8);
  const dataOffset = 10 + headerLen;
  const header = buf.toString('ascii', 10, dataOffset);
  const descrMatch = header.match(/'descr'\s*:\s*'([^']+)'/);
  const fortranMatch = header.match(/'fortran_order'\s*:\s*(True|False)/);
  const shapeMatch = header.match(/'shape'\s*:\s*\(([^)]*)\)/);
  if (!descrMatch || !fortranMatch || !shapeMatch) {
    throw new Error('malformed .npy header');
  }
  if (descrMatch[1] !== '<f4') throw new Error(`unsupported dtype ${descrMatch[1]}`);
  if (fortranMatch[1] !== 'False') throw new Error('unsupported fortran_order=True');
  const dims = (shapeMatch[1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number.parseInt(s, 10));
  if (dims.length !== 2) throw new Error('expected 2-D shape');
  const [rows, cols] = dims as [number, number];
  return { rows, dims: cols, dataOffset };
}

async function loadVectors(): Promise<VectorsCache | null> {
  if (_vectorsCachePromise) return _vectorsCachePromise;
  const promise = (async (): Promise<VectorsCache | null> => {
    const { npy: npyPath, ids: idsPath } = vectorsPaths();
    if (!fs.existsSync(npyPath) || !fs.existsSync(idsPath)) return null;
    const sidecar = JSON.parse(fs.readFileSync(idsPath, 'utf-8')) as {
      ids: string[];
    };
    if (!Array.isArray(sidecar.ids)) return null;
    const buf = fs.readFileSync(npyPath);
    const { rows, dims, dataOffset } = parseNpyHeaderLocal(buf);
    if (rows !== sidecar.ids.length) {
      throw new Error(
        `compliance vectors: row count ${rows} != id count ${sidecar.ids.length}`,
      );
    }
    const vectors = new Float32Array(
      buf.buffer.slice(
        buf.byteOffset + dataOffset,
        buf.byteOffset + dataOffset + rows * dims * 4,
      ),
    );
    return { vectors, ids: sidecar.ids, rows, dims };
  })();
  _vectorsCachePromise = promise;
  promise.catch(() => {
    if (_vectorsCachePromise === promise) _vectorsCachePromise = null;
  });
  return promise;
}

type ModelFn = (
  _t: string[],
  _opts: object,
) => Promise<{ data: Float32Array }>;

let _modelOverride: ModelFn | null = null;

async function loadModel(): Promise<ModelFn> {
  if (_modelOverride) return _modelOverride;
  if (_modelPromise) return _modelPromise;
  const promise = (async () => {
    const { pipeline } = await import('@huggingface/transformers');
    const fe = (await pipeline(
      'feature-extraction',
      _BGE_MODEL_ID,
    )) as unknown as ModelFn;
    return fe;
  })();
  _modelPromise = promise;
  promise.catch(() => {
    if (_modelPromise === promise) _modelPromise = null;
  });
  return promise;
}

export interface SemanticHit {
  id: string;
  /** Cosine similarity in [-1, 1] - higher is better. */
  score: number;
}

export async function searchComplianceSemantic(
  query: string,
  opts: { limit?: number } = {},
): Promise<SemanticHit[]> {
  const trimmed = (query || '').trim();
  if (!trimmed) return [];
  const cache = await loadVectors();
  if (!cache) return [];

  let model;
  try {
    model = await loadModel();
  } catch {
    return [];
  }
  const out = await model([_BGE_QUERY_PREFIX + trimmed], {
    pooling: 'mean',
    normalize: true,
  });
  const qv =
    out.data.length === cache.dims
      ? out.data
      : out.data.length > cache.dims
        ? out.data.subarray(0, cache.dims)
        : out.data;
  if (qv.length !== cache.dims) {
    throw new Error(
      `compliance vectors: query dim ${qv.length} != corpus dim ${cache.dims}`,
    );
  }

  const limit = Math.max(1, Math.min(25, opts.limit ?? 5));
  const { vectors, rows, dims, ids } = cache;
  const scored: { id: string; score: number }[] = [];
  for (let i = 0; i < rows; i++) {
    let s = 0;
    const base = i * dims;
    for (let j = 0; j < dims; j++) s += vectors[base + j]! * qv[j]!;
    scored.push({ id: ids[i]!, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function rrf(
  lists: Array<Array<{ id: string }>>,
  k: number = 60,
): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank]!.id;
      const inc = 1 / (k + rank + 1);
      scores.set(id, (scores.get(id) ?? 0) + inc);
    }
  }
  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

export interface HybridHit extends SearchHit {
  /** RRF-fused score (higher is better). */
  fused: number;
}

export async function searchComplianceHybrid(
  query: string,
  opts: SearchOptions = {},
): Promise<HybridHit[]> {
  const limit = Math.max(1, Math.min(25, opts.limit ?? 5));
  const wide = Math.max(limit, 10);
  const bmRaw = searchCompliance(query, { ...opts, limit: wide });
  const semRaw = await searchComplianceSemantic(query, { limit: wide });

  if (semRaw.length === 0) {
    return bmRaw.slice(0, limit).map((h) => ({ ...h, fused: 0 }));
  }

  const fused = rrf([bmRaw, semRaw]);
  const byId = new Map(bmRaw.map((h) => [h.id, h]));
  const conn = getConn();
  const out: HybridHit[] = [];
  for (const f of fused) {
    if (out.length >= limit) break;
    const bm = byId.get(f.id);
    if (bm) {
      out.push({ ...bm, fused: f.score });
      continue;
    }
    if (!conn) continue;
    const row = conn
      .prepare(
        `SELECT id, domain, jurisdiction, topic, audience, verification_status, payload
           FROM compliance_rules WHERE id = ?`,
      )
      .get(f.id) as
      | {
          id: string;
          domain: string;
          jurisdiction: string;
          topic: string;
          audience: string;
          verification_status: string;
          payload: string;
        }
      | undefined;
    if (!row) continue;
    out.push({
      id: row.id,
      domain: row.domain,
      jurisdiction: row.jurisdiction,
      topic: row.topic,
      audience: JSON.parse(row.audience),
      verification_status: row.verification_status,
      bm25: 0,
      rule: JSON.parse(row.payload) as ComplianceRulePayload,
      fused: f.score,
    });
  }
  return out;
}

export async function renderComplianceHybrid(
  question: string,
  opts: SearchOptions = {},
): Promise<ComplianceContextBlock> {
  const hits = await searchComplianceHybrid(question, {
    limit: opts.limit ?? 3,
    domains: opts.domains,
  });
  if (hits.length === 0) return { text: '', source: null };

  let text = '\nCOLORADO COMPLIANCE (verify before acting):\n';
  for (const h of hits) {
    const r = h.rule;
    text += `  - [${h.id}] ${r.topic} (${r.domain})\n`;
    text += `    summary: ${r.plain_language_summary}\n`;
    if (r.required_actions.length > 0) {
      text += `    required: ${r.required_actions.slice(0, 3).join('; ')}\n`;
    }
    if (r.prohibited_actions.length > 0) {
      text += `    prohibited: ${r.prohibited_actions.slice(0, 3).join('; ')}\n`;
    }
    if (r.escalation?.manager_required) text += '    escalation: manager required\n';
    if (r.escalation?.police_required) text += '    escalation: police required\n';
    if (r.escalation?.ems_required) text += '    escalation: EMS required\n';
    text += `    source: ${r.source.title}\n`;
    text += `    verification: ${h.verification_status}\n`;
  }
  text += '  NOTE: rows tagged "unverified" or "internal_house_policy_draft" are reference only - verify with counsel before treating as authoritative.\n';

  return {
    text,
    source: {
      type: 'compliance',
      detail: `${hits.length} CO compliance rule(s) [hybrid]`,
    },
  };
}

export function _setDbPathForTest(p: string | null): void {
  if (_conn) {
    try {
      _conn.close();
    } catch {
      /* ignore */
    }
    _conn = null;
  }
  _dbPathOverride = p;
  _vectorsCachePromise = null;
}

export function _setAvailableOverrideForTest(v: boolean | null): void {
  _availableOverride = v;
}

export function _setVectorsPathForTest(
  npy: string | null,
  ids: string | null,
): void {
  _vectorsCachePromise = null;
  _vectorsPathOverride = npy;
  _idsPathOverride = ids;
}

export function _setModelForTest(fn: ModelFn | null): void {
  _modelOverride = fn;
  _modelPromise = null;
}

export function _resetForTest(): void {
  if (_conn) {
    try {
      _conn.close();
    } catch {
      /* ignore */
    }
    _conn = null;
  }
  _dbPathOverride = null;
  _availableOverride = null;
  _vectorsPathOverride = null;
  _idsPathOverride = null;
  _vectorsCachePromise = null;
  _modelOverride = null;
  _modelPromise = null;
}
