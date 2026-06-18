// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

import { useCallback, useEffect, useState } from 'react';

export default function AttachVendorActions({ masterId, missingVendor, canonicalName }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [state, setState] = useState('idle');
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!open) return;
    const params = new URLSearchParams({ vendor: missingVendor, unlinkedOnly: '1' });
    if (q) params.set('q', q);
    const res = await fetch(`/api/purchasing/vendor-catalog?${params}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
    setRows(body.rows || []);
  }, [open, missingVendor, q]);

  useEffect(() => {
    const t = setTimeout(() => {
      load().catch((err) => setError(err.message || String(err)));
    }, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function attach(row) {
    setState('pending');
    setError(null);
    try {
      const res = await fetch('/api/purchasing/vendor-link/attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          masterId,
          catalogKey: { vendor: missingVendor, sku: row.sku, ingredient: row.ingredient },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      window.location.reload();
    } catch (err) {
      setError(err.message || String(err));
      setState('error');
    }
  }

  return (
    <span>
      <button type="button" disabled={state === 'pending'} onClick={() => setOpen((v) => !v)}>
        {state === 'pending' ? 'Saving…' : `Attach ${missingVendor}`}
      </button>
      {open ? (
        <div className="card" style={{ marginTop: 8, maxWidth: 420 }}>
          <p style={{ marginTop: 0 }}>Pick a {missingVendor} item for {canonicalName}</p>
          <input
            type="search"
            placeholder="Search catalog"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: '100%', marginBottom: 8 }}
          />
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 160, overflowY: 'auto' }}>
            {rows.map((row) => (
              <li key={row.sku} style={{ marginBottom: 4 }}>
                <button type="button" onClick={() => attach(row)} style={{ width: '100%', textAlign: 'left' }}>
                  {row.ingredient}
                </button>
              </li>
            ))}
          </ul>
          {error ? <p style={{ color: 'var(--amber, #8a5a00)' }}>{error}</p> : null}
        </div>
      ) : null}
    </span>
  );
}
