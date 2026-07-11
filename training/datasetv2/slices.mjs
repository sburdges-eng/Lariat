// Dataset v2 slice generators. Every example mirrors the exact runtime
// shape: system = GROUNDED_SYSTEM, user = the route.js template (real
// CONTEXT from buildGroundedContext + db_query catalog + directive),
// assistant = fenced action JSON first (commands) or grounded kitchen-voice
// prose (questions).
//
// Fidelity invariants (locked in by tests/js/test-dataset-v2-slices.mjs,
// added after the pre-sweep review round):
//   - the directive on every row is derived from the REAL
//     lib/cookMessageClassifier.ts isImperativeCommand — exactly how
//     route.js decides it; command templates lead with classifier verbs;
//   - mutating-command rows use manager-tier context/catalog (production
//     command prompts always run PIN-authorized past route.js’s pre-LLM
//     gate); a small read-imperative sub-slice covers the one cook-tier
//     ACTION-directive shape that really occurs;
//   - optional payload fields (eighty_six.reason, haccp_receive.note) are
//     coupled to what the cook message actually says — never fabricated;
//   - give_gold_star cook_name is the exact full roster display name.
import { pick } from './core.mjs';
import {
  GROUNDED, realContext, buildRuntimeUserMessage,
  ACTION_DIRECTIVE, ANSWER_FORMAT, querySpecs, isImperativeCommand,
} from './sources.mjs';

const fence = (obj) => '```json\n' + JSON.stringify(obj) + '\n```';

// context cache — buildGroundedContext is keyword-driven, so identical
// messages produce identical contexts; dedupe to keep generation fast.
const ctxCache = new Map();
async function ctx(message, hasPin = false) {
  const key = `${hasPin ? 'm' : 'c'}:${message}`;
  if (!ctxCache.has(key)) ctxCache.set(key, await realContext(message, { hasPin }));
  return ctxCache.get(key);
}

// Directive is ALWAYS derived from the real classifier, like route.js.
// mustBe lets a generator assert its intent; a mismatch returns null and the
// caller retries with another template (guards against template drift).
async function buildRow(message, assistant, slice, { tier = 'cook', mustBe = null, sub = null } = {}) {
  const isCmd = isImperativeCommand(message);
  if (mustBe === 'command' && !isCmd) return null;
  if (mustBe === 'question' && isCmd) return null;
  const user = buildRuntimeUserMessage({
    contextText: await ctx(message, tier === 'manager'),
    tier, message, directive: isCmd ? ACTION_DIRECTIVE : ANSWER_FORMAT,
  });
  return {
    messages: [
      { role: 'system', content: GROUNDED },
      { role: 'user', content: user },
      { role: 'assistant', content: assistant },
    ],
    meta: { slice, ...(sub ? { sub } : {}) },
  };
}

// Mutating commands serve with hasPin=true (route.js pre-LLM PIN gate), so
// they train on manager-tier context + the manager db_query catalog.
const commandRow = (message, payload, confirmation, opts = {}) =>
  buildRow(message, `${fence(payload)}\n${confirmation}`, 'action_json',
    { tier: 'manager', mustBe: 'command', ...opts });

const questionRow = (message, answer, slice, opts = {}) =>
  buildRow(message, answer, slice, { mustBe: 'question', ...opts });

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const displayName = (r) => r.name || r.slug;
const firstStation = (r) => String(r.station || '').split(';')[0].trim();

// pushes a row if the template classified correctly; returns 1/0 so
// generators can count what actually landed
async function push(rows, rowPromise) {
  const r = await rowPromise;
  if (r) rows.push(r);
  return r ? 1 : 0;
}

const MULTIPLIERS = [2, 3, 4, 5, 0.5, 1.5];

const TEMP_POINTS = [
  { id: 'walk_in_cooler', label: 'walk-in', range: [34, 44] },
  { id: 'reach_in_cooler', label: 'reach-in', range: [34, 44] },
  { id: 'freezer', label: 'freezer', range: [-8, 8] },
  { id: 'cook_poultry', label: 'chicken off the grill', range: [155, 180] },
  { id: 'cook_ground_beef', label: 'burger patty', range: [148, 168] },
  { id: 'cook_fish', label: 'fish', range: [138, 158] },
  { id: 'receiving_cold', label: 'cold delivery', range: [33, 48] },
  { id: 'receiving_frozen', label: 'frozen delivery', range: [-5, 15] },
];

const EQUIPMENT = ['fryer 2', 'the walk-in compressor', 'flat top', 'dish machine', 'ice machine',
  'blast chiller', 'salamander', 'char grill', 'reach-in on the line', 'hood fans over saute'];

const CONFIRM_86 = ['Pulled it — %s is 86’d.', '%s is on the 86 board.', 'Done, %s is 86 until further notice.'];
const CONFIRM_GENERIC = ['On it.', 'Logged.', 'Done.', 'Got it — logged.'];

// ── action_json ─────────────────────────────────────────────────────────────

async function genActionJson(sources, rng, target) {
  const rows = [];
  const { recipes, orderGuideItems, beoEvents, staff, stations } = sources;
  const rWithYield = recipes.filter((r) => r.yield_qty);
  const stationNames = stations.map((s) => s.name);
  const w = (frac) => Math.max(1, Math.round(target * frac));

  // eighty_six (13%) — reason is coupled to the message template
  for (let i = 0; i < w(0.13); i++) {
    const item = pick(rng, [...recipes.map(displayName), ...orderGuideItems.map((o) => o.ingredient)]);
    const r = pick(rng, ['ran out', 'quality issue', 'vendor shorted us', 'prep didn’t hold']);
    const t = pick(rng, [
      { msg: `86 the ${item}`, reason: null },
      { msg: `86 ${item}`, reason: null },
      { msg: `eighty-six the ${item}`, reason: null },
      { msg: `mark ${item} out of stock`, reason: null },
      { msg: `86 ${item} — ${r}`, reason: r },
      { msg: `log an 86 on ${item}, ${r}`, reason: r },
      { msg: `86 ${item}, we ran out`, reason: 'ran out' },
      { msg: `mark ${item} 86 for tonight`, reason: null },
    ]);
    const payload = { action: 'eighty_six', item: cap(item) };
    if (t.reason) payload.reason = cap(t.reason);
    await push(rows, commandRow(t.msg, payload, pick(rng, CONFIRM_86).replace('%s', cap(item))));
  }

  // update_inventory (13%) — direction coupled to the template wording
  for (let i = 0; i < w(0.13); i++) {
    const og = pick(rng, orderGuideItems);
    const delta = pick(rng, [1, 2, 3, 4, 5, 6, 8, 10, 12]);
    const unit = og.unit || 'each';
    const ing = og.ingredient;
    const t = pick(rng, [
      { msg: `log ${delta} ${unit} of ${ing} received`, dir: 'in' },
      { msg: `add ${delta} ${unit} of ${ing} to inventory`, dir: 'in' },
      { msg: `record a delivery: ${delta} ${unit} ${ing}`, dir: 'in' },
      { msg: `log ${delta} ${unit} ${ing} used on the line`, dir: 'out' },
      { msg: `adjust ${ing} down ${delta} ${unit}, used through service`, dir: 'out' },
      { msg: `update inventory: ${ing} out ${delta} ${unit}`, dir: 'out' },
      { msg: `log waste: ${delta} ${unit} ${ing}`, dir: 'waste' },
      { msg: `record ${delta} ${unit} of ${ing} wasted, had to toss it`, dir: 'waste' },
    ]);
    await push(rows, commandRow(t.msg,
      { action: 'update_inventory', item: cap(ing), delta, unit, direction: t.dir },
      pick(rng, CONFIRM_GENERIC)));
  }

  // line_check — temp + binary modes (13%)
  for (let i = 0; i < w(0.13); i++) {
    const st = pick(rng, stationNames);
    if (rng() < 0.65) {
      const tp = pick(rng, TEMP_POINTS);
      const reading = Math.round(tp.range[0] + rng() * (tp.range[1] - tp.range[0]));
      const msg = pick(rng, [
        `log a line check, ${tp.label} at ${reading}F on ${st}`,
        `record ${tp.label} at ${reading} degrees`,
        `log temp check ${tp.label}: ${reading}`,
        `note ${tp.label} reading ${reading}F`,
      ]);
      await push(rows, commandRow(msg,
        { action: 'line_check', station: st, item: cap(tp.label), reading_f: reading, temp_point_id: tp.id },
        pick(rng, ['Logged — server will grade it against the FDA limits.', 'Reading logged.', 'On the log.'])));
    } else {
      const item = pick(rng, ['sanitizer bucket', 'glove boxes stocked', 'cutting boards clean', 'date labels', 'hand sink stocked']);
      const status = pick(rng, ['pass', 'fail', 'na']);
      const statusWord = status === 'pass' ? 'good' : status === 'fail' ? 'failed' : 'not applicable';
      const msg = pick(rng, [
        `log line check ${st}: ${item} ${statusWord}`,
        `mark ${item} as ${status} on ${st}`,
        `record ${item} ${statusWord} for the ${st} line check`,
      ]);
      await push(rows, commandRow(msg,
        { action: 'line_check', station: st, item: cap(item), reading_f: null, temp_point_id: null, status },
        pick(rng, CONFIRM_GENERIC)));
    }
  }

  // maintenance (8%)
  for (let i = 0; i < w(0.08); i++) {
    const eq = pick(rng, EQUIPMENT);
    const issue = pick(rng, ['not holding temp', 'making a grinding noise', 'leaking water', 'pilot won’t stay lit',
      'error code on the display', 'door gasket torn', 'won’t drain', 'tripping the breaker']);
    const msg = pick(rng, [
      `log a maintenance ticket — ${eq} is ${issue}`,
      `add a work order for ${eq}, it’s ${issue}`,
      `note maintenance: ${eq} ${issue}`,
      `record a repair ticket for ${eq} — ${issue}`,
    ]);
    await push(rows, commandRow(msg,
      { action: 'maintenance', equipment: cap(eq), issue: cap(issue) },
      pick(rng, ['Ticket logged for maintenance.', 'Work order in.', 'Flagged it.'])));
  }

  // scale_recipe (17%) — the T09 behavior
  for (let i = 0; i < w(0.17); i++) {
    const r = pick(rng, rWithYield.length ? rWithYield : recipes);
    const name = displayName(r);
    const n = pick(rng, MULTIPLIERS);
    const msg = pick(rng, [
      `scale ${name} to ${n}x`,
      `scale up ${name} ${n} times`,
      `scale ${name} for ${n} batches`,
      `scale the ${name} recipe by ${n}`,
      `prep ${n} batches of ${name}`,
      `scale ${name} — we need ${n}x for service`,
    ]);
    await push(rows, commandRow(msg,
      { action: 'scale_recipe', recipe: r.slug || name, multiplier: n },
      pick(rng, ['Calculator output below — server ran the math.', 'Scaled sheet coming up.', 'On it — scaled quantities render below.'])));
  }

  // update_order_guide (10%)
  for (let i = 0; i < w(0.10); i++) {
    const og = pick(rng, orderGuideItems);
    const qty = pick(rng, [1, 2, 3, 4, 5, 6, 10, 12]);
    const unit = og.unit || 'case';
    const ing = og.ingredient;
    const msg = pick(rng, [
      `add ${qty} ${unit} of ${ing} to the order guide`,
      `order ${qty} ${unit} ${ing}`,
      `reorder ${ing}, ${qty} ${unit}`,
      `update order guide: ${ing} ${qty} ${unit}`,
      `set ${ing} to ${qty} ${unit} on the order`,
    ]);
    await push(rows, commandRow(msg,
      { action: 'update_order_guide', item: cap(ing), qty, unit },
      pick(rng, ['Order guide updated.', 'On the guide.', 'Updated the order.'])));
  }

  // beo_add_prep (8%) — server multiplies by guest count (rule 10)
  for (let i = 0; i < w(0.08); i++) {
    const ev = pick(rng, beoEvents);
    const r = pick(rng, recipes);
    const ppg = pick(rng, [0.25, 0.5, 1, 1.5, 2]);
    const task = pick(rng, ['sheet trays lined and labeled', 'portion and wrap proteins', 'sauce containers filled',
      'garnish picked and packed', 'chafers staged with fuel']);
    const msg = pick(rng, [
      `add prep for event ${ev.id}: ${task}, plus ${displayName(r)} at ${ppg} portions per guest`,
      `add BEO ${ev.id} prep — ${task}; run ${displayName(r)} ${ppg} per head`,
      `set up prep tasks on event ${ev.id}: ${task} and ${displayName(r)} at ${ppg}/guest`,
    ]);
    await push(rows, commandRow(msg,
      {
        action: 'beo_add_prep', event_id: ev.id, tasks: [cap(task)],
        recipes: [{ recipe_slug: r.slug || displayName(r), portions_per_guest: ppg }],
      },
      pick(rng, ['Prep added — the calculator scales it by the BEO guest count.', 'On the BEO prep list.', 'Added; server handles the math.'])));
  }

  // give_gold_star (4%) — exact full roster names (route.js exact-match)
  for (let i = 0; i < w(0.04) && staff.length; i++) {
    const cook = pick(rng, staff).name;
    const stars = pick(rng, [1, 2, 3]);
    const reason = pick(rng, ['crushed the Friday rush', 'caught a bad delivery before it hit the walk-in',
      'covered a double with zero misses', 'trained the new hire all week', 'kept the line spotless through service']);
    const msg = pick(rng, [
      `give ${cook} ${stars} gold star${stars > 1 ? 's' : ''} — ${reason}`,
      `give a gold star to ${cook}, ${reason}`,
      `give ${cook} ${stars} star${stars > 1 ? 's' : ''}: ${reason}`,
    ]);
    await push(rows, commandRow(msg,
      { action: 'give_gold_star', cook_name: cook, reason: cap(reason), stars },
      pick(rng, [`Star logged for ${cook}.`, 'Nice — logged it.', 'Recognition posted.'])));
  }

  // haccp_receive (9%) — note coupled to the packaging wording in the message
  const RECV = [
    { cat: 'refrigerated', items: ['chicken thighs', 'heavy cream', 'ground beef'], range: [33, 50] },
    { cat: 'frozen', items: ['fries', 'shrimp', 'ice cream base'], range: [-10, 20] },
    { cat: 'shell_eggs', items: ['shell eggs'], range: [38, 50] },
    { cat: 'produce', items: ['romaine', 'tomatoes', 'cilantro'], range: [35, 60] },
    { cat: 'dry_goods', items: ['flour', 'rice', 'canned tomatoes'], range: [55, 75] },
    { cat: 'shellfish', items: ['oysters', 'mussels'], range: [33, 48] },
  ];
  for (let i = 0; i < w(0.09); i++) {
    const g = pick(rng, RECV);
    const item = pick(rng, g.items);
    const reading = g.cat === 'dry_goods' && rng() < 0.5 ? null
      : Math.round(g.range[0] + rng() * (g.range[1] - g.range[0]));
    const pkgOk = rng() > 0.15;
    const tempPart = reading != null ? pick(rng, [`, probe says ${reading}F`, ` at ${reading} degrees`, ` at ${reading}`]) : '';
    const pkgPart = pkgOk ? pick(rng, [', packaging intact', ', box looks good']) : pick(rng, [', packaging damaged', ' — torn bags, hold it']);
    const msg = pick(rng, [
      `log the ${item} delivery${tempPart}${pkgPart}`,
      `receive ${item}${tempPart}${pkgPart}`,
      `record receiving: ${item}${tempPart}${pkgPart}`,
    ]);
    await push(rows, commandRow(msg,
      {
        action: 'haccp_receive', item: cap(item), category: g.cat, reading_f: reading,
        package_ok: pkgOk, note: pkgOk ? 'Packaging intact' : 'Packaging damaged — hold for manager',
      },
      pick(rng, ['Logged — server grades the temp against receiving limits.', 'Receiving log updated.', 'On the receiving log.'])));
  }

  // generate_prep (6%) — velocity rationale only, no quantities
  for (let i = 0; i < w(0.06); i++) {
    const st = pick(rng, stationNames);
    const r1 = pick(rng, recipes); const r2 = pick(rng, recipes);
    const m1 = pick(rng, [1, 1.5, 2]); const m2 = pick(rng, [1, 2, 3]);
    const msg = pick(rng, [
      `generate prep for ${st}`,
      `generate a prep list for ${st} for tomorrow`,
      `prep list for ${st}, build it out`,
      `generate dynamic prep for ${st} tonight`,
    ]);
    await push(rows, commandRow(msg,
      {
        action: 'generate_prep', station: st,
        tasks: [
          { item: displayName(r1), need: 'moves fast on weekend service', recipe_slug: r1.slug || displayName(r1), multiplier: m1 },
          { item: displayName(r2), need: 'par ran low at close', recipe_slug: r2.slug || displayName(r2), multiplier: m2 },
        ],
      },
      pick(rng, ['Prep list generated — quantities come from the calculator.', 'Sheet is below; server ran the math.', 'Prep queued for the station.'])));
  }

  return rows;
}

// ── db_query + semantic_search ──────────────────────────────────────────────

const QUERY_PHRASINGS = {
  recent_temp_log: ['any temp readings in the last {hours} hours?', 'pull the temp log for the {point} since this morning', 'show me recent temps on the {point}'],
  cooling_in_progress: ['anything still cooling right now?', 'what’s in an active cooling cycle?', 'any cooling logs open?'],
  recent_receiving: ['what came in receiving today?', 'show recent deliveries', 'pull the receiving log for the last couple days'],
  open_prep_tasks: ['what prep is still open?', 'show me the open prep list', 'what’s left on prep?'],
  kds_open_tickets: ['how many open tickets on the board?', 'what’s hanging on the KDS?', 'show open kitchen tickets'],
  sds_lookup: ['pull the SDS for {chem}', 'where’s the safety sheet for {chem}?', 'SDS lookup: {chem}'],
  cleaning_due_today: ['what cleaning tasks are due today?', 'anything on the cleaning schedule for tonight?', 'show today’s cleaning list'],
  staff_certifications_expiring: ['any food handler cards expiring soon?', 'whose certs are about to lapse?', 'show expiring certifications'],
  inventory_for_item: ['how much {item} do we have on hand?', 'check inventory for {item}', 'what’s our count on {item}?'],
  equipment_lookup: ['what do we have on file for the {equip}?', 'pull the equipment record for the {equip}', 'equipment info: {equip}'],
  tphc_active: ['what’s out on time-as-control right now?', 'show active TPHC items', 'anything running on the 4-hour clock?'],
  date_marks_expiring: ['what date marks expire today?', 'anything hitting its use-by date?', 'show expiring date labels'],
  sanitizer_recent: ['when was the last sanitizer check?', 'show recent sanitizer readings', 'pull sanitizer bucket logs'],
  beo_prep_status: ['where are we on prep for the events?', 'BEO prep status?', 'how’s event prep tracking?'],
};

function paramsFor(spec, sources, rng) {
  const params = {};
  for (const p of spec.params) {
    if (!p.required && rng() > 0.35) continue;
    const n = p.name.toLowerCase();
    if (n.includes('hour')) params[p.name] = pick(rng, [4, 8, 12, 24, 48]);
    else if (n.includes('day')) params[p.name] = pick(rng, [3, 7, 14, 30]);
    else if (n.includes('limit') || n.includes('count')) params[p.name] = pick(rng, [5, 10, 20]);
    else if (n.includes('point')) params[p.name] = pick(rng, TEMP_POINTS).id;
    else if (n.includes('station')) params[p.name] = pick(rng, sources.stations).name;
    else if (n.includes('recipe')) params[p.name] = pick(rng, sources.recipes).slug;
    else if (n.includes('item') || n.includes('ingredient') || n.includes('name') || n.includes('query') || n.includes('search') || n.includes('term')) {
      params[p.name] = pick(rng, sources.orderGuideItems).ingredient;
    } else if (p.type === 'iso_date') {
      const day = 1 + Math.floor(rng() * 28);
      params[p.name] = `2026-06-${String(day).padStart(2, '0')}`;
    } else if (p.type === 'boolean') params[p.name] = rng() > 0.5;
    else if (p.type === 'integer' || p.type === 'number') {
      const lo = p.min ?? 1, hi = p.max ?? 30;
      params[p.name] = Math.max(lo, Math.min(hi, Math.round(lo + rng() * (hi - lo))));
    } else if (p.required) params[p.name] = pick(rng, sources.orderGuideItems).ingredient;
  }
  return params;
}

function questionFor(spec, params, sources, rng) {
  const t = QUERY_PHRASINGS[spec.name] ? pick(rng, QUERY_PHRASINGS[spec.name]) : null;
  if (t) {
    return t
      .replace('{hours}', params.hours ?? 24)
      .replace('{point}', String(params.point_id || 'walk-in').replace(/_/g, ' '))
      .replace('{chem}', pick(rng, ['degreaser', 'oven cleaner', 'sanitizer concentrate', 'lime-away']))
      .replace('{item}', params[Object.keys(params).find((k) => /item|ingredient|name/.test(k))] || pick(rng, sources.orderGuideItems).ingredient)
      .replace('{equip}', pick(rng, EQUIPMENT));
  }
  const desc = spec.description.replace(/\.$/, '').toLowerCase();
  return pick(rng, [
    `can you pull ${desc}?`,
    `show me ${desc}`,
    `I need ${desc} — run it`,
    `what does the data say for ${desc}?`,
  ]);
}

async function genDbQuery(sources, rng, target) {
  const rows = [];
  const cook = querySpecs('cook');
  const cookNames = new Set(cook.map((q) => q.name));
  const managerOnly = querySpecs('manager').filter((q) => !cookNames.has(q.name));
  const all = [...cook.map((q) => ({ q, tier: 'cook' })), ...managerOnly.map((q) => ({ q, tier: 'manager' }))];
  const per = Math.max(1, Math.floor(target / (all.length + 6)));

  for (const { q, tier } of all) {
    for (let i = 0; i < per; i++) {
      const params = paramsFor(q, sources, rng);
      const msg = questionFor(q, params, sources, rng);
      const payload = { action: 'db_query', query: q.name, params };
      const framing = pick(rng, ['Here’s what I found:', '', 'Pulling that now:']);
      // db_query executes on both routing paths — attach whatever directive
      // the classifier gives this phrasing (buildRow decides), no mustBe.
      await push(rows, buildRow(msg, `${fence(payload)}${framing ? '\n' + framing : ''}`, 'db_query', { tier }));
    }
  }

  // read-like imperatives: the ONE cook-tier + ACTION-directive shape that
  // reaches the model in production ("update me on…", "generate a … report" —
  // command leads that miss the PIN pre-gate); correct answer is a read action
  const READ_IMPERATIVES = [
    { msg: 'update me on sales for last week', q: 'sales_by_period', params: { days: 7 }, tier: 'cook' },
    { msg: 'generate a cooling report for today', q: 'cooling_in_progress', params: {}, tier: 'cook' },
    { msg: 'update me on what came in receiving', q: 'recent_receiving', params: { hours: 24 }, tier: 'cook' },
    { msg: 'generate a temp log summary for the walk-in', q: 'recent_temp_log', params: { hours: 24, point_id: 'walk_in_cooler' }, tier: 'cook' },
    { msg: 'update me on open prep', q: 'open_prep_tasks', params: {}, tier: 'cook' },
    { msg: 'generate a cert expiration report', q: 'staff_certifications_expiring', params: {}, tier: 'cook' },
  ];
  const readImpCount = Math.max(6, Math.floor(target * 0.1));
  const validNames = new Set(querySpecs('manager').map((q) => q.name));
  for (let i = 0; i < readImpCount; i++) {
    const t = READ_IMPERATIVES[i % READ_IMPERATIVES.length];
    if (!validNames.has(t.q)) continue;
    await push(rows, buildRow(t.msg,
      `${fence({ action: 'db_query', query: t.q, params: t.params })}\nHere’s what I found:`,
      'db_query', { tier: t.tier, mustBe: 'command', sub: 'read_imperative' }));
  }

  // semantic_search (~10% of the slice)
  const fuzzy = [
    'find that wedding appetizer with the cherry glaze',
    'find the braise we ran for the rodeo weekend',
    'which recipe had the pickled mustard seeds?',
    'search the audit log for anything about the walk-in door',
    'find that spicy aioli we did for the fish special',
    'what was that dessert with the burnt honey?',
  ];
  for (let i = 0; i < Math.max(3, Math.floor(target * 0.1)); i++) {
    const msg = pick(rng, fuzzy);
    await push(rows, buildRow(msg,
      `${fence({ action: 'semantic_search', query: msg.replace(/^(find|search) /, ''), limit: 6 })}`,
      'db_query'));
  }
  return rows;
}

// ── grounded QA ─────────────────────────────────────────────────────────────

const ingLine = (i) => (typeof i === 'string' ? i : `${i.qty ?? ''} ${i.unit ?? ''} ${i.item ?? ''}`.trim());

async function genGroundedQa(sources, rng, target) {
  const rows = [];
  const { recipes } = sources;
  const per = Math.max(1, Math.ceil(target / recipes.length / 4));
  for (const r of recipes) {
    const name = displayName(r);
    // each kind is a fresh-phrasing generator — picking INSIDE the per-loop
    // keeps every emitted row unique (v1 repeated one picked phrasing `per`
    // times, which all collapsed in dedupe)
    const kinds = [];

    if (r.ingredients?.length) {
      kinds.push(() => [
        pick(rng, [`what’s in the ${name}?`, `ingredients for ${name}?`, `what goes into ${name}?`, `run down the ${name} build for me`, `refresh me on what’s in ${name}`]),
        `${name} (from CONTEXT):\n` + r.ingredients.slice(0, 10).map((i) => `- ${ingLine(i)}`).join('\n')
        + (r.ingredients.length > 10 ? `\n- …plus ${r.ingredients.length - 10} more — full list in Recipe Hub` : ''),
      ]);
    }
    if (r.yield_qty) {
      kinds.push(() => [
        pick(rng, [`how much does a batch of ${name} make?`, `what’s the yield on ${name}?`, `how far does one batch of ${name} go?`]),
        `- Batch yield: ${r.yield_qty} ${r.yield_unit || ''}`.trim() + `\n- Scale with the calculator if you need a different batch — say "scale ${name}".`,
      ]);
    }
    if (r.station) {
      kinds.push(() => [
        pick(rng, [`what station runs ${name}?`, `who makes the ${name}?`, `where does ${name} get made?`]),
        `- ${name} is assigned to: ${r.station.split(';').join(', ')}`,
      ]);
    }
    if (r.procedure?.length) {
      kinds.push(() => [
        pick(rng, [`how do I make ${name}?`, `walk me through the ${name} procedure`, `steps for ${name}?`, `talk me through ${name} real quick`]),
        `${name} — from the recipe card:\n` + r.procedure.slice(0, 5).map((s) => `- ${String(s).replace(/^\d+\.\s*/, '')}`).join('\n')
        + (r.procedure.length > 5 ? '\n- Full card in Recipe Hub.' : ''),
      ]);
    }
    if (r.sub_recipes?.length) {
      kinds.push(() => [
        pick(rng, [`what sub-recipes build the ${name}?`, `what do I need prepped before ${name}?`, `what components go into ${name}?`]),
        `Build list for ${name}:\n` + r.sub_recipes.map((s) => `- ${s}`).join('\n'),
      ]);
    }
    if (r.menu_items?.length) {
      kinds.push(() => {
        const mi = pick(rng, r.menu_items);
        return [
          pick(rng, [`walk me through the ${mi}`, `what recipes make up the ${mi}?`, `new guy is on the ${mi} — what’s in it?`]),
          `${mi} resolves to:\n- ${name}${firstStation(r) ? ` (${firstStation(r)})` : ''}`
          + (r.sub_recipes?.length ? '\n' + r.sub_recipes.map((s) => `- ${s}`).join('\n') : '')
          + (r.allergens?.length ? `\n- Allergen tags on file: ${r.allergens.join(', ')} — heuristic, confirm with a manager for guests.` : ''),
        ];
      });
    }
    for (const kind of kinds) {
      for (let i = 0; i < per; i++) {
        const [q, aRaw] = kind();
        await push(rows, questionRow(q, aRaw, 'grounded_qa'));
      }
      if (rows.length >= target) return rows.slice(0, target);
    }
  }
  return rows.slice(0, target);
}

// ── allergen ────────────────────────────────────────────────────────────────

const BIG9_LABELS = { milk: 'dairy', eggs: 'egg', fish: 'fish', shellfish: 'shellfish', 'tree nuts': 'tree nut', peanuts: 'peanut', wheat: 'wheat/gluten', soybeans: 'soy', sesame: 'sesame' };

async function genAllergen(sources, rng, target) {
  const rows = [];
  const { recipes, allergenMatrix } = sources;
  const bySlug = new Map(recipes.map((r) => [r.slug, r]));
  const entries = Object.entries(allergenMatrix).filter(([slug]) => bySlug.has(slug));
  let i = 0;
  while (rows.length < target && entries.length) {
    const [slug, mat] = entries[i++ % entries.length];
    const r = bySlug.get(slug);
    const name = displayName(r);
    const hits = mat.filter((m) => m.big9?.length);
    if (hits.length && rng() < 0.7) {
      const hit = pick(rng, hits);
      const allergen = pick(rng, hit.big9);
      const label = BIG9_LABELS[allergen] || allergen;
      const q = pick(rng, [
        `guest has a ${label} allergy — can they have the ${name}?`,
        `table 12 has a ${label} allergy, is the ${name} ok?`,
        `does the ${name} have ${label} in it?`,
        `${label} allergy at the bar — what’s in the ${name} for them?`,
      ]);
      const a = [
        `- Recipe data shows **${hit.ingredient}** in ${name} carries ${label}${hits.length > 1 ? `; also check: ${hits.filter((h) => h !== hit).map((h) => h.ingredient).slice(0, 3).join(', ')}` : ''}.`,
        `- Cross-contact is always possible on a shared line — never promise an allergen-clean plate.`,
        `- Escalate to a manager for the final call before it fires.`,
      ].join('\n');
      await push(rows, questionRow(q, a, 'allergen'));
    } else {
      const allergen = pick(rng, Object.keys(BIG9_LABELS));
      const label = BIG9_LABELS[allergen];
      const q = pick(rng, [
        `any ${label} in the ${name}?`,
        `guest with a ${label} allergy wants the ${name} — what does the card say?`,
      ]);
      const a = [
        `- The recipe data on file doesn’t list ${label} in ${name} — but those tags are heuristic, not a legal allergen statement.`,
        `- Cross-contact is always possible in a shared kitchen.`,
        `- Get a manager to confirm with the guest before firing it.`,
      ].join('\n');
      await push(rows, questionRow(q, a, 'allergen'));
    }
  }
  return rows;
}

// ── HACCP ───────────────────────────────────────────────────────────────────

async function genHaccp(sources, rng, target) {
  const rows = [];
  // food/item pools widen the unique template space (dedupe exposed a
  // 37-unique-row ceiling in v1) — the ANSWERS stay fixed FDA facts
  const POULTRY = ['chicken', 'the turkey legs', 'wings', 'the whole birds', 'duck breast', 'the fried chicken'];
  const GROUND = ['the burgers', 'meatballs', 'the chorizo patties', 'the smash patties', 'ground pork for the dumplings'];
  const FISH = ['the salmon', 'trout', 'halibut', 'the catch special', 'shrimp skewers'];
  const HOTHOLD = ['the steam table', 'the soup well', 'the hot box', 'the carving station'];
  const COOLING = ['brisket', 'soup', 'the beans', 'the braise', 'stock', 'queso'];
  const REHEAT = ['the beans', 'gravy', 'soup', 'queso', 'the chili'];
  const TPHC_ITEMS = ['the aioli', 'butter at the pass', 'cut tomatoes', 'the garlic oil', 'shucked oysters on display'];
  const CASES = [
    () => [pick(rng, [`what temp does ${pick(rng, POULTRY)} need to hit?`, `internal temp for ${pick(rng, POULTRY)}?`, `is 155 ok for ${pick(rng, POULTRY)}?`, `probe target for ${pick(rng, POULTRY)}?`]),
      '- Poultry: **165°F held for 15 seconds** — no exceptions.\n- If it reads under, keep cooking and re-probe the thickest part.'],
    () => [pick(rng, [`what temp for ${pick(rng, GROUND)}?`, `internal temp on ${pick(rng, GROUND)}?`, `what do ${pick(rng, GROUND)} need to read?`]),
      '- Ground beef/pork: **155°F for 15 seconds**.\n- Whole-muscle rules don’t apply once it’s ground.'],
    () => [pick(rng, [`what does ${pick(rng, FISH)} need to hit inside?`, `what should ${pick(rng, FISH)} read in the middle?`, `temp target for ${pick(rng, FISH)}?`]),
      '- Fish/seafood: **145°F for 15 seconds**.'],
    () => [pick(rng, [`what’s the minimum for ${pick(rng, HOTHOLD)}?`, `${pick(rng, HOTHOLD)} temp requirement?`, `how hot does ${pick(rng, HOTHOLD)} have to stay?`]),
      '- Hot holding: **140°F or above at all times**.\n- Below that, reheat to 165°F within 2 hours or toss per the plan.'],
    () => {
      const t = pick(rng, [80, 85, 90, 95, 100]);
      const h = pick(rng, [2.5, 3, 3.5, 4]);
      const item = pick(rng, COOLING);
      return [pick(rng, [
        `the ${item} has been cooling on the counter ${h} hours and it’s at ${t}F — good to wrap?`,
        `${item}’s at ${t} after ${h} hours of cooling, can I walk it in?`,
        `${item} reads ${t}F, been out ${h} hours — wrap it or toss it?`,
      ]),
      `- **Not compliant.** FDA cooling rule (§3-501.14): 135→70°F within 2 hours, then 70→41°F within 4 more (6 hr max).\n- At ${t}°F after ${h} hours it missed the window — don’t wrap it.\n- Corrective action: ice bath or blast chiller now, log the corrective action, and flag a manager.`];
    },
    () => [pick(rng, [`reheat temp for ${pick(rng, REHEAT)} going back on the line?`, `what does ${pick(rng, REHEAT)} need to hit before hot holding?`, `bringing ${pick(rng, REHEAT)} back up — target temp?`]),
      '- Reheat for hot holding: **165°F within 2 hours**.'],
    () => [pick(rng, ['what should the walk-in be running at?', 'max temp for the reach-in?', 'what temp should the dessert cooler hold?', 'freezer spec — what are we allowed?']),
      '- Walk-in / reach-in refrigeration: **41°F or below**.\n- Freezer: **0°F or below**.\n- If it’s over, log it, move product, and flag maintenance.'],
    () => [pick(rng, ['cold delivery limit for receiving?', 'what’s the max temp to accept refrigerated product?', 'driver just showed up — what temp do we accept cold goods at?']),
      '- Receiving (cold items): **41°F or below** — reject or flag anything warmer.'],
    () => [pick(rng, [`how long can ${pick(rng, TPHC_ITEMS)} sit out on time control?`, `TPHC window for ${pick(rng, TPHC_ITEMS)}?`, `clock rules for ${pick(rng, TPHC_ITEMS)} off temp?`]),
      '- Time-as-a-Public-Health-Control: **4-hour window** from when it leaves temperature control, then discard.\n- Mark the start time so the clock is auditable.'],
  ];
  let i = 0;
  let guard = 0;
  while (rows.length < target && guard++ < target * 4) {
    const [q, a] = CASES[i++ % CASES.length]();
    await push(rows, questionRow(q, a, 'haccp'));
  }
  return rows;
}

// ── refusal / grounding ─────────────────────────────────────────────────────

async function genRefusal(sources, rng, target) {
  const rows = [];
  const { recipes, orderGuideItems } = sources;
  const CASES = [
    () => {
      const dish = pick(rng, recipes.map(displayName));
      return [pick(rng, [
        `how many ${dish} did we sell last night?`, `what did the ${dish} do in sales yesterday?`,
      ]),
      `- Live POS/Toast sales aren’t in today’s Cockpit data — I can’t give you that number.\n- Ask a manager or check Toast directly; if you want logged history, say "sales by dish" and I can run the recorded data instead.`];
    },
    () => [pick(rng, ['what’s the cover count for tonight?', 'how many guests are we projecting for Saturday?']),
      `- Guest counts and cover projections aren’t in today’s Cockpit data — I won’t guess.\n- The manager or the reservation book is the source for that.`],
    () => {
      const item = pick(rng, orderGuideItems).ingredient;
      return [pick(rng, [
        `what’s the current market price on ${item}?`, `did the price on ${item} change this week?`,
      ]),
      `- Real-time pricing isn’t in today’s Cockpit data — the last invoice on file is all I can cite.\n- For live pricing, purchasing or the vendor rep is the source; say "vendor price history" and I can pull what’s on file.`];
    },
    () => [pick(rng, ['what’s my schedule next week?', 'am I on for Sunday brunch?']),
      `- Future schedules that haven’t been exported aren’t in today’s Cockpit data.\n- Check 7shifts or ask the manager who wrote the schedule.`],
    () => [pick(rng, ['what are tips looking like this week?', 'what’s our labor percentage running?']),
      `- Tips and labor-cost percentages aren’t available to me — that’s outside the Cockpit data boundary.\n- A manager can pull that from payroll/analytics.`],
    () => {
      const fake = pick(rng, ['truffle tortellini', 'lobster bisque', 'duck confit flatbread', 'elk sliders']);
      return [pick(rng, [`what’s in the ${fake}?`, `how do I plate the ${fake}?`]),
      `- I don’t see ${fake} in today’s Cockpit data — it’s not in the recipe cache I was given.\n- Check Recipe Hub or ask a manager; if it’s a special, the chef who wrote it has the card.`];
    },
    () => {
      const item = pick(rng, orderGuideItems).ingredient;
      return [pick(rng, [`when is the ${item} order landing?`, `is the ${item} back in stock at the vendor?`]),
      `- Future availability isn’t in today’s Cockpit data — I won’t invent a date.\n- Purchasing or the manager placing the order will know; the order guide shows what’s on the current order.`];
    },
  ];
  let i = 0;
  let guard = 0;
  while (rows.length < target && guard++ < target * 4) {
    const [q, a] = CASES[i++ % CASES.length]();
    await push(rows, questionRow(q, a, 'refusal'));
  }
  return rows;
}

// ── entry ───────────────────────────────────────────────────────────────────

const FULL_TARGETS = { action_json: 1500, db_query: 600, grounded_qa: 1200, allergen: 300, haccp: 400, refusal: 400 };

export async function generateAll(sources, rng, opts = {}) {
  const capN = opts.perSliceCap || Infinity;
  const t = Object.fromEntries(Object.entries(FULL_TARGETS).map(([k, v]) => [k, Math.min(v, capN)]));
  const out = [];
  out.push(...await genActionJson(sources, rng, t.action_json));
  out.push(...await genDbQuery(sources, rng, t.db_query));
  out.push(...await genGroundedQa(sources, rng, t.grounded_qa));
  out.push(...await genAllergen(sources, rng, t.allergen));
  out.push(...await genHaccp(sources, rng, t.haccp));
  out.push(...await genRefusal(sources, rng, t.refusal));
  return out;
}
