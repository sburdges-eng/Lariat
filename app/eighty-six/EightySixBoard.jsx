// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const REASONS = ['out','spoiled','dropped','no_make','burned','prep_short','other'];

export default function EightySixBoard({ active, resolved, cascaded = [], stations, date, locationId = 'default' }) {
  const router = useRouter();
  const [cookId, setCookId] = useState('');
  const [item, setItem] = useState('');
  const [stationId, setStationId] = useState('');
  const [reason, setReason] = useState('out');
  const [quantity, setQuantity] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  // Per-row in-flight guard so a double-tap on the greasy tablet screen
  // can't fire two POSTs to /api/eighty-six/resolve for the same row.
  const resolvingRef = useRef(new Set());
  // Same guard for the add form — `saving` disables the button only after
  // the re-render, so a fast double-tap can still fire two POSTs without this.
  const addingRef = useRef(false);
  // Cascade row awaiting inline confirmation (replaces window.confirm).
  const [confirmSlug, setConfirmSlug] = useState(null);

  useEffect(() => { setCookId(window.localStorage.getItem('lariat_cook') || ''); }, []);

  const add = async (e) => {
    e.preventDefault();
    if (!item.trim()) return;
    if (addingRef.current) return;
    addingRef.current = true;
    setSaving(true);
    setErr('');
    let ok = false;
    try {
      const res = await fetch('/api/eighty-six', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shift_date: date,
          station_id: stationId || null,
          item: item.trim(),
          reason,
          quantity,
          cook_id: cookId,
          location_id: locationId,
        }),
      });
      ok = res.ok;
      if (!ok) setErr('Didn\u2019t save \u2014 try again');
    } catch {
      setErr('Lost connection \u2014 not saved');
    }
    addingRef.current = false;
    setSaving(false);
    if (!ok) return;
    setItem(''); setQuantity('');
    router.refresh();
  };

  const resolve = async (id) => {
    if (resolvingRef.current.has(id)) return;
    resolvingRef.current.add(id);
    setErr('');
    try {
      const res = await fetch('/api/eighty-six/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, cook_id: cookId, location_id: locationId }),
      });
      if (!res.ok) {
        setErr('Didn’t save — try again');
        return;
      }
    } catch {
      setErr('Lost connection — not saved');
      return;
    } finally {
      resolvingRef.current.delete(id);
    }
    router.refresh();
  };

  const confirmCascade = async (c) => {
    setConfirmSlug(null);
    setErr('');
    setSaving(true);
    try {
      const res = await fetch('/api/eighty-six', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shift_date: date,
          station_id: null,
          item: c.name,
          reason: 'prep_short',
          quantity: '',
          cook_id: cookId,
          location_id: locationId,
          note: `uses ${c.via}`,
        }),
      });
      if (!res.ok) setErr('Didn\u2019t save \u2014 try again');
    } catch {
      setErr('Lost connection \u2014 not saved');
    }
    setSaving(false);
    router.refresh();
  };

  const itemValid = item.trim().length > 0;

  return (
    <div>
      <h1>86 Board</h1>
      <p className="subtitle">{active.length} item{active.length === 1 ? '' : 's'} out. Mark it back when you&apos;ve got it.</p>

      <form onSubmit={add} className="card form-row" aria-describedby={err ? 'e86-err' : undefined}>
        <div style={{ flex: '2 1 240px' }}>
          <label className="label" htmlFor="e86-item">Item</label>
          <input
            id="e86-item"
            name="e86-item"
            value={item}
            onChange={e => setItem(e.target.value)}
            placeholder="e.g. Pork Chop, House Salad, Aji Verde"
            className="input form-field"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="send"
            aria-required="true"
            aria-invalid={err && !itemValid ? 'true' : undefined}
          />
        </div>
        <div style={{ flex:'1 1 140px' }}>
          <label className="label" htmlFor="e86-station">Station</label>
          <select
            id="e86-station"
            name="e86-station"
            value={stationId}
            onChange={e => setStationId(e.target.value)}
            className="input form-field"
          >
            <option value="">— any —</option>
            {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ flex:'1 1 120px' }}>
          <label className="label" htmlFor="e86-reason">Reason</label>
          <select
            id="e86-reason"
            name="e86-reason"
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="input form-field"
          >
            {REASONS.map(r => (
              <option key={r} value={r}>
                {r.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex:'0 1 100px' }}>
          <label className="label" htmlFor="e86-qty">Qty</label>
          <input
            id="e86-qty"
            name="e86-qty"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            placeholder="opt."
            className="input form-field"
            inputMode="numeric"
            autoComplete="off"
          />
        </div>
        <button
          type="submit"
          className="btn red lg"
          disabled={saving || !itemValid}
          aria-label={saving ? 'Saving…' : `Mark ${item.trim() || 'item'} as 86'd`}
        >
          {saving ? 'Saving…' : '86 it'}
        </button>
      </form>

      {err && (
        <div
          id="e86-err"
          role="alert"
          aria-live="assertive"
          style={{
            marginTop: 10,
            padding: '10px 14px',
            background: 'rgba(139,46,31,0.08)',
            border: '1px solid var(--red)',
            borderRadius: 6,
            color: 'var(--red)',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {err}
        </div>
      )}

      {active.length === 0 ? (
        <div className="empty" role="status" aria-live="polite">No 86s right now. ✓</div>
      ) : (
        <ul className="checklist" aria-label="Currently 86'd items" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {active.map(e => (
            <li key={e.id} className="check-row fail">
              <div>
                <div className="check-name">{e.item}</div>
                <div className="meta">
                  {e.station_id && <>{e.station_id} · </>}
                  {e.reason && <>{String(e.reason).replace('_',' ')} · </>}
                  {e.quantity && <>{e.quantity} · </>}
                  <time dateTime={e.created_at}>{fmtTime(e.created_at)}</time>
                  {e.cook_id && <> · {e.cook_id}</>}
                </div>
              </div>
              <span aria-hidden /><span aria-hidden /><span aria-hidden />
              <button
                className="btn green"
                onClick={() => resolve(e.id)}
                aria-label={`Mark ${e.item} as back in stock`}
              >
                Resolve
              </button>
            </li>
          ))}
        </ul>
      )}

      {cascaded.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div className="section-head">Might also be out</div>
          <div className="meta" style={{ marginBottom: 8 }}>
            These use something you just 86&apos;d. Already-prepped ones
            may still be fine — check and mark any you&apos;re out of.
          </div>
          <div className="checklist" style={{ marginTop: 12 }}>
            {cascaded.map(c => (
              <div key={c.slug} className="check-row">
                <div>
                  <div className="check-name">{c.name}</div>
                  <div className="meta">
                    uses {c.via}
                    {confirmSlug === c.slug && <> — prepped batches may still be fine</>}
                  </div>
                </div>
                {confirmSlug === c.slug ? (
                  <>
                    <span aria-hidden /><span aria-hidden />
                    <button
                      className="btn"
                      onClick={() => setConfirmSlug(null)}
                      aria-label={`Keep ${c.name} on the menu`}
                    >
                      Keep it
                    </button>
                    <button
                      className="btn red"
                      disabled={saving}
                      onClick={() => confirmCascade(c)}
                      aria-label={`Confirm 86 for ${c.name}`}
                    >
                      Yes — 86 it
                    </button>
                  </>
                ) : (
                  <>
                    <span aria-hidden /><span aria-hidden /><span aria-hidden />
                    <button
                      className="btn red"
                      disabled={saving}
                      onClick={() => setConfirmSlug(c.slug)}
                      aria-expanded={false}
                      aria-label={`Mark ${c.name} out too`}
                    >
                      Mark out too
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {resolved.length > 0 && (
        <details style={{ marginTop: 32 }}>
          <summary className="section-head" style={{ cursor:'pointer' }}>
            Resolved today ({resolved.length})
          </summary>
          <div className="checklist" style={{ marginTop: 12 }}>
            {resolved.map(e => (
              <div key={e.id} className="check-row resolved">
                <div>
                  <div className="check-name">{e.item}</div>
                  <div className="meta">
                    {e.reason && <>{String(e.reason).replace('_',' ')} · </>}
                    86&apos;d {fmtTime(e.created_at)} → resolved {fmtTime(e.resolved_at)}
                  </div>
                </div>
                <span aria-hidden /><span aria-hidden /><span aria-hidden /><span aria-hidden />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function fmtTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso.replace(' ', 'T') + 'Z');
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}
