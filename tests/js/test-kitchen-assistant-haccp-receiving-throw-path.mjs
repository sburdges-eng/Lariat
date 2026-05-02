#!/usr/bin/env node
// Pin the contract for the LLM-action `haccp_receive` catch path.
//
// Background — found via the 2026-05-01 breaker audit (Section 1, P2
// finding at docs/agentic/findings/2026-05-01-haccp-ka-llm-action-receiving-status-na-on-throw.md):
// when validateReceivingReading throws, the route used to write
// status='na' to line_check_entries. 'na' is reserved for items that
// genuinely don't apply at this station/shift; a thrown validator is a
// HACCP signal a manager must see, not a quiet skip. The fix is
// status='fail' (regulated red marker).
//
// validateReceivingReading does not throw on any input shape today
// (current main returns accept_with_note for unknown category and
// closed_loop_error for malformed qty/unit), so a runtime test of
// the catch path requires module-level mocking that node:test ESM
// doesn't reliably support across Node versions.
//
// Instead this is a static-source contract test on the
// haccp_receive action block. The block is small and stable; the
// test pins the constant. If a future refactor renames the action
// or rewrites the catch shape, this test fails loud and the auditor
// re-examines whether the HACCP red-marker contract still holds.
//
// Run: node --experimental-strip-types --test tests/js/test-kitchen-assistant-haccp-receiving-throw-path.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTE_PATH = path.resolve(__dirname, '../../app/api/kitchen-assistant/route.js');
const SRC = fs.readFileSync(ROUTE_PATH, 'utf-8');

function extractActionBlock(actionName) {
  // Capture from the matching `else if (payload.action === '<name>'`
  // up to the next `else if (payload.action ===` or the end of the
  // outer if-chain. Greedy enough for the small per-action blocks but
  // bounded by the next sibling action.
  const start = SRC.indexOf(`payload.action === '${actionName}'`);
  if (start === -1) return null;
  const tail = SRC.slice(start);
  const next = tail.search(/}\s*else if\s*\(\s*payload\.action\s*===/);
  return next === -1 ? tail : tail.slice(0, next);
}

describe('kitchen-assistant haccp_receive — validator-throw catch path', () => {
  it('haccp_receive action block exists in the route', () => {
    const block = extractActionBlock('haccp_receive');
    assert.ok(block, 'haccp_receive action block must exist');
  });

  it('catch path sets status to "fail" (regulated red marker)', () => {
    const block = extractActionBlock('haccp_receive');
    assert.match(
      block,
      /catch\s*\(\s*err\s*\)\s*\{[\s\S]*?status\s*=\s*'fail'/,
      "validator-throw catch path must set status='fail' so the cook's board surfaces the HACCP red marker",
    );
  });

  it('catch path does NOT set status to "na" (no-signal demote)', () => {
    const block = extractActionBlock('haccp_receive');
    // Only the catch path is the concern. The pass path uses ternaries
    // that include 'pass'/'fail' but never 'na' for the resolved case.
    const catchMatch = block.match(/catch\s*\(\s*err\s*\)\s*\{([\s\S]*?)\}/);
    assert.ok(catchMatch, 'catch block must be present');
    assert.doesNotMatch(
      catchMatch[1],
      /status\s*=\s*'na'/,
      "catch path must NOT set status='na' — that bypasses the HACCP yellow/red distinction",
    );
  });

  it('catch path preserves the validator error in the note', () => {
    const block = extractActionBlock('haccp_receive');
    assert.match(
      block,
      /Validation Error/,
      'catch path must include the validator message in the note so a manager can triage',
    );
  });
});
