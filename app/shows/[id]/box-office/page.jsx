// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
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

export default function BoxOfficePage({ params, searchParams }) {
  const id = Number(params?.id);
  const sp = searchParams ?? {};
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
