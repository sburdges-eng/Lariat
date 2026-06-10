// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/**
 * StationChecklist — `86 this item` flow.
 *
 * Tapping 86 opens an inline reason picker — native prompt()/alert() are
 * banned on the line because they block the whole iPad mid-service.
 * Picking a reason fires two POSTs: /api/eighty-six (writes the 86 row)
 * and /api/checks (writes a 'fail' check row with the reason in the note).
 * Both must surface non-2xx responses and connection drops in the inline
 * role="alert" strip — otherwise the 86 board diverges from the local UI
 * and nobody notices.
 *
 * These tests pin the behavior fixed in commit cac3825 (the recurring
 * "optimistic-UI silent-error" pattern in project memory), updated for the
 * inline-error UI that replaced alert()/prompt().
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

/** Open the inline picker for an item, then tap a reason button. */
function eightySixVia(itemName, reasonLabel) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^86 ${itemName}$`, 'i') }));
  fireEvent.click(screen.getByRole('button', { name: reasonLabel }));
}

describe('StationChecklist 86 — happy path', () => {
  let alertSpy;

  beforeEach(() => {
    window.localStorage.setItem('lariat_cook', 'alex');
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    alertSpy.mockRestore();
    window.localStorage.clear();
  });

  test('picking a reason fires /api/eighty-six then /api/checks with status:fail and the reason in the note', async () => {
    renderChecklist();
    eightySixVia('Bacon', 'Out');

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

    // No native dialog and no inline error on the happy path.
    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('86 button toggles the reason picker; Cancel closes it without a fetch', async () => {
    renderChecklist();

    fireEvent.click(screen.getByRole('button', { name: /^86 Bacon$/i }));
    expect(screen.getByRole('group', { name: /Why is Bacon 86/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: /Why is Bacon 86/i })).toBeNull();

    // Synchronous bail. Use a microtask flush to make sure no async
    // fetch was queued before asserting.
    await Promise.resolve();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe('StationChecklist 86 — failure surfacing', () => {
  let alertSpy;

  beforeEach(() => {
    window.localStorage.setItem('lariat_cook', 'alex');
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
    alertSpy.mockRestore();
    window.localStorage.clear();
  });

  test('/api/eighty-six returns 500 — inline error fires, /api/checks NOT called', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    renderChecklist();
    eightySixVia('Bacon', 'Out');

    const banner = await screen.findByRole('alert');

    // Stop after the first POST — don't write a fail check row for an
    // 86 the server didn't accept.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('/api/eighty-six');

    expect(banner.textContent).toMatch(/86/);
    expect(banner.textContent).toMatch(/Bacon/);
    expect(banner.textContent).toMatch(/500/);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('/api/eighty-six succeeds, /api/checks fails — inline error names the partial state', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });

    renderChecklist();
    eightySixVia('Bacon', 'Out');

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const banner = await screen.findByRole('alert');

    // The 86 succeeded, so the message tells the cook the row is on the
    // 86 board but the check row didn't write — they need to retry the
    // check write specifically (or surface to a manager).
    expect(banner.textContent).toMatch(/check row/);
    expect(banner.textContent).toMatch(/Bacon/);
    expect(banner.textContent).toMatch(/503/);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('connection drop on the first POST — inline error fires, /api/checks NOT called', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('NetworkError'));

    renderChecklist();
    eightySixVia('Bacon', 'Out');

    const banner = await screen.findByRole('alert');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(banner.textContent).toMatch(/Lost connection/);
    expect(banner.textContent).toMatch(/Bacon/);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
