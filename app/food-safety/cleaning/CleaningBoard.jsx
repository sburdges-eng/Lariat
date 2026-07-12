// @ts-check
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** @typedef {import('./page.jsx').CleaningLogRow} CleaningLogRow */

const COMMON_AREAS = [
  'Line',
  'Dish pit',
  'Walk-in',
  'Prep area',
  'Bar',
  'Front of house',
  'Hood',
  'Floor',
];

/** @param {string} iso */
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * @param {{
 *   rows: CleaningLogRow[],
 *   locationId: string,
 *   date: string,
 *   citation: string,
 * }} props
 */
export default function CleaningBoard({ rows, locationId, date, citation }) {
  const router = useRouter();
  const [cookId, setCookId] = useState('');
  const [area, setArea] = useState('Line');
  const [task, setTask] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const submit = async (e) => {
    e.preventDefault();
    if (!task.trim()) return;
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/cleaning', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          area: area.trim() || 'General',
          task: task.trim(),
          notes: notes.trim() || null,
          cook_id: cookId || null,
          location_id: locationId,
          shift_date: date,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Didn’t save — try again');
        return;
      }
      setTask('');
      setNotes('');
      router.refresh();
    } catch {
      setErr('Lost connection — not saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h1>Cleaning log</h1>
      <p className="subtitle">{citation}</p>

      {err && (
        <div className="alert alert-red" role="alert" aria-live="assertive">
          {err}
        </div>
      )}

      <section style={{ marginTop: 18 }}>
        <h2 className="section-h">Today ({rows.length})</h2>
        {rows.length === 0 ? (
          <div className="empty-row" role="status" aria-live="polite">
            No cleans logged yet today.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th>When</th>
                <th>Area</th>
                <th>Task</th>
                <th>Cook</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtTime(r.completed_at)}</td>
                  <td>{r.area}</td>
                  <td>{r.task}</td>
                  <td>{r.cook_id || '—'}</td>
                  <td>{r.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card" style={{ padding: 16, marginTop: 18 }}>
        <h2 className="section-h">Log a clean</h2>
        <form onSubmit={submit} aria-busy={saving} style={{ display: 'grid', gap: 10 }}>
          <label>
            <span>Area</span>
            <input
              type="text"
              list="cleaning-area-list"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              autoComplete="off"
              maxLength={100}
            />
            <datalist id="cleaning-area-list">
              {COMMON_AREAS.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </label>
          <label>
            <span>Task</span>
            <input
              type="text"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="e.g. wiped slicer with quat, broke down can wash"
              autoComplete="off"
              maxLength={200}
              required
            />
          </label>
          <label>
            <span>Notes (optional)</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              autoComplete="off"
              maxLength={500}
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            aria-label={saving ? 'Saving cleaning entry' : 'Record clean'}
          >
            {saving ? 'Saving…' : 'Record clean'}
          </button>
        </form>
      </section>
    </div>
  );
}
