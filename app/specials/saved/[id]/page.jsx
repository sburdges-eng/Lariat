// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '../../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../../lib/location';
import { getPromotionForSpecial } from '../../../../lib/specialsPromotion';
import SpecialDetailClient from './SpecialDetailClient';

export const dynamic = 'force-dynamic';

export default async function SavedSpecialDetail({ params, searchParams }) {
  const { id } = await params;
  const sp = (await searchParams) || {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const locQ = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';

  const db = getDb();
  const row = db.prepare('SELECT * FROM specials WHERE id = ? AND location_id = ?').get(id, loc);
  if (!row) notFound();

  let costBreakdown = [];
  if (row.cost_breakdown) {
    try {
      const parsed = JSON.parse(row.cost_breakdown);
      if (Array.isArray(parsed)) costBreakdown = parsed;
    } catch { /* keep [] */ }
  }
  let sources = [];
  if (row.sources) {
    try {
      const parsed = JSON.parse(row.sources);
      if (Array.isArray(parsed)) sources = parsed;
    } catch { /* keep [] */ }
  }

  const promotion = getPromotionForSpecial(id, loc, db) || null;

  return (
    <div>
      <Link href={`/specials/saved${locQ}`} style={{ color: 'var(--muted)', fontSize: 13 }}>← Saved Specials</Link>
      <SpecialDetailClient
        locationId={loc}
        promotion={promotion ? {
          menu_item_name: promotion.menu_item_name,
          servings: promotion.servings,
          promoted_at: promotion.promoted_at,
          updated_at: promotion.updated_at,
        } : null}
        special={{
          id: row.id,
          name: row.name,
          pantry_text: row.pantry_text,
          prompt_text: row.prompt_text,
          ai_answer: row.ai_answer,
          ai_model: row.ai_model,
          cost_breakdown: costBreakdown,
          cost_total: row.cost_total,
          scratch_notes: row.scratch_notes,
          sources,
          last_exported_at: row.last_exported_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }}
      />
    </div>
  );
}
