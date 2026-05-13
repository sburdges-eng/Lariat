// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

import { useState, useEffect, useRef } from 'react';

function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(then.getTime())) return '';
  const secs = Math.max(0, (Date.now() - then.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function PreshiftNotes({ initialNote, shiftDate, serviceLabel, locationId }) {
  const [note, setNote] = useState(initialNote || null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialNote?.body || '');
  const [cookId, setCookId] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  const startEdit = () => {
    setDraft(note?.body || '');
    setErr('');
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(note?.body || '');
    setErr('');
    setEditing(false);
  };

  const save = async () => {
    if (inFlightRef.current) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      setErr('Write something first.');
      return;
    }
    inFlightRef.current = true;
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/preshift-notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: trimmed,
          shift_date: shiftDate,
          service_label: serviceLabel,
          location_id: locationId,
          cook_id: cookId || null,
        }),
      });
      if (!res.ok) {
        setErr('Didn’t save — try again.');
      } else {
        const data = await res.json();
        setNote(data.note);
        setEditing(false);
      }
    } catch {
      setErr('Lost connection — not saved.');
    } finally {
      inFlightRef.current = false;
      setSaving(false);
    }
  };

  const heading = serviceLabel ? `Heads-up for ${serviceLabel.toLowerCase()}` : 'Heads-up for today';

  if (!note && !editing) {
    return (
      <div className="preshift-card preshift-empty">
        <div className="preshift-head">
          <span className="preshift-title">{heading}</span>
          <button type="button" className="btn primary" onClick={startEdit}>
            Add heads-up
          </button>
        </div>
        <div className="preshift-empty-body">Chef hasn’t posted anything yet.</div>
      </div>
    );
  }

  return (
    <div className="preshift-card">
      <div className="preshift-head">
        <span className="preshift-title">{heading}</span>
        {!editing && (
          <button type="button" className="btn" onClick={startEdit}>Edit</button>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            className="input preshift-textarea"
            rows={5}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What the line needs to know. Specials, 86’s, expected covers, focus items…"
            autoFocus
          />
          {err && <div className="preshift-err">{err}</div>}
          <div className="preshift-actions">
            <button type="button" className="btn primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save heads-up'}
            </button>
            <button type="button" className="btn" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="preshift-body">{note.body}</div>
          <div className="preshift-meta">
            {note.author_cook_id ? `— ${note.author_cook_id}` : '— chef'}
            {note.updated_at ? ` · ${timeAgo(note.updated_at)}` : ''}
          </div>
        </>
      )}
    </div>
  );
}
