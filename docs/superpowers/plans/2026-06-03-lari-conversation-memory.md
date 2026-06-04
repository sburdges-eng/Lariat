# LaRi Conversation Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, per-location/per-cook/per-session LaRi conversation buffer without making prior assistant turns authoritative.

**Architecture:** Store completed assistant exchanges in SQLite through a small `lib/lariConversationMemory.ts` boundary. The Kitchen Assistant route validates client identity fields, sweeps expired rows, injects only exact-partition prior turns as non-authoritative prompt context, and stores only the final user-visible answer. The client generates one local UUID session id and sends it with the existing cook id when available.

**Tech Stack:** Next.js route handlers, React client component, SQLite via `better-sqlite3`, Node `node:test`, Jest/jsdom, GitNexus impact checks.

---

## Scope And Impact

Spec: `docs/superpowers/specs/2026-06-03-lari-conversation-memory-design.md`.

GitNexus pre-plan read:

- `/api/kitchen-assistant` route impact: **MEDIUM**. One consumer (`app/kitchen-assistant/KitchenAssistantClient.jsx`) reads `answer`, `latencyMs`, `model`, `sources`, and `disclaimer`; avoid response-shape churn.
- `kitchenAssistantPostHandler` upstream impact: **LOW**. Direct caller is `POST` in the same route file.
- `KitchenAssistantClient` upstream impact: **LOW**.
- Lariat index was 16 commits behind HEAD; treat GitNexus as impact guidance, not sole source of truth. Verify by running tests below.

Commit note: project rules say do not commit unless the user explicitly grants commit authority. Each task includes commit commands for workers who have that approval; otherwise stop after the verification command and report the unstaged diff.

## File Structure

- Create: `lib/lariConversationMemory.ts`
  - Owns validation, clipping, TTL sweep, exact-partition history lookup, prompt formatting, and turn storage.
  - No model calls, no request parsing, no auth decisions beyond accepting `hasPin` as a boolean input.
- Modify: `lib/db.ts`
  - Adds `lari_conversation_turns` table, expiry/partition indexes, and schema-drift guard entry.
- Modify: `app/api/kitchen-assistant/route.js`
  - Wires validation and history injection into `kitchenAssistantPostHandler`.
  - Stores final visible answer after action extraction/execution handling.
- Modify: `app/kitchen-assistant/KitchenAssistantClient.jsx`
  - Adds stable `conversation_session_id` generation and sends existing `lariat_cook` when present.
- Create: `tests/js/test-lari-conversation-memory.mjs`
  - Pure DB/helper tests for validation, partitioning, TTL, ordering, manager-tier exclusion, and formatting.
- Create: `tests/js/test-kitchen-assistant-conversation-memory.mjs`
  - Route integration tests with stubbed Ollama fetch.
- Create: `app/__tests__/KitchenAssistantClient.conversation.test.jsx`
  - Client request-body tests for session id and cook id.
- Modify: `tests/js/test-schema-migrations.mjs`
  - Pins table columns and indexes.
- Modify: `package.json`
  - Adds a focused `test:kitchen-assistant-conversation` script.

## Task 1: Schema Contract

**Files:**
- Modify: `lib/db.ts`
- Modify: `tests/js/test-schema-migrations.mjs`

- [ ] **Step 1: Add failing schema tests**

Append this block near the other schema table tests in `tests/js/test-schema-migrations.mjs`:

```js
describe('lari_conversation_turns schema', () => {
  it('exists with canonical columns in order', () => {
    const info = db.prepare('PRAGMA table_info(lari_conversation_turns)').all();
    const names = info.map((c) => c.name);
    assert.deepStrictEqual(names, [
      'schemaVersion',
      'id',
      'location_id',
      'cook_id',
      'conversation_session_id',
      'user_content',
      'assistant_content',
      'manager_tier',
      'created_at',
      'expires_at',
    ]);
  });

  it('requires partition fields, clipped content fields, tier flag, and expiry', () => {
    const info = db.prepare('PRAGMA table_info(lari_conversation_turns)').all();
    const byName = Object.fromEntries(info.map((c) => [c.name, c]));
    assert.equal(byName.schemaVersion.type.toUpperCase(), 'TEXT');
    assert.equal(byName.location_id.notnull, 1);
    assert.equal(byName.cook_id.notnull, 1);
    assert.equal(byName.conversation_session_id.notnull, 1);
    assert.equal(byName.user_content.notnull, 1);
    assert.equal(byName.assistant_content.notnull, 1);
    assert.equal(byName.manager_tier.notnull, 1);
    assert.equal(byName.expires_at.notnull, 1);
  });

  it('has partition and expiry indexes', () => {
    const indexes = db.prepare("PRAGMA index_list('lari_conversation_turns')").all();
    const names = indexes.map((i) => i.name);
    assert.ok(names.includes('idx_lari_conversation_partition'), 'partition index missing');
    assert.ok(names.includes('idx_lari_conversation_expiry'), 'expiry index missing');
  });
});
```

- [ ] **Step 2: Run schema test and verify it fails**

Run:

```bash
npm run test:schema
```

Expected: FAIL with `lari_conversation_turns` missing or empty `PRAGMA table_info`.

- [ ] **Step 3: Add table and indexes**

In `lib/db.ts`, inside `initSchema(db)` after `performance_reviews` and before `dish_coverage_snapshots`, add:

```sql
    CREATE TABLE IF NOT EXISTS lari_conversation_turns (
      schemaVersion TEXT NOT NULL DEFAULT 'lari_conversation_turn_v1'
        CHECK(schemaVersion = 'lari_conversation_turn_v1'),
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL,
      cook_id TEXT NOT NULL,
      conversation_session_id TEXT NOT NULL,
      user_content TEXT NOT NULL,
      assistant_content TEXT NOT NULL,
      manager_tier INTEGER NOT NULL DEFAULT 0 CHECK(manager_tier IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
```

In `ensureIndexes(db)`, add:

```sql
    CREATE INDEX IF NOT EXISTS idx_lari_conversation_partition
      ON lari_conversation_turns(location_id, cook_id, conversation_session_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_lari_conversation_expiry
      ON lari_conversation_turns(expires_at);
```

In `assertCriticalSchemas(db)`, add:

```ts
    lari_conversation_turns: [
      'schemaVersion', 'id', 'location_id', 'cook_id',
      'conversation_session_id', 'user_content', 'assistant_content',
      'manager_tier', 'created_at', 'expires_at',
    ],
```

- [ ] **Step 4: Run schema test and verify it passes**

Run:

```bash
npm run test:schema
```

Expected: PASS.

- [ ] **Step 5: Commit if commit authority was granted**

```bash
git add lib/db.ts tests/js/test-schema-migrations.mjs
git commit -m "feat(lari): add conversation memory schema"
```

## Task 2: Conversation Memory Helper

**Files:**
- Create: `lib/lariConversationMemory.ts`
- Create: `tests/js/test-lari-conversation-memory.mjs`

- [ ] **Step 1: Write failing helper tests**

Create `tests/js/test-lari-conversation-memory.mjs`:

```js
#!/usr/bin/env node
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const dbMod = await import('../../lib/db.ts');
const memory = await import('../../lib/lariConversationMemory.ts');

dbMod.setDbPathForTest(':memory:');
const db = dbMod.getDb();

after(() => {
  dbMod.setDbPathForTest(null);
});

beforeEach(() => {
  db.exec('DELETE FROM lari_conversation_turns');
});

const SESSION = '11111111-1111-4111-8111-111111111111';
const OTHER_SESSION = '22222222-2222-4222-8222-222222222222';

describe('normalizeConversationInputs', () => {
  it('accepts UUID session and trims cook_id', () => {
    const r = memory.normalizeConversationInputs({
      conversation_session_id: ` ${SESSION} `,
      cook_id: '  cook-alex  ',
    });
    assert.equal(r.ok, true);
    assert.equal(r.sessionId, SESSION);
    assert.equal(r.cookId, 'cook-alex');
  });

  it('normalizes missing cook_id to anonymous', () => {
    const r = memory.normalizeConversationInputs({ conversation_session_id: SESSION });
    assert.equal(r.ok, true);
    assert.equal(r.cookId, 'anonymous');
  });

  it('fails closed on missing or invalid session id', () => {
    assert.equal(memory.normalizeConversationInputs({}).ok, false);
    assert.equal(memory.normalizeConversationInputs({ conversation_session_id: 'not-a-uuid' }).ok, false);
    assert.equal(memory.normalizeConversationInputs({ conversation_session_id: `${SESSION}extra` }).ok, false);
  });

  it('clips long cook_id values to the fixed cap', () => {
    const longCook = 'x'.repeat(100);
    const r = memory.normalizeConversationInputs({
      conversation_session_id: SESSION,
      cook_id: longCook,
    });
    assert.equal(r.ok, true);
    assert.equal(r.cookId.length, memory.COOK_ID_MAX_CHARS);
  });
});

describe('conversation turn persistence and lookup', () => {
  it('loads only exact location + cook + session rows', () => {
    memory.storeConversationTurn(db, {
      locationId: 'loc-a',
      cookId: 'cook-a',
      sessionId: SESSION,
      userContent: 'show vendor shocks',
      assistantContent: 'Sysco moved up.',
      managerTier: false,
      createdAt: '2026-06-03T10:00:00.000Z',
    });
    memory.storeConversationTurn(db, {
      locationId: 'loc-b',
      cookId: 'cook-a',
      sessionId: SESSION,
      userContent: 'foreign location',
      assistantContent: 'foreign answer',
      managerTier: false,
      createdAt: '2026-06-03T10:01:00.000Z',
    });
    memory.storeConversationTurn(db, {
      locationId: 'loc-a',
      cookId: 'cook-b',
      sessionId: SESSION,
      userContent: 'foreign cook',
      assistantContent: 'foreign answer',
      managerTier: false,
      createdAt: '2026-06-03T10:02:00.000Z',
    });
    memory.storeConversationTurn(db, {
      locationId: 'loc-a',
      cookId: 'cook-a',
      sessionId: OTHER_SESSION,
      userContent: 'foreign session',
      assistantContent: 'foreign answer',
      managerTier: false,
      createdAt: '2026-06-03T10:03:00.000Z',
    });

    const turns = memory.loadRecentConversationTurns(db, {
      locationId: 'loc-a',
      cookId: 'cook-a',
      sessionId: SESSION,
      hasPin: false,
      now: '2026-06-03T10:04:00.000Z',
    });
    assert.equal(turns.length, 1);
    assert.equal(turns[0].user_content, 'show vendor shocks');
  });

  it('keeps latest 6 rows and returns them in created_at ASC, id ASC order', () => {
    for (let i = 0; i < 8; i += 1) {
      memory.storeConversationTurn(db, {
        locationId: 'default',
        cookId: 'cook-a',
        sessionId: SESSION,
        userContent: `u${i}`,
        assistantContent: `a${i}`,
        managerTier: false,
        createdAt: `2026-06-03T10:0${i}:00.000Z`,
      });
    }
    const turns = memory.loadRecentConversationTurns(db, {
      locationId: 'default',
      cookId: 'cook-a',
      sessionId: SESSION,
      hasPin: false,
      now: '2026-06-03T10:30:00.000Z',
    });
    assert.deepEqual(turns.map((t) => t.user_content), ['u2', 'u3', 'u4', 'u5', 'u6', 'u7']);
  });

  it('excludes manager-tier rows without PIN and includes them with PIN', () => {
    memory.storeConversationTurn(db, {
      locationId: 'default',
      cookId: 'cook-a',
      sessionId: SESSION,
      userContent: 'what did we sell',
      assistantContent: 'Manager-only sales answer',
      managerTier: true,
      createdAt: '2026-06-03T10:00:00.000Z',
    });
    assert.equal(memory.loadRecentConversationTurns(db, {
      locationId: 'default',
      cookId: 'cook-a',
      sessionId: SESSION,
      hasPin: false,
      now: '2026-06-03T10:05:00.000Z',
    }).length, 0);
    assert.equal(memory.loadRecentConversationTurns(db, {
      locationId: 'default',
      cookId: 'cook-a',
      sessionId: SESSION,
      hasPin: true,
      now: '2026-06-03T10:05:00.000Z',
    }).length, 1);
  });

  it('lazy sweep deletes expired rows', () => {
    memory.storeConversationTurn(db, {
      locationId: 'default',
      cookId: 'cook-a',
      sessionId: SESSION,
      userContent: 'old',
      assistantContent: 'old answer',
      managerTier: false,
      createdAt: '2026-06-03T00:00:00.000Z',
    });
    memory.sweepExpiredConversationTurns(db, '2026-06-03T09:00:01.000Z');
    const row = db.prepare('SELECT COUNT(*) AS c FROM lari_conversation_turns').get();
    assert.equal(row.c, 0);
  });
});

describe('formatConversationHistoryForPrompt', () => {
  it('labels turns as non-authoritative and clips prompt content', () => {
    const text = memory.formatConversationHistoryForPrompt([
      {
        id: 1,
        user_content: 'show vendor shocks',
        assistant_content: 'x'.repeat(memory.PROMPT_TURN_CONTENT_MAX_CHARS + 50),
        manager_tier: 0,
        created_at: '2026-06-03T10:00:00.000Z',
      },
    ]);
    assert.match(text, /non-authoritative conversation context/i);
    assert.match(text, /live grounded context and db_query remain authoritative/i);
    assert.ok(text.length < memory.PROMPT_TURN_CONTENT_MAX_CHARS + 500);
    assert.doesNotMatch(text, /x{900}/);
  });
});
```

- [ ] **Step 2: Run helper test and verify it fails**

Run:

```bash
node --experimental-strip-types --test tests/js/test-lari-conversation-memory.mjs
```

Expected: FAIL because `lib/lariConversationMemory.ts` does not exist.

- [ ] **Step 3: Add helper implementation**

Create `lib/lariConversationMemory.ts`:

```ts
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
```

- [ ] **Step 4: Run helper test and verify it passes**

Run:

```bash
node --experimental-strip-types --test tests/js/test-lari-conversation-memory.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit if commit authority was granted**

```bash
git add lib/lariConversationMemory.ts tests/js/test-lari-conversation-memory.mjs
git commit -m "feat(lari): add conversation memory helper"
```

## Task 3: Route Integration

**Files:**
- Modify: `app/api/kitchen-assistant/route.js`
- Create: `tests/js/test-kitchen-assistant-conversation-memory.mjs`

- [ ] **Step 1: Write failing route integration tests**

Create `tests/js/test-kitchen-assistant-conversation-memory.mjs`:

```js
#!/usr/bin/env node
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-ka-conversation-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
process.env.LARIAT_PIN_SECRET = 'test-secret-for-lari-conversation-suite';

const dbMod = await import('../../lib/db.ts');
const memory = await import('../../lib/lariConversationMemory.ts');
const { signPinCookieValue } = await import('../../lib/pinCookie.ts');
const route = await import('../../app/api/kitchen-assistant/route.js');

dbMod.setDbPathForTest(TMP_DB);
const db = dbMod.getDb();
const { POST } = route;

const SESSION = '11111111-1111-4111-8111-111111111111';
const LOC = 'west';
const COOK = 'cook-alex';
let capturedChatBody = null;
let stubbedContent = 'Plain answer.';
let chatCalls = 0;

globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.endsWith('/api/chat')) {
    chatCalls += 1;
    capturedChatBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ message: { content: stubbedContent } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response('not stubbed', { status: 404 });
};

after(() => {
  dbMod.setDbPathForTest(null);
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET === undefined) delete process.env.LARIAT_PIN_SECRET;
  else process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  capturedChatBody = null;
  stubbedContent = 'Plain answer.';
  chatCalls = 0;
  db.exec('DELETE FROM lari_conversation_turns; DELETE FROM audit_events;');
});

function req(body, { cookie = null } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return new Request('http://localhost/api/kitchen-assistant', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function latestUserPrompt() {
  return capturedChatBody.messages.find((m) => m.role === 'user').content;
}

describe('POST /api/kitchen-assistant conversation memory', () => {
  it('requires a valid conversation_session_id before calling Ollama', async () => {
    const res = await POST(req({ message: 'what is 86?', location_id: LOC, cook_id: COOK }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /conversation_session_id/i);
    assert.equal(chatCalls, 0);
  });

  it('injects only exact location + cook + session prior turns as non-authoritative context', async () => {
    memory.storeConversationTurn(db, {
      locationId: LOC,
      cookId: COOK,
      sessionId: SESSION,
      userContent: 'show vendor shocks',
      assistantContent: 'Sysco brisket rose 12%.',
      managerTier: false,
      createdAt: '2026-06-03T10:00:00.000Z',
    });
    memory.storeConversationTurn(db, {
      locationId: 'other',
      cookId: COOK,
      sessionId: SESSION,
      userContent: 'foreign location marker',
      assistantContent: 'must not leak',
      managerTier: false,
      createdAt: '2026-06-03T10:01:00.000Z',
    });
    memory.storeConversationTurn(db, {
      locationId: LOC,
      cookId: 'other-cook',
      sessionId: SESSION,
      userContent: 'foreign cook marker',
      assistantContent: 'must not leak',
      managerTier: false,
      createdAt: '2026-06-03T10:02:00.000Z',
    });
    memory.storeConversationTurn(db, {
      locationId: LOC,
      cookId: COOK,
      sessionId: '22222222-2222-4222-8222-222222222222',
      userContent: 'foreign session marker',
      assistantContent: 'must not leak',
      managerTier: false,
      createdAt: '2026-06-03T10:03:00.000Z',
    });

    const res = await POST(req({
      message: 'show me brisket specifically',
      location_id: LOC,
      cook_id: COOK,
      conversation_session_id: SESSION,
    }));
    assert.equal(res.status, 200);
    const prompt = latestUserPrompt();
    assert.match(prompt, /PRIOR TURNS \(non-authoritative conversation context\)/);
    assert.match(prompt, /Sysco brisket rose 12%/);
    assert.doesNotMatch(prompt, /foreign location marker|foreign cook marker|foreign session marker/);
  });

  it('excludes manager-tier prior turns without signed PIN and includes them with signed PIN', async () => {
    memory.storeConversationTurn(db, {
      locationId: LOC,
      cookId: COOK,
      sessionId: SESSION,
      userContent: 'what did we sell',
      assistantContent: 'Manager sales answer',
      managerTier: true,
      createdAt: '2026-06-03T10:00:00.000Z',
    });

    let res = await POST(req({
      message: 'follow up',
      location_id: LOC,
      cook_id: COOK,
      conversation_session_id: SESSION,
    }));
    assert.equal(res.status, 200);
    assert.doesNotMatch(latestUserPrompt(), /Manager sales answer/);

    const signed = await signPinCookieValue(process.env.LARIAT_PIN_SECRET);
    res = await POST(req({
      message: 'follow up',
      location_id: LOC,
      cook_id: COOK,
      conversation_session_id: SESSION,
    }, { cookie: `lariat_pin_ok=${signed}` }));
    assert.equal(res.status, 200);
    assert.match(latestUserPrompt(), /Manager sales answer/);
  });

  it('stores only final visible answer, not raw action JSON', async () => {
    stubbedContent = '```json\\n{"action":"eighty_six","item":"salmon"}\\n```\\nVisible answer only.';
    const res = await POST(req({
      message: 'what did you mean?',
      location_id: LOC,
      cook_id: COOK,
      conversation_session_id: SESSION,
    }));
    assert.equal(res.status, 200);
    const row = db.prepare(
      `SELECT user_content, assistant_content FROM lari_conversation_turns
        WHERE location_id = ? AND cook_id = ? AND conversation_session_id = ?
        ORDER BY id DESC LIMIT 1`,
    ).get(LOC, COOK, SESSION);
    assert.equal(row.user_content, 'what did you mean?');
    assert.equal(row.assistant_content, 'Visible answer only.');
    assert.doesNotMatch(row.assistant_content, /"action"|"eighty_six"|```json/);
  });
});
```

- [ ] **Step 2: Run route test and verify it fails**

Run:

```bash
node --experimental-strip-types --test tests/js/test-kitchen-assistant-conversation-memory.mjs
```

Expected: FAIL because the route does not require `conversation_session_id`, does not inject history, and does not store turns.

- [ ] **Step 3: Import helper functions**

In `app/api/kitchen-assistant/route.js`, add this import after the `dbQueryTool` import:

```js
import {
  normalizeConversationInputs,
  sweepExpiredConversationTurns,
  loadRecentConversationTurns,
  formatConversationHistoryForPrompt,
  storeConversationTurn,
} from '../../../lib/lariConversationMemory.ts';
```

- [ ] **Step 4: Validate conversation partition and load history**

Inside `kitchenAssistantPostHandler`, after `const hasPin = await hasPinCookie(req);`, add:

```js
  const conversation = normalizeConversationInputs(body);
  if (!conversation.ok) {
    return Response.json({ error: conversation.error }, { status: 400 });
  }

  const conversationDb = getDb();
  sweepExpiredConversationTurns(conversationDb);
  const priorTurns = loadRecentConversationTurns(conversationDb, {
    locationId,
    cookId: conversation.cookId,
    sessionId: conversation.sessionId,
    hasPin,
  });
  const conversationHistory = formatConversationHistoryForPrompt(priorTurns);
```

- [ ] **Step 5: Inject history into the prompt as non-authoritative context**

Replace the current `userContent` initialization:

```js
  let userContent = `CONTEXT (authoritative — only use these facts for operational claims):\n\n${contextText}\n\n${queryCatalog}\n---\nCOOK MESSAGE:\n${message}`;
```

with:

```js
  const historyBlock = conversationHistory
    ? `\n---\n${conversationHistory}\n`
    : '\n';
  let userContent = `CONTEXT (authoritative — only use these facts for operational claims):\n\n${contextText}\n\n${queryCatalog}${historyBlock}---\nCOOK MESSAGE:\n${message}`;
```

- [ ] **Step 6: Store the completed visible exchange**

Immediately after the `if (actionExecuted) { ... }` block and before `const latencyMs = Date.now() - started;`, add:

```js
    try {
      storeConversationTurn(conversationDb, {
        locationId,
        cookId: conversation.cookId,
        sessionId: conversation.sessionId,
        userContent: message,
        assistantContent: finalAnswer,
        managerTier: hasPin,
      });
    } catch (conversationError) {
      console.error('Conversation memory store failed:', conversationError);
    }
```

Do not store inside the outer Ollama `catch`; failed inference returns `502` and is not a completed exchange.

- [ ] **Step 7: Run route test and verify it passes**

Run:

```bash
node --experimental-strip-types --test tests/js/test-kitchen-assistant-conversation-memory.mjs
```

Expected: PASS.

- [ ] **Step 8: Run existing kitchen assistant route regression tests**

Run:

```bash
node --experimental-strip-types --test \
  tests/js/test-kitchen-assistant-pin-gate.mjs \
  tests/js/test-kitchen-assistant-beo-add-prep-scope.mjs \
  tests/js/test-kitchen-assistant-action-hardening.mjs
```

Expected: PASS. If older tests now fail because they omit `conversation_session_id`, update their request bodies with a valid UUID; do not relax the new fail-closed route contract.

- [ ] **Step 9: Commit if commit authority was granted**

```bash
git add app/api/kitchen-assistant/route.js tests/js/test-kitchen-assistant-conversation-memory.mjs tests/js/test-kitchen-assistant-pin-gate.mjs tests/js/test-kitchen-assistant-beo-add-prep-scope.mjs tests/js/test-kitchen-assistant-action-hardening.mjs
git commit -m "feat(lari): wire conversation memory into assistant route"
```

## Task 4: Client Session And Cook ID

**Files:**
- Modify: `app/kitchen-assistant/KitchenAssistantClient.jsx`
- Create: `app/__tests__/KitchenAssistantClient.conversation.test.jsx`

- [ ] **Step 1: Write failing client tests**

Create `app/__tests__/KitchenAssistantClient.conversation.test.jsx`:

```jsx
// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts.
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import KitchenAssistantClient from '../kitchen-assistant/KitchenAssistantClient';

const SESSION = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  window.localStorage.clear();
  global.fetch = jest.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ model: 'lari-the-kitchen-assistant', ollamaReachable: true }),
    })
    .mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: 'Answer.',
        model: 'lari-the-kitchen-assistant',
        location_id: 'west',
        sources: [],
        latencyMs: 12,
        disclaimer: 'Check tags with a manager. Do not trust AI for allergies.',
      }),
    });
  Object.defineProperty(global.crypto, 'randomUUID', {
    configurable: true,
    value: jest.fn(() => SESSION),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function ask(question = 'what is 86?') {
  render(<KitchenAssistantClient locQuery="" />);
  fireEvent.change(screen.getByLabelText(/Ask a question/i), { target: { value: question } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Ask kitchen assistant/i }));
  });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  return JSON.parse(global.fetch.mock.calls[1][1].body);
}

test('generates and sends conversation_session_id with existing cook_id and location_id', async () => {
  window.localStorage.setItem('lariat_cook', 'cook-alex');
  window.localStorage.setItem('lariat_location', 'west');

  const body = await ask('show vendor shocks');

  expect(body.message).toBe('show vendor shocks');
  expect(body.conversation_session_id).toBe(SESSION);
  expect(body.cook_id).toBe('cook-alex');
  expect(body.location_id).toBe('west');
  expect(window.localStorage.getItem('lariat_conversation_session_id')).toBe(SESSION);
});

test('reuses existing conversation_session_id and omits missing cook_id', async () => {
  window.localStorage.setItem('lariat_conversation_session_id', SESSION);

  const body = await ask('follow up');

  expect(global.crypto.randomUUID).not.toHaveBeenCalled();
  expect(body.conversation_session_id).toBe(SESSION);
  expect(Object.prototype.hasOwnProperty.call(body, 'cook_id')).toBe(false);
});
```

- [ ] **Step 2: Run client test and verify it fails**

Run:

```bash
npx jest app/__tests__/KitchenAssistantClient.conversation.test.jsx --runInBand
```

Expected: FAIL because `conversation_session_id` and `cook_id` are not sent yet.

- [ ] **Step 3: Add local session key and helper**

In `app/kitchen-assistant/KitchenAssistantClient.jsx`, near the existing localStorage keys:

```js
const LOC_KEY = 'lariat_location';
const LANG_KEY = 'lariat_language';
const COOK_KEY = 'lariat_cook';
const CONVERSATION_SESSION_KEY = 'lariat_conversation_session_id';

function fallbackUuidV4() {
  const bytes = new Uint8Array(16);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getOrCreateConversationSessionId() {
  if (typeof window === 'undefined') return '';
  const existing = window.localStorage.getItem(CONVERSATION_SESSION_KEY);
  if (existing) return existing;
  const next = window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : fallbackUuidV4();
  window.localStorage.setItem(CONVERSATION_SESSION_KEY, next);
  return next;
}
```

- [ ] **Step 4: Send session id and cook id in the assistant POST body**

In `submit`, replace:

```js
      const loc = typeof window !== 'undefined' ? window.localStorage.getItem(LOC_KEY) : '';
      const body = { message: q, language };
      if (loc && loc !== 'default') body.location_id = loc;
```

with:

```js
      const loc = typeof window !== 'undefined' ? window.localStorage.getItem(LOC_KEY) : '';
      const cookId = typeof window !== 'undefined' ? window.localStorage.getItem(COOK_KEY) : '';
      const body = {
        message: q,
        language,
        conversation_session_id: getOrCreateConversationSessionId(),
      };
      if (cookId) body.cook_id = cookId;
      if (loc && loc !== 'default') body.location_id = loc;
```

- [ ] **Step 5: Run client test and verify it passes**

Run:

```bash
npx jest app/__tests__/KitchenAssistantClient.conversation.test.jsx --runInBand
```

Expected: PASS.

- [ ] **Step 6: Run related client tests**

Run:

```bash
npm run test:unit -- app/__tests__/KitchenAssistantClient.conversation.test.jsx app/__tests__/StationChecklist-glove.test.jsx
```

Expected: PASS.

- [ ] **Step 7: Commit if commit authority was granted**

```bash
git add app/kitchen-assistant/KitchenAssistantClient.jsx app/__tests__/KitchenAssistantClient.conversation.test.jsx
git commit -m "feat(lari): send assistant conversation session"
```

## Task 5: Focused Test Script And Existing Test Updates

**Files:**
- Modify: `package.json`
- Modify: any existing kitchen-assistant tests that fail only because their request body lacks `conversation_session_id`

- [ ] **Step 1: Add package script**

In `package.json` scripts, add:

```json
"test:kitchen-assistant-conversation": "node --experimental-strip-types --test tests/js/test-lari-conversation-memory.mjs tests/js/test-kitchen-assistant-conversation-memory.mjs && jest app/__tests__/KitchenAssistantClient.conversation.test.jsx --runInBand"
```

- [ ] **Step 2: Run focused suite**

Run:

```bash
npm run test:kitchen-assistant-conversation
```

Expected: PASS.

- [ ] **Step 3: Run existing kitchen assistant and schema gates**

Run:

```bash
npm run test:schema
npm run test:kitchen-assistant-datapack
npm run test:kitchen-assistant-usda-ingredients
npm run test:kitchen-assistant-citations
npm run test:db-query-tool
npm run test:cook-message-classifier
```

Expected: PASS.

- [ ] **Step 4: Run project policy checks**

Run:

```bash
bash scripts/ci/no-absolute-paths.sh --check
bash scripts/ci/no-cache-artifacts.sh
npm run typecheck
```

Expected: all PASS. If `typecheck` reports unrelated pre-existing failures, capture the exact failures and do not hide them.

- [ ] **Step 5: Commit if commit authority was granted**

```bash
git add package.json
git add tests/js/test-kitchen-assistant-*.mjs
git commit -m "test(lari): add conversation memory gates"
```

## Task 6: Final Review And Impact Detection

**Files:**
- No new code files unless previous tasks revealed a failing test that requires a narrowly scoped fix.

- [ ] **Step 1: Run GitNexus change detection**

Run:

```bash
npx gitnexus analyze
```

Then run the MCP `gitnexus_detect_changes()` equivalent or:

```bash
npx gitnexus detect-changes
```

Expected: affected symbols are limited to the Kitchen Assistant route/client, `lib/lariConversationMemory.ts`, `lib/db.ts` schema, and the new tests. If GitNexus CLI command names differ, use the MCP `mcp__gitnexus.detect_changes` tool with `scope="all"` and `repo="Lariat"`.

- [ ] **Step 2: Review unstaged diff**

Run:

```bash
git -c core.fsmonitor=false status --short
git -c core.fsmonitor=false diff -- app/api/kitchen-assistant/route.js app/kitchen-assistant/KitchenAssistantClient.jsx lib/lariConversationMemory.ts lib/db.ts tests/js/test-lari-conversation-memory.mjs tests/js/test-kitchen-assistant-conversation-memory.mjs app/__tests__/KitchenAssistantClient.conversation.test.jsx tests/js/test-schema-migrations.mjs package.json
```

Expected: no unrelated files in the feature diff. Pre-existing dirty files such as `.claude/settings.json` or `CLAUDE.md` should remain untouched and unstaged unless the user explicitly asks otherwise.

- [ ] **Step 3: Run final focused verification**

Run:

```bash
npm run test:kitchen-assistant-conversation
npm run test:schema
bash scripts/ci/no-absolute-paths.sh --check
bash scripts/ci/no-cache-artifacts.sh
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Prepare completion report**

Report:

```text
EXECUTION_REPORT:
- Files Modified:
- Lines Added:
- Lines Removed:
- Invariant Check:
- Determinism Impact:
- Runtime Coupling Introduced: NO
- GitNexus Impact:
- Verification:
```

Include whether commits were created or skipped due to missing explicit commit authority.
