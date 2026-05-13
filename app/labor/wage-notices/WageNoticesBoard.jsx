// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
// Wage notices — per-cook tile with last signed date + days since,
// "needs new" badge if >365 days, and a "Sign new notice" form.
//
// Kitchen voice: "Pay slip on file", "Sign new", "Needs new" — no
// "instrument", "execute", "compliance".

import { useMemo, useState } from 'react';

function fmtMoney(cents) {
  if (!Number.isFinite(cents)) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function dollarsToCents(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export default function WageNoticesBoard({
  initialLatestPerCook,
  initialFreshness,
  reasons,
  payBases,
  locationId,
  today,
}) {
  const [latest, setLatest] = useState(initialLatestPerCook || []);
  const [freshness, setFreshness] = useState(initialFreshness || []);

  // Form state
  const [cookId, setCookId] = useState('');
  const [reason, setReason] = useState('hire');
  const [payBasis, setPayBasis] = useState('hourly');
  const [wageDollars, setWageDollars] = useState('');
  const [tipCreditDollars, setTipCreditDollars] = useState('');
  const [docPath, setDocPath] = useState('');
  const [signedOn, setSignedOn] = useState(today);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  const freshnessByCook = useMemo(() => {
    const m = new Map();
    for (const f of freshness) m.set(f.cook_id, f);
    return m;
  }, [freshness]);

  const refetch = async () => {
    try {
      const q = locationId && locationId !== 'default' ? `&location=${encodeURIComponent(locationId)}` : '';
      const res = await fetch(`/api/wage-notices?_t=${Date.now()}${q}`);
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.latest_per_cook)) setLatest(body.latest_per_cook);
      if (Array.isArray(body.freshness)) setFreshness(body.freshness);
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
    const cents = dollarsToCents(wageDollars);
    if (cents === null || cents < 0) {
      setErr('Pay rate must be a positive dollar value.');
      return;
    }
    let tip = null;
    if (payBasis === 'tipped' && tipCreditDollars.trim()) {
      tip = dollarsToCents(tipCreditDollars);
      if (tip === null || tip < 0) {
        setErr('Tip credit must be a positive dollar value.');
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch('/api/wage-notices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cook_id: cookId.trim(),
          reason,
          wage_rate_cents: cents,
          pay_basis: payBasis,
          tip_credit_cents: tip,
          document_path: docPath.trim() || null,
          signed_on: signedOn,
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
      setInfo(`Saved notice for ${cookId.trim()}.`);
      setWageDollars('');
      setTipCreditDollars('');
      setDocPath('');
      await refetch();
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">Wage notices</h1>

      {latest.length === 0 ? (
        <p className="text-sm text-neutral-500">No wage notices on file yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {latest.map((row) => {
            const f = freshnessByCook.get(row.cook_id) || {};
            const stale = f.needs_new;
            return (
              <div
                key={row.cook_id}
                className={`rounded border p-3 ${stale ? 'border-red-400 bg-red-50' : 'border-neutral-200'}`}
              >
                <div className="text-base font-semibold">{row.cook_id}</div>
                <div className="text-sm mt-1">
                  {fmtMoney(row.wage_rate_cents)} · {row.pay_basis}
                  {row.pay_basis === 'tipped' && row.tip_credit_cents != null
                    ? ` · tip credit ${fmtMoney(row.tip_credit_cents)}`
                    : ''}
                </div>
                <div className="text-xs text-neutral-600 mt-1">
                  Signed {row.signed_on}
                  {f.days_since != null ? ` · ${f.days_since} days ago` : ''}
                </div>
                {stale && <div className="text-xs text-red-700 mt-1 font-medium">Needs new — over a year old</div>}
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={submit} className="border rounded p-3 bg-neutral-50 space-y-2">
        <div className="font-semibold">Sign new notice</div>
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
            Why
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="block w-full border rounded px-2 py-1 mt-1"
            >
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {r === 'hire'
                    ? 'New hire'
                    : r === 'rate_change'
                    ? 'Pay change'
                    : r === 'annual'
                    ? 'Yearly check'
                    : r === 'law_change'
                    ? 'Law moved'
                    : 'Other'}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Pay basis
            <select
              value={payBasis}
              onChange={(e) => setPayBasis(e.target.value)}
              className="block w-full border rounded px-2 py-1 mt-1"
            >
              {payBases.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Pay rate (dollars/hr or /yr)
            <input
              type="number"
              step="0.01"
              min="0"
              value={wageDollars}
              onChange={(e) => setWageDollars(e.target.value)}
              placeholder="14.81"
              className="block w-full border rounded px-2 py-1 mt-1"
            />
          </label>
          {payBasis === 'tipped' && (
            <label className="block text-sm">
              Tip credit (dollars/hr)
              <input
                type="number"
                step="0.01"
                min="0"
                value={tipCreditDollars}
                onChange={(e) => setTipCreditDollars(e.target.value)}
                placeholder="3.02"
                className="block w-full border rounded px-2 py-1 mt-1"
              />
            </label>
          )}
          <label className="block text-sm">
            Signed on
            <input
              type="date"
              value={signedOn}
              onChange={(e) => setSignedOn(e.target.value)}
              className="block w-full border rounded px-2 py-1 mt-1"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            Doc (optional path)
            <input
              type="text"
              value={docPath}
              onChange={(e) => setDocPath(e.target.value)}
              placeholder="hr/notices/alice-2026.pdf"
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
    </div>
  );
}
