// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

import { useCallback, useEffect, useState } from 'react';
import { clientFetch } from '@/lib/clientFetch';

async function fetchCatalog(vendor, q) {
  const params = new URLSearchParams({ vendor, unlinkedOnly: '1' });
  if (q) params.set('q', q);
  const res = await fetch(`/api/purchasing/vendor-catalog?${params}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

function CatalogPicker({ label, vendor, value, onPick }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await fetchCatalog(vendor, q);
      setRows(body.rows || []);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [vendor, q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{label}</label>
      <input
        type="search"
        placeholder="Search catalog"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: '100%', marginBottom: 8 }}
      />
      {loading ? <p className="subtitle">Loading…</p> : null}
      {error ? <p style={{ color: 'var(--amber, #8a5a00)' }}>{error}</p> : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 200, overflowY: 'auto' }}>
        {rows.map((row) => {
          const selected = value && value.sku === row.sku && value.ingredient === row.ingredient;
          return (
            <li key={`${row.vendor}-${row.sku}`} style={{ marginBottom: 4 }}>
              <button
                type="button"
                onClick={() => onPick(row)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: selected ? 'var(--panel-2, #f0ebe0)' : undefined,
                }}
              >
                {row.ingredient}
                {row.pack_label ? ` · ${row.pack_label}` : ''}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function LinkPairForm({ coverage }) {
  const [sysco, setSysco] = useState(null);
  const [shamrock, setShamrock] = useState(null);
  const [canonicalName, setCanonicalName] = useState('');
  const [state, setState] = useState('idle');
  const [error, setError] = useState(null);
  const [masterId, setMasterId] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setState('pending');
    setError(null);
    setMasterId(null);
    try {
      // idempotent: a service-worker replay of an already-processed
      // pair must hit the server's idempotency cache, not re-write.
      const res = await clientFetch('/api/purchasing/vendor-link/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          syscoKey: { vendor: 'sysco', sku: sysco.sku, ingredient: sysco.ingredient },
          shamrockKey: { vendor: 'shamrock', sku: shamrock.sku, ingredient: shamrock.ingredient },
          canonicalName,
        }),
        idempotent: true,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setMasterId(body.master_id);
      setState('done');
    } catch (err) {
      setError(err.message || String(err));
      setState('error');
    }
  }

  const canSubmit = sysco && shamrock && canonicalName.trim() && state !== 'pending';

  return (
    <form onSubmit={submit}>
      {coverage ? (
        <p className="subtitle">
          {coverage.mapped_pairs} mapped · {coverage.single_vendor} on one vendor · {coverage.unlinked_sysco} Sysco
          unlinked · {coverage.unlinked_shamrock} Shamrock unlinked
        </p>
      ) : null}

      <CatalogPicker label="Sysco item" vendor="sysco" value={sysco} onPick={setSysco} />
      <CatalogPicker label="Shamrock item" vendor="shamrock" value={shamrock} onPick={setShamrock} />

      <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Staple name</label>
      <input
        type="text"
        value={canonicalName}
        onChange={(e) => setCanonicalName(e.target.value)}
        placeholder="Chicken Breast"
        style={{ width: '100%', marginBottom: 16 }}
      />

      <button type="submit" disabled={!canSubmit}>
        {state === 'pending' ? 'Saving…' : 'Link both vendors'}
      </button>

      {state === 'error' && error ? (
        <p style={{ color: 'var(--amber, #8a5a00)', marginTop: 8 }}>{error}</p>
      ) : null}
      {state === 'done' && masterId ? (
        <p style={{ marginTop: 8 }}>
          Linked. <a href="/purchasing/compare">View on compare</a>
        </p>
      ) : null}
    </form>
  );
}
