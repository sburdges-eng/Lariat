'use client';

import { useState } from 'react';

function toCents(dollars) {
  const n = Number(dollars);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export default function DealEditor({ showId, initialDeal }) {
  const [open, setOpen] = useState(false);
  const [guarantee, setGuarantee] = useState(initialDeal.guaranteeCents / 100);
  const [vsPct, setVsPct] = useState(
    initialDeal.vsPctAfterCosts === null
      ? ''
      : String(initialDeal.vsPctAfterCosts),
  );
  const [buyout, setBuyout] = useState(initialDeal.buyoutCents / 100);
  const [costs, setCosts] = useState(
    JSON.stringify(
      initialDeal.costsOffTop.map((c) => ({
        label: c.label,
        dollars: c.cents / 100,
      })),
      null,
      2,
    ),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const parsedCosts = JSON.parse(costs).map((c) => ({
        label: c.label,
        cents: toCents(c.dollars),
      }));
      const body = {
        deal: {
          guaranteeCents: toCents(guarantee),
          vsPctAfterCosts: vsPct === '' ? null : Number(vsPct),
          costsOffTop: parsedCosts,
          buyoutCents: toCents(buyout),
        },
        cookId: 'manager',
      };
      const res = await fetch(`/api/shows/${showId}/deal`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      window.location.reload();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <details
      className="mt-4 text-sm"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer">Edit deal</summary>
      <div className="mt-3 space-y-2">
        <label className="block">
          <span className="text-xs">Guarantee ($)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={guarantee}
            onChange={(e) => setGuarantee(e.target.value)}
            className="border rounded px-2 py-1 w-full"
          />
        </label>
        <label className="block">
          <span className="text-xs">vs % after costs (0–1, blank for flat)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={vsPct}
            onChange={(e) => setVsPct(e.target.value)}
            className="border rounded px-2 py-1 w-full"
          />
        </label>
        <label className="block">
          <span className="text-xs">Buyout ($)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={buyout}
            onChange={(e) => setBuyout(e.target.value)}
            className="border rounded px-2 py-1 w-full"
          />
        </label>
        <label className="block">
          <span className="text-xs">
            Costs off top — JSON array of {`{label, dollars}`}
          </span>
          <textarea
            rows={4}
            value={costs}
            onChange={(e) => setCosts(e.target.value)}
            className="border rounded px-2 py-1 w-full font-mono text-xs"
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="border rounded px-3 py-1 bg-stone-900 text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save deal'}
          </button>
          {err ? <span className="text-red-700 text-xs">{err}</span> : null}
        </div>
      </div>
    </details>
  );
}
