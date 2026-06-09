import { DEFAULT_LOCATION_ID } from './location.ts';

export function buildMorningDigestQuery({
  locationId,
  date,
  today,
}: {
  locationId: string;
  date: string;
  today: string;
}): string {
  const params = new URLSearchParams();
  if (locationId !== DEFAULT_LOCATION_ID) params.set('location', locationId);
  if (date !== today) params.set('date', date);
  const query = params.toString();
  return query ? `?${query}` : '';
}
