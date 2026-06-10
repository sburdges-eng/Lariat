// @ts-nocheck - second cook-tier v2 route: /v2/kds/punch.
import Link from 'next/link';
import PunchTicketPage from '../../../kds/punch/page.jsx';
import { DEFAULT_LOCATION_ID } from '../../../../lib/location';

export const dynamic = 'force-dynamic';

export default async function V2KdsPunchPage({ searchParams }) {
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
          <div style={eyebrowStyle}>Punch now</div>
          <h1 style={titleStyle}>Send to line</h1>
          <p style={copyStyle}>Type the order and push it to the kitchen.</p>
        </div>
        <div style={jumpRowStyle}>
          <Link href={`/v2/today${locationQuery}`} style={jumpCardStyle}>
            <span style={eyebrowStyle}>Back</span>
            <strong>Back to today</strong>
          </Link>
          <Link href={`/v2/eighty-six${locationQuery}`} style={jumpCardStyle}>
            <span style={eyebrowStyle}>Watch</span>
            <strong>Watch 86</strong>
          </Link>
        </div>
      </section>

      <section style={shellStyle}>
        <PunchTicketPage />
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
