// /shows/[id]/settlement
//
// Server component reads the SettlementSummary directly via the repo;
// the DealEditor is a client component that PUTs back to
// /api/shows/[id]/deal.

import { getSettlement } from '../../../../lib/settlementRepo';
import DealEditor from './_components/DealEditor';

function dollars(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

export default async function SettlementPage({ params, searchParams }) {
  const showId = Number(params.id);
  const locationId = searchParams?.location || 'default';
  let summary;
  try {
    summary = getSettlement(showId, locationId);
  } catch (e) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-semibold">Settlement</h1>
        <p className="mt-4 text-red-700">Show not found.</p>
      </main>
    );
  }

  return (
    <main className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{summary.show.bandName}</h1>
        <p className="text-sm text-stone-600">
          {summary.show.date} · location {summary.show.locationId}
        </p>
      </header>

      <section className="border rounded p-4">
        <h2 className="font-medium">Tickets</h2>
        <dl className="grid grid-cols-2 gap-2 mt-2 text-sm">
          <dt>Gross</dt>
          <dd className="text-right">{dollars(summary.ticketing.grossCents)}</dd>
          <dt>Fees</dt>
          <dd className="text-right">{dollars(summary.ticketing.feesCents)}</dd>
          <dt className="font-medium">Net</dt>
          <dd className="text-right font-medium">
            {dollars(summary.ticketing.netCents)}
          </dd>
        </dl>
        <div className="mt-3 text-xs text-stone-500">
          {Object.entries(summary.ticketing.bySource).map(([src, v]) =>
            v.qty > 0 ? (
              <span key={src} className="mr-3">
                {src}: {v.qty} ({dollars(v.grossCents)})
              </span>
            ) : null,
          )}
        </div>
      </section>

      <section className="border rounded p-4">
        <h2 className="font-medium">Toast</h2>
        <dl className="grid grid-cols-2 gap-2 mt-2 text-sm">
          <dt>Net sales</dt>
          <dd className="text-right">{dollars(summary.toast.totalCents)}</dd>
          <dt>Orders</dt>
          <dd className="text-right">{summary.toast.ordersCount}</dd>
          <dt>Guests</dt>
          <dd className="text-right">{summary.toast.guestsCount}</dd>
        </dl>
        {summary.toast.rowsFound === 0 ? (
          <p className="mt-2 text-xs text-amber-700">
            No Toast rows for {summary.toast.attributionDate} yet — re-check
            after the daily ingest.
          </p>
        ) : null}
      </section>

      <section className="border rounded p-4">
        <h2 className="font-medium">Talent payout</h2>
        <dl className="grid grid-cols-2 gap-2 mt-2 text-sm">
          <dt>Guarantee</dt>
          <dd className="text-right">{dollars(summary.talent.guaranteeCents)}</dd>
          <dt>vs bonus</dt>
          <dd className="text-right">{dollars(summary.talent.vsBonusCents)}</dd>
          <dt>Buyout</dt>
          <dd className="text-right">{dollars(summary.talent.buyoutCents)}</dd>
          <dt className="font-medium">Total</dt>
          <dd className="text-right font-medium">
            {dollars(summary.talent.totalCents)}
          </dd>
        </dl>
        <DealEditor showId={summary.show.id} initialDeal={summary.deal} />
      </section>

      <section className="border rounded p-4 bg-stone-50">
        <h2 className="font-medium">Net to door</h2>
        <p className="text-3xl font-semibold mt-2">
          {dollars(summary.netDoorCents)}
        </p>
        <p className="text-xs text-stone-500 mt-1">
          tickets net − costs off top − talent payout
        </p>
      </section>
    </main>
  );
}
