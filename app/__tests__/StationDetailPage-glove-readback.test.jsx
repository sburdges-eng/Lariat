// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
//
// Regression for a real F15 (FDA §3-301.11) glove-change attestation
// read-back bug found migrating app/stations/[id]/page.jsx off the
// GH #250 checkjs baseline. The line_check_entries SELECT this page ran
// never listed `glove_change_attested`, so every row handed to
// StationChecklist as `existing[item]` had that field come back as plain
// `undefined` — not `0`/`1`/`null` from the DB, just missing entirely.
// StationChecklist's tri-state check (`typeof ex.glove_change_attested
// === 'boolean'`) then always fell through to `null`, so a cook's prior
// glove-change attestation silently reset to unchecked on every page
// load or `router.refresh()`, even though the DB still held `1`. The
// write path (POST /api/checks) was never broken — only the read-back
// was. The column is now selected and translated from SQLite's numeric
// `0 | 1 | null` into the `boolean | null` shape StationCheckItem
// actually declares.
//
// This is deliberately a Server Component test (renders StationPage
// itself against a real seeded DB row) rather than a StationChecklist
// prop test — the existing app/__tests__/StationChecklist-glove.test.jsx
// suite only ever hand-constructs an already-correctly-shaped `existing`
// prop, so it could not have caught a bug in how the server page builds
// that prop from the raw DB row.
import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

import * as db from '../../lib/db.ts';
import StationPage from '../stations/[id]/page.jsx';

// Real fixture station/item from data/cache/{stations,line_checks}.json
// (checked into the repo) — "Cornbread" is one of grill_saute's real
// line-check items, so this exercises the real getStation()/
// getLineCheckTemplate() cache path, not a mocked one.
const STATION_ID = 'grill_saute';
const ITEM = 'Cornbread';

beforeAll(() => {
  db.setDbPathForTest(':memory:');
});

afterAll(() => {
  db.setDbPathForTest(null);
});

beforeEach(() => {
  const conn = db.getDb();
  conn.exec('DELETE FROM line_check_entries; DELETE FROM station_signoffs;');
});

/** @param {0 | 1 | null} glove */
function seed(glove) {
  const conn = db.getDb();
  const date = db.todayISO();
  conn
    .prepare(
      `INSERT INTO line_check_entries
         (shift_date, station_id, item, status, par, have, need, note, cook_id, glove_change_attested, location_id)
       VALUES (?, ?, ?, 'pass', '2', '2', '', '', 'cook1', ?, 'default')`,
    )
    .run(date, STATION_ID, ITEM, glove);
}

describe('StationPage — glove-change attestation survives a reload', () => {
  test('a previously-attested row (glove_change_attested=1) renders the toggle checked', async () => {
    seed(1);
    render(
      await StationPage({
        params: { id: STATION_ID },
        searchParams: {},
      }),
    );
    const checkbox = screen.getByRole('checkbox', {
      name: new RegExp(`Glove change attested for ${ITEM}`, 'i'),
    });
    expect(checkbox).toBeChecked();
  });

  test('a row with no attestation (glove_change_attested=0) renders the toggle unchecked', async () => {
    seed(0);
    render(
      await StationPage({
        params: { id: STATION_ID },
        searchParams: {},
      }),
    );
    const checkbox = screen.getByRole('checkbox', {
      name: new RegExp(`Glove change attested for ${ITEM}`, 'i'),
    });
    expect(checkbox).not.toBeChecked();
  });

  test('a legacy pre-migration row (glove_change_attested=NULL) renders the toggle unchecked', async () => {
    seed(null);
    render(
      await StationPage({
        params: { id: STATION_ID },
        searchParams: {},
      }),
    );
    const checkbox = screen.getByRole('checkbox', {
      name: new RegExp(`Glove change attested for ${ITEM}`, 'i'),
    });
    expect(checkbox).not.toBeChecked();
  });
});
