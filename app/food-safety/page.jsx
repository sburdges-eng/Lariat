// Food-safety hub — one glance at every HACCP surface.
//
// This is the "is the kitchen compliant right now?" page. Each tile is
// a subpage (cooling, date-marks, sick worker, sanitizer) with the
// current breach count surfaced up. A tile turns amber for pending
// attention and red for an active violation the PIC needs to resolve
// before service.

import Link from 'next/link';
import { getDb, todayISO } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import { scanOpenBatches } from '../../lib/cooling';
import { scanExpiringBatches } from '../../lib/dateMarks';

export const dynamic = 'force-dynamic';

function summarize(loc, today) {
  const db = getDb();

  const openCooling = db
    .prepare(
      `SELECT * FROM cooling_log WHERE location_id=? AND status='in_progress' ORDER BY started_at ASC`,
    )
    .all(loc);
  const coolingScan = scanOpenBatches(openCooling, Date.now());

  const dateMarks = db
    .prepare(
      `SELECT * FROM date_marks WHERE location_id=? AND discarded_at IS NULL ORDER BY discard_on ASC`,
    )
    .all(loc);
  const dateScan = scanExpiringBatches(dateMarks, today);

  const sickActive = db
    .prepare(
      `SELECT id, cook_id, action FROM sick_worker_reports WHERE location_id=? AND return_at IS NULL`,
    )
    .all(loc);

  const sanitizerToday = db
    .prepare(
      `SELECT id, point_label, status FROM sanitizer_checks WHERE location_id=? AND shift_date=? ORDER BY created_at DESC`,
    )
    .all(loc, today);

  const latestByPoint = new Map();
  for (const r of sanitizerToday) {
    if (!latestByPoint.has(r.point_label)) latestByPoint.set(r.point_label, r);
  }
  const sanitizerOut = Array.from(latestByPoint.values()).filter((r) => r.status !== 'ok');

  return {
    cooling: {
      open: openCooling.length,
      breach: coolingScan.filter((s) => s.breached).length,
      warning: coolingScan.filter((s) => !s.breached && s.minutes_remaining <= 30).length,
    },
    dateMarks: {
      active: dateMarks.length,
      expired: dateScan.filter((s) => s.status === 'expired').length,
      dueToday: dateScan.filter((s) => s.status === 'due_today').length,
    },
    sick: {
      active: sickActive.length,
      excluded: sickActive.filter((s) => s.action === 'excluded').length,
    },
    sanitizer: {
      today: sanitizerToday.length,
      out: sanitizerOut.length,
    },
  };
}

function tone(s) {
  // Red > amber > green. Order matters — first match wins.
  if (s.red) return 'red';
  if (s.amber) return 'amber';
  return 'green';
}

function Tile({ href, title, sub, status, lines }) {
  const t = tone(status);
  return (
    <Link href={href} className={`fs-tile fs-tile-${t}`}>
      <div className="fs-tile-head">
        <span className="fs-tile-title">{title}</span>
        <span className={`fs-tile-pip fs-tile-pip-${t}`} />
      </div>
      <div className="fs-tile-sub">{sub}</div>
      <ul className="fs-tile-lines">
        {lines.map((l, i) => (
          <li key={i} className={l.tone ? `fs-line-${l.tone}` : ''}>
            <span className="fs-line-num">{l.n}</span>
            <span className="fs-line-lbl">{l.label}</span>
          </li>
        ))}
      </ul>
      <div className="fs-tile-arrow">Open →</div>
    </Link>
  );
}

export default function FoodSafetyHub({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();
  const s = summarize(loc, today);
  const locQ = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';

  return (
    <div className="fs-hub">
      <h1>Food safety</h1>
      <p className="subtitle">
        Every HACCP surface the inspector asks about, in one place. Red = resolve now, amber = pending, green = clear.
      </p>

      <div className="fs-tiles">
        <Tile
          href={`/food-safety/cooling${locQ}`}
          title="Cooling"
          sub="Two-stage cool — 135 → 70°F in 2h, 70 → 41°F in 4h"
          status={{ red: s.cooling.breach > 0, amber: s.cooling.warning > 0 }}
          lines={[
            { n: s.cooling.open, label: 'open batches' },
            { n: s.cooling.warning, label: 'near the 2-hour wall', tone: s.cooling.warning ? 'amber' : null },
            { n: s.cooling.breach, label: 'breached — needs corrective action', tone: s.cooling.breach ? 'red' : null },
          ]}
        />
        <Tile
          href={`/food-safety/date-marks${locQ}`}
          title="Date marks"
          sub="7-day rule — day of prep is day 1"
          status={{ red: s.dateMarks.expired > 0, amber: s.dateMarks.dueToday > 0 }}
          lines={[
            { n: s.dateMarks.active, label: 'active batches' },
            { n: s.dateMarks.dueToday, label: 'use or discard today', tone: s.dateMarks.dueToday ? 'amber' : null },
            { n: s.dateMarks.expired, label: 'past discard-on', tone: s.dateMarks.expired ? 'red' : null },
          ]}
        />
        <Tile
          href={`/food-safety/sick-worker${locQ}`}
          title="Sick worker"
          sub="FDA §2-201.11 — Big-6 diagnoses, 5 reportable symptoms"
          status={{ red: s.sick.excluded > 0, amber: s.sick.active - s.sick.excluded > 0 }}
          lines={[
            { n: s.sick.active, label: 'open reports' },
            { n: s.sick.excluded, label: 'excluded from work', tone: s.sick.excluded ? 'red' : null },
            {
              n: s.sick.active - s.sick.excluded,
              label: 'restricted / monitor',
              tone: s.sick.active - s.sick.excluded ? 'amber' : null,
            },
          ]}
        />
        <Tile
          href={`/food-safety/sanitizer${locQ}`}
          title="Sanitizer"
          sub="FDA §4-703.11 — ppm bands per chemistry"
          status={{ red: s.sanitizer.out > 0, amber: s.sanitizer.today === 0 }}
          lines={[
            { n: s.sanitizer.today, label: 'readings today' },
            { n: s.sanitizer.out, label: 'out of spec (latest per point)', tone: s.sanitizer.out ? 'red' : null },
          ]}
        />
      </div>
    </div>
  );
}
