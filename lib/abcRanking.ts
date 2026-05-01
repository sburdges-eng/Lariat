// Pure-fn ABC contribution ranking — no I/O.
//
// Inputs are caller-supplied rows shaped like a slimmed
// MenuEngineeringRow. The caller decides the time window (a day, a
// week, a month). This module computes contribution-weighted Pareto
// tiers: Tier A swallows roughly the top 80% of margin, B the next
// 15%, C the tail. Unlinked rows (no costing) come back as
// 'unranked' so the dashboard can still surface them.

export interface AbcInputRow {
  itemName: string;
  qty: number;
  costPerUnit: number | null;
  marginPct: number | null;
  netSales: number;
}

export type AbcTier = 'A' | 'B' | 'C' | 'unranked';

export interface AbcRankedRow extends AbcInputRow {
  contributionDollars: number;
  menuMixPct: number;
  scoreCents: number;
  cumulativePct: number;
  tier: AbcTier;
}

export interface AbcThresholds {
  aPct?: number;   // default 0.80
  bPct?: number;   // default 0.95
}

export function rankByContribution(
  rows: AbcInputRow[],
  thresholds?: AbcThresholds,
): AbcRankedRow[] {
  const aPct = thresholds?.aPct ?? 0.8;
  const bPct = thresholds?.bPct ?? 0.95;

  if (rows.length === 0) return [];

  const totalQty = rows.reduce((s, r) => s + (r.qty || 0), 0);
  const enriched = rows.map((r) => {
    const linked = r.costPerUnit !== null && r.marginPct !== null;
    const avgPrice = r.qty > 0 ? r.netSales / r.qty : 0;
    const contributionDollars = linked
      ? Math.max(0, (avgPrice - (r.costPerUnit ?? 0)) * r.qty)
      : 0;
    const menuMixPct = totalQty > 0 ? r.qty / totalQty : 0;
    const scoreCents = linked
      ? Math.round(contributionDollars * menuMixPct * 100)
      : 0;
    return { ...r, contributionDollars, menuMixPct, scoreCents, linked };
  });

  const linkedRows = enriched.filter((x) => x.linked && x.scoreCents > 0);
  const totalScore = linkedRows.reduce((s, x) => s + x.scoreCents, 0);

  linkedRows.sort((a, b) => b.scoreCents - a.scoreCents);
  let running = 0;
  const ranked: AbcRankedRow[] = [];
  for (const r of linkedRows) {
    // Tier the row based on cumulative *before* including it. The
    // single biggest contributor always lands in A even when it's
    // 100% of the menu's margin.
    const cumulativeBeforePct =
      totalScore > 0 ? (running / totalScore) * 100 : 0;
    running += r.scoreCents;
    const cumulativePct =
      totalScore > 0 ? Math.min(100, (running / totalScore) * 100) : 100;
    let tier: AbcTier;
    if (cumulativeBeforePct < aPct * 100) tier = 'A';
    else if (cumulativeBeforePct < bPct * 100) tier = 'B';
    else tier = 'C';
    ranked.push({
      itemName: r.itemName,
      qty: r.qty,
      costPerUnit: r.costPerUnit,
      marginPct: r.marginPct,
      netSales: r.netSales,
      contributionDollars: r.contributionDollars,
      menuMixPct: r.menuMixPct,
      scoreCents: r.scoreCents,
      cumulativePct,
      tier,
    });
  }

  for (const r of enriched) {
    if (!r.linked || r.scoreCents === 0) {
      ranked.push({
        itemName: r.itemName,
        qty: r.qty,
        costPerUnit: r.costPerUnit,
        marginPct: r.marginPct,
        netSales: r.netSales,
        contributionDollars: 0,
        menuMixPct: r.menuMixPct,
        scoreCents: 0,
        cumulativePct: 0,
        tier: 'unranked',
      });
    }
  }

  return ranked;
}
