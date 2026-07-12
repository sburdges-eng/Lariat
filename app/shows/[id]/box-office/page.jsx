// @ts-check
import { getDb } from '../../../../lib/db';
import {
  listLinesForShow,
  summarizeBoxOffice,
  boxOfficeCompleteness,
} from '../../../../lib/boxOfficeRepo';
import TabStrip from '../_components/TabStrip';
import BoxOfficeBoard from './BoxOfficeBoard';

export const dynamic = 'force-dynamic';
const DEFAULT_LOCATION_ID = 'default';

/**
 * @typedef {{
 *   params: Promise<{ id?: string }> | { id?: string },
 *   searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>,
 * }} BoxOfficePageProps
 */

/** @param {BoxOfficePageProps} props */
export default async function BoxOfficePage({ params, searchParams }) {
  const p = (await params) || {};
  const id = Number(p.id);
  const sp = (await searchParams) ?? {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;

  const db = getDb();
  const lines = listLinesForShow(db, id, loc);
  const summary = summarizeBoxOffice(db, id, loc);
  const completeness = boxOfficeCompleteness(summary);

  return (
    <>
      <TabStrip showId={id} locationId={loc} active="box-office" />
      <BoxOfficeBoard
        showId={id}
        locationId={loc}
        initialLines={lines}
        summary={summary}
        completeness={completeness}
      />
    </>
  );
}
