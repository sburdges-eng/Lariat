// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
// Sick leave — per-cook tile with hours available, cap, and quick
// "Add hours" / "Use hours" buttons. Manager-PIN-gated by the API.
//
// Kitchen voice: "How much sick time", "Add hours", "Use hours",
// "Cap hit". Avoid "balance", "ledger", "accrue".

import { useState } from 'react';

function fmtHours(h) {
  if (h === null || h === undefined || !Number.isFinite(h)) return '—';
  const r = Math.round(h * 10) / 10;
  return `${r}h`;
}

export default function SickLeaveBoard({ initialBalances, locationId, year, capHours }) {
  const [balances, setBalances] = useState(initialBalances || []);
  const [cookId, setCookId] = useState('');
  const [hours, setHours] = useState('');
  const [mode, setMode] = useState('add'); // 'add' | 'use'
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  const refetch = async () => {
    try {
      const q = locationId && locationId !== 'default' ? `&location=${encodeURIComponent(locationId)}` : '';
      const res = await fetch(`/api/sick-leave?year=${year}${q}`);
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.balances)) setBalances(body.balances);
    } catch {
      /* ignore */
    }
  };

  async function submit(ev) {
    ev.preventDefault();
    setErr('');
    setInfo('');
    if (!cookId.trim()) {
      setErr('Pick a cook.');
      return;
    }
    const n = Number(hours);
    if (!Number.isFinite(n) || n <= 0) {
      setErr('Hours must be more than zero.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/sick-leave', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: mode === 'add' ? 'accrual' : 'use',
          cook_id: cookId.trim(),
          accrual_year: year,
          hours: n,
          location_id: locationId,
          note: note.trim() || null,
        }),
      });
      if (res.status === 403) {
        setErr('Need manager PIN.');
        return;
      }
      const body = await res.json();
      if (!res.ok) {
        setErr(body.error || 'Save failed.');
        return;
      }
      setInfo(mode === 'add' ? `Added ${fmtHours(body.hours_applied)}.` : `Used ${fmtHours(body.hours_applied)}.`);
      setHours('');
      setNote('');
      await refetch();
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Sick time</h1>
        <span className="text-sm text-neutral-500">Year {year} · cap {capHours}h</span>
      </header>

      {balances.length === 0 ? (
        <p className="text-sm text-neutral-500">No sick-time records yet for this year.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {balances.map((b) => (
            <div
              key={b.cook_id}
              className={`rounded border p-3 ${b.at_cap ? 'border-amber-400 bg-amber-50' : 'border-neutral-200'}`}
            >
              <div className="text-base font-semibold">{b.cook_id}</div>
              <div className="text-2xl font-bold mt-1">{fmtHours(b.hours_available)}</div>
              <div className="text-xs text-neutral-600 mt-1">
                Earned {fmtHours(b.hours_accrued)} · Used {fmtHours(b.hours_used)}
                {b.carryover_hours > 0 ? ` · Carry ${fmtHours(b.carryover_hours)}` : ''}
              </div>
              {b.at_cap && <div className="text-xs text-amber-800 mt-1">Cap hit — no more earning this year.</div>}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="border rounded p-3 bg-neutral-50 space-y-2">
        <div className="font-semibold">Log sick time</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode('add')}
            className={`px-3 py-1.5 rounded ${mode === 'add' ? 'bg-blue-600 text-white' : 'bg-white border'}`}
          >
            Add hours
          </button>
          <button
            type="button"
            onClick={() => setMode('use')}
            className={`px-3 py-1.5 rounded ${mode === 'use' ? 'bg-blue-600 text-white' : 'bg-white border'}`}
          >
            Use hours
          </button>
        </div>
        <label className="block text-sm">
          Cook
          <input
            type="text"
            value={cookId}
            onChange={(e) => setCookId(e.target.value)}
            placeholder="alice"
            className="block w-full border rounded px-2 py-1 mt-1"
          />
        </label>
        <label className="block text-sm">
          Hours
          <input
            type="number"
            step="0.25"
            min="0"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="1.0"
            className="block w-full border rounded px-2 py-1 mt-1"
          />
        </label>
        <label className="block text-sm">
          Note (why)
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="flu — out 4/22"
            className="block w-full border rounded px-2 py-1 mt-1"
            maxLength={300}
          />
        </label>

        {err && <div className="text-sm text-red-700">{err}</div>}
        {info && <div className="text-sm text-green-700">{info}</div>}

        <button
          type="submit"
          disabled={saving}
          className="px-3 py-1.5 rounded bg-green-600 text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </div>
  );
}
