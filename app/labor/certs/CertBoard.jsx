// @ts-check
'use client';
// Cert expiry board. List all tracked certs sorted by urgency, with an
// add-cert form visible to PIN-authed managers.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

/** @typedef {import('./page.jsx').StaffCertificationRow} StaffCertificationRow */
/** @typedef {import('../../../lib/data.ts').StaffMember} StaffMember */

/**
 * `StaffCertificationRow` plus the derived tone/day fields the board
 * computes for display — never sent to the API.
 * @typedef {StaffCertificationRow & {
 *   days: number | null,
 *   tone: 'green' | 'amber' | 'red' | 'muted',
 * }} CertWithStatus
 */

const CERT_TYPES = [
  { id: 'cfpm', label: 'CFPM (Certified Food Protection Manager)' },
  { id: 'food_handler', label: 'Food-handler card' },
  { id: 'tips', label: 'TIPS / alcohol service' },
  { id: 'allergen', label: 'Allergen awareness' },
  { id: 'other', label: 'Other' },
];

/**
 * @param {string} today
 * @param {string | null} expires
 * @returns {number | null}
 */
function daysBetween(today, expires) {
  if (!expires) return null;
  const a = new Date(today + 'T00:00:00').getTime();
  const b = new Date(expires + 'T00:00:00').getTime();
  return Math.floor((b - a) / 86400000);
}

/** @param {string | null} iso */
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * @param {{
 *   rows: StaffCertificationRow[],
 *   staff: StaffMember[],
 *   today: string,
 *   locationId: string,
 *   pinOk: boolean,
 * }} props
 */
export default function CertBoard({ rows, staff, today, locationId, pinOk }) {
  const router = useRouter();
  const [cookId, setCookId] = useState('');
  const [certType, setCertType] = useState('cfpm');
  const [certLabel, setCertLabel] = useState('');
  const [issuer, setIssuer] = useState('');
  const [certNumber, setCertNumber] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const withStatus = useMemo(() => {
    return rows.map((r) => {
      const days = daysBetween(today, r.expires_on);
      /** @type {CertWithStatus['tone']} */
      let tone = 'green';
      if (r.active === 0) tone = 'muted';
      else if (days === null) tone = 'muted';
      else if (days < 0) tone = 'red';
      else if (days <= 30) tone = 'amber';
      return /** @type {CertWithStatus} */ ({ ...r, days, tone });
    });
  }, [rows, today]);

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const save = async (e) => {
    e.preventDefault();
    if (!cookId) {
      setErr('Pick a worker.');
      return;
    }
    if (!certLabel.trim()) {
      setErr('Cert label is required.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/certifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cook_id: cookId,
          cert_type: certType,
          cert_label: certLabel.trim(),
          issuer: issuer.trim() || null,
          cert_number: certNumber.trim() || null,
          issued_on: issuedOn || null,
          expires_on: expiresOn || null,
          location_id: locationId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Didn\u2019t save — try again');
        return;
      }
      setCookId('');
      setCertLabel('');
      setIssuer('');
      setCertNumber('');
      setIssuedOn('');
      setExpiresOn('');
      router.refresh();
    } catch {
      setErr('Lost connection — not saved');
    } finally {
      setSaving(false);
    }
  };

  /** @param {number} id */
  const deactivate = async (id) => {
    if (!confirm('Mark this certification inactive? Use this when the worker leaves, or the cert is replaced.')) return;
    try {
      const res = await fetch('/api/certifications', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, active: false }),
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
    <div className="cert-page">
      <h1>Certifications</h1>
      <p className="subtitle">
        CO 6 CCR 1010-2 §2-102. CFPM must be on duty during service. Food-handler cards vary by county. A lapsed CFPM at inspection is a citation, not a warning.
      </p>

      {err && <div className="alert alert-red">{err}</div>}

      {!pinOk && (
        <div className="pin-notice">
          Adding or retiring certs requires the manager PIN.{' '}
          <Link href="/login-pin">Enter PIN →</Link>
        </div>
      )}

      <section>
        <h2 className="section-h">All tracked certs ({withStatus.length})</h2>
        {withStatus.length === 0 && <div className="empty-row">Nothing recorded yet.</div>}
        <div className="cert-list">
          {withStatus.map((r) => {
            const worker = staff.find((s) => s.id === r.cook_id);
            const name = worker ? `${worker.first} ${worker.last}` : r.cook_id;
            return (
              <article key={r.id} className={`cert-row cert-tone-${r.tone}`}>
                <div>
                  <div className="cert-name">{name}</div>
                  <div className="cert-meta">
                    {r.cert_type.toUpperCase()} · {r.cert_label}
                    {r.issuer && ` · ${r.issuer}`}
                    {r.cert_number && ` · #${r.cert_number}`}
                  </div>
                </div>
                <div className="cert-expiry">
                  {r.expires_on ? fmtDate(r.expires_on) : 'no expiry'}
                  <span className="cert-expiry-sub">
                    {r.active === 0
                      ? 'inactive'
                      : r.days === null
                      ? ''
                      : r.days < 0
                      ? `expired ${-r.days}d ago`
                      : r.days === 0
                      ? 'expires today'
                      : `${r.days}d left`}
                  </span>
                </div>
                {pinOk && r.active === 1 && (
                  <button onClick={() => deactivate(r.id)} className="btn-ghost">
                    Retire
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {pinOk && (
        <section className="cert-card">
          <h2 className="section-h">Add a cert</h2>
          <form onSubmit={save} className="cert-form">
            <label>
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
            <label>
              <span>Type</span>
              <select value={certType} onChange={(e) => setCertType(e.target.value)}>
                {CERT_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Label</span>
              <input
                value={certLabel}
                onChange={(e) => setCertLabel(e.target.value)}
                placeholder="ServSafe Manager"
                required
              />
            </label>
            <label>
              <span>Issuer</span>
              <input
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
                placeholder="ServSafe / ANSI-CFP"
              />
            </label>
            <label>
              <span>Cert #</span>
              <input value={certNumber} onChange={(e) => setCertNumber(e.target.value)} />
            </label>
            <label>
              <span>Issued</span>
              <input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
            </label>
            <label>
              <span>Expires</span>
              <input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            </label>
            <button type="submit" disabled={saving} className="cert-submit">
              {saving ? 'Saving…' : 'Add cert'}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
