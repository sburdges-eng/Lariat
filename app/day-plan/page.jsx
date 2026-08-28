// @ts-check
import { serviceDate } from '../../lib/serviceDate.ts';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import { OPS_DAYPART_LABEL, rollupOpsSteps } from '../../lib/opsRun.ts';
import { ensureOpsRunForShift, localNowMinutes } from '../../lib/opsRunRepo.ts';
import DayPlanBoard from './DayPlanBoard';

export const dynamic = 'force-dynamic';

/** @typedef {Record<string, string | string[] | undefined>} PageSearchParams */

/** @param {{ searchParams: Promise<PageSearchParams> | PageSearchParams }} props */
export default async function DayPlanPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  // The venue service day runs 02:00 to 02:00 local. A UTC slice rolls at
  // 18:00 Mountain and would hand a cook tomorrow's plan mid-service.
  const today = serviceDate();
  const date =
    typeof sp.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;

  const steps = ensureOpsRunForShift(loc, date);
  const nowMin = localNowMinutes();
  const rollup = rollupOpsSteps(steps, nowMin);

  return (
    <div className="page">
      <DayPlanBoard
        steps={steps}
        rollup={rollup}
        date={date}
        locationId={loc}
        nowMinutes={nowMin}
        daypartLabels={OPS_DAYPART_LABEL}
      />
    </div>
  );
}
