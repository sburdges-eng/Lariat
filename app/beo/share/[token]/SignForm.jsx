'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SignForm({ token }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const canSubmit = name.trim().length > 0 && agreed && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(`/api/beo/share/${encodeURIComponent(token)}/sign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signed_name: name.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Could not record signature — please try again.');
        setBusy(false);
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setErr('Network error — please try again.');
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div
        style={{
          padding: '16px 20px',
          background: '#f4f9f4',
          border: '1px solid #cfe2cf',
          borderRadius: 6,
          fontSize: 14,
        }}
      >
        Thank you, <strong>{name.trim()}</strong>. Your signature has been recorded.
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 12, maxWidth: 480 }}>
      <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
        <span style={{ color: '#444' }}>Full name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          required
          autoComplete="name"
          style={{
            padding: '8px 10px',
            fontSize: 16,
            fontFamily: 'inherit',
            border: '1px solid #888',
            borderRadius: 4,
          }}
        />
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>I confirm the event details above are correct and authorize this banquet event order.</span>
      </label>
      {err ? <div style={{ color: '#b00', fontSize: 13 }}>{err}</div> : null}
      <button
        type="submit"
        disabled={!canSubmit}
        style={{
          justifySelf: 'start',
          padding: '10px 22px',
          fontSize: 15,
          fontFamily: 'inherit',
          background: canSubmit ? '#1a1a1a' : '#aaa',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }}
      >
        {busy ? 'Signing…' : 'Sign and confirm'}
      </button>
    </form>
  );
}
