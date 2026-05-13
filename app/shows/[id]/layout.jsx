// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { notFound } from 'next/navigation';
import { getDb } from '../../../lib/db';
import { getShowById } from '../../../lib/showsRepo';
import ShowHeader from './_components/ShowHeader';

export const dynamic = 'force-dynamic';

const DEFAULT_LOCATION_ID = 'default';

export default function ShowLayout({ children, params, searchParams }) {
  const id = Number(params?.id);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const sp = searchParams ?? {};
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
