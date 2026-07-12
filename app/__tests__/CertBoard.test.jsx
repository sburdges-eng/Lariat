// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
// Regression for a bug found during the GH #250 checkjs migration
// (sibling of the sick-worker fix): CertsPage read `const jar = cookies();`
// instead of `const jar = await cookies();`. Next 15+ `cookies()` returns a
// Promise, not the cookie jar — the unawaited call left `jar` without a
// `.get` method. In production that throws (`jar.get is not a function`,
// 500ing the page); under Next's dev-mode back-compat shim it silently
// resolved every `.get()` to `undefined`, so `pinOk` was ALWAYS false and
// the PIC-only "Add a cert" form + "Retire" buttons were hidden from every
// authenticated manager — undetected because this page had zero test
// coverage.
import React from 'react';
import { render, screen } from '@testing-library/react';

let mockPinCookieValue = /** @type {string | undefined} */ (undefined);

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

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
  todayISO: () => '2026-07-12',
}));

jest.mock('../../lib/data', () => ({
  getStaff: () => [],
}));

jest.mock('../../lib/location', () => ({
  DEFAULT_LOCATION_ID: 'default',
}));

import CertsPage from '../labor/certs/page.jsx';

describe('CertsPage — awaits cookies() before reading the PIN cookie', () => {
  afterEach(() => {
    mockPinCookieValue = undefined;
  });

  test('an authorized manager PIN cookie unlocks the add-cert form', async () => {
    mockPinCookieValue = 'authorized-token';
    render(await CertsPage({ searchParams: {} }));
    expect(screen.getByText('Add a cert')).toBeInTheDocument();
  });

  test('no PIN cookie keeps the form hidden and shows the login prompt', async () => {
    mockPinCookieValue = undefined;
    render(await CertsPage({ searchParams: {} }));
    expect(screen.queryByText('Add a cert')).not.toBeInTheDocument();
    expect(screen.getByText(/Adding or retiring certs requires the manager PIN/)).toBeInTheDocument();
  });
});
