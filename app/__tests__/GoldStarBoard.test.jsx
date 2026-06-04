// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GoldStarBoard from '../gold-stars/GoldStarBoard';

function mockInitialFetch() {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/staff')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ id: 'cook-1', first: 'Maya', last: 'Rivera', active: true }]),
      });
    }
    if (String(url).includes('/api/gold-stars') && !String(url).includes('/api/gold-stars/')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([
          {
            id: 1,
            cook_name: 'Maya Rivera',
            reason: 'Jumped on pantry when the rail filled up.',
            stars: 2,
            awarded_date: '2026-06-04',
          },
        ]),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  });
}

describe('GoldStarBoard', () => {
  beforeEach(() => {
    mockInitialFetch();
    jest.spyOn(window, 'confirm').mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('uses a page-level Gold Stars heading', async () => {
    render(<GoldStarBoard />);

    expect(await screen.findByRole('heading', { level: 1, name: /gold stars/i })).toBeInTheDocument();
  });

  test('does not delete a star when the manager cancels the confirmation', async () => {
    render(<GoldStarBoard />);

    fireEvent.click(await screen.findByRole('button', { name: /remove/i }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/remove this gold star/i));
    await waitFor(() => {
      expect(global.fetch).not.toHaveBeenCalledWith(
        '/api/gold-stars/1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
    expect(screen.getByText(/Jumped on pantry/i)).toBeInTheDocument();
  });
});
