#!/usr/bin/env node
// Staff picker names should be clean display names without mutating source data.
//
// Run: node --experimental-strip-types --test tests/js/test-staff-display.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const staffDisplay = await import('../../lib/staffDisplay.ts');

describe('staff display helpers', () => {
  it('title-cases all-caps and lower-case staff names', () => {
    assert.equal(
      staffDisplay.formatStaffDisplayName({ first: 'LUCAS', last: 'NORES' }),
      'Lucas Nores',
    );
    assert.equal(
      staffDisplay.formatStaffDisplayName({ first: 'sean', last: 'burdges' }),
      'Sean Burdges',
    );
  });

  it('keeps junk staff rows out of the picker', () => {
    assert.equal(
      staffDisplay.isDisplayableStaff({ id: 'non_usable_employee', first: 'Non usable', last: 'employee' }),
      false,
    );
    assert.equal(
      staffDisplay.isDisplayableStaff({ id: 'lucas_nores', first: 'LUCAS', last: 'NORES' }),
      true,
    );
  });
});
