'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function StartCountButton({ locationId = 'default' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [cookId, setCookId] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/inventory/counts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: label.trim() || null,
          cook_id: cookId,
          location_id: locationId,
        }),
      });
      if (!res.ok) {
        setErr('Could not start. Try again.');
        setBusy(false);
        return;
      }
      const j = await res.json();
      router.push(`/inventory/counts/${j.id}`);
    } catch {
      setErr('Lost connection — not started.');
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={start}
      className="card form-row"
      aria-busy={busy}
      style={{ marginBottom: 20 }}
    >
      <div style={{ flex: '2 1 220px' }}>
        <label className="label" htmlFor="count-label">Label</label>
        <input
          id="count-label"
          name="count-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Weekly walk-in, EOM"
          className="input form-field"
          autoComplete="off"
        />
      </div>
      <button
        type="submit"
        className="btn primary lg"
        disabled={busy}
        aria-label="Start a new count"
      >
        {busy ? 'Starting…' : 'Start a count'}
      </button>
      {err && (
        <div role="alert" aria-live="assertive" style={{ color: 'var(--red)', flexBasis: '100%' }}>
          {err}
        </div>
      )}
    </form>
  );
}
