// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
// Regression for a bug found during the GH #250 checkjs migration:
// the Today/Upcoming view-tab links were hardcoded to
// `/reservations?view=today` / `/reservations?view=upcoming` and never
// carried the caller's `location` query param. app/reservations/page.jsx
// resolves its location scope from `searchParams.location` only (see
// DEFAULT_LOCATION_ID fallback there) — so at any non-default location,
// clicking a view tab silently dropped the board back to the default
// location's book (and any subsequent seat/complete/cancel/delete action
// then wrote against the wrong location). Masked in single-location
// installs because both sides defaulted to 'default'. Same class of bug,
// same fix convention (`locQ`), as app/labor/breaks/BreakBoard.jsx.
import React from 'react';
import { render, screen } from '@testing-library/react';
import ReservationsBoard from '../reservations/ReservationsBoard';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

jest.mock('next/link', () => {
  const Link = ({ href, children, ...props }) => (
    <a href={href} {...props}>
      {children}
    </a>
  );
  Link.displayName = 'Link';
  return Link;
});

describe('ReservationsBoard view tabs carry the caller location', () => {
  test('at a non-default location, both view tabs append ?location=', () => {
    render(
      <ReservationsBoard rows={[]} date="2026-07-12" view="today" locationId="bar" />,
    );

    const todayTab = screen.getByRole('tab', { name: /today/i });
    const upcomingTab = screen.getByRole('tab', { name: /upcoming/i });

    expect(todayTab).toHaveAttribute('href', '/reservations?view=today&location=bar');
    expect(upcomingTab).toHaveAttribute(
      'href',
      '/reservations?view=upcoming&location=bar',
    );
  });

  test('at the default location, no location param is appended', () => {
    render(
      <ReservationsBoard rows={[]} date="2026-07-12" view="today" locationId="default" />,
    );

    const todayTab = screen.getByRole('tab', { name: /today/i });
    const upcomingTab = screen.getByRole('tab', { name: /upcoming/i });

    expect(todayTab).toHaveAttribute('href', '/reservations?view=today');
    expect(upcomingTab).toHaveAttribute('href', '/reservations?view=upcoming');
  });
});
