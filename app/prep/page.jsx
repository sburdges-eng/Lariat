// Daily prep board. Server-rendered list of today's prep_tasks grouped
// by station, with claim/done actions on the client side.
//
// Suggested-prep at the top: items below par from the latest count are
// surfaced as one-click "Add as task" buttons. The page does NOT auto-
// generate prep_tasks from low par — the BOH chooses what gets prepped
// today and clicks. This keeps the source of truth in the prep board
// (not derived) so the line cook's view matches the manager's view.

import { getDb, todayISO } from '../../lib/db';
import { getStations } from '../../lib/data';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import PrepBoard from './PrepBoard';

export const dynamic = 'force-dynamic';

export default function PrepPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const date = todayISO();
  const db = getDb();

  const tasks = db
    .prepare(
      `SELECT id, shift_date, station_id, task, qty, recipe_slug, notes,
              priority, assigned_cook_id, status, started_at, done_at,
              done_by, source, source_ref, sort_order, created_at, updated_at
         FROM prep_tasks
        WHERE shift_date = ? AND location_id = ?
        ORDER BY priority DESC, sort_order ASC, id ASC`,
    )
    .all(date, loc);

  // Suggested prep: ingredients on the par list with a latest count below
  // par, ranked by deficit (par - on_hand). Caps at 8 — line cooks don't
  // need a wall of suggestions, just the top few.
  const lowPar = db
    .prepare(
      `SELECT p.ingredient, p.par_qty, p.par_unit,
              latest.on_hand_qty, latest.unit AS on_hand_unit
         FROM inventory_par p
         JOIN (
           SELECT l1.ingredient, l1.sku, l1.on_hand_qty, l1.unit
             FROM inventory_count_lines l1
            WHERE l1.location_id = ?
              AND l1.counted_at = (
                SELECT MAX(l2.counted_at)
                  FROM inventory_count_lines l2
                 WHERE l2.location_id = l1.location_id
                   AND l2.ingredient = l1.ingredient
                   AND COALESCE(l2.sku,'') = COALESCE(l1.sku,'')
              )
         ) AS latest
           ON latest.ingredient = p.ingredient
          AND COALESCE(latest.sku,'') = COALESCE(p.sku,'')
        WHERE p.location_id = ?
          AND p.par_qty IS NOT NULL
          AND latest.on_hand_qty IS NOT NULL
          AND latest.on_hand_qty < p.par_qty
        ORDER BY (p.par_qty - latest.on_hand_qty) DESC
        LIMIT 8`,
    )
    .all(loc, loc);

  // Don't suggest items that already have an open prep task today.
  const openTaskIngredients = new Set(
    tasks
      .filter(
        (t) =>
          (t.status === 'todo' || t.status === 'in_progress') &&
          t.source === 'low_par' &&
          t.source_ref,
      )
      .map((t) => t.source_ref),
  );
  const suggested = lowPar.filter((r) => !openTaskIngredients.has(r.ingredient));

  const stations = getStations();

  return (
    <PrepBoard
      tasks={tasks}
      stations={stations}
      suggested={suggested}
      date={date}
      locationId={loc}
    />
  );
}
