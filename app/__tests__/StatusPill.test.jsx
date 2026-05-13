// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import StatusPill from '../playbook/StatusPill';

describe('StatusPill', () => {
  test.each([
    ['y', 'meta_ads', 'pill-green'],
    ['n', 'meta_ads', 'pill-red'],
    ['-', 'meta_ads', 'pill-neutral'],
    ['', 'meta_ads', 'pill-neutral'],
    ['pending', 'co_host_sent', 'pill-amber'],
    ['w', 'newsletter', 'pill-amber'],
    ['jb, bit, sk', 'listing_jambase_bit_songkick', 'pill-green'],
    ['6.0', 'posts', 'pill-green'],
  ])('value %j on column %j gets class %s', (value, column, klass) => {
    const { container } = render(<StatusPill value={value} column={column} />);
    expect(container.firstChild).toHaveClass(klass);
  });

  test('renders the literal label for detail strings', () => {
    render(<StatusPill value="jb, bit, sk" column="listing_jambase_bit_songkick" />);
    expect(screen.getByText('jb, bit, sk')).toBeInTheDocument();
  });
});
