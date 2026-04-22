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

  useEffect(() => { setCookId(window.localStorage.getItem('lariat_cook') || ''); }, []);

  const add = async (e) => {
    e.preventDefault();
    if (!item.trim()) return;
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
    if (!window.confirm(`86 "${c.name}" too?\nAny already prepped and in the walk-in is still OK — only confirm if you're actually out.`)) return;
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

  return (
    <div>
      <h1>86 Board</h1>
      <p className="subtitle">{active.length} item{active.length === 1 ? '' : 's'} out. Mark it back when you&apos;ve got it.</p>

      <form onSubmit={add} className="card form-row">
        <div style={{ flex: '2 1 240px' }}>
          <label className="label">Item</label>
          <input
            value={item}
            onChange={e => setItem(e.target.value)}
            placeholder="e.g. Pork Chop, House Salad, Aji Verde"
            className="input form-field"
          />
        </div>
        <div style={{ flex:'1 1 140px' }}>
          <label className="label">Station</label>
          <select value={stationId} onChange={e => setStationId(e.target.value)} className="input form-field">
            <option value="">— any —</option>
            {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ flex:'1 1 120px' }}>
          <label className="label">Reason</label>
          <select value={reason} onChange={e => setReason(e.target.value)} className="input form-field">
            {REASONS.map(r => <option key={r} value={r}>{r.replace('_',' ')}</option>)}
          </select>
        </div>
        <div style={{ flex:'0 1 100px' }}>
          <label className="label">Qty</label>
          <input value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="opt." className="input form-field" />
        </div>
        <button type="submit" className="btn red lg" disabled={saving || !item.trim()}>86 it</button>
      </form>

      {active.length === 0 ? (
        <div className="empty">No 86s right now. ✓</div>
      ) : (
        <div className="checklist">
          {active.map(e => (
            <div key={e.id} className="check-row fail">
              <div>
                <div className="check-name">{e.item}</div>
                <div className="meta">
                  {e.station_id && <>{e.station_id} · </>}
                  {e.reason && <>{String(e.reason).replace('_',' ')} · </>}
                  {e.quantity && <>{e.quantity} · </>}
                  {fmtTime(e.created_at)}
                  {e.cook_id && <> · {e.cook_id}</>}
                </div>
              </div>
              <span></span><span></span><span></span>
              <button className="btn green" onClick={() => resolve(e.id)}>Resolve</button>
            </div>
          ))}
        </div>
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
                  <div className="meta">uses {c.via}</div>
                </div>
                <span></span><span></span><span></span>
                <button
                  className="btn red"
                  disabled={saving}
                  onClick={() => confirmCascade(c)}
                >
                  Mark out too
                </button>
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
                <span></span><span></span><span></span><span></span>
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
