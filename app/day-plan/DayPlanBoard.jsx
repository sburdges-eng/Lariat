// @ts-check
'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { clientFetch } from '@/lib/clientFetch';
import { isStepLate } from '../../lib/opsRun.ts';
import { serviceDate } from '../../lib/serviceDate.ts';

/**
 * @typedef {{
 *   id: number,
 *   daypart: string,
 *   step_key: string,
 *   title: string,
 *   detail: string | null,
 *   due_time: string | null,
 *   link_href: string | null,
 *   link_label: string | null,
 *   status: 'todo' | 'done' | 'skipped',
 *   done_at: string | null,
 *   done_by: string | null,
 *   sort_order: number,
 *   source: string,
 * }} DayPlanStep
 */

/**
 * @typedef {{
 *   todo: number,
 *   done: number,
 *   skipped: number,
 *   late: number,
 *   by_daypart: Record<string, { todo: number, done: number, late: number }>,
 * }} DayPlanRollup
 */

/** @param {string | null | undefined} t */
function fmtDue(t) {
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  const mm = m[2];
  const ampm = h >= 12 ? 'p' : 'a';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${mm}${ampm}`;
}

/**
 * @param {{
 *   steps: DayPlanStep[],
 *   rollup: DayPlanRollup,
 *   date: string,
 *   locationId: string,
 *   nowMinutes: number,
 *   daypartLabels: Record<string, string>,
 * }} props
 */
export default function DayPlanBoard({
  steps,
  rollup,
  date,
  locationId,
  nowMinutes,
  daypartLabels,
}) {
  const router = useRouter();
  const [cookId, setCookId] = useState('');
  const [busyId, setBusyId] = useState(/** @type {number | null} */ (null));
  const [err, setErr] = useState('');
  const [title, setTitle] = useState('');
  const [daypart, setDaypart] = useState('side_work');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  const locQ =
    locationId && locationId !== 'default'
      ? `?location=${encodeURIComponent(locationId)}`
      : '';

  const groups = useMemo(() => {
    /** @type {Map<string, DayPlanStep[]>} */
    const map = new Map();
    for (const s of steps) {
      if (!map.has(s.daypart)) map.set(s.daypart, []);
      /** @type {DayPlanStep[]} */ (map.get(s.daypart)).push(s);
    }
    return map;
  }, [steps]);

  const order = ['open', 'prep', 'side_work', 'maintenance', 'sop'];

  /**
   * @param {number} id
   * @param {'todo' | 'done' | 'skipped'} status
   */
  const patch = async (id, status) => {
    setBusyId(id);
    setErr('');
    try {
      const res = await clientFetch(`/api/ops-run/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, location_id: locationId, cook_id: cookId }),
        idempotent: true,
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

  const addStep = async () => {
    if (!title.trim()) return;
    setAdding(true);
    setErr('');
    try {
      const res = await clientFetch('/api/ops-run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          daypart,
          shift_date: date,
          location_id: locationId,
          cook_id: cookId,
        }),
        idempotent: true,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Could not add.');
        setAdding(false);
        return;
      }
      setTitle('');
      setAdding(false);
      router.refresh();
    } catch {
      setErr('Lost connection — not saved.');
      setAdding(false);
    }
  };

  return (
    <div>
      <h1>Day plan</h1>
      <p className="subtitle">
        Open, prep, side work, gear, and house SOP — plus live banquet prep,
        prep list, line checks, cleaning, and gear due.
        {rollup.todo > 0 && (
          <>
            {' '}
            {rollup.todo} open
            {rollup.late > 0 ? ` · ${rollup.late} late` : ''}
            {rollup.done > 0 ? ` · ${rollup.done} done` : ''}.
          </>
        )}
        {rollup.todo === 0 && rollup.done > 0 && <> All clear for now.</>}
      </p>

      {err && (
        <div
          className="card border-red mb-20"
          role="alert"
          aria-live="assertive"
          style={{ color: 'var(--red)' }}
        >
          {err}
        </div>
      )}

      {rollup.late > 0 && (
        <div
          className="card mb-20"
          role="status"
          style={{
            borderColor: 'var(--red)',
            background: 'color-mix(in srgb, var(--red) 12%, transparent)',
          }}
        >
          {rollup.late} step{rollup.late === 1 ? '' : 's'} past due — finish these first.
        </div>
      )}

      <div className="card mb-20">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Add a step</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <select
            value={daypart}
            onChange={(e) => setDaypart(e.target.value)}
            aria-label="Day part"
          >
            {order.map((d) => (
              <option key={d} value={d}>
                {daypartLabels[d] || d}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing"
            style={{ flex: '1 1 180px', minWidth: 160 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addStep();
            }}
          />
          <button type="button" className="btn" disabled={adding || !title.trim()} onClick={addStep}>
            Add
          </button>
        </div>
      </div>

      {order.map((dp) => {
        const rows = groups.get(dp) || [];
        if (rows.length === 0) return null;
        const bucket = rollup.by_daypart?.[dp];
        return (
          <section key={dp} style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 16, margin: '8px 0 10px', opacity: 0.9 }}>
              {daypartLabels[dp] || dp}
              {bucket ? (
                <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>
                  {bucket.todo} open
                  {bucket.late > 0 ? ` · ${bucket.late} late` : ''}
                </span>
              ) : null}
            </h2>
            <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {rows.map((s) => {
                const late = isStepLate(s, nowMinutes, serviceDate());
                const done = s.status === 'done' || s.status === 'skipped';
                return (
                  <li
                    key={s.id}
                    className="card"
                    style={{
                      marginBottom: 8,
                      opacity: done ? 0.65 : 1,
                      borderColor: late ? 'var(--red)' : undefined,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 12,
                        alignItems: 'flex-start',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ flex: '1 1 220px' }}>
                        <div style={{ fontWeight: 600 }}>
                          {s.due_time ? (
                            <span className="muted" style={{ marginRight: 8, fontFamily: 'var(--mono, monospace)' }}>
                              {fmtDue(s.due_time)}
                            </span>
                          ) : null}
                          {s.title}
                          {late ? (
                            <span style={{ color: 'var(--red)', marginLeft: 8, fontWeight: 700 }}>
                              Late
                            </span>
                          ) : null}
                          {s.status === 'skipped' ? (
                            <span className="muted" style={{ marginLeft: 8 }}>
                              Skipped
                            </span>
                          ) : null}
                        </div>
                        {s.detail ? <div className="muted" style={{ marginTop: 4 }}>{s.detail}</div> : null}
                        {s.link_href ? (
                          <div style={{ marginTop: 6 }}>
                            <Link href={`${s.link_href}${locQ}`}>
                              {s.link_label || 'Open'} →
                            </Link>
                          </div>
                        ) : null}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {!done && (
                          <>
                            <button
                              type="button"
                              className="btn"
                              disabled={busyId === s.id}
                              onClick={() => patch(s.id, 'done')}
                            >
                              Done
                            </button>
                            <button
                              type="button"
                              className="btn ghost"
                              disabled={busyId === s.id}
                              onClick={() => patch(s.id, 'skipped')}
                            >
                              Skip
                            </button>
                          </>
                        )}
                        {done && (
                          <button
                            type="button"
                            className="btn ghost"
                            disabled={busyId === s.id}
                            onClick={() => patch(s.id, 'todo')}
                          >
                            Reopen
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {steps.length === 0 && (
        <div className="empty" role="status">
          No day-plan steps yet.
        </div>
      )}
    </div>
  );
}
