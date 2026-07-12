// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
'use client';

import { useEffect, useState } from 'react';

/** @typedef {import('../../../lib/db.ts').ServiceHoursRow} ServiceHoursRow */

/**
 * @typedef {{
 *   day_of_week: string,
 *   service_label: string,
 *   opens_at: string,
 *   closes_at: string,
 *   notes: string,
 * }} ServiceHoursDraft
 */

/**
 * Partial patch sent on PATCH /api/service-hours. Mirrors the
 * `'field' in body` branches the route handler accepts.
 * @typedef {{
 *   day_of_week?: number,
 *   service_label?: string | null,
 *   opens_at?: string | null,
 *   closes_at?: string | null,
 *   notes?: string | null,
 *   active?: number,
 * }} ServiceHoursRowPatch
 */

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** @returns {ServiceHoursDraft} */
const emptyDraft = () => ({
  day_of_week: '0',
  service_label: '',
  opens_at: '',
  closes_at: '',
  notes: '',
});

/**
 * @param {{
 *   location: { id: string, name: string },
 *   initialRows: ServiceHoursRow[] | undefined,
 * }} props
 */
export default function ServiceHoursEditor({ location, initialRows }) {
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
      const res = await fetch(`/api/service-hours?${qs.toString()}`, {
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
    const dow = Number(draft.day_of_week);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
      setErr('Pick a day (Sunday–Saturday).');
      return;
    }
    try {
      const res = await fetch('/api/service-hours', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          location_id: location.id,
          day_of_week: dow,
          service_label: draft.service_label.trim() || null,
          opens_at: draft.opens_at.trim() || null,
          closes_at: draft.closes_at.trim() || null,
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
   * @param {ServiceHoursRowPatch} patch
   */
  const saveRow = async (id, patch) => {
    setErr('');
    setMsg('');
    try {
      const res = await fetch('/api/service-hours', {
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
    if (!window.confirm('Archive this service hour row? It will be hidden from the live list.')) {
      return;
    }
    setErr('');
    setMsg('');
    try {
      const res = await fetch('/api/service-hours', {
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
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            padding: 10,
            border: '1px dashed var(--border, #ccc)',
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          <div>
            <label className="meta">Day</label>
            <select
              className="input"
              value={draft.day_of_week}
              onChange={(e) => setDraft({ ...draft, day_of_week: e.target.value })}
            >
              {DAY_NAMES.map((name, i) => (
                <option key={i} value={String(i)}>{name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="meta">Label</label>
            <input
              className="input"
              value={draft.service_label}
              onChange={(e) => setDraft({ ...draft, service_label: e.target.value })}
              placeholder="Dinner"
            />
          </div>
          <div>
            <label className="meta">Opens</label>
            <input
              className="input"
              value={draft.opens_at}
              onChange={(e) => setDraft({ ...draft, opens_at: e.target.value })}
              placeholder="17:00"
            />
          </div>
          <div>
            <label className="meta">Closes</label>
            <input
              className="input"
              value={draft.closes_at}
              onChange={(e) => setDraft({ ...draft, closes_at: e.target.value })}
              placeholder="22:00"
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
        <p className="meta">No service hours configured for this location.</p>
      ) : (
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Day</th>
              <th>Label</th>
              <th>Opens</th>
              <th>Closes</th>
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
 *   row: ServiceHoursRow,
 *   onSave: (id: number, patch: ServiceHoursRowPatch) => Promise<void>,
 *   onArchive: (id: number) => Promise<void>,
 *   onUnarchive: (id: number) => Promise<void>,
 * }} props
 */
function EditableRow({ row, onSave, onArchive, onUnarchive }) {
  const [dow, setDow] = useState(String(row.day_of_week));
  const [label, setLabel] = useState(row.service_label || '');
  const [opens, setOpens] = useState(row.opens_at || '');
  const [closes, setCloses] = useState(row.closes_at || '');
  const [notes, setNotes] = useState(row.notes || '');
  const [active, setActive] = useState(Number(row.active) === 1);
  const [saving, setSaving] = useState(false);

  // Re-sync local state if parent re-fetches and the identity of row changes.
  useEffect(() => {
    setDow(String(row.day_of_week));
    setLabel(row.service_label || '');
    setOpens(row.opens_at || '');
    setCloses(row.closes_at || '');
    setNotes(row.notes || '');
    setActive(Number(row.active) === 1);
  }, [row.id, row.day_of_week, row.service_label, row.opens_at, row.closes_at, row.notes, row.active]);

  const isArchived = !!row.archived_at;
  const dirty =
    String(row.day_of_week) !== dow ||
    (row.service_label || '') !== label ||
    (row.opens_at || '') !== opens ||
    (row.closes_at || '') !== closes ||
    (row.notes || '') !== notes ||
    (Number(row.active) === 1) !== active;

  const save = async () => {
    setSaving(true);
    try {
      await onSave(row.id, {
        day_of_week: Number(dow),
        service_label: label.trim() || null,
        opens_at: opens.trim() || null,
        closes_at: closes.trim() || null,
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
        <select
          className="input"
          value={dow}
          onChange={(e) => setDow(e.target.value)}
        >
          {DAY_NAMES.map((name, i) => (
            <option key={i} value={String(i)}>{name}</option>
          ))}
        </select>
      </td>
      <td>
        <input
          className="input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Dinner"
        />
      </td>
      <td>
        <input
          className="input"
          value={opens}
          onChange={(e) => setOpens(e.target.value)}
          placeholder="17:00"
          style={{ width: 90 }}
        />
      </td>
      <td>
        <input
          className="input"
          value={closes}
          onChange={(e) => setCloses(e.target.value)}
          placeholder="22:00"
          style={{ width: 90 }}
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
