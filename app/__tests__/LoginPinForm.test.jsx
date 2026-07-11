// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts.
// LoginPinForm jsdom test — the error line must distinguish a wrong PIN
// (401) from server-reported conditions (429 rate limit, 500
// misconfiguration, 503 setup required). Pre-fix the form collapsed
// EVERY non-OK response into "Wrong PIN", hiding the actionable
// message the route already returns (Codex review on #464).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

import LoginPinForm from '../login-pin/LoginPinForm.jsx';

function mockPinResponse({ ok = false, status = 401, body = {} }) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

afterEach(() => {
  jest.clearAllMocks();
});

async function submitPin() {
  fireEvent.change(screen.getByLabelText('Manager PIN'), { target: { value: '4242' } });
  fireEvent.click(screen.getByRole('button'));
}

describe('LoginPinForm error surfacing', () => {
  test('401 still reads "Wrong PIN" (no server detail leaked)', async () => {
    mockPinResponse({ status: 401, body: { error: 'invalid pin' } });
    render(<LoginPinForm />);
    await submitPin();
    await waitFor(() => expect(screen.getByText('Wrong PIN')).toBeInTheDocument());
  });

  test('500 misconfiguration shows plain owner copy — never raw server text (UI copy rules)', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockPinResponse({
      status: 500,
      body: { error: 'PIN sign-in is not fully configured: LARIAT_PIN_SECRET is required in production.' },
    });
    render(<LoginPinForm />);
    await submitPin();
    await waitFor(() =>
      expect(screen.getByText(/Ask the owner to check setup/)).toBeInTheDocument(),
    );
    // No dev jargon on a cook-facing screen; no "Wrong PIN" either.
    expect(screen.queryByText(/LARIAT_PIN_SECRET/)).not.toBeInTheDocument();
    expect(screen.queryByText('Wrong PIN')).not.toBeInTheDocument();
    // The raw detail still reaches ops via the console.
    expect(errSpy).toHaveBeenCalledWith(
      'PIN sign-in failed:', 500, expect.stringContaining('LARIAT_PIN_SECRET'),
    );
    errSpy.mockRestore();
  });

  test('429 rate limit shows the wait message', async () => {
    mockPinResponse({
      status: 429,
      body: { error: 'Too many attempts. Wait a minute and try again.' },
    });
    render(<LoginPinForm />);
    await submitPin();
    await waitFor(() =>
      expect(screen.getByText(/Too many attempts/)).toBeInTheDocument(),
    );
  });

  test('non-401 with an unreadable body still shows the owner copy', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('no body')),
    });
    render(<LoginPinForm />);
    await submitPin();
    await waitFor(() =>
      expect(screen.getByText(/Ask the owner to check setup/)).toBeInTheDocument(),
    );
  });
});
