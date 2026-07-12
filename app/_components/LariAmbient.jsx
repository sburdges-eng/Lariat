// @ts-check
'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import LariOrb from './LariOrb';

// LaRi ambient strip — top-of-surface predictive read.
//
// V5 reads from `/api/lari/predictions?surface=X&location=Y` (a
// deterministic stub today, ML-replaceable later). Polls every 60 s.
// Renders silently when the API is unreachable — no toasts, no
// red banners; the strip's value is "this is what LaRi thinks right
// now," not a critical-path UI element.
//
// Naming: every visible string says "LaRi" (the AI), never "LaRiOS"
// (the design-system label).
//
// Surface accepts any string the API supports (today: 'beo'). Pass
// `dense` for tight chrome (KDS / tablets) — narrows the row + drops
// the trailing "Ask LaRi" button label down to icon-only future PR.

/** @typedef {import('../../lib/lariPredictions').LariPrediction} LariPrediction */

const POLL_MS = 60_000;
const DEFAULT_SLOTS = 3;

/**
 * @param {{
 *   surface: string,
 *   location?: string | null,
 *   params?: Record<string, string | number | null | undefined>,
 *   dense?: boolean,
 *   slots?: number,
 * }} props
 */
export default function LariAmbient({
  surface,
  location,
  params: extraParams,
  dense = false,
  slots = DEFAULT_SLOTS,
}) {
  const [predictions, setPredictions] = useState(/** @type {LariPrediction[]} */ ([]));
  const [hadFirstResponse, setHadFirstResponse] = useState(false);

  // Stable serialization of extraParams so identical-shaped objects
  // from re-renders don't re-trigger the fetch effect.
  const extraSerialized = extraParams
    ? Object.entries(extraParams)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join('&')
    : '';

  const fetchPredictions = useCallback(async () => {
    if (!surface) return;
    try {
      const params = new URLSearchParams({ surface });
      if (location) params.set('location', location);
      if (extraParams) {
        for (const [k, v] of Object.entries(extraParams)) {
          if (v == null || v === '') continue;
          params.set(k, String(v));
        }
      }
      const res = await fetch(`/api/lari/predictions?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        // Stay silent on 401 (user lost PIN), 5xx (transient). The
        // strip simply renders empty — operators don't need to see
        // "LaRi service down" mid-shift; they have bigger problems.
        setHadFirstResponse(true);
        return;
      }
      const j = /** @type {{ predictions?: LariPrediction[] }} */ (await res.json());
      const next = Array.isArray(j.predictions) ? j.predictions : [];
      setPredictions(next);
      setHadFirstResponse(true);
    } catch {
      // Network blip — same silent-degrade behavior.
      setHadFirstResponse(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface, location, extraSerialized]);

  useEffect(() => {
    fetchPredictions();
    const id = setInterval(fetchPredictions, POLL_MS);
    return () => clearInterval(id);
  }, [fetchPredictions]);

  // Mount-suppression: don't paint until the first response lands so we
  // don't flash "LaRi has nothing to say" before the API has even
  // answered. After the first response, we render even on empty so the
  // brand presence is consistent.
  if (!hadFirstResponse) return null;

  const visible = predictions.slice(0, slots);

  return (
    <div
      className={`lari-ambient${dense ? ' lari-ambient-dense' : ''}`}
      role="region"
      aria-label="LaRi predictions"
    >
      <LariOrb size={dense ? 'sm' : 'md'} live={visible.length > 0} />
      <span className="lari-ambient-label">LaRi</span>
      <div className="lari-ambient-items">
        {visible.length === 0 ? (
          <span className="lari-ambient-empty">No alerts right now.</span>
        ) : (
          visible.map((p, i) => (
            <PredictionSlot key={p.id} prediction={p} muted={i > 0} />
          ))
        )}
      </div>
      <Link
        href="/kitchen-assistant"
        className="lari-ambient-ask btn"
        aria-label="Ask LaRi — open the kitchen assistant"
      >
        Ask LaRi
      </Link>
    </div>
  );
}

/**
 * @param {{ prediction: LariPrediction, muted: boolean }} props
 */
function PredictionSlot({ prediction, muted }) {
  const sev = prediction?.severity || 'ok';
  return (
    <span
      className={`lari-ambient-slot lari-ambient-slot-${sev}${muted ? ' lari-ambient-slot-muted' : ''}`}
    >
      <span className={`lari-dot lari-dot-${sev}`} aria-hidden="true" />
      <span className="lari-ambient-text" title={prediction.text}>
        {prediction.text}
      </span>
      {prediction.action ? (
        <span className="lari-ambient-action" aria-hidden="true">
          {prediction.action}
        </span>
      ) : null}
    </span>
  );
}
