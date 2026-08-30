// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */
// Both specials routes scope by location — locationFromBodyOrRequest in
// app/api/specials/route.js:79 and app/api/specials/saved/route.js:76 — and
// saved_specials carries a location_id column. The page sent neither fetch a
// location, so a special written at one venue was saved under 'default' and
// showed up on the wrong board.
//
// navRegistry already marks /specials and /specials/saved locAware, so the nav
// was sending ?location=west and the page was ignoring it.

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let mockSearchParams = new URLSearchParams('');
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

import SpecialsPage from '../page';

beforeEach(() => {
  window.localStorage.clear();
  mockSearchParams = new URLSearchParams('location=west');
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ model: 'lari', ollamaReachable: true, answer: 'Try a pork belly app.' }),
  });
});

afterEach(() => jest.restoreAllMocks());

function postBodies(pathFragment) {
  return global.fetch.mock.calls
    .filter(([u, init]) => String(u).includes(pathFragment) && init && init.method === 'POST')
    .map(([, init]) => JSON.parse(init.body));
}

describe('/specials carries the active location', () => {
  it('files the ask against the venue in the URL', async () => {
    render(<SpecialsPage />);
    const box = await screen.findByPlaceholderText(/pork belly appetizer/i);
    fireEvent.change(box, { target: { value: 'something with the tomatoes' } });
    fireEvent.click(screen.getByRole('button', { name: /run it/i }));

    await waitFor(() => {
      const bodies = postBodies('/api/specials');
      expect(bodies.length).toBeGreaterThan(0);
      expect(bodies[0].location_id).toBe('west');
    });
  });

  it('sends the default venue when none is named', async () => {
    mockSearchParams = new URLSearchParams('');
    render(<SpecialsPage />);
    const box = await screen.findByPlaceholderText(/pork belly appetizer/i);
    fireEvent.change(box, { target: { value: 'something' } });
    fireEvent.click(screen.getByRole('button', { name: /run it/i }));

    await waitFor(() => {
      const bodies = postBodies('/api/specials');
      expect(bodies.length).toBeGreaterThan(0);
      expect(bodies[0].location_id).toBe('default');
    });
  });
});
