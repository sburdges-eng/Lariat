#!/usr/bin/env node
/**
 * prepare-training-data.mjs
 *
 * Converts Lariat training data into SageMaker-compatible format.
 * Produces:
 *   - train.jsonl  (80% of data, chat-completion format with system prompt)
 *   - val.jsonl    (20% holdout)
 *   - test.jsonl   (eval scenarios, held out entirely)
 *
 * Format: Each line is {"messages": [{"role":"system","content":"..."},{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}
 * This is the standard SageMaker / HuggingFace chat template format.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRAINING_DIR = join(__dirname, '..');
const ROOT = join(TRAINING_DIR, '..');
const OUT_DIR = join(__dirname, 'data');

/* ── System prompt (from lib/ollama.ts, kept in sync) ─────────────── */

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

const SYSTEM_PROMPT = `You are a kitchen assistant for a restaurant using the Lariat Cockpit app.
Cooks are busy — use bullets, keep it tight, skip filler.

Rules (must follow):

1) GROUNDING: Use ONLY the facts in the user message under "CONTEXT (authoritative)." If something is not there, say clearly that it is not in today's Cockpit data and suggest checking Recipe Hub, the 86 board, or a manager — do not guess.

2) NO FABRICATION: Do not invent inventory counts, 86 items, prices, sales, or recipe steps not shown in CONTEXT.

3) ${ALLERGEN_BLOCK}

4) ${HACCP_BLOCK}

5) ${SOURCE_BOUNDARIES}

6) MENU-TO-RECIPE RESOLUTION: When asked about a menu item, resolve it to its underlying recipe(s). Mention sub-recipes and station assignments when that data is in CONTEXT.

7) INGREDIENT-LEVEL ALLERGEN DETAIL: When allergen information is requested and ingredient-level data is available in CONTEXT, cite which specific ingredient triggers which allergen.

8) CONCISENESS: Bullets preferred. Short paragraphs only when bullets won't do. Operational clarity over politeness or filler.

9) SUMMARIES: When the cook explicitly asks for a summary of 86s, inventory, or line-check data, summarize accurately. Do not volunteer a summary of CONTEXT data the cook did not ask for.

10) DETERMINISTIC CALCULATOR: For any recipe scaling, yield, portion, batch-prep, or BEO-scaled quantity, emit the matching JSON action (scale_recipe, beo_add_prep, or generate_prep) with the recipe slug/name and a multiplier. The server performs the calculation. NEVER compute ingredient totals in-token.

11) DB QUERY ACTION: When the cook asks something analytical or historical that isn't in CONTEXT, emit a SINGLE JSON action with query name and params. The server runs the query.`;

/* ── Load and transform ───────────────────────────────────────────── */

const rawPath = join(TRAINING_DIR, 'lariat-qa.jsonl');
if (!existsSync(rawPath)) {
  console.error('ERROR: training/lariat-qa.jsonl not found. Run generate-qa.mjs first.');
  process.exit(1);
}

const rawLines = readFileSync(rawPath, 'utf-8').trim().split('\n');
const pairs = rawLines.map((line, i) => {
  try {
    const obj = JSON.parse(line);
    // Prepend system prompt if not already present
    const msgs = obj.messages || [];
    if (msgs[0]?.role !== 'system') {
      msgs.unshift({ role: 'system', content: SYSTEM_PROMPT });
    }
    return JSON.stringify({ messages: msgs });
  } catch (e) {
    console.warn(`  [WARN] Skipping malformed line ${i + 1}: ${e.message}`);
    return null;
  }
}).filter(Boolean);

/* ── Shuffle deterministically (seeded) ───────────────────────────── */

function seededShuffle(arr, seed) {
  const hash = createHash('sha256').update(seed).digest();
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = hash.readUInt32BE(i % 28) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const shuffled = seededShuffle(pairs, 'lariat-sagemaker-2026');

/* ── Split 80/20 ──────────────────────────────────────────────────── */

const splitIdx = Math.floor(shuffled.length * 0.8);
const train = shuffled.slice(0, splitIdx);
const val = shuffled.slice(splitIdx);

/* ── Write output ─────────────────────────────────────────────────── */

import { mkdirSync } from 'node:fs';
mkdirSync(OUT_DIR, { recursive: true });

writeFileSync(join(OUT_DIR, 'train.jsonl'), train.join('\n') + '\n', 'utf-8');
writeFileSync(join(OUT_DIR, 'val.jsonl'), val.join('\n') + '\n', 'utf-8');

// Also write the system prompt standalone for reference / inference
writeFileSync(join(OUT_DIR, 'system-prompt.txt'), SYSTEM_PROMPT, 'utf-8');

console.log(`Prepared SageMaker training data:`);
console.log(`  Total pairs:  ${pairs.length}`);
console.log(`  Train split:  ${train.length} pairs -> ${OUT_DIR}/train.jsonl`);
console.log(`  Val split:    ${val.length} pairs -> ${OUT_DIR}/val.jsonl`);
console.log(`  System prompt: ${OUT_DIR}/system-prompt.txt`);

// Quick stats
const trainSize = Buffer.byteLength(train.join('\n'), 'utf-8');
const valSize = Buffer.byteLength(val.join('\n'), 'utf-8');
console.log(`  Train size:   ${(trainSize / 1024).toFixed(1)} KB`);
console.log(`  Val size:     ${(valSize / 1024).toFixed(1)} KB`);
