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
  classifyBusyDay,
  weekdayShortFromISO,
  addDaysISO,
  OPS_DAYPARTS,
  regulatedBoardFor,
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

describe('isStepLate across the service-day boundary', () => {
  // The venue day runs 02:00 to 02:00, so between midnight and 02:00 the board
  // is still on the shift that opened yesterday afternoon — and that is exactly
  // when the closing steps are still open. Comparing raw wall-clock minutes
  // makes now (00:30 -> 30) smaller than every due time on the shift, so TPHC,
  // cooling, date-mark and cleaning steps all stopped reading late during close.
  it('keeps a late-evening step late after midnight', () => {
    const at0030 = 30; // 00:30 venue time
    assert.equal(
      isStepLate({ status: 'todo', due_time: '23:45' }, at0030),
      true,
      'a 23:45 step unfinished at 00:30 is late, not early',
    );
  });

  it('keeps a morning step late after midnight', () => {
    assert.equal(isStepLate({ status: 'todo', due_time: '08:00' }, 30), true);
  });

  it('still reads correctly inside the ordinary daytime shift', () => {
    assert.equal(isStepLate({ status: 'todo', due_time: '08:00' }, 7 * 60), false);
    assert.equal(isStepLate({ status: 'todo', due_time: '08:00' }, 8 * 60 + 1), true);
  });

  it('treats 02:00 as the start of the next shift, not the end of this one', () => {
    // 01:59 is the last minute of the service day: a 23:45 step is still late.
    assert.equal(isStepLate({ status: 'todo', due_time: '23:45' }, 1 * 60 + 59), true);
    // 02:01 is a fresh shift; nothing due later today is late yet.
    assert.equal(isStepLate({ status: 'todo', due_time: '23:45' }, 2 * 60 + 1), false);
    assert.equal(isStepLate({ status: 'todo', due_time: '08:00' }, 2 * 60 + 1), false);
  });

  it('never marks a step the cook closed', () => {
    assert.equal(isStepLate({ status: 'done', due_time: '23:45' }, 30), false);
    assert.equal(isStepLate({ status: 'skipped', due_time: '23:45' }, 30), false);
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

  it('does not mark a future or past plan late when shift_date differs from today', () => {
    const pastDue = { status: 'todo', due_time: '07:30', shift_date: '2026-08-10' };
    const future = { status: 'todo', due_time: '07:30', shift_date: '2026-08-20' };
    const noon = 12 * 60;
    assert.equal(isStepLate(pastDue, noon, '2026-08-15'), false);
    assert.equal(isStepLate(future, noon, '2026-08-15'), false);
  });

  it('still marks today\'s plan late when shift_date matches the service day', () => {
    const step = { status: 'todo', due_time: '07:30', shift_date: '2026-08-15' };
    assert.equal(isStepLate(step, 8 * 60, '2026-08-15'), true);
    assert.equal(isStepLate(step, 7 * 60, '2026-08-15'), false);
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

describe('classifyBusyDay', () => {
  it('flags top weekdays and heavy banquet covers', () => {
    const quiet = classifyBusyDay({
      weekday: 'Tue',
      dowGuests: 80,
      dowRankByGuests: 5,
      beoGuestsToday: 0,
      beoGuestsWindow: 0,
      bookedCovers: 10,
    });
    assert.equal(quiet.busy, false);

    const busy = classifyBusyDay({
      weekday: 'Sat',
      dowGuests: 200,
      dowRankByGuests: 1,
      beoGuestsToday: 120,
      beoGuestsWindow: 120,
      bookedCovers: 50,
    });
    assert.equal(busy.busy, true);
    assert.ok(busy.reasons.some((r) => /usually busy/.test(r)));
    assert.ok(busy.reasons.some((r) => /Banquet today/.test(r)));
  });

  it('addDaysISO and weekdayShortFromISO are stable', () => {
    assert.equal(addDaysISO('2099-06-15', 3), '2099-06-18');
    // 2099-06-15 is a Monday in the civil calendar.
    assert.equal(weekdayShortFromISO('2099-06-15'), 'Mon');
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

describe('augustChecklistForDate', () => {
  it('emits daily + Wed weekly on Aug 12, and monthly on Aug 16', async () => {
    const { augustChecklistForDate } = await import('../../lib/augustChecklists2026.ts');
    const wed = augustChecklistForDate('2026-08-12', 'Wed');
    assert.ok(wed.some((i) => i.cadence === 'daily'));
    assert.ok(wed.some((i) => i.cadence === 'weekly' && /Wed/.test(i.title)));
    assert.ok(!wed.some((i) => i.cadence === 'monthly'));

    const sun = augustChecklistForDate('2026-08-16', 'Sun');
    assert.ok(sun.some((i) => i.cadence === 'monthly'));
    assert.ok(sun.some((i) => i.cadence === 'weekly'));

    assert.equal(augustChecklistForDate('2026-07-01', 'Wed').length, 0);
  });

  it('emits Aug 23 makeup monthly only when the Aug 16 target is incomplete', async () => {
    const { augustChecklistForDate } = await import('../../lib/augustChecklists2026.ts');
    const makeupOpen = augustChecklistForDate('2026-08-23', 'Sun', {
      monthlyTargetComplete: false,
    });
    assert.ok(
      makeupOpen.some((i) => i.cadence === 'monthly'),
      'makeup fires when Aug 16 monthly work is still open',
    );

    const makeupDone = augustChecklistForDate('2026-08-23', 'Sun', {
      monthlyTargetComplete: true,
    });
    assert.ok(
      !makeupDone.some((i) => i.cadence === 'monthly'),
      'makeup stays off when Aug 16 monthly work is finished',
    );
  });
});

describe('regulatedBoardFor — the gate must be true and satisfiable', () => {
  it('scopes a real per-station row to that station', () => {
    const board = regulatedBoardFor('line-check-grill');
    assert.equal(board.board, 'station_signoffs');
    assert.equal(board.station_id, 'grill');
  });

  it('never invents a station id from the roll-up row', () => {
    // materializeLineChecks emits a non-station summary row. While it was
    // keyed `line-check-rollup-<date>` it matched the station prefix, so the
    // gate looked for a sign-off by station 'rollup-2026-01-01' — an id that
    // can never exist, since they come from getStations(). Done and Skip both
    // returned "No station signed off this shift. Sign one off first.",
    // which was false whenever any station had signed off, and a cook on a
    // red row just kept tapping.
    for (const key of ['line-check-rollup-2026-01-01', 'line-checks-open-2026-01-01']) {
      const board = regulatedBoardFor(key);
      if (board) {
        assert.notEqual(board.station_id, 'rollup-2026-01-01');
        assert.notEqual(board.station_id, '2026-01-01');
      }
    }
  });

  it('gates the roll-up on the whole pass, the way the template step does', () => {
    const board = regulatedBoardFor('line-checks-open-2026-01-01');
    assert.equal(board.board, 'station_signoffs');
    assert.equal(board.station_id, undefined, 'the roll-up stands for the pass, not one station');
  });

  it('gates a named cleaning task on the cleaning log', () => {
    // The vague roll-up (close-cleaning-due) demanded a cleaning_log row while
    // the specific named task an inspector would actually ask about did not:
    // a cook cleared "Hood — Degrease" with nothing written to the log.
    for (const key of ['clean-sched-12', 'aug-daily-line-2026-08-29', 'aug-monthly-floors-2026-08-29']) {
      const board = regulatedBoardFor(key);
      assert.ok(board, `${key} must be gated`);
      assert.equal(board.board, 'cleaning_log');
      assert.equal(board.date_column, 'shift_date');
      assert.equal(board.station_id, undefined,
        'CleaningBoard never sends schedule_id, so a scoped gate would never be satisfiable');
    }
  });

  it('leaves the gear row to the equipment board, not the cleaning log', () => {
    // aug-monthly-gear links to /equipment, not /food-safety/cleaning.
    assert.equal(regulatedBoardFor('aug-monthly-gear-2026-08-29'), null);
  });

  it('leaves ordinary work ungated', () => {
    assert.equal(regulatedBoardFor('prep-task-7'), null);
    assert.equal(regulatedBoardFor('beo-event-3'), null);
    assert.equal(regulatedBoardFor(''), null);
    assert.equal(regulatedBoardFor(null), null);
  });
});

describe('rollupOpsSteps — lateness belongs to the service day being shown', () => {
  it('reports nothing late for a day that is not the current service day', () => {
    // The row render (DayPlanBoard.jsx:245) passes serviceDate() to
    // isStepLate, so a past day's rows carry no Late mark. Both roll-ups
    // called rollupOpsSteps(steps, nowMin) with no third argument, so the
    // banner and the per-daypart counters went red above rows that did not.
    const steps = [
      { daypart: 'open', step_key: 'a', title: 'Temps', status: 'todo', due_time: '07:00', shift_date: '2026-07-04' },
      { daypart: 'side_work', step_key: 'b', title: 'Close', status: 'todo', due_time: '23:00', shift_date: '2026-07-04' },
    ];
    const rollup = rollupOpsSteps(steps, 23 * 60 + 59, '2026-08-29');
    assert.equal(rollup.late, 0, 'a past service day cannot be running late');
    assert.equal(rollup.by_daypart.open.late, 0);
    assert.equal(rollup.todo, 2, 'the work is still outstanding, it just is not late');
  });

  it('still counts late on the day being worked', () => {
    const steps = [
      { daypart: 'open', step_key: 'a', title: 'Temps', status: 'todo', due_time: '07:00', shift_date: '2026-08-29' },
    ];
    assert.equal(rollupOpsSteps(steps, 10 * 60, '2026-08-29').late, 1);
  });
});
