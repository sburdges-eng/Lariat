// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
// UnmappedCallout jsdom test (T6) — shared warning band for cascade panels.
// Strict TDD: written before T6 implementation exists.

import React from 'react';
import { render, screen } from '@testing-library/react';
import UnmappedCallout from '../beo/_components/UnmappedCallout';

it('renders nothing when everything is empty', () => {
  const { container } = render(<UnmappedCallout unmapped={[]} />);
  expect(container.firstChild).toBeNull();
});

it('renders on_hand_unapplied even when unmapped/error are empty', () => {
  render(<UnmappedCallout unmapped={[]} onHandUnapplied={[
    { ingredient: 'sysco flour', unit: 'case', on_hand: 4, reason: 'no matching order-guide leaf (ingredient/unit)' },
  ]} />);
  expect(screen.getByText(/sysco flour/i)).toBeInTheDocument();
});

it('renders manifest_warnings even when unmapped/error are empty', () => {
  render(<UnmappedCallout unmapped={[]} manifestWarnings={[
    { recipe: 'beer_batter', sub_slug: 'beer_flour', issue: "declares sub-recipe 'beer_flour' but no BOM row references it" },
  ]} />);
  expect(screen.getByText(/beer_batter/i)).toBeInTheDocument();
});
