// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */
//
// Regression for the T7 location-scoping gap (same bug class as
// AnalyticsPage.searchParams / KitchenAssistantClient.location):
// /management/performance-reviews/page.jsx did not read
// `searchParams.location` at all, and PerformanceReviewBoard fetched
// '/api/performance-reviews' with zero location awareness — even
// though the API route DOES scope by locationFromRequest (GET/DELETE)
// and locationFromBody (POST), and the table has location_id. A
// manager at a non-default location would silently read, log, and
// (fail to) delete reviews against the DEFAULT location's HR records.
//
// Convention under test (app/labor/breaks + eighty-six pattern):
// page awaits searchParams -> derives loc (DEFAULT_LOCATION_ID
// fallback) -> passes locationId to the board -> board appends
// `?location=` (locQ) to its performance-reviews fetches and puts
// location_id in the POST body. /api/staff is deliberately
// location-less (global roster) and gets no query.
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

import PerformanceReviewsPage from '../management/performance-reviews/page.jsx';
import PerformanceReviewBoard from '../management/performance-reviews/PerformanceReviewBoard';

const ROSTER = [{ id: 'c1', first: 'Alice', last: 'Ang', active: true }];
const REVIEW = {
  id: 41,
  cook_name: 'Alice Ang',
  cook_uuid: 'c1',
  review_date: '2026-07-01',
  punctuality_score: 5,
  technique_score: 4,
  speed_score: 5,
  notes: null,
  reviewer_name: 'Chef Bob',
};

beforeEach(() => {
  global.fetch = jest.fn((url, opts) => {
    if (String(url).startsWith('/api/staff')) {
      return Promise.resolve({ ok: true, json: async () => ROSTER });
    }
    if (opts && opts.method === 'POST') {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, id: 99 }) });
    }
    if (opts && opts.method === 'DELETE') {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, id: 41 }) });
    }
    return Promise.resolve({ ok: true, json: async () => [REVIEW] });
  });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function reviewsGetCalls() {
  return global.fetch.mock.calls.filter(
    ([url, opts]) =>
      String(url).startsWith('/api/performance-reviews') && (!opts || !opts.method),
  );
}

describe('PerformanceReviewsPage — searchParams round trip', () => {
  test('awaits Promise searchParams and the board fetches reviews scoped to ?location=', async () => {
    render(await PerformanceReviewsPage({ searchParams: Promise.resolve({ location: 'west' }) }));
    await screen.findByText('Staff Reviews');

    const gets = reviewsGetCalls();
    expect(gets.length).toBe(1);
    expect(gets[0][0]).toBe('/api/performance-reviews?location=west');
  });

  test('falls back to the default location (bare URL, matching the rollup tile link)', async () => {
    render(await PerformanceReviewsPage({ searchParams: Promise.resolve({}) }));
    await screen.findByText('Staff Reviews');

    const gets = reviewsGetCalls();
    expect(gets.length).toBe(1);
    expect(gets[0][0]).toBe('/api/performance-reviews');
  });
});

describe('PerformanceReviewBoard — location on writes', () => {
  test('POST carries location_id in the body and ?location= on the URL', async () => {
    render(<PerformanceReviewBoard locationId="west" />);
    await screen.findByText('Staff Reviews');

    fireEvent.click(screen.getByRole('button', { name: 'Log Review' }));
    // The "Who" label has no htmlFor; target the select by its placeholder option.
    fireEvent.change(screen.getByDisplayValue('Pick a cook...'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByPlaceholderText('Manager Name'), {
      target: { value: 'Chef Carol' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Review' }));
    });

    const postCall = global.fetch.mock.calls.find(([, opts]) => opts && opts.method === 'POST');
    expect(postCall).toBeTruthy();
    expect(postCall[0]).toBe('/api/performance-reviews?location=west');
    expect(JSON.parse(postCall[1].body).location_id).toBe('west');
  });

  test('DELETE appends ?location= so the row-scoped delete hits the right location', async () => {
    render(<PerformanceReviewBoard locationId="west" />);
    await screen.findByText('Staff Reviews');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    });

    const delCall = global.fetch.mock.calls.find(([, opts]) => opts && opts.method === 'DELETE');
    expect(delCall).toBeTruthy();
    expect(delCall[0]).toBe('/api/performance-reviews/41?location=west');
  });

  test('default location keeps bare fetch URLs (single-site behavior unchanged)', async () => {
    render(<PerformanceReviewBoard locationId="default" />);
    await screen.findByText('Staff Reviews');

    await waitFor(() => expect(reviewsGetCalls().length).toBe(1));
    expect(reviewsGetCalls()[0][0]).toBe('/api/performance-reviews');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    });
    const delCall = global.fetch.mock.calls.find(([, opts]) => opts && opts.method === 'DELETE');
    expect(delCall[0]).toBe('/api/performance-reviews/41');
  });
});
