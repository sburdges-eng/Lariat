// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

import { useEffect, useMemo, useState } from 'react';

/**
 * Right-rail panel that surfaces past prep records (from beo_prep_history)
 * for items currently in the open BEO event. Helps the KM scale a recurring
 * item without retyping prep_day / pre_prep / plating notes.
 *
 * Fetches `/api/beo/prep-history?item=…&item=…` on items-change. Empty state
 * is rendered (not hidden) so the cook knows the panel exists when nothing
 * has been prepped before.
 */
export default function PrepHistoryPanel({ itemNames, location }) {
  const dedupedItems = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const raw of itemNames || []) {
      const name = (raw || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out;
  }, [itemNames]);

  const itemsKey = dedupedItems.join('||');

  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    // Reconstruct from itemsKey (not dedupedItems) so the effect's deps are
    // honest — the memoized array gets a fresh identity whenever the parent
    // re-renders, but the serialized key only changes when content changes.
    const items = itemsKey === '' ? [] : itemsKey.split('||');
    if (items.length === 0) {
      setMatches([]);
      setErr('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErr('');

    const params = new URLSearchParams();
    for (const it of items) params.append('item', it);
    if (location) params.set('location', location);
    params.set('limit', '3');

    fetch(`/api/beo/prep-history?${params.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setMatches(Array.isArray(j.matches) ? j.matches : []);
      })
      .catch(() => {
        if (cancelled) return;
        setErr('Couldn’t load past prep — refresh the page');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [itemsKey, location]);

  return (
    <aside className="beo-menu beo-prep-history">
      <div className="beo-menu-head">
        <h2 className="m-0">Past prep</h2>
        <div className="beo-prep-history-hint">
          Last few times we’ve prepped these items.
        </div>
      </div>

      {err && <div className="beo-empty-row" style={{ color: 'var(--red)' }}>{err}</div>}

      {!err && dedupedItems.length === 0 && (
        <div className="beo-empty-row">No items on this BEO yet.</div>
      )}

      {!err && dedupedItems.length > 0 && !loading && matches.length === 0 && (
        <div className="beo-empty-row">No prior prep on file for these items.</div>
      )}

      {loading && <div className="beo-empty-row">Loading…</div>}

      {matches.map((m) => (
        <details key={m.item} className="beo-menu-group" open>
          <summary className="beo-menu-group-name">{m.item}</summary>
          {m.history.map((h, i) => (
            <div key={`${m.item}-${i}`} className="beo-prep-history-row">
              <div className="beo-prep-history-line1">
                <span className="beo-prep-history-date">{h.event_date || 'undated'}</span>
                <span className="beo-prep-history-client">{h.client || 'unknown client'}</span>
                {h.amount_qty ? (
                  <span className="beo-prep-history-qty">× {h.amount_qty}</span>
                ) : null}
              </div>
              {h.prep_day && (
                <div className="beo-prep-history-line2"><b>Prep day:</b> {h.prep_day}</div>
              )}
              {h.pre_prep_notes && (
                <div className="beo-prep-history-line2"><b>Pre-prep:</b> {h.pre_prep_notes}</div>
              )}
              {h.plating_notes && (
                <div className="beo-prep-history-line2"><b>Plating:</b> {h.plating_notes}</div>
              )}
            </div>
          ))}
        </details>
      ))}
    </aside>
  );
}
