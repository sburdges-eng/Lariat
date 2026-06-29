// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb } from '../../../../lib/db';
import { isValidShareTokenShape } from '../../../../lib/beoShare';
import { formatDollars } from '../../../../lib/formatMoney';
import SignForm from './SignForm';

export const dynamic = 'force-dynamic';

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

// Reusable inline-style fragments so the JSX below stays terse. This page is
// wrapped in `.paper` (see render), so it references ROLE tokens that flip to
// the warm bone palette there: --accent (amber-brown #a85a16), --text /
// --text-muted (ink on paper). Legacy aliases (--ink/--char/--ember-deep) are
// avoided here because they do NOT flip inside .paper (T1 token system).
const EYEBROW_STYLE = {
  fontFamily: 'var(--mono, "JetBrains Mono", ui-monospace, monospace)',
  fontSize: 10,
  letterSpacing: '0.28em',
  textTransform: 'uppercase',
  color: 'var(--accent, #a85a16)',
  fontWeight: 700,
};
const SECTION_HEAD_STYLE = {
  fontFamily: 'var(--mono, "JetBrains Mono", ui-monospace, monospace)',
  fontSize: 10,
  letterSpacing: '0.24em',
  textTransform: 'uppercase',
  color: 'var(--text-muted, #6f6555)',
  fontWeight: 700,
  marginBottom: 8,
};

function notFound() {
  return (
    <div
      className="paper"
      style={{
        minHeight: '100vh',
        padding: 40,
        fontFamily: 'var(--sans, "Inter Tight", system-ui, sans-serif)',
        textAlign: 'center',
        color: 'var(--text, #17140f)',
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--display)',
          fontWeight: 400,
          fontSize: 36,
          letterSpacing: '-0.01em',
        }}
      >
        This invitation isn’t available
      </h1>
      <p style={{ color: 'var(--text-muted, #6f6555)', maxWidth: 480, margin: '0 auto', lineHeight: 1.5 }}>
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
          /* Paint the viewport behind the .paper sheet so there's no dark gap
             on overscroll / short content. The sheet itself is .paper below. */
          body { background: #f1ead9 !important; }
          @media print { body { background: white !important; } }
        `,
      }} />

      {/* Full-bleed .paper surface: flips the role tokens to the warm bone
          palette (styles/tokens.css), so this whole guest-facing page reads as a
          bright signed document on the dark app. */}
      <div
        className="paper"
        style={{
          minHeight: '100vh',
          fontFamily: 'var(--display)',
          color: 'var(--text)',
          lineHeight: 1.5,
        }}
      >
        <div
          style={{
            maxWidth: 760,
            margin: '0 auto',
            padding: '48px 36px 80px',
          }}
        >
        <header
          style={{
            borderBottom: '1px solid var(--text, #17140f)',
            paddingBottom: 22,
            marginBottom: 28,
          }}
        >
          <div style={EYEBROW_STYLE}>Banquet Event Order</div>
          <h1
            style={{
              margin: '10px 0 18px',
              fontSize: 48,
              lineHeight: 1.02,
              letterSpacing: '-0.02em',
              fontWeight: 400,
              color: 'var(--text, #17140f)',
            }}
          >
            {event.title}
          </h1>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: '120px 1fr',
              gap: '6px 16px',
              margin: 0,
              fontSize: 14,
              fontFamily: 'var(--sans, "Inter Tight", system-ui, sans-serif)',
            }}
          >
            {event.event_date && (
              <>
                <dt style={{ color: 'var(--text-muted, #6f6555)' }}>Date</dt>
                <dd style={{ margin: 0 }}>{fmtDate(event.event_date)}</dd>
              </>
            )}
            {event.event_time && (
              <>
                <dt style={{ color: 'var(--text-muted, #6f6555)' }}>Time</dt>
                <dd style={{ margin: 0 }}>{fmtTime(event.event_time)}</dd>
              </>
            )}
            {event.contact_name && (
              <>
                <dt style={{ color: 'var(--text-muted, #6f6555)' }}>Host</dt>
                <dd style={{ margin: 0 }}>{event.contact_name}</dd>
              </>
            )}
            {event.guest_count != null && (
              <>
                <dt style={{ color: 'var(--text-muted, #6f6555)' }}>Guests</dt>
                <dd style={{ margin: 0 }}>{event.guest_count}</dd>
              </>
            )}
          </dl>
        </header>

        {event.notes && (
          <section style={{ marginBottom: 32 }}>
            <h2 style={SECTION_HEAD_STYLE}>Notes</h2>
            <p
              style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                fontFamily: 'var(--sans, "Inter Tight", system-ui, sans-serif)',
                fontSize: 14,
              }}
            >
              {event.notes}
            </p>
          </section>
        )}

        {courses.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            <h2 style={SECTION_HEAD_STYLE}>Schedule</h2>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 14,
                fontFamily: 'var(--sans, "Inter Tight", system-ui, sans-serif)',
              }}
            >
              <tbody>
                {courses.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--hair, #c9bda5)' }}>
                    <td
                      style={{
                        padding: '8px 0',
                        width: 120,
                        color: 'var(--text-muted, #6f6555)',
                        fontFamily: 'var(--mono, "JetBrains Mono", ui-monospace, monospace)',
                        fontSize: 12,
                      }}
                    >
                      {fmtFireAt(c.fire_at)}
                    </td>
                    <td style={{ padding: '8px 0' }}>
                      <strong style={{ fontWeight: 600 }}>{c.course_label}</strong>
                      {c.notes ? (
                        <span style={{ color: 'var(--text-muted, #6f6555)' }}> — {c.notes}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {lineItems.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            <h2 style={SECTION_HEAD_STYLE}>Menu</h2>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 14,
                fontFamily: 'var(--sans, "Inter Tight", system-ui, sans-serif)',
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: '1px solid var(--text, #17140f)',
                    textAlign: 'left',
                  }}
                >
                  <th style={{ padding: '8px 0', fontWeight: 600 }}>Item</th>
                  <th style={{ padding: '8px 0', fontWeight: 600, width: 80, textAlign: 'right' }}>Qty</th>
                  <th style={{ padding: '8px 0', fontWeight: 600, width: 100, textAlign: 'right' }}>Each</th>
                  <th style={{ padding: '8px 0', fontWeight: 600, width: 100, textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((l) => {
                  const lineTotal = Number(l.unit_cost || 0) * Number(l.quantity || 0);
                  const label = courseLabel.get(l.course_id);
                  return (
                    <tr key={l.id} style={{ borderBottom: '1px solid var(--hair, #c9bda5)' }}>
                      <td style={{ padding: '10px 8px 10px 0' }}>
                        <div>{l.item_name}</div>
                        {label ? (
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--muted-2, #9c9282)',
                              marginTop: 3,
                              fontFamily: 'var(--mono, "JetBrains Mono", ui-monospace, monospace)',
                              letterSpacing: '0.06em',
                            }}
                          >
                            {label}
                          </div>
                        ) : l.category ? (
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--muted-2, #9c9282)',
                              marginTop: 3,
                              fontFamily: 'var(--mono, "JetBrains Mono", ui-monospace, monospace)',
                              letterSpacing: '0.06em',
                            }}
                          >
                            {l.category}
                          </div>
                        ) : null}
                      </td>
                      <td
                        style={{
                          padding: 10,
                          textAlign: 'right',
                          fontFamily: 'var(--mono, "JetBrains Mono", ui-monospace, monospace)',
                          fontFeatureSettings: '"tnum"',
                        }}
                      >
                        {l.quantity}
                      </td>
                      <td
                        style={{
                          padding: 10,
                          textAlign: 'right',
                          fontFamily: 'var(--mono, "JetBrains Mono", ui-monospace, monospace)',
                          fontFeatureSettings: '"tnum"',
                        }}
                      >
                        {formatDollars(l.unit_cost ?? 0, { nullDisplay: '$0.00' })}
                      </td>
                      <td
                        style={{
                          padding: 10,
                          textAlign: 'right',
                          fontFamily: 'var(--mono, "JetBrains Mono", ui-monospace, monospace)',
                          fontFeatureSettings: '"tnum"',
                        }}
                      >
                        {formatDollars(lineTotal ?? 0, { nullDisplay: '$0.00' })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot
                style={{
                  fontSize: 14,
                  fontFamily: 'var(--sans, "Inter Tight", system-ui, sans-serif)',
                }}
              >
                <tr>
                  <td
                    colSpan={3}
                    style={{
                      padding: '14px 8px 4px 0',
                      textAlign: 'right',
                      color: 'var(--text-muted, #6f6555)',
                    }}
                  >
                    Subtotal
                  </td>
                  <td
                    style={{
                      padding: '14px 8px 4px',
                      textAlign: 'right',
                      fontFamily: 'var(--mono, "JetBrains Mono", ui-monospace, monospace)',
                      fontFeatureSettings: '"tnum"',
                    }}
                  >
                    {formatDollars(subtotal ?? 0, { nullDisplay: '$0.00' })}
                  </td>
                </tr>
                {event.service_fee_pct ? (
                  <tr>
                    <td
                      colSpan={3}
                      style={{
                        padding: '4px 8px 4px 0',
                        textAlign: 'right',
                        color: 'var(--text-muted, #6f6555)',
                      }}
                    >
                      Service fee ({Number(event.service_fee_pct)}%)
                    </td>
                    <td
                      style={{
                        padding: '4px 8px',
                        textAlign: 'right',
                        fontFamily: 'var(--mono, "JetBrains Mono", ui-monospace, monospace)',
                        fontFeatureSettings: '"tnum"',
                      }}
                    >
                      {formatDollars(serviceFee ?? 0, { nullDisplay: '$0.00' })}
                    </td>
                  </tr>
                ) : null}
                {event.tax_rate ? (
                  <tr>
                    <td
                      colSpan={3}
                      style={{
                        padding: '4px 8px 4px 0',
                        textAlign: 'right',
                        color: 'var(--text-muted, #6f6555)',
                      }}
                    >
                      Tax ({(Number(event.tax_rate) * 100).toFixed(2)}%)
                    </td>
                    <td
                      style={{
                        padding: '4px 8px',
                        textAlign: 'right',
                        fontFamily: 'var(--mono, "JetBrains Mono", ui-monospace, monospace)',
                        fontFeatureSettings: '"tnum"',
                      }}
                    >
                      {formatDollars(tax ?? 0, { nullDisplay: '$0.00' })}
                    </td>
                  </tr>
                ) : null}
                <tr style={{ borderTop: '1px solid var(--text, #17140f)' }}>
                  <td
                    colSpan={3}
                    style={{
                      padding: '10px 8px 4px 0',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: 'var(--text, #17140f)',
                    }}
                  >
                    Total
                  </td>
                  <td
                    style={{
                      padding: '10px 8px 4px',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: 'var(--accent, #a85a16)',
                      fontFamily: 'var(--mono, "JetBrains Mono", ui-monospace, monospace)',
                      fontFeatureSettings: '"tnum"',
                    }}
                  >
                    {formatDollars(total ?? 0, { nullDisplay: '$0.00' })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>
        )}

        <section
          style={{
            marginTop: 40,
            borderTop: '1px solid var(--text, #17140f)',
            paddingTop: 28,
          }}
        >
          <h2 style={SECTION_HEAD_STYLE}>Confirm this event</h2>
          <p
            style={{
              fontSize: 14,
              color: 'var(--text-muted, #6f6555)',
              margin: '0 0 18px',
              fontFamily: 'var(--sans, "Inter Tight", system-ui, sans-serif)',
            }}
          >
            By signing below, you confirm the event details above and authorize this banquet event order.
          </p>
          <SignForm token={token} />

          {signatures.length > 0 && (
            <div
              style={{
                marginTop: 28,
                fontSize: 13,
                color: 'var(--text-muted, #6f6555)',
                fontFamily: 'var(--sans, "Inter Tight", system-ui, sans-serif)',
              }}
            >
              <div
                style={{
                  marginBottom: 8,
                  fontFamily: 'var(--mono, "JetBrains Mono", ui-monospace, monospace)',
                  fontSize: 10,
                  letterSpacing: '0.24em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted, #6f6555)',
                  fontWeight: 700,
                }}
              >
                Signed
              </div>
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
                {signatures.map((s) => (
                  <li
                    key={s.id}
                    style={{
                      marginBottom: 4,
                      paddingLeft: 14,
                      borderLeft: '2px solid var(--ok, #3f5648)',
                    }}
                  >
                    <strong style={{ color: 'var(--text, #17140f)', fontWeight: 600 }}>{s.signed_name}</strong>{' '}
                    <span style={{ color: 'var(--muted-2, #9c9282)' }}>
                      — {new Date(s.signed_at).toLocaleString('en-US')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        </div>
      </div>
    </>
  );
}
