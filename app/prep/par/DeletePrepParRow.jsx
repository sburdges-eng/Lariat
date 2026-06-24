// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DeletePrepParRow({ id, label, locationId = 'default' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cookId, setCookId] = useState('');

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  const remove = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/prep-par?id=${id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cook_id: cookId, location_id: locationId }),
      });
      if (!res.ok) {
        setBusy(false);
        setConfirming(false);
        return;
      }
      router.refresh();
    } catch {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (!confirming) {
    return (
      <button
        type="button"
        className="btn"
        onClick={() => setConfirming(true)}
        aria-label={`Remove ${label} from prep par`}
        style={{ fontSize: 12, padding: '4px 10px' }}
      >
        Remove
      </button>
    );
  }

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button
        type="button"
        className="btn"
        onClick={remove}
        disabled={busy}
        aria-label={`Confirm remove ${label}`}
        style={{ fontSize: 12, padding: '4px 10px', background: 'var(--red, #b3261e)', color: '#fff' }}
      >
        {busy ? '…' : 'Confirm'}
      </button>
      <button
        type="button"
        className="btn"
        onClick={() => setConfirming(false)}
        disabled={busy}
        style={{ fontSize: 12, padding: '4px 10px' }}
      >
        Cancel
      </button>
    </span>
  );
}
