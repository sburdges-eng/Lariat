// @ts-check
// /analytics/operators — operator-analytics dashboard (roadmap 3.5).
// PIN-gated by middleware via the /analytics prefix. Server component:
// reads ?window= (7/30/90, fallback 30) and ?location=, renders plain
// tables with inline bar indicators per the morning-digest style.

import Link from 'next/link';
import { todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import {
  buildOperatorAnalytics,
  isAllowedWindow,
  DEFAULT_OPERATOR_ANALYTICS_WINDOW,
  OPERATOR_ANALYTICS_WINDOWS,
} from '../../../lib/operatorAnalytics';

export const dynamic = 'force-dynamic';

/**
 * @param {{ title: string, sub: string, children: import('react').ReactNode }} props
 */
function Section({ title, sub, children }) {
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div>
        <h2 style={{ marginBottom: 4 }}>{title}</h2>
        <div className="muted">{sub}</div>
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </section>
  );
}

/**
 * Plain inline bar — width proportional to value/max. No chart library.
 * @param {{ value: number, max: number }} props
 */
function Bar({ value, max }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        height: 10,
        width: `${pct}%`,
        minWidth: pct > 0 ? 2 : 0,
        maxWidth: 160,
        background: 'currentColor',
        opacity: 0.45,
        borderRadius: 2,
        verticalAlign: 'middle',
      }}
    />
  );
}

/** @type {import('react').CSSProperties} */
const cellPad = { padding: '4px 12px 4px 0', textAlign: 'left' };
/** @type {import('react').CSSProperties} */
const barCell = { ...cellPad, width: 180 };

/**
 * @template T
 * @param {{
 *   headers: string[],
 *   rows: T[],
 *   value: (row: T) => number,
 *   cells: (row: T) => (string | number)[],
 *   rowKey: (row: T, idx: number) => string,
 *   empty: string,
 * }} props
 */
function BarTable({ headers, rows, value, cells, rowKey, empty }) {
  if (!rows.length) return <p>{empty}</p>;
  const max = rows.reduce((m, r) => Math.max(m, value(r)), 0);
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h} className="muted" style={cellPad}>{h}</th>
          ))}
          <th style={barCell} />
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={rowKey(row, idx)}>
            {cells(row).map((c, i) => (
              <td key={i} style={cellPad}>{c}</td>
            ))}
            <td style={barCell}>
              <Bar value={value(row)} max={max} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** @param {{ searchParams: Promise<Record<string, string | string[] | undefined>> }} props */
export default async function OperatorAnalyticsPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim() ? sp.location.trim() : DEFAULT_LOCATION_ID;
  const windowRaw = typeof sp.window === 'string' ? Number(sp.window) : NaN;
  const windowDays =
    Number.isInteger(windowRaw) && isAllowedWindow(windowRaw)
      ? windowRaw
      : DEFAULT_OPERATOR_ANALYTICS_WINDOW;
  const today = todayISO();
  const analytics = buildOperatorAnalytics(loc, today, windowDays);

  const locQuery = loc !== DEFAULT_LOCATION_ID ? `&location=${encodeURIComponent(loc)}` : '';

  return (
    <div className="page">
      <h1>Operator analytics</h1>
      <p className="subtitle">
        Patterns from the operational record — {analytics.window_start} to {analytics.window_end}.
      </p>

      <p>
        Window:{' '}
        {OPERATOR_ANALYTICS_WINDOWS.map((w, i) => (
          <span key={w}>
            {i > 0 ? ' · ' : ''}
            {w === windowDays ? (
              <strong>{w}d</strong>
            ) : (
              <Link href={`/analytics/operators?window=${w}${locQuery}`}>{w}d</Link>
            )}
          </span>
        ))}
      </p>

      <Section
        title="Corrective actions by operator"
        sub={`${analytics.corrective_by_operator.count} operators logged corrective actions`}
      >
        <BarTable
          headers={['Cook', 'Total', 'Temp log', 'Line check']}
          rows={analytics.corrective_by_operator.items}
          value={(r) => r.total}
          cells={(r) => [r.cook_id, r.total, r.temp_log, r.line_check]}
          rowKey={(r) => r.cook_id}
          empty="No corrective actions logged in this window."
        />
      </Section>

      <Section
        title="Corrective actions by CCP / subject"
        sub={`${analytics.corrective_by_subject.count} subjects with corrective actions`}
      >
        <BarTable
          headers={['Subject', 'Source', 'Total']}
          rows={analytics.corrective_by_subject.items}
          value={(r) => r.total}
          cells={(r) => [r.subject, r.source, r.total]}
          rowKey={(r) => `${r.source}-${r.subject}`}
          empty="No corrective actions logged in this window."
        />
      </Section>

      <Section
        title="Equipment failures"
        sub={`${analytics.equipment_failures.count} units with repair or damage entries`}
      >
        <BarTable
          headers={['Equipment', 'Failures', 'All services', 'Last service']}
          rows={analytics.equipment_failures.items}
          value={(r) => r.failures}
          cells={(r) => [r.equipment_name, r.failures, r.services, r.last_service_date ?? '—']}
          rowKey={(r) => String(r.equipment_id)}
          empty="No repair or damage entries in this window."
        />
      </Section>

      <Section
        title="Gold star leaders"
        sub={`${analytics.gold_star_leaders.count} cooks recognized`}
      >
        <BarTable
          headers={['Cook', 'Stars', 'Awards', 'Last awarded']}
          rows={analytics.gold_star_leaders.items}
          value={(r) => r.stars}
          cells={(r) => [r.cook_name, r.stars, r.awards, r.last_awarded ?? '—']}
          rowKey={(r) => r.cook_name}
          empty="No gold stars awarded in this window."
        />
      </Section>

      <Section
        title="Audit activity by actor"
        sub={`${analytics.audit_actors.count} actors wrote to regulated surfaces`}
      >
        <BarTable
          headers={['Actor', 'Events']}
          rows={analytics.audit_actors.items}
          value={(r) => r.events}
          cells={(r) => [r.actor, r.events]}
          rowKey={(r) => r.actor}
          empty="No audit events in this window."
        />
      </Section>

      <Section
        title="Audit volume trend"
        sub={`${analytics.audit_trend.count} active days in window`}
      >
        <BarTable
          headers={['Shift date', 'Events']}
          rows={analytics.audit_trend.items}
          value={(r) => r.events}
          cells={(r) => [r.shift_date, r.events]}
          rowKey={(r) => r.shift_date}
          empty="No audit events in this window."
        />
      </Section>

      <Section
        title="Management actions"
        sub={`${analytics.management_actions.count} action types in the JSONL audit feed`}
      >
        <BarTable
          headers={['Action', 'Events']}
          rows={analytics.management_actions.items}
          value={(r) => r.events}
          cells={(r) => [r.action, r.events]}
          rowKey={(r) => r.action}
          empty="No management actions recorded in this window."
        />
      </Section>
    </div>
  );
}
