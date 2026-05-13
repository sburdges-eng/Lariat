#!/usr/bin/env node
// Pure-rule tests for lib/lariPredictions.ts.
// Run: node --experimental-strip-types --test tests/js/test-lari-predictions-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const m = await import('../../lib/lariPredictions.ts');
const {
  isValidSeverity,
  normalizePrediction,
  sortBySeverity,
  trimPredictions,
  buildBeoPredictions,
  buildSoundPredictions,
  buildHostPredictions,
  daysUntil,
} = m;

describe('isValidSeverity', () => {
  it('accepts ok / warn / alert', () => {
    for (const s of ['ok', 'warn', 'alert']) assert.equal(isValidSeverity(s), true);
  });
  it('rejects anything else', () => {
    for (const s of ['critical', 'info', 'WARN', '', null, undefined, 1]) {
      assert.equal(isValidSeverity(s), false);
    }
  });
});

describe('normalizePrediction', () => {
  const base = { id: 't1', surface: 'beo', severity: 'warn', text: 'sample' };

  it('returns a clean prediction on a valid input', () => {
    const out = normalizePrediction(base);
    assert.deepEqual(out, { id: 't1', surface: 'beo', severity: 'warn', text: 'sample' });
  });

  it('returns null when id, surface, severity, or text is missing/blank', () => {
    for (const key of ['id', 'surface', 'severity', 'text']) {
      const bad = { ...base, [key]: '' };
      assert.equal(normalizePrediction(bad), null, `blank ${key} should reject`);
    }
    for (const key of ['id', 'surface', 'text']) {
      const { [key]: _drop, ...rest } = base;
      assert.equal(normalizePrediction(rest), null, `missing ${key} should reject`);
    }
  });

  it('returns null on non-object input', () => {
    for (const v of [null, undefined, 'string', 42, []]) {
      assert.equal(normalizePrediction(v), null);
    }
  });

  it('rejects invalid severity', () => {
    assert.equal(normalizePrediction({ ...base, severity: 'critical' }), null);
  });

  it('clips long text to 240 chars', () => {
    const longText = 'x'.repeat(500);
    const out = normalizePrediction({ ...base, text: longText });
    assert.equal(out.text.length, 240);
  });

  it('clips action to 80 chars', () => {
    const out = normalizePrediction({ ...base, action: 'y'.repeat(200) });
    assert.equal(out.action.length, 80);
  });

  it('preserves optional fields when present and non-blank', () => {
    const out = normalizePrediction({ ...base, action: 'open', source: 'beo_events:5', for_role: 'pic' });
    assert.equal(out.action, 'open');
    assert.equal(out.source, 'beo_events:5');
    assert.equal(out.for_role, 'pic');
  });

  it('drops optional fields when blank or wrong type', () => {
    const out = normalizePrediction({ ...base, action: '   ', source: 42, for_role: '' });
    assert.equal(out.action, undefined);
    assert.equal(out.source, undefined);
    assert.equal(out.for_role, undefined);
  });
});

describe('sortBySeverity', () => {
  const make = (id, severity, text = 'x') => ({ id, surface: 'beo', severity, text });

  it('orders alert before warn before ok', () => {
    const out = sortBySeverity([make('a', 'ok'), make('b', 'alert'), make('c', 'warn')]);
    assert.deepEqual(out.map((p) => p.id), ['b', 'c', 'a']);
  });

  it('tie-breaks longer text first within a severity', () => {
    const out = sortBySeverity([
      make('short', 'alert', 'aa'),
      make('long', 'alert', 'aaaaaaa'),
      make('mid', 'alert', 'aaaa'),
    ]);
    assert.deepEqual(out.map((p) => p.id), ['long', 'mid', 'short']);
  });

  it('returns [] on non-array input', () => {
    assert.deepEqual(sortBySeverity(null), []);
    assert.deepEqual(sortBySeverity('x'), []);
  });

  it('does not mutate the input', () => {
    const list = [make('a', 'ok'), make('b', 'alert')];
    sortBySeverity(list);
    assert.equal(list[0].id, 'a');
    assert.equal(list[1].id, 'b');
  });
});

describe('trimPredictions', () => {
  const fill = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, surface: 'beo', severity: 'warn', text: `t${i}` }));

  it('defaults to 5', () => {
    assert.equal(trimPredictions(fill(10)).length, 5);
  });

  it('honors explicit cap', () => {
    assert.equal(trimPredictions(fill(10), 3).length, 3);
  });

  it('clamps negative cap to 0', () => {
    assert.equal(trimPredictions(fill(3), -1).length, 0);
  });
});

describe('daysUntil', () => {
  it('returns 0 for identical dates', () => {
    assert.equal(daysUntil('2026-05-13', '2026-05-13'), 0);
  });
  it('returns positive for end > start', () => {
    assert.equal(daysUntil('2026-05-13', '2026-05-20'), 7);
  });
  it('returns negative for end < start', () => {
    assert.equal(daysUntil('2026-05-20', '2026-05-13'), -7);
  });
  it('returns -1 on unparseable input', () => {
    assert.equal(daysUntil('not-a-date', '2026-05-13'), -1);
    assert.equal(daysUntil('2026-05-13', '2026/5/13'), -1);
  });
});

describe('buildBeoPredictions', () => {
  const TODAY = '2026-05-13';
  const baseInputs = () => ({ events: [], lineItems: [], prepTasks: [], today: TODAY });

  it('returns [] when no events', () => {
    assert.deepEqual(buildBeoPredictions(baseInputs()), []);
  });

  it('emits ALERT for event tonight with no contact_name', () => {
    const inputs = {
      ...baseInputs(),
      events: [{ id: 1, title: 'Hendricks Wedding', event_date: TODAY, event_time: '5pm', contact_name: null, guest_count: 80, notes: null }],
    };
    const out = buildBeoPredictions(inputs);
    const alert = out.find((p) => p.id === 'beo-missing-contact-1');
    assert.ok(alert, 'missing-contact alert should be present');
    assert.equal(alert.severity, 'alert');
    assert.match(alert.text, /Hendricks Wedding/);
  });

  it('emits ALERT for overdue prep_task', () => {
    const inputs = {
      ...baseInputs(),
      events: [{ id: 7, title: 'Smith Bar Mitzvah', event_date: '2026-05-20', event_time: null, contact_name: 'Sam', guest_count: 50, notes: null }],
      prepTasks: [{ id: 99, event_id: 7, task: 'order linens', due_date: '2026-05-10', done: 0 }],
    };
    const out = buildBeoPredictions(inputs);
    const alert = out.find((p) => p.id === 'beo-overdue-task-99');
    assert.ok(alert, 'overdue-task alert should be present');
    assert.equal(alert.severity, 'alert');
    assert.match(alert.text, /order linens/);
  });

  it('does NOT emit overdue alert for done prep_task', () => {
    const inputs = {
      ...baseInputs(),
      events: [{ id: 7, title: 'Done Event', event_date: '2026-05-20', event_time: null, contact_name: 'Sam', guest_count: 50, notes: null }],
      prepTasks: [{ id: 99, event_id: 7, task: 'order linens', due_date: '2026-05-10', done: 1 }],
    };
    const out = buildBeoPredictions(inputs);
    assert.equal(out.find((p) => p.id === 'beo-overdue-task-99'), undefined);
  });

  it('emits WARN for today’s event with <3 lines and >20 guests', () => {
    const inputs = {
      ...baseInputs(),
      events: [{ id: 3, title: 'Big Party', event_date: TODAY, event_time: null, contact_name: 'Jamie', guest_count: 80, notes: null }],
      lineItems: [
        { id: 1, event_id: 3, item_name: 'Brisket', quantity: 80 },
        { id: 2, event_id: 3, item_name: 'Salad', quantity: 80 },
      ],
    };
    const out = buildBeoPredictions(inputs);
    const warn = out.find((p) => p.id === 'beo-thin-menu-3');
    assert.ok(warn);
    assert.equal(warn.severity, 'warn');
    assert.match(warn.text, /only 2 line items for 80 guests/);
  });

  it('emits WARN for upcoming event (within 7d) with zero line items', () => {
    const inputs = {
      ...baseInputs(),
      events: [{ id: 9, title: 'Tomorrow Event', event_date: '2026-05-14', event_time: null, contact_name: 'X', guest_count: 30, notes: null }],
    };
    const out = buildBeoPredictions(inputs);
    const warn = out.find((p) => p.id === 'beo-empty-menu-9');
    assert.ok(warn);
    assert.equal(warn.severity, 'warn');
    assert.match(warn.text, /no menu yet/);
  });

  it('does NOT emit empty-menu warn for events > 7 days out', () => {
    const inputs = {
      ...baseInputs(),
      events: [{ id: 10, title: 'Far Future', event_date: '2026-08-13', event_time: null, contact_name: 'X', guest_count: 30, notes: null }],
    };
    const out = buildBeoPredictions(inputs);
    assert.equal(out.find((p) => p.id === 'beo-empty-menu-10'), undefined);
  });

  it('emits OK rollup with count of upcoming-7d events', () => {
    const inputs = {
      ...baseInputs(),
      events: [
        { id: 1, title: 'E1', event_date: '2026-05-14', event_time: null, contact_name: 'A', guest_count: 10, notes: null },
        { id: 2, title: 'E2', event_date: '2026-05-18', event_time: null, contact_name: 'B', guest_count: 10, notes: null },
      ],
      lineItems: [
        { id: 1, event_id: 1, item_name: 'a', quantity: 10 },
        { id: 2, event_id: 2, item_name: 'b', quantity: 10 },
      ],
    };
    const out = buildBeoPredictions(inputs);
    const rollup = out.find((p) => p.id === `beo-upcoming-rollup-${TODAY}`);
    assert.ok(rollup);
    assert.equal(rollup.severity, 'ok');
    assert.match(rollup.text, /2 BEOs in the next 7 days/);
  });

  it('caps total output at 5 by trimPredictions', () => {
    const events = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      title: `E${i + 1}`,
      event_date: TODAY,
      event_time: null,
      contact_name: null,        // each will fire an alert
      guest_count: 10,
      notes: null,
    }));
    const out = buildBeoPredictions({ events, lineItems: [], prepTasks: [], today: TODAY });
    assert.equal(out.length, 5);
    for (const p of out) assert.equal(p.severity, 'alert');
  });

  it('ids are stable for the same input (no churn across polls)', () => {
    const inputs = {
      ...baseInputs(),
      events: [{ id: 1, title: 'X', event_date: TODAY, event_time: null, contact_name: null, guest_count: 50, notes: null }],
    };
    const a = buildBeoPredictions(inputs);
    const b = buildBeoPredictions(inputs);
    assert.deepEqual(a.map((p) => p.id), b.map((p) => p.id));
  });
});

describe('buildSoundPredictions', () => {
  const TODAY = '2026-05-13';
  const baseInputs = () => ({
    show_id: 42,
    band_name: 'The Stand',
    scenes: [],
    spl_summary: null,
    today: TODAY,
  });

  it('returns [] when scenes is not an array', () => {
    assert.deepEqual(buildSoundPredictions({ ...baseInputs(), scenes: null }), []);
    assert.deepEqual(buildSoundPredictions({ ...baseInputs(), scenes: 'oops' }), []);
  });

  it('returns just a warn when no scene + no readings', () => {
    const out = buildSoundPredictions(baseInputs());
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'sound-no-scene-42');
    assert.equal(out[0].severity, 'warn');
    assert.match(out[0].text, /No sound scene saved yet for "The Stand"/);
  });

  it('emits ALERT when over_limit_count > 0', () => {
    const inputs = {
      ...baseInputs(),
      scenes: [{ id: 5, scene_name: 'Mix A', spl_limit_db: 100, plot: { channels: [{}] }, saved_at: '' }],
      spl_summary: { count: 50, latest: 102, peak: 105, over_limit_count: 3, limit_db: 100 },
    };
    const out = buildSoundPredictions(inputs);
    const alert = out.find((p) => p.id === 'sound-over-limit-42');
    assert.ok(alert);
    assert.equal(alert.severity, 'alert');
    assert.match(alert.text, /3 readings/);
  });

  it('emits ALERT (running blind) when peak ≥ 100 and no scene saved', () => {
    const inputs = {
      ...baseInputs(),
      spl_summary: { count: 12, latest: 102, peak: 103, over_limit_count: 0, limit_db: null },
    };
    const out = buildSoundPredictions(inputs);
    const alert = out.find((p) => p.id === 'sound-running-blind-42');
    assert.ok(alert);
    assert.equal(alert.severity, 'alert');
  });

  it('does NOT double-emit no-scene + running-blind together', () => {
    const inputs = {
      ...baseInputs(),
      spl_summary: { count: 12, latest: 102, peak: 103, over_limit_count: 0, limit_db: null },
    };
    const out = buildSoundPredictions(inputs);
    assert.equal(out.find((p) => p.id === 'sound-no-scene-42'), undefined);
  });

  it('emits WARN when scene saved but no SPL ceiling', () => {
    const inputs = {
      ...baseInputs(),
      scenes: [{ id: 5, scene_name: 'Mix A', spl_limit_db: null, plot: { channels: [{}] }, saved_at: '' }],
    };
    const out = buildSoundPredictions(inputs);
    const warn = out.find((p) => p.id === 'sound-no-limit-42');
    assert.ok(warn);
    assert.equal(warn.severity, 'warn');
  });

  it('emits WARN when latest scene plot has no channels', () => {
    const inputs = {
      ...baseInputs(),
      scenes: [{ id: 5, scene_name: 'Skeleton', spl_limit_db: 100, plot: { channels: [] }, saved_at: '' }],
    };
    const out = buildSoundPredictions(inputs);
    const warn = out.find((p) => p.id === 'sound-empty-plot-42');
    assert.ok(warn);
    assert.match(warn.text, /Skeleton/);
  });

  it('emits OK rollup when readings exist + in-band', () => {
    const inputs = {
      ...baseInputs(),
      scenes: [{ id: 5, scene_name: 'Mix A', spl_limit_db: 100, plot: { channels: [{}] }, saved_at: '' }],
      spl_summary: { count: 80, latest: 95, peak: 98, over_limit_count: 0, limit_db: 100 },
    };
    const out = buildSoundPredictions(inputs);
    const ok = out.find((p) => p.id === 'sound-rollup-42');
    assert.ok(ok);
    assert.equal(ok.severity, 'ok');
    assert.match(ok.text, /80 readings tonight · peak 98 dB · in band/);
  });

  it('caps at 5 predictions even when multiple alerts fire', () => {
    const inputs = {
      ...baseInputs(),
      scenes: [{ id: 5, scene_name: 'X', spl_limit_db: null, plot: { channels: [] }, saved_at: '' }],
      spl_summary: { count: 80, latest: 105, peak: 110, over_limit_count: 12, limit_db: 100 },
    };
    const out = buildSoundPredictions(inputs);
    assert.ok(out.length <= 5);
  });

  it('uses show #N when band_name is null', () => {
    const inputs = { ...baseInputs(), band_name: null };
    const out = buildSoundPredictions(inputs);
    assert.match(out[0].text, /show #42/);
  });
});

describe('buildHostPredictions', () => {
  const TODAY = '2026-05-13';
  const baseSummary = () => ({
    total: 0,
    waiting: 0,
    seated_today: 0,
    left_today: 0,
    avg_wait_minutes: null,
    longest_wait_minutes: null,
    longest_wait_party_id: null,
  });

  it('returns [] when summary is null', () => {
    assert.deepEqual(buildHostPredictions({ summary: null, today: TODAY }), []);
  });

  it('returns [] when no activity (all zeros)', () => {
    assert.deepEqual(buildHostPredictions({ summary: baseSummary(), today: TODAY }), []);
  });

  it('emits ALERT for long-wait party (>45 min)', () => {
    const summary = { ...baseSummary(), waiting: 1, longest_wait_minutes: 60, longest_wait_party_id: 7 };
    const out = buildHostPredictions({ summary, today: TODAY });
    const alert = out.find((p) => p.id === 'host-long-wait-7');
    assert.ok(alert);
    assert.equal(alert.severity, 'alert');
    assert.match(alert.text, /60 min/);
  });

  it('does NOT emit long-wait alert when at the 45-min boundary', () => {
    const summary = { ...baseSummary(), waiting: 1, longest_wait_minutes: 45, longest_wait_party_id: 7 };
    const out = buildHostPredictions({ summary, today: TODAY });
    assert.equal(out.find((p) => p.id === 'host-long-wait-7'), undefined);
  });

  it('emits ALERT overflow when waiting > 8', () => {
    const summary = { ...baseSummary(), waiting: 9 };
    const out = buildHostPredictions({ summary, today: TODAY });
    const alert = out.find((p) => p.id === `host-overflow-${TODAY}`);
    assert.ok(alert);
    assert.equal(alert.severity, 'alert');
  });

  it('emits WARN busy when 5 < waiting ≤ 8', () => {
    const summary = { ...baseSummary(), waiting: 6 };
    const out = buildHostPredictions({ summary, today: TODAY });
    const warn = out.find((p) => p.id === `host-busy-${TODAY}`);
    assert.ok(warn);
    assert.equal(warn.severity, 'warn');
  });

  it('does NOT double-emit busy + overflow together', () => {
    const summary = { ...baseSummary(), waiting: 10 };
    const out = buildHostPredictions({ summary, today: TODAY });
    assert.equal(out.find((p) => p.id === `host-busy-${TODAY}`), undefined);
    assert.ok(out.find((p) => p.id === `host-overflow-${TODAY}`));
  });

  it('emits WARN when avg_wait_minutes > 30', () => {
    const summary = { ...baseSummary(), seated_today: 5, avg_wait_minutes: 35 };
    const out = buildHostPredictions({ summary, today: TODAY });
    assert.ok(out.find((p) => p.id === `host-avg-wait-${TODAY}`));
  });

  it('emits OK rollup with seated + waiting counts', () => {
    const summary = { ...baseSummary(), waiting: 2, seated_today: 4, avg_wait_minutes: 18 };
    const out = buildHostPredictions({ summary, today: TODAY });
    const ok = out.find((p) => p.id === `host-rollup-${TODAY}`);
    assert.ok(ok);
    assert.equal(ok.severity, 'ok');
    assert.match(ok.text, /4 seated today · 2 waiting/);
    assert.match(ok.text, /avg 18 min/);
  });

  it('caps total predictions at 5', () => {
    const summary = {
      total: 12, waiting: 12, seated_today: 8, left_today: 1,
      avg_wait_minutes: 50, longest_wait_minutes: 99, longest_wait_party_id: 42,
    };
    const out = buildHostPredictions({ summary, today: TODAY });
    assert.ok(out.length <= 5);
  });
});
