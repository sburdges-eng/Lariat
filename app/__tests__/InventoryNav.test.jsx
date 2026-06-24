// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';

// Mock next/navigation — InventoryNav calls usePathname()
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

// Mock next/link — renders as a plain <a> in tests
jest.mock('next/link', () => {
  const Link = ({ href, children, ...props }) => (
    <a href={href} {...props}>
      {children}
    </a>
  );
  Link.displayName = 'Link';
  return Link;
});

import { usePathname } from 'next/navigation';
import InventoryNav from '../inventory/_nav';

describe('InventoryNav tab bar', () => {
  test('Counts is the first tab', () => {
    usePathname.mockReturnValue('/inventory/counts');
    render(<InventoryNav />);
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveTextContent('Counts');
  });

  test('Log tab links to /inventory/log', () => {
    usePathname.mockReturnValue('/inventory/counts');
    render(<InventoryNav />);
    const logLink = screen.getByRole('link', { name: /^log$/i });
    expect(logLink).toHaveAttribute('href', '/inventory/log');
  });

  test('four tabs rendered: Counts, Log, Par, Waste', () => {
    usePathname.mockReturnValue('/inventory/counts');
    render(<InventoryNav />);
    expect(screen.getByRole('link', { name: /^counts$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^log$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^par$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^waste$/i })).toBeInTheDocument();
  });

  test('Counts tab is active (aria-current=page) when on /inventory/counts', () => {
    usePathname.mockReturnValue('/inventory/counts');
    render(<InventoryNav />);
    const countsLink = screen.getByRole('link', { name: /^counts$/i });
    expect(countsLink).toHaveAttribute('aria-current', 'page');
    // Log should NOT be active
    const logLink = screen.getByRole('link', { name: /^log$/i });
    expect(logLink).not.toHaveAttribute('aria-current');
  });

  test('Log tab is active when on /inventory/log', () => {
    usePathname.mockReturnValue('/inventory/log');
    render(<InventoryNav />);
    const logLink = screen.getByRole('link', { name: /^log$/i });
    expect(logLink).toHaveAttribute('aria-current', 'page');
    const countsLink = screen.getByRole('link', { name: /^counts$/i });
    expect(countsLink).not.toHaveAttribute('aria-current');
  });

  test('active highlighting works for a counts detail page /inventory/counts/123', () => {
    usePathname.mockReturnValue('/inventory/counts/123');
    render(<InventoryNav />);
    const countsLink = screen.getByRole('link', { name: /^counts$/i });
    expect(countsLink).toHaveAttribute('aria-current', 'page');
  });
});
