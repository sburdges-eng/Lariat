// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import Link from 'next/link';
import { todayISO } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import { buildMorningDigest } from '../../lib/morningDigest';

export const dynamic = 'force-dynamic';

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const value = Number(n);
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function fmtEventTime(t) {
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  const mm = m[2];
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${mm} ${ampm}`;
}

function locQuery(loc) {
  return loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';
}

function Section({ title, sub, href, children }) {
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>{title}</h2>
          <div className="muted">{sub}</div>
        </div>
        {href ? <Link href={href}>Open →</Link> : null}
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </section>
  );
}

export default async function MorningPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const loc = typeof sp.location === 'string' && sp.location.trim() ? sp.location.trim() : DEFAULT_LOCATION_ID;
  const date = typeof sp.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayISO();
  const q = locQuery(loc);
  const digest = buildMorningDigest(loc, date);

  return (
    <div className="page">
      <h1>Morning digest</h1>
      <p className="subtitle">What needs eyes before the day gets moving.</p>

      <Section title="Top heads-up" sub={`${digest.alerts.length} live alerts`} href={`/command${q}`}>
        {digest.alerts.length ? (
          <ul>
            {digest.alerts.slice(0, 5).map((alert) => (
              <li key={`${alert.source}-${alert.severity}`}>{alert.message}</li>
            ))}
          </ul>
        ) : (
          <p>No red flags right now.</p>
        )}
      </Section>

      <Section title="86 board" sub={`${digest.eighty_six.count} open`} href={`/eighty-six${q}`}>
        {digest.eighty_six.items.length ? (
          <ul>
            {digest.eighty_six.items.map((row, idx) => (
              <li key={`${row.item}-${idx}`}>
                <strong>{row.item}</strong>
                {row.reason ? ` — ${row.reason}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p>Nothing 86’d right now.</p>
        )}
      </Section>

      <Section title="Price shocks" sub={`${digest.price_shocks.count} moved 5%+ this week`} href={`/costing/price-shocks${q}`}>
        {digest.price_shocks.items.length ? (
          <ul>
            {digest.price_shocks.items.slice(0, 8).map((row) => (
              <li key={`${row.vendor}-${row.sku}-${row.ingredient}`}>
                <strong>{row.ingredient}</strong> — {fmtPct(row.delta_pct)} ({row.vendor} {row.sku})
              </li>
            ))}
          </ul>
        ) : (
          <p>No big vendor moves this week.</p>
        )}
      </Section>

      <Section title="Certs this week" sub={`${digest.certs_expiring_week.count} due in 7 days`} href={`/labor/certs${q}`}>
        {digest.certs_expiring_week.items.length ? (
          <ul>
            {digest.certs_expiring_week.items.map((row) => (
              <li key={`${row.cook_id}-${row.cert_type}-${row.expires_on}`}>
                <strong>{row.cook_id}</strong> — {row.cert_label} due {row.expires_on}
              </li>
            ))}
          </ul>
        ) : (
          <p>No certs due this week.</p>
        )}
      </Section>

      <Section title="Maintenance due" sub={`${digest.maintenance_due.count} due now`} href={`/equipment${q}`}>
        {digest.maintenance_due.items.length ? (
          <ul>
            {digest.maintenance_due.items.map((row) => (
              <li key={`${row.equipment_name}-${row.task}-${row.next_due}`}>
                <strong>{row.equipment_name}</strong> — {row.task} ({row.next_due})
              </li>
            ))}
          </ul>
        ) : (
          <p>No maintenance due right now.</p>
        )}
      </Section>

      <Section title="BEO prep" sub={`${digest.beo_prep.count} with open prep`} href={`/beo${q}`}>
        {digest.beo_prep.items.length ? (
          <ul>
            {digest.beo_prep.items.map((row) => (
              <li key={row.event_id}>
                <strong>{row.title}</strong>
                {row.event_date ? ` — ${row.event_date}` : ''}
                {row.event_time ? ` ${fmtEventTime(row.event_time)}` : ''}
                {` · ${row.open_tasks} open / ${row.total_tasks} total`}
              </li>
            ))}
          </ul>
        ) : (
          <p>No banquet prep open right now.</p>
        )}
      </Section>

      <Section title="Webhook text" sub="Ready to paste into a Slack webhook" href={`/api/morning${q ? `${q}&date=${date}` : `?date=${date}`}`}>
        <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{digest.webhook.text}</pre>
      </Section>
    </div>
  );
}
