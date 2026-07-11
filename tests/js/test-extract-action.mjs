#!/usr/bin/env node
// Pins the contract for the shared LLM action-JSON parser used by both
// /api/kitchen-assistant and /api/specials. Independent of either route's
// action-handler logic — exercises the parser surface only.
//
// The parser was duplicated byte-for-byte across both routes (see
// docs/audit/2026-05-08-codebase-audit.md §5). Extracting to
// lib/extractAction.ts means future fixes (nested-brace edge cases,
// escaped-quote handling, JSON.parse error mode tweaks) land in one
// place. This file pins behavior across that move.
//
// Run:
//   node --experimental-strip-types --test tests/js/test-extract-action.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { extractAction, stripFences, sanitizeRenderedAnswer } = await import('../../lib/extractAction');

describe('extractAction — shared LLM action-JSON parser', () => {
  it('returns null payload when content has no JSON object', () => {
    const result = extractAction('Just a regular answer.');
    assert.equal(result.payload, null);
    assert.equal(result.stripped, 'Just a regular answer.');
  });

  it('parses a fenced JSON action block and strips the fence + JSON from prose', () => {
    const content =
      '```json\n{"action":"eighty_six","item":"salmon"}\n```\nMarked salmon as 86.';
    const result = extractAction(content);
    assert.deepEqual(result.payload, { action: 'eighty_six', item: 'salmon' });
    // After stripping JSON + fences, only the prose remains (trimmed).
    assert.equal(result.stripped, 'Marked salmon as 86.');
  });

  it('parses an unfenced JSON action block', () => {
    const content =
      '{"action":"eighty_six","item":"salmon"}\nMarked salmon as 86.';
    const result = extractAction(content);
    assert.deepEqual(result.payload, { action: 'eighty_six', item: 'salmon' });
    assert.equal(result.stripped, 'Marked salmon as 86.');
  });

  it('handles nested JSON objects (depth tracking past inner braces)', () => {
    const content =
      '{"action":"beo_add_prep","recipes":[{"recipe_slug":"sauce"}]}\nQueued.';
    const result = extractAction(content);
    assert.deepEqual(result.payload, {
      action: 'beo_add_prep',
      recipes: [{ recipe_slug: 'sauce' }],
    });
    assert.equal(result.stripped, 'Queued.');
  });

  it('returns null payload when the JSON block is malformed', () => {
    const result = extractAction('{not valid json}');
    assert.equal(result.payload, null);
    // stripped still goes through stripFences on the raw content.
    assert.equal(typeof result.stripped, 'string');
  });

  it('returns null payload when the JSON object is missing the action field', () => {
    const result = extractAction('{"foo":"bar"}');
    assert.equal(result.payload, null);
  });

  it('returns null payload when action is non-string (e.g. number)', () => {
    const result = extractAction('{"action":42}');
    assert.equal(result.payload, null);
  });

  it('does not let a brace inside a string literal trip the depth counter', () => {
    const content = '{"action":"x","note":"hello { world}"}';
    const result = extractAction(content);
    assert.deepEqual(result.payload, { action: 'x', note: 'hello { world}' });
  });

  it('does not let an escaped quote inside a string close the string early', () => {
    // The string value contains an escaped quote followed by a `}`, which
    // should NOT close the outer JSON object early.
    const content = '{"action":"x","note":"a\\"b}"}';
    const result = extractAction(content);
    assert.deepEqual(result.payload, { action: 'x', note: 'a"b}' });
  });

  // ── KA v3: no raw JSON may survive into `stripped` (the cook-facing text) ──
  // The v2 flip leaked because the model emitted the action JSON TWICE and the
  // parser stripped only the first; the second block's braces rendered raw in
  // the answer panel. `stripped` must never contain a residual action object
  // or fence, regardless of how many the model emitted.

  it('strips a DOUBLE-emitted action block — the exact v2 leak', () => {
    const content =
      '```json\n{"action":"scale_recipe","recipe":"bacon_jam","multiplier":3}\n```\n' +
      'Scaled bacon jam ×3.\n' +
      '```json\n{"action":"scale_recipe","recipe":"bacon_jam","multiplier":3}\n```';
    const result = extractAction(content);
    // first action-bearing object is the payload
    assert.deepEqual(result.payload, {
      action: 'scale_recipe', recipe: 'bacon_jam', multiplier: 3,
    });
    // NOTHING JSON-shaped survives into the cook-facing text
    assert.ok(!/```/.test(result.stripped), `fence leaked: ${result.stripped}`);
    assert.ok(!/\{\s*"action"/.test(result.stripped), `2nd action object leaked: ${result.stripped}`);
    assert.equal(result.stripped, 'Scaled bacon jam ×3.');
  });

  it('strips a trailing unfenced second object too', () => {
    const content =
      '{"action":"eighty_six","item":"salmon"}\nMarked 86.\n{"action":"eighty_six","item":"salmon"}';
    const result = extractAction(content);
    assert.deepEqual(result.payload, { action: 'eighty_six', item: 'salmon' });
    assert.ok(!/\{\s*"action"/.test(result.stripped), `2nd object leaked: ${result.stripped}`);
    assert.equal(result.stripped, 'Marked 86.');
  });

  it('strips a non-action stray object that follows the payload', () => {
    const content =
      '{"action":"eighty_six","item":"salmon"}\nDone.\n{"debug":{"tokens":5}}';
    const result = extractAction(content);
    assert.deepEqual(result.payload, { action: 'eighty_six', item: 'salmon' });
    assert.ok(!/\{\s*"debug"/.test(result.stripped), `stray object leaked: ${result.stripped}`);
    assert.equal(result.stripped, 'Done.');
  });

  it('keeps the FIRST action-bearing object as payload even if a non-action object precedes it', () => {
    const content =
      '{"note":"preamble"}\n{"action":"eighty_six","item":"salmon"}\nMarked 86.';
    const result = extractAction(content);
    assert.deepEqual(result.payload, { action: 'eighty_six', item: 'salmon' });
    assert.ok(!/\{/.test(result.stripped), `object leaked: ${result.stripped}`);
    assert.equal(result.stripped, 'Marked 86.');
  });

  it('preserves prose punctuation/braces that are NOT JSON objects', () => {
    const content =
      '{"action":"eighty_six","item":"salmon"}\nUse a 1/2 pan (not a full).';
    const result = extractAction(content);
    assert.equal(result.stripped, 'Use a 1/2 pan (not a full).');
  });
});

describe('sanitizeRenderedAnswer — final UI guard', () => {
  it('leaves clean prose untouched', () => {
    assert.equal(sanitizeRenderedAnswer('Nothing is 86 today.'), 'Nothing is 86 today.');
  });

  it('removes a residual raw action block that survived into the answer (the v2 UI leak)', () => {
    const leaked =
      '⚡ ACTION EXECUTED: Scaled bacon jam ×3.\n\n```json\n{"action":"scale_recipe","recipe":"bacon_jam","multiplier":3}\n```';
    const clean = sanitizeRenderedAnswer(leaked);
    assert.ok(!/```/.test(clean), `fence leaked: ${clean}`);
    assert.ok(!/\{\s*"action"/.test(clean), `action object leaked: ${clean}`);
    assert.equal(clean, '⚡ ACTION EXECUTED: Scaled bacon jam ×3.');
  });

  it('preserves a rendered db_query table (pipes/braces that are not action JSON)', () => {
    const table = 'Here is what I found:\n| item | qty |\n|---|---|\n| chicken | 5 |';
    assert.equal(sanitizeRenderedAnswer(table), table);
  });

  it('preserves non-action JSON in the answer (db_query payload_json cell)', () => {
    const answer =
      'Recent audit events:\n| when | payload |\n|---|---|\n| 09:14 | {"qty": 3, "unit": "case"} |';
    assert.equal(sanitizeRenderedAnswer(answer), answer);
  });

  it('strips only the action block when the answer also carries non-action JSON', () => {
    const mixed =
      'Scaled it.\n{"action":"scale_recipe","recipe":"bacon_jam","multiplier":3}\nRaw row: {"qty": 3}';
    const clean = sanitizeRenderedAnswer(mixed);
    assert.ok(!/"action"/.test(clean), `action object leaked: ${clean}`);
    assert.ok(clean.includes('{"qty": 3}'), `non-action JSON was stripped: ${clean}`);
  });

  it('is a no-op on empty input', () => {
    assert.equal(sanitizeRenderedAnswer(''), '');
  });
});

describe('stripFences', () => {
  it('removes ```json …``` markdown fences and trims', () => {
    assert.equal(stripFences('```json\nhello\n```'), 'hello');
  });

  it('removes plain ``` … ``` markdown fences and trims', () => {
    assert.equal(stripFences('```\nhello\n```'), 'hello');
  });

  it('leaves prose without fences alone (modulo trim)', () => {
    assert.equal(stripFences('  hello world  '), 'hello world');
  });
});
