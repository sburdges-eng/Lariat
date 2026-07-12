// @ts-check
'use client';

import { useState } from 'react';

/** @typedef {import('../../../lib/ingredientMastersRepo.ts').MasterUpdates} MasterUpdates */

/**
 * @param {string} masterId
 * @param {MasterUpdates} updates
 */
async function patchMaster(masterId, updates) {
  const res = await fetch('/api/costing/ingredient-masters', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ master_id: masterId, updates }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
}

/**
 * @param {{
 *   masterId: string,
 *   preferredVendor: string | null,
 *   qualityLocked: boolean,
 * }} props
 */
export default function CompareActions({ masterId, preferredVendor, qualityLocked }) {
  const [state, setState] = useState(/** @type {'idle' | 'pending' | 'error'} */ ('idle'));
  const [errorMsg, setErrorMsg] = useState(/** @type {string | null} */ (null));

  /** @param {MasterUpdates} updates */
  async function run(updates) {
    setState('pending');
    setErrorMsg(null);
    try {
      await patchMaster(masterId, updates);
      window.location.reload();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message || String(err) : String(err));
      setState('error');
    }
  }

  const disabled = state === 'pending';

  if (qualityLocked) {
    return (
      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" disabled={disabled} onClick={() => run({ quality_locked: false })}>
          {disabled ? 'Saving…' : 'Unlock'}
        </button>
        {state === 'error' && errorMsg ? (
          <span style={{ color: 'var(--amber, #8a5a00)', fontSize: 11 }}>{errorMsg}</span>
        ) : null}
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" disabled={disabled} onClick={() => run({ preferred_vendor: 'sysco' })}>
        Use Sysco
      </button>
      <button type="button" disabled={disabled} onClick={() => run({ preferred_vendor: 'shamrock' })}>
        Use Shamrock
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          run({
            preferred_vendor: preferredVendor || 'sysco',
            quality_locked: true,
            quality_lock_reason: 'quality',
          })
        }
      >
        Lock for quality
      </button>
      {state === 'error' && errorMsg ? (
        <span style={{ color: 'var(--amber, #8a5a00)', fontSize: 11 }}>{errorMsg}</span>
      ) : null}
    </span>
  );
}
