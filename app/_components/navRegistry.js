/**
 * Single source of truth for Lariat navigation.
 *
 * Consumed by:
 *   - Sidebar.jsx           → primary nav rail
 *   - CommandPalette.jsx    → ⌘K jump panel
 *   - Floorplan.jsx         → spatial navigator overlay
 *
 * Keep route labels, shortcuts, and search terms here so they never drift
 * between the rail, the palette, and the spatial map. If you add a page,
 * add it here — do NOT add it to Sidebar or CommandPalette directly.
 *
 * Each item shape:
 *   id        — stable string key
 *   href      — route pathname (query is appended by helpers below)
 *   name      — palette title + sidebar label
 *   sub       — palette subtitle (short blurb)
 *   group     — palette group + sidebar section
 *   shortcut  — single-key accelerator (optional)
 *   terms     — extra search-match tokens (optional)
 *   locAware  — true if route should carry ?location= (default true)
 *   surface   — where this item appears: { sidebar: bool, palette: bool, shelf: bool }
 *   shelf     — only present when surface.shelf is true: { b, sub }
 */

const t = true,
  f = false;

export const NAV_ITEMS = [
  {
    id: 'today',
    href: '/',
    name: 'Today',
    sub: 'Rush view',
    group: 'Primary',
    shortcut: '0',
    terms: 'today home rush',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'command',
    href: '/command',
    name: 'Command',
    sub: 'GM at-a-glance',
    group: 'Primary',
    shortcut: 'G',
    terms: 'command center gm dashboard manager',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'stations',
    href: '/stations',
    name: 'All stations',
    sub: 'Line overview',
    group: 'Stations',
    shortcut: 'S',
    terms: 'station line overview',
    locAware: t,
    surface: { sidebar: f, palette: t, shelf: f },
  },

  // ── Service ─────────────────────────────────────────────────────────
  {
    id: 'host',
    href: '/host',
    name: 'Host Stand',
    sub: 'Waitlist + seating',
    group: 'Service',
    shortcut: 'H',
    terms: 'host stand waitlist seat parties foh front of house',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'kds-punch',
    href: '/kds/punch',
    name: 'Punch ticket',
    sub: 'Send to the line',
    group: 'Service',
    shortcut: 'P',
    terms: 'punch ticket order kds expo fire send line',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'eighty-six',
    href: '/eighty-six',
    name: '86 Board',
    sub: "What's out",
    group: 'Service',
    shortcut: '8',
    terms: 'eighty six out 86',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'recipes',
    href: '/recipes',
    name: 'Recipes',
    sub: 'Build, taste, plate',
    group: 'Service',
    shortcut: 'R',
    terms: 'recipe book cookbook',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'inventory',
    href: '/inventory',
    name: 'Inventory',
    sub: 'Counts & moves',
    group: 'Service',
    shortcut: 'I',
    terms: 'inventory count stock',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'prep',
    href: '/prep',
    name: 'Prep board',
    sub: "Today's prep",
    group: 'Service',
    shortcut: 'K',
    terms: 'prep board task tasks shift kitchen',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'fire-schedule',
    href: '/prep/fire-schedule',
    name: 'Fire schedule',
    sub: "Tonight's banquet fires",
    group: 'Service',
    terms: 'fire schedule banquet course beo timing wall board',
    locAware: f,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'reservations',
    href: '/reservations',
    name: 'Reservations',
    sub: 'Tonight’s book',
    group: 'Service',
    shortcut: 'B',
    terms: 'reservation booking party guest',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'floor',
    href: '/floor',
    name: 'Floor plan',
    sub: 'Tables & status',
    group: 'Service',
    shortcut: 'A',
    terms: 'floor table tables seating dining room layout',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'kitchen-assistant',
    href: '/kitchen-assistant',
    name: 'Ask the kitchen',
    sub: 'Chat with the book',
    group: 'Service',
    shortcut: '?',
    terms: 'assistant help ai chat',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'specials',
    href: '/specials',
    name: 'Specials',
    sub: "Today's features",
    group: 'Service',
    shortcut: 'F',
    terms: 'specials feature',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'specials-saved',
    href: '/specials/saved',
    name: 'Saved Specials',
    sub: 'Promoted sandbox sessions',
    group: 'Service',
    terms: 'saved specials sandbox export csv',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'gold-stars',
    href: '/gold-stars',
    name: 'Gold stars',
    sub: 'Recognition',
    group: 'Service',
    shortcut: '★',
    terms: 'gold stars recognition',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },

  // ── Compliance ──────────────────────────────────────────────────────
  {
    id: 'food-safety',
    href: '/food-safety',
    name: 'Food safety',
    sub: 'HACCP hub',
    group: 'Compliance',
    shortcut: 'H',
    terms: 'food safety haccp',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'temp-log',
    href: '/food-safety/temp-log',
    name: 'Temp log',
    sub: 'Fridges, holds',
    group: 'Compliance',
    shortcut: 'T',
    terms: 'temp fridge log temperature',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'receiving',
    href: '/food-safety/receiving',
    name: 'Receiving',
    sub: 'Deliveries in',
    group: 'Compliance',
    shortcut: '↵',
    terms: 'receiving delivery dock',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'calibrations',
    href: '/food-safety/calibrations',
    name: 'Calibrations',
    sub: 'Thermometers',
    group: 'Compliance',
    shortcut: 'C',
    terms: 'calibration thermometer probe',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'tphc',
    href: '/food-safety/tphc',
    name: 'Time control',
    sub: 'Time-held food — 4h / 6h',
    group: 'Compliance',
    shortcut: 'P',
    terms: 'tphc time hot cold hold cutoff',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'labor',
    href: '/labor',
    name: 'Labor',
    sub: 'Breaks & shifts',
    group: 'Compliance',
    shortcut: 'L',
    terms: 'labor break shift clock',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },

  // ── Books (shelf tiles) ─────────────────────────────────────────────
  {
    id: 'analytics',
    href: '/analytics',
    name: 'Sales numbers',
    sub: 'Daily analytics',
    group: 'Books',
    shortcut: '#',
    terms: 'sales analytics revenue numbers',
    locAware: t,
    surface: { sidebar: f, palette: t, shelf: t },
    shelf: { b: 'Sales', sub: 'numbers' },
  },
  {
    id: 'costing',
    href: '/costing',
    name: 'Recipe costs',
    sub: 'Cost of goods',
    group: 'Books',
    shortcut: '$',
    terms: 'costing cost cogs price',
    locAware: t,
    surface: { sidebar: f, palette: t, shelf: t },
    shelf: { b: 'Costs', sub: 'recipes' },
  },
  {
    id: 'purchasing',
    href: '/purchasing',
    name: 'Order guide',
    sub: 'Purchasing',
    group: 'Books',
    shortcut: 'P',
    terms: 'purchasing order guide vendor',
    locAware: t,
    surface: { sidebar: f, palette: t, shelf: t },
    shelf: { b: 'Orders', sub: 'guide' },
  },
  {
    id: 'menu-engineering',
    href: '/menu-engineering',
    name: 'Menu performance',
    sub: 'Engineer the menu',
    group: 'Books',
    shortcut: 'M',
    terms: 'menu engineering performance',
    locAware: t,
    surface: { sidebar: f, palette: t, shelf: t },
    shelf: { b: 'Menu', sub: 'perf' },
  },
  {
    id: 'depletion-exceptions',
    href: '/costing/depletion-exceptions',
    name: 'Depletion exceptions',
    sub: 'Sales lines that didn’t auto-deplete',
    group: 'Books',
    terms: 'depletion exceptions unmapped dish components missing inventory triage',
    locAware: t,
    surface: { sidebar: f, palette: t, shelf: f },
  },
  {
    id: 'pack-changes',
    href: '/costing/pack-changes',
    name: 'Pack-size changes',
    sub: 'Vendor SKUs that flipped pack',
    group: 'Books',
    terms: 'pack size changes vendor sku t6 acknowledge audit costing',
    locAware: f,
    surface: { sidebar: f, palette: t, shelf: f },
  },
  {
    id: 'beo',
    href: '/beo',
    name: 'Events & prep',
    sub: 'BEOs',
    group: 'Books',
    shortcut: 'E',
    terms: 'events beo banquet catering',
    locAware: t,
    surface: { sidebar: f, palette: t, shelf: t },
    shelf: { b: 'Events', sub: '& prep' },
  },
  {
    id: 'equipment',
    href: '/equipment',
    name: 'Equipment',
    sub: 'Gear & PM',
    group: 'Books',
    shortcut: 'Q',
    terms: 'equipment gear maintenance',
    locAware: t,
    surface: { sidebar: f, palette: t, shelf: t },
    shelf: { b: 'Equip.', sub: 'gear' },
  },
  {
    id: 'bar',
    href: '/bar',
    name: 'Bar program',
    sub: 'Cocktail pour costs',
    group: 'Books',
    shortcut: 'X',
    terms: 'bar cocktail drink pour cost beverage',
    locAware: t,
    surface: { sidebar: f, palette: t, shelf: t },
    shelf: { b: 'Bar', sub: 'cocktails' },
  },
  {
    id: 'datapack-search',
    href: '/datapack-search',
    name: 'Data pack',
    sub: 'USDA / OFF / FDA / Wikibooks',
    group: 'Books',
    terms: 'datapack data pack usda fda food code open food facts wikibooks cookbook nutrition lookup reference',
    locAware: f,
    surface: { sidebar: f, palette: t, shelf: t },
    shelf: { b: 'Data', sub: 'lookup' },
  },
  {
    id: 'allergen-lookup',
    href: '/allergen-lookup',
    name: 'Allergen lookup',
    sub: 'OFF allergen check',
    group: 'Books',
    terms: 'allergen allergens off open food facts gtin barcode peanut gluten dairy egg soy nut milk wheat',
    locAware: f,
    surface: { sidebar: f, palette: t, shelf: t },
    shelf: { b: 'Allergens', sub: 'check' },
  },
  {
    id: 'tonight',
    href: '/shows/tonight',
    name: 'Tonight · Live',
    sub: 'Run of show + box office + sound',
    group: 'Entertainment',
    terms: 'tonight live show running run of show box office door sound stage',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'booking',
    href: '/booking',
    name: 'Booking',
    sub: 'Calendar + pipeline',
    group: 'Entertainment',
    terms: 'booking calendar pipeline shows',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'playbook',
    href: '/playbook',
    name: 'Playbook',
    sub: 'Show marketing',
    group: 'Entertainment',
    terms: 'playbook marketing ads tickets dice',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'shows-archive',
    href: '/shows/archive',
    name: 'Past shows',
    sub: 'Archive search',
    group: 'Entertainment',
    terms: 'archive past shows history',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  // Per-show settlement is reachable from a show detail page; the palette
  // entry exists so a manager can jump straight to a show's settlement
  // by typing the band name. The href is a template — palette wires the
  // selected show id at click time. Sidebar is off (not a top-level page).
  {
    id: 'show-settlement',
    href: '/shows/[id]/settlement',
    name: 'Show settlement',
    sub: 'Per-show payout + net door',
    group: 'Entertainment',
    terms: 'settlement payout door talent guarantee deal',
    locAware: t,
    surface: { sidebar: f, palette: t, shelf: f },
  },

  // ── Management ──────────────────────────────────────────────────────
  // Rollup dashboard at /management composes already-shipped signals
  // (variance, costing freshness, coverage, compliance, pack-size, cleaning).
  // Palette-only — sidebar already has dedicated tiles for the underlying
  // surfaces; management is a roll-up for managers, not a new daily route.
  {
    id: 'management',
    href: '/management',
    name: 'Management',
    sub: 'GM rollup',
    group: 'Management',
    terms: 'management rollup gm dashboard manager overview',
    locAware: t,
    surface: { sidebar: f, palette: t, shelf: f },
  },
  // Temp PINs (T10): manager mints scoped 1-shift PINs. Palette-only —
  // not a daily destination, but a quick ⌘K target when handing
  // authority to a sous chef for a banquet.
  {
    id: 'management-temp-pins',
    href: '/management/temp-pins',
    name: 'Temp PINs',
    sub: 'Hand out 1-shift PINs',
    group: 'Management',
    terms: 'temp pin scoped pass shift authority sous chef',
    locAware: f,
    surface: { sidebar: f, palette: t, shelf: f },
  },
  // Audit-log lives under /management. Palette-only — sidebar would
  // crowd the rail, but jumping to "audit" via ⌘K is a common GM move
  // when reconciling who edited what.
  {
    id: 'management-audit-log',
    href: '/management/audit-log',
    name: 'Audit log',
    sub: 'Management actions outside regulated tables',
    group: 'Management',
    terms: 'audit log management actions recipes cost edits trail history',
    locAware: f,
    surface: { sidebar: f, palette: t, shelf: f },
  },
  {
    id: 'management-performance-reviews',
    href: '/management/performance-reviews',
    name: 'Staff reviews',
    sub: 'Log and view performance',
    group: 'Management',
    terms: 'performance review staff evaluation manager log review history',
    locAware: t,
    surface: { sidebar: f, palette: t, shelf: f },
  },
  // Cloud-bridge dead-letter triage. Palette-only — managers visit when
  // the rollup or a status alert flags a stuck batch.
  {
    id: 'management-cloud-bridge',
    href: '/management/cloud-bridge',
    name: 'Cloud bridge',
    sub: 'Stuck snapshots — retry or drop',
    group: 'Management',
    terms: 'cloud bridge dead letter dlq queue stuck retry requeue drop snapshot',
    locAware: t,
    surface: { sidebar: f, palette: t, shelf: f },
  },
];

// ── Selectors ─────────────────────────────────────────────────────────

/** Items that render in the Sidebar primary nav (not shelf, not palette-only). */
export const SIDEBAR_ITEMS = NAV_ITEMS.filter((n) => n.surface.sidebar);

/** Items that render as book-shelf tiles at the bottom of the sidebar. */
export const SHELF_ITEMS = NAV_ITEMS.filter((n) => n.surface.shelf);

/** Items that appear in the ⌘K palette. */
export const PALETTE_ITEMS = NAV_ITEMS.filter((n) => n.surface.palette);

/** Quick index by id for O(1) lookup. */
export const NAV_BY_ID = Object.fromEntries(NAV_ITEMS.map((n) => [n.id, n]));

/** Find by route pathname (prefix match — handy for active-state detection). */
export function itemForPath(pathname) {
  if (!pathname) return null;
  // Prefer exact match; fall back to longest-prefix match.
  let exact = null;
  let best = null;
  let bestLen = -1;
  for (const n of NAV_ITEMS) {
    if (n.href === pathname) exact = n;
    if (pathname.startsWith(n.href) && n.href.length > bestLen) {
      best = n;
      bestLen = n.href.length;
    }
  }
  return exact || best;
}

/** Build an href that preserves the selected location as a query string. */
export function withLocation(href, locQuery) {
  if (!locQuery) return href;
  if (href.includes('?')) return href;
  return `${href}${locQuery}`;
}
