// lib/beoEstimate.ts
export interface EstimateLineItem {
  id: number; item_name: string; category?: string | null;
  unit_cost?: number | null; quantity?: number | null;
  course_id?: number | null; sort_order?: number | null;
}
/** One `beo_event_charges` row, as far as totals math cares (charge only —
 * `cost` is house-internal and must never reach this function; the guest
 * share page's query doesn't even select it). */
export interface EstimateCharge { charge?: number | null; }

export interface EstimateTotals {
  /** Grand subtotal: food + AV/fee charges + bar. Base for tax and service fee. */
  subtotal: number;
  /** Food + bar only. What an F&B (food & beverage) minimum-spend commitment
   * is measured against — AV/production charges are billed separately and
   * don't count toward it (owner call, 2026-07-21). */
  fbSubtotal: number;
  /** Bar's computed contribution: `bar_amount` flat for `fixed` mode, or the
   * gap between food alone and `min_spend` for `fill` mode (never negative,
   * never counts AV/fees toward closing that gap). Zero with no bar_mode. */
  barRevenue: number;
  /** Sum of `beo_event_charges.charge` (AV + fee kinds alike). */
  chargesSubtotal: number;
  serviceFee: number;
  tax: number;
  total: number;
}

export const SECTION_ORDER: string[] = [
  'Passed', 'Passed Hors d’Oeuvres', 'Large Format', 'Buffet', 'Large Format & Buffet',
  'Family Style', 'Passed Desserts', 'Desserts', 'Artisan Snack Boards', 'Boards', 'Bar & Fees',
];

export function computeEstimateTotals(
  event: {
    tax_rate?: number | null; service_fee_pct?: number | null;
    min_spend?: number | null; bar_mode?: string | null; bar_amount?: number | null;
  },
  lineItems: Array<{ unit_cost?: number | null; quantity?: number | null }>,
  charges: EstimateCharge[] = [],
): EstimateTotals {
  const foodSubtotal = lineItems.reduce(
    (acc, l) => acc + Number(l.unit_cost || 0) * Number(l.quantity || 0), 0);
  const chargesSubtotal = charges.reduce((acc, c) => acc + Number(c.charge || 0), 0);

  // Bar revenue: 'fill' tops up the gap between FOOD ALONE and min_spend
  // (AV/fees never count toward closing that gap — see EstimateTotals.fbSubtotal);
  // 'fixed' bills bar_amount flat; anything else (no bar plan) contributes zero.
  let barRevenue = 0;
  if (event.bar_mode === 'fill') {
    barRevenue = Math.max(0, Number(event.min_spend || 0) - foodSubtotal);
  } else if (event.bar_mode === 'fixed') {
    barRevenue = Number(event.bar_amount || 0);
  }

  const fbSubtotal = foodSubtotal + barRevenue;
  const subtotal = fbSubtotal + chargesSubtotal;
  const serviceFee = subtotal * (Number(event.service_fee_pct || 0) / 100);
  const tax = subtotal * Number(event.tax_rate || 0);
  return {
    subtotal, fbSubtotal, barRevenue, chargesSubtotal,
    serviceFee, tax, total: subtotal + serviceFee + tax,
  };
}

export function groupLineItemsBySection(
  lineItems: EstimateLineItem[],
  courses: Array<{ id: number; course_label: string }>,
): Array<{ label: string; items: EstimateLineItem[] }> {
  const courseLabel = new Map(courses.map((c) => [c.id, c.course_label]));
  const buckets = new Map<string, EstimateLineItem[]>();
  for (const li of [...lineItems].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))) {
    const label = (li.category && li.category.trim())
      || (li.course_id != null && courseLabel.get(li.course_id)) || 'Menu';
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label)!.push(li);
  }
  const rank = (l: string) => {
    if (l === 'Menu') return Number.MAX_SAFE_INTEGER;
    const i = SECTION_ORDER.indexOf(l);
    return i === -1 ? Number.MAX_SAFE_INTEGER - 1 : i;
  };
  return [...buckets.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([label, items]) => ({ label, items }));
}
