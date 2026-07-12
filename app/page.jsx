// @ts-check
import Link from 'next/link';
import { getStations, getRecipes } from '../lib/data';
import { getDb, todayISO, getPreshiftNote, todayServiceLabel } from '../lib/db';
import { DEFAULT_LOCATION_ID } from '../lib/location';
import { activeLineCheckStations, lineSummaryText } from '../lib/lineSummary';
import { stationProgress } from '../lib/stationProgress';
import { cascadedFromEightySix } from '../lib/subRecipeGraph';
import PreshiftNotes from './_components/PreshiftNotes';
import BrandStamp from './_components/BrandStamp';

/** @typedef {ReturnType<typeof stationProgress>} StationProgress */

export const dynamic = 'force-dynamic';

/** @param {StationProgress} p */
function rushColor(p) {
  if (!p) return 'var(--muted)';
  if (p.flagged > 0) return 'var(--fire)';   // oxblood — flagged
  if (p.signedOff) return 'var(--ok)';       // sage — signed off
  if (p.done >= p.total) return 'var(--ok)'; // sage — ready
  if (p.done > 0) return 'var(--accent)';    // gaslight amber — live / in progress
  return 'var(--fire)';                      // oxblood — not started
}

/** @param {StationProgress} p */
function rushLabel(p) {
  if (!p) return 'No line check';
  if (p.signedOff) return 'Signed off';
  if (p.flagged > 0) return `${p.flagged} flagged`;
  if (p.done >= p.total) return 'Ready — sign off';
  if (p.done > 0) return `${p.done} of ${p.total}`;
  return 'Not checked';
}

/* ── Editorial kicker logic: a hand-picked phrase for each service phase ── */
/** @param {number} hours */
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
/** @param {string} iso */
function dayName(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

/** @param {string} iso */
function formatDateChip(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props */
export default async function TodayPage({ searchParams }) {
  // Next 16 app router passes searchParams as a Promise. Reading
  // `searchParams.location` synchronously falls back to the default kitchen and
  // emits a runtime warning in Safari/Simulator. Await before deriving loc.
  const sp = (await searchParams) || {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const date = todayISO();
  const stations = getStations();
  const stationsWithProgress = stations.map(s => ({
    ...s,
    prog: stationProgress(s, date, loc),
  }));
  const lineCheckStationsWithProgress = activeLineCheckStations(stationsWithProgress);
  const locQ = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';

  const db = getDb();
  const out = /** @type {{ id: number, item: string }[]} */ (
    db
      .prepare(
        `SELECT id, item FROM eighty_six WHERE shift_date=? AND resolved_at IS NULL AND location_id=? ORDER BY id DESC`
      )
      .all(date, loc)
  );

  const outNames = new Set(out.map((e) => String(e.item || '').trim().toLowerCase()));
  const maybeOut = cascadedFromEightySix(
    out.map((e) => e.item).filter(Boolean),
    getRecipes(),
  ).filter((c) => !outNames.has(String(c.name).trim().toLowerCase()));

  const moved = /** @type {{ id: number, item: string, direction: string | null, delta: string | null }[]} */ (
    db
      .prepare(
        `SELECT id, item, direction, delta FROM inventory_updates WHERE shift_date=? AND location_id=? ORDER BY id DESC LIMIT 4`
      )
      .all(date, loc)
  );

  // Editorial stats
  const ready = lineCheckStationsWithProgress.filter(
    (s) => s.prog && (s.prog.signedOff || s.prog.done >= s.prog.total)
  ).length;
  const flagged = lineCheckStationsWithProgress.reduce(
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
            {out.map((e) => (
              <span key={e.id} className="rush-86-chip">{e.item}</span>
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

      <div className="section-head rush-section-head">
        <h2>
          <BrandStamp className="rush-stamp-mark" decorative />
          The line, <em>right now</em>
        </h2>
        <span className="eyebrow">{lineSummaryText(stationsWithProgress)}</span>
      </div>

      <div className="rush-grid">
        {lineCheckStationsWithProgress.map((s) => {
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
          <div className="rush-recent-label">
            <BrandStamp className="rush-stamp-mark" decorative />
            Inventory today
          </div>
          {moved.map((r) => (
            <div key={r.id} className="rush-recent-row">
              <span className="rush-recent-item">{r.item}</span>
              <span className="rush-recent-meta">
                {r.direction}
                {r.delta ? <span className="rush-recent-delta tnum"> {r.delta}</span> : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
