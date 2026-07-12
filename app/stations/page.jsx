// @ts-check
import Link from 'next/link';
import { getStations } from '../../lib/data';
import { DEFAULT_LOCATION_ID } from '../../lib/location';

export const dynamic = 'force-dynamic';

/**
 * lib/data.ts's `Station` interface doesn't declare `color`, even though
 * every row in data/cache/stations.json carries one and this page (plus
 * the sibling app/stations/[id]/page.jsx) renders it as the station's
 * status dot. Widened locally rather than editing lib/data.ts, which is
 * out of this migration's file scope.
 * @typedef {import('../../lib/data.ts').Station & { color?: string }} StationWithColor
 */

/**
 * @typedef {{
 *   searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>,
 *   basePath?: string,
 * }} StationsPageProps
 */

/** @param {StationsPageProps} props */
export default async function StationsPage({ searchParams, basePath = '/stations' }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const locQ = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';
  const stations = /** @type {StationWithColor[]} */ (getStations());
  return (
    <div>
      <h1>Stations</h1>
      <p className="subtitle">All kitchen positions. 6 max, 2 min on the line at any time.</p>
      <div className="grid grid-stations">
        {stations.map(s => (
          <Link key={s.id} href={`${basePath}/${s.id}${locQ}`} style={{ textDecoration: 'none' }}>
            <div className="card station">
              <div className="station-head">
                <div>
                  <div className="station-name">{s.name}</div>
                  <div className="station-line">{s.line} line</div>
                </div>
                <div className="dot" style={{ background: s.color }} />
              </div>
              <div className="station-meta">
                {s.line_check_key ? 'Line check available' : 'No line check (position only)'}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
