// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */
// app/api/beo/route.js scopes every read and write by location —
// GET locationFromRequest, POST locationFromBodyOrRequest. Share-token
// looks up WHERE id = ? AND location_id = ?. The board sent none of its
// fetches a location, so on a non-default venue it listed default-site
// parties and wrote new ones there. Share-token 404'd for any party
// that actually lived at the selected venue.
//
// Same class of bug as GoldStarBoard / RecipeAttestations. CLAUDE.md
// section 8 names this the recurring drop.

import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

let mockSearchParams = new URLSearchParams('');
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

import BeoBoard from '../BeoBoard';

const WEST_EVENT = {
  id: 17,
  title: 'Hendricks Wedding',
  event_date: '2026-06-15',
  event_time: '5:00pm',
  contact_name: 'Sarah Hendricks',
  guest_count: 80,
  notes: null,
  tax_rate: 0.0675,
  service_fee_pct: 20,
  location_id: 'west',
};

beforeEach(() => {
  window.localStorage.clear();
  mockSearchParams = new URLSearchParams('');
  global.fetch = jest.fn().mockImplementation((url) => {
    const u = String(url);
    if (u.includes('/api/beo/courses')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ courses: [] }) });
    }
    if (u.includes('/api/beo') && !u.includes('share-token')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          location_id: 'west',
          events: [WEST_EVENT],
          line_items: [],
        }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ token: 'tok', share_url: '/beo/share/tok' }),
    });
  });
});

afterEach(() => jest.restoreAllMocks());

function beoUrls() {
  return global.fetch.mock.calls
    .map(([u]) => String(u))
    .filter((u) => u.includes('/api/beo'));
}

describe('BeoBoard carries the active location', () => {
  it('scopes its reads to the location in the URL', async () => {
    mockSearchParams = new URLSearchParams('location=west');
    render(<BeoBoard initialMenu={[]} />);

    await waitFor(() => {
      const scoped = beoUrls().filter((u) => u.includes('location=west') && !u.includes('share-token'));
      expect(scoped.some((u) => u.startsWith('/api/beo?location=west') || u.startsWith('/api/beo?location=west&'))).toBe(true);
    });
  });

  it('sends location_id on writes so a new party lands at the selected venue', async () => {
    mockSearchParams = new URLSearchParams('location=west');
    render(<BeoBoard initialMenu={[]} />);

    fireEvent.click(screen.getByText('+ New party'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Bob Clauss'), {
      target: { value: 'Hendricks Wedding' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add party' }));

    await waitFor(() => {
      const posts = global.fetch.mock.calls.filter(([u, init]) => (
        String(u) === '/api/beo' && init?.method === 'POST'
      ));
      expect(posts.length).toBeGreaterThan(0);
      const body = JSON.parse(posts[posts.length - 1][1].body);
      expect(body.location_id).toBe('west');
      expect(body.action).toBe('event');
    });
  });

  it('threads ?location= onto share-token so a west party does not 404', async () => {
    mockSearchParams = new URLSearchParams('location=west');
    render(<BeoBoard initialMenu={[]} />);

    const share = await screen.findByRole('button', { name: 'Share with client' });
    fireEvent.click(share);

    await waitFor(() => {
      const urls = beoUrls().filter((u) => u.includes('share-token'));
      expect(urls.some((u) => u.includes('location=west'))).toBe(true);
    });
  });

  it('sends no location query on a single-venue install', async () => {
    render(<BeoBoard initialMenu={[]} />);
    await waitFor(() => expect(beoUrls().length).toBeGreaterThan(0));
    expect(beoUrls().every((u) => !u.includes('location='))).toBe(true);
  });
});
