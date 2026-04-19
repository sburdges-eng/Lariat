import Link from 'next/link';
import { getStations, getLineCheckTemplate, getRecipes } from '../lib/data';
import { getDb, todayISO } from '../lib/db';
import { DEFAULT_LOCATION_ID } from '../lib/location';
import { cascadedFromEightySix } from '../lib/subRecipeGraph';

export const dynamic = 'force-dynamic';

function stationProgress(station, date, loc) {
  if (!station.line_check_key) return null;
  const items = getLineCheckTemplate(station.line_check_key);
  if (!items.length) return null;
  const db = getDb();
  const rows = db.prepare(`
    SELECT item, status, MAX(created_at) as ts
    FROM line_check_entries
    WHERE shift_date = ? AND station_id = ? AND location_id = ?
    GROUP BY item
  `).all(date, station.id, loc);
  const byItem = new Map(rows.map(r => [r.item, r]));
  let done = 0, flagged = 0;
  for (const item of items) {
    const r = byItem.get(item);
    if (r) { done++; if (r.status === 'fail') flagged++; }
  }
  const signoff = db.prepare(
    'SELECT cook_id FROM station_signoffs WHERE shift_date=? AND station_id=? AND location_id=? ORDER BY id DESC LIMIT 1'
  ).get(date, station.id, loc);
  return { total: items.length, done, flagged, signedOff: !!signoff };
}

function rushColor(p) {
  if (!p) return 'var(--muted)';
  if (p.flagged > 0) return 'var(--red)';
  if (p.signedOff) return 'var(--green)';
  if (p.done >= p.total) return 'var(--green)';
  if (p.done > 0) return 'var(--yellow)';
  return 'var(--red)';
}

function rushLabel(p) {
  if (!p) return 'No line check';
  if (p.signedOff) return 'Signed off ✓';
  if (p.flagged > 0) return `${p.flagged} flagged`;
  if (p.done >= p.total) return 'Done — sign off';
  if (p.done > 0) return `${p.done} of ${p.total}`;
  return 'Not checked';
}

export default function TodayPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const date = todayISO();
  const stations = getStations();
  const stationsWithProgress = stations.map(s => ({
    ...s,
    prog: stationProgress(s, date, loc),
  }));
  const locQ = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';

  const db = getDb();
  const out = db
    .prepare(
      `SELECT item FROM eighty_six WHERE shift_date=? AND resolved_at IS NULL AND location_id=? ORDER BY id DESC`
    )
    .all(date, loc);

  const outNames = new Set(out.map((e) => String(e.item || '').trim().toLowerCase()));
  const maybeOut = cascadedFromEightySix(
    out.map((e) => e.item).filter(Boolean),
    getRecipes(),
  ).filter((c) => !outNames.has(String(c.name).trim().toLowerCase()));

  const moved = db
    .prepare(
      `SELECT item, direction, delta FROM inventory_updates WHERE shift_date=? AND location_id=? ORDER BY id DESC LIMIT 4`
    )
    .all(date, loc);

  return (
    <div className="rush-home">
      {out.length > 0 && (
        <Link href={`/eighty-six${locQ}`} className="rush-86">
          <div className="rush-86-label">86&apos;d right now</div>
          <div className="rush-86-items">
            {out.map((e, i) => (
              <span key={i} className="rush-86-chip">{e.item}</span>
            ))}
          </div>
        </Link>
      )}

      {maybeOut.length > 0 && (
        <Link href={`/eighty-six${locQ}`} className="rush-86-maybe">
          <div className="rush-86-maybe-label">Might also be out — check</div>
          <div className="rush-86-items">
            {maybeOut.map((c) => (
              <span key={c.slug} className="rush-86-chip-maybe" title={`uses ${c.via}`}>
                {c.name}
              </span>
            ))}
          </div>
        </Link>
      )}

      <div className="rush-grid">
        {stationsWithProgress.map(s => {
          const color = rushColor(s.prog);
          const label = rushLabel(s.prog);
          return (
            <Link key={s.id} href={`/stations/${s.id}${locQ}`} className="rush-tile">
              <div className="rush-dot" style={{ background: color }} />
              <div className="rush-tile-name">{s.name}</div>
              <div className="rush-tile-status" style={{ color }}>{label}</div>
            </Link>
          );
        })}
      </div>

      <div className="rush-quick-row">
        <Link href={`/eighty-six${locQ}`} className="rush-action">
          86 an item
        </Link>
        <Link href={`/inventory${locQ}`} className="rush-action">
          Log inventory
        </Link>
        <Link href={`/recipes${locQ}`} className="rush-action rush-action-muted">
          Recipes
        </Link>
      </div>

      {moved.length > 0 && (
        <div className="rush-recent">
          <div className="rush-recent-label">Inventory today</div>
          {moved.map((r, i) => (
            <div key={i} className="rush-recent-row">
              <span className="rush-recent-item">{r.item}</span>
              <span className="rush-recent-meta">{r.direction}{r.delta ? ` ${r.delta}` : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
