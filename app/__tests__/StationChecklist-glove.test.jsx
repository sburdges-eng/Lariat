// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/**
 * SDD-3 — StationChecklist glove-attestation UI persistence.
 *
 * Verifies the F15 glove-change checkbox:
 *   • Renders unchecked when `existing[item].glove_change_attested` is missing/null.
 *   • Without a row status, clicking gloves alerts and does not POST an
 *     incomplete HACCP row.
 *   • With a row status, clicking gloves POSTs to /api/checks with
 *     `glove_change_attested: true` and the label gains the `on` class.
 *   • On second click, POSTs with `glove_change_attested: null` (tri-state —
 *     never `false`, never missing).
 *   • Renders checked when `existing[item].glove_change_attested === true`.
 *   • Sends the full row payload on every toggle (status/par/have/need/note
 *     etc. all present even when blank).
 *   • Reads `lariat_cook` from localStorage and echoes it as `cook_id`.
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

describe('StationChecklist glove attestation', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    jest.spyOn(window, 'alert').mockImplementation(() => {});
    window.localStorage.clear();
    window.localStorage.setItem('lariat_cook', 'alex');
  });

  afterEach(() => {
    jest.clearAllMocks();
    window.alert.mockRestore();
    window.localStorage.clear();
  });

  test('initial render — checkbox unchecked and label has no "on" class when no prior attestation', () => {
    renderChecklist({ existing: {} });

    const checkbox = screen.getByRole('checkbox', { name: /Glove change attested for Bacon/i });
    expect(checkbox).not.toBeChecked();

    // The label wraps the checkbox; find it and assert it does NOT have `on`.
    const label = checkbox.closest('label.glove-toggle');
    expect(label).not.toBeNull();
    expect(label.className).toContain('glove-toggle');
    expect(label.className).not.toMatch(/\bon\b/);
  });

  test('click without a row status — alerts, does not POST, and stays unchecked', async () => {
    renderChecklist({ existing: {} });

    const checkbox = screen.getByRole('checkbox', { name: /Glove change attested for Bacon/i });
    fireEvent.click(checkbox);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledTimes(1);
    expect(window.alert.mock.calls[0][0]).toMatch(/Pass, Fail, or n\/a/);
    expect(checkbox).not.toBeChecked();
  });

  test('click to attest after pass — POSTs glove_change_attested:true and label gains "on" class', async () => {
    renderChecklist({ existing: { Bacon: { status: 'pass' } } });

    const checkbox = screen.getByRole('checkbox', { name: /Glove change attested for Bacon/i });
    fireEvent.click(checkbox);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/checks');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');

    const body = JSON.parse(init.body);
    expect(body.glove_change_attested).toBe(true);
    expect(body.item).toBe('Bacon');
    expect(body.station_id).toBe('grill');
    expect(body.shift_date).toBe('2026-04-23');
    expect(body.location_id).toBe('loc-1');
    expect(body.status).toBe('pass');
    expect(body.cook_id).toBe('alex');

    // State update → checkbox now checked and label has `on`.
    expect(checkbox).toBeChecked();
    const label = checkbox.closest('label.glove-toggle');
    expect(label.className).toMatch(/\bon\b/);
  });

  test('click again to clear — POSTs glove_change_attested:null (literal null, not false, not missing)', async () => {
    renderChecklist({
      existing: { Bacon: { status: 'pass', glove_change_attested: true } },
    });

    const checkbox = screen.getByRole('checkbox', { name: /Glove change attested for Bacon/i });
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const init = global.fetch.mock.calls[0][1];
    const body = JSON.parse(init.body);

    // Tri-state: clearing persists as null, NOT false.
    expect(body.glove_change_attested).toBeNull();
    expect(body.glove_change_attested).not.toBe(false);

    // And the key must literally be present in the serialized JSON.
    expect(Object.prototype.hasOwnProperty.call(body, 'glove_change_attested')).toBe(true);
    expect(init.body).toMatch(/"glove_change_attested":\s*null/);

    // UI state cleared.
    expect(checkbox).not.toBeChecked();
    const label = checkbox.closest('label.glove-toggle');
    expect(label.className).not.toMatch(/\bon\b/);
  });

  test('pre-existing attestation — renders checked on initial mount', () => {
    renderChecklist({
      existing: { Bacon: { glove_change_attested: true } },
    });

    const checkbox = screen.getByRole('checkbox', { name: /Glove change attested for Bacon/i });
    expect(checkbox).toBeChecked();

    const label = checkbox.closest('label.glove-toggle');
    expect(label.className).toMatch(/\bon\b/);
  });

  test('persist payload — includes all row fields even when blank', async () => {
    renderChecklist({
      existing: { Lettuce: { status: 'pass' } },
      items: ['Lettuce'],
    });

    const checkbox = screen.getByRole('checkbox', { name: /Glove change attested for Lettuce/i });
    fireEvent.click(checkbox);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);

    // Every field the /api/checks route handler expects must be present —
    // even if blank — so the server receives the full row state.
    const expectedKeys = [
      'shift_date',
      'station_id',
      'item',
      'status',
      'par',
      'have',
      'need',
      'note',
      'glove_change_attested',
      'cook_id',
      'location_id',
    ];
    for (const key of expectedKeys) {
      expect(Object.prototype.hasOwnProperty.call(body, key)).toBe(true);
    }

    // Blank-but-present values (status already exists; quantity fields were never edited).
    expect(body.status).toBe('pass');
    expect(body.par).toBe('');
    expect(body.have).toBe('');
    expect(body.need).toBe('');
    expect(body.note).toBe('');
    expect(body.glove_change_attested).toBe(true);
    expect(body.item).toBe('Lettuce');
    expect(body.station_id).toBe('grill');
    expect(body.location_id).toBe('loc-1');
  });

  test('cook_id round-trip — localStorage lariat_cook is read and echoed in POST body', async () => {
    renderChecklist({ existing: { Bacon: { status: 'pass' } } });

    const checkbox = screen.getByRole('checkbox', { name: /Glove change attested for Bacon/i });

    // render() flushes the mount effect synchronously in React 18's test
    // environment, so cookRef.current is already 'alex' by here. No
    // additional sync barrier needed before the click.
    fireEvent.click(checkbox);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.cook_id).toBe('alex');
  });
});

// Sad-path coverage for the glove handler. FDA §3-301.11 RTE attestation
// is regulatory — if the persist fails, the optimistic toggle MUST roll
// back so the UI never claims a glove change that didn't audit-log.
describe('StationChecklist glove attestation — failure rollback', () => {
  let alertSpy;

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('lariat_cook', 'alex');
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
    alertSpy.mockRestore();
  });

  test('non-2xx response — checkbox rolls back to unchecked and alert fires', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    });

    renderChecklist({ existing: { Bacon: { status: 'pass' } } });
    const checkbox = screen.getByRole('checkbox', { name: /Glove change attested for Bacon/i });
    fireEvent.click(checkbox);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));

    // Optimistic toggle reverted.
    expect(checkbox).not.toBeChecked();
    const label = checkbox.closest('label.glove-toggle');
    expect(label.className).not.toMatch(/\bon\b/);

    // Alert message names the item and the HTTP status so cooks can
    // tell saved-vs-not at a glance.
    const alertMsg = alertSpy.mock.calls[0][0];
    expect(alertMsg).toMatch(/Bacon/);
    expect(alertMsg).toMatch(/500/);
  });

  test('connection drop (fetch rejects) — checkbox rolls back and alert fires', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('NetworkError'));

    renderChecklist({ existing: { Bacon: { status: 'pass' } } });
    const checkbox = screen.getByRole('checkbox', { name: /Glove change attested for Bacon/i });
    fireEvent.click(checkbox);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));

    expect(checkbox).not.toBeChecked();
    const label = checkbox.closest('label.glove-toggle');
    expect(label.className).not.toMatch(/\bon\b/);

    const alertMsg = alertSpy.mock.calls[0][0];
    expect(alertMsg).toMatch(/Lost connection/);
    expect(alertMsg).toMatch(/Bacon/);
  });

  test('clearing a previously-attested glove also rolls back to true on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    renderChecklist({ existing: { Bacon: { status: 'pass', glove_change_attested: true } } });
    const checkbox = screen.getByRole('checkbox', { name: /Glove change attested for Bacon/i });
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));

    // Originally-true attestation must come back when the clear fails —
    // otherwise the audit log says "still attested" while the UI says
    // "not attested" and the line cook re-changes gloves on a stale view.
    expect(checkbox).toBeChecked();
    const label = checkbox.closest('label.glove-toggle');
    expect(label.className).toMatch(/\bon\b/);
  });
});
