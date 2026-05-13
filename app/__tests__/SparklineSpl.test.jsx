/** @jest-environment jsdom */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import SparklineSpl from '../shows/[id]/sound/_components/SparklineSpl';

function mockFetchOnce(data) {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

describe('SparklineSpl', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ readings: [] }),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.fetch;
  });

  test('renders the empty state when no readings come back', async () => {
    mockFetchOnce({ readings: [] });
    await act(async () => {
      render(
        <SparklineSpl
          showId={1}
          locationId="default"
          sceneId={null}
          sceneSplLimit={null}
        />,
      );
    });
    expect(screen.getByText(/no readings yet/i)).toBeTruthy();
  });

  test('renders a path when readings come back', async () => {
    mockFetchOnce({
      readings: [
        { db_value: 90, taken_at: 't1' },
        { db_value: 95, taken_at: 't2' },
        { db_value: 102, taken_at: 't3' },
      ],
    });
    let container;
    await act(async () => {
      const r = render(
        <SparklineSpl
          showId={1}
          locationId="default"
          sceneId={null}
          sceneSplLimit={100}
        />,
      );
      container = r.container;
    });
    // Sparkline path is the only <path> the component renders.
    expect(container.querySelector('path')).toBeTruthy();
    expect(container.querySelector('line')).toBeTruthy(); // threshold line at 100 dB
  });

  test('does not render threshold line when no limit', async () => {
    mockFetchOnce({
      readings: [{ db_value: 90, taken_at: 't1' }],
    });
    let container;
    await act(async () => {
      const r = render(
        <SparklineSpl
          showId={1}
          locationId="default"
          sceneId={null}
          sceneSplLimit={null}
        />,
      );
      container = r.container;
    });
    expect(container.querySelector('line')).toBeFalsy();
  });
});
