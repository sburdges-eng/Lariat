// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

// Punch a ticket for the line.
//
// FOH/expo types in an order; lines write to kds_tickets / kds_ticket_lines;
// the iPad-mounted KDS polls /api/kds/tickets and shows it. Used until Toast
// Partner ingest lands (the SWAP POINT in app/api/kds/tickets/route.js).
//
// UI copy follows docs/UI_COPY_RULES.md — kitchen verbs, short labels, no
// SaaS jargon. The button reads "Send to line" not "Submit"; the helper text
// reads "What table or window?" not "Destination (optional)".

import { useState } from 'react';
import { useLocation } from '../../_components/useLocation';
import { clientFetch } from '../../../lib/clientFetch';

const KNOWN_STATIONS = ['grill', 'sides', 'bar'];
const BLANK_LINE = () => ({ item_name: '', quantity: 1, station: 'grill', modifiers: '' });

export default function PunchTicketPage() {
  const { locationId } = useLocation();
  const [orderNumber, setOrderNumber] = useState('');
  const [destination, setDestination] = useState('');
  const [lines, setLines] = useState(() => [BLANK_LINE()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  function updateLine(idx, patch) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, BLANK_LINE()]);
  }
  function removeLine(idx) {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  }

  async function send(e) {
    e.preventDefault();
    setError(null);
    setOk(null);

    if (!orderNumber.trim()) {
      setError('Order number needed');
      return;
    }
    if (lines.length === 0 || !lines.some((l) => l.item_name.trim())) {
      setError('Add at least one item');
      return;
    }

    setBusy(true);
    try {
      const body = {
        order_number: orderNumber.trim(),
        destination: destination.trim() || undefined,
        location_id: locationId,
        lines: lines
          .filter((l) => l.item_name.trim())
          .map((l) => ({
            item_name: l.item_name.trim(),
            quantity: Number(l.quantity) || 1,
            station: l.station,
            modifiers: l.modifiers.trim() || undefined,
          })),
      };
      const res = await clientFetch('/api/kds/tickets', {
        method: 'POST',
        idempotent: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Couldn't send — try again");
        return;
      }
      setOk(`Sent #${orderNumber.trim()} to the line`);
      setOrderNumber('');
      setDestination('');
      setLines([BLANK_LINE()]);
    } catch {
      setError("Couldn't reach the line — check connection");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Punch a ticket</h1>
      <p style={{ fontSize: 13, color: 'var(--muted, #888)', marginTop: 0 }}>
        Type the order, send it to the line. The kitchen iPad picks it up.
      </p>

      <form onSubmit={send} style={{ marginTop: 16 }}>
        <fieldset disabled={busy} style={{ border: 'none', padding: 0, margin: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Order #</span>
              <input
                type="text"
                inputMode="numeric"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                autoFocus
                style={inputStyle}
                placeholder="1042"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Table or window</span>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                style={inputStyle}
                placeholder="T12, Bar, Togo"
              />
            </label>
          </div>

          <h2 style={{ fontSize: 16, marginBottom: 8 }}>Items</h2>
          {lines.map((line, idx) => (
            <div
              key={idx}
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 80px 110px 2fr 32px',
                gap: 8,
                alignItems: 'end',
                marginBottom: 8,
              }}
            >
              <label style={fieldStyle}>
                {idx === 0 && <span style={labelStyle}>Item</span>}
                <input
                  type="text"
                  value={line.item_name}
                  onChange={(e) => updateLine(idx, { item_name: e.target.value })}
                  style={inputStyle}
                  placeholder="Smoked brisket"
                />
              </label>
              <label style={fieldStyle}>
                {idx === 0 && <span style={labelStyle}>Qty</span>}
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={line.quantity}
                  onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                  style={inputStyle}
                />
              </label>
              <label style={fieldStyle}>
                {idx === 0 && <span style={labelStyle}>Station</span>}
                <select
                  value={line.station}
                  onChange={(e) => updateLine(idx, { station: e.target.value })}
                  style={inputStyle}
                >
                  {KNOWN_STATIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label style={fieldStyle}>
                {idx === 0 && <span style={labelStyle}>Mods</span>}
                <input
                  type="text"
                  value={line.modifiers}
                  onChange={(e) => updateLine(idx, { modifiers: e.target.value })}
                  style={inputStyle}
                  placeholder="no pickle; sub fries"
                />
              </label>
              <button
                type="button"
                onClick={() => removeLine(idx)}
                disabled={lines.length === 1}
                aria-label="Remove line"
                style={{
                  height: 36,
                  border: '1px solid var(--border, #ccc)',
                  background: 'transparent',
                  borderRadius: 6,
                  cursor: lines.length === 1 ? 'not-allowed' : 'pointer',
                  opacity: lines.length === 1 ? 0.4 : 1,
                }}
              >×</button>
            </div>
          ))}

          <button
            type="button"
            onClick={addLine}
            style={{
              marginTop: 4,
              padding: '8px 12px',
              border: '1px dashed var(--border, #888)',
              background: 'transparent',
              borderRadius: 6,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >+ Add item</button>

          <div style={{ marginTop: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              type="submit"
              style={{
                padding: '12px 20px',
                fontSize: 16,
                fontWeight: 600,
                background: 'var(--accent, #2b6cb0)',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              {busy ? 'Sending…' : 'Send to line'}
            </button>
            {error && <span style={{ color: 'var(--red, #ef4444)', fontSize: 13 }}>{error}</span>}
            {ok && <span style={{ color: 'var(--green, #16a34a)', fontSize: 13 }}>{ok}</span>}
          </div>
        </fieldset>
      </form>
    </main>
  );
}

const inputStyle = {
  padding: '8px 10px',
  fontSize: 14,
  border: '1px solid var(--border, #ccc)',
  borderRadius: 6,
  background: 'var(--input-bg, white)',
  color: 'var(--input-fg, #111)',
};
const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 4 };
const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--muted, #555)' };
