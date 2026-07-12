// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
// Regression for a dormant information-exposure gap found during the
// GH #250 checkjs migration: app/beo/share/[token]/page.jsx (the public
// SSR guest doc, which bypasses the PIN gate entirely — see
// middleware.js PUBLIC_CARVEOUTS) looked up the event by share_token
// alone, without the share_revoked_at/share_expires_at guard that both
// sibling API routes (GET /api/beo/share/[token], POST .../sign)
// already enforce. Nothing sets those columns non-null in production
// today, so this was not yet a live incident — but the schema/API guard
// already anticipates a "revoke share link" feature, and the moment
// that ships, a revoked/expired link would still render the guest's
// full name, guest count, notes, and pricing via this page even though
// re-fetching via the API would correctly 404.
import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));

import * as db from '../../lib/db.ts';
import BeoSharePage from '../beo/share/[token]/page.jsx';

// Must satisfy lib/beoShare.ts's isValidShareTokenShape: exactly 32
// lowercase hex chars, or the page 404s before ever reaching the
// revocation check this test exists to cover.
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

beforeAll(() => {
  db.setDbPathForTest(':memory:');
});

afterAll(() => {
  db.setDbPathForTest(null);
});

beforeEach(() => {
  const conn = db.getDb();
  conn.exec(
    `DELETE FROM beo_signatures;
     DELETE FROM beo_line_items;
     DELETE FROM beo_courses;
     DELETE FROM beo_events;`,
  );
});

function seedEvent({ revokedAt = null, expiresAt = null } = {}) {
  const conn = db.getDb();
  const r = conn
    .prepare(
      `INSERT INTO beo_events
         (title, event_date, event_time, contact_name, guest_count, notes,
          tax_rate, service_fee_pct, location_id, share_token, share_revoked_at, share_expires_at)
       VALUES (?, '2026-06-15', '5:00pm', 'Sarah Hendricks', 80, 'No nuts please.', 0.0675, 20, 'default', ?, ?, ?)`,
    )
    .run('Hendricks Wedding', TOKEN, revokedAt, expiresAt);
  return Number(r.lastInsertRowid);
}

describe('BeoSharePage — enforces share_revoked_at/share_expires_at like the API routes', () => {
  test('renders the guest doc for an active, non-revoked share link', async () => {
    seedEvent();
    render(await BeoSharePage({ params: { token: TOKEN } }));
    expect(screen.queryByText("This invitation isn't available")).not.toBeInTheDocument();
    expect(screen.getByText('Hendricks Wedding')).toBeInTheDocument();
  });

  test('renders "not available" for a revoked share link (not the guest doc)', async () => {
    seedEvent({ revokedAt: '2026-07-01T00:00:00.000Z' });
    render(await BeoSharePage({ params: { token: TOKEN } }));
    expect(screen.getByText("This invitation isn't available")).toBeInTheDocument();
    expect(screen.queryByText('Hendricks Wedding')).not.toBeInTheDocument();
  });

  test('renders "not available" for an expired share link (not the guest doc)', async () => {
    seedEvent({ expiresAt: '2020-01-01T00:00:00.000Z' });
    render(await BeoSharePage({ params: { token: TOKEN } }));
    expect(screen.getByText("This invitation isn't available")).toBeInTheDocument();
  });

  test('still renders the guest doc when share_expires_at is in the future', async () => {
    seedEvent({ expiresAt: '2099-01-01T00:00:00.000Z' });
    render(await BeoSharePage({ params: { token: TOKEN } }));
    expect(screen.queryByText("This invitation isn't available")).not.toBeInTheDocument();
  });
});
