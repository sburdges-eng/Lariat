'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDollars } from '../../../../lib/formatMoney';

function formatDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}

function slugifyName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

const DEFAULT_LOCATION_ID = 'default';

export default function SpecialDetailClient({ special, locationId }) {
  const router = useRouter();
  const locQ = locationId && locationId !== DEFAULT_LOCATION_ID
    ? `?location=${encodeURIComponent(locationId)}`
    : '';

  const [name, setName] = useState(special.name);
  const [scratch, setScratch] = useState(special.scratch_notes);
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaErr, setMetaErr] = useState('');

  const [showExport, setShowExport] = useState(false);
  const [exportSlug, setExportSlug] = useState(slugifyName(special.name));
  const [exportYieldQty, setExportYieldQty] = useState('');
  const [exportYieldUnit, setExportYieldUnit] = useState('portions');
  const [exportCategory, setExportCategory] = useState('');
  const [exportProcedure, setExportProcedure] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState('');
  const [exportResult, setExportResult] = useState(null);

  const saveMeta = async () => {
    setMetaErr('');
    setSavingMeta(true);
    try {
      const res = await fetch(`/api/specials/saved/${special.id}${locQ}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scratch_notes: scratch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMetaErr(data.error || 'Save failed.');
    } catch (e) {
      setMetaErr(String(e.message || e));
    } finally {
      setSavingMeta(false);
    }
  };

  const onDelete = async () => {
    if (!confirm('Delete this saved special? It will be removed from the list.')) return;
    const res = await fetch(`/api/specials/saved/${special.id}${locQ}`, { method: 'DELETE' });
    if (res.ok) router.push(`/specials/saved${locQ}`);
  };

  const submitExport = async (e) => {
    e.preventDefault();
    setExportErr('');
    setExportResult(null);
    setExporting(true);
    try {
      const res = await fetch(`/api/specials/saved/${special.id}/export${locQ}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: exportSlug,
          yield_qty: Number(exportYieldQty),
          yield_unit: exportYieldUnit,
          category: exportCategory,
          procedure_override: exportProcedure || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setExportErr(data.error || 'Export failed.');
        return;
      }
      setExportResult(data);
    } catch (e) {
      setExportErr(String(e.message || e));
    } finally {
      setExporting(false);
    }
  };

  const downloadCsv = (csv) => {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportSlug}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <h1>{special.name}</h1>
      <p className="meta mb-12">
        Created {formatDateTime(special.created_at)}
        {special.last_exported_at ? ` · Last exported ${formatDateTime(special.last_exported_at)}` : ''}
      </p>

      <div className="grid-2">
        <div>
          <div className="card">
            <h2 className="section-head mb-12">Session</h2>
            {special.pantry_text && (
              <>
                <h3 className="label mb-12">Pantry</h3>
                <p className="mb-12" style={{ whiteSpace: 'pre-wrap' }}>{special.pantry_text}</p>
              </>
            )}
            {special.prompt_text && (
              <>
                <h3 className="label mb-12">Prompt</h3>
                <p className="mb-12" style={{ whiteSpace: 'pre-wrap' }}>{special.prompt_text}</p>
              </>
            )}
            <h3 className="label mb-12">AI answer</h3>
            <div style={{ whiteSpace: 'pre-wrap' }}>{special.ai_answer}</div>
            {special.ai_model && <p className="meta mb-12" style={{ marginTop: 12 }}>Model: <code>{special.ai_model}</code></p>}
          </div>

          {special.cost_breakdown.length > 0 && (
            <div className="card">
              <h2 className="section-head mb-12">Cost breakdown</h2>
              {special.cost_total !== null && <p className="mb-12"><strong>{formatDollars(special.cost_total)}</strong></p>}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Ingredient</th>
                    <th style={{ textAlign: 'left' }}>Requested</th>
                    <th style={{ textAlign: 'left' }}>Vendor match</th>
                    <th style={{ textAlign: 'right' }}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {special.cost_breakdown.map((row, i) => (
                    <tr key={i}>
                      <td>{row.item}</td>
                      <td>{row.req_qty} {row.req_unit}</td>
                      <td>{row.match || <em>unmatched</em>}</td>
                      <td style={{ textAlign: 'right' }}>{formatDollars(row.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <div className="card">
            <h2 className="section-head mb-12">Edit</h2>
            <label className="label mb-12">Name</label>
            <input className="input mb-12" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            <label className="label mb-12">Notes</label>
            <textarea
              className="input mb-12"
              style={{ minHeight: '300px', fontFamily: 'monospace' }}
              value={scratch}
              onChange={(e) => setScratch(e.target.value)}
            />
            <div className="flex-center-gap">
              <button type="button" className="btn primary" onClick={saveMeta} disabled={savingMeta || !name.trim()}>
                {savingMeta ? 'Saving...' : 'Save changes'}
              </button>
              <button type="button" className="btn" onClick={onDelete}>Delete</button>
            </div>
            {metaErr && <p className="meta mb-12" style={{ color: 'var(--red)' }}>{metaErr}</p>}
          </div>

          <div className="card">
            <h2 className="section-head mb-12">Export to recipe (CSV)</h2>
            <p className="meta mb-12">Generates a workbook-pasteable CSV. Doesn&apos;t modify the recipe DB — paste into the master workbook on your next ingest pass.</p>
            {!showExport ? (
              <button type="button" className="btn" onClick={() => setShowExport(true)}>Export</button>
            ) : (
              <form onSubmit={submitExport}>
                <label className="label mb-12">Slug</label>
                <input className="input mb-12" value={exportSlug} onChange={(e) => setExportSlug(e.target.value)} maxLength={80} />
                <label className="label mb-12">Yield qty</label>
                <input className="input mb-12" type="number" step="any" value={exportYieldQty} onChange={(e) => setExportYieldQty(e.target.value)} />
                <label className="label mb-12">Yield unit</label>
                <input className="input mb-12" value={exportYieldUnit} onChange={(e) => setExportYieldUnit(e.target.value)} maxLength={32} />
                <label className="label mb-12">Category (optional)</label>
                <input className="input mb-12" value={exportCategory} onChange={(e) => setExportCategory(e.target.value)} maxLength={64} />
                <label className="label mb-12">Procedure override (optional)</label>
                <textarea className="input mb-12" rows={4} value={exportProcedure} onChange={(e) => setExportProcedure(e.target.value)} />
                <div className="flex-center-gap">
                  <button
                    type="submit"
                    className="btn primary"
                    disabled={exporting || !exportSlug.trim() || !exportYieldQty}
                  >
                    {exporting ? 'Exporting...' : 'Generate CSV'}
                  </button>
                  <button type="button" className="btn" onClick={() => setShowExport(false)}>Cancel</button>
                </div>
                {exportErr && <p className="meta mb-12" style={{ color: 'var(--red)' }}>{exportErr}</p>}
              </form>
            )}

            {exportResult && (
              <div style={{ marginTop: 16 }}>
                {exportResult.skipped.length > 0 && (
                  <p className="meta mb-12" style={{ color: 'var(--orange, #b00)' }}>
                    {exportResult.skipped.length} unmatched ingredient(s) — pick a vendor item before pasting.
                  </p>
                )}
                <button type="button" className="btn primary" onClick={() => downloadCsv(exportResult.csv)}>Download CSV</button>
                <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', background: 'var(--bg2)', padding: 12, fontSize: 12 }}>
                  {exportResult.csv}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
