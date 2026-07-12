// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
'use client';

import { useEffect, useState } from 'react';

/** @typedef {import('../../../lib/db.ts').CleaningScheduleItem} CleaningScheduleItem */

/**
 * @typedef {{
 *   area: string,
 *   task: string,
 *   frequency: string,
 *   last_done: string,
 *   next_due: string,
 *   notes: string,
 * }} CleaningScheduleDraft
 */

/**
 * Partial patch sent on PATCH /api/cleaning-schedule. Mirrors the
 * `'field' in body` branches the route handler accepts.
 * @typedef {{
 *   area?: string,
 *   task?: string,
 *   frequency?: string,
 *   last_done?: string | null,
 *   next_due?: string | null,
 *   notes?: string | null,
 *   active?: number,
 * }} CleaningScheduleRowPatch
 */

/** @returns {CleaningScheduleDraft} */
const emptyDraft = () => ({
  area: '',
  task: '',
  frequency: '',
  last_done: '',
  next_due: '',
  notes: '',
});

/**
 * @param {{
 *   location: { id: string, name: string },
 *   initialRows: CleaningScheduleItem[] | undefined,
 * }} props
 */
export default function CleaningScheduleEditor({ location, initialRows }) {
  const [rows, setRows] = useState(initialRows || []);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(emptyDraft());

  /** @param {boolean} withArchived */
  const loadRows = async (withArchived) => {
    setLoading(true);
    setErr('');
    try {
      const qs = new URLSearchParams({ location: location.id });
      if (withArchived) qs.set('includeArchived', '1');
      const res = await fetch(`/api/cleaning-schedule?${qs.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const j = await res.json();
      setRows(j.rows || []);
    } catch (e) {
      setErr((e instanceof Error && e.message) || 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  // Refetch when the archive toggle changes.
  useEffect(() => {
    loadRows(showArchived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived, location.id]);

  const createRow = async () => {
    setErr('');
    setMsg('');
    if (!draft.area.trim()) {
      setErr('Area is required.');
      return;
    }
    if (!draft.task.trim()) {
      setErr('Task is required.');
      return;
    }
    if (!draft.frequency.trim()) {
      setErr('Frequency is required.');
      return;
    }
    try {
      const res = await fetch('/api/cleaning-schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          location_id: location.id,
          area: draft.area.trim(),
          task: draft.task.trim(),
          frequency: draft.frequency.trim(),
          last_done: draft.last_done.trim() || null,
          next_due: draft.next_due.trim() || null,
          notes: draft.notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j?.error || `HTTP ${res.status}`);
        return;
      }
      setAdding(false);
      setDraft(emptyDraft());
      setMsg('Added.');
      await loadRows(showArchived);
    } catch {
      setErr('Network error — retry.');
    }
  };

  /**
   * @param {number} id
   * @param {CleaningScheduleRowPatch} patch
   */
  const saveRow = async (id, patch) => {
    setErr('');
    setMsg('');
    try {
      const res = await fetch('/api/cleaning-schedule', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j?.error || `HTTP ${res.status}`);
        return;
      }
      setMsg('Saved.');
      await loadRows(showArchived);
    } catch {
      setErr('Network error — retry.');
    }
  };

  /** @param {number} id */
  const archiveRow = async (id) => {
    if (!window.confirm('Archive this cleaning schedule row? It will be hidden from the live list.')) {
      return;
    }
    setErr('');
    setMsg('');
    try {
      const res = await fetch('/api/cleaning-schedule', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j?.error || `HTTP ${res.status}`);
        return;
      }
      setMsg('Archived.');
      await loadRows(showArchived);
    } catch {
      setErr('Network error — retry.');
    }
  };

  /** @param {number} id */
  const unarchiveRow = async (id) => {
    await saveRow(id, { active: 1 });
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ marginTop: 0 }}>{location.name}</h3>
        <span className="meta" style={{ fontSize: 11 }}>id: {location.id}</span>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
        <label className="meta" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
        <button
          type="button"
          className="btn green"
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? 'Cancel' : 'Add row'}
        </button>
        {loading && <span className="meta">Loading…</span>}
        {msg && (
          <span className="meta" style={{ color: 'var(--green, #1f9d55)' }}>{msg}</span>
        )}
        {err && <span className="meta text-red">{err}</span>}
      </div>

      {adding && (
        <div
          style={{
            display: 'grid',
            gap: 8,
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            padding: 10,
            border: '1px dashed var(--border, #ccc)',
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          <div>
            <label className="meta">Area</label>
            <input
              className="input"
              value={draft.area}
              onChange={(e) => setDraft({ ...draft, area: e.target.value })}
              placeholder="Line / FOH / Walk-in"
            />
          </div>
          <div>
            <label className="meta">Task</label>
            <input
              className="input"
              value={draft.task}
              onChange={(e) => setDraft({ ...draft, task: e.target.value })}
              placeholder="Deep clean flat-top"
            />
          </div>
          <div>
            <label className="meta">Frequency</label>
            <input
              className="input"
              value={draft.frequency}
              onChange={(e) => setDraft({ ...draft, frequency: e.target.value })}
              placeholder="daily / weekly / monthly"
            />
          </div>
          <div>
            <label className="meta">Last done</label>
            <input
              type="date"
              className="input"
              value={draft.last_done}
              onChange={(e) => setDraft({ ...draft, last_done: e.target.value })}
            />
          </div>
          <div>
            <label className="meta">Next due</label>
            <input
              type="date"
              className="input"
              value={draft.next_due}
              onChange={(e) => setDraft({ ...draft, next_due: e.target.value })}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="meta">Notes</label>
            <input
              className="input"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <button type="button" className="btn green" onClick={createRow}>
              Save new row
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="meta">No cleaning schedule rows for this location.</p>
      ) : (
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Area</th>
              <th>Task</th>
              <th>Frequency</th>
              <th>Last done</th>
              <th>Next due</th>
              <th>Notes</th>
              <th>Active</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <EditableRow
                key={row.id}
                row={row}
                onSave={saveRow}
                onArchive={archiveRow}
                onUnarchive={unarchiveRow}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * @param {{
 *   row: CleaningScheduleItem,
 *   onSave: (id: number, patch: CleaningScheduleRowPatch) => Promise<void>,
 *   onArchive: (id: number) => Promise<void>,
 *   onUnarchive: (id: number) => Promise<void>,
 * }} props
 */
function EditableRow({ row, onSave, onArchive, onUnarchive }) {
  const [area, setArea] = useState(row.area || '');
  const [task, setTask] = useState(row.task || '');
  const [frequency, setFrequency] = useState(row.frequency || '');
  const [lastDone, setLastDone] = useState(row.last_done || '');
  const [nextDue, setNextDue] = useState(row.next_due || '');
  const [notes, setNotes] = useState(row.notes || '');
  const [active, setActive] = useState(Number(row.active) === 1);
  const [saving, setSaving] = useState(false);

  // Re-sync local state if parent re-fetches and the identity of row changes.
  useEffect(() => {
    setArea(row.area || '');
    setTask(row.task || '');
    setFrequency(row.frequency || '');
    setLastDone(row.last_done || '');
    setNextDue(row.next_due || '');
    setNotes(row.notes || '');
    setActive(Number(row.active) === 1);
  }, [row.id, row.area, row.task, row.frequency, row.last_done, row.next_due, row.notes, row.active]);

  const isArchived = !!row.archived_at;
  const dirty =
    (row.area || '') !== area ||
    (row.task || '') !== task ||
    (row.frequency || '') !== frequency ||
    (row.last_done || '') !== lastDone ||
    (row.next_due || '') !== nextDue ||
    (row.notes || '') !== notes ||
    (Number(row.active) === 1) !== active;

  const save = async () => {
    setSaving(true);
    try {
      await onSave(row.id, {
        area: area.trim(),
        task: task.trim(),
        frequency: frequency.trim(),
        last_done: lastDone.trim() || null,
        next_due: nextDue.trim() || null,
        notes: notes.trim() || null,
        active: active ? 1 : 0,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr style={isArchived ? { opacity: 0.55 } : undefined}>
      <td>
        <input
          className="input"
          value={area}
          onChange={(e) => setArea(e.target.value)}
          placeholder="Line"
        />
      </td>
      <td>
        <input
          className="input"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Deep clean flat-top"
        />
      </td>
      <td>
        <input
          className="input"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value)}
          placeholder="weekly"
          style={{ width: 120 }}
        />
      </td>
      <td>
        <input
          type="date"
          className="input"
          value={lastDone}
          onChange={(e) => setLastDone(e.target.value)}
          style={{ width: 140 }}
        />
      </td>
      <td>
        <input
          type="date"
          className="input"
          value={nextDue}
          onChange={(e) => setNextDue(e.target.value)}
          style={{ width: 140 }}
        />
      </td>
      <td>
        <input
          className="input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </td>
      <td style={{ textAlign: 'center' }}>
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          disabled={isArchived}
          title={isArchived ? 'Unarchive first' : 'Active'}
        />
        {isArchived && <div className="meta" style={{ fontSize: 10 }}>archived</div>}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <button
          type="button"
          className="btn green"
          onClick={save}
          disabled={saving || !dirty}
          style={{ marginRight: 6 }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {isArchived ? (
          <button
            type="button"
            className="btn"
            onClick={() => onUnarchive(row.id)}
            title="Unarchive this row"
          >
            Unarchive
          </button>
        ) : (
          <button
            type="button"
            className="btn text-red"
            onClick={() => onArchive(row.id)}
            title="Archive this row"
          >
            ×
          </button>
        )}
      </td>
    </tr>
  );
}
