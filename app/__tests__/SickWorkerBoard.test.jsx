// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
// Regression for a bug found during the GH #250 checkjs migration:
// SickWorkerPage read `const jar = cookies();` instead of
// `const jar = await cookies();`. Next 15+ `cookies()` returns a
// Promise, not the cookie jar — the unawaited call left `jar` without
// a `.get` method. In production that throws (`jar.get is not a
// function`, 500ing the page); under Next's dev-mode back-compat shim
// it silently resolved every `.get()` to `undefined`, so `pinOk` was
// ALWAYS false and the PIC-only filing/clearing form + "Recently
// cleared" history were hidden from every authenticated manager —
// undetected because this page had zero test coverage.
import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

// Mutable so each test can flip whether the request "sent" the manager
// PIN cookie, without needing jest.resetModules() (which would load a
// second React copy and break hooks).
let mockPinCookieValue = /** @type {string | undefined} */ (undefined);

jest.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get(name) {
        return name === 'lariat_pin_ok' && mockPinCookieValue
          ? { name, value: mockPinCookieValue }
          : undefined;
      },
    }),
}));

jest.mock('../../lib/pin', () => ({
  pinCookieValueAuthorized: async (value) => value === 'authorized-token',
}));

jest.mock('../../lib/db', () => ({
  getDb: () => ({
    prepare: () => ({ all: () => [] }),
  }),
}));

jest.mock('../../lib/data', () => ({
  getStaff: () => [],
}));

jest.mock('../../lib/location', () => ({
  DEFAULT_LOCATION_ID: 'default',
}));

import SickWorkerPage from '../food-safety/sick-worker/page.jsx';

describe('SickWorkerPage — awaits cookies() before reading the PIN cookie', () => {
  afterEach(() => {
    mockPinCookieValue = undefined;
  });

  test('an authorized manager PIN cookie unlocks the filing form', async () => {
    mockPinCookieValue = 'authorized-token';
    render(await SickWorkerPage({ searchParams: {} }));
    expect(screen.getByText('File a new report')).toBeInTheDocument();
  });

  test('no PIN cookie keeps the form hidden and shows the login prompt', async () => {
    mockPinCookieValue = undefined;
    render(await SickWorkerPage({ searchParams: {} }));
    expect(screen.queryByText('File a new report')).not.toBeInTheDocument();
    expect(screen.getByText(/Filing and clearing reports requires the manager PIN/)).toBeInTheDocument();
  });
});
