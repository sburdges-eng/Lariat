// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

import { useState, useTransition } from 'react';
import { humanize } from '../../../../../lib/userError';

function dollarsFromCents(cents) {
  return ((Number(cents) || 0) / 100).toFixed(2);
}

function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function costRowsFromDeal(deal) {
  const rows = Array.isArray(deal?.costsOffTop) ? deal.costsOffTop : [];
  if (rows.length === 0) return [{ label: '', dollars: '' }];
  return rows.map((cost) => ({
    label: cost.label ?? '',
    dollars: dollarsFromCents(cost.cents),
  }));
}

function cleanCosts(rows) {
  return rows
    .map((row) => ({
      label: String(row.label ?? '').trim(),
      cents: toCents(row.dollars),
    }))
    .filter((row) => row.label || row.cents > 0);
}

export default function DealEditor({ showId, locationId, initialDeal }) {
  const [open, setOpen] = useState(false);
  const [guarantee, setGuarantee] = useState(
    dollarsFromCents(initialDeal.guaranteeCents),
  );
  const [vsPct, setVsPct] = useState(
    initialDeal.vsPctAfterCosts === null
      ? ''
      : String(initialDeal.vsPctAfterCosts),
  );
  const [buyout, setBuyout] = useState(dollarsFromCents(initialDeal.buyoutCents));
  const [costs, setCosts] = useState(() => costRowsFromDeal(initialDeal));
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const updateCost = (index, patch) => {
    setCosts((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const addCost = () => {
    setCosts((rows) => [...rows, { label: '', dollars: '' }]);
  };

  const removeCost = (index) => {
    setCosts((rows) => rows.filter((_, i) => i !== index));
  };

  const save = () => {
    setError(null);
    const pct =
      String(vsPct).trim() === '' ? null : Number(String(vsPct).trim());
    if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 1)) {
      setError('Use a vs number from 0 to 1.');
      return;
    }
    const cleanedCosts = cleanCosts(costs);
    if (cleanedCosts.some((row) => row.cents < 0)) {
      setError('Costs must be zero or more.');
      return;
    }

    const body = {
      deal: {
        guaranteeCents: toCents(guarantee),
        vsPctAfterCosts: pct,
        costsOffTop: cleanedCosts,
        buyoutCents: toCents(buyout),
      },
      cookId: 'manager',
    };
    const locationQuery =
      locationId && locationId !== 'default'
        ? `?location=${encodeURIComponent(locationId)}`
        : '';

    startTransition(async () => {
      try {
        const res = await fetch(`/api/shows/${showId}/deal${locationQuery}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            res.status === 401
              ? 'Manager PIN required.'
              : data.error || 'Could not save deal.',
          );
        }
        window.location.reload();
      } catch (err) {
        console.error('DealEditor save failed:', err);
        setError(humanize(err));
      }
    });
  };

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      style={{ marginTop: 16 }}
    >
      <summary className="btn sm" style={{ display: 'inline-flex' }}>
        Edit deal
      </summary>

      <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
        <div className="grid-2" style={{ gap: 10 }}>
          <MoneyInput label="Guarantee" value={guarantee} onChange={setGuarantee} />
          <MoneyInput label="Buyout" value={buyout} onChange={setBuyout} />
        </div>

        <label>
          <div className="row-meta">vs after costs</div>
          <input
            className="input"
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={vsPct}
            placeholder="blank for flat"
            onChange={(event) => setVsPct(event.target.value)}
          />
        </label>

        <div style={{ display: 'grid', gap: 8 }}>
          <div className="row-meta">Costs off top</div>
          {costs.map((cost, index) => (
            <div
              key={index}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) minmax(120px, 160px) auto',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <input
                className="input"
                type="text"
                value={cost.label}
                placeholder="Sound"
                onChange={(event) =>
                  updateCost(index, { label: event.target.value })
                }
              />
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={cost.dollars}
                placeholder="0.00"
                onChange={(event) =>
                  updateCost(index, { dollars: event.target.value })
                }
              />
              <button
                type="button"
                className="btn sm"
                onClick={() => removeCost(index)}
                disabled={costs.length === 1}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="btn sm" onClick={addCost}>
            Add cost
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" className="btn primary" onClick={save} disabled={pending}>
            {pending ? 'Saving...' : 'Save deal'}
          </button>
          {error ? (
            <span style={{ color: 'var(--red, #c00)', fontSize: 13 }}>{error}</span>
          ) : null}
        </div>
      </div>
    </details>
  );
}

function MoneyInput({ label, value, onChange }) {
  return (
    <label>
      <div className="row-meta">{label}</div>
      <input
        className="input"
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
