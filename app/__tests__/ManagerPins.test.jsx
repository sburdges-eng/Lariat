// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts.
// ManagerPinsPage jsdom test — load, add, edit, and disable manager PINs.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ManagerPinsPage from '../management/pins/page';

function mockSequence(responses) {
  global.fetch = jest.fn().mockImplementation(() => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    return Promise.resolve({
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: () => Promise.resolve(next.body ?? {}),
    });
  });
}

afterEach(() => {
  jest.clearAllMocks();
});

beforeAll(() => {
  window.confirm = jest.fn(() => true);
});

describe('ManagerPinsPage', () => {
  test('loads and renders the empty state', async () => {
    mockSequence([{ body: { users: [] } }]);
    render(<ManagerPinsPage />);

    await waitFor(() => {
      expect(screen.getByText(/none yet/i)).toBeInTheDocument();
    });
  });

  test('adds a manager PIN', async () => {
    mockSequence([
      { body: { users: [] } },
      {
        body: {
          user: {
            id: 5,
            name: 'Lunch Lead',
            role: 'manager',
            is_active: true,
            updated_at: '2026-05-29 12:00:00',
          },
        },
      },
      {
        body: {
          users: [
            {
              id: 5,
              name: 'Lunch Lead',
              role: 'manager',
              is_active: true,
              updated_at: '2026-05-29 12:00:00',
            },
          ],
        },
      },
    ]);
    render(<ManagerPinsPage />);
    await waitFor(() => screen.getByText(/none yet/i));

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Lunch Lead' } });
    fireEvent.change(screen.getByLabelText(/^pin$/i), { target: { value: '1111' } });
    fireEvent.click(screen.getByRole('button', { name: /add pin/i }));

    await waitFor(() => expect(screen.getByText('Lunch Lead')).toBeInTheDocument());
    const addCall = global.fetch.mock.calls[1];
    expect(addCall[0]).toBe('/api/auth/manager-pins');
    expect(addCall[1].method).toBe('POST');
    expect(JSON.parse(addCall[1].body)).toEqual({
      name: 'Lunch Lead',
      pin: '1111',
      role: 'manager',
    });
  });

  test('edits a manager PIN without showing stored hashes', async () => {
    mockSequence([
      {
        body: {
          users: [
            {
              id: 7,
              name: 'Dinner Lead',
              role: 'manager',
              is_active: true,
              updated_at: '2026-05-29 12:00:00',
              pin_hash: 'should-not-render',
            },
          ],
        },
      },
      {
        body: {
          user: {
            id: 7,
            name: 'Closing Lead',
            role: 'owner',
            is_active: true,
            updated_at: '2026-05-29 12:10:00',
          },
        },
      },
      {
        body: {
          users: [
            {
              id: 7,
              name: 'Closing Lead',
              role: 'owner',
              is_active: true,
              updated_at: '2026-05-29 12:10:00',
            },
          ],
        },
      },
    ]);
    render(<ManagerPinsPage />);
    await waitFor(() => screen.getByText('Dinner Lead'));
    expect(screen.queryByText('should-not-render')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /edit dinner lead/i }));
    fireEvent.change(screen.getByLabelText(/edit name/i), { target: { value: 'Closing Lead' } });
    fireEvent.change(screen.getByLabelText(/new pin/i), { target: { value: '2222' } });
    fireEvent.change(screen.getByLabelText(/edit role/i), { target: { value: 'owner' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(screen.getByText('Closing Lead')).toBeInTheDocument());
    const editCall = global.fetch.mock.calls[1];
    expect(editCall[0]).toBe('/api/auth/manager-pins');
    expect(editCall[1].method).toBe('PATCH');
    expect(JSON.parse(editCall[1].body)).toEqual({
      id: 7,
      name: 'Closing Lead',
      pin: '2222',
      role: 'owner',
      is_active: true,
    });
  });

  test('turns off a manager PIN after confirmation', async () => {
    mockSequence([
      {
        body: {
          users: [
            {
              id: 9,
              name: 'Brunch Lead',
              role: 'manager',
              is_active: true,
              updated_at: '2026-05-29 12:00:00',
            },
          ],
        },
      },
      {
        body: {
          user: {
            id: 9,
            name: 'Brunch Lead',
            role: 'manager',
            is_active: false,
            updated_at: '2026-05-29 12:10:00',
          },
        },
      },
      {
        body: {
          users: [
            {
              id: 9,
              name: 'Brunch Lead',
              role: 'manager',
              is_active: false,
              updated_at: '2026-05-29 12:10:00',
            },
          ],
        },
      },
    ]);
    render(<ManagerPinsPage />);
    await waitFor(() => screen.getByText('Brunch Lead'));

    fireEvent.click(screen.getByRole('button', { name: /turn off brunch lead/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
    const offCall = global.fetch.mock.calls[1];
    expect(offCall[0]).toBe('/api/auth/manager-pins');
    expect(offCall[1].method).toBe('DELETE');
    expect(JSON.parse(offCall[1].body)).toEqual({ id: 9 });
  });
});
