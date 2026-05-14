// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getSettlement } from '../../../../lib/settlementRepo.ts';
import TabStrip from '../_components/TabStrip';
import DealEditor from './_components/DealEditor';

export const dynamic = 'force-dynamic';

const DEFAULT_LOCATION_ID = 'default';

const SOURCE_LABELS = {
  dice: 'DICE',
  walkup: 'Walk-up',
  comp: 'Comp',
  will_call: 'Will call',
  guestlist: 'Guest list',
};

function dollars(cents) {
  const n = Number(cents) || 0;
  const sign = n < 0 ? '-' : '';
  return `${sign}$${(Math.abs(n) / 100).toFixed(2)}`;
}

function locationFromSearch(searchParams) {
  const raw = searchParams?.location;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_LOCATION_ID;
}

export default function SettlementPage({ params, searchParams }) {
  const showId = Number(params?.id);
  const locationId = locationFromSearch(searchParams);

  let summary;
  try {
    summary = getSettlement(showId, locationId);
  } catch {
    return (
      <>
        <TabStrip showId={showId} locationId={locationId} active="settlement" />
        <section className="card" style={{ padding: 18 }}>
          <h2 style={{ marginTop: 0 }}>Settlement</h2>
          <p className="row-meta">Show not found.</p>
        </section>
      </>
    );
  }

  const sourceRows = Object.entries(summary.ticketing.bySource).filter(
    ([, value]) => value.qty > 0,
  );

  const pdfHref = `/api/shows/${showId}/settlement/pdf${
    locationId && locationId !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(locationId)}` : ''
  }`;

  return (
    <>
      <TabStrip showId={showId} locationId={locationId} active="settlement" />

      <section style={{ display: 'grid', gap: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <a
            href={pdfHref}
            target="_blank"
            rel="noopener noreferrer"
            className="button button-secondary"
            style={{
              display: 'inline-block',
              padding: '8px 14px',
              borderRadius: 6,
              border: '1px solid var(--line, #cfc6b0)',
              background: 'var(--panel-2, #f7f2e8)',
              color: 'var(--ink, #1c160e)',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Download PDF
          </a>
        </div>
        <div className="grid-2">
          <section className="card" style={{ padding: 16 }}>
            <div className="row-meta" style={{ marginBottom: 8 }}>
              Tickets
            </div>
            <dl style={{ display: 'grid', gap: 8, margin: 0 }}>
              <MoneyRow label="Gross" value={summary.ticketing.grossCents} />
              <MoneyRow label="Fees" value={summary.ticketing.feesCents} />
              <MoneyRow label="Net" value={summary.ticketing.netCents} strong />
            </dl>
            <div className="row-meta" style={{ marginTop: 12 }}>
              {sourceRows.length === 0
                ? 'No ticket lines yet.'
                : sourceRows.map(([source, value]) => (
                    <span key={source} style={{ marginRight: 14 }}>
                      {SOURCE_LABELS[source] ?? source}: {value.qty} ·{' '}
                      {dollars(value.grossCents)}
                    </span>
                  ))}
            </div>
          </section>

          <section className="card" style={{ padding: 16 }}>
            <div className="row-meta" style={{ marginBottom: 8 }}>
              Toast
            </div>
            <dl style={{ display: 'grid', gap: 8, margin: 0 }}>
              <MoneyRow label="Net sales" value={summary.toast.totalCents} />
              <NumberRow label="Orders" value={summary.toast.ordersCount} />
              <NumberRow label="Guests" value={summary.toast.guestsCount} />
            </dl>
            {summary.toast.rowsFound === 0 ? (
              <p className="row-meta" style={{ color: 'var(--amber, #8a5a00)', marginTop: 12 }}>
                No Toast rows for {summary.toast.attributionDate} yet.
              </p>
            ) : null}
          </section>
        </div>

        <div className="grid-2">
          <section className="card" style={{ padding: 16 }}>
            <div className="row-meta" style={{ marginBottom: 8 }}>
              Talent payout
            </div>
            <dl style={{ display: 'grid', gap: 8, margin: 0 }}>
              <MoneyRow label="Guarantee" value={summary.talent.guaranteeCents} />
              <MoneyRow label="vs bonus" value={summary.talent.vsBonusCents} />
              <MoneyRow label="Buyout" value={summary.talent.buyoutCents} />
              <MoneyRow label="Total" value={summary.talent.totalCents} strong />
            </dl>
            <DealEditor
              showId={summary.show.id}
              locationId={summary.show.locationId}
              initialDeal={summary.deal}
            />
          </section>

          <section
            className="card"
            style={{
              padding: 16,
              display: 'grid',
              alignContent: 'start',
              gap: 10,
              background: 'var(--panel-2, #f7f2e8)',
            }}
          >
            <div className="row-meta">Net to door</div>
            <div className="serif" style={{ fontSize: 42, lineHeight: 1 }}>
              {dollars(summary.netDoorCents)}
            </div>
            <div className="row-meta">
              tickets net - costs off top - talent payout
            </div>
            <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
              <MoneyRow label="Costs off top" value={summary.costsOffTopCents} />
              <MoneyRow label="Computed" value={summary.netDoorCents} strong />
            </div>
          </section>
        </div>
      </section>
    </>
  );
}

function MoneyRow({ label, value, strong = false }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        fontWeight: strong ? 700 : 500,
      }}
    >
      <dt>{label}</dt>
      <dd style={{ margin: 0 }}>{dollars(value)}</dd>
    </div>
  );
}

function NumberRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <dt>{label}</dt>
      <dd style={{ margin: 0 }}>{Number(value) || 0}</dd>
    </div>
  );
}
