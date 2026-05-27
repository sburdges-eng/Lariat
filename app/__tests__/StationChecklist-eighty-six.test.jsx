// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/**
 * StationChecklist — `86 this item` button error handling.
 *
 * The eightySix flow fires two POSTs: /api/eighty-six (writes the 86 row)
 * and /api/checks (writes a 'fail' check row with the reason in the note).
 * Both must surface non-2xx responses and connection drops to the line
 * cook — otherwise the 86 board diverges from the local UI and nobody
 * notices.
 *
 * These tests pin the behavior fixed in commit cac3825 (and surfaced as
 * the recurring "optimistic-UI silent-error" pattern in project memory).
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
  const props = { ...DEFAULT_PROPS, ...overrides };
  return render(<StationChecklist {...props} />);
}

describe('StationChecklist 86 — happy path', () => {
  let alertSpy, promptSpy;

  beforeEach(() => {
    window.localStorage.setItem('lariat_cook', 'alex');
    promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('out');
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    promptSpy.mockRestore();
    alertSpy.mockRestore();
    window.localStorage.clear();
  });

  test('fires /api/eighty-six then /api/checks with status:fail and the reason in the note', async () => {
    renderChecklist();
    const btn = screen.getByRole('button', { name: /^86 Bacon$/i });
    fireEvent.click(btn);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    const [url1, init1] = global.fetch.mock.calls[0];
    expect(url1).toBe('/api/eighty-six');
    const body1 = JSON.parse(init1.body);
    expect(body1.item).toBe('Bacon');
    expect(body1.reason).toBe('out');
    expect(body1.cook_id).toBe('alex');
    expect(body1.location_id).toBe('loc-1');

    const [url2, init2] = global.fetch.mock.calls[1];
    expect(url2).toBe('/api/checks');
    const body2 = JSON.parse(init2.body);
    expect(body2.status).toBe('fail');
    expect(body2.note).toBe('86: out');

    // No alert on the happy path.
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('user cancels the prompt — no fetch, no alert', async () => {
    promptSpy.mockReturnValueOnce(null);

    renderChecklist();
    const btn = screen.getByRole('button', { name: /^86 Bacon$/i });
    fireEvent.click(btn);

    // Synchronous bail. Use a microtask flush to make sure no async
    // fetch was queued before asserting.
    await Promise.resolve();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe('StationChecklist 86 — failure surfacing', () => {
  let alertSpy, promptSpy;

  beforeEach(() => {
    window.localStorage.setItem('lariat_cook', 'alex');
    promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('out');
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
    promptSpy.mockRestore();
    alertSpy.mockRestore();
    window.localStorage.clear();
  });

  test('/api/eighty-six returns 500 — alert fires, /api/checks NOT called', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    renderChecklist();
    fireEvent.click(screen.getByRole('button', { name: /^86 Bacon$/i }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));

    // Stop after the first POST — don't write a fail check row for an
    // 86 the server didn't accept.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('/api/eighty-six');

    const msg = alertSpy.mock.calls[0][0];
    expect(msg).toMatch(/86/);
    expect(msg).toMatch(/Bacon/);
    expect(msg).toMatch(/500/);
  });

  test('/api/eighty-six succeeds, /api/checks fails — second alert names the partial state', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });

    renderChecklist();
    fireEvent.click(screen.getByRole('button', { name: /^86 Bacon$/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));

    // The 86 succeeded, so the alert tells the cook the row is on the
    // 86 board but the check row didn't write — they need to retry the
    // check write specifically (or surface to a manager).
    const msg = alertSpy.mock.calls[0][0];
    expect(msg).toMatch(/check row/);
    expect(msg).toMatch(/Bacon/);
    expect(msg).toMatch(/503/);
  });

  test('connection drop on the first POST — alert fires, /api/checks NOT called', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('NetworkError'));

    renderChecklist();
    fireEvent.click(screen.getByRole('button', { name: /^86 Bacon$/i }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const msg = alertSpy.mock.calls[0][0];
    expect(msg).toMatch(/Lost connection/);
    expect(msg).toMatch(/Bacon/);
  });
});
