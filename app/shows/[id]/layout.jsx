// @ts-check
import { notFound } from 'next/navigation';
import { getDb } from '../../../lib/db';
import { getShowById } from '../../../lib/showsRepo';
import ShowHeader from './_components/ShowHeader';

export const dynamic = 'force-dynamic';

const DEFAULT_LOCATION_ID = 'default';

/**
 * Next 15 route context: `params` / `searchParams` may be promises (async
 * dynamic APIs).
 * @typedef {{
 *   children: React.ReactNode,
 *   params: Promise<{ id?: string }> | { id?: string },
 *   searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>,
 * }} ShowLayoutProps
 */

/** @param {ShowLayoutProps} props */
export default async function ShowLayout({ children, params, searchParams }) {
  const resolvedParams = await params;
  const id = Number(resolvedParams?.id);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const sp = (await searchParams) ?? {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;

  const db = getDb();
  const show = getShowById(db, loc, id);
  if (!show) notFound();

  return (
    <div className="page">
      <ShowHeader show={show} locationId={loc} />
      {children}
    </div>
  );
}
