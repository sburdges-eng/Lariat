// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import Link from 'next/link';
import { getStations } from '../../lib/data';
import { DEFAULT_LOCATION_ID } from '../../lib/location';

export const dynamic = 'force-dynamic';

export default function StationsPage({ searchParams, basePath = '/stations' }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const locQ = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';
  const stations = getStations();
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
