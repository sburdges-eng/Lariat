'use client';
// Interactive board for date marks. One form to create, one tap to
// discard. Sorted by urgency so the expired stuff is always at the top.

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';

const DISCARD_REASONS = [
  { id: 'expired', label: 'Past 7-day window' },
  { id: 'early_use', label: 'Used before window' },
  { id: 'quality', label: 'Quality — off flavor/look' },
  { id: 'contamination', label: 'Contamination / cross-contact' },
];

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function DateMarkBoard({ active, scan, recent, today, locationId }) {
  const router = useRouter();
  const [cookId, setCookId] = useState('');
  const [item, setItem] = useState('');
  const [batchRef, setBatchRef] = useState('');
  const [preparedOn, setPreparedOn] = useState(today);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  const sorted = useMemo(() => {
    const order = { expired: 0, due_today: 1, ok: 2 };
    return [...active].sort((a, b) => {
      const sa = scan[a.id]?.status || 'ok';
      const sb = scan[b.id]?.status || 'ok';
      if (order[sa] !== order[sb]) return order[sa] - order[sb];
      return a.discard_on < b.discard_on ? -1 : 1;
    });
  }, [active, scan]);

  const createMark = async (e) => {
    e.preventDefault();
    if (!item.trim() || !preparedOn) return;
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/date-marks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          item: item.trim(),
          prepared_on: preparedOn,
          batch_ref: batchRef.trim() || null,
          cook_id: cookId || null,
          location_id: locationId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Didn\u2019t save — try again');
        return;
      }
      setItem('');
      setBatchRef('');
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
      const res = await fetch('/api/date-marks', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id,
          discard_reason: reason,
          cook_id: cookId || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Didn\u2019t save — try again');
        return;
      }
      router.refresh();
    } catch {
      setErr('Lost connection — not saved');
    }
  };

  return (
    <div className="datemark-page">
      <h1>Date marks</h1>
      <p className="subtitle">
        7-day rule — day of prep is day 1. Anything past its discard date is toss-or-explain, no exceptions.
      </p>

      {err && (
        <div className="alert alert-red" role="alert" aria-live="assertive">
          {err}
        </div>
      )}

      <section className="datemark-card datemark-new" aria-labelledby="dm-new-h">
        <form onSubmit={createMark} className="datemark-new-form" aria-busy={saving}>
          <div className="datemark-new-label" id="dm-new-h">New batch</div>
          <label htmlFor="dm-item" className="sr-only">Item</label>
          <input
            id="dm-item"
            name="dm-item"
            type="text"
            placeholder="Item (e.g. cooked rice, aioli)"
            value={item}
            onChange={(e) => setItem(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="next"
            aria-label="Item"
            required
          />
          <label htmlFor="dm-batch" className="sr-only">Batch or lot reference</label>
          <input
            id="dm-batch"
            name="dm-batch"
            type="text"
            placeholder="Batch / lot ref (optional)"
            value={batchRef}
            onChange={(e) => setBatchRef(e.target.value)}
            autoComplete="off"
            aria-label="Batch or lot reference (optional)"
          />
          <label htmlFor="dm-prepped" className="sr-only">Prepared on</label>
          <input
            id="dm-prepped"
            name="dm-prepped"
            type="date"
            value={preparedOn}
            onChange={(e) => setPreparedOn(e.target.value)}
            aria-label="Prepared on"
            required
          />
          <button
            type="submit"
            disabled={saving}
            aria-label={saving ? 'Saving mark' : 'Create date mark'}
          >
            {saving ? 'Saving…' : 'Create mark'}
          </button>
        </form>
      </section>

      <section aria-labelledby="dm-active-h">
        <h2 className="section-h" id="dm-active-h">Active ({sorted.length})</h2>
        {sorted.length === 0 && (
          <div className="empty-row" role="status" aria-live="polite">Nothing currently held.</div>
        )}
        <ul className="datemark-list" aria-label="Active date marks" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {sorted.map((m) => {
            const s = scan[m.id] || { status: 'ok' };
            const tone =
              s.status === 'expired' ? 'red' : s.status === 'due_today' ? 'amber' : 'green';
            const selectId = `dm-discard-${m.id}`;
            return (
              <li
                key={m.id}
                className={`datemark-row datemark-tone-${tone}`}
                aria-label={`${m.item}${s.status === 'expired' ? ' — expired' : s.status === 'due_today' ? ' — due today' : ''}`}
              >
                <div className="datemark-main">
                  <div className="datemark-item">{m.item}</div>
                  <div className="datemark-meta">
                    prepped <time dateTime={m.prepared_on}>{fmtDate(m.prepared_on)}</time>
                    {' · discard by '}
                    <time dateTime={m.discard_on}>{fmtDate(m.discard_on)}</time>
                    {m.batch_ref && ` · ${m.batch_ref}`}
                  </div>
                </div>
                <div className="datemark-status">
                  {s.status === 'expired' && `Expired · ${Math.abs(s.days_remaining)}d past`}
                  {s.status === 'due_today' && 'Use or toss today'}
                  {s.status === 'ok' && `${s.days_remaining}d left`}
                </div>
                <div className="datemark-actions">
                  <label htmlFor={selectId} className="sr-only">
                    Discard {m.item}
                  </label>
                  <select
                    id={selectId}
                    name={selectId}
                    defaultValue=""
                    aria-label={`Discard ${m.item}`}
                    onChange={(e) => {
                      const v = e.target.value;
                      e.target.value = '';
                      if (v) discard(m.id, v);
                    }}
                  >
                    <option value="" disabled>
                      Discard…
                    </option>
                    {DISCARD_REASONS.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="dm-recent-h">
          <h2 className="section-h" id="dm-recent-h">Recently discarded</h2>
          <ul className="datemark-recent-list" aria-label="Recently discarded items" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {recent.map((d) => (
              <li key={d.id} className="datemark-recent">
                <span className="datemark-recent-item">{d.item}</span>
                <span className="datemark-recent-reason">{d.discard_reason}</span>
                <time className="datemark-recent-time" dateTime={d.discarded_at}>
                  {new Date(d.discarded_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
