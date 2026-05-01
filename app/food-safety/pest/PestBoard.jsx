'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const ENTRY_TYPES = [
  { id: 'service_visit', label: 'Service visit' },
  { id: 'sighting', label: 'Sighting' },
  { id: 'trap_check', label: 'Trap check' },
];

const PESTS = [
  { id: '', label: '— none —' },
  { id: 'roach', label: 'Roach' },
  { id: 'mouse', label: 'Mouse' },
  { id: 'fly', label: 'Fly' },
  { id: 'ant', label: 'Ant' },
  { id: 'other', label: 'Other' },
];

const SEVERITIES = [
  { id: '', label: '— none —' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

function fmtDate(iso) {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

export default function PestBoard({ rows, locationId }) {
  const router = useRouter();
  const [cookId, setCookId] = useState('');
  const [entryType, setEntryType] = useState('service_visit');
  const [vendor, setVendor] = useState('');
  const [technician, setTechnician] = useState('');
  const [pest, setPest] = useState('');
  const [severity, setSeverity] = useState('');
  const [findings, setFindings] = useState('');
  const [corrective, setCorrective] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const sightingNeedsPest = entryType === 'sighting';

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (sightingNeedsPest && !pest) {
      setErr('Pick a pest for a sighting.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/pest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entry_type: entryType,
          vendor: vendor.trim() || null,
          technician: technician.trim() || null,
          pest: pest || null,
          severity: severity || null,
          findings: findings.trim() || null,
          corrective_action: corrective.trim() || null,
          cook_id: cookId || null,
          location_id: locationId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Didn’t save — try again');
        return;
      }
      setVendor('');
      setTechnician('');
      setPest('');
      setSeverity('');
      setFindings('');
      setCorrective('');
      router.refresh();
    } catch {
      setErr('Lost connection — not saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h1>Pest control</h1>
      <p className="subtitle">
        Log every PCO service visit, sighting, and trap check. FDA §6-501.111 — control or eliminate pests on the premises.
      </p>

      {err && (
        <div className="alert alert-red" role="alert" aria-live="assertive">
          {err}
        </div>
      )}

      <section style={{ marginTop: 18 }}>
        <h2 className="section-h">Recent ({rows.length})</h2>
        {rows.length === 0 ? (
          <div className="empty-row" role="status" aria-live="polite">
            Nothing logged yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th>Date</th>
                <th>Type</th>
                <th>Vendor / tech</th>
                <th>Pest</th>
                <th>Severity</th>
                <th>Findings</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.shift_date || r.created_at)}</td>
                  <td>{r.entry_type}</td>
                  <td>
                    {r.vendor || '—'}
                    {r.technician ? ` · ${r.technician}` : ''}
                  </td>
                  <td>{r.pest || '—'}</td>
                  <td>{r.severity || '—'}</td>
                  <td>{r.findings || ''}</td>
                  <td>{r.corrective_action || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card" style={{ padding: 16, marginTop: 18 }}>
        <h2 className="section-h">Log an entry</h2>
        <form onSubmit={submit} aria-busy={saving} style={{ display: 'grid', gap: 10 }}>
          <label>
            <span>Type</span>
            <select value={entryType} onChange={(e) => setEntryType(e.target.value)}>
              {ENTRY_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid-2" style={{ gap: 10 }}>
            <label>
              <span>Vendor / PCO</span>
              <input
                type="text"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="e.g. EcoLab"
                maxLength={100}
              />
            </label>
            <label>
              <span>Technician</span>
              <input
                type="text"
                value={technician}
                onChange={(e) => setTechnician(e.target.value)}
                maxLength={100}
              />
            </label>
          </div>
          <div className="grid-2" style={{ gap: 10 }}>
            <label>
              <span>Pest {sightingNeedsPest ? '(required for a sighting)' : '(optional)'}</span>
              <select
                value={pest}
                onChange={(e) => setPest(e.target.value)}
                required={sightingNeedsPest}
                aria-required={sightingNeedsPest ? 'true' : undefined}
              >
                {PESTS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Severity</span>
              <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                {SEVERITIES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <span>Findings</span>
            <input
              type="text"
              value={findings}
              onChange={(e) => setFindings(e.target.value)}
              placeholder="What did the tech / cook see?"
              maxLength={1000}
            />
          </label>
          <label>
            <span>Corrective action</span>
            <input
              type="text"
              value={corrective}
              onChange={(e) => setCorrective(e.target.value)}
              placeholder="What did we do about it?"
              maxLength={500}
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            aria-label={saving ? 'Saving pest entry' : 'Record pest entry'}
          >
            {saving ? 'Saving…' : 'Record entry'}
          </button>
        </form>
      </section>
    </div>
  );
}
