// Pure-fn deal-point parser + talent payout math.
//
// No I/O. The settlement repo is the one place that converts a
// show_deals row into a DealPoint via parseDeal(), runs settlement
// math via computeTalentPayout(), and serializes back via the
// upsert.
//
// Money is INTEGER cents end-to-end. The repo rounds REAL columns
// (box_office_lines.face_price, fees) at the read boundary. The
// audit payload is the DealPoint DTO, not the raw row.

export interface DealCost {
  label: string;
  cents: number;
}

export interface DealPoint {
  guaranteeCents: number;
  vsPctAfterCosts: number | null;
  costsOffTop: DealCost[];
  buyoutCents: number;
}

export interface ShowDealRow {
  guarantee_cents: number;
  vs_pct_after_costs: number | null;
  costs_off_top_json: string;
  buyout_cents: number;
}

export function emptyDeal(): DealPoint {
  return {
    guaranteeCents: 0,
    vsPctAfterCosts: null,
    costsOffTop: [],
    buyoutCents: 0,
  };
}

export function parseDeal(row: ShowDealRow): DealPoint {
  let costs: DealCost[];
  try {
    const parsed = JSON.parse(row.costs_off_top_json);
    if (!Array.isArray(parsed)) {
      throw new Error('costs_off_top_json must be an array');
    }
    costs = parsed.map((c, i) => {
      if (!c || typeof c.label !== 'string' || typeof c.cents !== 'number') {
        throw new Error(`costs_off_top_json[${i}] missing label/cents`);
      }
      return { label: c.label, cents: Math.round(c.cents) };
    });
  } catch (e) {
    throw new Error(
      `parseDeal: bad costs_off_top_json — ${(e as Error).message}`,
    );
  }
  return {
    guaranteeCents: Math.round(row.guarantee_cents),
    vsPctAfterCosts: row.vs_pct_after_costs,
    costsOffTop: costs,
    buyoutCents: Math.round(row.buyout_cents),
  };
}
