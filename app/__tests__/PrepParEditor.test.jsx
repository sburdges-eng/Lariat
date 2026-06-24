// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
// PrepParEditor RTL tests (Task 14 — standing prep-par editor)
// Written first (TDD: RED before implementation).
//
// Covers:
//   - AddPrepParRow: posts correct body; blocks submit when both recipe_slug and ingredient empty
//   - DeletePrepParRow: issues DELETE to /api/prep-par?id=<id>

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── mocks ─────────────────────────────────────────────────────────────────

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

import { useRouter } from 'next/navigation';

const mockRefresh = jest.fn();

beforeEach(() => {
  useRouter.mockReturnValue({ refresh: mockRefresh });
  jest.clearAllMocks();
  // Reset localStorage
  window.localStorage.clear();
});

// ── helpers ──────────────────────────────────────────────────────────────

function mockFetchOk(payload = { ok: true }) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

function mockFetchError() {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 500,
    json: () => Promise.resolve({ error: 'server error' }),
  });
}

// ── AddPrepParRow ─────────────────────────────────────────────────────────

import AddPrepParRow from '../prep/par/AddPrepParRow';

describe('AddPrepParRow', () => {
  test('renders add button initially', () => {
    render(<AddPrepParRow locationId="default" />);
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
  });

  test('opens the form when add button is clicked', async () => {
    render(<AddPrepParRow locationId="default" />);
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  test('submit button is disabled when both recipe_slug and ingredient are empty', async () => {
    render(<AddPrepParRow locationId="default" />);
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn).toBeDisabled();
  });

  test('submit button is enabled when recipe_slug is filled', async () => {
    render(<AddPrepParRow locationId="default" />);
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    const recipeInput = screen.getByLabelText(/recipe/i);
    await userEvent.type(recipeInput, 'beer_batter');
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn).not.toBeDisabled();
  });

  test('submit button is enabled when ingredient is filled', async () => {
    render(<AddPrepParRow locationId="default" />);
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    const ingredientInput = screen.getByLabelText(/ingredient/i);
    await userEvent.type(ingredientInput, 'TOMATO, ROMA');
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn).not.toBeDisabled();
  });

  test('posts correct body when recipe_slug is provided', async () => {
    mockFetchOk({ ok: true, id: 1, isInsert: true });
    render(<AddPrepParRow locationId="loc-a" />);
    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    await userEvent.type(screen.getByLabelText(/recipe/i), 'beer_batter');
    await userEvent.type(screen.getByLabelText(/target qty/i), '10');
    await userEvent.type(screen.getByLabelText(/unit/i), 'qt');

    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/prep-par');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.location_id).toBe('loc-a');
    expect(body.recipe_slug).toBe('beer_batter');
    expect(body.ingredient).toBe('');
    expect(body.target_qty).toBe(10);
    expect(body.unit).toBe('qt');
  });

  test('posts correct body when ingredient is provided', async () => {
    mockFetchOk({ ok: true, id: 2, isInsert: true });
    render(<AddPrepParRow locationId="loc-b" />);
    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    await userEvent.type(screen.getByLabelText(/ingredient/i), 'TOMATO, ROMA');
    await userEvent.type(screen.getByLabelText(/target qty/i), '5');
    await userEvent.type(screen.getByLabelText(/unit/i), 'lb');

    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/prep-par');
    const body = JSON.parse(opts.body);
    expect(body.location_id).toBe('loc-b');
    expect(body.recipe_slug).toBe('');
    expect(body.ingredient).toBe('TOMATO, ROMA');
    expect(body.target_qty).toBe(5);
  });

  test('calls router.refresh() on success', async () => {
    mockFetchOk({ ok: true, id: 3, isInsert: true });
    render(<AddPrepParRow locationId="default" />);
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    await userEvent.type(screen.getByLabelText(/recipe/i), 'pico');

    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
  });

  test('shows inline error on API failure', async () => {
    mockFetchError();
    render(<AddPrepParRow locationId="default" />);
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    await userEvent.type(screen.getByLabelText(/recipe/i), 'pico');

    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  test('includes station_id in body when provided', async () => {
    mockFetchOk({ ok: true, id: 4, isInsert: true });
    render(<AddPrepParRow locationId="default" />);
    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    await userEvent.type(screen.getByLabelText(/recipe/i), 'beer_batter');
    await userEvent.type(screen.getByLabelText(/station/i), 'Sauté');

    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.station_id).toBe('Sauté');
  });
});

// ── DeletePrepParRow ──────────────────────────────────────────────────────

import DeletePrepParRow from '../prep/par/DeletePrepParRow';

describe('DeletePrepParRow', () => {
  test('renders a remove button initially', () => {
    render(<DeletePrepParRow id={7} label="beer_batter" locationId="default" />);
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  test('shows confirm/cancel after clicking remove', async () => {
    render(<DeletePrepParRow id={7} label="beer_batter" locationId="default" />);
    await userEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  test('cancel returns to remove state without fetching', async () => {
    global.fetch = jest.fn();
    render(<DeletePrepParRow id={7} label="beer_batter" locationId="default" />);
    await userEvent.click(screen.getByRole('button', { name: /remove/i }));
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('issues DELETE to /api/prep-par?id=<id> on confirm', async () => {
    mockFetchOk({ ok: true });
    render(<DeletePrepParRow id={42} label="beer_batter" locationId="loc-a" />);
    await userEvent.click(screen.getByRole('button', { name: /remove/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/prep-par?id=42');
    expect(opts.method).toBe('DELETE');
    const body = JSON.parse(opts.body);
    expect(body.location_id).toBe('loc-a');
  });

  test('calls router.refresh() after successful DELETE', async () => {
    mockFetchOk({ ok: true });
    render(<DeletePrepParRow id={42} label="beer_batter" locationId="default" />);
    await userEvent.click(screen.getByRole('button', { name: /remove/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
  });

  test('does not call router.refresh() on DELETE failure', async () => {
    mockFetchError();
    render(<DeletePrepParRow id={42} label="beer_batter" locationId="default" />);
    await userEvent.click(screen.getByRole('button', { name: /remove/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
