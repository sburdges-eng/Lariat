/**
 * Read-only search client for the in-tree compliance index.
 *
 * The index lives at `data/cache/compliance.db` and is built by
 * `scripts/build-compliance-index.mjs` from `data/normalized/compliance_rules.jsonl`.
 *
 * Two reasons this index lives in-tree (not in the off-tree Data Pack
 * at /Volumes/Sean's SSD/lariat-data):
 *   1. The compliance corpus is small enough (kilobytes) to ship with
 *      the repo — we don't need the per-bucket vector layout the Data
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

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'cache', 'compliance.db');

// Tiny stop-word filter — narrow on purpose. We only drop words that
// almost certainly carry no signal in compliance queries; we leave
// substantive words like "must", "can", "should" alone so a question
// like "can a bouncer detain a patron?" still matches the relevant
// rule body. Adding too many here turns useful queries into the
// empty set.
const STOP_WORDS = new Set([
  'a','an','the','and','or','of','to','in','on','at','by','for','with',
  'is','are','was','were','be','been','being',
  'do','does','did','done',
  'how','what','when','where','why','who','which',
  'i','we','you','they','them','us','our','your',
  'this','that','these','those','it','its',
  'as','if','than','then','so',
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
  return _dbPathOverride ?? DEFAULT_DB_PATH;
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
  /** Restrict to one or more domains, e.g. ['labor_law','liquor_law']. */
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
  /** Decoded payload — full rule. */
  rule: ComplianceRulePayload;
}

/**
 * FTS5-backed search. Falls back to empty result on machines where the
 * index hasn't been built yet (the KA context block above this just
 * skips the compliance section in that case).
 */
export function searchCompliance(
  query: string,
  opts: SearchOptions = {},
): SearchHit[] {
  const conn = getConn();
  if (!conn) return [];
  const q = (query || '').trim();
  if (!q) return [];

  const limit = Math.max(1, Math.min(25, opts.limit ?? 5));

  // Sanitize the query for FTS5 — fts5 MATCH treats unquoted bareword
  // tokens as ANDed prefix searches, but quotes / parens / colons in
  // user input can syntax-error the parser. Strip operators, preserve
  // alphanumerics + spaces. Lowercase first so uppercase AND / OR / NOT
  // are not parsed as FTS5 boolean operators.
  const sanitized = q
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized) return [];
  // Drop stop words so a long natural-language query ("how does HFWA
  // paid sick leave work?") doesn't fail because "how" / "does" /
  // "work" never appear in the corpus. We OR the remaining tokens —
  // BM25 ranks by how many distinct query terms match, so the most
  // relevant rule still wins. We use OR (uppercase, an FTS5 boolean
  // operator) rather than the implicit AND because compliance queries
  // are usually long-form.
  const allTokens = sanitized.split(' ').filter((t) => t.length > 1);
  const tokens = allTokens.filter((t) => !STOP_WORDS.has(t));
  if (tokens.length === 0) return [];
  // Add `*` to each token so partial-word matches work (e.g. "bartender"
  // matches "bartenders"). FTS5 prefix syntax: token*
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
  sql += ` ORDER BY bm25(compliance_fts) ASC LIMIT ?`;
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

/** Render up to N matching compliance rules into a compact text block
 *  for the Kitchen Assistant grounded context. Mirrors the shape used
 *  by other render helpers in lib/kitchenAssistantContext.ts. */
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
    if (r.escalation?.manager_required) text += `    escalation: manager required\n`;
    if (r.escalation?.police_required) text += `    escalation: police required\n`;
    if (r.escalation?.ems_required) text += `    escalation: EMS required\n`;
    text += `    source: ${r.source.title}\n`;
    text += `    verification: ${h.verification_status}\n`;
  }
  text += '  NOTE: rows tagged "unverified" or "internal_house_policy_draft" are reference only — verify with counsel before treating as authoritative.\n';

  return {
    text,
    source: {
      type: 'compliance',
      detail: `${hits.length} CO compliance rule(s)`,
    },
  };
}

// ── Test-only hooks ───────────────────────────────────────────────

export function _setDbPathForTest(p: string | null): void {
  if (_conn) {
    try { _conn.close(); } catch { /* ignore */ }
    _conn = null;
  }
  _dbPathOverride = p;
}

export function _setAvailableOverrideForTest(v: boolean | null): void {
  _availableOverride = v;
}
