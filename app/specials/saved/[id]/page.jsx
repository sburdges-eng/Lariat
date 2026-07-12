// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '../../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../../lib/location';
import { getPromotionForSpecial } from '../../../../lib/specialsPromotion';
import SpecialDetailClient from './SpecialDetailClient';

export const dynamic = 'force-dynamic';

/**
 * One cost_breakdown line, as produced by the specials sandbox costing
 * (lib/computeEngine/sandboxCosting.ts) and mirroring the unexported
 * `CostBreakdownLine` shape in lib/specialsPromotion.ts.
 * @typedef {{ item?: string, req_qty?: number, req_unit?: string, match?: string | null, cost?: number | null, note?: string }} CostBreakdownLine
 */

/**
 * `SELECT *` row from the specials table. Nullability mirrors the
 * CREATE TABLE statement in lib/db.ts.
 * @typedef {{
 *   id: string,
 *   location_id: string,
 *   name: string,
 *   pantry_text: string,
 *   prompt_text: string,
 *   ai_answer: string,
 *   ai_model: string,
 *   cost_breakdown: string | null,
 *   cost_total: number | null,
 *   scratch_notes: string,
 *   sources: string | null,
 *   last_exported_at: number | null,
 *   created_at: number,
 *   updated_at: number,
 *   archived_at: number | null,
 * }} SpecialRow
 */

/**
 * @typedef {{
 *   params: Promise<{ id?: string }> | { id?: string },
 *   searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>,
 * }} SavedSpecialDetailPageProps
 */

/** @param {SavedSpecialDetailPageProps} props */
export default async function SavedSpecialDetail({ params, searchParams }) {
  // Next guarantees the [id] segment exists on a matched dynamic route —
  // the optional-key typing (matching the Next 15 typegen for async
  // params) is the only reason it's `| undefined`. Same convention as
  // app/recipes/[slug]/page.jsx.
  const p = await params;
  const id = /** @type {string} */ (p.id);
  const sp = (await searchParams) || {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const locQ = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';

  const db = getDb();
  const row = /** @type {SpecialRow | undefined} */ (
    db.prepare('SELECT * FROM specials WHERE id = ? AND location_id = ?').get(id, loc)
  );
  if (!row) notFound();

  /** @type {CostBreakdownLine[]} */
  let costBreakdown = [];
  if (row.cost_breakdown) {
    try {
      const parsed = JSON.parse(row.cost_breakdown);
      if (Array.isArray(parsed)) costBreakdown = parsed;
    } catch { /* keep [] */ }
  }
  /** @type {unknown[]} */
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
