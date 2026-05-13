// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import Link from 'next/link';
import { getStations, getLineCheckTemplate, getRecipes } from '../lib/data';
import { getDb, todayISO, getPreshiftNote, todayServiceLabel } from '../lib/db';
import { DEFAULT_LOCATION_ID } from '../lib/location';
import { cascadedFromEightySix } from '../lib/subRecipeGraph';
import PreshiftNotes from './_components/PreshiftNotes';

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
  if (p.signedOff) return 'Signed off';
  if (p.flagged > 0) return `${p.flagged} flagged`;
  if (p.done >= p.total) return 'Ready — sign off';
  if (p.done > 0) return `${p.done} of ${p.total}`;
  return 'Not checked';
}

/* ── Editorial kicker logic: a hand-picked phrase for each service phase ── */
function kickerFor(hours) {
  if (hours < 10) return 'Sharpen knives. Proof the sauté. Today starts now.';
  if (hours < 11) return 'Mise en place. The door opens soon.';
  if (hours < 14) return 'Service is on. Heads up, eyes open.';
  if (hours < 17) return 'Between rushes — tighten the line.';
  if (hours < 22) return 'In it. Call the window. Keep it clean.';
  return 'Wind it down. Log the losses. Sign it off.';
}

// Derive the day name from the DB's `today` (todayISO()) — a stable
// YYYY-MM-DD string — using UTC formatting so the server and client render
// the same value regardless of timezone. Previously we called `new Date()`
// in the render pass, producing a hydration mismatch across a TZ boundary
// (most visible at midnight rollover).
function dayName(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

function formatDateChip(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
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

  // Editorial stats
  const total = stationsWithProgress.filter((s) => s.prog).length;
  const ready = stationsWithProgress.filter(
    (s) => s.prog && (s.prog.signedOff || s.prog.done >= s.prog.total)
  ).length;
  const flagged = stationsWithProgress.reduce(
    (n, s) => n + (s.prog?.flagged || 0),
    0
  );

  const day = dayName(date);
  // Kicker wall-clock reading uses the server's local time. On a single-site
  // LAN install the server TZ matches the restaurant TZ (documented in
  // project checkpoint). One `new Date()` call only — avoids the risk that
  // two back-to-back calls straddle a minute boundary.
  const nowLocal = new Date();
  const hours = nowLocal.getHours() + nowLocal.getMinutes() / 60;
  const kicker = kickerFor(hours);

  const serviceLabel = todayServiceLabel(loc);
  const preshift = getPreshiftNote(loc, date, serviceLabel);

  return (
    <div className="rush-home">
      <div className="editorial-hero">
        <div>
          <div className="date-bar">
            <span className="dot" />
            <span>{formatDateChip(date)}</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>{locQ ? loc : 'the lariat'}</span>
          </div>
          <h1>
            {day}. <em>We&rsquo;re in it.</em>
          </h1>
          <div className="kicker">{kicker}</div>
        </div>

        <div className="stat-stack">
          <div className="stat">
            <div className="n">{ready}</div>
            <div className="l">Ready</div>
          </div>
          <div className={`stat ${flagged > 0 ? 'hot' : ''}`}>
            <div className="n">{flagged}</div>
            <div className="l">Flagged</div>
          </div>
          <div className="stat">
            <div className="n">{out.length}</div>
            <div className="l">86’d</div>
          </div>
        </div>
      </div>

      <PreshiftNotes
        initialNote={preshift}
        shiftDate={date}
        serviceLabel={serviceLabel}
        locationId={loc}
      />

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
          <div className="rush-86-maybe-label">Might also be out</div>
          <div className="rush-86-items">
            {maybeOut.map((c) => (
              <span key={c.slug} className="rush-86-chip-maybe" title={`uses ${c.via}`}>
                {c.name}
              </span>
            ))}
          </div>
        </Link>
      )}

      <div className="section-head">
        <h2>The line, <em>right now</em></h2>
        <span className="eyebrow">{total} stations · press 1–6 to jump</span>
      </div>

      <div className="rush-grid">
        {stationsWithProgress.map((s) => {
          const color = rushColor(s.prog);
          const label = rushLabel(s.prog);
          return (
            <Link key={s.id} href={`/stations/${s.id}${locQ}`} className="rush-tile">
              <div className="rush-dot" style={{ background: color }} />
              <div className="rush-tile-name">{s.name}</div>
              <div className="rush-tile-status" style={{ color }}>
                {label}
              </div>
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
        <Link href={`/food-safety${locQ}`} className="rush-action rush-action-muted">
          Food safety
        </Link>
      </div>

      {moved.length > 0 && (
        <div className="rush-recent">
          <div className="rush-recent-label">Inventory today</div>
          {moved.map((r, i) => (
            <div key={i} className="rush-recent-row">
              <span className="rush-recent-item">{r.item}</span>
              <span className="rush-recent-meta">
                {r.direction}
                {r.delta ? ` ${r.delta}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
