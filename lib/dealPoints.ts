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

// ── External / raw-JSON deal shape (USD, unknown provenance) ──────

export interface DealTermsCostItem {
  label: string;
  amount_usd: number;
}

/**
 * Raw deal shape as it arrives from external sources (Prism CSV, status_json
 * blob, API body). Values are in USD (not cents). Use parseDealTerms() to
 * validate before calling dealTermsToDealPoint() to convert to the internal
 * cents-based DealPoint.
 */
export interface DealTerms {
  guarantee_usd: number;
  vs_pct_after_costs?: number | null;
  costs_off_top?: DealTermsCostItem[];
  buyout_usd?: number;
}

function assertNumeric(val: unknown, field: string): asserts val is number {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new Error(`InvalidDealShape: ${field} must be a finite number`);
  }
}

/**
 * Defensive parser for an unknown JSON blob into a validated DealTerms.
 * Throws Error('InvalidDealShape: ...') on any missing required field or
 * non-numeric / out-of-range value.
 */
export function parseDealTerms(dealJson: unknown): DealTerms {
  if (dealJson === null || typeof dealJson !== 'object' || Array.isArray(dealJson)) {
    throw new Error('InvalidDealShape: deal must be a non-null object');
  }
  const raw = dealJson as Record<string, unknown>;

  if (!('guarantee_usd' in raw)) {
    throw new Error('InvalidDealShape: guarantee_usd is required');
  }
  assertNumeric(raw['guarantee_usd'], 'guarantee_usd');
  if ((raw['guarantee_usd'] as number) < 0) {
    throw new Error('InvalidDealShape: guarantee_usd must be >= 0');
  }

  let vsPct: number | null | undefined;
  if ('vs_pct_after_costs' in raw && raw['vs_pct_after_costs'] !== null) {
    assertNumeric(raw['vs_pct_after_costs'], 'vs_pct_after_costs');
    const pct = raw['vs_pct_after_costs'] as number;
    if (pct < 0 || pct > 1) {
      throw new Error('InvalidDealShape: vs_pct_after_costs must be in [0, 1]');
    }
    vsPct = pct;
  } else {
    vsPct = raw['vs_pct_after_costs'] === null ? null : undefined;
  }

  let costsOffTop: DealTermsCostItem[] | undefined;
  if ('costs_off_top' in raw && raw['costs_off_top'] !== undefined) {
    if (!Array.isArray(raw['costs_off_top'])) {
      throw new Error('InvalidDealShape: costs_off_top must be an array');
    }
    costsOffTop = (raw['costs_off_top'] as unknown[]).map((item, i) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`InvalidDealShape: costs_off_top[${i}] must be an object`);
      }
      const c = item as Record<string, unknown>;
      if (typeof c['label'] !== 'string') {
        throw new Error(`InvalidDealShape: costs_off_top[${i}].label must be a string`);
      }
      assertNumeric(c['amount_usd'], `costs_off_top[${i}].amount_usd`);
      return { label: c['label'] as string, amount_usd: c['amount_usd'] as number };
    });
  }

  let buyoutUsd: number | undefined;
  if ('buyout_usd' in raw && raw['buyout_usd'] !== undefined) {
    assertNumeric(raw['buyout_usd'], 'buyout_usd');
    if ((raw['buyout_usd'] as number) < 0) {
      throw new Error('InvalidDealShape: buyout_usd must be >= 0');
    }
    buyoutUsd = raw['buyout_usd'] as number;
  }

  return {
    guarantee_usd: raw['guarantee_usd'] as number,
    ...(vsPct !== undefined ? { vs_pct_after_costs: vsPct } : {}),
    ...(costsOffTop !== undefined ? { costs_off_top: costsOffTop } : {}),
    ...(buyoutUsd !== undefined ? { buyout_usd: buyoutUsd } : {}),
  };
}

/**
 * Convert a validated DealTerms (USD) to the internal DealPoint (cents).
 * Round at this boundary so downstream math is always integer-cents.
 */
export function dealTermsToDealPoint(terms: DealTerms): DealPoint {
  return {
    guaranteeCents: Math.round(terms.guarantee_usd * 100),
    vsPctAfterCosts: terms.vs_pct_after_costs ?? null,
    costsOffTop: (terms.costs_off_top ?? []).map((c) => ({
      label: c.label,
      cents: Math.round(c.amount_usd * 100),
    })),
    buyoutCents: Math.round((terms.buyout_usd ?? 0) * 100),
  };
}

export interface TalentPayout {
  guaranteeCents: number;
  vsBonusCents: number;
  buyoutCents: number;
  totalCents: number;
}

export function computeTalentPayout(args: {
  deal: DealPoint;
  ticketRevenueCents: number;
}): TalentPayout {
  const { deal, ticketRevenueCents } = args;
  const costsOffTopCents = deal.costsOffTop.reduce(
    (sum, c) => sum + c.cents,
    0,
  );
  const overage = Math.max(
    0,
    ticketRevenueCents - costsOffTopCents - deal.guaranteeCents,
  );
  // Rounding convention — venue-favorable floor.
  //
  // Math.floor is intentional. On any non-clean overage (e.g.
  // 1_000_001 cents × 0.65 = 650_000.65) the talent loses the
  // fractional cent per show — matches the long-running deal-buyer
  // convention. Documented in docs/PHASE2_PLAN.md §B "Settlement
  // math". The two other rounds in this module (parseDeal) use
  // Math.round at INPUT boundaries; only the bonus is venue-favorable.
  // Found via the 2026-05-02 breaker §5 P3 finding.
  const vsBonusCents =
    deal.vsPctAfterCosts === null
      ? 0
      : Math.floor(overage * deal.vsPctAfterCosts);
  const totalCents = deal.guaranteeCents + vsBonusCents + deal.buyoutCents;
  return {
    guaranteeCents: deal.guaranteeCents,
    vsBonusCents,
    buyoutCents: deal.buyoutCents,
    totalCents,
  };
}
