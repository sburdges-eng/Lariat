#!/usr/bin/env node
// Tests for lib/beoFireSchedule — pure resolver + age-bucket helper (T7).
// Run: node --experimental-strip-types --test tests/js/test-beo-fire-schedule-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveSchedule,
  ageBucketFor,
  YELLOW_THRESHOLD_MS,
} from '../../lib/beoFireSchedule.ts';

const baseCourses = (over = []) => [
  { id: 1, event_id: 42, event_title: 'Hendricks Wedding', course_label: 'Entree',
    fire_at: '2026-05-04T19:30:00.000Z', station_id: 'grill' },
  { id: 2, event_id: 42, event_title: 'Hendricks Wedding', course_label: 'Dessert',
    fire_at: '2026-05-04T20:30:00.000Z', station_id: 'sides' },
  { id: 3, event_id: 43, event_title: 'Smith Birthday',  course_label: 'App',
    fire_at: '2026-05-04T19:00:00.000Z', station_id: 'grill' },
  ...over,
];

const baseLines = (over = []) => [
  { id: 901, event_id: 42, course_id: 1, item_name: 'Smoked Brisket', quantity: 80 },
  { id: 902, event_id: 42, course_id: 1, item_name: 'Half Chicken',   quantity: 40 },
  { id: 903, event_id: 42, course_id: 2, item_name: 'Cheesecake',     quantity: 80 },
  { id: 904, event_id: 43, course_id: 3, item_name: 'Bruschetta',     quantity: 30 },
  { id: 905, event_id: 42, course_id: null, item_name: 'Bread service', quantity: 80 }, // unbound, dropped
  ...over,
];

describe('resolveSchedule', () => {
  it('returns the date + location_id passed in', () => {
    const r = resolveSchedule('2026-05-04', 'default', baseCourses(), baseLines());
    assert.equal(r.date, '2026-05-04');
    assert.equal(r.location_id, 'default');
  });

  it('groups courses by station and sorts within each station by fire_at', () => {
    const r = resolveSchedule('2026-05-04', 'default', baseCourses(), baseLines());
    const stations = r.stations.map((s) => s.station_id);
    // alphabetical: grill, sides
    assert.deepEqual(stations, ['grill', 'sides']);

    const grill = r.stations.find((s) => s.station_id === 'grill');
    // App (19:00) comes before Entree (19:30)
    assert.deepEqual(
      grill.courses.map((c) => c.course_label),
      ['App', 'Entree'],
    );
  });

  it('attaches line items to their course (and drops course_id=null lines)', () => {
    const r = resolveSchedule('2026-05-04', 'default', baseCourses(), baseLines());
    const entree = r.stations
      .find((s) => s.station_id === 'grill').courses
      .find((c) => c.course_label === 'Entree');
    assert.equal(entree.lines.length, 2);
    assert.deepEqual(entree.lines.map((l) => l.item_name).sort(),
      ['Half Chicken', 'Smoked Brisket']);

    // Bread service (course_id null) does NOT show up anywhere
    const allItems = r.stations
      .flatMap((s) => s.courses)
      .flatMap((c) => c.lines)
      .map((l) => l.item_name);
    assert.equal(allItems.includes('Bread service'), false);
  });

  it('puts NULL station_id courses in an "unassigned" bucket sorted last', () => {
    const r = resolveSchedule(
      '2026-05-04',
      'default',
      [
        ...baseCourses(),
        {
          id: 4, event_id: 44, event_title: 'Pop-up',
          course_label: 'Tasting', fire_at: '2026-05-04T21:00:00.000Z', station_id: null,
        },
      ],
      baseLines(),
    );
    const stations = r.stations.map((s) => s.station_id);
    assert.deepEqual(stations, ['grill', 'sides', 'unassigned']);
  });

  it('returns an empty stations array when no courses', () => {
    const r = resolveSchedule('2026-05-04', 'default', [], []);
    assert.deepEqual(r.stations, []);
  });

  it('breaks fire_at ties by event_id then course id (deterministic)', () => {
    const r = resolveSchedule(
      '2026-05-04',
      'default',
      [
        { id: 10, event_id: 50, event_title: 'A', course_label: 'X',
          fire_at: '2026-05-04T19:00:00.000Z', station_id: 'grill' },
        { id: 11, event_id: 49, event_title: 'B', course_label: 'Y',
          fire_at: '2026-05-04T19:00:00.000Z', station_id: 'grill' },
      ],
      [],
    );
    const labels = r.stations[0].courses.map((c) => c.course_label);
    // event_id 49 < 50, so Y comes first
    assert.deepEqual(labels, ['Y', 'X']);
  });
});

describe('ageBucketFor', () => {
  it('returns green for >30min away', () => {
    const fire = new Date(Date.now() + 60 * 60_000).toISOString();
    assert.equal(ageBucketFor(fire), 'green');
  });

  it('returns yellow for ≤30min away', () => {
    const fire = new Date(Date.now() + 10 * 60_000).toISOString();
    assert.equal(ageBucketFor(fire), 'yellow');
  });

  it('returns yellow at exactly the 30min threshold', () => {
    const fire = new Date(Date.now() + YELLOW_THRESHOLD_MS).toISOString();
    assert.equal(ageBucketFor(fire), 'yellow');
  });

  it('returns red on or past fire_at', () => {
    const past = new Date(Date.now() - 1).toISOString();
    assert.equal(ageBucketFor(past), 'red');
  });

  it('returns red on garbage input (fail-closed)', () => {
    assert.equal(ageBucketFor('not a date'), 'red');
    assert.equal(ageBucketFor(''), 'red');
  });

  it('uses the explicit `now` for deterministic testing', () => {
    const fire = '2026-05-04T19:30:00.000Z';
    assert.equal(ageBucketFor(fire, new Date('2026-05-04T18:00:00.000Z')), 'green');
    assert.equal(ageBucketFor(fire, new Date('2026-05-04T19:15:00.000Z')), 'yellow');
    assert.equal(ageBucketFor(fire, new Date('2026-05-04T19:30:00.000Z')), 'red');
  });
});
