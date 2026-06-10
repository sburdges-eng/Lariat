import { postAuditEvent } from './auditEvents';
import { getDb } from './db';

export const KITCHEN_ASSISTANT_UNDO_WINDOW_MS = 30_000;

type UndoableEntity =
  | 'eighty_six'
  | 'inventory_updates'
  | 'line_check_entries'
  | 'equipment_maintenance'
  | 'order_guide_items'
  | 'gold_stars';

interface UndoableConfig {
  entity: UndoableEntity;
  mode: 'resolve_eighty_six' | 'delete_row';
  table: string;
}

const UNDOABLE_CONFIG: Record<UndoableEntity, UndoableConfig> = {
  eighty_six: { entity: 'eighty_six', mode: 'resolve_eighty_six', table: 'eighty_six' },
  inventory_updates: { entity: 'inventory_updates', mode: 'delete_row', table: 'inventory_updates' },
  line_check_entries: { entity: 'line_check_entries', mode: 'delete_row', table: 'line_check_entries' },
  equipment_maintenance: { entity: 'equipment_maintenance', mode: 'delete_row', table: 'equipment_maintenance' },
  order_guide_items: { entity: 'order_guide_items', mode: 'delete_row', table: 'order_guide_items' },
  gold_stars: { entity: 'gold_stars', mode: 'delete_row', table: 'gold_stars' },
};

export interface KitchenAssistantUndoMeta {
  audit_event_id: number;
  entity: UndoableEntity;
  entity_id: number;
  expires_at: string;
  label: string;
}

interface BuildUndoMetaInput {
  auditEventId: number | null | undefined;
  entity: string | null | undefined;
  entityId: number | null | undefined;
  label: string | null | undefined;
  createdAt?: string | Date;
}

interface AuditEventRowLite {
  id: number;
  shift_date: string;
  location_id: string;
  actor_cook_id: string | null;
  actor_source: string;
  entity: string;
  entity_id: number | null;
  action: 'insert' | 'update' | 'delete' | 'correction' | 'view';
  replaces_id: number | null;
  payload_json: string | null;
  note: string | null;
  created_at: string;
}

interface UndoResult {
  ok: boolean;
  status: number;
  error?: string;
  message?: string;
  correctedAuditId?: number;
}

export function isKitchenAssistantUndoableEntity(entity: string | null | undefined): entity is UndoableEntity {
  return !!entity && Object.prototype.hasOwnProperty.call(UNDOABLE_CONFIG, entity);
}

export function buildKitchenAssistantUndoMeta(input: BuildUndoMetaInput): KitchenAssistantUndoMeta | null {
  if (!Number.isInteger(input.auditEventId) || !isKitchenAssistantUndoableEntity(input.entity)) {
    return null;
  }
  if (!Number.isInteger(input.entityId) || input.entityId == null || input.entityId <= 0) {
    return null;
  }
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (!label) return null;
  const baseMs = normalizeTimestampMs(input.createdAt ?? new Date());
  if (!Number.isFinite(baseMs)) return null;
  return {
    audit_event_id: Number(input.auditEventId),
    entity: input.entity,
    entity_id: Number(input.entityId),
    expires_at: new Date(baseMs + KITCHEN_ASSISTANT_UNDO_WINDOW_MS).toISOString(),
    label,
  };
}

export function undoKitchenAssistantAction(input: {
  auditEventId: number;
  locationId: string;
  cookId: string | null;
}): UndoResult {
  if (!Number.isInteger(input.auditEventId) || input.auditEventId <= 0) {
    return { ok: false, status: 400, error: 'Undo id is missing.' };
  }
  const db = getDb();
  try {
    return db.transaction(() => {
      const original = db
        .prepare('SELECT * FROM audit_events WHERE id = ?')
        .get(input.auditEventId) as AuditEventRowLite | undefined;
      if (!original) {
        return { ok: false, status: 404, error: 'That action is gone.' };
      }
      if (original.location_id !== input.locationId) {
        return { ok: false, status: 404, error: 'That action is gone.' };
      }
      if (original.actor_source !== 'kitchen_assistant' || original.action !== 'insert') {
        return { ok: false, status: 409, error: 'That action cannot be undone.' };
      }
      if (!isKitchenAssistantUndoableEntity(original.entity) || !Number.isInteger(original.entity_id) || (original.entity_id ?? 0) <= 0) {
        return { ok: false, status: 409, error: 'That action cannot be undone.' };
      }
      const createdAtMs = normalizeTimestampMs(original.created_at);
      if (!Number.isFinite(createdAtMs)) {
        return { ok: false, status: 409, error: 'That action cannot be checked right now.' };
      }
      if (Date.now() - createdAtMs > KITCHEN_ASSISTANT_UNDO_WINDOW_MS) {
        return { ok: false, status: 409, error: 'Undo time ran out.' };
      }
      const priorCorrection = db
        .prepare('SELECT id FROM audit_events WHERE replaces_id = ? LIMIT 1')
        .get(original.id) as { id: number } | undefined;
      if (priorCorrection) {
        return { ok: false, status: 409, error: 'That action was already undone.' };
      }

      const config = UNDOABLE_CONFIG[original.entity];
      const beforeRow = readSourceRow(config.table, Number(original.entity_id));
      if (!beforeRow) {
        return { ok: false, status: 409, error: 'That action was already changed.' };
      }

      let afterPayload: unknown = null;
      let message = 'Undid last action.';
      if (config.mode === 'resolve_eighty_six') {
        const updateInfo = db
          .prepare(`UPDATE ${config.table} SET resolved_at = ?, resolved_by = ? WHERE id = ? AND resolved_at IS NULL`)
          .run(new Date().toISOString(), input.cookId || 'kitchen_assistant_undo', Number(original.entity_id));
        if (updateInfo.changes !== 1) {
          return { ok: false, status: 409, error: 'That 86 was already cleared.' };
        }
        afterPayload = readSourceRow(config.table, Number(original.entity_id));
        message = buildUndoSuccessMessage(original.entity, beforeRow, afterPayload);
      } else {
        const deleteInfo = db
          .prepare(`DELETE FROM ${config.table} WHERE id = ?`)
          .run(Number(original.entity_id));
        if (deleteInfo.changes !== 1) {
          return { ok: false, status: 409, error: 'That action was already cleared.' };
        }
        afterPayload = null;
        message = buildUndoSuccessMessage(original.entity, beforeRow, afterPayload);
      }

      const correctedAuditId = postAuditEvent({
        entity: original.entity,
        entity_id: original.entity_id,
        action: 'correction',
        replaces_id: original.id,
        actor_cook_id: input.cookId,
        actor_source: 'kitchen_assistant_undo',
        shift_date: original.shift_date,
        location_id: original.location_id,
        payload: {
          undo_window_ms: KITCHEN_ASSISTANT_UNDO_WINDOW_MS,
          original_audit_event_id: original.id,
          before: beforeRow,
          after: afterPayload,
        },
        note: 'undo_30s',
      });

      return {
        ok: true,
        status: 200,
        message,
        correctedAuditId,
      };
    })();
  } catch (err) {
    console.error('undoKitchenAssistantAction failed:', err);
    return { ok: false, status: 500, error: 'Could not undo that action.' };
  }
}

function readSourceRow(table: string, id: number) {
  return getDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
}

function normalizeTimestampMs(value: string | Date): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== 'string') return Number.NaN;
  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;
  const isoLike = /[zZ]|[+-]\d\d:\d\d$/.test(trimmed)
    ? trimmed
    : trimmed.includes('T')
      ? `${trimmed}Z`
      : `${trimmed.replace(' ', 'T')}Z`;
  return Date.parse(isoLike);
}

function parseAuditPayload(row: AuditEventRowLite) {
  if (!row.payload_json) return null;
  try {
    return JSON.parse(row.payload_json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildUndoSuccessMessage(entity: UndoableEntity, beforeRow: Record<string, unknown>, afterPayload: unknown) {
  if (entity === 'eighty_six') {
    const item = typeof beforeRow.item === 'string' && beforeRow.item.trim() ? beforeRow.item.trim() : 'that item';
    return `${item} is back on.`;
  }
  if (entity === 'line_check_entries') {
    const item = typeof beforeRow.item === 'string' && beforeRow.item.trim() ? beforeRow.item.trim() : 'that check';
    return `Removed ${item}.`;
  }
  if (entity === 'inventory_updates') {
    const item = typeof beforeRow.item === 'string' && beforeRow.item.trim() ? beforeRow.item.trim() : 'that stock update';
    return `Removed ${item}.`;
  }
  if (entity === 'order_guide_items') {
    const ingredient = typeof beforeRow.ingredient === 'string' && beforeRow.ingredient.trim() ? beforeRow.ingredient.trim() : 'that order guide row';
    return `Removed ${ingredient}.`;
  }
  if (entity === 'equipment_maintenance') {
    return 'Removed that maintenance ticket.';
  }
  if (entity === 'gold_stars') {
    const cook = typeof beforeRow.cook_name === 'string' && beforeRow.cook_name.trim() ? beforeRow.cook_name.trim() : 'that cook';
    return `Removed ${cook}'s Gold Star.`;
  }
  const payload = afterPayload as Record<string, unknown> | null;
  if (payload && typeof payload.message === 'string') return payload.message;
  return 'Undid last action.';
}

export function buildKitchenAssistantUndoLabel(entity: string | null | undefined, fallbackLabel: string, auditRow?: AuditEventRowLite | null) {
  const trimmed = typeof fallbackLabel === 'string' ? fallbackLabel.trim() : '';
  if (trimmed) return trimmed;
  if (!auditRow || !isKitchenAssistantUndoableEntity(entity)) return '';
  const payload = parseAuditPayload(auditRow);
  if (entity === 'eighty_six' && payload && typeof payload.item === 'string') {
    return `Marked ${payload.item} as 86'd.`;
  }
  if (entity === 'line_check_entries' && payload && typeof payload.item === 'string') {
    return `Logged ${payload.item}.`;
  }
  return '';
}
