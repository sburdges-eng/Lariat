// @ts-check
'use client';
// Tip pool — daily totals, per-cook breakdown, makeup-pay flag.
//
// Kitchen voice: "Pool", "By cook", "Add tips", "Save". No "ledger",
// "distribute", "transactions".

import { useMemo, useState } from 'react';
import { formatMoney } from '../../../lib/formatMoney';

/** @typedef {import('./page.jsx').TipPoolRow} TipPoolRow */
/** @typedef {import('../../../lib/tipPool').PoolSummary} PoolSummary */

/**
 * @param {{
 *   initialRows: TipPoolRow[],
 *   initialSummary: PoolSummary,
 *   locationId: string,
 *   date: string,
 *   comps: { std_min_wage_cents: number, tipped_min_wage_cents: number, tip_credit_cents: number },
 * }} props
 */
export default function TipPoolBoard({ initialRows, initialSummary, locationId, date, comps }) {
  const [rows, setRows] = useState(/** @type {TipPoolRow[]} */ (initialRows || []));
  const [summary, setSummary] = useState(
    /** @type {PoolSummary} */ (
      initialSummary || { total_cents: 0, by_cook: {}, by_kind: { tip_pool: 0, service_charge: 0, direct_tip: 0 } }
    ),
  );

  // Form state
  const [cookId, setCookId] = useState('');
  const [poolRef, setPoolRef] = useState(`POOL-${date}`);
  const [role, setRole] = useState('');
  const [kind, setKind] = useState('tip_pool');
  const [dollars, setDollars] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  const cookEntries = useMemo(() => {
    const entries = Object.entries(summary.by_cook || {});
    entries.sort((a, b) => b[1] - a[1]);
    return entries;
  }, [summary]);

  const refetch = async () => {
    try {
      const q = locationId && locationId !== 'default' ? `&location=${encodeURIComponent(locationId)}` : '';
      const res = await fetch(`/api/tip-pool?date=${encodeURIComponent(date)}${q}`);
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.rows)) setRows(body.rows);
      if (body.summary) setSummary(body.summary);
    } catch {
      /* ignore */
    }
  };

  /**
   * @param {string} s
   * @returns {number | null}
   */
  function dollarsToCents(s) {
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    // Round half-away-from-zero so $0.005 → 1¢ (employer-bears).
    return Math.round(n * 100);
  }

  /** @param {React.FormEvent<HTMLFormElement>} ev */
  async function submit(ev) {
    ev.preventDefault();
    setErr('');
    setInfo('');
    if (!cookId.trim()) {
      setErr('Pick a cook.');
      return;
    }
    if (!poolRef.trim()) {
      setErr('Pool name required.');
      return;
    }
    const cents = dollarsToCents(dollars);
    if (cents === null || cents < 0) {
      setErr('Amount must be a positive dollar value.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/tip-pool', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shift_date: date,
          pool_ref: poolRef.trim(),
          cook_id: cookId.trim(),
          role: role.trim() || null,
          kind,
          amount_cents: cents,
          note: note.trim() || null,
          location_id: locationId,
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
      setInfo(`Saved ${formatMoney(cents, { nullDisplay: '$0.00' })} for ${cookId.trim()}.`);
      setDollars('');
      setNote('');
      await refetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Tip pool</h1>
        <span className="text-sm text-neutral-500">
          {date} · floor {formatMoney(comps.std_min_wage_cents, { nullDisplay: '$0.00' })}/h · tipped {formatMoney(comps.tipped_min_wage_cents, { nullDisplay: '$0.00' })}/h
        </span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded border border-neutral-200 p-3">
          <div className="text-sm text-neutral-500">Total today</div>
          <div className="text-2xl font-bold">{formatMoney(summary.total_cents, { nullDisplay: '$0.00' })}</div>
        </div>
        <div className="rounded border border-neutral-200 p-3">
          <div className="text-sm text-neutral-500">Pool</div>
          <div className="text-xl font-semibold">{formatMoney(summary.by_kind.tip_pool || 0, { nullDisplay: '$0.00' })}</div>
        </div>
        <div className="rounded border border-neutral-200 p-3">
          <div className="text-sm text-neutral-500">Service charge</div>
          <div className="text-xl font-semibold">{formatMoney(summary.by_kind.service_charge || 0, { nullDisplay: '$0.00' })}</div>
        </div>
        <div className="rounded border border-neutral-200 p-3">
          <div className="text-sm text-neutral-500">Direct tips</div>
          <div className="text-xl font-semibold">{formatMoney(summary.by_kind.direct_tip || 0, { nullDisplay: '$0.00' })}</div>
        </div>
      </div>

      <section>
        <h2 className="font-semibold mb-2">By cook</h2>
        {cookEntries.length === 0 ? (
          <p className="text-sm text-neutral-500">No tips yet today.</p>
        ) : (
          <ul className="divide-y border rounded">
            {cookEntries.map(([cook, cents]) => (
              <li key={cook} className="flex justify-between p-2">
                <span className="font-medium">{cook}</span>
                <span>{formatMoney(cents, { nullDisplay: '$0.00' })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={submit} className="border rounded p-3 bg-neutral-50 space-y-2">
        <div className="font-semibold">Add tips</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
            Role (optional)
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="server"
              className="block w-full border rounded px-2 py-1 mt-1"
            />
          </label>
          <label className="block text-sm">
            Pool
            <input
              type="text"
              value={poolRef}
              onChange={(e) => setPoolRef(e.target.value)}
              className="block w-full border rounded px-2 py-1 mt-1"
            />
          </label>
          <label className="block text-sm">
            Type
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="block w-full border rounded px-2 py-1 mt-1"
            >
              <option value="tip_pool">Pool</option>
              <option value="service_charge">Service charge</option>
              <option value="direct_tip">Direct tip</option>
            </select>
          </label>
          <label className="block text-sm">
            Amount (dollars)
            <input
              type="number"
              step="0.01"
              min="0"
              value={dollars}
              onChange={(e) => setDollars(e.target.value)}
              placeholder="50.00"
              className="block w-full border rounded px-2 py-1 mt-1"
            />
          </label>
          <label className="block text-sm">
            Note
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Friday close"
              className="block w-full border rounded px-2 py-1 mt-1"
              maxLength={300}
            />
          </label>
        </div>

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

      <section>
        <h2 className="font-semibold mb-2">Today’s lines</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-neutral-500">None yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-neutral-500">
              <tr>
                <th className="p-2">Cook</th>
                <th className="p-2">Type</th>
                <th className="p-2">Pool</th>
                <th className="p-2 text-right">Amount</th>
                <th className="p-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.cook_id}</td>
                  <td className="p-2">{r.kind}</td>
                  <td className="p-2">{r.pool_ref}</td>
                  <td className="p-2 text-right">{formatMoney(r.amount_cents, { nullDisplay: '$0.00' })}</td>
                  <td className="p-2">{r.note || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
