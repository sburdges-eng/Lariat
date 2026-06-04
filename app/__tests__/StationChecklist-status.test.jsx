// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/**
 * StationChecklist — pass/fail status persistence.
 *
 * Runtime audit 2026-06-04 F1 found that tapping an already-selected
 * Pass button sent `status:null`, produced a server 500, and left the
 * optimistic UI out of sync with SQLite. These tests pin the corrected
 * contract: status buttons never clear to null, a cook is required, and
 * failed writes roll back the visible status.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StationChecklist from '../stations/[id]/StationChecklist';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

const DEFAULT_PROPS = {
  stationId: 'grill',
  stationName: 'Grill',
  date: '2026-04-23',
  items: ['Bacon'],
  existing: {},
  signoff: null,
  locationId: 'loc-1',
};

function renderChecklist(overrides = {}) {
  return render(<StationChecklist {...DEFAULT_PROPS} {...overrides} />);
}

describe('StationChecklist status buttons', () => {
  let alertSpy;

  beforeEach(() => {
    window.localStorage.clear();
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    alertSpy.mockRestore();
    window.localStorage.clear();
  });

  test('requires a selected cook before writing pass/fail status', async () => {
    renderChecklist();

    fireEvent.click(screen.getByRole('button', { name: /Pass Bacon/i }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toMatch(/Pick your name/);
    expect(screen.getByRole('button', { name: /Pass Bacon/i })).toHaveAttribute('aria-pressed', 'false');
  });

  test('new pass status posts pass with the selected cook', async () => {
    window.localStorage.setItem('lariat_cook', 'alex');
    renderChecklist();

    fireEvent.click(screen.getByRole('button', { name: /Pass Bacon/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/checks');
    const body = JSON.parse(init.body);
    expect(body.status).toBe('pass');
    expect(body.cook_id).toBe('alex');
    expect(body.location_id).toBe('loc-1');
  });

  test('clicking an already-selected pass button does not clear status or POST null', async () => {
    window.localStorage.setItem('lariat_cook', 'alex');
    renderChecklist({ existing: { Bacon: { status: 'pass' } } });

    const pass = screen.getByRole('button', { name: /Pass Bacon/i });
    expect(pass).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(pass);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(pass).toHaveAttribute('aria-pressed', 'true');
  });

  test('failed pass write rolls the visible status back to empty', async () => {
    window.localStorage.setItem('lariat_cook', 'alex');
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    });
    renderChecklist();

    const pass = screen.getByRole('button', { name: /Pass Bacon/i });
    fireEvent.click(pass);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    expect(pass).toHaveAttribute('aria-pressed', 'false');
    expect(alertSpy.mock.calls[0][0]).toMatch(/500/);
  });
});
