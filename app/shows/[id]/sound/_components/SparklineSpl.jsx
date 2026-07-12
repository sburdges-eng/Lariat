// @ts-check
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sparklinePath, summarizeSpl, splThresholdStatus } from '../../../../../lib/splTelemetry';

/** @typedef {import('../../../../../lib/splTelemetry').SplReading} SplReading */
/** @typedef {import('../../../../../lib/splTelemetry').SplStatus} SplStatus */

const POLL_MS = 10_000;

// SPL band → CSS var (mirrors the AttendanceKPI mapping on /shows/tonight).
/** @type {Record<SplStatus, string>} */
const STATUS_COLOR = {
  green: 'var(--green, var(--sage, #5d7a66))',
  amber: 'var(--yellow, var(--ember, #c85a2a))',
  red: 'var(--red, #8b2e1f)',
  unset: 'var(--muted)',
};

/**
 * @typedef {{ status: 'idle' | 'saving' | 'saved' | 'error', error: string | null }} PostState
 */

/**
 * @param {{
 *   showId: number | string,
 *   locationId: string,
 *   sceneId: number | null,
 *   sceneSplLimit: number | null,
 * }} props
 */
export default function SparklineSpl({ showId, locationId, sceneId, sceneSplLimit }) {
  const [readings, setReadings] = useState(/** @type {SplReading[]} */ ([]));
  const [logValue, setLogValue] = useState('');
  const [postState, setPostState] = useState(/** @type {PostState} */ ({ status: 'idle', error: null }));
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const url = `/api/shows/${showId}/sound/spl?limit=60${
        locationId && locationId !== 'default' ? `&location=${locationId}` : ''
      }`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setReadings(Array.isArray(data?.readings) ? data.readings : []);
    } catch {
      /* polling — silent failure is fine */
    } finally {
      inFlightRef.current = false;
    }
  }, [showId, locationId]);

  // Initial load + 10s poll. Suspends while the tab is hidden to spare
  // the iPad battery; resumes immediately on visibility change.
  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      load();
    }, POLL_MS);
    const onVis = () => {
      if (typeof document !== 'undefined' && !document.hidden) load();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  const submit = async () => {
    const v = Number(logValue);
    if (!Number.isFinite(v)) {
      setPostState({ status: 'error', error: 'Enter a number' });
      return;
    }
    setPostState({ status: 'saving', error: null });
    try {
      const res = await fetch(`/api/shows/${showId}/sound/spl`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          db_value: v,
          scene_id: sceneId ?? null,
          location_id: locationId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setReadings(Array.isArray(data?.readings) ? data.readings : []);
      setLogValue('');
      setPostState({ status: 'saved', error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setPostState({ status: 'error', error: msg || 'Failed to log SPL' });
    }
  };

  const summary = summarizeSpl(readings, sceneSplLimit ?? null);
  const path = sparklinePath(readings, sceneSplLimit ?? null, { width: 240, height: 56 });
  const latestStatus = splThresholdStatus(summary.latest, sceneSplLimit ?? null);

  return (
    <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
      <div
        className="row-meta"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}
      >
        <span>SPL telemetry · last {summary.count} readings</span>
        {summary.latest != null ? (
          <span style={{ color: STATUS_COLOR[latestStatus], fontFamily: 'JetBrains Mono, monospace' }}>
            {summary.latest.toFixed(1)} dB
          </span>
        ) : (
          <span style={{ color: 'var(--muted)' }}>no readings yet</span>
        )}
      </div>

      <svg
        viewBox={path.viewBox}
        width="100%"
        height={path.height}
        preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible' }}
        role="img"
        aria-label={`SPL sparkline · ${summary.count} readings`}
      >
        {path.thresholdY != null ? (
          <line
            x1={0}
            x2={path.width}
            y1={path.thresholdY}
            y2={path.thresholdY}
            stroke="var(--red, #8b2e1f)"
            strokeDasharray="3 3"
            strokeWidth={1}
            opacity={0.6}
          />
        ) : null}
        {path.d ? (
          <path
            d={path.d}
            fill="none"
            stroke={STATUS_COLOR[latestStatus] || STATUS_COLOR.green}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
      </svg>

      <div
        className="row-meta"
        style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}
      >
        <span>
          peak {summary.peak != null ? `${summary.peak.toFixed(1)} dB` : '—'}
          {summary.avg_last_n != null ? ` · avg ${summary.avg_last_n.toFixed(1)}` : ''}
        </span>
        <span>
          {sceneSplLimit != null
            ? `limit ${sceneSplLimit} dB${summary.over_limit_count ? ` · ${summary.over_limit_count} over` : ''}`
            : 'no scene limit'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="number"
          step="0.1"
          className="input sm"
          value={logValue}
          onChange={(e) => setLogValue(e.target.value)}
          placeholder="dB (e.g. 98.5)"
          style={{ maxWidth: 140 }}
          aria-label="dB reading"
        />
        <button type="button" className="btn sm" onClick={submit} disabled={postState.status === 'saving'}>
          {postState.status === 'saving' ? 'Logging…' : 'Log SPL'}
        </button>
        {postState.status === 'error' && (
          <span style={{ color: 'var(--red, #c00)', fontSize: 11 }}>{postState.error}</span>
        )}
        {postState.status === 'saved' && (
          <span style={{ color: 'var(--muted)', fontSize: 11 }}>logged</span>
        )}
      </div>
    </div>
  );
}
