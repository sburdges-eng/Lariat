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

const { extractAction, stripFences } = await import('../../lib/extractAction');

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
