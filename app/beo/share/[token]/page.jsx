// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { getDb } from '../../../../lib/db';
import { isValidShareTokenShape } from '../../../../lib/beoShare';
import { computeEstimateTotals, groupLineItemsBySection } from '../../../../lib/beoEstimate';
import EstimateDocument from '../../_components/EstimateDocument';
import SignForm from './SignForm';

export const dynamic = 'force-dynamic';

/**
 * Next 15 route context: `params` may be a promise.
 * @typedef {{ params: Promise<{ token?: string }> | { token?: string } }} PageProps
 */

/**
 * The public-doc columns this page reads off beo_events for the guest
 * render. Mirrors what GET /api/beo/share/[token] returns (minus
 * location_id, which that route strips before responding and this page
 * never selects).
 * @typedef {{ id: number, title: string, event_date: string | null,
 *             event_time: string | null, contact_name: string | null,
 *             guest_count: number | null, notes: string | null,
 *             tax_rate: number | null, service_fee_pct: number | null }} ShareEventRow
 */

/**
 * @typedef {{ id: number, sort_order: number | null, item_name: string,
 *             category: string | null, unit_cost: number | null,
 *             quantity: number | null, course_id: number | null }} ShareLineItemRow
 */

/**
 * @typedef {{ id: number, course_label: string, fire_at: string | null,
 *             notes: string | null, sort_order: number | null }} ShareCourseRow
 */

/** @typedef {{ id: number, signed_name: string, signed_at: string }} ShareSignatureRow */

// Hide cockpit chrome on this guest-facing route and paint the viewport the
// heritage cream so the page reads as a standalone document, not an app screen.
// Inline so it ships with the route output without touching globals.css. Shared
// by both the success render and the notFound notice — otherwise an expired link
// would render inside the dark cockpit shell (sidebar/strip/command visible).
function GuestChrome() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
          .sidebar, .strip, .command, .cmdk-scrim, .skip-link, footer.command,
          .floorplan-trigger, .floorplan-scrim { display: none !important; }
          .main { padding: 0 !important; max-width: none !important; }
          .app { display: block !important; height: auto !important; }
          body { background: #F4F0E8 !important; }
          @media print { body { background: white !important; } }
        `,
      }}
    />
  );
}

function notFound() {
  // Colors are heritage-doc literals (--ink / --slate / --cream) rather than
  // global tokens: the Service Ledger :root palette is dark, so var(--ink) would
  // resolve to light bone and go invisible on the cream body GuestChrome sets.
  return (
    <>
      <GuestChrome />
      <div
        style={{
          minHeight: '100vh',
          padding: 40,
          fontFamily: 'var(--sans, "Inter Tight", system-ui, sans-serif)',
          textAlign: 'center',
          color: '#1A1814',
          background: '#F4F0E8',
        }}
      >
        <h1
          style={{
            fontFamily: 'Georgia, "Times New Roman", serif',
            fontWeight: 400,
            fontSize: 36,
            letterSpacing: '-0.01em',
            color: '#1A1814',
          }}
        >
          This invitation isn&apos;t available
        </h1>
        <p style={{ color: '#6B7280', maxWidth: 480, margin: '0 auto', lineHeight: 1.5 }}>
          The link may have expired or been entered incorrectly. Please reach out to your event host
          for a fresh link.
        </p>
      </div>
    </>
  );
}

/** @param {PageProps} props */
export default async function BeoSharePage({ params }) {
  const p = (await params) || {};
  const token = p.token;
  if (!isValidShareTokenShape(token)) return notFound();

  const db = getDb();
  const event = /** @type {ShareEventRow | undefined} */ (db
    .prepare(
      `SELECT id, title, event_date, event_time, contact_name, guest_count,
              notes, tax_rate, service_fee_pct
         FROM beo_events
        WHERE share_token = ?`,
    )
    .get(token));
  if (!event) return notFound();

  const lineItems = /** @type {ShareLineItemRow[]} */ (db
    .prepare(
      `SELECT id, sort_order, item_name, category, unit_cost, quantity, course_id
         FROM beo_line_items
        WHERE event_id = ?
        ORDER BY sort_order, id`,
    )
    .all(event.id));

  const courses = /** @type {ShareCourseRow[]} */ (db
    .prepare(
      `SELECT id, course_label, fire_at, notes, sort_order
         FROM beo_courses
        WHERE event_id = ?
        ORDER BY sort_order, id`,
    )
    .all(event.id));

  const signatures = /** @type {ShareSignatureRow[]} */ (db
    .prepare(
      `SELECT id, signed_name, signed_at FROM beo_signatures
        WHERE event_id = ? ORDER BY signed_at DESC, id DESC`,
    )
    .all(event.id));

  const totals = computeEstimateTotals(event, lineItems);
  const sections = groupLineItemsBySection(lineItems, courses);

  return (
    <>
      <GuestChrome />

      <EstimateDocument
        event={event}
        sections={sections}
        totals={totals}
        courses={courses}
        signatures={signatures}
        register="client"
        signSlot={<SignForm token={token} />}
      />
    </>
  );
}
