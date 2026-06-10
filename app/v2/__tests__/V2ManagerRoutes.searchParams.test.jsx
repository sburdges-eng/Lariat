// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children),
}));

jest.mock('../../command/page.jsx', () => ({
  __esModule: true,
  default: ({ searchParams }) => React.createElement('div', {
    'data-testid': 'command-page',
    'data-search-params-type': typeof searchParams?.then === 'function' ? 'promise' : typeof searchParams,
  }),
}));

jest.mock('../../management/page.jsx', () => ({
  __esModule: true,
  default: ({ searchParams }) => React.createElement('div', {
    'data-testid': 'management-page',
    'data-search-params-type': typeof searchParams?.then === 'function' ? 'promise' : typeof searchParams,
  }),
}));

jest.mock('../../analytics/page.jsx', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'data-testid': 'analytics-page' }),
}));

import V2CommandPage from '../command/page.jsx';
import V2ManagementPage from '../management/page.jsx';
import V2AnalyticsPage from '../analytics/page.jsx';

describe('v2 manager routes', () => {
  test('v2 command awaits Promise searchParams before building jump links', async () => {
    render(await V2CommandPage({ searchParams: Promise.resolve({ location: 'prep-line' }) }));

    expect(screen.getByRole('link', { name: /back to line/i })).toHaveAttribute('href', '/v2/today?location=prep-line');
    expect(screen.getByRole('link', { name: /morning digest/i })).toHaveAttribute('href', '/morning?location=prep-line');
    expect(screen.getByTestId('command-page')).toHaveAttribute('data-search-params-type', 'promise');
  });

  test('v2 management awaits Promise searchParams before building jump links', async () => {
    render(await V2ManagementPage({ searchParams: Promise.resolve({ location: 'expo' }) }));

    expect(screen.getByRole('link', { name: /back to command/i })).toHaveAttribute('href', '/v2/command?location=expo');
    expect(screen.getByRole('link', { name: /open analytics/i })).toHaveAttribute('href', '/v2/analytics?location=expo');
    expect(screen.getByTestId('management-page')).toHaveAttribute('data-search-params-type', 'promise');
  });

  test('v2 analytics awaits Promise searchParams before building jump links', async () => {
    render(await V2AnalyticsPage({ searchParams: Promise.resolve({ location: 'bar' }) }));

    expect(screen.getByRole('link', { name: /back to management/i })).toHaveAttribute('href', '/v2/management?location=bar');
    expect(screen.getByRole('link', { name: /open morning/i })).toHaveAttribute('href', '/morning?location=bar');
    expect(screen.getByTestId('analytics-page')).toBeInTheDocument();
  });
});
