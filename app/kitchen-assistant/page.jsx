// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import KitchenAssistantClient from './KitchenAssistantClient.jsx';

export const dynamic = 'force-dynamic';

export default function KitchenAssistantPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
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
