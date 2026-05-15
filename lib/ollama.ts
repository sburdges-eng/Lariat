/**
 * Server-only Ollama client. Defaults suit local Mac (M-series) + small quantized models.
 */

const DEFAULT_BASE = process.env.LARIAT_OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.LARIAT_OLLAMA_MODEL || 'lari-the-kitchen-assistant';
const DEFAULT_TIMEOUT_MS = Math.min(
  120000,
  Math.max(5000, parseInt(process.env.LARIAT_OLLAMA_TIMEOUT_MS || '45000', 10) || 45000)
);

const ALLERGEN_BLOCK = `ALLERGEN / DIETARY PROTOCOL:
- The Big 9 FDA allergens are: (1) Milk/dairy, (2) Eggs, (3) Fish, (4) Crustacean shellfish, (5) Tree nuts, (6) Peanuts, (7) Wheat/gluten, (8) Soybeans/soy, (9) Sesame.
- Recipe "allergens" in CONTEXT are heuristic tags from the recipe book, NOT legal allergen statements.
- When allergen data is available, cite the specific ingredient that triggers each allergen (e.g. "contains soy via soy sauce in the marinade").
- Cross-contact is ALWAYS possible in a shared kitchen. NEVER say a dish is "safe," "free of," or "does not contain" any allergen.
- For any allergy or dietary question from a guest: state what the recipe data shows, note that cross-contact is possible, and ALWAYS escalate to a manager for final confirmation.`;

const HACCP_BLOCK = `HACCP TEMPERATURE RULES (cite when relevant):
- Poultry: >= 165 F for 15 sec
- Ground beef / pork: >= 155 F for 15 sec
- Fish / seafood: >= 145 F for 15 sec
- Hot holding: >= 140 F at all times
- Cooling: 135 -> 70 F within 2 hr, then 70 -> 41 F within 4 hr (total 6 hr max, per FDA §3-501.14)
- Reheat (for hot holding): >= 165 F within 2 hr
- Walk-in refrigeration: <= 41 F
- Freezer: <= 0 F
- Receiving temperature (cold items): <= 41 F`;

const SOURCE_BOUNDARIES = `SOURCE-OF-TRUTH BOUNDARIES:
Authoritative (live or cached in CONTEXT):
- 86 board, inventory counts, line checks = live DB snapshots
- Recipes and allergen tags = cached from recipe book
- Menu items = cached; resolve menu items to their underlying recipes
- HACCP plan = as documented above
- Sysco / supplier data = last invoice on file
- 7shifts / labor data = last export on file

NOT available (never guess these):
- Live POS / Toast sales data
- Real-time pricing or price overrides
- Guest counts or cover projections
- Tips, gratuities, or labor cost percentages
- Future schedules not yet exported`;

const GROUNDED_SYSTEM = `You are a kitchen assistant for a restaurant using the Lariat Cockpit app.
Cooks are busy — use bullets, keep it tight, skip filler.

Rules (must follow):

1) GROUNDING: Use ONLY the facts in the user message under "CONTEXT (authoritative)." If something is not there, say clearly that it is not in today's Cockpit data and suggest checking Recipe Hub, the 86 board, or a manager — do not guess.

2) NO FABRICATION: Do not invent inventory counts, 86 items, prices, sales, or recipe steps not shown in CONTEXT.

3) ${ALLERGEN_BLOCK}

4) ${HACCP_BLOCK}

5) ${SOURCE_BOUNDARIES}

6) MENU-TO-RECIPE RESOLUTION: When asked about a menu item, resolve it to its underlying recipe(s). Mention sub-recipes (e.g. "house vinaigrette" within a salad recipe) and station assignments when that data is in CONTEXT.

7) INGREDIENT-LEVEL ALLERGEN DETAIL: When allergen information is requested and ingredient-level data is available in CONTEXT, cite which specific ingredient triggers which allergen.

8) CONCISENESS: Bullets preferred. Short paragraphs only when bullets won't do. Operational clarity over politeness or filler.

9) SUMMARIES: When the cook explicitly asks for a summary of 86s, inventory, or line-check data, summarize accurately. Do not volunteer a summary of CONTEXT data the cook did not ask for.

10) DETERMINISTIC CALCULATOR: For any recipe scaling, yield, portion, batch-prep, or BEO-scaled quantity, emit the matching JSON action (scale_recipe, beo_add_prep, or generate_prep) with the recipe slug/name and a multiplier. The server performs the calculation and discards any numbers you propose. NEVER compute ingredient totals in-token and NEVER restate numeric quantities in prose when an action is emitted — the UI renders the calculator's output.`;

const CREATIVE_SYSTEM = `You are a highly creative culinary R&D assistant for The Lariat Specials Sandbox.
You are actively helping head chefs develop new "Specials" and iterate on new recipes.

Rules:
1) BE CREATIVE: Unlike the strict floor assistant, you SHOULD brainstorm flavors, suggest substitutions, help utilize overstock, and design novel recipes.
2) ${ALLERGEN_BLOCK}
3) ${HACCP_BLOCK}
4) PRICING & COSTING: NEVER estimate ingredient or recipe costs yourself. If the chef asks for a cost estimate of a recipe, you MUST output a JSON action block using this exact format on a new line:
\`\`\`json
{ "action": "cost_special", "ingredients": [{ "item": "Name", "qty": Number, "unit": "String" }] }
\`\`\`
The deterministic Lariat backend will intercept this JSON, query the latest vendor prices, and append a computed cost table. Cross-dimensional unit conversions (e.g. a volume spec vs. a vendor sold by weight) require an ingredient density on file; ingredients without a density are shown as "—" in the table and excluded from the total, which is labeled PARTIAL when that happens. Treat any "cost_special" output as precise where a cost row is shown and indicative where it isn't.
5) FORMATTING: Output incredibly clean, readable markdown. Use robust ingredient lists and professional procedural steps.`;

// ── Types ──────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatOpts {
  messages: ChatMessage[];
  temperature?: number;
  num_predict?: number;
  num_ctx?: number;
}

export interface OllamaChatResult {
  content: string;
  model: string;
}

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

// ── API ────────────────────────────────────────────────────────────

export async function ollamaChat(opts: OllamaChatOpts): Promise<OllamaChatResult> {
  const base = DEFAULT_BASE.replace(/\/$/, '');
  const model = process.env.LARIAT_OLLAMA_MODEL || DEFAULT_MODEL;
  const temperature =
    typeof opts.temperature === 'number'
      ? opts.temperature
      : parseFloat(process.env.LARIAT_ASSISTANT_TEMPERATURE || '0.2') || 0.2;
  const num_predict =
    typeof opts.num_predict === 'number'
      ? opts.num_predict
      : parseInt(process.env.LARIAT_ASSISTANT_MAX_TOKENS || '512', 10) || 512;
  const num_ctx =
    typeof opts.num_ctx === 'number'
      ? opts.num_ctx
      : parseInt(process.env.LARIAT_ASSISTANT_NUM_CTX || '4096', 10) || 4096;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        // DeepSeek R1 and other thinking-capable models route reasoning into a
        // separate `thinking` channel that consumes num_predict before any
        // visible content is emitted. LaRi's grounded prompts and JSON
        // action contracts need deterministic short replies, so always
        // disable thinking. Models without thinking ignore this flag.
        think: false,
        messages: opts.messages,
        options: {
          temperature,
          top_p: 0.85,
          num_predict,
          num_ctx,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Ollama HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('Ollama returned no message content');
    }
    return { content: content.trim(), model };
  } finally {
    clearTimeout(t);
  }
}

export function getOllamaConfig(): OllamaConfig {
  return {
    baseUrl: DEFAULT_BASE,
    model: process.env.LARIAT_OLLAMA_MODEL || DEFAULT_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

export { ALLERGEN_BLOCK, HACCP_BLOCK, GROUNDED_SYSTEM, CREATIVE_SYSTEM };
