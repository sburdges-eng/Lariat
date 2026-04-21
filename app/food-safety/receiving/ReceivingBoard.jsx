'use client';
// Receiving board — category tiles + quick entry form.
//
// Tone mirrors TempLogBoard:
//   green  — only clean accepts today
//   yellow — at least one accept-with-note and no rejects
//   red    — at least one rejected line
//   gray   — no delivery in this category today
//
// Entry form does live validation against the rule module's drift
// bands. When the typed reading would flag accept-with-note or
// rejected, the corrective-action field surfaces inline so the cook
// doesn't have to submit-and-retry. On a 422 from the server the
// board flips into needsNote mode and red-borders the note field.

import { useEffect, useMemo, useState } from 'react';

function fmtTime(iso) {
  if (!iso) return '—';
  const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(iso);
  const d = new Date(hasTz ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtTemp(f) {
  if (f === null || f === undefined || !Number.isFinite(f)) return '—';
  return `${(Math.round(f * 10) / 10).toFixed(1)}°F`;
}

function boundLabel(r) {
  if (!r.requires_reading) return 'no temp';
  if (r.required_min_f !== null && r.required_max_f !== null) {
    return `${r.required_min_f}–${r.required_max_f}°F`;
  }
  if (r.required_min_f !== null) return `≥ ${r.required_min_f}°F`;
  if (r.required_max_f !== null) return `≤ ${r.required_max_f}°F`;
  return '';
}

// Mirror of lib/receiving.validateReceivingReading for live UI hints.
// Keep behaviorally identical; the server is still the source of truth.
function liveDecision({ rule, reading_f, package_ok, expiration_date, received_at }) {
  if (!rule) return 'ok';
  if (package_ok === false) return 'rejected';
  if (expiration_date && received_at && expiration_date < received_at) return 'rejected';
  if (!rule.requires_reading) return 'ok';
  if (reading_f === null || !Number.isFinite(reading_f)) return null; // unknown
  const { required_min_f: min, required_max_f: max, drift_min_f: dMin, drift_max_f: dMax } = rule;
  if (max !== null && reading_f > max) {
    if (dMax !== null && reading_f <= dMax) return 'accept_with_note';
    return 'rejected';
  }
  if (min !== null && reading_f < min) {
    if (dMin !== null && reading_f >= dMin) return 'accept_with_note';
    return 'rejected';
  }
  return 'ok';
}

export default function ReceivingBoard({
  initialEntries,
  initialSummary,
  categories,
  rules,
  locationId,
  date,
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [entries, setEntries] = useState(initialEntries);
  const [cookId, setCookId] = useState('');

  const [vendor, setVendor] = useState('');
  const [invoice, setInvoice] = useState('');
  const [category, setCategory] = useState(categories[0] || 'refrigerated');
  const [item, setItem] = useState('');
  const [reading, setReading] = useState('');
  const [packageOk, setPackageOk] = useState(true);
  const [expiration, setExpiration] = useState('');
  const [note, setNote] = useState('');
  const [needsNote, setNeedsNote] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  const totals = useMemo(() => {
    let green = 0, yellow = 0, red = 0, gray = 0;
    for (const s of summary) {
      if (s.status === 'green') green += 1;
      else if (s.status === 'yellow') yellow += 1;
      else if (s.status === 'red') red += 1;
      else gray += 1;
    }
    return { green, yellow, red, gray };
  }, [summary]);

  const lineTotals = useMemo(() => {
    const a = entries.filter((e) => e.status === 'accepted').length;
    const n = entries.filter((e) => e.status === 'accepted_with_note').length;
    const r = entries.filter((e) => e.status === 'rejected').length;
    return { a, n, r };
  }, [entries]);

  const activeRule = rules[category] || null;

  const refetch = async () => {
    try {
      const q = locationId && locationId !== 'default' ? `&location=${encodeURIComponent(locationId)}` : '';
      const res = await fetch(`/api/receiving?date=${encodeURIComponent(date)}${q}`);
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.entries)) setEntries(body.entries);
      if (Array.isArray(body.summary)) setSummary(body.summary);
    } catch {
      /* ignore — keep last-good snapshot */
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!vendor.trim() || !category) return;
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/receiving', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shift_date: date,
          location_id: locationId,
          vendor: vendor.trim(),
          invoice_ref: invoice.trim() || null,
          category,
          item: item.trim() || null,
          reading_f: reading.trim() === '' ? null : Number(reading),
          package_ok: packageOk,
          expiration_date: expiration.trim() || null,
          corrective_action: note.trim() || null,
          cook_id: cookId || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (res.status === 422 && j.needs_corrective_action) {
          setNeedsNote(true);
          setErr(`${j.error || 'Needs a corrective action'} — add a note and re-submit.`);
          return;
        }
        setErr(j.error || 'Didn\u2019t save — try again');
        return;
      }
      setVendor('');
      setInvoice('');
      setItem('');
      setReading('');
      setPackageOk(true);
      setExpiration('');
      setNote('');
      setNeedsNote(false);
      await refetch();
    } catch {
      setErr('Lost connection — not saved');
    } finally {
      setSaving(false);
    }
  };

  // Live decision drives whether we pre-surface the note field AND
  // whether we color the reading input red/amber.
  const live = useMemo(() => {
    const r = reading.trim() === '' ? null : Number(reading);
    return liveDecision({
      rule: activeRule,
      reading_f: typeof r === 'number' && Number.isFinite(r) ? r : null,
      package_ok: packageOk,
      expiration_date: expiration.trim() || null,
      received_at: date,
    });
  }, [activeRule, reading, packageOk, expiration, date]);

  const showNoteField = needsNote || live === 'accept_with_note' || live === 'rejected';
  const liveTone =
    live === 'rejected' ? 'rcv-live-red' : live === 'accept_with_note' ? 'rcv-live-yellow' : '';

  return (
    <div className="tl-page">
      <h1>Receiving log</h1>
      <p className="subtitle">
        FDA §3-202.11 receiving thresholds, §3-202.15 package integrity, §3-101.11 sell-by rejection.
        Every delivery to the back door lands here before it touches a walk-in.
      </p>

      <div className="tl-totals">
        <span className="tl-tot tl-tot-green">{totals.green} clean categories</span>
        <span className="tl-tot tl-tot-yellow">{totals.yellow} accept-with-note</span>
        <span className="tl-tot tl-tot-red">{totals.red} with rejects</span>
        <span className="tl-tot tl-tot-gray">{totals.gray} nothing received yet</span>
      </div>
      <div className="tl-totals">
        <span className="tl-tot">{lineTotals.a} accepted</span>
        <span className="tl-tot tl-tot-yellow">{lineTotals.n} with note</span>
        <span className="tl-tot tl-tot-red">{lineTotals.r} rejected</span>
      </div>

      {err && <div className="alert alert-red">{err}</div>}

      <section>
        <h2 className="section-h">By category ({summary.length})</h2>
        <div className="tl-grid">
          {summary.map((s) => (
            <article
              key={s.category}
              className={`tl-tile tl-tone-${s.status}`}
              title={s.citation || undefined}
            >
              <header className="tl-tile-head">
                <span className="tl-tile-name">{s.label}</span>
                <span className="tl-tile-ccp" title={s.citation || undefined}>
                  {s.requires_reading ? boundLabel(s) : 'no temp'}
                </span>
              </header>
              <div className="tl-tile-big">{s.total}</div>
              <div className="tl-tile-meta">
                {s.last_at ? `Last: ${fmtTime(s.last_at)}` : 'No delivery yet'}
              </div>
              <div className="tl-tile-status">
                {s.total === 0 && 'Not received today'}
                {s.total > 0 && s.status === 'green' && `${s.accepted} accepted`}
                {s.status === 'yellow' && `${s.accepted_with_note} with note · ${s.accepted} accepted`}
                {s.status === 'red' && `${s.rejected} rejected · ${s.accepted_with_note} with note · ${s.accepted} accepted`}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="tl-card">
        <h2 className="section-h">Log a delivery line</h2>
        <form onSubmit={submit} className="tl-form rcv-form">
          <label>
            <span>Vendor</span>
            <input
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="e.g. Shamrock, Sysco, Farmers Market Co-op"
              required
            />
          </label>
          <label>
            <span>Invoice / PO #</span>
            <input
              value={invoice}
              onChange={(e) => setInvoice(e.target.value)}
              placeholder="optional — but inspector-friendly"
            />
          </label>
          <label>
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((id) => (
                <option key={id} value={id}>
                  {rules[id]?.label || id}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Item / SKU</span>
            <input
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="e.g. chicken breast 40lb CS"
            />
          </label>
          <label>
            <span>
              Reading °F {activeRule ? `(${boundLabel(activeRule)})` : ''}
              {activeRule && !activeRule.requires_reading ? ' — optional' : ''}
            </span>
            <input
              className={liveTone}
              inputMode="decimal"
              value={reading}
              onChange={(e) => setReading(e.target.value)}
              placeholder={activeRule?.requires_reading ? 'required' : 'optional'}
            />
          </label>
          <label>
            <span>Sell-by date</span>
            <input
              type="date"
              value={expiration}
              onChange={(e) => setExpiration(e.target.value)}
            />
          </label>
          <label className="rcv-form-pkg">
            <input
              type="checkbox"
              checked={packageOk}
              onChange={(e) => setPackageOk(e.target.checked)}
            />
            <span>Package intact (§3-202.15)</span>
          </label>
          {showNoteField && (
            <label className={`tl-form-wide ${live === 'rejected' || needsNote ? 'tl-form-need' : ''}`}>
              <span>
                Corrective action / rejection reason (required —{' '}
                {live === 'rejected'
                  ? 'reject the line'
                  : 'drift band, accept only with a fix recorded'})
              </span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. pulled-down in reach-in, temp verified 39°F 20min later; invoice short pay on line 4"
                maxLength={500}
              />
            </label>
          )}
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Record delivery'}
          </button>
        </form>
      </section>

      {entries && entries.length > 0 && (
        <section>
          <h2 className="section-h">Today&apos;s deliveries ({entries.length})</h2>
          <div className="tl-entries">
            {entries.map((e) => {
              const tone =
                e.status === 'rejected'
                  ? 'red'
                  : e.status === 'accepted_with_note'
                    ? 'yellow'
                    : 'green';
              const rule = rules[e.category];
              return (
                <div key={e.id} className={`tl-entry tl-tone-${tone}`}>
                  <div className="tl-entry-main">
                    <span className="tl-entry-name">
                      {e.vendor}
                      {e.invoice_ref ? ` · ${e.invoice_ref}` : ''}
                      {e.item ? ` · ${e.item}` : ''}
                    </span>
                    <span className="tl-entry-temp">
                      {rule?.label || e.category}
                      {e.reading_f !== null && e.reading_f !== undefined
                        ? ` · ${fmtTemp(e.reading_f)}`
                        : ''}
                    </span>
                  </div>
                  <div className="tl-entry-meta">
                    {fmtTime(e.created_at)}
                    {e.cook_id ? ` · ${e.cook_id}` : ''}
                    {e.expiration_date ? ` · sell-by ${e.expiration_date}` : ''}
                    {e.package_ok === 0 ? ' · PACKAGE COMPROMISED' : ''}
                    {e.rejection_reason ? ` · ${e.rejection_reason}` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
