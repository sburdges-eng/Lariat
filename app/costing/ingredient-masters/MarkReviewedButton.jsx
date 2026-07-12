// @ts-check
'use client';

import { useState } from 'react';

/**
 * Tiny client island — PATCHes ingredient-masters with last_reviewed:'now'.
 * After a successful ack, location.reload() refreshes the server-rendered
 * list. Failure surfaces inline; the row stays clickable for retry.
 *
 * @param {{ masterId: string, cookId?: string | null }} props
 */
export default function MarkReviewedButton({ masterId, cookId = null }) {
  const [state, setState] = useState(/** @type {'idle' | 'pending' | 'error'} */ ('idle'));
  const [errorMsg, setErrorMsg] = useState(/** @type {string | null} */ (null));

  async function onClick() {
    setState('pending');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/costing/ingredient-masters', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          master_id: masterId,
          updates: { last_reviewed: 'now' },
          cook_id: cookId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      // Reload so the server-rendered table re-fetches with the new
      // last_reviewed and re-sorts.
      window.location.reload();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message || String(err) : String(err));
      setState('error');
    }
  }

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <button
        type="button"
        onClick={onClick}
        disabled={state === 'pending'}
        style={{
          padding: '4px 10px',
          borderRadius: 4,
          border: '1px solid var(--line, #cfc6b0)',
          background: state === 'pending' ? '#eee' : 'var(--panel-2, #f7f2e8)',
          color: 'var(--ink, #1c160e)',
          cursor: state === 'pending' ? 'wait' : 'pointer',
          fontSize: 12,
        }}
      >
        {state === 'pending' ? 'Saving…' : 'Mark reviewed'}
      </button>
      {state === 'error' && errorMsg ? (
        <span style={{ color: 'var(--amber, #8a5a00)', fontSize: 11 }}>
          {errorMsg}
        </span>
      ) : null}
    </span>
  );
}
