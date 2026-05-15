import { notFound } from 'next/navigation';
import { getDb } from '../../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../../lib/location';
import InventoryNav from '../../_nav';
import CountSheet from './CountSheet';

export const dynamic = 'force-dynamic';

export default function CountSheetPage({ params, searchParams }) {
  const id = Number(params?.id);
  if (!Number.isInteger(id) || id <= 0) return notFound();
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const db = getDb();
  const head = db
    .prepare(
      `SELECT id, count_date, label, opened_at, closed_at, cook_id, location_id
         FROM inventory_counts WHERE id = ? AND location_id = ?`,
    )
    .get(id, loc);
  if (!head) return notFound();

  // All par-list rows for the current location, plus existing count lines
  // joined in so the BOH can walk a structured sheet instead of typing names.
  const lines = db
    .prepare(
      `SELECT p.vendor, p.ingredient, p.sku, p.par_qty, p.par_unit,
              p.pack_size, p.pack_unit, p.category,
              l.id AS line_id, l.on_hand_qty, l.unit, l.note,
              l.counted_by, l.counted_at
         FROM inventory_par p
         LEFT JOIN inventory_count_lines l
           ON l.count_id = ? AND l.ingredient = p.ingredient
              AND COALESCE(l.sku,'') = COALESCE(p.sku,'')
        WHERE p.location_id = ?
        ORDER BY p.category, p.ingredient`,
    )
    .all(id, loc);

  // Surface any free-typed lines that aren't in the par master.
  const orphanLines = db
    .prepare(
      `SELECT id AS line_id, vendor, ingredient, sku, on_hand_qty, unit,
              par_qty, par_unit, note, counted_by, counted_at
         FROM inventory_count_lines
        WHERE count_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM inventory_par p
             WHERE p.location_id = ?
               AND p.ingredient = inventory_count_lines.ingredient
               AND COALESCE(p.sku,'') = COALESCE(inventory_count_lines.sku,'')
          )
        ORDER BY ingredient`,
    )
    .all(id, loc);

  return (
    <>
      <InventoryNav />
      <CountSheet
        head={head}
        parRows={lines}
        orphanLines={orphanLines}
        locationId={loc}
      />
    </>
  );
}
