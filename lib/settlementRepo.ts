// Per-show settlement repo. Two surfaces:
//
//   getSettlement(showId, locationId) — read-only join across
//     shows + show_deals + box_office_lines + toast_sales_daily,
//     plus pure-fn computeTalentPayout, returning a SettlementSummary.
//
//   upsertDeal(showId, deal, cookId, locationId) — writes show_deals
//     + audit_events in a single tx. Action = 'upsert' on first write,
//     'correction' on every subsequent write per the audit_events
//     correction-trail convention.
//
// Money is INTEGER cents at every boundary inside the repo. Legacy
// REAL columns (box_office_lines.face_price, fees;
// toast_sales_daily.net_sales) are rounded at the read boundary.

import { getDb } from './db.ts';
import { postAuditEvent } from './auditEvents.ts';
import {
  computeTalentPayout,
  emptyDeal,
  parseDeal,
  type DealPoint,
} from './dealPoints.ts';

export function upsertDeal(
  showId: number,
  deal: DealPoint,
  cookId: string,
  locationId: string,
  opts?: { notes?: string | null; actorSource?: string },
): void {
  const db = getDb();
  const notes = opts?.notes ?? null;
  // Default actor_source preserves existing manager_ui audit trail; the
  // Prism backfill importer overrides this to 'prism_backfill' so the
  // audit log distinguishes operator entries from imported history.
  const actorSource = opts?.actorSource ?? 'manager_ui';
  db.transaction(() => {
    const existing = db
      .prepare(
        `SELECT id FROM show_deals WHERE show_id = ? AND location_id = ?`,
      )
      .get(showId, locationId) as { id: number } | undefined;

    db.prepare(
      `INSERT INTO show_deals
         (show_id, location_id, guarantee_cents, vs_pct_after_costs,
          costs_off_top_json, buyout_cents, notes, updated_at, updated_by_cook_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
       ON CONFLICT(show_id, location_id) DO UPDATE SET
         guarantee_cents    = excluded.guarantee_cents,
         vs_pct_after_costs = excluded.vs_pct_after_costs,
         costs_off_top_json = excluded.costs_off_top_json,
         buyout_cents       = excluded.buyout_cents,
         notes              = excluded.notes,
         updated_at         = datetime('now'),
         updated_by_cook_id = excluded.updated_by_cook_id`,
    ).run(
      showId,
      locationId,
      deal.guaranteeCents,
      deal.vsPctAfterCosts,
      JSON.stringify(deal.costsOffTop),
      deal.buyoutCents,
      notes,
      cookId,
    );

    const dealId =
      existing?.id ??
      (db
        .prepare(
          `SELECT id FROM show_deals WHERE show_id = ? AND location_id = ?`,
        )
        .get(showId, locationId) as { id: number }).id;

    postAuditEvent({
      entity: 'show_deal',
      entity_id: dealId,
      action: existing ? 'correction' : 'insert',
      actor_cook_id: cookId,
      actor_source: actorSource,
      payload: notes ? { ...deal, notes } : deal,
      location_id: locationId,
    });
  })();
}

export type TicketSource = 'dice' | 'walkup' | 'comp' | 'will_call' | 'guestlist';

export interface SettlementSummary {
  show: { id: number; bandName: string; date: string; locationId: string };
  deal: DealPoint;
  ticketing: {
    grossCents: number;
    feesCents: number;
    netCents: number;
    bySource: Record<TicketSource, { qty: number; grossCents: number }>;
  };
  toast: {
    totalCents: number;
    ordersCount: number;
    guestsCount: number;
    attributionDate: string;
    rowsFound: number;
  };
  talent: {
    guaranteeCents: number;
    vsBonusCents: number;
    buyoutCents: number;
    totalCents: number;
  };
  costsOffTopCents: number;
  netDoorCents: number;
  computedAt: string;
}

const TICKET_SOURCES: TicketSource[] = [
  'dice',
  'walkup',
  'comp',
  'will_call',
  'guestlist',
];

function emptyBySource(): SettlementSummary['ticketing']['bySource'] {
  return TICKET_SOURCES.reduce(
    (acc, src) => ({ ...acc, [src]: { qty: 0, grossCents: 0 } }),
    {} as SettlementSummary['ticketing']['bySource'],
  );
}

export function getSettlement(
  showId: number,
  locationId: string,
): SettlementSummary {
  const db = getDb();
  const show = db
    .prepare(
      `SELECT id, band_name, show_date FROM shows
       WHERE id = ? AND location_id = ?`,
    )
    .get(showId, locationId) as
    | { id: number; band_name: string; show_date: string }
    | undefined;
  if (!show) throw new Error(`getSettlement: show ${showId} not found`);

  const dealRow = db
    .prepare(
      `SELECT guarantee_cents, vs_pct_after_costs, costs_off_top_json, buyout_cents
       FROM show_deals WHERE show_id = ? AND location_id = ?`,
    )
    .get(showId, locationId) as
    | {
        guarantee_cents: number;
        vs_pct_after_costs: number | null;
        costs_off_top_json: string;
        buyout_cents: number;
      }
    | undefined;
  const deal = dealRow ? parseDeal(dealRow) : emptyDeal();

  const ticketRows = db
    .prepare(
      `SELECT source, qty, face_price, fees
       FROM box_office_lines
       WHERE show_id = ? AND location_id = ?`,
    )
    .all(showId, locationId) as {
    source: TicketSource;
    qty: number;
    face_price: number | null;
    fees: number | null;
  }[];

  const bySource = emptyBySource();
  let grossCents = 0;
  let feesCents = 0;
  for (const r of ticketRows) {
    const lineGross = Math.round((r.face_price ?? 0) * r.qty * 100);
    const lineFees = Math.round((r.fees ?? 0) * r.qty * 100);
    grossCents += lineGross;
    feesCents += lineFees;
    if (TICKET_SOURCES.includes(r.source)) {
      bySource[r.source].qty += r.qty;
      bySource[r.source].grossCents += lineGross;
    }
  }
  const netCents = grossCents - feesCents;

  const toastRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(net_sales), 0) AS net_sales,
         COALESCE(SUM(orders),    0) AS orders,
         COALESCE(SUM(guests),    0) AS guests,
         COUNT(*)                    AS rows_found
       FROM toast_sales_daily
       WHERE shift_date = ? AND location_id = ?`,
    )
    .get(show.show_date, locationId) as {
    net_sales: number;
    orders: number;
    guests: number;
    rows_found: number;
  };

  const payout = computeTalentPayout({
    deal,
    ticketRevenueCents: grossCents,
  });
  const costsOffTopCents = deal.costsOffTop.reduce((s, c) => s + c.cents, 0);
  const netDoorCents = netCents - costsOffTopCents - payout.totalCents;

  return {
    show: {
      id: show.id,
      bandName: show.band_name,
      date: show.show_date,
      locationId,
    },
    deal,
    ticketing: { grossCents, feesCents, netCents, bySource },
    toast: {
      totalCents: Math.round(toastRow.net_sales * 100),
      ordersCount: toastRow.orders,
      guestsCount: toastRow.guests,
      attributionDate: show.show_date,
      rowsFound: toastRow.rows_found,
    },
    talent: payout,
    costsOffTopCents,
    netDoorCents,
    computedAt: new Date().toISOString(),
  };
}
