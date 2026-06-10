// @ts-nocheck - fourth cook-tier v2 detail route: /v2/stations/[id].
import Link from 'next/link';
import StationPage from '../../../stations/[id]/page.jsx';
import { DEFAULT_LOCATION_ID } from '../../../../lib/location';

export const dynamic = 'force-dynamic';

export default async function V2StationBoardPage({ params, searchParams }) {
  const sp = (await searchParams) || {};
  const locationId =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const locationQuery = locationId !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(locationId)}` : '';

  return (
    <main style={{ display: 'grid', gap: 18 }}>
      <section style={heroStyle}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={eyebrowStyle}>Line check</div>
          <h1 style={titleStyle}>Work the board</h1>
          <p style={copyStyle}>Stay on the station, mark what is ready, and flag what needs help.</p>
        </div>
        <div style={jumpRowStyle}>
          <Link href={`/v2/today${locationQuery}`} style={jumpCardStyle}>
            <span style={eyebrowStyle}>Back</span>
            <strong>Back to today</strong>
          </Link>
          <Link href={`/v2/stations${locationQuery}`} style={jumpCardStyle}>
            <span style={eyebrowStyle}>All</span>
            <strong>All boards</strong>
          </Link>
        </div>
      </section>

      <section style={shellStyle}>
        <StationPage params={params} searchParams={sp} />
      </section>
    </main>
  );
}

const heroStyle = {
  display: 'grid',
  gap: 16,
  padding: 20,
  borderRadius: 12,
  border: '1px solid rgba(246, 240, 229, 0.16)',
  background: 'rgba(246, 240, 229, 0.06)',
};

const eyebrowStyle = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#9cc6ac',
};

const titleStyle = {
  margin: 0,
  fontSize: 'clamp(32px, 6vw, 54px)',
  lineHeight: 0.95,
  letterSpacing: 0,
};

const copyStyle = {
  margin: 0,
  maxWidth: 560,
  color: 'rgba(246, 240, 229, 0.74)',
  lineHeight: 1.4,
};

const jumpRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
};

const jumpCardStyle = {
  display: 'grid',
  gap: 4,
  minHeight: 76,
  alignContent: 'center',
  borderRadius: 10,
  border: '1px solid rgba(246, 240, 229, 0.16)',
  background: 'rgba(23, 24, 20, 0.32)',
  padding: 16,
  textDecoration: 'none',
};

const shellStyle = {
  padding: 4,
  borderRadius: 12,
  border: '1px solid rgba(246, 240, 229, 0.12)',
  background: 'rgba(12, 13, 11, 0.24)',
};
