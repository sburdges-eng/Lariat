// @ts-check
'use client';

import { useMemo, useState } from 'react';
import { clientFetch } from '@/lib/clientFetch';

/** @typedef {import('./page.jsx').ReceivingMatchRow} ReceivingMatchRow */
/** @typedef {import('./page.jsx').IngredientMasterOption} IngredientMasterOption */

/**
 * @param {{
 *   row: ReceivingMatchRow,
 *   masters: IngredientMasterOption[],
 *   locationId: string,
 * }} props
 */
export default function ReceivingMatchResolver({ row, masters, locationId }) {
  const [masterId, setMasterId] = useState('');
  const [state, setState] = useState(/** @type {'idle' | 'pending' | 'error'} */ ('idle'));
  const [errorMsg, setErrorMsg] = useState('');

  const selected = useMemo(
    () => masters.find((m) => m.master_id === masterId) || null,
    [masters, masterId],
  );

  async function resolveLine() {
    if (!masterId || state === 'pending') return;
    setState('pending');
    setErrorMsg('');
    try {
      let cookId = null;
      try {
        cookId = window.localStorage.getItem('lariat_cook') || null;
      } catch {
        cookId = null;
      }
      const res = await clientFetch(`/api/receiving/matches/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          location_id: locationId,
          master_id: masterId,
          cook_id: cookId,
        }),
        idempotent: true,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      window.location.reload();
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div style={{ display: 'grid', gap: 6, minWidth: 220 }}>
      <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
        <span>Master ingredient</span>
        <select
          value={masterId}
          onChange={(e) => setMasterId(e.target.value)}
          disabled={state === 'pending'}
          style={{
            minWidth: 220,
            padding: '6px 8px',
            borderRadius: 4,
            border: '1px solid var(--line, #cfc6b0)',
          }}
        >
          <option value="">Choose one</option>
          {masters.map((m) => (
            <option key={m.master_id} value={m.master_id}>
              {m.canonical_name}
            </option>
          ))}
        </select>
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={resolveLine}
          disabled={!masterId || state === 'pending'}
          style={{
            padding: '6px 10px',
            borderRadius: 4,
            border: '1px solid var(--line, #cfc6b0)',
            background: state === 'pending' ? '#eee' : 'var(--panel-2, #f7f2e8)',
            color: 'var(--ink, #1c160e)',
            cursor: !masterId || state === 'pending' ? 'not-allowed' : 'pointer',
            fontSize: 12,
          }}
        >
          {state === 'pending' ? 'Saving...' : 'Set master'}
        </button>
        {selected ? (
          <span style={{ fontSize: 11, color: 'var(--muted, #6f6758)' }}>
            {selected.master_id}
          </span>
        ) : null}
      </div>
      {state === 'error' && errorMsg ? (
        <span style={{ color: 'var(--amber, #8a5a00)', fontSize: 11 }}>
          {errorMsg}
        </span>
      ) : null}
    </div>
  );
}
