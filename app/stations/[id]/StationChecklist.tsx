'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface StationCheckItem {
  status: 'pass' | 'fail' | 'na' | null;
  par: string;
  have: string;
  need: string;
  note: string;
}

export interface SignoffData {
  cook_id?: string;
  created_at?: string;
}

export interface StationChecklistProps {
  stationId: string;
  stationName: string;
  date: string;
  items: string[];
  existing: Record<string, Partial<StationCheckItem>>;
  signoff?: SignoffData | null;
  locationId?: string;
}

export default function StationChecklist({ stationId, stationName, date, items, existing, signoff, locationId = 'default' }: StationChecklistProps) {
  const router = useRouter();
  const cookRef = useRef<string>('');
  const [state, setState] = useState<Record<string, StationCheckItem>>(() => {
    const m: Record<string, StationCheckItem> = {};
    for (const item of items) {
      const ex = existing[item];
      m[item] = ex
        ? { status: ex.status || null, par: ex.par || '', have: ex.have || '', need: ex.need || '', note: ex.note || '' }
        : { status: null, par: '', have: '', need: '', note: '' };
    }
    return m;
  });
  const [cookId, setCookId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [signed, setSigned] = useState<SignoffData | null>(signoff || null);

  useEffect(() => {
    const id = window.localStorage.getItem('lariat_cook') || '';
    setCookId(id);
    cookRef.current = id;
  }, []);

  useEffect(() => {
    cookRef.current = cookId;
  }, [cookId]);

  const update = (item: string, patch: Partial<StationCheckItem>) => setState(s => ({ ...s, [item]: { ...s[item], ...patch } }));

  const persist = async (item: string) => {
    if (!cookId) { alert('Pick your name in the sidebar first.'); return; }
    const row = state[item];
    await fetch('/api/checks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shift_date: date,
        station_id: stationId,
        item,
        status: row.status,
        par: row.par, have: row.have, need: row.need, note: row.note,
        cook_id: cookId,
        location_id: locationId,
      }),
    });
    router.refresh();
  };

  const setStatus = async (item: string, status: 'pass' | 'fail') => {
    const toggled = state[item].status === status ? null : status;
    update(item, { status: toggled });
    setState(curr => {
      const next = { ...curr, [item]: { ...curr[item], status: toggled } };
      const cid = cookRef.current || null;
      fetch('/api/checks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shift_date: date, station_id: stationId, item, status: toggled,
          par: next[item].par, have: next[item].have, need: next[item].need, note: next[item].note,
          cook_id: cid,
          location_id: locationId,
        }),
      });
      return next;
    });
  };

  const eightySix = async (item: string) => {
    const reason = window.prompt(`86 "${item}" — reason? (out / spoiled / dropped / no_make / burned / prep_short / other)`, 'out');
    if (reason === null) return;
    const cid = cookRef.current || null;
    await fetch('/api/eighty-six', {
      method: 'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify({
        shift_date: date,
        station_id: stationId,
        item,
        reason: reason || 'out',
        cook_id: cid,
        location_id: locationId,
      }),
    });
    update(item, { status: 'fail' });
    await fetch('/api/checks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shift_date: date, station_id: stationId, item, status: 'fail',
        par: state[item].par, have: state[item].have, need: state[item].need,
        note: `86: ${reason || 'out'}`, cook_id: cid,
        location_id: locationId,
      }),
    });
    router.refresh();
  };

  const signOff = async () => {
    if (!cookId) { alert('Pick your name in the sidebar first.'); return; }
    setSaving(true);
    const res = await fetch('/api/signoff', {
      method: 'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify({ shift_date: date, station_id: stationId, cook_id: cookId, location_id: locationId }),
    });
    const j = await res.json();
    setSaving(false);
    if (!res.ok) {
      const missing = Array.isArray(j?.items) && j.items.length
        ? `\n• ${j.items.join('\n• ')}`
        : '';
      alert(`${j?.error || 'Could not sign off.'}${missing}`);
      return;
    }
    setSigned(j);
    router.refresh();
  };

  const counts = items.reduce((acc, i) => {
    const s = state[i].status;
    if (s === 'pass') acc.pass++;
    else if (s === 'fail') acc.fail++;
    else if (s === 'na') acc.na++;
    return acc;
  }, { pass: 0, fail: 0, na: 0 });
  const done = counts.pass + counts.fail + counts.na;
  const allDone = done === items.length;
  // HACCP gate: a 'fail' line without a corrective-action note cannot be signed off.
  const unnotedFails = items.filter(i => state[i].status === 'fail' && !state[i].note.trim());
  const readyToSign = allDone && unnotedFails.length === 0;

  return (
    <div>
      <div className="flex-between mb-20 text-muted">
        <div className="flex-center-gap font-bold">
            <span className="text-green">✓ {counts.pass}</span>
            <span className="text-red">✗ {counts.fail}</span>
            <span>n/a {counts.na}</span>
        </div>
        <span>{done} / {items.length} complete</span>
      </div>

      <div className="checklist">
        {items.map(item => {
          const row = state[item];
          const needsNote = row.status === 'fail' && !row.note.trim();
          return (
            <div key={item} className={`check-row ${row.status === 'pass' ? 'pass' : ''} ${row.status === 'fail' ? 'fail' : ''}`}>
              <div className="check-name">{item}</div>
              <input type="text" placeholder="par"
                className="input"
                value={row.par}
                onChange={e => update(item, { par: e.target.value })}
                onBlur={() => persist(item)}
              />
              <input type="text" placeholder="have"
                className="input"
                value={row.have}
                onChange={e => update(item, { have: e.target.value })}
                onBlur={() => persist(item)}
              />
              <button className={`btn ${row.status === 'pass' ? 'green' : ''}`} aria-label="Pass" onClick={() => setStatus(item, 'pass')}>Pass</button>
              <button className={`btn ${row.status === 'fail' ? 'red' : ''}`} aria-label="Fail" onClick={() => setStatus(item, 'fail')}>Fail</button>
              <button className="btn" onClick={() => eightySix(item)} title="86 this item">86</button>
              {row.status === 'fail' && (
                <input
                  type="text"
                  placeholder={needsNote ? 'what did you do about it?' : 'fix noted'}
                  className={`input fix-note ${needsNote ? 'needs-note' : ''}`}
                  value={row.note}
                  onChange={e => update(item, { note: e.target.value })}
                  onBlur={() => persist(item)}
                />
              )}
            </div>
          );
        })}
      </div>

      {signed ? (
        <div className="signed-off mt-16">
          ✓ Signed off · {signed.cook_id || 'cook'} · {new Date((signed.created_at || '').replace(' ', 'T') + 'Z').toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' })}
        </div>
      ) : (
        <div className="flex-between mt-20" style={{ justifyContent: 'flex-end'}}>
          <button className="btn primary lg" onClick={signOff} disabled={!readyToSign || saving}>
            {saving
              ? 'Signing…'
              : !allDone
                ? `Check every item (${items.length - done} left)`
                : unnotedFails.length > 0
                  ? `Note the fix for ${unnotedFails.length} fail${unnotedFails.length === 1 ? '' : 's'}`
                  : counts.fail > 0
                    ? `Sign off (${counts.fail} fail${counts.fail === 1 ? '' : 's'} noted)`
                    : 'Sign off this station'}
          </button>
        </div>
      )}
    </div>
  );
}
