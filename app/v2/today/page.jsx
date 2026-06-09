// @ts-nocheck - first cook-tier v2 route. Covered by tests/js/test-v2-today.mjs.
import Link from 'next/link';
import { getStations, getLineCheckTemplate, getRecipes } from '../../../lib/data';
import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { activeLineCheckStations } from '../../../lib/lineSummary';
import { cascadedFromEightySix } from '../../../lib/subRecipeGraph';

export const dynamic = 'force-dynamic';

function stationProgress(station, date, locationId) {
  if (!station.line_check_key) return null;
  const items = getLineCheckTemplate(station.line_check_key);
  if (!items.length) return null;
  const db = getDb();
  const rows = db.prepare(`
    SELECT item, status
    FROM line_check_entries
    WHERE shift_date = ? AND station_id = ? AND location_id = ?
    ORDER BY id DESC
  `).all(date, station.id, locationId);

  const latestByItem = new Map();
  for (const row of rows) {
    if (!latestByItem.has(row.item)) latestByItem.set(row.item, row);
  }

  let done = 0;
  let flagged = 0;
  for (const item of items) {
    const row = latestByItem.get(item);
    if (row) {
      done += 1;
      if (row.status === 'fail') flagged += 1;
    }
  }

  const signoff = db.prepare(
    'SELECT cook_id FROM station_signoffs WHERE shift_date=? AND station_id=? AND location_id=? ORDER BY id DESC LIMIT 1'
  ).get(date, station.id, locationId);

  return { total: items.length, done, flagged, signedOff: Boolean(signoff) };
}

function stationTone(progress) {
  if (!progress) return 'var(--muted)';
  if (progress.flagged > 0) return 'var(--red)';
  if (progress.signedOff || progress.done >= progress.total) return 'var(--green)';
  if (progress.done > 0) return '#e3b04b';
  return 'var(--red)';
}

function stationLabel(progress) {
  if (!progress) return 'No line check';
  if (progress.flagged > 0) return `${progress.flagged} flagged`;
  if (progress.signedOff) return 'Signed off';
  if (progress.done >= progress.total) return 'Ready';
  if (progress.done > 0) return `${progress.done} of ${progress.total}`;
  return 'Open line';
}

function formatDateChip(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default function V2TodayPage({ searchParams }) {
  const locationId =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const date = todayISO();
  const locationQuery = locationId !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(locationId)}` : '';

  const stations = getStations().map((station) => ({
    ...station,
    prog: stationProgress(station, date, locationId),
  }));
  const activeStations = activeLineCheckStations(stations);

  const db = getDb();
  const outs = db
    .prepare('SELECT item FROM eighty_six WHERE shift_date=? AND resolved_at IS NULL AND location_id=? ORDER BY id DESC')
    .all(date, locationId);
  const recentMoves = db
    .prepare('SELECT item, direction, delta FROM inventory_updates WHERE shift_date=? AND location_id=? ORDER BY id DESC LIMIT 4')
    .all(date, locationId);
  const cascaded = cascadedFromEightySix(
    outs.map((row) => row.item).filter(Boolean),
    getRecipes(),
  );

  return (
    <main style={{ display: 'grid', gap: 18 }}>
      <section style={heroStyle}>
        <div>
          <div style={eyebrowStyle}>Today · {formatDateChip(date)}</div>
          <h1 style={titleStyle}>Line now</h1>
          <p style={subheadStyle}>See what is ready, what is out, and where to jump next.</p>
        </div>
        <div style={statGridStyle}>
          <div style={statCardStyle}>
            <strong style={statNumberStyle}>{activeStations.filter((station) => station.prog?.signedOff || station.prog?.done >= station.prog?.total).length}</strong>
            <span style={statLabelStyle}>Ready</span>
          </div>
          <div style={statCardStyle}>
            <strong style={statNumberStyle}>{activeStations.reduce((sum, station) => sum + (station.prog?.flagged || 0), 0)}</strong>
            <span style={statLabelStyle}>Flagged</span>
          </div>
          <div style={statCardStyle}>
            <strong style={statNumberStyle}>{outs.length}</strong>
            <span style={statLabelStyle}>86 now</span>
          </div>
        </div>
      </section>

      <section style={actionRowStyle}>
        <Link href={`/v2/kds/punch${locationQuery}`} style={actionCardStyle}>
          <span style={eyebrowStyle}>Next</span>
          <strong>Send to line</strong>
        </Link>
        <Link href={`/v2/eighty-six${locationQuery}`} style={actionCardStyle}>
          <span style={eyebrowStyle}>Watch</span>
          <strong>86 right now</strong>
        </Link>
      </section>

      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={sectionTitleStyle}>Open line</h2>
          <span style={sectionMetaStyle}>{activeStations.length} stations</span>
        </div>
        <div style={stationGridStyle}>
          {activeStations.map((station) => {
            const tone = stationTone(station.prog);
            return (
              <Link key={station.id} href={`/stations/${station.id}${locationQuery}`} style={stationCardStyle}>
                <div style={{ display: 'grid', gap: 6 }}>
                  <strong>{station.name}</strong>
                  <span style={{ color: tone, fontWeight: 700 }}>{stationLabel(station.prog)}</span>
                </div>
                <span style={{ ...dotStyle, background: tone }} aria-hidden />
              </Link>
            );
          })}
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={sectionTitleStyle}>Stock moves</h2>
          <span style={sectionMetaStyle}>Latest</span>
        </div>
        <div style={listStyle}>
          {recentMoves.length > 0 ? recentMoves.map((row, index) => (
            <div key={`${row.item}-${index}`} style={listRowStyle}>
              <strong>{row.item}</strong>
              <span style={sectionMetaStyle}>{row.direction}{row.delta ? ` ${row.delta}` : ''}</span>
            </div>
          )) : <div style={emptyRowStyle}>No stock moves yet</div>}
        </div>
      </section>

      {(outs.length > 0 || cascaded.length > 0) && (
        <section style={sectionStyle}>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>86 right now</h2>
            <span style={sectionMetaStyle}>{outs.length} open</span>
          </div>
          <div style={chipWrapStyle}>
            {outs.map((row, index) => (
              <span key={`${row.item}-${index}`} style={hotChipStyle}>{row.item}</span>
            ))}
            {cascaded.map((row) => (
              <span key={row.slug} style={warmChipStyle}>{row.name}</span>
            ))}
          </div>
        </section>
      )}
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
  margin: '8px 0 0',
  fontSize: 'clamp(34px, 6vw, 58px)',
  lineHeight: 0.95,
  letterSpacing: 0,
};

const subheadStyle = {
  margin: '10px 0 0',
  maxWidth: 560,
  color: 'rgba(246, 240, 229, 0.74)',
  lineHeight: 1.4,
};

const statGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 10,
};

const statCardStyle = {
  display: 'grid',
  gap: 4,
  minHeight: 86,
  padding: 14,
  borderRadius: 10,
  border: '1px solid rgba(246, 240, 229, 0.12)',
  background: 'rgba(23, 24, 20, 0.32)',
};

const statNumberStyle = {
  fontSize: 28,
  lineHeight: 1,
};

const statLabelStyle = {
  color: 'rgba(246, 240, 229, 0.64)',
  fontSize: 13,
};

const actionRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
};

const actionCardStyle = {
  display: 'grid',
  gap: 4,
  minHeight: 76,
  alignContent: 'center',
  borderRadius: 10,
  border: '1px solid rgba(246, 240, 229, 0.16)',
  background: 'rgba(246, 240, 229, 0.06)',
  padding: 16,
  textDecoration: 'none',
};

const sectionStyle = {
  display: 'grid',
  gap: 12,
  padding: 18,
  borderRadius: 12,
  border: '1px solid rgba(246, 240, 229, 0.16)',
  background: 'rgba(246, 240, 229, 0.05)',
};

const sectionHeaderStyle = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
};

const sectionTitleStyle = {
  margin: 0,
  fontSize: 20,
};

const sectionMetaStyle = {
  color: 'rgba(246, 240, 229, 0.62)',
  fontSize: 13,
};

const stationGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 10,
};

const stationCardStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  minHeight: 78,
  borderRadius: 10,
  border: '1px solid rgba(246, 240, 229, 0.12)',
  background: 'rgba(23, 24, 20, 0.32)',
  padding: 14,
  textDecoration: 'none',
};

const dotStyle = {
  width: 12,
  height: 12,
  borderRadius: 999,
  flex: '0 0 auto',
};

const listStyle = {
  display: 'grid',
  gap: 8,
};

const listRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 12px',
  borderRadius: 8,
  background: 'rgba(23, 24, 20, 0.28)',
};

const emptyRowStyle = {
  padding: '10px 12px',
  borderRadius: 8,
  background: 'rgba(23, 24, 20, 0.28)',
  color: 'rgba(246, 240, 229, 0.62)',
};

const chipWrapStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

const hotChipStyle = {
  padding: '8px 10px',
  borderRadius: 999,
  background: 'rgba(191, 70, 45, 0.24)',
  border: '1px solid rgba(216, 111, 66, 0.36)',
};

const warmChipStyle = {
  padding: '8px 10px',
  borderRadius: 999,
  background: 'rgba(227, 176, 75, 0.18)',
  border: '1px solid rgba(227, 176, 75, 0.28)',
};
