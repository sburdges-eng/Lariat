// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
// Regression for a bug found during the GH #250 checkjs migration:
// the API's PATCH /api/breaks handler (end-break) resolves the caller's
// location scope from the URL query only (`?location=`), as a
// cross-location IDOR guard — see app/api/breaks/route.js and its test
// tests/js/test-breaks-api.mjs ("mutation defaults to 'default' location
// when ?location= is absent"). BreakBoard's endBreak() never sent that
// query param, so at any non-default location the guard silently fired
// and the API returned 404 "unknown break" — the "End" button could
// never actually close out a meal/rest break. That leaves the break
// open forever, which COMPS #39's shift evaluator treats as "no end
// time" and the payroll owed-pay math never resolves. Masked in
// single-location installs because both sides defaulted to 'default'.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BreakBoard from '../labor/breaks/BreakBoard';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const OPEN_BREAK_ROW = {
  id: 42,
  shift_date: '2026-07-12',
  location_id: 'site-b',
  cook_id: 'cook-1',
  kind: 'rest',
  started_at: '2026-07-12T10:00:00.000Z',
  ended_at: null,
  duration_min: null,
  waived: 0,
  waiver_ref: null,
  note: null,
  created_at: '2026-07-12T10:00:00.000Z',
};

const STAFF = [{ id: 'cook-1', first: 'Maya', last: 'Rivera', active: true }];

function mockFetchOk() {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    }),
  );
}

describe('BreakBoard — end-break request carries the caller location', () => {
  beforeEach(() => {
    window.localStorage.setItem('lariat_cook', 'cook-1');
    mockFetchOk();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    window.localStorage.clear();
  });

  test('at a non-default location, ending a break sends ?location= so the API IDOR guard does not 404 it', async () => {
    render(
      <BreakBoard rows={[OPEN_BREAK_ROW]} staff={STAFF} date="2026-07-12" locationId="site-b" />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /End \(/ }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/breaks?location=site-b',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  test('at the default location, no ?location= is appended (server already defaults to it)', async () => {
    render(
      <BreakBoard
        rows={[{ ...OPEN_BREAK_ROW, location_id: 'default' }]}
        staff={STAFF}
        date="2026-07-12"
        locationId="default"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /End \(/ }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/breaks',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });
});
