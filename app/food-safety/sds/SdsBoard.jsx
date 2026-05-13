// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';

const HAZARD_CLASSES = [
  '',
  'flammable',
  'corrosive',
  'oxidizer',
  'toxic',
  'irritant',
  'environmental',
  'compressed_gas',
  'explosive',
  'health_hazard',
  'other',
];

function fmtDate(s) {
  if (!s) return '—';
  return s.slice(0, 10);
}

export default function SdsBoard({ rows, locationId, citation }) {
  const router = useRouter();
  const [cookId, setCookId] = useState('');
  const [productName, setProductName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [hazardClass, setHazardClass] = useState('');
  const [storage, setStorage] = useState('');
  const [pdfPath, setPdfPath] = useState('');
  const [url, setUrl] = useState('');
  const [lastReviewed, setLastReviewed] = useState('');
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.product_name || '').toLowerCase().includes(q) ||
        (r.manufacturer || '').toLowerCase().includes(q) ||
        (r.hazard_class || '').toLowerCase().includes(q),
    );
  }, [rows, filter]);

  const submit = async (e) => {
    e.preventDefault();
    if (!productName.trim()) return;
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/sds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          product_name: productName.trim(),
          manufacturer: manufacturer.trim() || null,
          hazard_class: hazardClass || null,
          storage_location: storage.trim() || null,
          pdf_path: pdfPath.trim() || null,
          url: url.trim() || null,
          last_reviewed: lastReviewed.trim() || null,
          cook_id: cookId || null,
          location_id: locationId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Didn’t save — try again');
        return;
      }
      setProductName('');
      setManufacturer('');
      setHazardClass('');
      setStorage('');
      setPdfPath('');
      setUrl('');
      setLastReviewed('');
      router.refresh();
    } catch {
      setErr('Lost connection — not saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h1>Safety data sheets</h1>
      <p className="subtitle">{citation}</p>

      {err && (
        <div className="alert alert-red" role="alert" aria-live="assertive">
          {err}
        </div>
      )}

      <section style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <h2 className="section-h">Registry ({rows.length})</h2>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by product, manufacturer, hazard"
            style={{ minWidth: 240 }}
          />
        </div>
        {filtered.length === 0 ? (
          <div className="empty-row" role="status" aria-live="polite">
            {rows.length === 0
              ? 'No SDS records yet — add one below.'
              : 'No matches for that filter.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th>Product</th>
                <th>Manufacturer</th>
                <th>Hazard</th>
                <th>Storage</th>
                <th>Sheet</th>
                <th>Last reviewed</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.product_name}</td>
                  <td>{r.manufacturer || '—'}</td>
                  <td>{r.hazard_class || '—'}</td>
                  <td>{r.storage_location || '—'}</td>
                  <td>
                    {r.pdf_path || r.url ? (
                      <a href={r.pdf_path || r.url} target="_blank" rel="noopener noreferrer">
                        view
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{fmtDate(r.last_reviewed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card" style={{ padding: 16, marginTop: 18 }}>
        <h2 className="section-h">Add SDS</h2>
        <form onSubmit={submit} aria-busy={saving} style={{ display: 'grid', gap: 10 }}>
          <label>
            <span>Product name</span>
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="e.g. Quat-256, Sani-Brite"
              autoComplete="off"
              maxLength={200}
              required
            />
          </label>
          <div className="grid-2" style={{ gap: 10 }}>
            <label>
              <span>Manufacturer</span>
              <input
                type="text"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                maxLength={200}
              />
            </label>
            <label>
              <span>Hazard class</span>
              <select
                value={hazardClass}
                onChange={(e) => setHazardClass(e.target.value)}
              >
                {HAZARD_CLASSES.map((h) => (
                  <option key={h || '_none'} value={h}>
                    {h || '— none —'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <span>Storage location</span>
            <input
              type="text"
              value={storage}
              onChange={(e) => setStorage(e.target.value)}
              placeholder="e.g. Chemical cabinet, dish area"
              maxLength={200}
            />
          </label>
          <div className="grid-2" style={{ gap: 10 }}>
            <label>
              <span>PDF path or URL</span>
              <input
                type="text"
                value={pdfPath}
                onChange={(e) => setPdfPath(e.target.value)}
                placeholder="/sds/quat-256.pdf or https://…"
                maxLength={300}
              />
            </label>
            <label>
              <span>Last reviewed (YYYY-MM-DD)</span>
              <input
                type="date"
                value={lastReviewed}
                onChange={(e) => setLastReviewed(e.target.value)}
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={saving}
            aria-label={saving ? 'Saving SDS entry' : 'Add SDS to registry'}
          >
            {saving ? 'Saving…' : 'Add to registry'}
          </button>
        </form>
      </section>
    </div>
  );
}
