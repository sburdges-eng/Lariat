/**
 * Read-only DB query tool for LaRi (the kitchen assistant).
 *
 * # Why this exists
 *
 * The grounded-context builder (`lib/kitchenAssistantContext.ts`) statically
 * keyword-routes ~15 of the DB's ~80 tables into the LLM prompt before each
 * answer. That's great for known phrasings ("what's 86?", "is the brisket
 * temped?") and terrible for analytical drill-downs ("which Sysco prices
 * changed since last Friday?", "show me cooling cycles that crossed the
 * 6-hour mark this week", "what's the margin on the rib roast vs. its 90-day
 * cost trend?"). Users ask those questions in natural language; the assistant
 * has nothing to ground against.
 *
 * The fix is function-calling adapted to LaRi's deterministic-action
 * contract: the LLM emits `{ "action": "db_query", "query": "<name>",
 * "params": { ... } }`, the backend looks the query up in a vetted registry,
 * binds parameters defensively, runs read-only SQL inside a transaction,
 * emits an audit-event row, and returns rows for the route to format back
 * into the answer.
 *
 * # Safety properties
 *
 *   1. **No LLM-authored SQL ever.** The LLM only picks a registered
 *      query NAME and supplies PARAM VALUES. The SQL string is a literal
 *      defined by us. SQL injection is impossible by construction.
 *
 *   2. **Location is forced from the request.** `location_id` is bound by
 *      the runner from `requestLocationId`, never from `payload.params`,
 *      even if the LLM tried to override it. Cross-location reads are
 *      structurally impossible.
 *
 *   3. **Tier gating mirrors `buildGroundedContext`.** Each query carries
 *      `tier: 'cook' | 'manager'`. Manager-tier queries require `hasPin`.
 *      An unauthenticated LAN client trying to read sales/labor/HR/recognition
 *      data via the LLM bounces with the same error shape that the prompt
 *      context already uses (`'not available at this auth tier'`).
 *
 *   4. **Row caps are hardcoded per query.** Even if the LLM passes
 *      `limit=999999`, the runner clamps to the registry-declared `rowCap`.
 *      Default cap is 50 — keeps the prompt context budget intact and
 *      stops a hostile LLM from triggering a full-table scan render.
 *
 *   5. **Read-only enforced two ways.** (a) `better-sqlite3` only sees
 *      `db.prepare(sql).all(...)` — `.run()` is never invoked. (b) An SQL
 *      static check rejects queries whose normalized text isn't a SELECT
 *      or WITH...SELECT. Belt-and-suspenders because a future registry
 *      contributor might paste an UPDATE/DELETE.
 *
 *   6. **Audit-event for every call.** A `query` action lands on
 *      `audit_events` so a manager can see what LaRi consulted. Payload
 *      records the query name, redacted params (no values from PII-bearing
 *      params), and resulting row count. The runner wraps execution in a
 *      `db.transaction(...)` so `postAuditEvent`'s in-transaction guard
 *      passes — even though the query is read-only, the audit write isn't.
 *
 * # What this is NOT
 *
 *   - NOT a general SQL surface. There is no `sql` param the LLM can fill.
 *   - NOT a write path. Use the existing action handlers for mutations.
 *   - NOT a replacement for `buildGroundedContext`. The context builder
 *     still answers "what's on the line right now" in one round-trip; this
 *     tool answers the long-tail of analytical follow-ups.
 *
 * See also:
 *   - lib/dbQueryRegistry.ts — the actual query catalog (kept separate so
 *     contributors can add queries without touching the runner).
 *   - docs/PATTERNS.md §10 — LLM action JSON contract.
 *   - tests/js/test-db-query-tool.mjs — allowlist + tier + injection tests.
 */

import type { Database as DB } from 'better-sqlite3';
import { getDb } from './db.ts';
import { postAuditEvent } from './auditEvents.ts';
import { DB_QUERIES } from './dbQueryRegistry.ts';

/** Authentication tier — mirrors `BuildGroundedContextOpts.hasPin`. */
export type QueryTier = 'cook' | 'manager';

/** Supported param types. JSON-Schema-lite, on purpose — keep validation simple. */
export type QueryParamType = 'string' | 'number' | 'integer' | 'boolean' | 'iso_date';

export interface QueryParamSpec {
  name: string;
  type: QueryParamType;
  required: boolean;
  /** Hard min/max on numeric params; ignored otherwise. */
  min?: number;
  max?: number;
  /** Hard max length on string params. */
  maxLength?: number;
  /** Human-readable hint used in the prompt catalog. */
  description: string;
}

export interface DbQuerySpec {
  /** Stable identifier the LLM emits as `query` in the action JSON. */
  name: string;
  tier: QueryTier;
  /** One-line description shown in the prompt catalog so the LLM can pick. */
  description: string;
  /** Parameterized SQL. Placeholders are `:name` style; `:location_id` is bound by the runner. */
  sql: string;
  /** Param specs the LLM must supply. `:location_id` is implicit and NOT listed here. */
  params: QueryParamSpec[];
  /** Hard row cap applied AFTER the SQL runs (`.slice(0, rowCap)`). Default 50. */
  rowCap?: number;
  /**
   * Whether the query is location-scoped. If true, `:location_id` MUST appear
   * in the SQL and will be bound from the request. If false, the query is
   * global (e.g. SDS lookup, recipe lookup by slug from the bundled book).
   */
  locationScoped: boolean;
  /**
   * Optional param names whose VALUES should NOT be echoed into the audit
   * payload (e.g. cook IDs, free-text search strings that might carry PII).
   * The runner records the param keys but elides the values.
   */
  auditOmitValues?: string[];
}

export interface DbQueryRunRequest {
  /** Query name the LLM picked. */
  name: string;
  /** Param values the LLM supplied. Validated against the spec. */
  params: Record<string, unknown>;
  /** Auth tier (true = manager PIN cookie verified). */
  hasPin: boolean;
  /**
   * Location ID extracted from the request via `lib/location.ts`. The runner
   * binds this to `:location_id`. The LLM's params are NEVER consulted for
   * location, even if it tried to override.
   */
  requestLocationId: string;
}

export interface DbQueryRunResult {
  ok: true;
  rows: Record<string, unknown>[];
  rowCount: number;
  rowCap: number;
  truncated: boolean;
  query: { name: string; description: string; tier: QueryTier };
}

export interface DbQueryRunError {
  ok: false;
  error: string;
  /** Machine-readable code so the route can shape a user-facing message. */
  code:
    | 'unknown_query'
    | 'tier_blocked'
    | 'missing_param'
    | 'invalid_param'
    | 'not_select'
    | 'execution_error';
}

export type DbQueryRunOutcome = DbQueryRunResult | DbQueryRunError;

// ── Registry ──────────────────────────────────────────────────────────

/**
 * Lazy-loaded registry. Kept as a function so `lib/dbQueryRegistry.ts` can
 * grow without forcing this module to import everything up-front (avoids
 * circular-import surprises if a query reaches back into a renderer).
 */
let registryCache: Map<string, DbQuerySpec> | null = null;

/** For tests: replace the registry. Pass `null` to restore from registry file. */
export function _setRegistryForTest(specs: DbQuerySpec[] | null): void {
  if (specs === null) {
    registryCache = null;
    return;
  }
  const m = new Map<string, DbQuerySpec>();
  for (const s of specs) m.set(s.name, s);
  registryCache = m;
}

function getRegistry(): Map<string, DbQuerySpec> {
  if (registryCache) return registryCache;
  // Registry is statically imported above. The cache + indirection
  // remain so `_setRegistryForTest()` can stub it without re-importing.
  const m = new Map<string, DbQuerySpec>();
  for (const s of DB_QUERIES) m.set(s.name, s);
  registryCache = m;
  return m;
}

/** Public: enumerate available queries for a given tier. Used to render the prompt catalog. */
export function listQueriesForTier(tier: QueryTier): DbQuerySpec[] {
  const reg = getRegistry();
  const all = Array.from(reg.values());
  if (tier === 'manager') return all;
  return all.filter((q) => q.tier === 'cook');
}

// ── Validation ────────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function coerceParam(
  spec: QueryParamSpec,
  raw: unknown,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (raw === undefined || raw === null || raw === '') {
    if (spec.required) return { ok: false, reason: `missing required param '${spec.name}'` };
    return { ok: true, value: null };
  }
  switch (spec.type) {
    case 'string': {
      if (typeof raw !== 'string') return { ok: false, reason: `param '${spec.name}' must be a string` };
      const trimmed = raw.trim();
      if (!trimmed) return { ok: false, reason: `param '${spec.name}' must be non-empty` };
      const cap = spec.maxLength ?? 200;
      return { ok: true, value: trimmed.slice(0, cap) };
    }
    case 'number':
    case 'integer': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return { ok: false, reason: `param '${spec.name}' must be a finite number` };
      if (spec.type === 'integer' && !Number.isInteger(n)) {
        return { ok: false, reason: `param '${spec.name}' must be an integer` };
      }
      if (typeof spec.min === 'number' && n < spec.min) return { ok: false, reason: `param '${spec.name}' must be >= ${spec.min}` };
      if (typeof spec.max === 'number' && n > spec.max) return { ok: false, reason: `param '${spec.name}' must be <= ${spec.max}` };
      return { ok: true, value: n };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw ? 1 : 0 };
      if (raw === 'true' || raw === 1) return { ok: true, value: 1 };
      if (raw === 'false' || raw === 0) return { ok: true, value: 0 };
      return { ok: false, reason: `param '${spec.name}' must be boolean` };
    }
    case 'iso_date': {
      if (typeof raw !== 'string' || !ISO_DATE_RE.test(raw)) {
        return { ok: false, reason: `param '${spec.name}' must be YYYY-MM-DD` };
      }
      return { ok: true, value: raw };
    }
    default:
      return { ok: false, reason: `unsupported param type for '${spec.name}'` };
  }
}

/**
 * Static SQL guard. Allows only SELECT or WITH...SELECT. Belt-and-suspenders
 * against a future contributor pasting an UPDATE/DELETE/INSERT/DROP into a
 * query spec — the runner never calls `.run()`, but reading from a destructive
 * statement could still trip side effects (e.g. SQLite triggers) so we
 * reject up front.
 */
function isReadOnlySql(sql: string): boolean {
  const normalized = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim().toLowerCase();
  if (normalized.startsWith('select')) return true;
  if (normalized.startsWith('with ')) {
    // Crude but enough: the very first SELECT keyword after the CTE block
    // must appear before any forbidden DML keyword.
    const firstSelect = normalized.indexOf('select');
    const forbidden = ['insert', 'update', 'delete', 'drop', 'alter', 'attach', 'pragma'];
    for (const kw of forbidden) {
      const at = normalized.indexOf(kw);
      if (at !== -1 && at < firstSelect) return false;
    }
    return firstSelect !== -1;
  }
  return false;
}

// ── Public runner ─────────────────────────────────────────────────────

/**
 * Run a registered query inside an audit-wrapping transaction. Always returns
 * a value — never throws past this boundary (errors collapse into a
 * structured `DbQueryRunError`). The route formats and surfaces the result.
 */
export function runDbQuery(req: DbQueryRunRequest): DbQueryRunOutcome {
  const reg = getRegistry();
  const spec = reg.get(req.name);
  if (!spec) {
    return { ok: false, code: 'unknown_query', error: `Unknown query "${req.name}". Use one of the names listed in the available-queries catalog.` };
  }
  if (spec.tier === 'manager' && !req.hasPin) {
    return { ok: false, code: 'tier_blocked', error: `Query "${spec.name}" is manager-only. Ask a manager to tap their PIN, then try again.` };
  }
  if (!isReadOnlySql(spec.sql)) {
    return { ok: false, code: 'not_select', error: `Query "${spec.name}" is not a read-only SELECT — refusing to execute. This is a registry bug; tell a manager.` };
  }

  // Validate and coerce LLM params.
  const bound: Record<string, unknown> = {};
  for (const ps of spec.params) {
    const raw = req.params ? req.params[ps.name] : undefined;
    const r = coerceParam(ps, raw);
    if (!r.ok) {
      // Dispatch on the actual failure reason, not on whether the param
      // is required. A required param can still fail validation (e.g.
      // out-of-range integer) — that's `invalid_param`, not `missing_param`.
      const isMissing = r.reason.startsWith('missing required param');
      return {
        ok: false,
        code: isMissing ? 'missing_param' : 'invalid_param',
        error: `Cannot run "${spec.name}": ${r.reason}.`,
      };
    }
    bound[ps.name] = r.value;
  }
  if (spec.locationScoped) {
    bound['location_id'] = req.requestLocationId; // ALWAYS from request — never from params.
  }

  // Execute. `db.prepare(...).all(...)` is read-only in better-sqlite3; it
  // throws for non-SELECT statements which is a third belt around (a)
  // isReadOnlySql() and (b) registry discipline.
  const db: DB = getDb();
  const rowCap = Math.max(1, spec.rowCap ?? 50);
  let rowsOut: Record<string, unknown>[] = [];
  let totalRowCount = 0;
  let executionError: string | null = null;

  // Wrap in a transaction so postAuditEvent's in-tx guard passes. The
  // transaction holds for read+audit-write only; auto-commits on return.
  try {
    db.transaction(() => {
      let allRows: unknown[] = [];
      try {
        const stmt = db.prepare(spec.sql);
        allRows = stmt.all(bound) as unknown[];
      } catch (e) {
        executionError = e instanceof Error ? e.message : String(e);
        return;
      }
      rowsOut = (allRows as Record<string, unknown>[]).slice(0, rowCap);
      totalRowCount = allRows.length;
      postAuditEvent({
        entity: 'db_query',
        entity_id: null,
        // audit_events.action has a CHECK constraint of
        // ('insert','update','delete','correction','view').
        // 'view' is the semantically-correct option for a read; 'query'
        // would fail at insert time and roll back the transaction.
        action: 'view',
        actor_cook_id: null,
        actor_source: 'kitchen_assistant',
        location_id: spec.locationScoped ? req.requestLocationId : 'global',
        payload: {
          query: spec.name,
          tier: spec.tier,
          hasPin: req.hasPin,
          paramKeys: spec.params.map((p) => p.name),
          paramsRedacted: redactParams(spec, bound),
          rowCount: rowsOut.length,
          rowCap,
          truncated: totalRowCount > rowCap,
        },
        note: `db_query ${spec.name} returned ${rowsOut.length} row(s)`,
      });
    })();
  } catch {
    return {
      ok: false,
      code: 'execution_error',
      // Do NOT echo `e.message` to the caller. Same rationale as the route's
      // outer action-engine catch: error strings can leak schema/PII.
      error: `Query "${spec.name}" failed unexpectedly. Show a manager — they may need to check logs.`,
    };
  }
  if (executionError) {
    console.error(`[dbQueryTool] ${spec.name} execution error:`, executionError);
    return { ok: false, code: 'execution_error', error: `Query "${spec.name}" failed to execute.` };
  }

  return {
    ok: true,
    rows: rowsOut,
    rowCount: rowsOut.length,
    rowCap,
    truncated: totalRowCount > rowCap,
    query: { name: spec.name, description: spec.description, tier: spec.tier },
  };
}

function redactParams(spec: DbQuerySpec, bound: Record<string, unknown>): Record<string, unknown> {
  const omit = new Set(spec.auditOmitValues ?? []);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(bound)) {
    if (k === 'location_id') continue; // recorded separately on the audit row
    out[k] = omit.has(k) ? '[redacted]' : bound[k];
  }
  return out;
}

// ── Prompt-catalog rendering ─────────────────────────────────────────

/**
 * Render the catalog the LLM sees so it knows which `db_query` names are
 * available at the current tier and what params each one takes. Kept compact
 * (one line per query) so the context budget isn't blown when many queries
 * exist. The route appends this AFTER the grounded context but BEFORE the
 * cook message, so the LLM sees the same list every turn.
 */
export function renderQueryCatalog(tier: QueryTier): string {
  const queries = listQueriesForTier(tier);
  if (queries.length === 0) return '';
  const lines: string[] = [];
  lines.push('AVAILABLE DB QUERIES (emit `{ "action": "db_query", "query": "<name>", "params": { ... } }` when the cook asks something not in CONTEXT):');
  for (const q of queries) {
    const paramStr = q.params.length === 0
      ? '(no params)'
      : q.params.map((p) => `${p.name}:${p.type}${p.required ? '' : '?'}`).join(', ');
    lines.push(`- ${q.name} [${q.tier}] — ${q.description}  params: ${paramStr}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Render query results as a compact table string for inclusion in the
 * follow-up LLM turn (so it can summarize for the cook). Keeps the result
 * deterministic and printable, instead of relying on the LLM to read raw JSON.
 */
export function formatQueryResultForPrompt(result: DbQueryRunResult): string {
  if (result.rowCount === 0) {
    return `(query "${result.query.name}" returned no rows)`;
  }
  const cols = Object.keys(result.rows[0] ?? {});
  const header = cols.join(' | ');
  const sep = cols.map(() => '---').join(' | ');
  const body = result.rows
    .map((r) => cols.map((c) => formatCell((r as Record<string, unknown>)[c])).join(' | '))
    .join('\n');
  const trunc = result.truncated ? `\n(truncated to ${result.rowCap} rows)` : '';
  return `Query "${result.query.name}" — ${result.rowCount} row(s):\n${header}\n${sep}\n${body}${trunc}`;
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    // Pipe-safe + length-capped so a single fat cell doesn't blow the budget.
    return v.replace(/\|/g, '/').slice(0, 80);
  }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  try {
    return JSON.stringify(v).slice(0, 80);
  } catch {
    return '[unserializable]';
  }
}
