#!/usr/bin/env node
// Pure-rule tests for lib/opsRun.ts (day-plan / side-work spine).
//
// Run: npx -y node@24 --experimental-strip-types --test tests/js/test-ops-run-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const {
  parseDueMinutes,
  isStepLate,
  rollupOpsSteps,
  validateOpsStepInput,
  opsLateAlertMessage,
  opsOpenAlertMessage,
  houseOpsTemplateSeeds,
  OPS_DAYPARTS,
} = await import('../../lib/opsRun.ts');

describe('parseDueMinutes', () => {
  it('parses HH:MM', () => {
    assert.equal(parseDueMinutes('07:30'), 7 * 60 + 30);
    assert.equal(parseDueMinutes('23:00'), 23 * 60);
    assert.equal(parseDueMinutes('0:05'), 5);
  });

  it('rejects junk', () => {
    assert.equal(parseDueMinutes(''), null);
    assert.equal(parseDueMinutes('25:00'), null);
    assert.equal(parseDueMinutes('noon'), null);
    assert.equal(parseDueMinutes(null), null);
  });
});

describe('isStepLate', () => {
  it('marks open past-due steps late', () => {
    assert.equal(isStepLate({ status: 'todo', due_time: '08:00' }, 8 * 60 + 1), true);
    assert.equal(isStepLate({ status: 'todo', due_time: '08:00' }, 8 * 60), false);
  });

  it('never marks done or skipped late', () => {
    assert.equal(isStepLate({ status: 'done', due_time: '08:00' }, 12 * 60), false);
    assert.equal(isStepLate({ status: 'skipped', due_time: '08:00' }, 12 * 60), false);
  });

  it('needs a due_time', () => {
    assert.equal(isStepLate({ status: 'todo', due_time: null }, 12 * 60), false);
  });
});

describe('rollupOpsSteps', () => {
  it('counts todo/done/late by daypart', () => {
    const rollup = rollupOpsSteps(
      [
        { daypart: 'open', step_key: 'a', title: 'Temps', status: 'todo', due_time: '07:00' },
        { daypart: 'open', step_key: 'b', title: 'Sani', status: 'done', due_time: '07:30' },
        { daypart: 'side_work', step_key: 'c', title: 'Close', status: 'todo', due_time: '23:00' },
        { daypart: 'prep', step_key: 'd', title: 'Mise', status: 'skipped', due_time: null },
      ],
      10 * 60, // 10:00a
    );
    assert.equal(rollup.todo, 2);
    assert.equal(rollup.done, 1);
    assert.equal(rollup.skipped, 1);
    assert.equal(rollup.late, 1);
    assert.equal(rollup.by_daypart.open.late, 1);
    assert.equal(rollup.by_daypart.open.done, 1);
    assert.equal(rollup.by_daypart.side_work.todo, 1);
    assert.equal(rollup.by_daypart.side_work.late, 0);
  });
});

describe('validateOpsStepInput', () => {
  it('accepts house dayparts and statuses', () => {
    assert.equal(validateOpsStepInput({ daypart: 'side_work', title: 'Wipe', status: 'done' }).ok, true);
  });

  it('rejects blank title and bad daypart', () => {
    assert.equal(validateOpsStepInput({ title: '   ' }).ok, false);
    assert.equal(validateOpsStepInput({ daypart: 'closing' }).ok, false);
    assert.equal(validateOpsStepInput({ due_time: '25:99' }).ok, false);
  });
});

describe('alert copy', () => {
  it('uses kitchen plain English', () => {
    assert.equal(opsLateAlertMessage(1), '1 day-plan step is late');
    assert.equal(opsLateAlertMessage(3), '3 day-plan steps are late');
    assert.equal(opsOpenAlertMessage(2), '2 day-plan steps still open');
  });
});

describe('houseOpsTemplateSeeds', () => {
  it('covers every daypart with deep links', () => {
    const seeds = houseOpsTemplateSeeds();
    const parts = new Set(seeds.map((s) => s.daypart));
    for (const d of OPS_DAYPARTS) assert.ok(parts.has(d), `missing ${d}`);
    const steps = seeds.flatMap((s) => s.steps);
    assert.ok(steps.length >= 10);
    assert.ok(steps.every((s) => s.step_key && s.title));
    assert.ok(steps.some((s) => s.link_href === '/prep'));
    assert.ok(steps.some((s) => s.link_href === '/food-safety/cleaning'));
    assert.ok(steps.some((s) => s.link_href === '/equipment'));
  });
});
