// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import Link from 'next/link';
import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { formatDollars } from '../../../lib/formatMoney';

export const dynamic = 'force-dynamic';

const SNIPPET_MAX = 120;

function snippet(s) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= SNIPPET_MAX ? t : t.slice(0, SNIPPET_MAX) + '…';
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString();
}

export default function SavedSpecialsPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const locQ = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';

  const db = getDb();
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT id, name, ai_answer, cost_total, last_exported_at, created_at
      FROM specials
      WHERE location_id = ? AND archived_at IS NULL
      ORDER BY created_at DESC
    `).all(loc);
  } catch (e) {
    console.error('saved-specials list query failed:', e);
  }

  return (
    <div>
      <Link href="/specials" style={{ color: 'var(--muted)', fontSize: 13 }}>← Back to Specials</Link>
      <h1>Saved specials</h1>
      <p className="subtitle">Old special ideas someone wanted to keep around.</p>

      {rows.length === 0 ? (
        <div className="card">
          <p className="meta mb-12">No saved specials yet.</p>
          <Link href={`/specials${locQ}`} className="btn">Try the Specials board</Link>
        </div>
      ) : (
        <div className="grid-2">
          {rows.map((r) => (
            <Link key={r.id} href={`/specials/saved/${r.id}${locQ}`} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <h2 className="section-head mb-12">{r.name}</h2>
              <p className="meta mb-12">
                {formatDate(r.created_at)}
                {r.cost_total !== null ? ` · ${formatDollars(r.cost_total)}` : ''}
                {r.last_exported_at ? ' · Exported' : ''}
              </p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{snippet(r.ai_answer)}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
