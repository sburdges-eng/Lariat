// GM Command Center — one screen with the "what do I need to know
// before service?" signals, pulled from the modules already shipped.
//
// Tiles compose existing sources without introducing new tables:
//   - Sales: toast_sales_daily (yesterday vs DOW comparison group)
//   - 86 board: eighty_six (active count)
//   - Inventory: inventory_par × latest inventory_count_lines (low rows)
//   - Labor: shift_breaks, staff_certifications
//   - Food safety: temp_log breach counts via classifyReadings
//   - Today: preshift_notes for current shift, beo_events for the day

import Link from 'next/link';
import { getDb, todayISO } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import { classifyReadings } from '../../lib/tempLog';
import { listPriceShocks } from '../../lib/vendorPricesRepo';
import { listMarginDeltas } from '../../lib/marginDeltas';

export const dynamic = 'force-dynamic';

function yesterdayISO(today) {
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function fmtUSD(n) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  return Number(n).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function summarize(loc, today) {
  const db = getDb();
  const yesterday = yesterdayISO(today);

  // ── Sales (yesterday + 7-day average) ───────────────────────────
  // toast_sales_daily.comparison_group: 1 = current period.
  const yRow =
    db
      .prepare(
        `SELECT net_sales, orders, guests
           FROM toast_sales_daily
          WHERE location_id = ? AND comparison_group = 1 AND shift_date = ?`,
      )
      .get(loc, yesterday) || { net_sales: 0, orders: 0, guests: 0 };
  const trailing = db
    .prepare(
      `SELECT AVG(net_sales) AS avg_sales, AVG(orders) AS avg_orders
         FROM (
           SELECT net_sales, orders FROM toast_sales_daily
            WHERE location_id = ? AND comparison_group = 1
              AND shift_date < ?
            ORDER BY shift_date DESC LIMIT 7
         )`,
    )
    .get(loc, today) || { avg_sales: 0, avg_orders: 0 };

  // ── 86 board ────────────────────────────────────────────────────
  const eightySix = db
    .prepare(
      `SELECT COUNT(*) AS c FROM eighty_six
        WHERE location_id = ? AND shift_date = ? AND resolved_at IS NULL`,
    )
    .get(loc, today).c;

  // ── Inventory: low-par signal from latest count line per ingredient
  // Mirrors the join in /inventory/par. Uses MAX(counted_at) per
  // (ingredient, sku) to select the latest reading.
  const lowRows = db
    .prepare(
      `SELECT p.ingredient
         FROM inventory_par p
         JOIN (
           SELECT l1.ingredient, l1.sku, l1.on_hand_qty
             FROM inventory_count_lines l1
            WHERE l1.location_id = ?
              AND l1.counted_at = (
                SELECT MAX(l2.counted_at)
                  FROM inventory_count_lines l2
                 WHERE l2.location_id = l1.location_id
                   AND l2.ingredient = l1.ingredient
                   AND COALESCE(l2.sku,'') = COALESCE(l1.sku,'')
              )
         ) AS latest
           ON latest.ingredient = p.ingredient
          AND COALESCE(latest.sku,'') = COALESCE(p.sku,'')
        WHERE p.location_id = ?
          AND p.par_qty IS NOT NULL
          AND latest.on_hand_qty IS NOT NULL
          AND latest.on_hand_qty < p.par_qty`,
    )
    .all(loc, loc);
  const parCount = db
    .prepare(`SELECT COUNT(*) AS c FROM inventory_par WHERE location_id = ?`)
    .get(loc).c;
  const openCounts = db
    .prepare(
      `SELECT COUNT(*) AS c FROM inventory_counts
        WHERE location_id = ? AND closed_at IS NULL`,
    )
    .get(loc).c;

  // ── Labor: open breaks + cert expiry rollup ─────────────────────
  const breaksToday = db
    .prepare(
      `SELECT ended_at, waived FROM shift_breaks
        WHERE location_id = ? AND shift_date = ?`,
    )
    .all(loc, today);
  const openBreaks = breaksToday.filter((b) => !b.ended_at && !b.waived).length;

  const expiryRows = db
    .prepare(
      `SELECT expires_on FROM staff_certifications
        WHERE location_id = ? AND expires_on IS NOT NULL AND active = 1`,
    )
    .all(loc);
  const now = new Date(today + 'T00:00:00').getTime();
  let expired = 0, soon = 0;
  for (const c of expiryRows) {
    const exp = new Date(c.expires_on + 'T00:00:00').getTime();
    const days = Math.floor((exp - now) / 86400000);
    if (days < 0) expired += 1;
    else if (days <= 30) soon += 1;
  }

  // ── Food safety: temp_log breaches today ────────────────────────
  // classifyReadings returns one PointSummary per CCP point with a
  // tile-style status ('red' | 'yellow' | 'green' | 'gray'). 'red'
  // means at least one out-of-range reading without a corrective note —
  // that's the GM's "fix this before service" signal.
  const todayTemps = db
    .prepare(
      `SELECT id, point_id, reading_f, required_min_f, required_max_f,
              corrective_action, created_at
         FROM temp_log
        WHERE location_id = ? AND shift_date = ?`,
    )
    .all(loc, today);
  const tempClassified = classifyReadings(todayTemps, { expectAllPoints: false });
  const tempBreaches = tempClassified.filter((t) => t.status === 'red').length;

  // ── Costing: vendor price moves over the last 7 days ───────────
  // 5% threshold matches the price-shocks page default; a 5%+ swing on
  // a frequently-used SKU is enough to materially shift a dish margin.
  const priceShocks = listPriceShocks(db, {
    location_id: loc,
    windowDays: 7,
    minPctMove: 5,
    limit: 100,
  });
  const priceUp = priceShocks.filter((r) => r.direction === 'up').length;
  const priceDown = priceShocks.filter((r) => r.direction === 'down').length;

  // ── Margin moves: dish-level cost moves over the last 7 days ────
  // Parallels the price-shocks tile but rolls vendor moves up to the
  // dish level so the GM sees which menu items are actually shifting.
  const marginDeltas = listMarginDeltas(db, {
    location_id: loc,
    windowDays: 7,
    minPctMove: 5,
    limit: 100,
  });
  const marginUp = marginDeltas.filter((r) => r.direction === 'up').length;
  const marginDown = marginDeltas.filter((r) => r.direction === 'down').length;

  // ── Prep board: today's status counts + rush flag ───────────────
  const prepRows = db
    .prepare(
      `SELECT status, priority FROM prep_tasks
        WHERE location_id = ? AND shift_date = ?`,
    )
    .all(loc, today);
  const prep = { todo: 0, in_progress: 0, done: 0, skipped: 0, rush: 0 };
  for (const r of prepRows) {
    if (prep[r.status] !== undefined) prep[r.status] += 1;
    if ((r.priority === 1 || r.priority === 2) &&
        (r.status === 'todo' || r.status === 'in_progress')) {
      prep.rush += 1;
    }
  }

  // ── Today: preshift notes + BEOs ────────────────────────────────
  const preshift = db
    .prepare(
      `SELECT id, service_label, body, author_cook_id, updated_at
         FROM preshift_notes
        WHERE location_id = ? AND shift_date = ?
        ORDER BY id DESC`,
    )
    .all(loc, today);
  const todaysEvents = db
    .prepare(
      `SELECT id, title, event_time, guest_count, status
         FROM beo_events
        WHERE location_id = ? AND event_date = ?
          AND COALESCE(status,'') NOT IN ('cancelled','canceled')
        ORDER BY COALESCE(event_time,'00:00') ASC`,
    )
    .all(loc, today);

  // ── Reservations: today's book by status ────────────────────────
  // reservation_at is TEXT 'YYYY-MM-DD HH:MM', so a date-prefix match
  // pulls everything booked for today regardless of seating time.
  const resRows = db
    .prepare(
      `SELECT status, COUNT(*) AS c FROM reservations
        WHERE location_id = ?
          AND substr(reservation_at, 1, 10) = ?
        GROUP BY status`,
    )
    .all(loc, today);
  const resCounts = { booked: 0, seated: 0, completed: 0, cancelled: 0, no_show: 0 };
  for (const r of resRows) {
    if (resCounts[r.status] !== undefined) resCounts[r.status] = r.c;
  }
  const resTotal =
    resCounts.booked + resCounts.seated + resCounts.completed + resCounts.no_show;

  return {
    sales: {
      yesterday: yRow.net_sales || 0,
      orders: yRow.orders || 0,
      guests: yRow.guests || 0,
      avg7: trailing.avg_sales || 0,
      avg7Orders: trailing.avg_orders || 0,
    },
    eightySix,
    inventory: {
      low: lowRows.length,
      parTotal: parCount,
      openCounts,
    },
    labor: {
      openBreaks,
      certExpired: expired,
      certSoon: soon,
    },
    foodSafety: {
      tempBreaches,
      tempReadings: todayTemps.length,
    },
    priceMoves: {
      total: priceShocks.length,
      up: priceUp,
      down: priceDown,
    },
    marginMoves: {
      total: marginDeltas.length,
      up: marginUp,
      down: marginDown,
    },
    prep,
    preshift,
    events: todaysEvents,
    reservations: {
      booked: resCounts.booked,
      seated: resCounts.seated,
      completed: resCounts.completed,
      no_show: resCounts.no_show,
      total: resTotal,
    },
    yesterday,
  };
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

  const salesDelta = s.sales.avg7 > 0 ? (s.sales.yesterday - s.sales.avg7) / s.sales.avg7 : 0;
  const salesAmber = salesDelta < -0.15;

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
            { n: fmtUSD(s.sales.yesterday), label: 'net sales yesterday' },
            { n: s.sales.orders, label: 'orders' },
            {
              n: fmtUSD(s.sales.avg7),
              label: '7-day avg',
              tone: salesAmber ? 'amber' : null,
            },
          ]}
        />
        <Tile
          href={`/eighty-six${locQ}`}
          title="86 board"
          sub="Active items off the menu right now"
          status={{ red: s.eightySix > 0, amber: false }}
          lines={[
            { n: s.eightySix, label: 'items 86’d', tone: s.eightySix ? 'red' : null },
          ]}
        />
        <Tile
          href={`/inventory/par${locQ}`}
          title="Inventory"
          sub="Latest count vs par"
          status={{ red: false, amber: s.inventory.low > 0 }}
          lines={[
            { n: s.inventory.low, label: 'below par', tone: s.inventory.low ? 'amber' : null },
            { n: s.inventory.parTotal, label: 'tracked items' },
            { n: s.inventory.openCounts, label: 'open counts' },
          ]}
        />
        <Tile
          href={`/costing/price-shocks${locQ}`}
          title="Price moves"
          sub="Vendor SKUs that moved 5%+ in 7 days"
          status={{
            red: s.priceMoves.up >= 3,
            amber: s.priceMoves.total > 0,
          }}
          lines={[
            { n: s.priceMoves.up, label: 'up',
              tone: s.priceMoves.up ? 'red' : null },
            { n: s.priceMoves.down, label: 'down' },
            { n: s.priceMoves.total, label: 'total moves' },
          ]}
        />
        <Tile
          href={`/menu-engineering/margin-deltas${locQ}`}
          title="Margin moves"
          sub="Dish costs that moved 5%+ in 7 days"
          status={{
            red: s.marginMoves.up >= 3,
            amber: s.marginMoves.total > 0,
          }}
          lines={[
            { n: s.marginMoves.up, label: 'up',
              tone: s.marginMoves.up ? 'red' : null },
            { n: s.marginMoves.down, label: 'down' },
            { n: s.marginMoves.total, label: 'total moves' },
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
            red: s.labor.certExpired > 0,
            amber: s.labor.openBreaks > 0 || s.labor.certSoon > 0,
          }}
          lines={[
            { n: s.labor.openBreaks, label: 'open breaks',
              tone: s.labor.openBreaks ? 'amber' : null },
            { n: s.labor.certSoon, label: 'certs expiring 30d',
              tone: s.labor.certSoon ? 'amber' : null },
            { n: s.labor.certExpired, label: 'expired',
              tone: s.labor.certExpired ? 'red' : null },
          ]}
        />
        <Tile
          href={`/food-safety${locQ}`}
          title="Food safety"
          sub="Today’s temp readings"
          status={{ red: s.foodSafety.tempBreaches > 0, amber: false }}
          lines={[
            { n: s.foodSafety.tempReadings, label: 'readings logged' },
            { n: s.foodSafety.tempBreaches, label: 'out of range',
              tone: s.foodSafety.tempBreaches ? 'red' : null },
          ]}
        />
        <Tile
          href={`/beo${locQ}`}
          title="Today’s events"
          sub="BEOs on the books"
          status={{ red: false, amber: s.events.length > 0 }}
          lines={[
            { n: s.events.length, label: 'events today' },
            {
              n: s.events.reduce((sum, e) => sum + (Number(e.guest_count) || 0), 0),
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

      {(s.preshift.length > 0 || s.events.length > 0) && (
        <div style={{ marginTop: 24, display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {s.preshift.length > 0 && (
            <section className="card">
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Preshift notes</h2>
              <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {s.preshift.map((n) => (
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
          {s.events.length > 0 && (
            <section className="card">
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Events today</h2>
              <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {s.events.map((e) => (
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
        </div>
      )}
    </div>
  );
}
