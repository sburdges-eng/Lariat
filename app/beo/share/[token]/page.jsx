import { getDb } from '../../../../lib/db';
import { isValidShareTokenShape } from '../../../../lib/beoShare';
import SignForm from './SignForm';

export const dynamic = 'force-dynamic';

const USD = (n) =>
  Number(n || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
};

const fmtTime = (t) => {
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  const min = m[2];
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${min} ${period}`;
};

const fmtFireAt = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
};

function notFound() {
  return (
    <div style={{ padding: 40, fontFamily: 'system-ui', textAlign: 'center' }}>
      <h1>This invitation isn’t available</h1>
      <p style={{ color: '#666' }}>
        The link may have expired or been entered incorrectly. Please reach out to your event host
        for a fresh link.
      </p>
    </div>
  );
}

export default function BeoSharePage({ params }) {
  const token = params?.token;
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

  const subtotal = lineItems.reduce(
    (acc, l) => acc + Number(l.unit_cost || 0) * Number(l.quantity || 0),
    0,
  );
  const serviceFee = subtotal * (Number(event.service_fee_pct || 0) / 100);
  const tax = subtotal * Number(event.tax_rate || 0);
  const total = subtotal + serviceFee + tax;

  // Map line items to their course label (if any) so the doc can group them.
  const courseLabel = new Map();
  for (const c of courses) courseLabel.set(c.id, c.course_label);

  return (
    <>
      {/* Hide cockpit chrome on this guest-facing page. Inline so it ships
          with the route output without touching globals.css. */}
      <style dangerouslySetInnerHTML={{
        __html: `
          .sidebar, .strip, .command, .cmdk-scrim, .skip-link, footer.command { display: none !important; }
          .main { padding: 0 !important; max-width: none !important; }
          .app { display: block !important; height: auto !important; }
          @media print { body { background: white !important; } }
        `,
      }} />

      <div
        style={{
          maxWidth: 760,
          margin: '0 auto',
          padding: '40px 32px 80px',
          fontFamily: 'Georgia, "Times New Roman", serif',
          color: '#1a1a1a',
          lineHeight: 1.5,
        }}
      >
        <header style={{ borderBottom: '2px solid #1a1a1a', paddingBottom: 18, marginBottom: 24 }}>
          <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#888' }}>
            Banquet Event Order
          </div>
          <h1 style={{ margin: '6px 0 12px', fontSize: 32, lineHeight: 1.15 }}>{event.title}</h1>
          <dl style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px 16px', margin: 0, fontSize: 14 }}>
            {event.event_date && (
              <>
                <dt style={{ color: '#666' }}>Date</dt>
                <dd style={{ margin: 0 }}>{fmtDate(event.event_date)}</dd>
              </>
            )}
            {event.event_time && (
              <>
                <dt style={{ color: '#666' }}>Time</dt>
                <dd style={{ margin: 0 }}>{fmtTime(event.event_time)}</dd>
              </>
            )}
            {event.contact_name && (
              <>
                <dt style={{ color: '#666' }}>Host</dt>
                <dd style={{ margin: 0 }}>{event.contact_name}</dd>
              </>
            )}
            {event.guest_count != null && (
              <>
                <dt style={{ color: '#666' }}>Guests</dt>
                <dd style={{ margin: 0 }}>{event.guest_count}</dd>
              </>
            )}
          </dl>
        </header>

        {event.notes && (
          <section style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 16, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#444', marginBottom: 6 }}>
              Notes
            </h2>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{event.notes}</p>
          </section>
        )}

        {courses.length > 0 && (
          <section style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 16, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#444', marginBottom: 8 }}>
              Schedule
            </h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <tbody>
                {courses.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '6px 0', width: 120, color: '#666' }}>{fmtFireAt(c.fire_at)}</td>
                    <td style={{ padding: '6px 0' }}>
                      <strong>{c.course_label}</strong>
                      {c.notes ? <span style={{ color: '#666' }}> — {c.notes}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {lineItems.length > 0 && (
          <section style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 16, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#444', marginBottom: 8 }}>
              Menu
            </h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1a1a1a', textAlign: 'left' }}>
                  <th style={{ padding: '6px 0', fontWeight: 600 }}>Item</th>
                  <th style={{ padding: '6px 0', fontWeight: 600, width: 80, textAlign: 'right' }}>Qty</th>
                  <th style={{ padding: '6px 0', fontWeight: 600, width: 100, textAlign: 'right' }}>Each</th>
                  <th style={{ padding: '6px 0', fontWeight: 600, width: 100, textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((l) => {
                  const lineTotal = Number(l.unit_cost || 0) * Number(l.quantity || 0);
                  const label = courseLabel.get(l.course_id);
                  return (
                    <tr key={l.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '8px 8px 8px 0' }}>
                        <div>{l.item_name}</div>
                        {label ? (
                          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{label}</div>
                        ) : l.category ? (
                          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{l.category}</div>
                        ) : null}
                      </td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{l.quantity}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{USD(l.unit_cost)}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{USD(lineTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot style={{ fontSize: 14 }}>
                <tr>
                  <td colSpan={3} style={{ padding: '12px 8px 4px 0', textAlign: 'right', color: '#666' }}>
                    Subtotal
                  </td>
                  <td style={{ padding: '12px 8px 4px', textAlign: 'right' }}>{USD(subtotal)}</td>
                </tr>
                {event.service_fee_pct ? (
                  <tr>
                    <td colSpan={3} style={{ padding: '4px 8px 4px 0', textAlign: 'right', color: '#666' }}>
                      Service fee ({Number(event.service_fee_pct)}%)
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{USD(serviceFee)}</td>
                  </tr>
                ) : null}
                {event.tax_rate ? (
                  <tr>
                    <td colSpan={3} style={{ padding: '4px 8px 4px 0', textAlign: 'right', color: '#666' }}>
                      Tax ({(Number(event.tax_rate) * 100).toFixed(2)}%)
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{USD(tax)}</td>
                  </tr>
                ) : null}
                <tr style={{ borderTop: '2px solid #1a1a1a' }}>
                  <td colSpan={3} style={{ padding: '8px 8px 4px 0', textAlign: 'right', fontWeight: 700 }}>
                    Total
                  </td>
                  <td style={{ padding: '8px 8px 4px', textAlign: 'right', fontWeight: 700 }}>{USD(total)}</td>
                </tr>
              </tfoot>
            </table>
          </section>
        )}

        <section style={{ marginTop: 36, borderTop: '1px solid #1a1a1a', paddingTop: 24 }}>
          <h2 style={{ fontSize: 16, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#444', marginBottom: 12 }}>
            Confirm this event
          </h2>
          <p style={{ fontSize: 14, color: '#444', margin: '0 0 16px' }}>
            By signing below, you confirm the details above for your event.
          </p>
          <SignForm token={token} />

          {signatures.length > 0 && (
            <div style={{ marginTop: 24, fontSize: 13, color: '#666' }}>
              <div style={{ marginBottom: 6, fontWeight: 600, color: '#444' }}>Signed</div>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {signatures.map((s) => (
                  <li key={s.id} style={{ marginBottom: 2 }}>
                    {s.signed_name}{' '}
                    <span style={{ color: '#999' }}>
                      — {new Date(s.signed_at).toLocaleString('en-US')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
