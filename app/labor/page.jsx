// @ts-check
// Labor hub — CO COMPS #39, HFWA, certs, tip pool, wage notices.
//
// Single morning-sanity page for the labor-compliance surface. The
// lens is "what is the restaurant liable for if a cook files a claim
// tomorrow?" Each tile counts current records and a status colour
// (red = action required, amber = soon, green = clean).

import Link from 'next/link';
import { getDb, todayISO } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import { classifyReview } from '../../lib/performanceReviews';
import { formatMoney } from '../../lib/formatMoney';

/** @typedef {Pick<import('../../lib/db.ts').ShiftBreak, 'kind' | 'ended_at' | 'waived'>} BreakRow */

/** @typedef {Pick<import('../../lib/db.ts').StaffCertification, 'id' | 'cert_type' | 'cook_id' | 'expires_on'>} CertExpiryRow */

/** @typedef {Pick<import('../../lib/db.ts').PaidSickLeaveBalance, 'cook_id' | 'hours_accrued' | 'cap_hours'>} SickLeaveRow */

/** @typedef {{ lines: number, cents: number }} TipPoolSummaryRow */

/** @typedef {{ cook_id: string, latest: string | null }} WageNoticeLatestRow */

/** @typedef {Pick<import('../../lib/db.ts').PerformanceReview, 'punctuality_score' | 'technique_score' | 'speed_score'>} ReviewScoreRow */

/**
 * @typedef {Object} LaborSummary
 * @property {{ open: number, meals: number, rests: number }} breaks
 * @property {{ expired: number, soon: number, total: number }} certs
 * @property {{ tracked: number, atCap: number }} sick
 * @property {{ lines: number, cents: number }} tips
 * @property {{ cooks: number, stale: number }} wage
 * @property {{ today: number, total: number, red: number, amber: number }} reviews
 */

export const dynamic = 'force-dynamic';

/**
 * @param {string} loc
 * @param {string} today
 * @param {number} year
 * @returns {LaborSummary}
 */
function summarize(loc, today, year) {
  const db = getDb();

  // L1 — breaks owed today.
  const breaksToday = /** @type {BreakRow[]} */ (
    db
      .prepare(
        `SELECT kind, ended_at, waived FROM shift_breaks
        WHERE location_id=? AND shift_date=?`,
      )
      .all(loc, today)
  );
  const openBreaks = breaksToday.filter((b) => !b.ended_at && !b.waived).length;
  const mealsLogged = breaksToday.filter((b) => b.kind === 'meal').length;
  const restsLogged = breaksToday.filter((b) => b.kind === 'rest').length;

  // L3 — cert expiry within 30d. Only `active` certs count toward
  // liability — a retired/superseded cert (worker left, or the cert
  // was renewed and the old row deactivated) with a stale expires_on
  // is not a live gap. Every other consumer of this table already
  // agrees: lib/commandCenter.ts and lib/dbQueryRegistry.ts both
  // filter `active = 1`, and this tile's own sibling detail page
  // (app/labor/certs/CertBoard.jsx) renders `active === 0` rows as
  // 'muted', never red/amber. This query used to omit that filter,
  // so a departed or renewed cook's dead cert record could flip this
  // tile red for a liability that doesn't actually exist. Fixed here
  // to match the canonical filter.
  const expiryRows = /** @type {CertExpiryRow[]} */ (
    db
      .prepare(
        `SELECT id, cert_type, cook_id, expires_on
         FROM staff_certifications
        WHERE location_id=?
          AND active = 1
          AND expires_on IS NOT NULL`,
      )
      .all(loc)
  );
  const now = new Date(today + 'T00:00:00').getTime();
  let expired = 0;
  let soon = 0;
  for (const c of expiryRows) {
    const exp = new Date(c.expires_on + 'T00:00:00').getTime();
    const days = Math.floor((exp - now) / 86400000);
    if (days < 0) expired += 1;
    else if (days <= 30) soon += 1;
  }

  // L2 — sick leave: count cooks tracked + at cap.
  const sickRows = /** @type {SickLeaveRow[]} */ (
    db
      .prepare(
        `SELECT cook_id, hours_accrued, cap_hours
         FROM paid_sick_leave_balances
        WHERE location_id=? AND accrual_year=?`,
      )
      .all(loc, year)
  );
  const sickAtCap = sickRows.filter(
    (r) => r.hours_accrued >= (r.cap_hours ?? 48) - 1e-9,
  ).length;

  // L4 — tip pool: lines + total cents today.
  const tipRow = /** @type {TipPoolSummaryRow} */ (
    db
      .prepare(
        `SELECT COUNT(*) AS lines, COALESCE(SUM(amount_cents), 0) AS cents
         FROM tip_pool_distributions
        WHERE location_id=? AND shift_date=?`,
      )
      .get(loc, today)
  );

  // L7 — wage notices: cooks on file + count stale (>365d).
  const wageRows = /** @type {WageNoticeLatestRow[]} */ (
    db
      .prepare(
        `SELECT cook_id, MAX(signed_on) AS latest
         FROM wage_notices
        WHERE location_id=?
        GROUP BY cook_id`,
      )
      .all(loc)
  );
  const cutoff = (() => {
    const d = new Date(today);
    d.setDate(d.getDate() - 365);
    return d.toISOString().slice(0, 10);
  })();
  const wageStale = wageRows.filter((r) => r.latest && r.latest < cutoff).length;

  // L8 — performance reviews: count today + total.
  const reviewsTodayRows = /** @type {ReviewScoreRow[]} */ (
    db
      .prepare(
        `SELECT punctuality_score, technique_score, speed_score
         FROM performance_reviews
        WHERE location_id=? AND review_date=?`,
      )
      .all(loc, today)
  );

  const reviewsTodayCount = reviewsTodayRows.length;
  const reviewsTotal = /** @type {{ c: number }} */ (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM performance_reviews
        WHERE location_id=?`,
      )
      .get(loc)
  ).c;

  const classifications = reviewsTodayRows.map(r => classifyReview(r));
  const reviewsRed = classifications.filter(c => c.status === 'red').length;
  const reviewsAmber = classifications.filter(c => c.status === 'amber').length;

  return {
    breaks: { open: openBreaks, meals: mealsLogged, rests: restsLogged },
    certs: { expired, soon, total: expiryRows.length },
    sick: { tracked: sickRows.length, atCap: sickAtCap },
    tips: { lines: tipRow.lines, cents: tipRow.cents },
    wage: { cooks: wageRows.length, stale: wageStale },
    reviews: { today: reviewsTodayCount, total: reviewsTotal, red: reviewsRed, amber: reviewsAmber },
  };
}

/**
 * @param {{ red: boolean, amber: boolean }} s
 * @returns {'red' | 'amber' | 'green'}
 */
function tone(s) {
  if (s.red) return 'red';
  if (s.amber) return 'amber';
  return 'green';
}

/**
 * @param {{
 *   href: string,
 *   title: string,
 *   sub: string,
 *   status: { red: boolean, amber: boolean },
 *   lines: Array<{ n: number | string, label: string, tone?: string | null }>,
 * }} props
 */
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

/** @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props */
export default async function LaborHub({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();
  const year = new Date().getFullYear();
  const s = summarize(loc, today, year);
  const locQ = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';

  return (
    <div className="fs-hub">
      <h1>Labor</h1>
      <p className="subtitle">
        Breaks, certs, sick time, tip pool, and wage notices in one place.
      </p>
      <div className="fs-tiles">
        <Tile
          href={`/labor/breaks${locQ}`}
          title="Breaks"
          sub="COMPS #39 — 10 min paid rest / 4h, 30 min meal on shifts ≥ 5h"
          status={{ red: false, amber: s.breaks.open > 0 }}
          lines={[
            {
              n: s.breaks.open,
              label: 'open breaks (forgotten end?)',
              tone: s.breaks.open ? 'amber' : null,
            },
            { n: s.breaks.meals, label: 'meals logged today' },
            { n: s.breaks.rests, label: 'rests logged today' },
          ]}
        />
        <Tile
          href={`/labor/certs${locQ}`}
          title="Certifications"
          sub="CFPM, food-handler, alcohol-service — CO 6 CCR 1010-2"
          status={{ red: s.certs.expired > 0, amber: s.certs.soon > 0 }}
          lines={[
            { n: s.certs.total, label: 'tracked certs' },
            {
              n: s.certs.soon,
              label: 'expiring in 30 days',
              tone: s.certs.soon ? 'amber' : null,
            },
            { n: s.certs.expired, label: 'expired', tone: s.certs.expired ? 'red' : null },
          ]}
        />
        <Tile
          href={`/labor/sick-leave${locQ}`}
          title="Sick time"
          sub="HFWA — earn 1h per 30h worked, 48h cap"
          status={{ red: false, amber: s.sick.atCap > 0 }}
          lines={[
            { n: s.sick.tracked, label: 'cooks tracked this year' },
            {
              n: s.sick.atCap,
              label: 'at the 48h cap',
              tone: s.sick.atCap ? 'amber' : null,
            },
          ]}
        />
        <Tile
          href={`/labor/tip-pool${locQ}`}
          title="Tip pool"
          sub="COMPS #39 §3.3, §3.4 — pool excludes managers"
          status={{ red: false, amber: false }}
          lines={[
            { n: s.tips.lines, label: 'lines today' },
            { n: formatMoney(s.tips.cents, { nullDisplay: '$0.00' }), label: 'paid out today' },
          ]}
        />
        <Tile
          href={`/labor/wage-notices${locQ}`}
          title="Wage notices"
          sub="CO Wage Theft Transparency — refresh yearly or on change"
          status={{ red: s.wage.stale > 0, amber: false }}
          lines={[
            { n: s.wage.cooks, label: 'cooks on file' },
            {
              n: s.wage.stale,
              label: 'need a new notice',
              tone: s.wage.stale ? 'red' : null,
            },
          ]}
        />
        <Tile
          href={`/management/performance-reviews${locQ}`}
          title="Staff reviews"
          sub="Performance logs — technique, speed, and punctuality"
          status={{ red: s.reviews.red > 0, amber: s.reviews.amber > 0 }}
          lines={[
            { n: s.reviews.today, label: 'logged today' },
            { n: s.reviews.total, label: 'total on record' },
          ]}
        />
      </div>
    </div>
  );
}
