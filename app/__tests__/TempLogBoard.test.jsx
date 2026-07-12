// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
// Regression for a classification split between the temp-log board's two
// surfaces (GH #250 follow-up, T4): the tile grid is colored by
// lib/tempLog.ts classifyReadings/classifyReading, which treats readings
// outside the absolute sanity range [-100°F, 500°F] as *invalid* (bad
// probe / wrong units — not a compliance miss). The "Today's readings"
// list below it re-implemented the range check inline (plain min/max
// compare), so an off-the-charts reading like 9999°F rendered as a red
// "critical" (or yellow, if a note happened to be attached) instead of
// being flagged invalid. The list must classify through the same shared
// classifier as the tiles.
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import TempLogBoard from '../food-safety/temp-log/TempLogBoard';
import { TempPoints, classifyReadings } from '../../lib/tempLog';

/** Build a DB-shaped temp_log row (lib/db.ts TempLogEntry + point_label). */
function entry(overrides) {
  return {
    id: 1,
    shift_date: '2026-07-12',
    location_id: 'default',
    point_id: 'walk_in_cooler',
    reading_f: 38,
    required_min_f: null,
    required_max_f: 41,
    corrective_action: null,
    cook_id: null,
    probe_id: null,
    created_at: '2026-07-12 10:00:00',
    ...overrides,
  };
}

/**
 * Scope queries to the "Today's readings" list — the tile grid above it
 * also renders the last reading's temperature, so unscoped text queries
 * collide with the tiles.
 */
function entriesList() {
  const el = document.querySelector('.tl-entries');
  expect(el).not.toBeNull();
  return within(/** @type {HTMLElement} */ (el));
}

/** Find the .tl-entry container that renders the given formatted temp. */
function entryByTemp(tempText) {
  const el = entriesList().getByText(tempText).closest('.tl-entry');
  expect(el).not.toBeNull();
  return el;
}

function renderBoard(entries) {
  render(
    <TempLogBoard
      initialEntries={entries}
      initialSummary={classifyReadings(entries)}
      points={TempPoints}
      locationId="default"
      date="2026-07-12"
    />,
  );
}

describe("TempLogBoard — Today's readings classify via the shared classifier", () => {
  test('an off-the-charts reading is flagged invalid, not corrective/critical', () => {
    // 9999°F is outside lib/tempLog.ts's ABSOLUTE_MAX_F (500°F): the
    // shared classifier says "invalid". The old inline min/max check saw
    // "out of range + has a note" and painted it yellow (corrective) —
    // exactly the miss this guards against.
    renderBoard([
      entry({
        id: 1,
        reading_f: 9999,
        corrective_action: 'probe glitch — retook at 38°F',
      }),
    ]);

    const row = entryByTemp('9999.0°F');
    expect(row).toHaveTextContent(/invalid reading — check the probe/);
    expect(row).toHaveClass('tl-tone-red');
    expect(row).not.toHaveClass('tl-tone-yellow');
  });

  test('an invalid reading without a note is flagged invalid, not critical', () => {
    renderBoard([entry({ id: 1, reading_f: 9999 })]);

    const row = entryByTemp('9999.0°F');
    expect(row).toHaveTextContent(/invalid reading — check the probe/);
    expect(row).toHaveClass('tl-tone-red');
  });

  test('in-range and noted out-of-range readings keep their old tones', () => {
    renderBoard([
      entry({ id: 1, reading_f: 38, created_at: '2026-07-12 10:00:00' }),
      entry({
        id: 2,
        reading_f: 45,
        corrective_action: 'moved product to reach-in',
        created_at: '2026-07-12 11:00:00',
      }),
      entry({ id: 3, reading_f: 45, created_at: '2026-07-12 12:00:00' }),
    ]);

    expect(entryByTemp('38.0°F')).toHaveClass('tl-tone-green');
    const noted = entriesList().getAllByText('45.0°F').map((el) => el.closest('.tl-entry'));
    // id 2 (with note) renders yellow; id 3 (no note) renders red.
    expect(noted.some((el) => el.classList.contains('tl-tone-yellow'))).toBe(true);
    expect(noted.some((el) => el.classList.contains('tl-tone-red'))).toBe(true);
    // Valid readings never carry the invalid flag.
    expect(entriesList().queryByText(/invalid reading — check the probe/)).toBeNull();
  });
});
