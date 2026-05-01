// Pure CSV builder and helpers for the specials export pipeline.
// No I/O, no DB. The route layer is responsible for read/write side-effects.

export interface IngredientRow {
  ingredient: string;
  qty: number | string;
  unit: string;
  vendor_match: string;
  note: string;
}

export interface RecipeRow {
  slug: string;
  display_name: string;
  yield_qty: number;
  yield_unit: string;
  category: string;
  procedure: string;
}

const UNMATCHED_NOTE = 'unmatched — pick a vendor item before paste';

const RECIPE_HEADER = 'slug,display_name,yield_qty,yield_unit,category,procedure';
const INGREDIENT_HEADER = 'ingredient,qty,unit,vendor_match,note';

export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function joinRow(fields: unknown[]): string {
  return fields.map(escapeCsvField).join(',');
}

export function mapCostBreakdownToIngredientRows(breakdown: unknown): IngredientRow[] {
  if (!Array.isArray(breakdown)) return [];
  return breakdown.map((row: any) => {
    const matched = typeof row?.match === 'string' && row.match.length > 0 && row?.cost !== null && row?.cost !== undefined;
    return {
      ingredient: typeof row?.item === 'string' ? row.item : '',
      qty: row?.req_qty ?? '',
      unit: typeof row?.req_unit === 'string' ? row.req_unit : '',
      vendor_match: matched ? row.match : '',
      note: matched ? '' : UNMATCHED_NOTE,
    };
  });
}

export function selectSkippedRows(rows: IngredientRow[]): IngredientRow[] {
  return rows.filter((r) => r.note === UNMATCHED_NOTE);
}

// Strip a trailing GitHub-style markdown blockquote (> [!NOTE] / > [!WARNING])
// emitted by the cost_special action handler. Anything before that block is
// kept verbatim — chefs may want it as procedure prose.
export function stripCostMarkdown(answer: string): string {
  if (typeof answer !== 'string') return '';
  const idx = answer.search(/\n\n> \[!(NOTE|WARNING)\]/);
  if (idx < 0) return answer;
  return answer.slice(0, idx).trimEnd();
}

export function buildExportCsv(input: { recipe_row: RecipeRow; ingredient_rows: IngredientRow[] }): string {
  const r = input.recipe_row;
  const recipeBody = joinRow([r.slug, r.display_name, r.yield_qty, r.yield_unit, r.category, r.procedure]);
  const ingredientBody = input.ingredient_rows
    .map((row) => joinRow([row.ingredient, row.qty, row.unit, row.vendor_match, row.note]))
    .join('\n');
  const tail = ingredientBody.length > 0 ? `${ingredientBody}\n` : '';
  return `# RECIPE\n${RECIPE_HEADER}\n${recipeBody}\n\n# INGREDIENTS\n${INGREDIENT_HEADER}\n${tail}`;
}
