// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
// Interactive board for TPHC batches. Start a batch (hot=4h, cold=6h),
// tap to discard with reason. Sorted by urgency: expired first,
// warning next, ok last.

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';

const REASON_LABELS = {
  reached_cutoff: 'Hit 4h/6h cutoff — tossed',
  consumed: 'Used before cutoff',
  quality: 'Quality — off flavor/look',
  contamination: 'Contamination / cross-contact',
};

const KIND_LABELS = {
  hot_time_only: 'Hot (4h)',
  cold_time_only: 'Cold (6h)',
};

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function fmtMinutes(m) {
  if (m == null) return '—';
  if (m < 0) return `${-m}m past cutoff`;
  if (m < 60) return `${m}m left`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m left` : `${h}h left`;
}

function statusColor(status) {
  if (status === 'expired') return 'var(--danger, #c85a2a)';
  if (status === 'warning') return 'var(--warn, #d9a441)';
  return 'var(--ok, #3a8a3a)';
}

export default function TphcBoard({
  active,
  scan,
  recent,
  now: _now,
  locationId,
  kinds,
  discardReasons,
}) {
  const router = useRouter();
  const [cookId, setCookId] = useState('');
  const [item, setItem] = useState('');
  const [kind, setKind] = useState(kinds[0] || 'hot_time_only');
  const [station, setStation] = useState('');
  const [batchRef, setBatchRef] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  const sorted = useMemo(() => {
    const order = { expired: 0, warning: 1, ok: 2 };
    return [...active].sort((a, b) => {
      const sa = scan[a.id]?.status || 'ok';
      const sb = scan[b.id]?.status || 'ok';
      if (order[sa] !== order[sb]) return order[sa] - order[sb];
      return a.cutoff_at < b.cutoff_at ? -1 : 1;
    });
  }, [active, scan]);

  const startBatch = async (e) => {
    e.preventDefault();
    if (!item.trim()) return;
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/tphc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          item: item.trim(),
          kind,
          started_at: new Date().toISOString(),
          station_id: station.trim() || null,
          batch_ref: batchRef.trim() || null,
          cook_id: cookId || null,
          location_id: locationId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Didn’t save — try again');
        return;
      }
      setItem('');
      setBatchRef('');
      setStation('');
      router.refresh();
    } catch {
      setErr('Lost connection — not saved');
    } finally {
      setSaving(false);
    }
  };

  const discard = async (id, reason) => {
    if (!reason) return;
    setErr('');
    try {
      const res = await fetch('/api/tphc', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, discard_reason: reason, cook_id: cookId || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Didn’t save — try again');
        return;
      }
      router.refresh();
    } catch {
      setErr('Lost connection — not saved');
    }
  };

  return (
    <div>
      <h1>Time Control</h1>
      <p className="subtitle">
        For food held by time, not temp. Hot = 4 hours. Cold = 6 hours. Toss at cutoff.
      </p>

      <form onSubmit={startBatch} style={{ marginTop: 16, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ flex: '2 1 200px' }}>
            <div style={{ fontSize: 12 }}>Item</div>
            <input
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="pizza topping / cut tomato"
              required
            />
          </label>
          <label style={{ flex: '1 1 120px' }}>
            <div style={{ fontSize: 12 }}>Hot or cold</div>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k] || k}
                </option>
              ))}
            </select>
          </label>
          <label style={{ flex: '1 1 120px' }}>
            <div style={{ fontSize: 12 }}>Station</div>
            <input
              value={station}
              onChange={(e) => setStation(e.target.value)}
              placeholder="expo / salad"
            />
          </label>
          <label style={{ flex: '1 1 120px' }}>
            <div style={{ fontSize: 12 }}>Batch ref</div>
            <input
              value={batchRef}
              onChange={(e) => setBatchRef(e.target.value)}
              placeholder="optional"
            />
          </label>
        </div>
        <div>
          <button type="submit" disabled={saving}>
            {saving ? 'Starting…' : 'Start batch'}
          </button>
          {err ? <span style={{ marginLeft: 12, color: 'var(--danger)' }}>{err}</span> : null}
        </div>
      </form>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16 }}>Open batches</h2>
        {sorted.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No open batches.</p>
        ) : (
          <ul style={{ display: 'grid', gap: 8, padding: 0, listStyle: 'none' }}>
            {sorted.map((r) => {
              const s = scan[r.id];
              const color = statusColor(s?.status);
              return (
                <li
                  key={r.id}
                  style={{
                    border: `1px solid ${color}`,
                    borderLeft: `4px solid ${color}`,
                    borderRadius: 6,
                    padding: 12,
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{r.item}</strong>
                    <span style={{ color, fontWeight: 600 }}>
                      {fmtMinutes(s?.minutes_until_cutoff)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Started {fmtTime(r.started_at)} → cutoff {fmtTime(r.cutoff_at)}
                    {r.station_id ? ` · ${r.station_id}` : ''}
                    {r.batch_ref ? ` · ${r.batch_ref}` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {discardReasons.map((reason) => (
                      <button
                        key={reason}
                        onClick={() => discard(r.id, reason)}
                        style={{ fontSize: 12, padding: '6px 10px' }}
                      >
                        {REASON_LABELS[reason] || reason}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {recent.length > 0 ? (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16 }}>Recently closed</h2>
          <ul style={{ display: 'grid', gap: 4, padding: 0, listStyle: 'none', fontSize: 13 }}>
            {recent.map((r) => (
              <li key={r.id} style={{ color: 'var(--muted)' }}>
                {r.item} — {REASON_LABELS[r.discard_reason] || r.discard_reason}
                {' '}
                at {fmtTime(r.discarded_at)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
