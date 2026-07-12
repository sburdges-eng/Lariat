// @ts-check
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

  /** @param {React.FormEvent<HTMLFormElement>} e */
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
      // Map status → plain copy (docs/UI_COPY_RULES.md: no dev jargon
      // on cook-facing screens; the 500 body names LARIAT_PIN_SECRET).
      // Raw server detail goes to the console for ops, never the form.
      if (res.status !== 401) {
        const body = await res.json().catch(() => null);
        if (body && typeof body.error === 'string' && body.error) {
          console.error('PIN sign-in failed:', res.status, body.error);
        }
      }
      setErr(
        res.status === 401 ? 'Wrong PIN'
          : res.status === 429 ? 'Too many attempts. Wait a minute and try again.'
            : 'PIN sign-in is not working. Ask the owner to check setup.',
      );
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
