'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

function fmtTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function fmtDay(iso) {
  if (!iso) return '';
  try {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
  } catch {
    return iso;
  }
}

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
];

export default function WasteLogClient({
  recent, byItem, stations, days, date, locationId,
}) {
  const router = useRouter();
  const [cookId, setCookId] = useState('');
  const [item, setItem] = useState('');
  const [stationId, setStationId] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!item.trim()) return;
    setBusy(true);
    setErr('');
    try {
      const qtyNum = qty === '' ? null : Number(qty);
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shift_date: date,
          station_id: stationId || null,
          item: item.trim(),
          qty: Number.isFinite(qtyNum) ? qtyNum : null,
          unit: unit || null,
          direction: 'waste',
          source: 'manual',
          note: reason || null,
          cook_id: cookId,
          location_id: locationId,
        }),
      });
      if (!res.ok) {
        setErr('Did not save — try again.');
        setBusy(false);
        return;
      }
      setItem('');
      setQty('');
      setUnit('');
      setReason('');
      setBusy(false);
      router.refresh();
    } catch {
      setErr('Lost connection — not saved.');
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Waste</h1>
      <p className="subtitle">What got thrown out, dropped, or burned. Track it so we can fix it.</p>

      {err && (
        <div className="card border-red mb-20" role="alert" aria-live="assertive" style={{ color: 'var(--red)' }}>
          {err}
        </div>
      )}

      <form onSubmit={submit} className="card form-row" aria-busy={busy}>
        <div style={{ flex: '2 1 220px' }}>
          <label className="label" htmlFor="waste-item">Item</label>
          <input
            id="waste-item"
            type="text"
            value={item}
            onChange={(e) => setItem(e.target.value)}
            placeholder="e.g. Pork Chop, Aji Verde"
            className="input form-field"
            autoComplete="off"
          />
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <label className="label" htmlFor="waste-station">Station</label>
          <select
            id="waste-station"
            value={stationId}
            onChange={(e) => setStationId(e.target.value)}
            className="input form-field"
          >
            <option value="">— any —</option>
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ flex: '0 1 100px' }}>
          <label className="label" htmlFor="waste-qty">Qty</label>
          <input
            id="waste-qty"
            type="number"
            inputMode="decimal"
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="input form-field"
          />
        </div>
        <div style={{ flex: '0 1 90px' }}>
          <label className="label" htmlFor="waste-unit">Unit</label>
          <input
            id="waste-unit"
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="input form-field"
            placeholder="lb, ea, qt"
          />
        </div>
        <div style={{ flex: '2 1 200px' }}>
          <label className="label" htmlFor="waste-reason">Why</label>
          <input
            id="waste-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="input form-field"
            placeholder="dropped, expired, over-prep"
            maxLength={500}
          />
        </div>
        <button type="submit" className="btn primary lg" disabled={busy || !item.trim()}>
          {busy ? 'Saving…' : 'Log waste'}
        </button>
      </form>

      <div className="card form-row" style={{ marginTop: 16, alignItems: 'center', gap: 8 }}>
        {RANGES.map((r) => (
          <a
            key={r.days}
            href={`/inventory/waste?days=${r.days}`}
            className={r.days === days ? 'btn primary' : 'btn'}
            aria-current={r.days === days ? 'page' : undefined}
            style={{ textDecoration: 'none' }}
          >
            {r.label}
          </a>
        ))}
      </div>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, margin: '12px 0 8px', opacity: 0.85 }}>
          Top items
        </h2>
        {byItem.length === 0 ? (
          <div className="empty" role="status">No waste logged in this range.</div>
        ) : (
          <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {byItem.map((b) => (
              <li key={b.item} className="check-row">
                <div>
                  <div className="check-name">{b.item}</div>
                  <div className="meta">
                    {b.hits} hit{b.hits === 1 ? '' : 's'}
                    {' · last '}
                    <time dateTime={b.last_at}>{fmtTime(b.last_at)}</time>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, margin: '12px 0 8px', opacity: 0.85 }}>Recent</h2>
        {recent.length === 0 ? (
          <div className="empty" role="status">Nothing logged.</div>
        ) : (
          <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {recent.map((r) => (
              <li key={r.id} className="check-row">
                <div>
                  <div className="check-name">{r.item}</div>
                  <div className="meta">
                    {r.delta && <>{r.delta} · </>}
                    {r.station_id && <>{r.station_id} · </>}
                    <time dateTime={r.shift_date}>{fmtDay(r.shift_date)}</time>
                    {' · '}
                    <time dateTime={r.created_at}>{fmtTime(r.created_at)}</time>
                    {r.cook_id && <> · {r.cook_id}</>}
                    {r.note && <> · {r.note}</>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
