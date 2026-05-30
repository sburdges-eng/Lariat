// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export default function LoginPinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only accept a same-origin path: must start with `/`, reject protocol-relative (`//`)
  // and backslash tricks (`/\`) that some browsers/proxies treat as host-switching.
  const rawNext = searchParams.get('next') || '';
  const setupRequired = searchParams.get('setup') === '1';
  const safeNext =
    rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.startsWith('/\\')
      ? rawNext
      : '/analytics';
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
      setErr('Wrong PIN');
      return;
    }
    router.push(safeNext);
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="card">
      <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>Manager PIN</label>
      <input
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
