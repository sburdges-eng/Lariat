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
