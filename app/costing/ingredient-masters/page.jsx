// @ts-check
// /costing/ingredient-masters — operator review surface for the
// ingredient_masters table.
//
// ingredient_masters is populated by scripts/ingest-costing.mjs (T7) from
// confirmed vendor-ingredient → ingredient_key maps. The runtime ingest
// preserves operator-set preferred_vendor across re-ingests and leaves
// category NULL when the seed didn't carry one. This page lets the
// operator:
//   - search/filter by canonical name or master_id,
//   - see how many vendor_prices + bom_lines map to each master,
//   - mark a master "reviewed" (stamps last_reviewed = datetime('now'))
//     so the needs-review queue shrinks over time.
//
// In-place editing of canonical_name / category / preferred_vendor is
// supported by the API (PATCH /api/costing/ingredient-masters with
// updates: {...}) but the UI shows them read-only for now — a future
// "Edit" island can hook the same route without backend changes.

import Link from 'next/link';
import { getDb } from '../../../lib/db';
import { listMasters } from '../../../lib/ingredientMastersRepo';
import MarkReviewedButton from './MarkReviewedButton.jsx';

/** @typedef {import('../../../lib/ingredientMastersRepo.ts').ListMastersOpts['filter']} MasterFilter */
/** @typedef {Record<string, string | string[] | undefined>} PageSearchParams */

export const dynamic = 'force-dynamic';

/** @type {{ value: NonNullable<MasterFilter>, label: string }[]} */
const FILTER_OPTIONS = [
  { value: 'needs_review', label: 'Needs review' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'all', label: 'All' },
];

/** @param {string | null | undefined} iso */
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** @param {{ searchParams: Promise<PageSearchParams> }} props */
export default async function IngredientMastersPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const filterRaw =
    typeof sp?.filter === 'string' ? sp.filter : 'needs_review';
  const filter = FILTER_OPTIONS.some((o) => o.value === filterRaw)
    ? /** @type {NonNullable<MasterFilter>} */ (filterRaw)
    : 'needs_review';
  const q =
    typeof sp?.q === 'string' && sp.q.trim()
      ? sp.q.trim()
      : null;

  const db = getDb();
  const masters = listMasters(db, { q, filter, limit: 200 });

  // Count totals for the filter buttons.
  const totalAll = listMasters(db, { limit: 1000 }).length;
  const totalNeedsReview = listMasters(db, { filter: 'needs_review', limit: 1000 }).length;
  const totalReviewed = listMasters(db, { filter: 'reviewed', limit: 1000 }).length;

  return (
    <div>
      <h1>Ingredient masters</h1>
      <p className="subtitle">
        Main ingredient list — the link between vendor prices and recipe costs.
        Check off each one as you confirm it so the queue shrinks.
        {' '}
        <strong>{totalNeedsReview}</strong> need a look · {totalReviewed} checked · {totalAll} total.
      </p>

      <form
        className="card form-row"
        method="get"
        style={{ marginBottom: 16, gap: 8, alignItems: 'center', display: 'flex', flexWrap: 'wrap' }}
      >
        <input
          type="search"
          name="q"
          placeholder="Search by master id or canonical name…"
          defaultValue={q || ''}
          style={{
            padding: '6px 10px',
            borderRadius: 4,
            border: '1px solid var(--line, #cfc6b0)',
            minWidth: 260,
          }}
        />
        <select
          name="filter"
          defaultValue={filter}
          style={{
            padding: '6px 10px',
            borderRadius: 4,
            border: '1px solid var(--line, #cfc6b0)',
          }}
        >
          {FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          style={{
            padding: '6px 14px',
            borderRadius: 4,
            border: '1px solid var(--line, #cfc6b0)',
            background: 'var(--panel-2, #f7f2e8)',
            cursor: 'pointer',
          }}
        >
          Apply
        </button>
        {(q || filter !== 'needs_review') && (
          <Link
            href="/costing/ingredient-masters"
            style={{ fontSize: 13, color: 'var(--muted, #6b5e44)' }}
          >
            Reset
          </Link>
        )}
      </form>

      {masters.length === 0 ? (
        <div className="card" style={{ padding: 18 }}>
          <p className="row-meta">No masters match the current filter.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--panel-2, #f7f2e8)', textAlign: 'left' }}>
                <th style={cellHead}>Master</th>
                <th style={cellHead}>Canonical name</th>
                <th style={cellHead}>Category</th>
                <th style={cellHead}>Pref. vendor</th>
                <th style={{ ...cellHead, textAlign: 'right' }}>VP</th>
                <th style={{ ...cellHead, textAlign: 'right' }}>BOM</th>
                <th style={cellHead}>Reviewed</th>
                <th style={cellHead}>Action</th>
              </tr>
            </thead>
            <tbody>
              {masters.map((m) => (
                <tr
                  key={m.master_id}
                  style={{ borderTop: '1px solid var(--line, #cfc6b0)' }}
                >
                  <td style={{ ...cell, fontFamily: 'monospace', fontSize: 12 }}>
                    {m.master_id}
                  </td>
                  <td style={cell}>{m.canonical_name}</td>
                  <td style={cell}>{m.category || <em style={{ color: 'var(--muted)' }}>—</em>}</td>
                  <td style={cell}>{m.preferred_vendor || <em style={{ color: 'var(--muted)' }}>—</em>}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{m.vendor_price_count}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{m.bom_line_count}</td>
                  <td style={cell}>{fmtDate(m.last_reviewed)}</td>
                  <td style={cell}>
                    <MarkReviewedButton masterId={m.master_id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const cellHead = {
  padding: '10px 12px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--muted, #6b5e44)',
};
const cell = { padding: '10px 12px', fontSize: 14, verticalAlign: 'middle' };
