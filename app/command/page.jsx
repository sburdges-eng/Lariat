// GM Command Center — one screen with the "what do I need to know
// before service?" signals. Tile data comes from
// lib/commandCenter.summarize() so the page and /api/command/summary
// stay in lockstep. The page does its own preshift_notes + beo_events
// queries for the bottom list sections — the lib only counts those
// for the tile, not the row payloads.

import Link from 'next/link';
import { getDb, todayISO } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import { summarize } from '../../lib/commandCenter';

export const dynamic = 'force-dynamic';

function fmtUSD(n) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  return Number(n).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function tone(s) {
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

function fmtTime(t) {
  if (!t) return '';
  // beo_events.event_time is HH:MM (24h) text; render as 12h.
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  const mm = m[2];
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${mm} ${ampm}`;
}

export default function CommandCenter({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();
  const s = summarize(loc, today);
  const locQ = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';

  // Bottom-section payloads. summarize() only counts these — the lists
  // need full rows.
  const db = getDb();
  const preshift = db
    .prepare(
      `SELECT id, service_label, body, author_cook_id, updated_at
         FROM preshift_notes
        WHERE location_id = ? AND shift_date = ?
        ORDER BY id DESC`,
    )
    .all(loc, today);
  const events = db
    .prepare(
      `SELECT id, title, event_time, guest_count, status
         FROM beo_events
        WHERE location_id = ? AND event_date = ?
          AND COALESCE(status,'') NOT IN ('cancelled','canceled')
        ORDER BY COALESCE(event_time,'00:00') ASC`,
    )
    .all(loc, today);

  const reviews = db
    .prepare(
      `SELECT id, cook_name, review_date, punctuality_score, technique_score, speed_score, reviewer_name
         FROM performance_reviews
        WHERE location_id = ? AND review_date = ?
        ORDER BY id DESC`,
    )
    .all(loc, today);

  const salesAmber = s.sales.avg7_net > 0 && s.sales.delta_pct < -0.15;

  return (
    <div className="fs-hub">
      <h1>Command center</h1>
      <p className="subtitle">Where the kitchen stands right now.</p>

      <div className="fs-tiles">
        <Tile
          href={`/analytics${locQ}`}
          title="Sales"
          sub={`Yesterday vs 7-day average · ${s.yesterday}`}
          status={{ red: false, amber: salesAmber }}
          lines={[
            { n: fmtUSD(s.sales.yesterday_net), label: 'net sales yesterday' },
            { n: s.sales.orders, label: 'orders' },
            {
              n: fmtUSD(s.sales.avg7_net),
              label: '7-day avg',
              tone: salesAmber ? 'amber' : null,
            },
          ]}
        />
        <Tile
          href={`/eighty-six${locQ}`}
          title="86 board"
          sub="Active items off the menu right now"
          status={{ red: s.eighty_six > 0, amber: false }}
          lines={[
            { n: s.eighty_six, label: 'items 86’d', tone: s.eighty_six ? 'red' : null },
          ]}
        />
        <Tile
          href={`/inventory/par${locQ}`}
          title="Inventory"
          sub="Latest count vs par"
          status={{ red: false, amber: s.inventory.low_par > 0 }}
          lines={[
            { n: s.inventory.low_par, label: 'below par', tone: s.inventory.low_par ? 'amber' : null },
            { n: s.inventory.par_total, label: 'tracked items' },
            { n: s.inventory.open_counts, label: 'open counts' },
          ]}
        />
        <Tile
          href={`/costing/price-shocks${locQ}`}
          title="Price moves"
          sub="Vendor SKUs that moved 5%+ in 7 days"
          status={{
            red: s.price_moves.up >= 3,
            amber: s.price_moves.total > 0,
          }}
          lines={[
            { n: s.price_moves.up, label: 'up',
              tone: s.price_moves.up ? 'red' : null },
            { n: s.price_moves.down, label: 'down' },
            { n: s.price_moves.total, label: 'total moves' },
          ]}
        />
        <Tile
          href={`/menu-engineering/margin-deltas${locQ}`}
          title="Margin moves"
          sub="Dish costs that moved 5%+ in 7 days"
          status={{
            red: s.margin_moves.up >= 3,
            amber: s.margin_moves.total > 0,
          }}
          lines={[
            { n: s.margin_moves.up, label: 'up',
              tone: s.margin_moves.up ? 'red' : null },
            { n: s.margin_moves.down, label: 'down' },
            { n: s.margin_moves.total, label: 'total moves' },
          ]}
        />
        <Tile
          href={`/prep${locQ}`}
          title="Prep board"
          sub="Today's tasks across the line"
          status={{
            red: false,
            amber: s.prep.rush > 0 || s.prep.todo > 0,
          }}
          lines={[
            { n: s.prep.todo, label: 'to do',
              tone: s.prep.todo ? 'amber' : null },
            { n: s.prep.in_progress, label: 'in progress' },
            { n: s.prep.rush, label: 'high or rush',
              tone: s.prep.rush ? 'amber' : null },
          ]}
        />
        <Tile
          href={`/labor${locQ}`}
          title="Labor"
          sub="Breaks owed + cert expiry"
          status={{
            red: s.labor.cert_expired > 0,
            amber: s.labor.open_breaks > 0 || s.labor.cert_expiring_30d > 0,
          }}
          lines={[
            { n: s.labor.open_breaks, label: 'open breaks',
              tone: s.labor.open_breaks ? 'amber' : null },
            { n: s.labor.performance_reviews_today, label: 'reviews today' },
            { n: s.labor.cert_expiring_30d, label: 'certs expiring 30d',
              tone: s.labor.cert_expiring_30d ? 'amber' : null },
            { n: s.labor.cert_expired, label: 'expired certs',
              tone: s.labor.cert_expired ? 'red' : null },
          ]}
        />
        <Tile
          href={`/food-safety${locQ}`}
          title="Food safety"
          sub="Today’s temp readings + active date marks"
          status={{
            red:
              s.food_safety.temp_breaches > 0 ||
              s.food_safety.date_marks_expired > 0 ||
              s.food_safety.cleaning_overdue > 0,
            amber:
              s.food_safety.date_marks_due_today > 0 ||
              s.food_safety.cleaning_due_today > 0,
          }}
          lines={[
            { n: s.food_safety.temp_breaches, label: 'temp out of range',
              tone: s.food_safety.temp_breaches ? 'red' : null },
            { n: s.food_safety.date_marks_expired, label: 'expired marks',
              tone: s.food_safety.date_marks_expired ? 'red' : null },
            { n: s.food_safety.cleaning_overdue, label: 'cleaning overdue',
              tone: s.food_safety.cleaning_overdue ? 'red' : null },
          ]}
        />
        <Tile
          href={`/beo${locQ}`}
          title="Today’s events"
          sub="BEOs on the books"
          status={{ red: false, amber: events.length > 0 }}
          lines={[
            { n: events.length, label: 'events today' },
            {
              n: events.reduce((sum, e) => sum + (Number(e.guest_count) || 0), 0),
              label: 'total guests',
            },
          ]}
        />
        <Tile
          href={`/reservations${locQ}`}
          title="Reservations"
          sub="Tonight's book"
          status={{
            red: s.reservations.no_show >= 3,
            amber: s.reservations.booked > 0,
          }}
          lines={[
            { n: s.reservations.booked, label: 'still to seat',
              tone: s.reservations.booked ? 'amber' : null },
            { n: s.reservations.seated, label: 'seated' },
            { n: s.reservations.no_show, label: 'no-shows',
              tone: s.reservations.no_show ? 'red' : null },
          ]}
        />
      </div>

      {(preshift.length > 0 || events.length > 0 || reviews.length > 0) && (
        <div style={{ marginTop: 24, display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {preshift.length > 0 && (
            <section className="card">
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Preshift notes</h2>
              <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {preshift.map((n) => (
                  <li key={n.id} className="check-row">
                    <div>
                      <div className="check-name">
                        {n.service_label || 'all day'}
                      </div>
                      <div style={{ fontSize: 14, marginTop: 4 }}>{n.body}</div>
                      {n.author_cook_id && (
                        <div className="meta">— {n.author_cook_id}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {events.length > 0 && (
            <section className="card">
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Events today</h2>
              <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {events.map((e) => (
                  <li key={e.id} className="check-row">
                    <div>
                      <div className="check-name">
                        <Link href={`/beo/${e.id}${locQ}`}>{e.title}</Link>
                      </div>
                      <div className="meta">
                        {e.event_time && <>{fmtTime(e.event_time)} · </>}
                        {e.guest_count != null && <>{e.guest_count} guests</>}
                        {e.status && e.status !== 'planned' && <> · {e.status}</>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {reviews.length > 0 && (
            <section className="card">
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Reviews today</h2>
              <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {reviews.map((r) => (
                  <li key={r.id} className="check-row">
                    <div>
                      <div className="check-name">
                        <Link href={`/management/performance-reviews${locQ}`}>{r.cook_name}</Link>
                      </div>
                      <div className="meta">
                        Scores: {r.punctuality_score}/{r.technique_score}/{r.speed_score} · by {r.reviewer_name}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
