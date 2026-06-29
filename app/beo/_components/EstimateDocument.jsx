// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import '../../../styles/estimate.css';
import { formatDollars } from '../../../lib/formatMoney';

/** Format an ISO date string (YYYY-MM-DD) as a long locale date, e.g. "Thursday, May 1, 2025". */
function formatEventDate(iso) {
  if (!iso) return '';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

/** Format an HH:MM 24-hour time string as 12-hour AM/PM, e.g. "8:00 PM". */
function formatEventTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  const min = String(m).padStart(2, '0');
  return `${hour}:${min} ${suffix}`;
}

/** Format an ISO-8601 UTC datetime (fire_at) as a 12-hour time, e.g. "8:00 PM". */
function formatFireAt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * EstimateDocument — pure presentational component.
 *
 * Props:
 *   event      — { id, title, contact_name, event_date, event_time, guest_count, tax_rate, service_fee_pct }
 *   sections   — groupLineItemsBySection() output: [{ label, items: [{ id, item_name, unit_cost, quantity }] }]
 *   totals     — computeEstimateTotals() output: { subtotal, serviceFee, tax, total }
 *   courses    — beo_courses rows: [{ id, course_label, fire_at, notes }]
 *   signatures — beo_signatures rows: [{ id, signed_name, signed_at }]
 *   register   — 'client' | 'operator'  (root class; CSS hides data-print="false" on client via .estimate-doc.client rule)
 *   signSlot   — optional ReactNode injected into the signature area
 */
export default function EstimateDocument({
  event = {},
  sections = [],
  totals = {},
  courses = [],
  signatures = [],
  register = 'client',
  signSlot,
}) {
  const { title, contact_name, event_date, event_time, guest_count, tax_rate, service_fee_pct } = event;
  const { subtotal, serviceFee, tax, total } = totals;

  return (
    <article className={`estimate-doc ${register}`}>

      {/* ---- MASTHEAD ---- */}
      <header className="ed-masthead">
        <div className="ed-wordmark" aria-label="The Lariat, established 1885">
          <svg viewBox="0 0 260 116" role="img" aria-label="The Lariat 1885">
            <path
              d="M40 64 C 10 60, 8 30, 46 24 C 96 16, 168 16, 214 26 C 250 34, 256 64, 226 80
                 C 188 98, 96 100, 56 90 C 30 84, 26 70, 44 64"
              fill="none" stroke="#1A1814" strokeWidth="3" strokeLinecap="round" opacity="0.95"
            />
            <path
              d="M52 60 C 40 52, 60 40, 92 38 C 140 34, 196 38, 222 52"
              fill="none" stroke="#1A1814" strokeWidth="1.6" opacity="0.45"
            />
            <path
              d="M44 64 C 30 72, 18 88, 26 100"
              fill="none" stroke="#1A1814" strokeWidth="3" strokeLinecap="round"
            />
            <circle cx="26" cy="101" r="4" fill="#1A1814" />
            <g transform="rotate(-4 128 22)">
              <rect x="86" y="10" width="84" height="22" rx="4" fill="#1A1814" />
              <text
                x="128" y="26" textAnchor="middle" fill="#F4F0E8"
                fontFamily="var(--display, Georgia, serif)" fontSize="15" fontWeight="700" letterSpacing="5"
              >THE</text>
            </g>
            <text
              x="132" y="74" textAnchor="middle" fill="#1A1814"
              fontFamily="var(--display, Georgia, serif)" fontSize="46" fontWeight="800"
              fontStyle="italic" letterSpacing="1"
            >Lariat</text>
            <text
              x="206" y="92" fill="#1A1814"
              fontFamily="var(--mono, monospace)" fontSize="11" fontWeight="600" letterSpacing="3"
            >1885</text>
          </svg>
        </div>

        <div className="ed-mh-right">
          <div className="ed-mh-title">Catering Estimate</div>
          <div className="ed-mh-sub">The Lariat · Private Events &amp; Catering</div>
          <div className="ed-mh-meta">
            <div>{title}</div>
            {guest_count != null && (
              <div>Guaranteed count: {guest_count}</div>
            )}
          </div>
        </div>
      </header>

      <hr className="ed-rule" />

      {/* ---- INTAKE ---- */}
      <section className="ed-intake">
        <div>
          <h3>Prepared For</h3>
          {contact_name && (
            <div className="ed-field">
              <span className="ed-lbl">Host</span>
              <span className="ed-val">{contact_name}</span>
            </div>
          )}
        </div>
        <div>
          <h3>Event Details</h3>
          {event_date && (
            <div className="ed-field">
              <span className="ed-lbl">Date</span>
              <span className="ed-val">{formatEventDate(event_date)}</span>
            </div>
          )}
          {event_time && (
            <div className="ed-field">
              <span className="ed-lbl">Time</span>
              <span className="ed-val">{formatEventTime(event_time)}</span>
            </div>
          )}
          {guest_count != null && (
            <div className="ed-field">
              <span className="ed-lbl">Guaranteed count</span>
              <span className="ed-val">{guest_count}</span>
            </div>
          )}
          {service_fee_pct != null && (
            <div className="ed-field" data-print="false">
              <span className="ed-lbl">Service charge</span>
              <span className="ed-val">{service_fee_pct}%</span>
            </div>
          )}
          {tax_rate != null && (
            <div className="ed-field" data-print="false">
              <span className="ed-lbl">Tax rate</span>
              <span className="ed-val">{(tax_rate * 100).toFixed(2)}%</span>
            </div>
          )}
        </div>
      </section>

      {/* ---- LEDGER ---- */}
      <section aria-label="Costing ledger" style={{ paddingTop: 14 }}>
        <div className="ed-band-head">
          <span>Description</span>
          <span className="c-qty">Qty</span>
          <span className="c-ext">Extended</span>
        </div>

        {sections.map((section) => (
          <div key={section.label}>
            <div className="ed-section-band">{section.label}</div>
            <div className="ed-rows">
              {(section.items || []).map((item) => {
                const lineTotal = Number(item.unit_cost || 0) * Number(item.quantity || 0);
                return (
                  <div key={item.id} className="ed-row">
                    <div>
                      <div className="ed-r-name">{item.item_name}</div>
                    </div>
                    <div className="ed-r-qty ed-num">{item.quantity}</div>
                    <div className="ed-r-ext ed-num">
                      {formatDollars(lineTotal)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {/* ---- TOTALS ---- */}
      <section className="ed-totals-zone" aria-label="Estimate totals">
        <div className="ed-totals">
          <div className="ed-trow ed-sub">
            <span className="ed-tlab">Subtotal</span>
            <span className="ed-tval">{formatDollars(subtotal)}</span>
          </div>
          <div className="ed-trow">
            <span className="ed-tlab">
              Service charge
              {service_fee_pct != null && (
                <span data-print="false"> @{service_fee_pct}%</span>
              )}
            </span>
            <span className="ed-tval">{formatDollars(serviceFee)}</span>
          </div>
          <div className="ed-trow">
            <span className="ed-tlab">
              Sales tax
              {tax_rate != null && (
                <span data-print="false"> @{(tax_rate * 100).toFixed(2)}%</span>
              )}
            </span>
            <span className="ed-tval">{formatDollars(tax)}</span>
          </div>
          <hr className="ed-divider" />
        </div>
      </section>

      {/* ---- GRAND TOTAL BAND ---- */}
      <div className="ed-total-band">
        <span className="ed-total-label">Estimated Total</span>
        <span className="ed-total-fig">{formatDollars(total)}</span>
      </div>

      {/* ---- NOTES ---- */}
      {event.notes && (
        <section className="ed-notes" aria-label="Notes">
          <div className="ed-notes-head">Notes</div>
          <p className="ed-notes-body">{event.notes}</p>
        </section>
      )}

      {/* ---- SCHEDULE ---- */}
      {courses.length > 0 && (
        <section className="ed-schedule" aria-label="Event schedule">
          <div className="ed-schedule-head">Schedule</div>
          <table className="ed-schedule-table">
            <tbody>
              {courses.map((c) => (
                <tr key={c.id} className="ed-schedule-row">
                  <td className="ed-schedule-time">{formatFireAt(c.fire_at)}</td>
                  <td className="ed-schedule-label">
                    <strong>{c.course_label}</strong>
                    {c.notes ? <span className="ed-schedule-notes"> — {c.notes}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ---- FOOTER ---- */}
      <footer className="ed-footer">
        <p className="ed-terms">
          A signed estimate and the <b>$350 booking fee</b> reserve your date. &nbsp;·&nbsp;
          A final <b>guaranteed guest count is due 72 hours</b> before the event; charges are based on the guarantee. &nbsp;·&nbsp;
          Prices <b>valid 30 days</b>; tax and service charge applied as shown. &nbsp;·&nbsp;
          This is an estimate, not a final invoice — final charges reflect confirmed counts and any added items.
        </p>

        {signSlot ? (
          <div className="ed-sign-slot">{signSlot}</div>
        ) : (
          <div className="ed-sig-block">
            <div className="ed-sig">
              Client signature
              <div className="ed-sig-line" />
            </div>
            <div className="ed-sig">
              The Lariat representative
              <div className="ed-sig-line" />
            </div>
          </div>
        )}

        {/* ---- SIGNED-BY LIST ---- */}
        {signatures.length > 0 && (
          <div className="ed-signed-by" aria-label="Signatures">
            <div className="ed-signed-by-head">Signed</div>
            <ul className="ed-signed-by-list">
              {signatures.map((s) => (
                <li key={s.id} className="ed-signed-by-item">
                  <strong className="ed-signed-name">{s.signed_name}</strong>
                  {s.signed_at && (
                    <span className="ed-signed-at">
                      {' '}— {new Date(s.signed_at).toLocaleString('en-US')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="ed-thank-you">Thank you for considering The Lariat for your event.</p>
      </footer>

    </article>
  );
}
