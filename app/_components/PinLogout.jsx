'use client';

import { useEffect, useState } from 'react';

export default function PinLogout() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    fetch('/api/auth/pin')
      .then((r) => r.json())
      .then((d) => setEnabled(!!d.pin_enabled))
      .catch(() => setEnabled(false));
  }, []);

  if (!enabled) return null;

  return (
    <button
      type="button"
      onClick={() =>
        fetch('/api/auth/pin', { method: 'DELETE' }).then(() => {
          window.location.href = '/';
        })
      }
      style={{
        marginTop: 8,
        width: '100%',
        padding: '8px 10px',
        fontSize: 12,
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 8,
        color: 'var(--muted)',
        cursor: 'pointer',
      }}
    >
      Sign out (sensitive pages)
    </button>
  );
}
