// @ts-nocheck - pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// app/beo/[id]/estimate/page.jsx
import { notFound } from 'next/navigation';
import { getDb } from '../../../../lib/db';
import { computeEstimateTotals, groupLineItemsBySection } from '../../../../lib/beoEstimate';
import EstimateDocument from '../../_components/EstimateDocument';
import CopyLinkButton from '../../_components/CopyLinkButton';

export const dynamic = 'force-dynamic';

export default async function OperatorEstimatePage({ params }) {
  const { id } = (await params) || {};
  const db = getDb();
  const event = db.prepare(
    `SELECT id, title, event_date, event_time, contact_name, guest_count, notes,
            tax_rate, service_fee_pct, status, share_token FROM beo_events WHERE id = ?`).get(id);
  if (!event) return notFound();
  const lineItems = db.prepare(
    `SELECT id, sort_order, item_name, category, unit_cost, quantity, course_id
       FROM beo_line_items WHERE event_id = ? ORDER BY sort_order, id`).all(event.id);
  const courses = db.prepare(
    `SELECT id, course_label, fire_at, notes, sort_order FROM beo_courses WHERE event_id = ? ORDER BY sort_order, id`).all(event.id);
  const signatures = db.prepare(
    `SELECT id, signed_name, signed_at FROM beo_signatures WHERE event_id = ? ORDER BY signed_at DESC, id DESC`).all(event.id);
  const totals = computeEstimateTotals(event, lineItems);
  const sections = groupLineItemsBySection(lineItems, courses);
  const shareUrl = event.share_token ? `/beo/share/${event.share_token}` : null;
  return (
    <div style={{ padding: 16 }}>
      <div data-print="false" style={{ marginBottom: 12 }}>
        {shareUrl ? <CopyLinkButton url={shareUrl} /> : <span className="muted">No client link yet — generate one in the board.</span>}
      </div>
      <EstimateDocument event={event} sections={sections} totals={totals}
        courses={courses} signatures={signatures} register="operator" />
    </div>
  );
}
