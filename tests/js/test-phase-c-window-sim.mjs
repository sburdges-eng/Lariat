#!/usr/bin/env node
// CI guard for scripts/phase-c-reconcile-simulate.mjs — proves the §C4
// reconciliation-window tooling behaves correctly across simulated time:
// every nightly run stays green while past-day money checksums lock and today
// stays exempt, and every adversarial case (retroactive money edit, bad /
// missing actor_source, un-audited mutation) is caught. Deterministic — no
// real clock, no data/lariat.db.
//
// Run: node --test tests/js/test-phase-c-window-sim.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, SERVICE_DAYS } from '../../scripts/phase-c-reconcile-simulate.mjs';

const result = simulate({ verbose: false });

describe('phase-c reconciliation window simulation', () => {
  it('runs all 8 service days', () => {
    assert.equal(result.nights.length, 8);
    assert.deepEqual(result.nights.map((n) => n.day), SERVICE_DAYS);
  });

  it('every nightly run stays GREEN across the window', () => {
    for (const n of result.nights) {
      assert.equal(n.pass, true, `night ${n.day} failed: ${n.fails.join(', ')}`);
      assert.deepEqual(n.fails, []);
    }
  });

  it('locks one more past day each night (today stays exempt)', () => {
    // Day k has k prior days locked in the money snapshot; the current day is
    // still being written and is never snapshotted.
    assert.deepEqual(result.nights.map((n) => n.lockedDays), [0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('injected numbers accumulate deterministically', () => {
    // tips grow +375¢/day (k*250 + k*125); POS net +$10k/day, both stable.
    assert.equal(result.nights[0].tipCents, 25000);
    assert.equal(result.nights[7].tipCents, 25000 + 7 * 375);
    assert.equal(result.nights[0].salesUsd, 500042.5);
    assert.equal(result.nights[7].salesUsd, 570042.5);
  });

  it('catches a retroactive edit of a locked past day', () => {
    assert.equal(result.adversarial.pastDayTamper.caught, true);
    assert.match(result.adversarial.pastDayTamper.detail, /past-day drift/);
  });

  it('catches a non-canonical actor_source', () => {
    assert.equal(result.adversarial.nonCanonicalActor.caught, true);
    assert.match(result.adversarial.nonCanonicalActor.detail, /rogue_writer/);
  });

  it('catches an unattributed (empty actor_source) write', () => {
    assert.equal(result.adversarial.unattributedWrite.caught, true);
  });

  it('catches an un-audited regulated mutation', () => {
    assert.equal(result.adversarial.unauditedMutation.caught, true);
    assert.match(result.adversarial.unauditedMutation.detail, /orphan/);
  });
});
