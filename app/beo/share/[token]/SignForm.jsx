// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const SANS = 'var(--sans, "Inter Tight", system-ui, sans-serif)';

/** @param {{ token: string }} props */
export default function SignForm({ token }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const canSubmit = name.trim().length > 0 && agreed && !busy;

  /** @param {React.FormEvent<HTMLFormElement>} e */
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
          background: 'var(--panel, #f8f3e7)',
          border: '1px solid var(--ok, #5d7a66)',
          borderLeft: '4px solid var(--ok, #5d7a66)',
          borderRadius: 4,
          fontSize: 14,
          color: 'var(--text, #17140f)',
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
            color: 'var(--text-muted, #6f6555)',
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
            background: 'var(--panel, #f8f3e7)',
            color: 'var(--text, #17140f)',
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
          color: 'var(--text, #17140f)',
          lineHeight: 1.45,
        }}
      >
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          style={{ marginTop: 3, accentColor: 'var(--accent, #c85a2a)' }}
        />
        <span>
          I confirm the event details above are correct and authorize this banquet event order.
        </span>
      </label>
      {err ? (
        <div
          style={{
            color: 'var(--fire, #8b2e1f)',
            fontSize: 13,
            paddingLeft: 10,
            borderLeft: '2px solid var(--fire, #8b2e1f)',
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
          background: canSubmit ? 'var(--accent, #c85a2a)' : 'var(--hair, #c9bda5)',
          color: canSubmit ? 'var(--on-accent, #1a1308)' : 'var(--text-muted, #6f6555)',
          border: `1px solid ${canSubmit ? 'var(--accent, #c85a2a)' : 'var(--hair, #c9bda5)'}`,
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
