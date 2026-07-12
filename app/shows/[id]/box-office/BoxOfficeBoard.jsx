// @ts-check
'use client';
import { useState, useTransition } from 'react';
import { humanize } from '../../../../lib/userError';
import { formatDollars } from '../../../../lib/formatMoney';
import { clientFetch } from '@/lib/clientFetch';

/** @typedef {import('../../../../lib/boxOfficeRepo').BoxOfficeLine} BoxOfficeLine */
/** @typedef {import('../../../../lib/boxOfficeRepo').BoxOfficeSource} BoxOfficeSource */
/** @typedef {import('../../../../lib/boxOfficeRepo').BoxOfficeSummary} BoxOfficeSummary */
/** @typedef {import('../../../../lib/boxOfficeRepo').BoxOfficeCompleteness} BoxOfficeCompleteness */

const SOURCES = /** @type {{ k: BoxOfficeSource, l: string }[]} */ ([
  { k: 'walkup', l: 'Walk-up' },
  { k: 'dice', l: 'DICE' },
  { k: 'comp', l: 'Comp' },
  { k: 'will_call', l: 'Will call' },
  { k: 'guestlist', l: 'Guest list' },
]);

const initialForm = {
  source: 'walkup',
  ticket_class: '',
  qty: '1',
  face_price: '',
  fees: '',
  external_ref: '',
  notes: '',
};

/**
 * @param {{
 *   showId: number,
 *   locationId: string,
 *   initialLines: BoxOfficeLine[],
 *   summary: BoxOfficeSummary,
 *   completeness: BoxOfficeCompleteness,
 * }} props
 */
export default function BoxOfficeBoard({
  showId,
  locationId,
  initialLines,
  summary,
  completeness,
}) {
  const [lines, setLines] = useState(initialLines ?? []);
  const [totals, setTotals] = useState(summary);
  const [score, setScore] = useState(completeness?.score ?? 0);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [busy, startTransition] = useTransition();

  const refresh = async () => {
    const url = `/api/shows/${showId}/box-office${locationId !== 'default' ? `?location=${locationId}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    setLines(data.lines ?? []);
    setTotals(data.summary);
    setScore(data.completeness?.score ?? 0);
  };

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const submit = (e) => {
    e.preventDefault();
    setError(null);
    const qty = Number(form.qty);
    if (!Number.isInteger(qty) || qty <= 0) {
      setError('qty must be a positive integer');
      return;
    }
    const payload = {
      source: form.source,
      ticket_class: form.ticket_class || null,
      qty,
      face_price: form.face_price === '' ? null : Number(form.face_price),
      fees: form.fees === '' ? null : Number(form.fees),
      external_ref: form.source === 'dice' && form.external_ref
        ? form.external_ref
        : null,
      notes: form.notes || null,
      location_id: locationId,
    };
    startTransition(async () => {
      try {
        const res = await clientFetch(`/api/shows/${showId}/box-office`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          idempotent: true,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        setForm(initialForm);
        await refresh();
      } catch (err) {
        console.error('BoxOfficeBoard add line failed:', err);
        setError(humanize(err));
      }
    });
  };

  /** @param {number} lineId */
  const scan = (lineId) => {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/shows/${showId}/box-office/${lineId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'mark_scanned', location_id: locationId }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        await refresh();
      } catch (err) {
        console.error('BoxOfficeBoard scan failed:', err);
        setError(humanize(err));
      }
    });
  };

  return (
    <section style={{ display: 'grid', gap: 18 }}>
      <div className="card" style={{ padding: 16 }}>
        <div className="row-meta" style={{ marginBottom: 8 }}>
          Completeness · {(score * 100).toFixed(0)}% · {totals?.total_qty ?? 0} tickets ·{' '}
          {formatDollars(totals?.total_revenue ?? 0)} face · {totals?.scanned_qty ?? 0} scanned
        </div>
        <table className="table" style={{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th align="left">Source</th>
              <th align="right">Qty</th>
              <th align="right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((s) => {
              const bucket = totals?.by_source?.[s.k];
              return (
                <tr key={s.k}>
                  <td>{s.l}</td>
                  <td align="right">{bucket?.qty ?? 0}</td>
                  <td align="right">{formatDollars(bucket?.revenue ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form className="card" style={{ padding: 16, display: 'grid', gap: 10 }} onSubmit={submit}>
        <div className="row-meta">Add a ticket line</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          <label>
            <div className="row-meta">Source</div>
            <select
              className="input"
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            >
              {SOURCES.map((s) => (
                <option key={s.k} value={s.k}>
                  {s.l}
                </option>
              ))}
            </select>
          </label>
          <label>
            <div className="row-meta">Class</div>
            <input
              className="input"
              type="text"
              placeholder="GA / VIP"
              value={form.ticket_class}
              onChange={(e) => setForm({ ...form, ticket_class: e.target.value })}
            />
          </label>
          <label>
            <div className="row-meta">Qty</div>
            <input
              className="input"
              type="number"
              min="1"
              value={form.qty}
              onChange={(e) => setForm({ ...form, qty: e.target.value })}
            />
          </label>
          <label>
            <div className="row-meta">Face price ($)</div>
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.face_price}
              onChange={(e) => setForm({ ...form, face_price: e.target.value })}
            />
          </label>
          <label>
            <div className="row-meta">Fees ($)</div>
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.fees}
              onChange={(e) => setForm({ ...form, fees: e.target.value })}
            />
          </label>
          {form.source === 'dice' && (
            <label>
              <div className="row-meta">DICE order ID</div>
              <input
                className="input"
                type="text"
                value={form.external_ref}
                onChange={(e) => setForm({ ...form, external_ref: e.target.value })}
              />
            </label>
          )}
        </div>
        <label>
          <div className="row-meta">Notes</div>
          <textarea
            className="input"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Add line'}
          </button>
          {error && <span style={{ color: 'var(--red, #c00)' }}>Error: {error}</span>}
        </div>
      </form>

      <div className="card" style={{ padding: 16 }}>
        <div className="row-meta" style={{ marginBottom: 8 }}>
          Lines ({lines.length})
        </div>
        {lines.length === 0 ? (
          <div className="row-meta">No lines yet.</div>
        ) : (
          <table className="table" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th align="left">Source</th>
                <th align="left">Class</th>
                <th align="right">Qty</th>
                <th align="right">Face</th>
                <th align="left">Ref</th>
                <th align="left">Scanned</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.source}</td>
                  <td>{l.ticket_class ?? '—'}</td>
                  <td align="right">{l.qty}</td>
                  <td align="right">{formatDollars(l.face_price)}</td>
                  <td>{l.external_ref ?? '—'}</td>
                  <td>{l.scanned_at ? '✓' : '—'}</td>
                  <td>
                    {!l.scanned_at && (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => scan(l.id)}
                        disabled={busy}
                      >
                        Mark scanned
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
