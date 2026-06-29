// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb } from '../../../../lib/db';
import { isValidShareTokenShape } from '../../../../lib/beoShare';
import { computeEstimateTotals, groupLineItemsBySection } from '../../../../lib/beoEstimate';
import EstimateDocument from '../../_components/EstimateDocument';
import SignForm from './SignForm';

export const dynamic = 'force-dynamic';

function notFound() {
  return (
    <div
      style={{
        padding: 40,
        fontFamily: 'var(--sans, "Inter Tight", system-ui, sans-serif)',
        textAlign: 'center',
        color: 'var(--ink, #1d1a15)',
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--serif, "Instrument Serif", Georgia, serif)',
          fontWeight: 400,
          fontSize: 36,
          letterSpacing: '-0.01em',
        }}
      >
        This invitation isn&apos;t available
      </h1>
      <p style={{ color: 'var(--muted, #7b7268)', maxWidth: 480, margin: '0 auto', lineHeight: 1.5 }}>
        The link may have expired or been entered incorrectly. Please reach out to your event host
        for a fresh link.
      </p>
    </div>
  );
}

export default async function BeoSharePage({ params }) {
  const p = (await params) || {};
  const token = p.token;
  if (!isValidShareTokenShape(token)) return notFound();

  const db = getDb();
  const event = db
    .prepare(
      `SELECT id, title, event_date, event_time, contact_name, guest_count,
              notes, tax_rate, service_fee_pct
         FROM beo_events
        WHERE share_token = ?`,
    )
    .get(token);
  if (!event) return notFound();

  const lineItems = db
    .prepare(
      `SELECT id, sort_order, item_name, category, unit_cost, quantity, course_id
         FROM beo_line_items
        WHERE event_id = ?
        ORDER BY sort_order, id`,
    )
    .all(event.id);

  const courses = db
    .prepare(
      `SELECT id, course_label, fire_at, notes, sort_order
         FROM beo_courses
        WHERE event_id = ?
        ORDER BY sort_order, id`,
    )
    .all(event.id);

  const signatures = db
    .prepare(
      `SELECT id, signed_name, signed_at FROM beo_signatures
        WHERE event_id = ? ORDER BY signed_at DESC, id DESC`,
    )
    .all(event.id);

  const totals = computeEstimateTotals(event, lineItems);
  const sections = groupLineItemsBySection(lineItems, courses);

  return (
    <>
      {/* Hide cockpit chrome on this guest-facing page. Inline so it ships
          with the route output without touching globals.css. */}
      <style dangerouslySetInnerHTML={{
        __html: `
          .sidebar, .strip, .command, .cmdk-scrim, .skip-link, footer.command { display: none !important; }
          .main { padding: 0 !important; max-width: none !important; }
          .app { display: block !important; height: auto !important; }
          body { background: #F4F0E8 !important; }
          @media print { body { background: white !important; } }
        `,
      }} />

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
