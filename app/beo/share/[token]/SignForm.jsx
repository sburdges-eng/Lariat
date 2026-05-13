// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const SANS = 'var(--sans, "Inter Tight", system-ui, sans-serif)';

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
          padding: '18px 22px',
          background: 'var(--cream, #f8f3e7)',
          border: '1px solid var(--sage, #5d7a66)',
          borderLeft: '4px solid var(--sage, #5d7a66)',
          borderRadius: 4,
          fontSize: 14,
          color: 'var(--ink, #1d1a15)',
          fontFamily: SANS,
        }}
      >
        Thank you, <strong style={{ fontWeight: 600 }}>{name.trim()}</strong>. Your signature has been recorded.
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      style={{ display: 'grid', gap: 14, maxWidth: 480, fontFamily: SANS }}
    >
      <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
        <span
          style={{
            color: 'var(--char, #3a3530)',
            fontFamily: 'var(--mono, "JetBrains Mono", ui-monospace, monospace)',
            fontSize: 10,
            letterSpacing: '0.24em',
            textTransform: 'uppercase',
            fontWeight: 700,
          }}
        >
          Full name
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          required
          autoComplete="name"
          style={{
            padding: '10px 12px',
            fontSize: 16,
            fontFamily: SANS,
            background: 'var(--cream, #f8f3e7)',
            color: 'var(--ink, #1d1a15)',
            border: '1px solid var(--hair, #c9bda5)',
            borderRadius: 3,
            outline: 'none',
          }}
        />
      </label>
      <label
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
          fontSize: 13,
          color: 'var(--ink, #1d1a15)',
          lineHeight: 1.45,
        }}
      >
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          style={{ marginTop: 3, accentColor: 'var(--ember-deep, #9a3f1a)' }}
        />
        <span>
          I confirm the event details above are correct and authorize this banquet event order.
        </span>
      </label>
      {err ? (
        <div
          style={{
            color: 'var(--rust, #8b2e1f)',
            fontSize: 13,
            paddingLeft: 10,
            borderLeft: '2px solid var(--rust, #8b2e1f)',
          }}
        >
          {err}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={!canSubmit}
        style={{
          justifySelf: 'start',
          padding: '11px 24px',
          fontSize: 11.5,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          fontWeight: 700,
          fontFamily: SANS,
          background: canSubmit ? 'var(--ember, #c85a2a)' : 'var(--hair, #c9bda5)',
          color: canSubmit ? '#1a1308' : 'var(--muted-2, #9c9282)',
          border: `1px solid ${canSubmit ? 'var(--ember, #c85a2a)' : 'var(--hair, #c9bda5)'}`,
          borderRadius: 3,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        {busy ? 'Signing…' : 'Sign and confirm'}
      </button>
    </form>
  );
}
