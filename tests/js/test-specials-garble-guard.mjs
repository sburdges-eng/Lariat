#!/usr/bin/env node
// The specials sandbox shares buildGroundedContext and the model with the
// kitchen assistant, so it shares the 2026-08-31 failure: the model mimicked
// the CONTEXT's XML and looped, fabricating ingredients. Until now it ran
// neither sanitizeRenderedAnswer nor isDegenerateAnswer — it was the only
// unguarded LLM answer surface in the app.
//
// It matters more here than on the chat line. A chat answer scrolls away; a
// specials answer is saved (app/api/specials/saved/route.js stores ai_answer
// uncapped) and can be promoted into menu-item and vendor_ingredient rows via
// lib/specialsPromotion.ts. A fabricated ingredient list can reach the recipe
// book.
//
// Run:
//   node --experimental-strip-types --test tests/js/test-specials-garble-guard.mjs

import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-specials-garble-guard-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_ERROR = console.error;

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const route = await import('../../app/api/specials/route.js');
const { SPECIALS_GARBLED_COPY } = await import('../../lib/specialsShared.ts');

let modelContent = 'A pork belly special with pickled onion.';

after(() => {
  db.setDbPathForTest(null);
  globalThis.fetch = ORIGINAL_FETCH;
  console.error = ORIGINAL_CONSOLE_ERROR;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM idempotency_keys;');
  console.error = () => {};
  modelContent = 'A pork belly special with pickled onion.';
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/api/chat')) {
      return new Response(JSON.stringify({ message: { content: modelContent }, model: 'test-model' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not stubbed', { status: 404 });
  };
});

function postReq(message = 'Make a pork belly special') {
  return new Request('http://localhost/api/specials', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, location_id: 'default' }),
  });
}

// The incident shape: the model echoes the CONTEXT's markup and loops.
const XML_LOOP = Array(12).fill('<ingredient name="diced shallot" />').join('\n');

describe('/api/specials — degenerate model output never reaches a chef', () => {
  it('replaces a looping XML answer with the garbled copy', async () => {
    modelContent = XML_LOOP;
    const res = await route.POST(postReq());
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.answer, SPECIALS_GARBLED_COPY);
    assert.doesNotMatch(body.answer, /<ingredient/, 'no fabricated ingredient markup reaches the chef');
  });

  it('does not price a garbled generation', async () => {
    // A cost_special action riding along with looping prose: the ingredient
    // list came out of the same degenerate generation, so it must not be
    // costed. A deterministic price next to fabricated ingredients reads as
    // confirmation.
    modelContent =
      '```json\n' +
      JSON.stringify({
        action: 'cost_special',
        ingredients: [{ item: 'diced shallot', unit: 'cup', qty: 2 }],
      }) +
      '\n```\n' + XML_LOOP;

    const res = await route.POST(postReq('cost this special'));
    const body = await res.json();

    assert.equal(body.answer, SPECIALS_GARBLED_COPY);
    assert.equal(body.cost_total, null, 'no cost computed for a garbled generation');
    assert.equal(body.cost_breakdown, null);
    assert.doesNotMatch(body.answer, /COMPUTED RECIPE COST/);
  });

  it('strips a raw action block that survived into the prose', async () => {
    modelContent =
      'Try a pork belly bun.\n\n```json\n' +
      JSON.stringify({ action: 'not_a_known_action', foo: 'bar' }) +
      '\n```';
    const res = await route.POST(postReq());
    const body = await res.json();

    assert.ok(!/```/.test(body.answer), `fence leaked: ${body.answer}`);
    assert.ok(!/\{\s*"action"/.test(body.answer), `action object leaked: ${body.answer}`);
    assert.match(body.answer, /pork belly bun/, 'the real prose survives');
  });

  it('leaves an honest creative answer alone', async () => {
    modelContent =
      'Pork belly bun with pickled red onion.\n' +
      'Sub the brioche if the walk-in is short.\n' +
      'Hold the sauce on the side for the line.';
    const res = await route.POST(postReq());
    const body = await res.json();

    assert.equal(body.answer, modelContent);
    assert.doesNotMatch(body.answer, /came out garbled/);
  });

  it('leaves a long list-shaped R&D answer alone', async () => {
    // The specials sandbox runs CREATIVE_SYSTEM: its output is deliberately
    // longer and more list-shaped than a chat answer, which is exactly the
    // traffic profile the repeat signal used to false-positive on.
    modelContent = [
      'Six ways with pork belly:',
      '1. Bun with pickled onion — 2 hr braise.',
      '2. Burnt ends over grits — 4 hr smoke.',
      '3. Lardon in the chopped salad — quick render.',
      '4. Crispy cube with aji verde — fry to order.',
      '5. Belly banh mi with mexi slaw — cold line.',
      '6. Belly hash for brunch — hold hot.',
      'All six use the same cure. Ask a manager before you 86 the cure.',
    ].join('\n');
    const res = await route.POST(postReq('give me pork belly ideas'));
    const body = await res.json();

    assert.equal(body.answer, modelContent);
    assert.doesNotMatch(body.answer, /came out garbled/);
  });
});
