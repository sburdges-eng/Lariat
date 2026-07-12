// @ts-check
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
import { useT } from '../../_components/I18nProvider.jsx';
import { clientFetch } from '../../../lib/clientFetch';

const KNOWN_STATIONS = ['grill', 'sides', 'bar'];

/**
 * @typedef {{
 *   item_name: string,
 *   quantity: number | string,
 *   station: string,
 *   modifiers: string,
 * }} DraftLine
 */

/** @returns {DraftLine} */
const BLANK_LINE = () => ({ item_name: '', quantity: 1, station: 'grill', modifiers: '' });

export default function PunchTicketPage() {
  const tt = useT();
  const { locationId } = useLocation();
  const [orderNumber, setOrderNumber] = useState('');
  const [destination, setDestination] = useState('');
  const [lines, setLines] = useState(/** @returns {DraftLine[]} */ () => [BLANK_LINE()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [ok, setOk] = useState(/** @type {string | null} */ (null));

  /**
   * @param {number} idx
   * @param {Partial<DraftLine>} patch
   */
  function updateLine(idx, patch) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, BLANK_LINE()]);
  }
  /** @param {number} idx */
  function removeLine(idx) {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  }

  /** @param {React.FormEvent<HTMLFormElement>} e */
  async function send(e) {
    e.preventDefault();
    setError(null);
    setOk(null);

    if (!orderNumber.trim()) {
      setError(tt('punch.orderNeeded'));
      return;
    }
    if (lines.length === 0 || !lines.some((l) => l.item_name.trim())) {
      setError(tt('punch.addOneItem'));
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
        setError(data?.error || tt('punch.sendFailed'));
        return;
      }
      setOk(tt('punch.sent', { order: orderNumber.trim() }));
      setOrderNumber('');
      setDestination('');
      setLines([BLANK_LINE()]);
    } catch {
      setError(tt('punch.noConnection'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>{tt('punch.title')}</h1>
      <p style={{ fontSize: 13, color: 'var(--muted, #888)', marginTop: 0 }}>
        {tt('punch.subtitle')}
      </p>

      <form onSubmit={send} style={{ marginTop: 16 }}>
        <fieldset disabled={busy} style={{ border: 'none', padding: 0, margin: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{tt('punch.orderLabel')}</span>
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
              <span style={{ fontSize: 13, fontWeight: 600 }}>{tt('punch.destinationLabel')}</span>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                style={inputStyle}
                placeholder="T12, Bar, Togo"
              />
            </label>
          </div>

          <h2 style={{ fontSize: 16, marginBottom: 8 }}>{tt('punch.itemsHead')}</h2>
          {lines.map((line, idx) => (
            <div
              key={idx}
              style={{
                display: 'grid',
                gridTemplateColumns: lines.length > 1 ? '2fr 80px 110px 2fr 32px' : '2fr 80px 110px 2fr',
                gap: 8,
                alignItems: 'end',
                marginBottom: 8,
              }}
            >
              <label style={fieldStyle}>
                {idx === 0 && <span style={labelStyle}>{tt('punch.itemLabel')}</span>}
                <input
                  type="text"
                  value={line.item_name}
                  onChange={(e) => updateLine(idx, { item_name: e.target.value })}
                  style={inputStyle}
                  placeholder="Smoked brisket"
                />
              </label>
              <label style={fieldStyle}>
                {idx === 0 && <span style={labelStyle}>{tt('punch.qtyLabel')}</span>}
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
                {idx === 0 && <span style={labelStyle}>{tt('punch.stationLabel')}</span>}
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
                {idx === 0 && <span style={labelStyle}>{tt('punch.modsLabel')}</span>}
                <input
                  type="text"
                  value={line.modifiers}
                  onChange={(e) => updateLine(idx, { modifiers: e.target.value })}
                  style={inputStyle}
                  placeholder="no pickle; sub fries"
                />
              </label>
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLine(idx)}
                  aria-label={tt('punch.removeLine')}
                  style={{
                    height: 36,
                    border: '1px solid var(--border, #ccc)',
                    background: 'transparent',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >×</button>
              )}
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
          >{tt('punch.addItem')}</button>

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
              {busy ? tt('punch.sending') : tt('punch.sendToLine')}
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
/** @type {React.CSSProperties} */
const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 4 };
const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--muted, #555)' };
