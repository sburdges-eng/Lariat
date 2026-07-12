// @ts-check
'use client';
// PIC-only form + shared read view of who is excluded right now.

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

/** @typedef {import('./page.jsx').ActiveSickRow} ActiveSickRow */
/** @typedef {import('./page.jsx').SickWorkerRow} SickWorkerRow */
/** @typedef {import('../../../lib/data.ts').StaffMember} StaffMember */

const SYMPTOMS = [
  { id: 'vomiting', label: 'Vomiting' },
  { id: 'diarrhea', label: 'Diarrhea' },
  { id: 'jaundice', label: 'Jaundice' },
  { id: 'sore_throat_with_fever', label: 'Sore throat with fever' },
  { id: 'infected_lesion', label: 'Open / infected lesion' },
];

const DIAGNOSES = [
  { id: '', label: '— none reported —' },
  { id: 'norovirus', label: 'Norovirus' },
  { id: 'salmonella_typhi', label: 'Salmonella Typhi' },
  { id: 'salmonella_nontyphoidal', label: 'Salmonella (nontyphoidal)' },
  { id: 'shigella', label: 'Shigella' },
  { id: 'stec_ehec', label: 'STEC / E. coli O157:H7' },
  { id: 'hepatitis_a', label: 'Hepatitis A' },
];

const CLEARANCE_SOURCES = [
  { id: 'asymptomatic_24h', label: 'Asymptomatic ≥ 24h' },
  { id: 'medical_clearance', label: 'Medical clearance (note)' },
  { id: 'health_dept', label: 'Health dept clearance' },
  { id: 'other', label: 'Other (add note)' },
];

/** @param {string | null} iso */
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * @param {{
 *   active: ActiveSickRow[],
 *   history: SickWorkerRow[],
 *   staff: StaffMember[],
 *   pinOk: boolean,
 *   locationId: string,
 * }} props
 */
export default function SickWorkerBoard({ active, history, staff, pinOk, locationId }) {
  const router = useRouter();
  const [cookId, setCookId] = useState('');
  const [picId, setPicId] = useState('');
  const [symptoms, setSymptoms] = useState(/** @type {Record<string, boolean>} */ ({}));
  const [diagnosis, setDiagnosis] = useState('');
  const [action, setAction] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Derive a suggested action from the symptom/diagnosis combo so the
  // PIC can see what FDA would require at minimum — they can raise but
  // not lower.
  const suggestedAction = useMemo(() => {
    const s = Object.keys(symptoms).filter((k) => symptoms[k]);
    const hasBig6 = !!diagnosis;
    const excludeSymptoms = ['vomiting', 'diarrhea', 'jaundice'];
    const restrictSymptoms = ['sore_throat_with_fever', 'infected_lesion'];
    const hasExclude = s.some((x) => excludeSymptoms.includes(x));
    const hasRestrict = s.some((x) => restrictSymptoms.includes(x));
    if (hasBig6 || hasExclude) return 'excluded';
    if (hasRestrict) return 'restricted';
    if (s.length > 0) return 'monitor';
    return 'none';
  }, [symptoms, diagnosis]);

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const fileReport = async (e) => {
    e.preventDefault();
    if (!pinOk) {
      setErr('Manager PIN required to file a sick report.');
      return;
    }
    if (!cookId) {
      setErr('Pick the worker first.');
      return;
    }
    const chosen = Object.keys(symptoms).filter((k) => symptoms[k]);
    if (chosen.length === 0 && !diagnosis) {
      setErr('Either a symptom or a diagnosis is required.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/sick-worker', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cook_id: cookId,
          reported_by_pic_id: picId || null,
          symptoms: chosen,
          diagnosed_illness: diagnosis || null,
          action: action || suggestedAction,
          started_at: new Date().toISOString(),
          note: note.trim() || null,
          location_id: locationId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Didn\u2019t save — try again');
        return;
      }
      setCookId('');
      setSymptoms({});
      setDiagnosis('');
      setAction('');
      setNote('');
      router.refresh();
    } catch {
      setErr('Lost connection — not saved');
    } finally {
      setSaving(false);
    }
  };

  /**
   * @param {number} id
   * @param {string} source
   */
  const clear = async (id, source) => {
    if (!source) return;
    setErr('');
    try {
      const res = await fetch('/api/sick-worker', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id,
          clearance_source: source,
          reported_by_pic_id: picId || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Didn\u2019t save — try again');
        return;
      }
      router.refresh();
    } catch {
      setErr('Lost connection — not saved');
    }
  };

  return (
    <div className="sick-page">
      <h1>Sick worker reports</h1>
      <p className="subtitle">
        FDA §2-201.11 — a report stays open until the worker is cleared. Only the PIC files or closes reports.
      </p>

      {err && <div className="alert alert-red">{err}</div>}

      {!pinOk && (
        <div className="pin-notice">
          Filing and clearing reports requires the manager PIN.{' '}
          <Link href="/login-pin">Enter PIN →</Link>
        </div>
      )}

      <section>
        <h2 className="section-h">Currently excluded / restricted ({active.length})</h2>
        {active.length === 0 && (
          <div className="empty-row">Everybody clear. Line is good to run.</div>
        )}
        <div className="sick-list">
          {active.map((r) => {
            const tone = r.action === 'excluded' ? 'red' : r.action === 'restricted' ? 'amber' : 'blue';
            const worker = staff.find((s) => s.id === r.cook_id);
            const name = worker ? `${worker.first} ${worker.last}` : r.cook_id;
            return (
              <article key={r.id} className={`sick-row sick-tone-${tone}`}>
                <div>
                  <div className="sick-name">{name}</div>
                  <div className="sick-meta">
                    {r.action.toUpperCase()} · since {fmtTime(r.started_at)}
                    {r.diagnosed_illness && ` · ${r.diagnosed_illness}`}
                    {r.symptoms && ` · ${r.symptoms.replaceAll(',', ', ')}`}
                  </div>
                </div>
                {pinOk && (
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const v = e.target.value;
                      e.target.value = '';
                      if (v) clear(r.id, v);
                    }}
                  >
                    <option value="" disabled>
                      Clear to return…
                    </option>
                    {CLEARANCE_SOURCES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {pinOk && (
        <section className="sick-card sick-new">
          <h2 className="section-h">File a new report</h2>
          <form onSubmit={fileReport} className="sick-new-form">
            <label className="sick-label">
              <span>Worker</span>
              <select value={cookId} onChange={(e) => setCookId(e.target.value)} required>
                <option value="">— pick —</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.first} {s.last}
                  </option>
                ))}
              </select>
            </label>
            <label className="sick-label">
              <span>Filed by PIC</span>
              <select value={picId} onChange={(e) => setPicId(e.target.value)}>
                <option value="">— pick —</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.first} {s.last}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="sick-symptoms">
              <legend>Symptoms</legend>
              {SYMPTOMS.map((s) => (
                <label key={s.id} className="sick-chk">
                  <input
                    type="checkbox"
                    checked={!!symptoms[s.id]}
                    onChange={(e) =>
                      setSymptoms((x) => ({ ...x, [s.id]: e.target.checked }))
                    }
                  />
                  <span>{s.label}</span>
                </label>
              ))}
            </fieldset>

            <label className="sick-label">
              <span>Diagnosed illness (if any — Big-6)</span>
              <select value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)}>
                {DIAGNOSES.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="sick-suggest">
              FDA minimum action for this combo: <strong>{suggestedAction}</strong>. You can raise but not lower.
            </div>

            <label className="sick-label">
              <span>Action</span>
              <select value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="">— use FDA minimum ({suggestedAction}) —</option>
                <option value="excluded">Excluded from facility</option>
                <option value="restricted">Restricted from food / clean-contact surfaces</option>
                <option value="monitor">Monitor</option>
                <option value="none">No action</option>
              </select>
            </label>

            <label className="sick-label sick-label-wide">
              <span>Notes (private, not shared with line)</span>
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. sent home, note from doctor expected Monday"
              />
            </label>

            <button type="submit" disabled={saving} className="sick-submit">
              {saving ? 'Filing…' : 'File report'}
            </button>
          </form>
        </section>
      )}

      {pinOk && history.length > 0 && (
        <section>
          <h2 className="section-h">Recently cleared</h2>
          <div className="sick-history-list">
            {history.map((h) => {
              const worker = staff.find((s) => s.id === h.cook_id);
              const name = worker ? `${worker.first} ${worker.last}` : h.cook_id;
              return (
                <div key={h.id} className="sick-history">
                  <span className="sick-history-name">{name}</span>
                  <span className="sick-history-meta">
                    {h.action} · {fmtTime(h.started_at)} → {fmtTime(h.return_at)} · {h.clearance_source || '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
