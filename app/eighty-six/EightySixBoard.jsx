// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useT, useLocale } from '../_components/I18nProvider.jsx';

// Reason CODES are the API contract (POST /api/eighty-six payloads and
// DB rows keep these values verbatim); only their display labels go
// through the i18n catalog (eightySix.reasons.*).
const REASONS = ['out','spoiled','dropped','no_make','burned','prep_short','other'];

export default function EightySixBoard({ active, resolved, cascaded = [], stations, date, locationId = 'default' }) {
  const router = useRouter();
  const tt = useT();
  const locale = useLocale();
  const [cookId, setCookId] = useState('');
  const [item, setItem] = useState('');
  const [stationId, setStationId] = useState('');
  const [reason, setReason] = useState('out');
  const [quantity, setQuantity] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  // Per-row in-flight guard so a double-tap on the greasy tablet screen
  // can't fire two POSTs to /api/eighty-six/resolve for the same row.
  const resolvingRef = useRef(new Set());
  // Same guard for the add form — `saving` disables the button only after
  // the re-render, so a fast double-tap can still fire two POSTs without this.
  const addingRef = useRef(false);
  // Cascade row awaiting inline confirmation (replaces window.confirm).
  const [confirmSlug, setConfirmSlug] = useState(null);

  useEffect(() => { setCookId(window.localStorage.getItem('lariat_cook') || ''); }, []);

  const add = async (e) => {
    e.preventDefault();
    if (!item.trim()) return;
    if (addingRef.current) return;
    addingRef.current = true;
    setSaving(true);
    setErr('');
    let ok = false;
    try {
      const res = await fetch('/api/eighty-six', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shift_date: date,
          station_id: stationId || null,
          item: item.trim(),
          reason,
          quantity,
          cook_id: cookId,
          location_id: locationId,
        }),
      });
      ok = res.ok;
      if (!ok) setErr(tt('eightySix.saveFailed'));
    } catch {
      setErr(tt('eightySix.lostConnection'));
    }
    addingRef.current = false;
    setSaving(false);
    if (!ok) return;
    setItem(''); setQuantity('');
    router.refresh();
  };

  const resolve = async (id) => {
    if (resolvingRef.current.has(id)) return;
    resolvingRef.current.add(id);
    setErr('');
    try {
      const res = await fetch('/api/eighty-six/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, cook_id: cookId, location_id: locationId }),
      });
      if (!res.ok) {
        setErr(tt('eightySix.saveFailed'));
        return;
      }
    } catch {
      setErr(tt('eightySix.lostConnection'));
      return;
    } finally {
      resolvingRef.current.delete(id);
    }
    router.refresh();
  };

  const confirmCascade = async (c) => {
    setConfirmSlug(null);
    setErr('');
    setSaving(true);
    try {
      const res = await fetch('/api/eighty-six', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shift_date: date,
          station_id: null,
          item: c.name,
          reason: 'prep_short',
          quantity: '',
          cook_id: cookId,
          location_id: locationId,
          note: `uses ${c.via}`,
        }),
      });
      if (!res.ok) setErr(tt('eightySix.saveFailed'));
    } catch {
      setErr(tt('eightySix.lostConnection'));
    }
    setSaving(false);
    router.refresh();
  };

  const itemValid = item.trim().length > 0;

  return (
    <div>
      <h1>{tt('eightySix.title')}</h1>
      <p className="subtitle">{tt('eightySix.subtitle', { count: active.length, n: active.length })}</p>

      <form onSubmit={add} className="card form-row" aria-describedby={err ? 'e86-err' : undefined}>
        <div style={{ flex: '2 1 240px' }}>
          <label className="label" htmlFor="e86-item">{tt('eightySix.itemLabel')}</label>
          <input
            id="e86-item"
            name="e86-item"
            value={item}
            onChange={e => setItem(e.target.value)}
            placeholder={tt('eightySix.itemPlaceholder')}
            className="input form-field"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="send"
            aria-required="true"
            aria-invalid={err && !itemValid ? 'true' : undefined}
          />
        </div>
        <div style={{ flex:'1 1 140px' }}>
          <label className="label" htmlFor="e86-station">{tt('eightySix.stationLabel')}</label>
          <select
            id="e86-station"
            name="e86-station"
            value={stationId}
            onChange={e => setStationId(e.target.value)}
            className="input form-field"
          >
            <option value="">{tt('eightySix.anyStation')}</option>
            {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ flex:'1 1 120px' }}>
          <label className="label" htmlFor="e86-reason">{tt('eightySix.reasonLabel')}</label>
          <select
            id="e86-reason"
            name="e86-reason"
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="input form-field"
          >
            {REASONS.map(r => (
              <option key={r} value={r}>
                {tt(`eightySix.reasons.${r}`)}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex:'0 1 100px' }}>
          <label className="label" htmlFor="e86-qty">{tt('eightySix.qtyLabel')}</label>
          <input
            id="e86-qty"
            name="e86-qty"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            placeholder={tt('eightySix.qtyPlaceholder')}
            className="input form-field"
            inputMode="numeric"
            autoComplete="off"
          />
        </div>
        <button
          type="submit"
          className="btn red lg"
          disabled={saving || !itemValid}
          aria-label={saving ? tt('eightySix.saving') : tt('eightySix.addAria', { item: item.trim() || tt('eightySix.genericItem') })}
        >
          {saving ? tt('eightySix.saving') : tt('eightySix.addButton')}
        </button>
      </form>

      {err && (
        <div
          id="e86-err"
          role="alert"
          aria-live="assertive"
          style={{
            marginTop: 10,
            padding: '10px 14px',
            background: 'rgba(139,46,31,0.08)',
            border: '1px solid var(--red)',
            borderRadius: 6,
            color: 'var(--red)',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {err}
        </div>
      )}

      {active.length === 0 ? (
        <div className="empty" role="status" aria-live="polite">{tt('eightySix.none')}</div>
      ) : (
        <ul className="checklist" aria-label={tt('eightySix.activeListAria')} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {active.map(e => (
            <li key={e.id} className="check-row fail">
              <div>
                <div className="check-name">{e.item}</div>
                <div className="meta">
                  {e.station_id && <>{e.station_id} · </>}
                  {e.reason && <>{tt(`eightySix.reasons.${e.reason}`)} · </>}
                  {e.quantity && <>{e.quantity} · </>}
                  <time dateTime={e.created_at}>{fmtTime(e.created_at, locale)}</time>
                  {e.cook_id && <> · {e.cook_id}</>}
                </div>
              </div>
              <span aria-hidden /><span aria-hidden /><span aria-hidden />
              <button
                className="btn green"
                onClick={() => resolve(e.id)}
                aria-label={tt('eightySix.resolveAria', { item: e.item })}
              >
                {tt('eightySix.resolveButton')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {cascaded.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div className="section-head">{tt('eightySix.cascadeHead')}</div>
          <div className="meta" style={{ marginBottom: 8 }}>
            {tt('eightySix.cascadeHint')}
          </div>
          <div className="checklist" style={{ marginTop: 12 }}>
            {cascaded.map(c => (
              <div key={c.slug} className="check-row">
                <div>
                  <div className="check-name">{c.name}</div>
                  <div className="meta">
                    {tt('eightySix.uses', { via: c.via })}
                    {confirmSlug === c.slug && <> {tt('eightySix.preppedMayBeFine')}</>}
                  </div>
                </div>
                {confirmSlug === c.slug ? (
                  <>
                    <span aria-hidden /><span aria-hidden />
                    <button
                      className="btn"
                      onClick={() => setConfirmSlug(null)}
                      aria-label={tt('eightySix.keepAria', { name: c.name })}
                    >
                      {tt('eightySix.keepIt')}
                    </button>
                    <button
                      className="btn red"
                      disabled={saving}
                      onClick={() => confirmCascade(c)}
                      aria-label={tt('eightySix.confirmAria', { name: c.name })}
                    >
                      {tt('eightySix.yes86')}
                    </button>
                  </>
                ) : (
                  <>
                    <span aria-hidden /><span aria-hidden /><span aria-hidden />
                    <button
                      className="btn red"
                      disabled={saving}
                      onClick={() => setConfirmSlug(c.slug)}
                      aria-expanded={false}
                      aria-label={tt('eightySix.markOutAria', { name: c.name })}
                    >
                      {tt('eightySix.markOutToo')}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {resolved.length > 0 && (
        <details style={{ marginTop: 32 }}>
          <summary className="section-head" style={{ cursor:'pointer' }}>
            {tt('eightySix.resolvedToday', { n: resolved.length })}
          </summary>
          <div className="checklist" style={{ marginTop: 12 }}>
            {resolved.map(e => (
              <div key={e.id} className="check-row resolved">
                <div>
                  <div className="check-name">{e.item}</div>
                  <div className="meta">
                    {e.reason && <>{tt(`eightySix.reasons.${e.reason}`)} · </>}
                    {tt('eightySix.resolvedMeta', { created: fmtTime(e.created_at, locale), resolved: fmtTime(e.resolved_at, locale) })}
                  </div>
                </div>
                <span aria-hidden /><span aria-hidden /><span aria-hidden /><span aria-hidden />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function fmtTime(iso, locale = 'en') {
  if (!iso) return '';
  try {
    const d = new Date(iso.replace(' ', 'T') + 'Z');
    return d.toLocaleTimeString(locale === 'es' ? 'es' : 'en-US', { hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}
