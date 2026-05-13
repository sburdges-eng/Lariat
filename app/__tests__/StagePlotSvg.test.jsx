// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import StagePlotSvg from '../shows/[id]/sound/_components/StagePlotSvg';

function plotWith(channels, monitors = []) {
  return { channels, monitors };
}

describe('StagePlotSvg', () => {
  test('renders one marker per channel', () => {
    const { container } = render(
      <StagePlotSvg
        plot={plotWith([
          { id: 'kick', label: 'Kick', source_type: 'mic' },
          { id: 'snare', label: 'Snare', source_type: 'mic' },
          { id: 'gtr-1', label: 'Guitar', source_type: 'di' },
        ])}
      />,
    );
    const markers = container.querySelectorAll('.stage-plot-marker');
    expect(markers).toHaveLength(3);
  });

  test('uses explicit position when supplied', () => {
    const { container } = render(
      <StagePlotSvg
        plot={plotWith([
          { id: 'a', label: 'A', source_type: 'mic', position: { x: 25, y: 75 } },
          { id: 'b', label: 'B', source_type: 'mic', position: { x: 75, y: 25 } },
        ])}
      />,
    );
    const markers = container.querySelectorAll('.stage-plot-marker');
    const tA = markers[0].getAttribute('transform');
    const tB = markers[1].getAttribute('transform');
    // Markers should land in different positions; explicit positions
    // produce distinct transforms.
    expect(tA).not.toEqual(tB);
    expect(tA).toMatch(/translate\(/);
  });

  test('renders fallback layout when no positions present', () => {
    const { container } = render(
      <StagePlotSvg
        plot={plotWith([
          { id: 'm1', label: 'M1', source_type: 'mic' },
          { id: 'd1', label: 'D1', source_type: 'di' },
        ])}
      />,
    );
    const markers = container.querySelectorAll('.stage-plot-marker');
    expect(markers).toHaveLength(2);
    // Mic + DI should be on different rows in the fallback layout.
    const tMic = markers[0].getAttribute('transform');
    const tDi = markers[1].getAttribute('transform');
    expect(tMic).not.toEqual(tDi);
  });

  test('renders source-type encoding (mic=circle, di=rect, submix=polygon)', () => {
    const { container } = render(
      <StagePlotSvg
        plot={plotWith([
          { id: 'm1', label: 'mic', source_type: 'mic' },
          { id: 'd1', label: 'di', source_type: 'di' },
          { id: 's1', label: 'sub', source_type: 'submix' },
        ])}
      />,
    );
    const markers = container.querySelectorAll('.stage-plot-marker');
    expect(markers[0].querySelector('circle')).toBeTruthy();
    expect(markers[1].querySelector('rect')).toBeTruthy();
    expect(markers[2].querySelector('polygon')).toBeTruthy();
  });

  test('renders empty-state copy when channels[] is empty', () => {
    render(<StagePlotSvg plot={{ channels: [], monitors: [] }} />);
    expect(screen.getByText(/no channels in this scene yet/i)).toBeTruthy();
  });

  test('renders one wedge per monitor', () => {
    const { container } = render(
      <StagePlotSvg
        plot={plotWith(
          [{ id: 'a', label: 'A', source_type: 'mic' }],
          [
            { id: 'M1', type: 'wedge', channels: ['a'] },
            { id: 'M2', type: 'wedge', channels: ['a'] },
          ],
        )}
      />,
    );
    expect(container.querySelectorAll('.stage-plot-monitor')).toHaveLength(2);
  });
});
