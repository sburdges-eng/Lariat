interface StationSummary {
  prog?: unknown;
}

export function lineSummaryText(stations: StationSummary[]): string {
  const stationCount = stations.length;
  const lineCheckCount = stations.filter((s) => s.prog).length;
  const shortcutText = lineCheckCount > 0 ? `shortcuts 1–${lineCheckCount}` : 'no line-check shortcuts';
  return `${stationCount} stations · ${lineCheckCount} line checks · ${shortcutText}`;
}
