// @ts-check
'use client';

// EventOrderGuidePanel — per-event order guide read-only view (T9).
//
// Fetches GET /api/beo/cascade?event_id=N&location=<loc>
// and renders the aggregated order_guide rows (ingredients to buy).
// Surfaces unmapped items and engine errors via UnmappedCallout — no silent drops.
// No editing — embedded in the BEO board Order guide tab.

import { useEffect, useState } from 'react';
import UnmappedCallout from './UnmappedCallout';

/** @typedef {import('../../../lib/beoCascade').OrderGuideRow} OrderGuideRow */
/** @typedef {import('../../../lib/beoCascade').UnmappedRow} UnmappedRow */
/** @typedef {import('../../../lib/beoCascade').ManifestWarningRow} ManifestWarningRow */
/** @typedef {'idle' | 'loading' | 'error' | 'empty' | 'loaded'} OrderGuidePanelState */

/**
 * @param {{ eventId?: number | null, location?: string }} props
 */
export default function EventOrderGuidePanel({ eventId, location = 'default' }) {
  const [state, setState] = useState(/** @type {OrderGuidePanelState} */ ('idle'));
  const [orderGuide, setOrderGuide] = useState(/** @type {OrderGuideRow[]} */ ([]));
  const [unmapped, setUnmapped] = useState(/** @type {UnmappedRow[]} */ ([]));
  const [manifestWarnings, setManifestWarnings] = useState(/** @type {ManifestWarningRow[]} */ ([]));
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
        const rows = Array.isArray(j.order_guide) ? j.order_guide : [];
        const unmappedItems = Array.isArray(j.unmapped) ? j.unmapped : [];
        const warnings = Array.isArray(j.manifest_warnings) ? j.manifest_warnings : [];
        const err = j.error || null;
        setUnmapped(unmappedItems);
        setManifestWarnings(warnings);
        setEngineError(err);
        if (rows.length === 0 && unmappedItems.length === 0 && warnings.length === 0 && !err) {
          setState('empty');
        } else {
          setOrderGuide(rows);
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
      <div data-testid="event-order-guide-loading" className="beo-order-guide-loading">
        Loading…
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div data-testid="event-order-guide-error" className="beo-order-guide-error">
        Couldn&apos;t load order guide — tap to retry.
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div data-testid="event-order-guide-empty" className="beo-order-guide-empty">
        No order guide items for this event yet.
      </div>
    );
  }

  return (
    <div className="beo-order-guide-panel">
      <UnmappedCallout unmapped={unmapped} error={engineError} manifestWarnings={manifestWarnings} />
      <table data-testid="event-order-guide-table" className="beo-order-guide-table">
        <thead>
          <tr>
            <th>Ingredient</th>
            <th>Total needed</th>
            <th>Unit</th>
            <th>To order</th>
          </tr>
        </thead>
        <tbody>
          {orderGuide.map((row, i) => (
            <tr key={`${row.ingredient}-${i}`} data-testid="event-order-guide-row">
              <td>{row.ingredient}</td>
              <td>{row.total_needed}</td>
              <td>{row.unit}</td>
              <td>{row.to_order}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
