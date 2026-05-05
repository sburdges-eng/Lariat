'use client';
// Break tracker. "Start meal", "start rest", "end break" — one row per
// cook, stacked. Open breaks glow so a forgotten-to-end break is loud.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function minutes(iso) {
  if (!iso) return 0;
  return (Date.now() - Date.parse(iso)) / 60000;
}

export default function BreakBoard({ rows, staff, date, locationId }) {
  const router = useRouter();
  const [cookId, setCookId] = useState('');
  const [waiverRef, setWaiverRef] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [nowTs, setNowTs] = useState(Date.now());

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const byCook = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.cook_id)) m.set(r.cook_id, []);
      m.get(r.cook_id).push(r);
    }
    return m;
  }, [rows]);

  const start = async (kind) => {
    if (!cookId) {
      setErr('Pick yourself in the sidebar first.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/breaks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          cook_id: cookId,
          shift_date: date,
          location_id: locationId,
          started_at: new Date().toISOString(),
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
    } finally {
      setSaving(false);
    }
  };

  const waive = async () => {
    if (!cookId) {
      setErr('Pick yourself first.');
      return;
    }
    if (!waiverRef.trim()) {
      setErr('Meal-break waiver requires a signed reference (new-hire packet, etc).');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/breaks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'meal',
          waived: true,
          waiver_ref: waiverRef.trim(),
          cook_id: cookId,
          shift_date: date,
          location_id: locationId,
          started_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Didn\u2019t save — try again');
        return;
      }
      setWaiverRef('');
      router.refresh();
    } catch {
      setErr('Lost connection — not saved');
    } finally {
      setSaving(false);
    }
  };

  const endBreak = async (id) => {
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/breaks', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id,
          ended_at: new Date().toISOString(),
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
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="breaks-page">
      <h1>Breaks</h1>
      <p className="subtitle">
        CO COMPS #39. 10-min paid rest per 4 hours (or major fraction). 30-min meal after 5 hours.
        Waived meals require a signed waiver on file.
      </p>

      {err && <div className="alert alert-red">{err}</div>}

      <section className="breaks-actions">
        <div className="breaks-actions-row">
          <button className="btn-major" onClick={() => start('rest')} disabled={saving}>
            Start 10-min rest
          </button>
          <button className="btn-major" onClick={() => start('meal')} disabled={saving}>
            Start 30-min meal
          </button>
        </div>
        <div className="breaks-actions-row breaks-waive">
          <input
            value={waiverRef}
            onChange={(e) => setWaiverRef(e.target.value)}
            placeholder="Meal-waiver doc reference"
          />
          <button onClick={waive} disabled={saving}>
            Log waived meal
          </button>
        </div>
      </section>

      <section>
        <h2 className="section-h">Today by cook</h2>
        {byCook.size === 0 && <div className="empty-row">No breaks logged yet today.</div>}
        <div className="breaks-by-cook">
          {Array.from(byCook.entries()).map(([id, rs]) => {
            const worker = staff.find((s) => s.id === id);
            const name = worker ? `${worker.first} ${worker.last}` : id;
            const open = rs.find((r) => !r.ended_at && !r.waived);
            return (
              <article key={id} className={`breaks-cook ${open ? 'breaks-cook-open' : ''}`}>
                <header>
                  <span className="breaks-cook-name">{name}</span>
                  {open && (
                    <button onClick={() => endBreak(open.id)} disabled={saving} className="btn-ghost">
                      End ({Math.round(minutes(open.started_at))} min)
                    </button>
                  )}
                </header>
                <ul>
                  {rs.map((r) => (
                    <li key={r.id} className={`breaks-li breaks-li-${r.kind}`}>
                      <span>{r.waived ? 'meal (waived)' : r.kind}</span>
                      <span>
                        {fmtTime(r.started_at)}
                        {r.ended_at && ` → ${fmtTime(r.ended_at)}`}
                        {r.duration_min != null && ` · ${Math.round(r.duration_min)} min`}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
