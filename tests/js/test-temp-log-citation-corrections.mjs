#!/usr/bin/env node
// Audit corrections (2026-05-08, §2 HACCP MEDIUM) for lib/tempLog.ts.
//
// Two issues bundled here because they live in the same file:
//
//  1. `hot_hold` carried the parenthetical "(house policy 140)" inside a
//     machine-read citation string. An inspector pulling citations
//     programmatically saw "≥ 135°F" in the text but `required_min_f: 140`
//     in the constant. The canonical form puts both numbers in a
//     semicolon-separated, machine-parseable shape.
//
//  2. `cook_eggs` shared `CCP-5` with `cook_ground_beef`. Shell eggs
//     (§3-401.11(A)(2)) and comminuted meat are different CCP categories.
//     `cook_eggs` is now `CCP-5e` so an inspector grouping the tile by
//     CCP no longer conflates them.
//
// Run: node --test tests/js/test-temp-log-citation-corrections.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { TempPoints, getTempPoint } from '../../lib/tempLog.ts';

describe('hot_hold citation is canonical (no informal parenthetical)', () => {
  it('mentions §3-501.16(A)(1), the FDA floor 135°F, and the house floor 140°F', () => {
    const p = getTempPoint('hot_hold');
    assert.ok(p, 'hot_hold must exist');
    // Canonical form: "FDA §3-501.16(A)(1) — hot-hold ≥ 135°F; house floor raised to 140°F"
    assert.match(
      p.citation,
      /§3-501\.16\(A\)\(1\).*135°F.*140°F/,
      `hot_hold citation must reference §3-501.16(A)(1) and both 135°F and 140°F: ${p.citation}`,
    );
  });

  it('does NOT use the informal "(house policy" parenthetical', () => {
    const p = getTempPoint('hot_hold');
    assert.ok(p);
    assert.doesNotMatch(
      p.citation,
      /\(house policy/i,
      `hot_hold citation must not embed "(house policy ...)" — it is informal copy in a machine-read constant: ${p.citation}`,
    );
  });

  it('hot_hold required_min_f stays pinned at 140°F (this PR is citation-only)', () => {
    const p = getTempPoint('hot_hold');
    assert.ok(p);
    assert.strictEqual(p.required_min_f, 140);
  });
});

describe('cook_eggs has a distinct CCP id from cook_ground_beef', () => {
  it('cook_eggs is CCP-5e (egg-specific subgroup)', () => {
    const p = getTempPoint('cook_eggs');
    assert.ok(p, 'cook_eggs must exist');
    assert.strictEqual(p.ccp_id, 'CCP-5e');
  });

  it('cook_ground_beef stays CCP-5 (unchanged)', () => {
    const p = getTempPoint('cook_ground_beef');
    assert.ok(p, 'cook_ground_beef must exist');
    assert.strictEqual(p.ccp_id, 'CCP-5');
  });

  it('cook_eggs.required_min_f is still 155°F (threshold unchanged — regression guard)', () => {
    const p = getTempPoint('cook_eggs');
    assert.ok(p);
    assert.strictEqual(p.required_min_f, 155);
  });
});

describe('TempPoints CCP id partition is locked (no accidental re-collision)', () => {
  // Whitelist of intentionally-shared CCP ids. Each entry is a CCP id
  // mapped to the set of point ids that legitimately share it. Any
  // future re-collision (e.g. someone adds a new point under CCP-5
  // alongside cook_ground_beef) will fail this test and force a
  // conscious choice — either subgroup the new point or update the map.
  const SHARED_OK = new Map([
    // Receiving covers both refrigerated and frozen deliveries.
    ['CCP-1', new Set(['receiving_cold', 'receiving_frozen'])],
    // Cold-hold covers walk-in + reach-in.
    ['CCP-2', new Set(['walk_in_cooler', 'reach_in_cooler'])],
    // Whole-muscle proteins (fish, pork, beef steak) all share §3-401.11(A)(1).
    ['CCP-6', new Set(['cook_fish', 'cook_pork', 'cook_beef_steak'])],
  ]);

  it('every CCP id is either unique or in the whitelist', () => {
    const byCcp = new Map();
    for (const p of TempPoints) {
      const list = byCcp.get(p.ccp_id) ?? [];
      list.push(p.id);
      byCcp.set(p.ccp_id, list);
    }
    for (const [ccp, ids] of byCcp) {
      if (ids.length === 1) continue;
      const allowed = SHARED_OK.get(ccp);
      assert.ok(
        allowed,
        `CCP ${ccp} is shared by ${ids.join(', ')} but is not in the SHARED_OK whitelist`,
      );
      for (const id of ids) {
        assert.ok(
          allowed.has(id),
          `point ${id} unexpectedly shares ${ccp} (whitelist allows: ${[...allowed].join(', ')})`,
        );
      }
    }
  });

  it('cook_ground_beef is the ONLY point on CCP-5', () => {
    const onCcp5 = TempPoints.filter((p) => p.ccp_id === 'CCP-5').map((p) => p.id);
    assert.deepStrictEqual(onCcp5, ['cook_ground_beef']);
  });
});
