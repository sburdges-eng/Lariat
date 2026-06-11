// @ts-nocheck - first manager-tier v2 route: /v2/command.
import Link from 'next/link';
import CommandCenter from '../../command/page.jsx';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';

export const dynamic = 'force-dynamic';

export default function V2CommandPage({ searchParams }) {
  const locationId =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const locationQuery = locationId !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(locationId)}` : '';

  return (
    <main style={{ display: 'grid', gap: 18 }}>
      <section style={heroStyle}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={eyebrowStyle}>Command center</div>
          <h1 style={titleStyle}>Open the day</h1>
          <p style={copyStyle}>Keep the big calls close, then jump back to the line when service turns hot.</p>
        </div>
        <div style={jumpRowStyle}>
          <Link href={`/v2/today${locationQuery}`} style={jumpCardStyle}>
            <span style={eyebrowStyle}>Back</span>
            <strong>Back to line</strong>
          </Link>
          <Link href={`/morning${locationQuery}`} style={jumpCardStyle}>
            <span style={eyebrowStyle}>Open</span>
            <strong>Morning digest</strong>
          </Link>
        </div>
      </section>

      <section style={shellStyle}>
        <CommandCenter searchParams={searchParams} />
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
