// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { destinationLabel, safeNextPath } from './pinDestination.js';

export default function LoginPinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get('next') || '';
  const setupRequired = searchParams.get('setup') === '1';
  const safeNext = safeNextPath(rawNext);
  const destination = destinationLabel(rawNext);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  if (setupRequired) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Manager PIN needed</h2>
        <p style={{ color: 'var(--muted)' }}>
          Set a manager PIN, then reopen Lariat.
        </p>
      </div>
    );
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    const res = await fetch('/api/auth/pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    setLoading(false);
    if (!res.ok) {
      // 401 = wrong PIN, keep the terse message (no server detail on
      // auth failures). Anything else carries an actionable server
      // message — 429 rate limit, 503 setup required, 500 missing
      // LARIAT_PIN_SECRET (fails closed in prod) — that collapsing to
      // "Wrong PIN" would hide.
      let message = 'Wrong PIN';
      if (res.status !== 401) {
        const body = await res.json().catch(() => null);
        if (body && typeof body.error === 'string' && body.error) message = body.error;
      }
      setErr(message);
      return;
    }
    router.push(safeNext);
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="card">
      <h2 style={{ marginTop: 0, marginBottom: 6 }}>Open {destination}</h2>
      <p style={{ color: 'var(--muted)', marginTop: 0, marginBottom: 16 }}>
        Manager PIN required for this page.
      </p>
      <input
        type="text"
        name="username"
        autoComplete="username"
        value="manager"
        readOnly
        hidden
      />
      <label htmlFor="manager-pin" style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>Manager PIN</label>
      <input
        id="manager-pin"
        name="pin"
        type="password"
        autoComplete="current-password"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        style={{
          width: '100%',
          padding: 12,
          marginBottom: 16,
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          color: 'var(--text)',
          fontSize: 16,
        }}
      />
      {err && <div style={{ color: 'var(--red)', marginBottom: 12, fontSize: 14 }}>{err}</div>}
      <button type="submit" className="btn" disabled={loading}>
        {loading ? '…' : 'Open'}
      </button>
    </form>
  );
}
