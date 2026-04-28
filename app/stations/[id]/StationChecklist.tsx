'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface StationCheckItem {
  status: 'pass' | 'fail' | 'na' | null;
  par: string;
  have: string;
  need: string;
  note: string;
  /**
   * F15 — FDA §3-301.11 bare-hand-contact-with-RTE attestation. Tri-state:
   * null  = cook hasn't ticked it (also the default for items that
   *         don't touch ready-to-eat food)
   * false = item touches RTE, cook has NOT changed gloves
   * true  = cook has attested fresh gloves for this line-check row
   */
  glove_change_attested: boolean | null;
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

const EMPTY_ROW: StationCheckItem = {
  status: null,
  par: '',
  have: '',
  need: '',
  note: '',
  glove_change_attested: null,
};

export default function StationChecklist({ stationId, stationName, date, items, existing, signoff, locationId = 'default' }: StationChecklistProps) {
  const router = useRouter();
  const cookRef = useRef<string>('');
  const [state, setState] = useState<Record<string, StationCheckItem>>(() => {
    const m: Record<string, StationCheckItem> = {};
    for (const item of items) {
      const ex = existing[item];
      m[item] = ex
        ? {
            status: ex.status || null,
            par: ex.par || '',
            have: ex.have || '',
            need: ex.need || '',
            note: ex.note || '',
            glove_change_attested:
              typeof ex.glove_change_attested === 'boolean' ? ex.glove_change_attested : null,
          }
        : {
            status: null,
            par: '',
            have: '',
            need: '',
            note: '',
            glove_change_attested: null,
          };
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

  const update = (item: string, patch: Partial<StationCheckItem>) => setState(s => ({ ...s, [item]: { ...(s[item] ?? EMPTY_ROW), ...patch } }));
  const rowFor = (item: string): StationCheckItem => state[item] ?? EMPTY_ROW;

  const persist = async (item: string) => {
    if (!cookId) { alert('Pick your name in the sidebar first.'); return; }
    const row = rowFor(item);
    try {
      const res = await fetch('/api/checks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shift_date: date,
          station_id: stationId,
          item,
          status: row.status,
          par: row.par, have: row.have, need: row.need, note: row.note,
          glove_change_attested: row.glove_change_attested,
          cook_id: cookId,
          location_id: locationId,
        }),
      });
      if (!res.ok) {
        alert(`Couldn’t save "${item}" — retry. (HTTP ${res.status})`);
        return;
      }
    } catch {
      alert(`Lost connection saving "${item}" — retry.`);
      return;
    }
    router.refresh();
  };

  const setStatus = async (item: string, status: 'pass' | 'fail') => {
    const toggled = rowFor(item).status === status ? null : status;
    update(item, { status: toggled });
    // Snapshot the row fields AFTER applying the toggle, then fire the
    // fetch OUTSIDE setState so we can actually await + check res.ok.
    // The previous implementation called fetch inside the setState callback
    // and ignored both rejections and non-2xx — silently losing pass/fail
    // taps and causing the signoff gate to block with "unnoted fails" that
    // actually WERE noted locally.
    const prev = rowFor(item);
    const cid = cookRef.current || null;
    try {
      const res = await fetch('/api/checks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shift_date: date, station_id: stationId, item, status: toggled,
          par: prev.par, have: prev.have, need: prev.need, note: prev.note,
          glove_change_attested: prev.glove_change_attested,
          cook_id: cid,
          location_id: locationId,
        }),
      });
      if (!res.ok) {
        alert(`Couldn’t save ${status} for "${item}" — retry. (HTTP ${res.status})`);
      }
    } catch {
      alert(`Lost connection saving ${status} for "${item}" — retry.`);
    }
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
        par: rowFor(item).par, have: rowFor(item).have, need: rowFor(item).need,
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
    const s = rowFor(i).status;
    if (s === 'pass') acc.pass++;
    else if (s === 'fail') acc.fail++;
    else if (s === 'na') acc.na++;
    return acc;
  }, { pass: 0, fail: 0, na: 0 });
  const done = counts.pass + counts.fail + counts.na;
  const allDone = done === items.length;
  // HACCP gate: a 'fail' line without a corrective-action note cannot be signed off.
  const unnotedFails = items.filter(i => rowFor(i).status === 'fail' && !rowFor(i).note.trim());
  const readyToSign = allDone && unnotedFails.length === 0;

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  const createdIso = signed?.created_at
    ? (signed.created_at.includes('T') ? signed.created_at : signed.created_at.replace(' ', 'T') + 'Z')
    : '';

  return (
    <div>
      <div
        className="flex-between mb-20 text-muted"
        role="status"
        aria-live="polite"
        aria-label={`Checklist progress: ${done} of ${items.length} complete, ${counts.pass} pass, ${counts.fail} fail, ${counts.na} not applicable`}
      >
        <div className="flex-center-gap font-bold">
            <span className="text-green">✓ {counts.pass}</span>
            <span className="text-red">✗ {counts.fail}</span>
            <span>n/a {counts.na}</span>
        </div>
        <span>{done} / {items.length} complete</span>
      </div>

      <div className="checklist" role="list" aria-label={`${stationName} checklist`}>
        {items.map(item => {
          const row = rowFor(item);
          const needsNote = row.status === 'fail' && !row.note.trim();
          const key = slug(item);
          const parId = `chk-par-${key}`;
          const haveId = `chk-have-${key}`;
          const noteId = `chk-note-${key}`;
          return (
            <div
              key={item}
              className={`check-row ${row.status === 'pass' ? 'pass' : ''} ${row.status === 'fail' ? 'fail' : ''}`}
              role="listitem"
              aria-label={`${item}${row.status ? ' — ' + row.status : ''}`}
            >
              <div className="check-name">{item}</div>
              <label htmlFor={parId} className="sr-only">{`Par for ${item}`}</label>
              <input
                id={parId}
                name={parId}
                type="text"
                placeholder="par"
                className="input"
                inputMode="numeric"
                autoComplete="off"
                enterKeyHint="next"
                aria-label={`Par quantity for ${item}`}
                value={row.par}
                onChange={e => update(item, { par: e.target.value })}
                onBlur={() => persist(item)}
              />
              <label htmlFor={haveId} className="sr-only">{`Have for ${item}`}</label>
              <input
                id={haveId}
                name={haveId}
                type="text"
                placeholder="have"
                className="input"
                inputMode="numeric"
                autoComplete="off"
                enterKeyHint="next"
                aria-label={`Current on-hand quantity for ${item}`}
                value={row.have}
                onChange={e => update(item, { have: e.target.value })}
                onBlur={() => persist(item)}
              />
              <button
                type="button"
                className={`btn ${row.status === 'pass' ? 'green' : ''}`}
                aria-label={`Pass ${item}`}
                aria-pressed={row.status === 'pass' ? 'true' : 'false'}
                onClick={() => setStatus(item, 'pass')}
              >
                Pass
              </button>
              <button
                type="button"
                className={`btn ${row.status === 'fail' ? 'red' : ''}`}
                aria-label={`Fail ${item}`}
                aria-pressed={row.status === 'fail' ? 'true' : 'false'}
                onClick={() => setStatus(item, 'fail')}
              >
                Fail
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => eightySix(item)}
                title="86 this item"
                aria-label={`86 ${item}`}
              >
                86
              </button>
              <label
                className={`glove-toggle ${row.glove_change_attested ? 'on' : ''}`}
                title="Touches ready-to-eat food? Tick when you change gloves (FDA §3-301.11)."
              >
                <input
                  type="checkbox"
                  checked={row.glove_change_attested === true}
                  onChange={(e) => {
                    const next = e.target.checked ? true : null;
                    update(item, { glove_change_attested: next });
                    // Persist inline so the attestation is durable.
                    const cid = cookRef.current || null;
                    const cur: StationCheckItem = { ...rowFor(item), glove_change_attested: next };
                    fetch('/api/checks', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({
                        shift_date: date,
                        station_id: stationId,
                        item,
                        status: cur.status,
                        par: cur.par,
                        have: cur.have,
                        need: cur.need,
                        note: cur.note,
                        glove_change_attested: cur.glove_change_attested,
                        cook_id: cid,
                        location_id: locationId,
                      }),
                    });
                  }}
                  aria-label={`Glove change attested for ${item}`}
                />
                <span>🧤 gloves</span>
              </label>
              {row.status === 'fail' && (
                <>
                  <label htmlFor={noteId} className="sr-only">{`Corrective action for ${item}`}</label>
                  <input
                    id={noteId}
                    name={noteId}
                    type="text"
                    placeholder={needsNote ? 'what did you do about it?' : 'fix noted'}
                    className={`input fix-note ${needsNote ? 'needs-note' : ''}`}
                    autoComplete="off"
                    enterKeyHint="done"
                    maxLength={500}
                    aria-label={`Corrective action for ${item}`}
                    aria-required={needsNote ? 'true' : 'false'}
                    aria-invalid={needsNote ? 'true' : 'false'}
                    value={row.note}
                    onChange={e => update(item, { note: e.target.value })}
                    onBlur={() => persist(item)}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>

      {signed ? (
        <div className="signed-off mt-16" role="status" aria-live="polite">
          ✓ Signed off · {signed.cook_id || 'cook'}
          {createdIso && (
            <>
              {' · '}
              <time dateTime={createdIso}>
                {new Date(createdIso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </time>
            </>
          )}
        </div>
      ) : (
        <div className="flex-between mt-20 justify-end">
          <button
            type="button"
            className="btn primary lg"
            onClick={signOff}
            disabled={!readyToSign || saving}
            aria-busy={saving ? 'true' : 'false'}
            aria-label={
              saving
                ? 'Signing off station'
                : !allDone
                  ? `Finish checking ${items.length - done} remaining item${items.length - done === 1 ? '' : 's'} before sign-off`
                  : unnotedFails.length > 0
                    ? `Add corrective action note for ${unnotedFails.length} failed item${unnotedFails.length === 1 ? '' : 's'}`
                    : `Sign off ${stationName} station`
            }
          >
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
