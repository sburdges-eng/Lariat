// @ts-check
'use client';

// EventPrepPanel — per-event prep demands read-only view (T9).
//
// Fetches GET /api/beo/cascade?event_id=N&location=<loc>
// and renders prep_demands (per-recipe quantities to make).
// Surfaces unmapped items and engine errors via UnmappedCallout — no silent drops.
// No editing — embedded in the BEO board Prep tab.

import { useEffect, useState } from 'react';
import UnmappedCallout from './UnmappedCallout';

/** @typedef {import('../../../lib/beoCascade').PrepDemandRow} PrepDemandRow */
/** @typedef {import('../../../lib/beoCascade').UnmappedRow} UnmappedRow */
/** @typedef {'idle' | 'loading' | 'error' | 'empty' | 'loaded'} PrepPanelState */

/**
 * @param {{ eventId?: number | null, location?: string }} props
 */
export default function EventPrepPanel({ eventId, location = 'default' }) {
  const [state, setState] = useState(/** @type {PrepPanelState} */ ('idle'));
  const [prepDemands, setPrepDemands] = useState(/** @type {PrepDemandRow[]} */ ([]));
  const [unmapped, setUnmapped] = useState(/** @type {UnmappedRow[]} */ ([]));
  const [engineError, setEngineError] = useState(/** @type {string | null} */ (null));

  useEffect(() => {
    if (eventId == null) {
      setState('idle');
      return;
    }

    let cancelled = false;
    setState('loading');

    fetch(
      `/api/beo/cascade?event_id=${encodeURIComponent(eventId)}&location=${encodeURIComponent(location)}`,
    )
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState('error');
          return;
        }
        const j = await res.json();
        if (cancelled) return;
        const rows = Array.isArray(j.prep_demands) ? j.prep_demands : [];
        const unmappedItems = Array.isArray(j.unmapped) ? j.unmapped : [];
        const err = j.error || null;
        setUnmapped(unmappedItems);
        setEngineError(err);
        if (rows.length === 0 && unmappedItems.length === 0 && !err) {
          setState('empty');
        } else {
          setPrepDemands(rows);
          setState('loaded');
        }
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, location]);

  if (state === 'idle') return null;

  if (state === 'loading') {
    return (
      <div data-testid="event-prep-loading" className="beo-prep-panel-loading">
        Loading…
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div data-testid="event-prep-error" className="beo-prep-panel-error">
        Couldn&apos;t load prep demands — tap to retry.
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div data-testid="event-prep-empty" className="beo-prep-panel-empty">
        No prep demands for this event yet.
      </div>
    );
  }

  return (
    <div className="beo-prep-panel">
      <UnmappedCallout unmapped={unmapped} error={engineError} />
      <ul data-testid="event-prep-list" className="beo-prep-list">
        {prepDemands.map((row, i) => (
          <li key={`${row.recipe_slug}-${i}`} data-testid="event-prep-row" className="beo-prep-row">
            <span className="beo-prep-name">{row.display_name}</span>
            <span className="beo-prep-qty">{row.qty} {row.unit}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
