// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb } from '../../../../lib/db';
import { getStageSetup, stageCompleteness, KNOWN_ROOM_CONFIGS } from '../../../../lib/stageRepo';
import TabStrip from '../_components/TabStrip';
import StageBoard from './StageBoard';

export const dynamic = 'force-dynamic';
const DEFAULT_LOCATION_ID = 'default';

export default async function StagePage({ params, searchParams }) {
  const p = (await params) || {};
  const id = Number(p.id);
  const sp = (await searchParams) ?? {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;

  const db = getDb();
  const setup = getStageSetup(db, id, loc);
  const completeness = stageCompleteness(setup);

  return (
    <>
      <TabStrip showId={id} locationId={loc} active="stage" />
      <StageBoard
        showId={id}
        locationId={loc}
        initialSetup={setup}
        completeness={completeness}
        roomConfigs={KNOWN_ROOM_CONFIGS}
      />
    </>
  );
}
