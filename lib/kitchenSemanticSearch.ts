import type { Database as DB } from 'better-sqlite3';
import { getRecipes, type Recipe } from './data.ts';
import * as datapackSearch from './datapackSearch.ts';
import type { HybridHit } from './datapackSearch.ts';

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 12;
const MAX_LOCAL_ROWS = 200;
const MAX_AUDIT_ROWS = 120;
const MAX_TEXT = 900;

const STOP_WORDS = new Set([
  'and', 'are', 'but', 'for', 'from', 'has', 'have', 'how', 'that',
  'the', 'this', 'was', 'were', 'what', 'when', 'where', 'which',
  'with', 'find', 'look', 'show', 'tell', 'about',
]);

const SAFE_AUDIT_ENTITIES = [
  'beo_line_items',
  'beo_prep_tasks',
  'cooling_batches',
  'eighty_six',
  'equipment_maintenance',
  'inventory_updates',
  'kds_ticket_state',
  'line_check_entries',
  'prep_tasks',
  'receiving_checks',
  'station_signoffs',
  'temp_log',
];

export type SemanticKitchenHitType =
  | 'recipe'
  | 'beo_line_item'
  | 'beo_prep_task'
  | 'audit_event'
  | 'reference_recipe';

export interface SemanticKitchenHit {
  type: SemanticKitchenHitType;
  score: number;
  title: string;
  detail: string;
  excerpt: string;
  id: string;
  source?: string;
}

export interface SemanticKitchenSearchResult {
  ok: true;
  query: string;
  hits: SemanticKitchenHit[];
}

export interface SemanticKitchenSearchDeps {
  getRecipes?: () => Recipe[];
  dataPackAvailable?: () => boolean;
  referenceHybrid?: typeof datapackSearch.hybrid;
}

export interface SemanticKitchenSearchArgs {
  db: DB;
  locationId: string;
  query: string;
  limit?: number;
  deps?: SemanticKitchenSearchDeps;
}

interface CorpusRow {
  type: SemanticKitchenHitType;
  title: string;
  detail: string;
  text: string;
  id: string;
  source?: string;
}

interface BeoLineRow {
  id: number;
  item_name: string;
  category: string | null;
  quantity: number | null;
  prep_notes: string | null;
  secondary_prep_notes: string | null;
  order_items_notes: string | null;
  group_note: string | null;
  event_id: number;
  title: string;
  event_date: string | null;
  contact_name: string | null;
  notes: string | null;
}

interface BeoPrepRow {
  id: number;
  task: string;
  due_date: string | null;
  done: number;
  event_id: number;
  title: string;
  event_date: string | null;
  contact_name: string | null;
  notes: string | null;
}

interface AuditRow {
  id: number;
  shift_date: string;
  entity: string;
  entity_id: number | null;
  action: string;
  payload_json: string | null;
  note: string | null;
}

export async function runSemanticKitchenSearch(
  args: SemanticKitchenSearchArgs
): Promise<SemanticKitchenSearchResult> {
  const query = clip(args.query, 240);
  if (!query) return { ok: true, query: '', hits: [] };

  const limit = normalizeLimit(args.limit);
  const deps = args.deps ?? {};
  const getRecipeRows = deps.getRecipes ?? getRecipes;

  const corpus = [
    ...recipeCorpus(getRecipeRows()),
    ...beoLineCorpus(args.db, args.locationId),
    ...beoPrepCorpus(args.db, args.locationId),
    ...auditCorpus(args.db, args.locationId),
  ];
  const localHits = rankCorpus(query, corpus, limit);
  const referenceHits = await referenceRecipeHits(query, limit, deps);

  const byId = new Map<string, SemanticKitchenHit>();
  for (const hit of [...localHits, ...referenceHits]) {
    if (!byId.has(hit.id)) byId.set(hit.id, hit);
  }
  const hits = [...byId.values()]
    .sort((a, b) => b.score - a.score || a.type.localeCompare(b.type) || a.title.localeCompare(b.title))
    .slice(0, limit);

  return { ok: true, query, hits };
}

export function formatSemanticKitchenSearchForPrompt(
  result: SemanticKitchenSearchResult
): string {
  const query = result.query || 'blank query';
  if (!result.hits.length) {
    return `No semantic search matches for "${query}".`;
  }
  const lines = [`Semantic search for "${query}" - ${result.hits.length} hit(s):`];
  result.hits.forEach((hit, idx) => {
    const source = hit.source ? ` (${hit.source})` : '';
    const excerpt = hit.excerpt ? ` - ${hit.excerpt}` : '';
    lines.push(`${idx + 1}. [${labelForType(hit.type)}${source}] ${hit.title} - ${hit.detail}${excerpt}`);
  });
  return lines.join('\n');
}

function recipeCorpus(recipes: Recipe[]): CorpusRow[] {
  return recipes.map((recipe) => {
    const ingredients = (recipe.ingredients || [])
      .map((ingredient) => [ingredient.item, ingredient.qty, ingredient.unit].filter(Boolean).join(' '))
      .filter(Boolean);
    const detailBits = [
      recipe.slug ? `slug ${recipe.slug}` : null,
      recipe.station ? `station ${recipe.station}` : null,
      recipe.menu_items?.length ? `menu ${recipe.menu_items.join(', ')}` : null,
    ].filter(Boolean);
    const text = [
      recipe.name,
      recipe.slug,
      recipe.station,
      recipe.yield_qty,
      recipe.yield_unit,
      recipe.menu_items?.join(' '),
      ingredients.join(' '),
      recipe.procedure,
      recipe.allergens?.join(' '),
    ].filter(Boolean).join('\n');
    return {
      type: 'recipe' as const,
      title: recipe.name || recipe.slug || 'Unnamed recipe',
      detail: detailBits.join(' | ') || 'local recipe',
      text,
      id: `recipe:${recipe.slug || recipe.name}`,
      source: 'local recipe book',
    };
  });
}

function beoLineCorpus(db: DB, locationId: string): CorpusRow[] {
  const rows = db
    .prepare(
      `SELECT li.id, li.item_name, li.category, li.quantity,
              li.prep_notes, li.secondary_prep_notes, li.order_items_notes, li.group_note,
              e.id AS event_id, e.title, e.event_date, e.contact_name, e.notes
       FROM beo_line_items li
       JOIN beo_events e ON e.id = li.event_id
       WHERE e.location_id = ?
       ORDER BY date(e.event_date) DESC, e.id DESC, li.sort_order ASC, li.id ASC
       LIMIT ?`
    )
    .all(locationId, MAX_LOCAL_ROWS) as BeoLineRow[];
  return rows.map((row) => {
    const detail = [
      row.event_date || null,
      row.title ? `BEO ${row.event_id}: ${row.title}` : `BEO ${row.event_id}`,
      row.category,
      row.quantity != null ? `${row.quantity} qty` : null,
    ].filter(Boolean).join(' | ');
    const text = [
      row.item_name,
      row.category,
      row.quantity,
      row.prep_notes,
      row.secondary_prep_notes,
      row.order_items_notes,
      row.group_note,
      row.title,
      row.event_date,
      row.contact_name,
      row.notes,
    ].filter(Boolean).join('\n');
    return {
      type: 'beo_line_item' as const,
      title: row.item_name,
      detail,
      text,
      id: `beo_line_item:${row.id}`,
      source: 'BEO line item',
    };
  });
}

function beoPrepCorpus(db: DB, locationId: string): CorpusRow[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.task, t.due_date, t.done,
              e.id AS event_id, e.title, e.event_date, e.contact_name, e.notes
       FROM beo_prep_tasks t
       JOIN beo_events e ON e.id = t.event_id
       WHERE t.location_id = ? AND e.location_id = ?
       ORDER BY date(e.event_date) DESC, e.id DESC, t.sort_order ASC, t.id ASC
       LIMIT ?`
    )
    .all(locationId, locationId, MAX_LOCAL_ROWS) as BeoPrepRow[];
  return rows.map((row) => {
    const detail = [
      row.event_date || null,
      `BEO ${row.event_id}: ${row.title}`,
      row.due_date ? `due ${row.due_date}` : null,
      row.done ? 'done' : 'pending',
    ].filter(Boolean).join(' | ');
    const text = [
      row.task,
      row.due_date,
      row.title,
      row.event_date,
      row.contact_name,
      row.notes,
      row.done ? 'done complete finished' : 'pending incomplete prep',
    ].filter(Boolean).join('\n');
    return {
      type: 'beo_prep_task' as const,
      title: row.task,
      detail,
      text,
      id: `beo_prep_task:${row.id}`,
      source: 'BEO prep',
    };
  });
}

function auditCorpus(db: DB, locationId: string): CorpusRow[] {
  const placeholders = SAFE_AUDIT_ENTITIES.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT id, shift_date, entity, entity_id, action, payload_json, note
       FROM audit_events
       WHERE location_id = ?
         AND entity IN (${placeholders})
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(locationId, ...SAFE_AUDIT_ENTITIES, MAX_AUDIT_ROWS) as AuditRow[];
  return rows.map((row) => {
    const payload = payloadText(row.payload_json);
    const entity = labelEntity(row.entity);
    const detail = [
      row.shift_date,
      entity,
      row.action,
      row.entity_id != null ? `row ${row.entity_id}` : null,
    ].filter(Boolean).join(' | ');
    return {
      type: 'audit_event' as const,
      title: `${entity} ${row.action}`,
      detail,
      text: [entity, row.action, payload, row.note].filter(Boolean).join('\n'),
      id: `audit_event:${row.id}`,
      source: 'kitchen audit',
    };
  });
}

function rankCorpus(query: string, rows: CorpusRow[], limit: number): SemanticKitchenHit[] {
  const queryTokens = tokenize(query);
  const normalizedQuery = normalize(query);
  if (!queryTokens.length && !normalizedQuery) return [];
  const excerptTokens = queryTokens.length ? queryTokens : [normalizedQuery];
  const out: SemanticKitchenHit[] = [];
  for (const row of rows) {
    const score = scoreRow(query, queryTokens, row);
    if (score <= 0) continue;
    out.push({
      type: row.type,
      score,
      title: row.title,
      detail: row.detail,
      excerpt: excerpt(row.text, excerptTokens),
      id: row.id,
      source: row.source,
    });
  }
  return out
    .sort((a, b) => b.score - a.score || a.type.localeCompare(b.type) || a.title.localeCompare(b.title))
    .slice(0, limit);
}

async function referenceRecipeHits(
  query: string,
  limit: number,
  deps: SemanticKitchenSearchDeps
): Promise<SemanticKitchenHit[]> {
  const available = deps.dataPackAvailable ?? datapackSearch.available;
  if (!available()) return [];
  const hybrid = deps.referenceHybrid ?? datapackSearch.hybrid;
  try {
    const hits = await hybrid(query, { bucket: 'recipes', limit });
    return hits.map((hit, idx) => referenceHitFromHybrid(hit, idx));
  } catch {
    return [];
  }
}

function referenceHitFromHybrid(hit: HybridHit, idx: number): SemanticKitchenHit {
  const title = stringField(hit, 'title') || stringField(hit, 'slug') || 'Reference recipe';
  const slug = stringField(hit, 'slug');
  const summary = stringField(hit, 'summary_excerpt') || stringField(hit, 'extra') || '';
  const source = stringField(hit, 'source') || 'data pack';
  const rawScore = typeof hit.score === 'number' ? hit.score : 0;
  return {
    type: 'reference_recipe',
    score: 1 + rawScore,
    title,
    detail: slug ? `slug ${slug}` : 'reference recipe',
    excerpt: clip(summary, MAX_TEXT) || '',
    id: `reference_recipe:${slug || title}:${idx}`,
    source,
  };
}

function scoreRow(query: string, queryTokens: string[], row: CorpusRow): number {
  const normalizedText = normalize(`${row.title}\n${row.detail}\n${row.text}`);
  const normalizedTitle = normalize(row.title);
  const rowTokens = new Set(tokenize(normalizedText));
  let score = 0;
  const normalizedQuery = normalize(query);
  if (normalizedQuery && normalizedText.includes(normalizedQuery)) score += 8;
  for (const token of queryTokens) {
    if (rowTokens.has(token)) {
      score += normalizedTitle.includes(token) ? 3 : 2;
      continue;
    }
    if (token.length >= 5 && normalizedText.includes(token)) score += 0.75;
  }
  if (row.type === 'recipe' && queryTokens.includes('recipe')) score += 1;
  if ((row.type === 'beo_line_item' || row.type === 'beo_prep_task') && queryTokens.includes('wedding')) {
    score += 0.5;
  }
  return score;
}

function excerpt(text: string, queryTokens: string[]): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const { normalized, indexMap } = normalizeWithIndexMap(compact);
  let bestIdx = -1;
  for (const token of queryTokens) {
    const idx = normalized.indexOf(token);
    if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) bestIdx = idx;
  }
  const compactIdx = bestIdx >= 0 ? indexMap[bestIdx] ?? 0 : 0;
  const start = compactIdx > 60 ? compactIdx - 60 : 0;
  return clip(compact.slice(start), 220) || '';
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeWithIndexMap(text: string): { normalized: string; indexMap: number[] } {
  const chars: string[] = [];
  const indexMap: number[] = [];
  let pendingSpace = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i).toLowerCase();
    if (/[a-z0-9]/.test(ch)) {
      if (pendingSpace >= 0 && chars.length) {
        chars.push(' ');
        indexMap.push(pendingSpace);
      }
      pendingSpace = -1;
      chars.push(ch);
      indexMap.push(i);
      continue;
    }
    if (chars.length && pendingSpace < 0) pendingSpace = i;
  }

  return { normalized: chars.join(''), indexMap };
}

function payloadText(raw: string | null): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as unknown;
    return collectPrimitives(parsed).join(' ');
  } catch {
    return clip(raw, MAX_TEXT) || '';
  }
}

function collectPrimitives(value: unknown, out: string[] = []): string[] {
  if (out.join(' ').length > MAX_TEXT) return out;
  if (value == null) return out;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out.push(String(value));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPrimitives(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out.push(key.replace(/_/g, ' '));
      collectPrimitives(nested, out);
    }
  }
  return out;
}

function labelForType(type: SemanticKitchenHitType): string {
  switch (type) {
    case 'recipe': return 'Recipe';
    case 'beo_line_item': return 'BEO line';
    case 'beo_prep_task': return 'BEO prep';
    case 'audit_event': return 'Audit';
    case 'reference_recipe': return 'Reference recipe';
  }
}

function labelEntity(entity: string): string {
  return entity.replace(/_/g, ' ');
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

function normalizeLimit(raw: number | undefined): number {
  if (!Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(raw as number)));
}

function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}
