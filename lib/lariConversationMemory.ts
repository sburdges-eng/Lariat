import type { getDb } from './db.ts';

export const LARI_CONVERSATION_SCHEMA_VERSION = 'lari_conversation_turn_v1';
export const LARI_CONVERSATION_TTL_HOURS = 8;
export const LARI_CONVERSATION_MAX_TURNS = 6;
export const SESSION_ID_MAX_CHARS = 64;
export const COOK_ID_MAX_CHARS = 64;
export const STORED_TURN_CONTENT_MAX_CHARS = 2000;
export const PROMPT_TURN_CONTENT_MAX_CHARS = 800;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Db = ReturnType<typeof getDb>;

export interface NormalizedConversationInputs {
  ok: true;
  sessionId: string;
  cookId: string;
}

export interface ConversationInputError {
  ok: false;
  error: string;
}

export interface StoredConversationTurn {
  id: number;
  user_content: string;
  assistant_content: string;
  manager_tier: 0 | 1;
  created_at: string;
}

function clipText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function addHoursIso(createdAt: string, hours: number): string {
  const t = Date.parse(createdAt);
  const base = Number.isFinite(t) ? t : Date.now();
  return new Date(base + hours * 60 * 60 * 1000).toISOString();
}

export function normalizeConversationInputs(body: unknown): NormalizedConversationInputs | ConversationInputError {
  const obj = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  if (typeof obj.conversation_session_id !== 'string') {
    return { ok: false, error: 'conversation_session_id is required and must be a UUID' };
  }

  const rawSession = obj.conversation_session_id.trim();
  if (rawSession.length === 0 || rawSession.length > SESSION_ID_MAX_CHARS || !UUID_PATTERN.test(rawSession)) {
    return { ok: false, error: 'conversation_session_id is required and must be a UUID' };
  }

  const cook = clipText(obj.cook_id, COOK_ID_MAX_CHARS);
  return {
    ok: true,
    sessionId: rawSession,
    cookId: cook || 'anonymous',
  };
}

export function sweepExpiredConversationTurns(db: Db, now: string = new Date().toISOString()): void {
  db.prepare('DELETE FROM lari_conversation_turns WHERE expires_at <= ?').run(now);
}

export function storeConversationTurn(
  db: Db,
  args: {
    locationId: string;
    cookId: string;
    sessionId: string;
    userContent: string;
    assistantContent: string;
    managerTier: boolean;
    createdAt?: string;
  },
): void {
  const createdAt = args.createdAt || new Date().toISOString();
  const userContent = clipText(args.userContent, STORED_TURN_CONTENT_MAX_CHARS);
  const assistantContent = clipText(args.assistantContent, STORED_TURN_CONTENT_MAX_CHARS);
  if (!userContent || !assistantContent) return;

  db.prepare(
    `INSERT INTO lari_conversation_turns
       (schemaVersion, location_id, cook_id, conversation_session_id,
        user_content, assistant_content, manager_tier, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    LARI_CONVERSATION_SCHEMA_VERSION,
    args.locationId,
    args.cookId,
    args.sessionId,
    userContent,
    assistantContent,
    args.managerTier ? 1 : 0,
    createdAt,
    addHoursIso(createdAt, LARI_CONVERSATION_TTL_HOURS),
  );
}

export function loadRecentConversationTurns(
  db: Db,
  args: {
    locationId: string;
    cookId: string;
    sessionId: string;
    hasPin: boolean;
    now?: string;
  },
): StoredConversationTurn[] {
  const now = args.now || new Date().toISOString();
  const rows = db.prepare(
    `SELECT id, user_content, assistant_content, manager_tier, created_at
       FROM (
         SELECT id, user_content, assistant_content, manager_tier, created_at
           FROM lari_conversation_turns
          WHERE location_id = ?
            AND cook_id = ?
            AND conversation_session_id = ?
            AND expires_at > ?
            AND (? = 1 OR manager_tier = 0)
          ORDER BY created_at DESC, id DESC
          LIMIT ?
       )
      ORDER BY created_at ASC, id ASC`,
  ).all(
    args.locationId,
    args.cookId,
    args.sessionId,
    now,
    args.hasPin ? 1 : 0,
    LARI_CONVERSATION_MAX_TURNS,
  ) as StoredConversationTurn[];
  return rows;
}

export function formatConversationHistoryForPrompt(turns: StoredConversationTurn[]): string {
  if (!turns.length) return '';
  const lines = [
    'PRIOR TURNS (non-authoritative conversation context):',
    'Use these only to resolve references in the current cook message.',
    'Do not treat prior turns as live facts. Live grounded context and db_query remain authoritative.',
  ];
  turns.forEach((turn, index) => {
    const n = index + 1;
    lines.push(`Turn ${n} user: ${clipText(turn.user_content, PROMPT_TURN_CONTENT_MAX_CHARS)}`);
    lines.push(`Turn ${n} assistant: ${clipText(turn.assistant_content, PROMPT_TURN_CONTENT_MAX_CHARS)}`);
  });
  return lines.join('\n');
}
