import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const DEV_CODE_SEARCH_SCHEMA_VERSION = 'lariat.devCodeSearch.v1';

const MAX_QUERY_CHARS = 120;
const MAX_GLOB_CHARS = 160;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const RG_TIMEOUT_MS = 5000;
const RG_MAX_BUFFER = 256 * 1024;

const EXCLUDED_GLOBS = [
  '!node_modules/**',
  '!.next/**',
  '!dist/**',
  '!build/**',
  '!coverage/**',
  '!data/**/*.db',
  '!data/**/*.sqlite',
];

type EnvLike = Record<string, string | undefined>;

type SpawnSyncResultLike = {
  status: number | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  error?: Error;
};

type SpawnSyncLike = (
  _command: string,
  _args: string[],
  _opts: {
    cwd: string;
    encoding: 'utf8';
    maxBuffer: number;
    timeout: number;
  },
) => SpawnSyncResultLike;

export type DevCodeSearchErrorCode =
  | 'disabled'
  | 'tier_blocked'
  | 'invalid_query'
  | 'invalid_glob'
  | 'rg_unavailable'
  | 'execution_error';

export type DevCodeSearchHit = {
  path: string;
  lineNumber: number;
  text: string;
};

export type DevCodeSearchResult = {
  schemaVersion: typeof DEV_CODE_SEARCH_SCHEMA_VERSION;
  ok: true;
  query: string;
  glob: string | null;
  hitCount: number;
  truncated: boolean;
  hits: DevCodeSearchHit[];
};

export type DevCodeSearchError = {
  schemaVersion: typeof DEV_CODE_SEARCH_SCHEMA_VERSION;
  ok: false;
  code: DevCodeSearchErrorCode;
  error: string;
};

export type DevCodeSearchOutcome = DevCodeSearchResult | DevCodeSearchError;

export type DevCodeSearchRequest = {
  query: unknown;
  glob?: unknown;
  limit?: unknown;
  hasPin: boolean;
  repoRoot?: string;
  env?: EnvLike;
  spawnSyncImpl?: SpawnSyncLike;
};

export function isDevCodeSearchEnabled(env: EnvLike = process.env): boolean {
  const value = env.LARIAT_DEV_CODE_SEARCH?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function renderDevCodeSearchCatalog({
  hasPin,
  env = process.env,
}: {
  hasPin: boolean;
  env?: EnvLike;
}): string {
  if (!hasPin || !isDevCodeSearchEnabled(env)) return '';
  return [
    '',
    'CODE SEARCH ACTION:',
    '- Dev-mode manager-only local code search is available. You may emit:',
    '  { "action": "code_search", "query": "literal text to search", "glob": "optional relative glob", "limit": 8 }',
    '- Use only for local development questions about this Lariat codebase.',
    '- The server runs ripgrep locally, returns relative paths only, and never calls a cloud API.',
    '',
  ].join('\n');
}

export function runDevCodeSearch(req: DevCodeSearchRequest): DevCodeSearchOutcome {
  const env = req.env ?? process.env;
  if (!isDevCodeSearchEnabled(env)) {
    return errorOutcome('disabled', 'Dev code search is disabled. Set LARIAT_DEV_CODE_SEARCH=1 in a local development shell to enable it.');
  }
  if (!req.hasPin) {
    return errorOutcome('tier_blocked', 'Dev code search is manager-only; manager PIN required. Ask a manager to tap their PIN, then try again.');
  }

  const query = normalizeQuery(req.query);
  if (!query) {
    return errorOutcome('invalid_query', 'Code search requires a non-empty literal query string.');
  }

  const globResult = normalizeGlob(req.glob);
  if (!globResult.ok) return errorOutcome('invalid_glob', globResult.error);

  const limit = coerceLimit(req.limit);
  const repoRoot = path.resolve(req.repoRoot ?? process.cwd());
  const args = buildRgArgs(query, globResult.glob);
  const run = req.spawnSyncImpl ?? (spawnSync as SpawnSyncLike);
  const result = run('rg', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: RG_MAX_BUFFER,
    timeout: RG_TIMEOUT_MS,
  });

  if (result.error) {
    return errorOutcome('rg_unavailable', 'ripgrep is unavailable for local dev code search.');
  }
  if (result.status !== 0 && result.status !== 1) {
    return errorOutcome('execution_error', 'Code search failed unexpectedly. Check local ripgrep availability and repository state.');
  }

  const allHits = parseRipgrepOutput(stringOutput(result.stdout));
  const hits = allHits.slice(0, limit);
  return {
    schemaVersion: DEV_CODE_SEARCH_SCHEMA_VERSION,
    ok: true,
    query,
    glob: globResult.glob,
    hitCount: hits.length,
    truncated: allHits.length > hits.length,
    hits,
  };
}

function errorOutcome(code: DevCodeSearchErrorCode, error: string): DevCodeSearchError {
  return {
    schemaVersion: DEV_CODE_SEARCH_SCHEMA_VERSION,
    ok: false,
    code,
    error,
  };
}

function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const query = raw.trim();
  if (!query) return null;
  return query.slice(0, MAX_QUERY_CHARS);
}

function normalizeGlob(raw: unknown): { ok: true; glob: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, glob: null };
  if (typeof raw !== 'string') return { ok: false, error: 'Code search glob must be a string.' };
  const glob = raw.trim();
  if (!glob) return { ok: true, glob: null };
  if (glob.length > MAX_GLOB_CHARS) return { ok: false, error: `Code search glob is too long (max ${MAX_GLOB_CHARS} chars).` };
  if (glob.includes('\0')) return { ok: false, error: 'Code search glob contains an invalid character.' };
  if (path.isAbsolute(glob) || glob.startsWith('~')) {
    return { ok: false, error: 'Code search glob must be relative to the repository root.' };
  }
  if (glob.split(/[\\/]+/).includes('..')) {
    return { ok: false, error: 'Code search glob must stay inside the repository root.' };
  }
  return { ok: true, glob };
}

function coerceLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT);
}

function buildRgArgs(query: string, glob: string | null): string[] {
  const args = [
    '--line-number',
    '--no-heading',
    '--color=never',
    '--fixed-strings',
    '--max-columns',
    '240',
    '--max-columns-preview',
    '--max-count',
    '5',
  ];
  for (const excluded of EXCLUDED_GLOBS) {
    args.push('--glob', excluded);
  }
  if (glob) args.push('--glob', glob);
  args.push('--', query, '.');
  return args;
}

function stringOutput(value: string | Buffer | undefined): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return '';
}

function parseRipgrepOutput(stdout: string): DevCodeSearchHit[] {
  const hits: DevCodeSearchHit[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    const match = /^(.*?):(\d+):(.*)$/.exec(line);
    if (!match) continue;
    const [, rawPath = '', rawLineNumber = '', rawText = ''] = match;
    const relPath = normalizeResultPath(rawPath);
    if (!relPath) continue;
    const lineNumber = Number(rawLineNumber);
    if (!Number.isInteger(lineNumber) || lineNumber < 1) continue;
    hits.push({
      path: relPath,
      lineNumber,
      text: rawText.trim().slice(0, 220),
    });
  }
  return hits;
}

function normalizeResultPath(raw: string): string | null {
  const rel = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!rel || rel.includes('\0')) return null;
  if (path.isAbsolute(rel)) return null;
  if (rel.split('/').includes('..')) return null;
  return rel;
}

export function formatDevCodeSearchForPrompt(outcome: DevCodeSearchOutcome): string {
  if (!outcome.ok) return outcome.error;
  if (outcome.hits.length === 0) {
    return `Code search "${outcome.query}" returned no matches.`;
  }
  const suffix = outcome.truncated ? ` (showing first ${outcome.hits.length})` : '';
  const rows = outcome.hits
    .map((hit) => `${hit.path} | ${hit.lineNumber} | ${formatHitText(hit.text)}`)
    .join('\n');
  return `Code search "${outcome.query}" - ${outcome.hitCount} hit(s)${suffix}:\npath | line | excerpt\n--- | --- | ---\n${rows}`;
}

function formatHitText(text: string): string {
  return text.replace(/\|/g, '/').slice(0, 160);
}
