// Backfill entities_menu_items from toast_menu_items.
//
// Toast guid is the canonical external_id. We skip rows where guid is
// empty and skip "modifier" rows (Toast tracks toppings/options as
// menu_items with modifier=1 — those aren't dishes). archived rows
// land with active=0 so historical sales can still resolve to them.

import { resolveOrCreateMenuItem } from '../../lib/entities.ts';
import { makeTally, bumpTally } from './lib.mjs';

function tableExists(db, name) {
  return Boolean(
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name),
  );
}

export function backfillMenuItems(db, { apply = false } = {}) {
  const tally = makeTally();
  if (!tableExists(db, 'toast_menu_items')) return tally;

  const rows = db
    .prepare(
      `SELECT guid, name, base_price, archived, modifier, location_id
         FROM toast_menu_items
        WHERE guid IS NOT NULL AND TRIM(guid) != ''
          AND modifier = 0`,
    )
    .all();

  for (const r of rows) {
    const locationId = r.location_id ?? 'default';
    if (!apply) {
      const exists = db
        .prepare(
          `SELECT 1 FROM external_ids
            WHERE entity_type='menu_item' AND source_system='toast'
              AND external_id=? AND location_id=?`,
        )
        .get(r.guid, locationId);
      bumpTally(tally, exists ? 'reused' : 'created');
      continue;
    }
    try {
      const result = resolveOrCreateMenuItem(db, {
        source_system: 'toast',
        external_id: r.guid,
        location_id: locationId,
        display_name: r.name,
        base_price: r.base_price ?? null,
        metadata: { archived: r.archived === 1 },
      });
      // Archived flag should land on entities_menu_items.active=0. The
      // resolver only creates with active=1; on archived flips we patch
      // the entity row directly.
      if (result.created && r.archived === 1) {
        db.prepare(`UPDATE entities_menu_items SET active=0 WHERE uuid=?`).run(result.uuid);
      }
      bumpTally(tally, result.created ? 'created' : 'reused');
    } catch (err) {
      bumpTally(tally, 'error');
      console.error(`menu_items: guid=${r.guid}: ${err.message}`);
    }
  }
  return tally;
}
