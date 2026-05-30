interface StationSummary {
  prog?: unknown;
}

export function lineSummaryText(stations: StationSummary[]): string {
  const stationCount = stations.length;
  const lineCheckCount = stations.filter((s) => s.prog).length;
  return `${stationCount} stations · ${lineCheckCount} line checks · press 1–6`;
}
