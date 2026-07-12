// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
// Regression for a field-name bug found during the GH #250 checkjs
// migration: scanExpiringBatches() returns `days_until_discard`, but the
// board read `s.days_remaining` (never existed on the type), so every
// active date-mark row silently rendered "NaNd past" / "undefinedd left".
import React from 'react';
import { render, screen } from '@testing-library/react';
import DateMarkBoard from '../food-safety/date-marks/DateMarkBoard';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

describe('DateMarkBoard — days-until-discard display', () => {
  const baseRow = {
    id: 1,
    location_id: 'default',
    item: 'Cooked rice',
    batch_ref: null,
    prepared_on: '2026-07-05',
    discard_on: '2026-07-12',
    discarded_at: null,
    discarded_by_cook_id: null,
    discard_reason: null,
    cook_id: null,
    created_at: '2026-07-05T00:00:00Z',
  };

  test('shows the real days-left count, not "undefinedd left"', () => {
    render(
      <DateMarkBoard
        active={[baseRow]}
        scan={{
          1: { id: 1, item: 'Cooked rice', discard_on: '2026-07-12', days_until_discard: 3, status: 'ok' },
        }}
        recent={[]}
        today="2026-07-09"
        locationId="default"
      />,
    );
    expect(screen.getByText('3d left')).toBeInTheDocument();
  });

  test('shows the real days-past count, not "NaNd past"', () => {
    render(
      <DateMarkBoard
        active={[{ ...baseRow, id: 2, discard_on: '2026-07-07' }]}
        scan={{
          2: { id: 2, item: 'Cooked rice', discard_on: '2026-07-07', days_until_discard: -2, status: 'expired' },
        }}
        recent={[]}
        today="2026-07-09"
        locationId="default"
      />,
    );
    expect(screen.getByText('Expired · 2d past')).toBeInTheDocument();
  });
});
