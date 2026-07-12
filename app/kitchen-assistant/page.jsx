// @ts-check
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import KitchenAssistantClient from './KitchenAssistantClient.jsx';

/** @typedef {Record<string, string | string[] | undefined>} PageSearchParams */

export const dynamic = 'force-dynamic';

/** @param {{ searchParams: Promise<PageSearchParams> }} props */
export default async function KitchenAssistantPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const locQ = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';

  return (
    <div>
      <h1>Kitchen assistant</h1>
      <p className="subtitle">
        Local AI with <strong>grounded context</strong>: today&apos;s active 86s, recent inventory log, line-check progress, sign-offs, and recipe snippets that match your question.
        Low temperature and strict prompts reduce invention; allergen tags from the recipe book are <strong>not</strong> legal dietary advice.
      </p>
      <KitchenAssistantClient locQuery={locQ} />
    </div>
  );
}
