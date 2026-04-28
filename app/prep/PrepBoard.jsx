'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const PRIORITY_LABEL = { 0: 'normal', 1: 'high', 2: 'rush' };
const PRIORITY_TONE = { 0: null, 1: 'amber', 2: 'red' };

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

export default function PrepBoard({ tasks, stations, suggested, date, locationId }) {
  const router = useRouter();
  const [cookId, setCookId] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  const stationName = (id) =>
    stations.find((s) => s.id === id)?.name || id || 'Any station';

  const grouped = useMemo(() => {
    // Open tasks grouped by station; done/skipped go to a separate bin.
    const open = new Map();
    const closed = [];
    for (const t of tasks) {
      if (t.status === 'done' || t.status === 'skipped') {
        closed.push(t);
        continue;
      }
      const k = t.station_id || '';
      if (!open.has(k)) open.set(k, []);
      open.get(k).push(t);
    }
    // Order: stations in their natural order, then "Any station" last.
    const stationKeys = [...open.keys()];
    stationKeys.sort((a, b) => {
      if (a === '' && b !== '') return 1;
      if (b === '' && a !== '') return -1;
      const ai = stations.findIndex((s) => s.id === a);
      const bi = stations.findIndex((s) => s.id === b);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
    return { stationKeys, open, closed };
  }, [tasks, stations]);

  const counts = useMemo(() => {
    const c = { todo: 0, in_progress: 0, done: 0, skipped: 0 };
    for (const t of tasks) c[t.status] = (c[t.status] || 0) + 1;
    return c;
  }, [tasks]);

  const patch = async (id, body) => {
    setBusyId(id);
    setErr('');
    try {
      const res = await fetch(`/api/prep-tasks/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, location_id: locationId, cook_id: cookId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Did not save — try again.');
        setBusyId(null);
        return;
      }
      setBusyId(null);
      router.refresh();
    } catch {
      setErr('Lost connection — not saved.');
      setBusyId(null);
    }
  };

  const removeTask = async (id) => {
    if (!window.confirm('Drop this task?')) return;
    setBusyId(id);
    setErr('');
    try {
      const res = await fetch(
        `/api/prep-tasks/${id}?location=${encodeURIComponent(locationId)}&cook_id=${encodeURIComponent(cookId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        setErr('Could not drop.');
        setBusyId(null);
        return;
      }
      setBusyId(null);
      router.refresh();
    } catch {
      setErr('Lost connection.');
      setBusyId(null);
    }
  };

  return (
    <div>
      <h1>Prep board</h1>
      <p className="subtitle">
        What the line is prepping today.{' '}
        {counts.todo > 0 && (
          <>
            {counts.todo} to do · {counts.in_progress} in progress · {counts.done} done.
          </>
        )}
      </p>

      {err && (
        <div className="card border-red mb-20" role="alert" aria-live="assertive" style={{ color: 'var(--red)' }}>
          {err}
        </div>
      )}

      <AddTaskForm stations={stations} cookId={cookId} date={date} locationId={locationId} />

      {suggested.length > 0 && (
        <Suggested
          rows={suggested}
          stations={stations}
          cookId={cookId}
          date={date}
          locationId={locationId}
        />
      )}

      {grouped.stationKeys.length === 0 && (
        <div className="empty" role="status" aria-live="polite" style={{ marginTop: 24 }}>
          Nothing on the board yet.
        </div>
      )}

      {grouped.stationKeys.map((sid) => (
        <section key={sid || 'any'} style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, margin: '12px 0 8px', opacity: 0.85 }}>
            {stationName(sid)} · {grouped.open.get(sid).length}
          </h2>
          <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {grouped.open.get(sid).map((t) => (
              <TaskRow
                key={t.id}
                t={t}
                busy={busyId === t.id}
                cookId={cookId}
                onClaim={() => patch(t.id, { claim: true })}
                onRelease={() => patch(t.id, { release: true })}
                onStart={() => patch(t.id, { status: 'in_progress' })}
                onDone={() => patch(t.id, { status: 'done' })}
                onSkip={() => patch(t.id, { status: 'skipped' })}
                onDelete={() => removeTask(t.id)}
              />
            ))}
          </ul>
        </section>
      ))}

      {grouped.closed.length > 0 && (
        <ClosedSection
          rows={grouped.closed}
          stationName={stationName}
          onReopen={(id) => patch(id, { status: 'todo' })}
        />
      )}
    </div>
  );
}

function TaskRow({ t, busy, cookId, onClaim, onRelease, onStart, onDone, onSkip, onDelete }) {
  const tone = PRIORITY_TONE[t.priority] || null;
  const mine = t.assigned_cook_id && cookId && t.assigned_cook_id === cookId;

  return (
    <li
      className="check-row"
      style={{
        ...(tone === 'red' ? { borderLeft: '3px solid var(--red)', paddingLeft: 8 } :
            tone === 'amber' ? { borderLeft: '3px solid var(--orange, #c0531c)', paddingLeft: 8 } : null),
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: '1 1 220px' }}>
        <div className="check-name">
          {t.task}
          {t.qty && <span style={{ opacity: 0.75 }}> · {t.qty}</span>}
          {t.priority > 0 && (
            <span
              style={{
                marginLeft: 8, padding: '2px 8px', borderRadius: 999,
                background: tone === 'red' ? 'var(--red)' : 'var(--orange, #c0531c)',
                color: '#fff', fontSize: 12,
              }}
            >
              {PRIORITY_LABEL[t.priority]}
            </span>
          )}
        </div>
        <div className="meta">
          {t.status === 'in_progress' && t.started_at && (
            <>started <time dateTime={t.started_at}>{fmtTime(t.started_at)}</time> · </>
          )}
          {t.assigned_cook_id ? <>{t.assigned_cook_id}</> : <em>unclaimed</em>}
          {t.notes && <> · {t.notes}</>}
          {t.source && t.source !== 'manual' && <> · from {t.source}</>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {t.status === 'todo' && !t.assigned_cook_id && (
          <button type="button" className="btn primary" disabled={busy || !cookId} onClick={onClaim}>
            {cookId ? 'Claim' : 'Set cook first'}
          </button>
        )}
        {t.status === 'todo' && t.assigned_cook_id && (
          <>
            <button type="button" className="btn" disabled={busy} onClick={onStart}>Start</button>
            {mine && (
              <button type="button" className="btn" disabled={busy} onClick={onRelease}>
                Drop claim
              </button>
            )}
          </>
        )}
        {t.status === 'in_progress' && (
          <>
            <button type="button" className="btn primary" disabled={busy} onClick={onDone}>
              Done
            </button>
            <button type="button" className="btn" disabled={busy} onClick={onSkip}>
              Skip
            </button>
          </>
        )}
        <button type="button" className="btn" disabled={busy} onClick={onDelete} aria-label={`Drop ${t.task}`}>
          ×
        </button>
      </div>
    </li>
  );
}

function ClosedSection({ rows, stationName, onReopen }) {
  return (
    <section style={{ marginTop: 32, opacity: 0.85 }}>
      <h2 style={{ fontSize: 16, margin: '12px 0 8px', opacity: 0.85 }}>Done · {rows.length}</h2>
      <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((t) => (
          <li key={t.id} className="check-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div className="check-name" style={{ textDecoration: t.status === 'skipped' ? 'line-through' : 'none' }}>
                {t.task} {t.qty && <span style={{ opacity: 0.75 }}>· {t.qty}</span>}
              </div>
              <div className="meta">
                {stationName(t.station_id)} ·{' '}
                {t.status === 'skipped' ? 'skipped' : 'done'}
                {t.done_at && (
                  <> at <time dateTime={t.done_at}>{fmtTime(t.done_at)}</time></>
                )}
                {t.done_by && <> by {t.done_by}</>}
              </div>
            </div>
            <button type="button" className="btn" onClick={() => onReopen(t.id)}>
              Reopen
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Suggested({ rows, stations, cookId, date, locationId }) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState(null);

  const addAsTask = async (row) => {
    const ingredient = row.ingredient;
    setBusyKey(ingredient);
    try {
      const deficit = Number(row.par_qty) - Number(row.on_hand_qty);
      const qty = Number.isFinite(deficit) && deficit > 0
        ? `${deficit} ${row.par_unit || ''}`.trim()
        : null;
      await fetch('/api/prep-tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shift_date: date,
          location_id: locationId,
          assigned_cook_id: cookId || null,
          task: `Prep ${ingredient}`,
          qty,
          source: 'low_par',
          source_ref: ingredient,
          priority: 1,
        }),
      });
      setBusyKey(null);
      router.refresh();
    } catch {
      setBusyKey(null);
    }
  };

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 16, margin: '0 0 8px', opacity: 0.85 }}>
        Below par · suggested
      </h2>
      <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((r) => (
          <li
            key={r.ingredient}
            className="check-row"
            style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
          >
            <div>
              <div className="check-name">{r.ingredient}</div>
              <div className="meta">
                par {r.par_qty} {r.par_unit || ''} · on hand {r.on_hand_qty} {r.on_hand_unit || ''}
              </div>
            </div>
            <button
              type="button"
              className="btn primary"
              disabled={busyKey === r.ingredient}
              onClick={() => addAsTask(r)}
            >
              {busyKey === r.ingredient ? 'Adding…' : 'Add as task'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddTaskForm({ stations, cookId, date, locationId }) {
  const router = useRouter();
  const [task, setTask] = useState('');
  const [stationId, setStationId] = useState('');
  const [qty, setQty] = useState('');
  const [priority, setPriority] = useState(0);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!task.trim()) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/prep-tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shift_date: date,
          location_id: locationId,
          assigned_cook_id: cookId || null,
          station_id: stationId || null,
          task: task.trim(),
          qty: qty || null,
          priority,
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        setErr('Did not save — try again.');
        setBusy(false);
        return;
      }
      setTask('');
      setQty('');
      setNotes('');
      setPriority(0);
      setBusy(false);
      router.refresh();
    } catch {
      setErr('Lost connection — not saved.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card form-row" aria-busy={busy} style={{ marginBottom: 20 }}>
      <div style={{ flex: '2 1 220px' }}>
        <label className="label" htmlFor="prep-task">Task</label>
        <input
          id="prep-task"
          name="prep-task"
          type="text"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="e.g. Prep aji verde, dice tomato mise"
          className="input form-field"
          autoComplete="off"
        />
      </div>
      <div style={{ flex: '1 1 140px' }}>
        <label className="label" htmlFor="prep-station">Station</label>
        <select
          id="prep-station"
          value={stationId}
          onChange={(e) => setStationId(e.target.value)}
          className="input form-field"
        >
          <option value="">— any —</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div style={{ flex: '0 1 120px' }}>
        <label className="label" htmlFor="prep-qty">Qty</label>
        <input
          id="prep-qty"
          type="text"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="2 qt, 6 ea"
          className="input form-field"
        />
      </div>
      <div style={{ flex: '0 1 120px' }}>
        <label className="label" htmlFor="prep-prio">Priority</label>
        <select
          id="prep-prio"
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
          className="input form-field"
        >
          <option value={0}>Normal</option>
          <option value={1}>High</option>
          <option value={2}>Rush</option>
        </select>
      </div>
      <div style={{ flex: '2 1 200px' }}>
        <label className="label" htmlFor="prep-notes">Notes</label>
        <input
          id="prep-notes"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="optional"
          className="input form-field"
          maxLength={500}
        />
      </div>
      <button type="submit" className="btn primary lg" disabled={busy || !task.trim()}>
        {busy ? 'Saving…' : 'Add'}
      </button>
      {err && (
        <div role="alert" aria-live="assertive" style={{ color: 'var(--red)', flexBasis: '100%' }}>
          {err}
        </div>
      )}
    </form>
  );
}
