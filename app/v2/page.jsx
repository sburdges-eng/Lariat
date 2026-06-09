// @ts-nocheck - first side-by-side shell for the cook-tier v2 migration.
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function V2ShellPage() {
  return (
    <main
      style={{
        display: 'grid',
        gap: 28,
      }}
    >
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
          gap: 28,
          alignItems: 'end',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 28,
          }}
        >
          <div>
            <div
              style={{
                color: '#e3b04b',
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
              }}
            >
              Service cockpit
            </div>
            <h1
              style={{
                margin: '12px 0 0',
                maxWidth: 720,
                fontSize: 'clamp(42px, 7vw, 86px)',
                lineHeight: 0.92,
                letterSpacing: 0,
              }}
            >
              Cook station flow, side by side.
            </h1>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 10,
            }}
          >
            <div style={metricStyle}>
              <span style={metricNumberStyle}>5</span>
              <span style={metricLabelStyle}>Migration lanes</span>
            </div>
            <div style={metricStyle}>
              <span style={metricNumberStyle}>1</span>
              <span style={metricLabelStyle}>Preview lane</span>
            </div>
            <div style={metricStyle}>
              <span style={metricNumberStyle}>v1</span>
              <span style={metricLabelStyle}>Default cockpit</span>
            </div>
          </div>
        </div>

        <aside
          style={{
            display: 'grid',
            alignContent: 'end',
            gap: 14,
          }}
        >
          <div>
            <div style={panelEyebrowStyle}>Preview lanes</div>
            <h2
              style={{
                margin: '10px 0 0',
                fontSize: 28,
                lineHeight: 1,
                letterSpacing: 0,
              }}
            >
              Cook + manager
            </h2>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            <Link href="/v2/today" style={routeStyle}>
              <span>Today</span>
              <strong>Rush board</strong>
            </Link>
            <Link href="/v2/kds/punch" style={routeStyle}>
              <span>Punch</span>
              <strong>Send to line</strong>
            </Link>
            <Link href="/v2/eighty-six" style={routeStyle}>
              <span>86</span>
              <strong>Outs and cascades</strong>
            </Link>
            <Link href="/v2/stations" style={routeStyle}>
              <span>Stations</span>
              <strong>Line checks</strong>
            </Link>
            <Link href="/v2/command" style={routeStyle}>
              <span>Command</span>
              <strong>Open the day</strong>
            </Link>
          </div>
        </aside>
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        <div style={statusStyle}>
          <span style={panelEyebrowStyle}>Rush</span>
          <strong>Today board</strong>
        </div>
        <div style={statusStyle}>
          <span style={panelEyebrowStyle}>Expo</span>
          <strong>Punch queue</strong>
        </div>
        <div style={statusStyle}>
          <span style={panelEyebrowStyle}>Line</span>
          <strong>Station checks</strong>
        </div>
        <div style={statusStyle}>
          <span style={panelEyebrowStyle}>Manager</span>
          <strong>Command center</strong>
        </div>
      </section>
    </main>
  );
}

const metricStyle = {
  minHeight: 86,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  borderTop: '1px solid rgba(246, 240, 229, 0.22)',
  paddingTop: 12,
};

const metricNumberStyle = {
  fontSize: 30,
  fontWeight: 800,
  color: '#f6f0e5',
};

const metricLabelStyle = {
  color: 'rgba(246, 240, 229, 0.64)',
  fontSize: 13,
  lineHeight: 1.2,
};

const panelEyebrowStyle = {
  color: '#9cc6ac',
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

const routeStyle = {
  display: 'grid',
  gap: 4,
  minHeight: 68,
  alignContent: 'center',
  border: '1px solid rgba(246, 240, 229, 0.14)',
  borderRadius: 7,
  background: 'rgba(246, 240, 229, 0.07)',
  padding: '12px 14px',
  textDecoration: 'none',
};

const statusStyle = {
  minHeight: 96,
  display: 'grid',
  alignContent: 'space-between',
  border: '1px solid rgba(246, 240, 229, 0.14)',
  borderRadius: 8,
  background: 'rgba(246, 240, 229, 0.07)',
  padding: 18,
};
