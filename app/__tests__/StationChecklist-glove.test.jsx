/**
 * SDD-3 — StationChecklist glove-attestation UI persistence.
 *
 * Verifies the F15 glove-change checkbox:
 *   • Renders unchecked when `existing[item].glove_change_attested` is missing/null.
 *   • On first click, POSTs to /api/checks with `glove_change_attested: true`
 *     and the label gains the `on` class.
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
    window.localStorage.clear();
  });

  afterEach(() => {
    jest.clearAllMocks();
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

  test('click to attest — POSTs glove_change_attested:true and label gains "on" class', async () => {
    renderChecklist({ existing: {} });

    const checkbox = screen.getByRole('checkbox', { name: /Glove change attested for Bacon/i });
    fireEvent.click(checkbox);

    // Fetch should have fired exactly once.
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

    // State update → checkbox now checked and label has `on`.
    expect(checkbox).toBeChecked();
    const label = checkbox.closest('label.glove-toggle');
    expect(label.className).toMatch(/\bon\b/);
  });

  test('click again to clear — POSTs glove_change_attested:null (literal null, not false, not missing)', async () => {
    renderChecklist({
      existing: { Bacon: { glove_change_attested: true } },
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
      existing: {},
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

    // Blank-but-present values (the row was never edited, so defaults stand).
    expect(body.status).toBeNull();
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
    window.localStorage.setItem('lariat_cook', 'alex');

    renderChecklist({ existing: {} });

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
