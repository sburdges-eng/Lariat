import React from 'react';

export interface StationRingProps {
  /** Checks completed. */
  done?: number;
  /** Total checks on the station. */
  total?: number;
  /** Flagged (failed) checks — forces the fire tone. */
  flagged?: number;
  /** Station has been signed off — reads as done. */
  signedOff?: boolean;
  /** Center glyph, usually the station number (1–6). */
  glyph?: string | number;
  /** Pixel diameter. Default 36. */
  size?: number;
  /** Force a tone instead of deriving from progress. */
  tone?: 'fire' | 'amber' | 'ok' | 'done';
}

/**
 * Circular station-progress ring with a numeric glyph — the left-rail line
 * indicator. Fill sweep and color track a station's line-check progress.
 */
export function StationRing(props: StationRingProps): JSX.Element;
