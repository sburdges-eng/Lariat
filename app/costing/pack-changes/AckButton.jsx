// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Single-row acknowledge button for /costing/pack-changes.
 *
 * Wires through POST /api/costing/pack-changes (which writes the
 * management-action audit row via lib/auditLog.mjs) and refreshes the
 * server-rendered list on success. Optional note collected via prompt
 * is forwarded into the audit payload — kept lo-fi on purpose: a richer
 * note collector belongs on a dedicated edit screen, not the queue row.
 */
export default function AckButton({ id }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const router = useRouter();

  async function handleAck() {
    if (busy) return;
    const note = window.prompt(
      'Optional note for the audit log (e.g. "Confirmed pack swap with Sysco rep"):',
      '',
    );
    if (note === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/costing/pack-changes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, note: note ?? null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div style={{ minWidth: 120, textAlign: 'right' }}>
      <button
        type="button"
        className="btn primary"
        onClick={handleAck}
        disabled={busy}
        aria-label={`Acknowledge pack-size change ${id}`}
      >
        {busy ? 'Acknowledging…' : 'Acknowledge'}
      </button>
      {error ? (
        <div role="alert" style={{ color: 'var(--red)', fontSize: 11, marginTop: 4 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
