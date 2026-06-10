// @ts-check
// /food-safety/haccp-plan — inspector-ready printable HACCP plan.
//
// Server-rendered from lib/haccpPlan.ts (same object the JSON API at
// /api/food-safety/haccp-plan serves). Print path mirrors the settlement
// print view (lib/settlementPrint.ts): a print stylesheet plus the
// browser's "Save as PDF" — no PDF library, no external service. The
// "Print / Save as PDF" button is hidden in print output via .no-print.

import { todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { buildHaccpPlan } from '../../../lib/haccpPlan';

/** @typedef {Record<string, string | string[] | undefined>} PageSearchParams */

export const dynamic = 'force-dynamic';

const PRINT_STYLE = `
  .haccp-plan { max-width: 860px; }
  .haccp-plan table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; }
  .haccp-plan th, .haccp-plan td {
    text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--line, #cfc6b0);
    vertical-align: top; font-size: 13px;
  }
  .haccp-plan th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
  .haccp-plan section { page-break-inside: avoid; margin-bottom: 20px; }
  .haccp-plan .cite { font-size: 12px; opacity: 0.75; }
  .haccp-plan .sig-row { display: flex; gap: 32px; margin-top: 28px; }
  .haccp-plan .sig-line {
    flex: 1; border-top: 1px solid currentColor; padding-top: 4px; font-size: 12px;
  }
  @media print {
    .no-print, nav, aside, header.app-header { display: none !important; }
    body { background: white; }
    .haccp-plan { max-width: none; }
  }
  @page { size: letter; margin: 0.5in; }
`;

const PRINT_BUTTON_SCRIPT = `
  (function () {
    var btn = document.getElementById('haccp-print-btn');
    if (btn) btn.addEventListener('click', function () { window.print(); });
  })();
`;

/** @param {number | null} min @param {number | null} max */
function limitText(min, max) {
  if (min != null && max != null) return `${min}–${max}°F`;
  if (min != null) return `≥ ${min}°F`;
  if (max != null) return `≤ ${max}°F`;
  return '—';
}

/** @param {string | null | undefined} ts */
function fmtTs(ts) {
  if (!ts) return '—';
  return ts.replace('T', ' ').slice(0, 16);
}

/** @param {{ searchParams: Promise<PageSearchParams> }} props */
export default async function HaccpPlanPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const today = todayISO();
  const date =
    typeof sp.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;

  const plan = buildHaccpPlan(loc, date);

  return (
    <div className="page haccp-plan">
      <style>{PRINT_STYLE}</style>

      <div className="no-print" style={{ marginBottom: 16 }}>
        <button id="haccp-print-btn" className="btn primary" type="button">
          Print / Save as PDF
        </button>
      </div>

      <header>
        <h1>HACCP plan</h1>
        <p className="subtitle">
          Location: {plan.location_id} · Plan date: {plan.plan_date} · Evidence window:{' '}
          {plan.window_start} to {plan.plan_date} ({plan.window_days} days) · Generated:{' '}
          {fmtTs(plan.generated_at)}
        </p>
      </header>

      <section>
        <h2>Critical control points</h2>
        <p className="cite">
          Single-reading temperature CCPs monitored via the temp log. Counts are readings
          recorded in the evidence window.
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">CCP</th>
              <th scope="col">Point</th>
              <th scope="col">Critical limit</th>
              <th scope="col">Citation</th>
              <th scope="col">Logs (30d)</th>
              <th scope="col">Corrective (30d)</th>
            </tr>
          </thead>
          <tbody>
            {plan.ccps.map((p) => (
              <tr key={p.point_id}>
                <td>{p.ccp_id}</td>
                <td>{p.label}</td>
                <td>{limitText(p.required_min_f, p.required_max_f)}</td>
                <td className="cite">{p.citation}</td>
                <td>{p.logs_30d}</td>
                <td>{p.corrective_30d}</td>
              </tr>
            ))}
            <tr>
              <td>{plan.cooling.ccp_id}</td>
              <td>Two-stage cooling</td>
              <td>time-based</td>
              <td className="cite">{plan.cooling.citation}</td>
              <td>{plan.cooling.batches_30d} batches</td>
              <td>{plan.cooling.breaches_30d} breaches</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>Food-safety programs</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Program</th>
              <th scope="col">Citation</th>
              <th scope="col">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {plan.rule_modules.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td className="cite">{m.citation}</td>
                <td>
                  {m.records} {m.evidence_label}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Corrective actions — last {plan.window_days} days</h2>
        <p className="cite">{plan.corrective_actions.citation}</p>
        {plan.corrective_actions.count === 0 ? (
          <p>No corrective actions recorded in the window.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Source</th>
                <th scope="col">Subject</th>
                <th scope="col">Action taken</th>
                <th scope="col">Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {plan.corrective_actions.entries.map((e) => (
                <tr key={`${e.source}-${e.entry_id}`}>
                  <td>{e.shift_date}</td>
                  <td>{e.source === 'temp_log' ? 'Temp log' : 'Line check'}</td>
                  <td>{e.subject}</td>
                  <td>{e.note}</td>
                  <td>{e.cook_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Thermometer calibrations — last {plan.window_days} days</h2>
        <p className="cite">
          {plan.calibrations.citation} · Default frequency:{' '}
          {plan.calibrations.frequency_days_default} days
        </p>
        {plan.calibrations.records.length === 0 ? (
          <p>No calibrations recorded in the window.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Calibrated</th>
                <th scope="col">Probe</th>
                <th scope="col">Method</th>
                <th scope="col">Reading</th>
                <th scope="col">Result</th>
                <th scope="col">Action taken</th>
                <th scope="col">By</th>
              </tr>
            </thead>
            <tbody>
              {plan.calibrations.records.map((r) => (
                <tr key={r.id}>
                  <td>{fmtTs(r.calibrated_at)}</td>
                  <td>{r.thermometer_id}</td>
                  <td>{r.method}</td>
                  <td>{r.before_reading_f != null ? `${r.before_reading_f}°F` : '—'}</td>
                  <td>{r.passed ? 'Pass' : 'Fail'}</td>
                  <td>{r.action_taken || '—'}</td>
                  <td>{r.cook_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {plan.calibrations.probes.length > 0 ? (
          <>
            <h3>Probe status as of {plan.plan_date}</h3>
            <table>
              <thead>
                <tr>
                  <th scope="col">Probe</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last calibrated</th>
                  <th scope="col">Next due</th>
                </tr>
              </thead>
              <tbody>
                {plan.calibrations.probes.map((p) => (
                  <tr key={p.thermometer_id}>
                    <td>{p.thermometer_id}</td>
                    <td>{p.status}</td>
                    <td>{fmtTs(p.last_calibrated_at)}</td>
                    <td>{fmtTs(p.next_due_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </section>

      <section>
        <h2>Sign-off</h2>
        <div className="sig-row">
          <div className="sig-line">Person in charge — signature / date</div>
          <div className="sig-line">Reviewed by — signature / date</div>
        </div>
      </section>

      <script dangerouslySetInnerHTML={{ __html: PRINT_BUTTON_SCRIPT }} />
    </div>
  );
}
