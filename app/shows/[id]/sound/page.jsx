// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb } from '../../../../lib/db';
import { listSoundScenesForShow, soundCompleteness } from '../../../../lib/soundRepo';
import TabStrip from '../_components/TabStrip';
import SoundBoard from './SoundBoard';

export const dynamic = 'force-dynamic';
const DEFAULT_LOCATION_ID = 'default';

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
