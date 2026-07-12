// @ts-check
import KitchenAssistantClient from './KitchenAssistantClient.jsx';

// KitchenAssistantClient resolves the current location itself via the
// shared useLocation() hook (localStorage + ?location= query-string
// override, same as Sidebar/CommandPalette/Floorplan) — this page has
// no server-side location logic left to compute.
export const dynamic = 'force-dynamic';

export default function KitchenAssistantPage() {
  return (
    <div>
      <h1>Kitchen assistant</h1>
      <p className="subtitle">
        Local AI with <strong>grounded context</strong>: today&apos;s active 86s, recent inventory log, line-check progress, sign-offs, and recipe snippets that match your question.
        Low temperature and strict prompts reduce invention; allergen tags from the recipe book are <strong>not</strong> legal dietary advice.
      </p>
      <KitchenAssistantClient />
    </div>
  );
}
