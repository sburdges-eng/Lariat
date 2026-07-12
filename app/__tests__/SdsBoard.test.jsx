// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
// Regression for a field/type bug found during the GH #250 checkjs
// migration: the board's local HAZARD_CLASSES dropdown list included
// 'other', a value that has never existed in lib/sds.ts's GHS_HAZARD_CLASSES
// enum — the exact enum POST /api/sds::validateSds() enforces. Picking
// "other" and submitting always failed with a 400
// ("hazard_class must be one of: ..."), silently breaking the Add SDS
// form for any chemical that didn't fit the nine canonical GHS classes,
// on an OSHA HazCom compliance board with zero test coverage.
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import SdsBoard from '../food-safety/sds/SdsBoard';
import { GHS_HAZARD_CLASSES } from '../../lib/sds';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

describe('SdsBoard — hazard-class options match the backend enum', () => {
  test('never offers a hazard class the API will reject (e.g. "other")', () => {
    render(<SdsBoard rows={[]} locationId="default" citation="OSHA 29 CFR 1910.1200" />);

    const select = /** @type {HTMLSelectElement} */ (screen.getByLabelText('Hazard class'));
    const optionValues = Array.from(select.options).map((o) => o.value);

    expect(optionValues).not.toContain('other');
  });

  test('offers exactly the blank option plus every GHS_HAZARD_CLASSES value', () => {
    render(<SdsBoard rows={[]} locationId="default" citation="OSHA 29 CFR 1910.1200" />);

    const select = /** @type {HTMLSelectElement} */ (screen.getByLabelText('Hazard class'));
    const optionValues = Array.from(select.options).map((o) => o.value);

    expect(optionValues).toEqual(['', ...GHS_HAZARD_CLASSES]);
  });
});
