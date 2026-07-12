// @ts-check
import { getDb } from '../../../../lib/db';
import { getStageSetup, stageCompleteness, KNOWN_ROOM_CONFIGS } from '../../../../lib/stageRepo';
import TabStrip from '../_components/TabStrip';
import StageBoard from './StageBoard';

export const dynamic = 'force-dynamic';
const DEFAULT_LOCATION_ID = 'default';

/**
 * @typedef {{
 *   params: Promise<{ id?: string }> | { id?: string },
 *   searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>,
 * }} PageProps
 */

/** @param {PageProps} props */
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
