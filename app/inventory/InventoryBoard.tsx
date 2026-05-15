'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export interface StationData {
  id: string;
  name: string;
}

export interface InventoryUpdate {
  id: number;
  item: string;
  direction?: string;
  delta?: string;
  station_id?: string;
  note?: string;
  created_at: string;
  cook_id?: string;
}

export interface InventoryBoardProps {
  updates: InventoryUpdate[];
  stations: StationData[];
  date: string;
  locationId?: string;
}

const DIRECTIONS = ['received','prepped','used','transferred','counted','low','adjusted'];

export default function InventoryBoard({ updates, stations, date, locationId = 'default' }: InventoryBoardProps) {
  const router = useRouter();
  const [cookId, setCookId] = useState('');
  const [item, setItem] = useState('');
  const [stationId, setStationId] = useState('');
  const [delta, setDelta] = useState('');
  const [direction, setDirection] = useState('prepped');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { setCookId(window.localStorage.getItem('lariat_cook') || ''); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item.trim()) return;
    setSaving(true);
    setErr('');
    let ok = false;
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shift_date: date, station_id: stationId || null,
          item: item.trim(), delta, direction, note, cook_id: cookId,
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
    setItem(''); setDelta(''); setNote('');
    router.refresh();
  };

  return (
    <div>
      <h1>Inventory</h1>
      <p className="subtitle">What came in, went out, or got prepped today.</p>

      {err && (
        <div
          id="inv-err"
          className="card border-red mb-20"
          role="alert"
          aria-live="assertive"
          style={{ color: 'var(--red)' }}
        >
          {err}
        </div>
      )}

      <form
        onSubmit={add}
        className="card form-row"
        aria-busy={saving}
        aria-describedby={err ? 'inv-err' : undefined}
      >
        <div style={{ flex:'2 1 220px' }}>
          <label className="label" htmlFor="inv-item">Item</label>
          <input
            id="inv-item"
            name="inv-item"
            type="text"
            value={item}
            onChange={e => setItem(e.target.value)}
            placeholder="e.g. Aji Verde, Pork Chop, Buttermilk"
            className="input form-field"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="next"
            aria-required="true"
          />
        </div>
        <div style={{ flex:'1 1 140px' }}>
          <label className="label" htmlFor="inv-station">Station</label>
          <select
            id="inv-station"
            name="inv-station"
            value={stationId}
            onChange={e => setStationId(e.target.value)}
            className="input form-field"
          >
            <option value="">— any —</option>
            {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ flex:'1 1 140px' }}>
          <label className="label" htmlFor="inv-direction">Action</label>
          <select
            id="inv-direction"
            name="inv-direction"
            value={direction}
            onChange={e => setDirection(e.target.value)}
            className="input form-field"
          >
            {DIRECTIONS.map(d => (
              <option key={d} value={d}>
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex:'0 1 120px' }}>
          <label className="label" htmlFor="inv-qty">Qty</label>
          <input
            id="inv-qty"
            name="inv-qty"
            type="text"
            value={delta}
            onChange={e => setDelta(e.target.value)}
            placeholder="2 qt, 6 ea"
            className="input form-field"
            autoComplete="off"
          />
        </div>
        <div style={{ flex:'2 1 200px' }}>
          <label className="label" htmlFor="inv-note">Note</label>
          <input
            id="inv-note"
            name="inv-note"
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="optional"
            className="input form-field"
            autoComplete="off"
            maxLength={500}
          />
        </div>
        <button
          type="submit"
          className="btn primary lg"
          disabled={saving || !item.trim()}
          aria-label={saving ? 'Saving inventory update' : `Add ${direction} entry${item.trim() ? ' for ' + item.trim() : ''}`}
        >
          {saving ? 'Saving…' : 'Add'}
        </button>
      </form>

      {updates.length === 0 ? (
        <div className="empty" role="status" aria-live="polite">Nothing logged today.</div>
      ) : (
        <ul className="checklist" aria-label="Today's inventory updates" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {updates.map(u => (
            <li key={u.id} className="check-row">
              <div>
                <div className="check-name">{u.item}</div>
                <div className="meta">
                  {u.direction && <>{u.direction} · </>}
                  {u.delta && <>{u.delta} · </>}
                  {u.station_id && <>{u.station_id} · </>}
                  <time dateTime={u.created_at}>{fmtTime(u.created_at)}</time>
                  {u.cook_id && <> · {u.cook_id}</>}
                  {u.note && <> · {u.note}</>}
                </div>
              </div>
              <span></span><span></span><span></span><span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fmtTime(iso: string) {
  if (!iso) return '';
  try {
    const d = new Date(iso.replace(' ', 'T') + 'Z');
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}
