/**
 * Deterministic recipe calculator — the authoritative path for any
 * kitchen-assistant action whose output would otherwise be in-token arithmetic
 * by an LLM. Shells out to scripts/bom_expand_cli.py so the Python BOM walker
 * in scripts/lib/bom_expand.py stays the single source of truth.
 *
 * The kitchen-assistant route discards any numeric fields the model proposed
 * for `scale_recipe`, `beo_add_prep`, and `generate_prep` actions and calls
 * into here instead. The model frames the prose; the numbers come from here.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

export interface LeafRow {
  ingredient: string;
  qty: number;
  unit: string;
}

export interface ExpandResult {
  recipeSlug: string;
  targetQty: number;
  targetUnit: string;
  scaleFactor: number;
  leafRows: LeafRow[];
}

export class CalculatorError extends Error {
  code: string;
  constructor(message: string, code: string = 'calculator_error') {
    super(message);
    this.name = 'CalculatorError';
    this.code = code;
  }
}

const DEFAULT_TIMEOUT_MS = 5000;
const PROJECT_ROOT = process.env.LARIAT_ROOT || process.cwd();
const CLI_PATH = path.join(PROJECT_ROOT, 'scripts', 'bom_expand_cli.py');
const PYTHON_BIN = process.env.LARIAT_PYTHON || 'python3';

type ExpandRequest =
  | { recipeSlug: string; multiplier: number; unit?: string }
  | { recipeSlug: string; qty: number; unit?: string };

/** Expand a single recipe into leaf ingredient totals. */
export async function expandRecipe(req: ExpandRequest): Promise<ExpandResult> {
  const raw = await runCli(toCliPayload(req));
  return parseCliResponse(raw, req.recipeSlug);
}

/** Scale a recipe by a multiplier (model's `scale_recipe` action). */
export function scaleRecipe(slug: string, multiplier: number): Promise<ExpandResult> {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    return Promise.reject(new CalculatorError('multiplier must be a positive finite number', 'bad_multiplier'));
  }
  return expandRecipe({ recipeSlug: slug, multiplier });
}

/**
 * Expand each recipe in a BEO at guest-count scale and aggregate across.
 * `recipes` is a list of (slug, portionsPerGuest) pairs. Each recipe is
 * expanded independently at `portionsPerGuest * guestCount` of its yield unit.
 */
export async function expandForBEO(
  recipes: Array<{ slug: string; portionsPerGuest: number }>,
  guestCount: number,
): Promise<ExpandResult[]> {
  if (!Number.isFinite(guestCount) || guestCount <= 0) {
    throw new CalculatorError('guestCount must be a positive finite number', 'bad_guest_count');
  }
  return Promise.all(
    recipes.map((r) =>
      expandRecipe({
        recipeSlug: r.slug,
        multiplier: r.portionsPerGuest * guestCount,
      }),
    ),
  );
}

/** Format leaf rows as human-readable task strings for BEO/prep lists. */
export function formatLeafRowsAsTasks(rows: LeafRow[]): string[] {
  return rows.map((r) => `${formatQty(r.qty)} ${r.unit} ${r.ingredient}`.trim());
}

function formatQty(q: number): string {
  if (!Number.isFinite(q)) return String(q);
  const rounded = Math.round(q * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
}

// ── internals ────────────────────────────────────────────────────────────

function toCliPayload(req: ExpandRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = { recipe_slug: req.recipeSlug, root: PROJECT_ROOT };
  if ('multiplier' in req) payload.multiplier = req.multiplier;
  if ('qty' in req) payload.qty = req.qty;
  if (req.unit) payload.unit = req.unit;
  return payload;
}

function runCli(payload: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [CLI_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new CalculatorError(`calculator timed out after ${timeoutMs}ms`, 'timeout'));
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new CalculatorError(`failed to spawn python: ${e.message}`, 'spawn_failed'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        // CLI writes JSON {"error": "..."} to stdout on failure.
        let msg = stderr || stdout || `exit ${code}`;
        try {
          const parsed = JSON.parse(stdout);
          if (parsed && typeof parsed.error === 'string') msg = parsed.error;
        } catch {
          /* fall through */
        }
        reject(new CalculatorError(msg, `exit_${code ?? 'unknown'}`));
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

function parseCliResponse(raw: string, slug: string): ExpandResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new CalculatorError(`calculator returned invalid JSON for ${slug}: ${(e as Error).message}`, 'bad_json');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new CalculatorError(`calculator returned non-object for ${slug}`, 'bad_shape');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.error === 'string') {
    throw new CalculatorError(obj.error, 'cli_error');
  }
  const leaves = Array.isArray(obj.leaf_rows)
    ? (obj.leaf_rows as Array<Record<string, unknown>>).map((row) => ({
        ingredient: String(row.ingredient ?? ''),
        qty: Number(row.qty ?? 0),
        unit: String(row.unit ?? ''),
      }))
    : [];
  return {
    recipeSlug: String(obj.recipe_slug ?? slug),
    targetQty: Number(obj.target_qty ?? 0),
    targetUnit: String(obj.target_unit ?? ''),
    scaleFactor: Number(obj.scale_factor ?? 0),
    leafRows: leaves,
  };
}
