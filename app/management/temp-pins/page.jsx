// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

import { useEffect, useState } from 'react';

// Temp-PIN management UI (T10).
//
// Per docs/superpowers/specs/2026-05-04-beo-fire-times.md.
// /management/* is gated by middleware so only the master-PIN holder
// reaches this page. Inside the page, every fetch goes to a
// master-PIN-gated API route (POST /issue, GET /list, POST /revoke);
// the route's auth check is the source of truth.
//
// Issuance shows the new PIN ONCE and never re-displays it. If the
// cook loses the PIN, revoke and reissue.

const KNOWN_SCOPES = ['beo.fire_at_edit'];

function localToIso(localValue) {
  // <input type="datetime-local"> gives "YYYY-MM-DDTHH:MM" (no timezone).
  // Treat as local, convert to UTC ISO.
  if (!localValue) return null;
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function defaultExpires() {
  // Default = end of current local day.
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

export default function TempPinsPage() {
  const [active, setActive] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState('');
  const [issued, setIssued] = useState(null); // { id, pin, label, expires_at, scopes }

  // Add-form state
  const [label, setLabel] = useState('');
  const [expires, setExpires] = useState(defaultExpires());
  const [scopes, setScopes] = useState(['beo.fire_at_edit']);

  const load = async () => {
    setErr('');
    try {
      const res = await fetch('/api/auth/temp-pin/list');
      if (!res.ok) {
        setErr('Couldn’t load — refresh the page');
        setLoaded(true);
        return;
      }
      const j = await res.json();
      setActive(Array.isArray(j.pins) ? j.pins : []);
      setLoaded(true);
    } catch {
      setErr('Lost connection');
      setLoaded(true);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const issue = async () => {
    setErr('');
    setIssued(null);
    if (!label.trim()) {
      setErr('Add a name');
      return;
    }
    const expiresIso = localToIso(expires);
    if (!expiresIso) {
      setErr('Pick when this stops working');
      return;
    }
    if (scopes.length === 0) {
      setErr('Pick at least one scope');
      return;
    }
    try {
      const res = await fetch('/api/auth/temp-pin/issue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), expires_at: expiresIso, scopes }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j?.error || 'Didn’t save — try again');
        return;
      }
      setIssued(j);
      setLabel('');
      load();
    } catch {
      setErr('Lost connection — not saved');
    }
  };

  const revoke = async (id) => {
    setErr('');
    if (!confirm('Stop this PIN from working?')) return;
    try {
      const res = await fetch('/api/auth/temp-pin/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        setErr('Didn’t revoke — try again');
        return;
      }
      load();
    } catch {
      setErr('Lost connection — not revoked');
    }
  };

  const toggleScope = (s) =>
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <div className="tp-page" data-testid="temp-pins-page">
      <h1>Temp PINs</h1>
      <p className="tp-help">
        Hand out a 1-shift PIN to a sous chef. The PIN shows once — write it
        down or text it. Use Revoke if it gets lost.
      </p>

      {err && <div className="tp-err" role="alert">{err}</div>}

      {issued && (
        <div className="tp-issued" data-testid="issued-banner" role="status">
          <strong>New PIN:</strong> <code>{issued.pin}</code>
          <small> ({issued.label}, until {issued.expires_at})</small>
          <button type="button" className="btn" onClick={() => setIssued(null)}>
            Got it
          </button>
        </div>
      )}

      <section className="tp-issue">
        <h2>Hand out a PIN</h2>
        <input
          type="text"
          placeholder="Who's it for? (e.g. Sous chef Marco)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-label="PIN label"
        />
        <input
          type="datetime-local"
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
          aria-label="Stops working"
        />
        <div className="tp-scopes" role="group" aria-label="Scopes">
          {KNOWN_SCOPES.map((s) => (
            <label key={s}>
              <input
                type="checkbox"
                checked={scopes.includes(s)}
                onChange={() => toggleScope(s)}
              />
              {s}
            </label>
          ))}
        </div>
        <button type="button" className="btn" onClick={issue}>
          Make PIN
        </button>
      </section>

      <section className="tp-active">
        <h2>Active PINs</h2>
        {loaded && active.length === 0 && <p>None active.</p>}
        <ul>
          {active.map((p) => (
            <li key={p.id} data-testid={`active-pin-${p.id}`}>
              <span className="tp-label">{p.label}</span>
              <span className="tp-scopes-list">{p.scopes.join(', ')}</span>
              <span className="tp-expires">until {p.expires_at}</span>
              <button
                type="button"
                className="btn red"
                onClick={() => revoke(p.id)}
                aria-label={`Revoke ${p.label}`}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
