// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import LariAmbient from '../_components/LariAmbient';

const POLL_MS = 30_000;

function fmtMinutes(iso) {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return `${Math.max(0, Math.floor(ms / 60_000))} min`;
}

function fmtClock(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function HostStand({ initialParties, initialSummary, locationId }) {
  const [parties, setParties] = useState(initialParties || []);
  const [summary, setSummary] = useState(initialSummary || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const [partyName, setPartyName] = useState('');
  const [partySize, setPartySize] = useState('');
  const [partyPhone, setPartyPhone] = useState('');
  const [partyNotes, setPartyNotes] = useState('');

  const refresh = useCallback(async () => {
    try {
      const u = new URLSearchParams({ location: locationId });
      const res = await fetch(`/api/host/waitlist?${u.toString()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const j = await res.json();
      if (Array.isArray(j.parties)) setParties(j.parties);
      if (j.summary) setSummary(j.summary);
    } catch {
      /* silent — strip handles "no answer" gracefully */
    }
  }, [locationId]);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const addParty = async (e) => {
    e.preventDefault();
    if (!partyName.trim() || !partySize) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/host/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          party_name: partyName.trim(),
          party_size: Number(partySize),
          phone: partyPhone.trim() || undefined,
          notes: partyNotes.trim() || undefined,
          location_id: locationId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Could not add party — please try again.');
        return;
      }
      setPartyName('');
      setPartySize('');
      setPartyPhone('');
      setPartyNotes('');
      await refresh();
    } catch {
      setErr('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const transitionParty = async (id, next) => {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(`/api/host/waitlist/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || `Could not ${next === 'seated' ? 'seat' : 'remove'} party.`);
        return;
      }
      await refresh();
    } catch {
      setErr('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const waiting = useMemo(() => parties.filter((p) => p.status === 'waiting'), [parties]);
  const seatedToday = useMemo(() => parties.filter((p) => p.status === 'seated'), [parties]);

  return (
    <div className="beo-page">
      <div className="flex-between mb-20">
        <div>
          <h1>Host Stand</h1>
          <p className="subtitle">Active waitlist + tonight's seated parties.</p>
        </div>
        {summary ? (
          <div className="row-meta">
            {summary.waiting} waiting · {summary.seated_today} seated today
            {summary.avg_wait_minutes != null
              ? ` · avg ${summary.avg_wait_minutes} min`
              : ''}
          </div>
        ) : null}
      </div>

      <LariAmbient surface="host" location={locationId} />

      {err && <div className="card border-red mb-20 text-red">{err}</div>}

      <details className="beo-add-party" open={waiting.length === 0}>
        <summary>+ Add waiting party</summary>
        <form onSubmit={addParty} className="form-row mt-12" style={{ gap: 8 }}>
          <div className="field-name" style={{ flex: 1, minWidth: 180 }}>
            <label className="label">Party name</label>
            <input
              className="input form-field"
              value={partyName}
              onChange={(e) => setPartyName(e.target.value)}
              placeholder="e.g. Hendricks 4-top"
              maxLength={80}
              required
            />
          </div>
          <div style={{ width: 90 }}>
            <label className="label">Size</label>
            <input
              className="input form-field"
              type="number"
              min="1"
              max="200"
              value={partySize}
              onChange={(e) => setPartySize(e.target.value)}
              required
            />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label className="label">Phone</label>
            <input
              className="input form-field"
              value={partyPhone}
              onChange={(e) => setPartyPhone(e.target.value)}
              placeholder="optional"
              maxLength={32}
            />
          </div>
          <div style={{ flex: 2, minWidth: 200 }}>
            <label className="label">Notes</label>
            <input
              className="input form-field"
              value={partyNotes}
              onChange={(e) => setPartyNotes(e.target.value)}
              placeholder="allergies, requests…"
              maxLength={500}
            />
          </div>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Adding…' : 'Add party'}
          </button>
        </form>
      </details>

      <section className="card" style={{ padding: 18, marginTop: 16 }}>
        <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 20 }}>
          Waiting ({waiting.length})
        </h2>
        {waiting.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>
            No parties waiting right now.
          </p>
        ) : (
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Party</th>
                <th style={{ width: 60 }}>Size</th>
                <th style={{ width: 100 }}>Joined</th>
                <th style={{ width: 100 }}>Waiting</th>
                <th style={{ textAlign: 'left' }}>Notes</th>
                <th style={{ width: 200 }}></th>
              </tr>
            </thead>
            <tbody>
              {waiting.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.party_name}</strong>
                    {p.phone ? (
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.phone}</div>
                    ) : null}
                  </td>
                  <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{p.party_size}</td>
                  <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                    {fmtClock(p.joined_at)}
                  </td>
                  <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                    {fmtMinutes(p.joined_at)}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{p.notes || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn sm primary"
                      onClick={() => transitionParty(p.id, 'seated')}
                      disabled={busy}
                    >
                      Seat
                    </button>{' '}
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => transitionParty(p.id, 'left')}
                      disabled={busy}
                    >
                      Left
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {seatedToday.length > 0 ? (
        <section className="card" style={{ padding: 18, marginTop: 16 }}>
          <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 16, color: 'var(--muted)' }}>
            Seated today ({seatedToday.length})
          </h2>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Party</th>
                <th style={{ width: 60 }}>Size</th>
                <th style={{ width: 110 }}>Seated</th>
                <th style={{ width: 110 }}>Wait</th>
              </tr>
            </thead>
            <tbody>
              {seatedToday.map((p) => (
                <tr key={p.id}>
                  <td>{p.party_name}</td>
                  <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{p.party_size}</td>
                  <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                    {fmtClock(p.seated_at)}
                  </td>
                  <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                    {p.seated_at && p.joined_at
                      ? `${Math.max(
                          0,
                          Math.floor(
                            (Date.parse(p.seated_at) - Date.parse(p.joined_at)) / 60_000,
                          ),
                        )} min`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
