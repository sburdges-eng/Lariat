import { ALLOWED_TABLES, type OutboxBatch } from './cloudBridgeQueue.ts';

type JsonRow = Record<string, unknown>;

export interface CloudBridgeReplayState {
  seenBatchKeys: Set<string>;
  batches: Map<string, { location_id: string; batch_id: number; table: string; n_rows: number }>;
  tables: Map<string, Map<string, JsonRow[]>>;
}

export interface ReplaySummary {
  accepted: number;
  deduped: number;
  rejected: number;
}

export interface CanonicalReplayState {
  batches: { location_id: string; batch_id: number; table: string; n_rows: number }[];
  tables: Record<string, Record<string, JsonRow[]>>;
}

export function createCloudBridgeReplayState(): CloudBridgeReplayState {
  return {
    seenBatchKeys: new Set(),
    batches: new Map(),
    tables: new Map(),
  };
}

export function replayCloudBridgeBatches(
  batches: OutboxBatch[],
  state: CloudBridgeReplayState = createCloudBridgeReplayState(),
): ReplaySummary {
  const summary = { accepted: 0, deduped: 0, rejected: 0 };
  for (const batch of batches) {
    if (!isReplayableBatch(batch)) {
      summary.rejected += 1;
      continue;
    }
    const key = batchKey(batch.locationId, batch.id);
    if (state.seenBatchKeys.has(key)) {
      summary.deduped += 1;
      continue;
    }
    state.seenBatchKeys.add(key);
    state.batches.set(key, {
      location_id: batch.locationId,
      batch_id: batch.id,
      table: batch.table,
      n_rows: batch.rows.length,
    });
    const tableMap = getOrCreate(state.tables, batch.table, () => new Map<string, JsonRow[]>());
    const rows = getOrCreate(tableMap, batch.locationId, () => []);
    for (const row of batch.rows) rows.push(deepCloneObject(row));
    summary.accepted += 1;
  }
  return summary;
}

export function canonicalCloudBridgeReplayState(
  state: CloudBridgeReplayState,
): CanonicalReplayState {
  const batches = [...state.batches.values()].sort(compareBatch);
  const tables: Record<string, Record<string, JsonRow[]>> = {};
  for (const table of [...state.tables.keys()].sort()) {
    const byLocation = state.tables.get(table)!;
    tables[table] = {};
    for (const locationId of [...byLocation.keys()].sort()) {
      tables[table][locationId] = byLocation
        .get(locationId)!
        .map(deepCloneObject)
        .sort(compareJsonRows);
    }
  }
  return { batches, tables };
}

function isReplayableBatch(batch: OutboxBatch): batch is OutboxBatch & { rows: JsonRow[] } {
  return ALLOWED_TABLES.has(batch.table)
    && Number.isInteger(batch.id)
    && batch.id > 0
    && typeof batch.locationId === 'string'
    && batch.locationId.trim().length > 0
    && Array.isArray(batch.rows)
    && batch.rows.length > 0
    && batch.rows.every(isJsonObject);
}

function batchKey(locationId: string, batchId: number): string {
  return `${locationId}\u0000${batchId}`;
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const value = create();
  map.set(key, value);
  return value;
}

function isJsonObject(value: unknown): value is JsonRow {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepCloneObject(row: JsonRow): JsonRow {
  return JSON.parse(JSON.stringify(row)) as JsonRow;
}

function compareBatch(
  a: { location_id: string; batch_id: number; table: string; n_rows: number },
  b: { location_id: string; batch_id: number; table: string; n_rows: number },
): number {
  return a.location_id.localeCompare(b.location_id)
    || a.batch_id - b.batch_id
    || a.table.localeCompare(b.table);
}

function compareJsonRows(a: JsonRow, b: JsonRow): number {
  return JSON.stringify(sortJson(a)).localeCompare(JSON.stringify(sortJson(b)));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortJson(v)]),
    );
  }
  return value;
}
