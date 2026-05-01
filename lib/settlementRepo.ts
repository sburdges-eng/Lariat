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
import { type DealPoint } from './dealPoints.ts';

export function upsertDeal(
  showId: number,
  deal: DealPoint,
  cookId: string,
  locationId: string,
): void {
  const db = getDb();
  db.transaction(() => {
    const existing = db
      .prepare(
        `SELECT id FROM show_deals WHERE show_id = ? AND location_id = ?`,
      )
      .get(showId, locationId) as { id: number } | undefined;

    db.prepare(
      `INSERT INTO show_deals
         (show_id, location_id, guarantee_cents, vs_pct_after_costs,
          costs_off_top_json, buyout_cents, updated_at, updated_by_cook_id)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
       ON CONFLICT(show_id, location_id) DO UPDATE SET
         guarantee_cents    = excluded.guarantee_cents,
         vs_pct_after_costs = excluded.vs_pct_after_costs,
         costs_off_top_json = excluded.costs_off_top_json,
         buyout_cents       = excluded.buyout_cents,
         updated_at         = datetime('now'),
         updated_by_cook_id = excluded.updated_by_cook_id`,
    ).run(
      showId,
      locationId,
      deal.guaranteeCents,
      deal.vsPctAfterCosts,
      JSON.stringify(deal.costsOffTop),
      deal.buyoutCents,
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
      actor_source: 'manager_ui',
      payload: deal,
      location_id: locationId,
    });
  })();
}
