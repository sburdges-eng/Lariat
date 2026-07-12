// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
'use client';

import { useMemo } from 'react';

/**
 * Row shape prefetched server-side by page.jsx — a subset of
 * lib/beoPrepHistory.ts's `RecipePrepHistoryRow` (`client`/`type`/
 * `source`/`imported_at` are dropped before the props cross to the
 * client bundle so catering customer names stay PIN-gated).
 * @typedef {Pick<
 *   import('../../../lib/beoPrepHistory.ts').RecipePrepHistoryRow,
 *   'item' | 'event_date' | 'amount_qty' | 'prep_day' | 'pre_prep_notes' | 'plating_notes'
 * >} PrepHistoryRow
 */

/** @typedef {{ item: string, rows: PrepHistoryRow[] }} GroupedHistory */

/**
 * Past catering-event prep history for the recipe being viewed.
 * Receives prefetched rows from the server component (no fetch on
 * mount) — this keeps customer-name fields server-side and avoids
 * exposing them through a public API. The server-side helper handles
 * the recipe-name → BEO-item fuzzy match (substring, both directions)
 * so abbreviated/casing variants in the BEO sheet still surface here.
 * @param {{ recipeName: string, history: PrepHistoryRow[] }} props
 */
export default function PreviouslyPlatedAs({ recipeName, history }) {
  const grouped = useMemo(() => {
    /** @type {Map<string, GroupedHistory>} */
    const byItem = new Map();
    for (const row of history || []) {
      const key = row.item || '';
      let bucket = byItem.get(key);
      if (!bucket) {
        bucket = { item: key, rows: [] };
        byItem.set(key, bucket);
      }
      bucket.rows.push(row);
    }
    return Array.from(byItem.values());
  }, [history]);

  if (!history || history.length === 0) return null;

  const showVariantHint =
    recipeName &&
    grouped.some((g) => g.item.toLowerCase() !== recipeName.toLowerCase());

  return (
    <aside
      className="beo-menu beo-prep-history"
      style={{ marginTop: 28 }}
    >
      <div className="beo-menu-head">
        <h2 className="m-0">Previously plated as</h2>
        <div className="beo-prep-history-hint">
          Last few times we’ve prepped this for an event.
          {showVariantHint && ' Event-sheet names may differ.'}
        </div>
      </div>

      {grouped.map((g) => (
        <details key={g.item} className="beo-menu-group" open>
          <summary className="beo-menu-group-name">
            {g.item}
            {recipeName && g.item.toLowerCase() !== recipeName.toLowerCase() && (
              <span
                className="beo-prep-history-hint"
                style={{ marginLeft: 8 }}
              >
                (from event sheet)
              </span>
            )}
          </summary>
          {g.rows.map((h, i) => (
            <div
              key={`${g.item}-${i}`}
              className="beo-prep-history-row"
            >
              <div className="beo-prep-history-line1">
                <span className="beo-prep-history-date">
                  {h.event_date || 'undated'}
                </span>
                {h.amount_qty ? (
                  <span className="beo-prep-history-qty">
                    × {h.amount_qty}
                  </span>
                ) : null}
              </div>
              {h.prep_day && (
                <div className="beo-prep-history-line2">
                  <b>Prep day:</b> {h.prep_day}
                </div>
              )}
              {h.pre_prep_notes && (
                <div className="beo-prep-history-line2">
                  <b>Pre-prep:</b> {h.pre_prep_notes}
                </div>
              )}
              {h.plating_notes && (
                <div className="beo-prep-history-line2">
                  <b>Plating:</b> {h.plating_notes}
                </div>
              )}
            </div>
          ))}
        </details>
      ))}
    </aside>
  );
}
