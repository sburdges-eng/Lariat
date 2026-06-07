interface StationSummary {
  prog?: unknown;
}

export function activeLineCheckStations<T extends StationSummary>(stations: T[]): T[] {
  return stations.filter((s) => Boolean(s.prog));
}

export function lineSummaryText(stations: StationSummary[]): string {
  const stationCount = stations.length;
  const lineCheckCount = activeLineCheckStations(stations).length;
  const shortcutText = lineCheckCount > 0 ? `shortcuts 1–${lineCheckCount}` : 'no line-check shortcuts';
  return `${stationCount} stations · ${lineCheckCount} line checks · ${shortcutText}`;
}
