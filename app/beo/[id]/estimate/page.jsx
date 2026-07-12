// @ts-check
// app/beo/[id]/estimate/page.jsx
import { notFound } from 'next/navigation';
import { getDb } from '../../../../lib/db';
import { computeEstimateTotals, groupLineItemsBySection } from '../../../../lib/beoEstimate';
import { computeLineFoodCosts } from '../../../../lib/beoFoodCost';
import EstimateDocument from '../../_components/EstimateDocument';
import CopyLinkButton from '../../_components/CopyLinkButton';

/** @typedef {import('../../../../lib/beoEstimate.ts').EstimateLineItem} EstimateLineItem */

/**
 * The columns this operator page selects off beo_events — a superset of
 * lib/db.ts's BeoEvent, which doesn't declare share_token (added later by
 * an ALTER migration; see the identical ShareEventRow gap documented in
 * app/api/beo/[id]/share-token/route.js).
 * @typedef {{
 *   id: number,
 *   title: string,
 *   event_date: string | null,
 *   event_time: string | null,
 *   contact_name: string | null,
 *   guest_count: number | null,
 *   notes: string | null,
 *   tax_rate: number | null,
 *   service_fee_pct: number | null,
 *   status: string,
 *   share_token: string | null,
 *   location_id: string,
 *   min_spend: number | null,
 * }} OperatorEstimateEventRow
 */

/**
 * @typedef {{ id: number, course_label: string, fire_at: string, notes: string | null, sort_order: number }} OperatorEstimateCourseRow
 */

/**
 * @typedef {{ id: number, signed_name: string, signed_at: string }} OperatorEstimateSignatureRow
 */

/** @typedef {{ params: Promise<{ id?: string }> | { id?: string } }} RouteCtx */

export const dynamic = 'force-dynamic';

/** @param {RouteCtx} props */
export default async function OperatorEstimatePage({ params }) {
  const { id } = (await params) || {};
  const db = getDb();
  const event = /** @type {OperatorEstimateEventRow | undefined} */ (db.prepare(
    `SELECT id, title, event_date, event_time, contact_name, guest_count, notes,
            tax_rate, service_fee_pct, status, share_token, location_id, min_spend
       FROM beo_events WHERE id = ?`).get(id));
  if (!event) return notFound();
  const lineItems = /** @type {EstimateLineItem[]} */ (db.prepare(
    `SELECT id, sort_order, item_name, category, unit_cost, quantity, course_id
       FROM beo_line_items WHERE event_id = ? ORDER BY sort_order, id`).all(event.id));
  const courses = /** @type {OperatorEstimateCourseRow[]} */ (db.prepare(
    `SELECT id, course_label, fire_at, notes, sort_order FROM beo_courses WHERE event_id = ? ORDER BY sort_order, id`).all(event.id));
  const signatures = /** @type {OperatorEstimateSignatureRow[]} */ (db.prepare(
    `SELECT id, signed_name, signed_at FROM beo_signatures WHERE event_id = ? ORDER BY signed_at DESC, id DESC`).all(event.id));
  const totals = computeEstimateTotals(event, lineItems);
  const sections = groupLineItemsBySection(lineItems, courses);
  // Operator-only food-cost overlay (read-only; honestly flags unlinked lines).
  const foodCosts = computeLineFoodCosts(lineItems, event.location_id ?? 'default', db);
  const shareUrl = event.share_token ? `/beo/share/${event.share_token}` : null;
  return (
    <div style={{ padding: 16 }}>
      <div data-print="false" style={{ marginBottom: 12 }}>
        {shareUrl ? <CopyLinkButton url={shareUrl} /> : <span className="muted">No client link yet — generate one in the board.</span>}
      </div>
      <EstimateDocument event={event} sections={sections} totals={totals}
        courses={courses} signatures={signatures} register="operator"
        foodCosts={foodCosts} minSpend={event.min_spend ?? null} />
    </div>
  );
}
