// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
// Regression for a real bug found during the GH #250 checkjs migration:
// app/labor/page.jsx's Certifications tile summed staff_certifications
// expiry/soon/total counts without the `active = 1` filter that every
// other consumer of this table already applies — lib/commandCenter.ts
// and lib/dbQueryRegistry.ts both filter `active = 1`, and this tile's
// own sibling detail page (app/labor/certs/CertBoard.jsx) explicitly
// renders `active === 0` rows as 'muted', never red/amber. A retired
// cert (the worker left, or the cert was renewed and the old row
// deactivated) with a stale expires_on could flip the Certifications
// tile red for a liability that doesn't actually exist — exactly the
// kind of false alarm a "what are we liable for right now" dashboard
// (this page's own stated design intent) cannot afford, since it
// erodes the manager's trust in every other red/amber on the page.
import { render, screen, within } from '@testing-library/react';

import * as db from '../../lib/db.ts';
import LaborHub from '../labor/page.jsx';

beforeAll(() => {
  db.setDbPathForTest(':memory:');
});

afterAll(() => {
  db.setDbPathForTest(null);
});

beforeEach(() => {
  const conn = db.getDb();
  conn.exec(`DELETE FROM staff_certifications;`);
});

/** @param {{ cookId?: string, active: boolean, expiresOn: string }} opts */
function seedCert({ cookId = 'cook-1', active, expiresOn }) {
  const conn = db.getDb();
  conn
    .prepare(
      `INSERT INTO staff_certifications
         (location_id, cook_id, cert_type, cert_label, expires_on, active)
       VALUES ('default', ?, 'cfpm', 'ServSafe Manager', ?, ?)`,
    )
    .run(cookId, expiresOn, active ? 1 : 0);
}

function certsLine(certsLink, label) {
  return within(certsLink).getByText(label).closest('li');
}

describe('LaborHub — Certifications tile only counts active certs toward expired/soon/total', () => {
  test('an inactive (retired/superseded) cert with a past expiry does not turn the tile red', async () => {
    seedCert({ active: false, expiresOn: '2020-01-01' });

    render(await LaborHub({ searchParams: {} }));

    const certsLink = screen.getByText('Certifications').closest('a');
    expect(certsLink).toHaveClass('fs-tile-green');
    expect(certsLink).not.toHaveClass('fs-tile-red');

    expect(within(certsLine(certsLink, 'expired')).getByText('0')).toBeInTheDocument();
    expect(within(certsLine(certsLink, 'tracked certs')).getByText('0')).toBeInTheDocument();
  });

  test('an active cert with a past expiry still turns the tile red (control case)', async () => {
    seedCert({ active: true, expiresOn: '2020-01-01' });

    render(await LaborHub({ searchParams: {} }));

    const certsLink = screen.getByText('Certifications').closest('a');
    expect(certsLink).toHaveClass('fs-tile-red');

    expect(within(certsLine(certsLink, 'expired')).getByText('1')).toBeInTheDocument();
    expect(within(certsLine(certsLink, 'tracked certs')).getByText('1')).toBeInTheDocument();
  });

  test('a mix of an active-expired and an inactive-expired cert counts only the active one', async () => {
    seedCert({ cookId: 'cook-1', active: true, expiresOn: '2020-01-01' });
    seedCert({ cookId: 'cook-2', active: false, expiresOn: '2020-01-01' });

    render(await LaborHub({ searchParams: {} }));

    const certsLink = screen.getByText('Certifications').closest('a');
    expect(within(certsLine(certsLink, 'expired')).getByText('1')).toBeInTheDocument();
    expect(within(certsLine(certsLink, 'tracked certs')).getByText('1')).toBeInTheDocument();
  });
});
