// @ts-check
import { getDb } from '../../../../lib/db';
import { listSoundScenesForShow, soundCompleteness } from '../../../../lib/soundRepo';
import TabStrip from '../_components/TabStrip';
import SoundBoard from './SoundBoard';

export const dynamic = 'force-dynamic';
const DEFAULT_LOCATION_ID = 'default';

/**
 * @typedef {{
 *   params: Promise<{ id?: string }> | { id?: string },
 *   searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>,
 * }} SoundPageProps
 */

/** @param {SoundPageProps} props */
export default async function SoundPage({ params, searchParams }) {
  const p = (await params) || {};
  const id = Number(p.id);
  const sp = (await searchParams) ?? {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;

  const db = getDb();
  const scenes = listSoundScenesForShow(db, id, loc);
  const completeness = soundCompleteness(scenes);

  return (
    <>
      <TabStrip showId={id} locationId={loc} active="sound" />
      <SoundBoard
        showId={id}
        locationId={loc}
        initialScenes={scenes}
        completeness={completeness}
      />
    </>
  );
}
