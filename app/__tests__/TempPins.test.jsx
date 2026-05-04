// TempPinsPage jsdom test (T10) — load, issue, revoke flows.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TempPinsPage from '../management/temp-pins/page';

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
  // jsdom doesn't implement window.confirm
  window.confirm = jest.fn(() => true);
});

describe('TempPinsPage', () => {
  test('loads and renders empty state', async () => {
    mockSequence([{ body: { pins: [] } }]);
    render(<TempPinsPage />);
    await waitFor(() => {
      expect(screen.getByText(/none active/i)).toBeInTheDocument();
    });
  });

  test('renders the active list with label, scopes, expires_at', async () => {
    mockSequence([
      {
        body: {
          pins: [
            {
              id: 7,
              label: 'Sous chef Marco',
              scopes: ['beo.fire_at_edit'],
              issued_at: '2026-05-04T12:00:00.000Z',
              expires_at: '2026-05-05T05:59:00.000Z',
            },
          ],
        },
      },
    ]);
    render(<TempPinsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('active-pin-7')).toBeInTheDocument();
      expect(screen.getByText('Sous chef Marco')).toBeInTheDocument();
    });
    // beo.fire_at_edit appears in both the active list AND the issue
    // form's scope checkbox label — assert it's INSIDE the active row.
    const row = screen.getByTestId('active-pin-7');
    expect(row.textContent).toContain('beo.fire_at_edit');
  });

  test('issue: posts to /api/auth/temp-pin/issue, shows new PIN once', async () => {
    mockSequence([
      { body: { pins: [] } }, // initial load
      {
        body: {
          id: 99,
          pin: '4823',
          label: 'Sous chef Marco',
          expires_at: '2026-05-05T05:59:00.000Z',
          scopes: ['beo.fire_at_edit'],
        },
      },
      { body: { pins: [{ id: 99, label: 'Sous chef Marco', scopes: ['beo.fire_at_edit'], expires_at: '2026-05-05T05:59:00.000Z' }] } }, // reload
    ]);
    render(<TempPinsPage />);
    await waitFor(() => screen.getByText(/none active/i));

    fireEvent.change(screen.getByLabelText(/pin label/i), { target: { value: 'Sous chef Marco' } });
    fireEvent.click(screen.getByRole('button', { name: /make pin/i }));

    await waitFor(() => expect(screen.getByTestId('issued-banner')).toBeInTheDocument());
    expect(screen.getByText('4823')).toBeInTheDocument();

    // POST body shape
    const issueCall = global.fetch.mock.calls[1];
    expect(issueCall[0]).toBe('/api/auth/temp-pin/issue');
    const body = JSON.parse(issueCall[1].body);
    expect(body.label).toBe('Sous chef Marco');
    expect(body.scopes).toEqual(['beo.fire_at_edit']);
    expect(body.expires_at).toMatch(/Z$/);
  });

  test('issue: shows error when label empty', async () => {
    mockSequence([{ body: { pins: [] } }]);
    render(<TempPinsPage />);
    await waitFor(() => screen.getByText(/none active/i));

    fireEvent.click(screen.getByRole('button', { name: /make pin/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/add a name/i);
    // Only the initial GET happened
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('revoke: posts to /api/auth/temp-pin/revoke after confirm', async () => {
    mockSequence([
      {
        body: {
          pins: [
            {
              id: 7,
              label: 'Sous chef Marco',
              scopes: ['beo.fire_at_edit'],
              issued_at: '2026-05-04T12:00:00.000Z',
              expires_at: '2026-05-05T05:59:00.000Z',
            },
          ],
        },
      },
      { body: { id: 7, revoked_at: '2026-05-04T13:00:00.000Z' } },
      { body: { pins: [] } }, // reload after revoke
    ]);
    render(<TempPinsPage />);
    await waitFor(() => screen.getByText('Sous chef Marco'));

    fireEvent.click(screen.getByRole('button', { name: /revoke sous chef marco/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
    const revokeCall = global.fetch.mock.calls[1];
    expect(revokeCall[0]).toBe('/api/auth/temp-pin/revoke');
    expect(JSON.parse(revokeCall[1].body)).toEqual({ id: 7 });
    await waitFor(() => expect(screen.queryByText('Sous chef Marco')).not.toBeInTheDocument());
  });
});
