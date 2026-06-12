// @ts-nocheck - first cook-tier v2 route. Covered by tests/js/test-v2-today.mjs.
// Copy lives in lib/i18n/messages/* — the copy-contract tests assert
// against the en catalog, not this file.
import Link from 'next/link';
import { getStations, getRecipes } from '../../../lib/data';
import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { activeLineCheckStations } from '../../../lib/lineSummary';
import { stationProgress } from '../../../lib/stationProgress';
import { cascadedFromEightySix } from '../../../lib/subRecipeGraph';
import { getMessages, t } from '../../../lib/i18n/index.ts';
import { getLocale } from '../../../lib/i18n/server.ts';

export const dynamic = 'force-dynamic';

function stationTone(progress) {
  if (!progress) return 'var(--muted)';
  if (progress.flagged > 0) return 'var(--red)';
  if (progress.signedOff || progress.done >= progress.total) return 'var(--green)';
  if (progress.done > 0) return '#e3b04b';
  return 'var(--red)';
}

function stationLabel(progress, m) {
  if (!progress) return t(m, 'today.station.noLineCheck');
  if (progress.flagged > 0) return t(m, 'today.station.flagged', { count: progress.flagged, n: progress.flagged });
  if (progress.signedOff) return t(m, 'today.station.signedOff');
  if (progress.done >= progress.total) return t(m, 'today.station.ready');
  if (progress.done > 0) return t(m, 'today.station.progress', { done: progress.done, total: progress.total });
  return t(m, 'today.station.openLine');
}

function formatDateChip(iso, locale) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(
    locale === 'es' ? 'es' : 'en-US',
    { month: 'short', day: 'numeric', timeZone: 'UTC' },
  );
}

export default async function V2TodayPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const locationId =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const date = todayISO();
  const locationQuery = locationId !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(locationId)}` : '';
  const locale = await getLocale();
  const m = getMessages(locale);

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
          <div style={eyebrowStyle}>{t(m, 'today.eyebrow', { date: formatDateChip(date, locale) })}</div>
          <h1 style={titleStyle}>{t(m, 'today.title')}</h1>
          <p style={subheadStyle}>{t(m, 'today.subhead')}</p>
        </div>
        <div style={statGridStyle}>
          <div style={statCardStyle}>
            <strong style={statNumberStyle}>{activeStations.filter((station) => station.prog?.signedOff || station.prog?.done >= station.prog?.total).length}</strong>
            <span style={statLabelStyle}>{t(m, 'today.statReady')}</span>
          </div>
          <div style={statCardStyle}>
            <strong style={statNumberStyle}>{activeStations.reduce((sum, station) => sum + (station.prog?.flagged || 0), 0)}</strong>
            <span style={statLabelStyle}>{t(m, 'today.statFlagged')}</span>
          </div>
          <div style={statCardStyle}>
            <strong style={statNumberStyle}>{outs.length}</strong>
            <span style={statLabelStyle}>{t(m, 'today.stat86')}</span>
          </div>
        </div>
      </section>

      <section style={actionRowStyle}>
        <Link href={`/v2/kds/punch${locationQuery}`} style={actionCardStyle}>
          <span style={eyebrowStyle}>{t(m, 'common.next')}</span>
          <strong>{t(m, 'today.sendToLine')}</strong>
        </Link>
        <Link href={`/v2/eighty-six${locationQuery}`} style={actionCardStyle}>
          <span style={eyebrowStyle}>{t(m, 'common.watch')}</span>
          <strong>{t(m, 'today.eightySixNow')}</strong>
        </Link>
      </section>

      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={sectionTitleStyle}>{t(m, 'today.openLine')}</h2>
          <span style={sectionMetaStyle}>{t(m, 'today.stations', { count: activeStations.length, n: activeStations.length })}</span>
        </div>
        <div style={stationGridStyle}>
          {activeStations.map((station) => {
            const tone = stationTone(station.prog);
            return (
              <Link key={station.id} href={`/v2/stations/${station.id}${locationQuery}`} style={stationCardStyle}>
                <div style={{ display: 'grid', gap: 6 }}>
                  <strong>{station.name}</strong>
                  <span style={{ color: tone, fontWeight: 700 }}>{stationLabel(station.prog, m)}</span>
                </div>
                <span style={{ ...dotStyle, background: tone }} aria-hidden />
              </Link>
            );
          })}
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={sectionTitleStyle}>{t(m, 'today.stockMoves')}</h2>
          <span style={sectionMetaStyle}>{t(m, 'common.latest')}</span>
        </div>
        <div style={listStyle}>
          {recentMoves.length > 0 ? recentMoves.map((row, index) => (
            <div key={`${row.item}-${index}`} style={listRowStyle}>
              <strong>{row.item}</strong>
              <span style={sectionMetaStyle}>{row.direction}{row.delta ? ` ${row.delta}` : ''}</span>
            </div>
          )) : <div style={emptyRowStyle}>{t(m, 'today.noStockMoves')}</div>}
        </div>
      </section>

      {(outs.length > 0 || cascaded.length > 0) && (
        <section style={sectionStyle}>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>{t(m, 'today.eightySixNow')}</h2>
            <span style={sectionMetaStyle}>{t(m, 'today.open', { count: outs.length, n: outs.length })}</span>
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
