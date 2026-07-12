import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import PerformanceReviewBoard from './PerformanceReviewBoard';

export const dynamic = 'force-dynamic';

/**
 * Reads `?location=` (same convention as app/labor/breaks and
 * app/eighty-six) and threads it into the client board, which scopes
 * its /api/performance-reviews fetches to it. Falls back to the
 * default location for bare links like the /management rollup tile.
 *
 * @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props
 */
export default async function PerformanceReviewsPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;

  return <PerformanceReviewBoard locationId={loc} />;
}
