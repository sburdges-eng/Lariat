/**
 * BEO cascade wrapper — the authoritative path for converting BEO line items
 * into an order guide + prep demands. Shells out to scripts/beo_cascade_cli.py,
 * mirroring exactly how lib/recipeCalculator.ts shells to scripts/bom_expand_cli.py.
 *
 * The API route (Task 8) calls cascadeFromLineItems() to obtain typed, DB-sourced
 * numbers without any in-token LLM arithmetic.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

// ── Public types ──────────────────────────────────────────────────────────────

export interface OrderGuideRow {
  ingredient: string;
  unit: string;
  total_needed: number;
  on_hand: number;
  to_order: number;
}

export interface PrepDemandRow {
  recipe_slug: string;
  display_name: string;
  qty: number;
  unit: string;
}

export interface UnmappedRow {
  menu_item: string;
  reason: string;
}

export interface ManifestWarningRow {
  recipe: string;
  issue: string;
}

export interface CascadeResult {
  orderGuide: OrderGuideRow[];
  prepDemands: PrepDemandRow[];
  unmapped: UnmappedRow[];
  manifestWarnings: ManifestWarningRow[];
  /**
   * Graceful-degradation notices: a single bad recipe (incompatible unit /
   * unknown sub-recipe / cycle) is degraded to a warning instead of aborting
   * the whole cascade — the engine drops it from the order guide + prep board
   * and records why here. Dropping this channel silently under-orders, so it
   * must be surfaced (mirrors the CLI's `warnings` list; may be empty).
   */
  warnings: string[];
}

export interface CascadeOptions {
  qtyInYieldUnits?: boolean;
  inventory?: Array<{ ingredient: string; unit: string; on_hand: number }>;
  /** Overrides resolveProjectRoot() for the CLI payload. */
  root?: string;
  timeoutMs?: number;
}

// ── Error class (mirrors CalculatorError) ────────────────────────────────────

export class CascadeError extends Error {
  code: string;
  constructor(message: string, code: string = 'cascade_error') {
    super(message);
    this.name = 'CascadeError';
    this.code = code;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

const PYTHON_BIN = process.env.LARIAT_PYTHON || 'python3';

// 15 s is generous but justified: a single-event cascade may walk hundreds of
// recipe nodes across sub-recipes — the BOM expand per-item is fast, but
// N items × manifest build + expand each can approach 5–10 s on a cold Python
// interpreter with a large recipes/ directory. 15 s gives comfortable headroom.
const DEFAULT_TIMEOUT_MS = 15000;

// Resolve at call time, not module load (same reasoning as recipeCalculator.ts —
// in Electron, process.cwd() at module-load time may be the .app Resources dir).
function resolveProjectRoot(): string {
  return process.env.LARIAT_ROOT || process.cwd();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert BEO line items into an order guide + prep demands by shelling to
 * scripts/beo_cascade_cli.py.
 *
 * Empty `lineItems` short-circuits to all-empty arrays without spawning the
 * CLI (cheaper; the CLI would return empty arrays anyway).
 */
export async function cascadeFromLineItems(
  lineItems: Array<{ item_name: string; quantity: number }>,
  opts?: CascadeOptions,
): Promise<CascadeResult> {
  // Short-circuit: no work to do, no reason to pay spawn cost.
  if (lineItems.length === 0) {
    return { orderGuide: [], prepDemands: [], unmapped: [], manifestWarnings: [], warnings: [] };
  }

  const root = opts?.root ?? resolveProjectRoot();
  const payload: Record<string, unknown> = {
    line_items: lineItems,
    root,
    qty_in_yield_units: opts?.qtyInYieldUnits ?? false,
  };
  if (opts?.inventory !== undefined) {
    payload.inventory = opts.inventory;
  }

  const raw = await runCli(payload, opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return parseCascadeResponse(raw);
}

// ── Internals ─────────────────────────────────────────────────────────────────

function runCli(payload: Record<string, unknown>, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const cliPath = path.join(resolveProjectRoot(), 'scripts', 'beo_cascade_cli.py');
    const child = spawn(PYTHON_BIN, [cliPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new CascadeError(`cascade timed out after ${timeoutMs}ms`, 'timeout'));
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (e: Error) => {
      clearTimeout(timer);
      reject(new CascadeError(`failed to spawn python: ${e.message}`, 'spawn_failed'));
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        // CLI writes {"error": "..."} to stdout on failure.
        let msg = stderr || stdout || `exit ${code}`;
        try {
          const parsed = JSON.parse(stdout);
          if (parsed && typeof parsed.error === 'string') msg = parsed.error;
        } catch {
          /* fall through */
        }
        reject(new CascadeError(msg, `exit_${code ?? 'unknown'}`));
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

function parseCascadeResponse(raw: string): CascadeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new CascadeError(
      `cascade returned invalid JSON: ${(e as Error).message}`,
      'bad_json',
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new CascadeError('cascade returned non-object', 'bad_shape');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.error === 'string') {
    throw new CascadeError(obj.error, 'cli_error');
  }
  if (!Array.isArray(obj.order_guide) || !Array.isArray(obj.prep_demands) || !Array.isArray(obj.unmapped)) {
    throw new CascadeError('cascade response missing expected arrays', 'bad_shape');
  }

  const orderGuide: OrderGuideRow[] = (obj.order_guide as Array<Record<string, unknown>>).map((row) => ({
    ingredient: String(row.ingredient ?? ''),
    unit: String(row.unit ?? ''),
    total_needed: Number(row.total_needed ?? 0),
    on_hand: Number(row.on_hand ?? 0),
    to_order: Number(row.to_order ?? 0),
  }));

  const prepDemands: PrepDemandRow[] = (obj.prep_demands as Array<Record<string, unknown>>).map((row) => ({
    recipe_slug: String(row.recipe_slug ?? ''),
    display_name: String(row.display_name ?? ''),
    qty: Number(row.qty ?? 0),
    unit: String(row.unit ?? ''),
  }));

  const unmapped: UnmappedRow[] = (obj.unmapped as Array<Record<string, unknown>>).map((row) => ({
    menu_item: String(row.menu_item ?? ''),
    reason: String(row.reason ?? ''),
  }));

  // Additive + optional: older CLIs omit manifest_warnings — default to [].
  const manifestWarnings: ManifestWarningRow[] = Array.isArray(obj.manifest_warnings)
    ? (obj.manifest_warnings as Array<Record<string, unknown>>).map((row) => ({
        recipe: String(row.recipe ?? ''),
        issue: String(row.issue ?? ''),
      }))
    : [];

  // Graceful-degradation notices — a flat string[] from the CLI. Additive +
  // optional: older CLIs omit `warnings` — default to []. Coerce each to a
  // string defensively (the engine emits plain messages).
  const warnings: string[] = Array.isArray(obj.warnings)
    ? (obj.warnings as unknown[]).map((w) => String(w))
    : [];

  return { orderGuide, prepDemands, unmapped, manifestWarnings, warnings };
}
