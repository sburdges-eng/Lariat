// lib/beoEstimate.ts
export interface EstimateLineItem {
  id: number; item_name: string; category?: string | null;
  unit_cost?: number | null; quantity?: number | null;
  course_id?: number | null; sort_order?: number | null;
}
export interface EstimateTotals { subtotal: number; serviceFee: number; tax: number; total: number; }

export const SECTION_ORDER: string[] = [
  'Passed', 'Passed Hors d’Oeuvres', 'Large Format', 'Buffet', 'Large Format & Buffet',
  'Family Style', 'Passed Desserts', 'Desserts', 'Artisan Snack Boards', 'Boards', 'Bar & Fees',
];

export function computeEstimateTotals(
  event: { tax_rate?: number | null; service_fee_pct?: number | null },
  lineItems: Array<{ unit_cost?: number | null; quantity?: number | null }>,
): EstimateTotals {
  const subtotal = lineItems.reduce(
    (acc, l) => acc + Number(l.unit_cost || 0) * Number(l.quantity || 0), 0);
  const serviceFee = subtotal * (Number(event.service_fee_pct || 0) / 100);
  const tax = subtotal * Number(event.tax_rate || 0);
  return { subtotal, serviceFee, tax, total: subtotal + serviceFee + tax };
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
