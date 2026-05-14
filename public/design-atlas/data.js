// LaRiOS — shared state, sample wedding-night data, role catalog
// Wedding BEO scenario: "Saturday May 16, 2026 — Calloway × Hong, 140 guests, 7pm cocktail"

window.LARIOS = window.LARIOS || {};

window.LARIOS.now = {
  date: 'Sat May 16, 2026',
  time: '6:48 PM',
  phase: 'COCKTAIL',
  weather: '64° clear',
  service: { covers: 142, ontap: 18, dishes: 207, tickets: 14 }
};

window.LARIOS.roles = [
  { id: 'gm',       label: 'GM / MOD',          dept: 'Office', surface: 'desktop' },
  { id: 'owner',    label: 'Ownership',         dept: 'Office', surface: 'desktop' },
  { id: 'expo',     label: 'Expo · Wall KDS',   dept: 'BOH',    surface: 'wall' },
  { id: 'sous',     label: 'Sous · Prep',       dept: 'BOH',    surface: 'tablet' },
  { id: 'line',     label: 'Line cook',         dept: 'BOH',    surface: 'phone' },
  { id: 'bar',      label: 'Bartender',         dept: 'Bar',    surface: 'tablet' },
  { id: 'server',   label: 'Server',            dept: 'FOH',    surface: 'tablet' },
  { id: 'host',     label: 'Host',              dept: 'FOH',    surface: 'tablet' },
  { id: 'coord',    label: 'Event coordinator', dept: 'Events', surface: 'desktop' },
  { id: 'stage',    label: 'Stage / Sound',     dept: 'Music',  surface: 'desktop' },
  { id: 'inv',      label: 'Inventory lead',    dept: 'BOH',    surface: 'tablet' },
  { id: 'signage',  label: 'Public signage',    dept: 'X',      surface: 'wall' },
];

window.LARIOS.beo = {
  id: 'BEO-2641',
  title: 'Calloway × Hong',
  kind: 'Wedding · plated 4-course',
  date: 'Sat May 16, 2026',
  guests: 142,
  contact: { primary: 'Marie Calloway (bride)', planner: 'Lila Ortiz / Veil & Vine', phone: '512.555.0117' },
  spaces: ['Garden Hall', 'Patio (cocktails)', 'Mezzanine (band)'],
  schedule: [
    { t: '4:00 PM', what: 'Florist load-in · Patio',      group: 'pre' },
    { t: '4:30 PM', what: 'Band load-in · Loading dock',  group: 'pre' },
    { t: '5:30 PM', what: 'Soundcheck · Mezzanine',       group: 'pre' },
    { t: '6:30 PM', what: 'Ceremony · Garden Hall',       group: 'pre' },
    { t: '7:00 PM', what: 'Cocktail hour · Patio',        group: 'now' },
    { t: '8:00 PM', what: 'Seating · 1st course',         group: 'next' },
    { t: '8:25 PM', what: 'Toasts · Mic 1',               group: 'next' },
    { t: '8:45 PM', what: 'Entrée fire · 18 tops',        group: 'next' },
    { t: '9:30 PM', what: 'Cake cut · Band set 1',        group: 'late' },
    { t: '10:30 PM',what: 'Set 2 · open bar continues',   group: 'late' },
    { t: '12:00 AM',what: 'Last call · Load-out',         group: 'late' },
  ],
  menu: {
    canape: ['Smoked trout cracker', 'Mushroom toast', 'Lamb meatball', 'Cucumber gazpacho'],
    course1: 'Heirloom tomato · stracciatella · basil oil',
    course2: 'Charred corn agnolotti · brown butter · chive',
    course3a: 'Wagyu hanger · marrow jus · sunchoke (84)',
    course3b: 'Halibut · saffron broth · fennel (38)',
    course3c: 'Roasted carrot · farro · pistachio yogurt (20 veg)',
    dessert: 'Olive oil cake · stone fruit · creme fraiche'
  },
  bar: {
    signatures: [
      { name: 'The Calloway Cup',  pour: 'Gin · lavender · lemon · cava' },
      { name: 'Tied the Knot',     pour: 'Mezcal · grapefruit · ancho' },
      { name: 'Honor Among Bees',  pour: 'Bourbon · honey · sage' }
    ],
    program: 'Open bar · top shelf · no shots after 11:30',
    forecast: '4.1 drinks/guest expected; surge during set-break.'
  },
  band: {
    name: 'The Bramble Riders',
    members: 5,
    lead: 'Jonah Castille',
    rider: ['12 bottles still water on stage', 'No nuts in green room',
      'Vegetarian meal for drummer (Sara M.)', 'Stage left mic for fiddle',
      '2 IEM packs + 1 wedge', 'Load-out access via south alley before 12:30'],
    stage: { kit: 'center-left', amps: 'stage right', mic1: 'center', fiddle: 'stage left' }
  }
};

// Live KDS tickets — wedding plated service
window.LARIOS.tickets = [
  { id: '#841', tbl: '12 / Seat 1-8',   age: 142, status:'fire',   course:'COURSE 1', items:['8 · tomato'], pacing:'on', allergens:['nut x1'] },
  { id: '#842', tbl: '14 / Seat 1-10',  age: 115, status:'fire',   course:'COURSE 1', items:['10 · tomato'], pacing:'on' },
  { id: '#843', tbl: '11 / Seat 1-8',   age: 96,  status:'plate',  course:'COURSE 2', items:['8 · agnolotti'], pacing:'fast', allergens:['gluten x2'] },
  { id: '#844', tbl: '18 / Seat 1-10',  age: 88,  status:'pickup', course:'COURSE 3', items:['7 · hanger','2 · halibut','1 · carrot'], pacing:'on' },
  { id: '#845', tbl: '08 / Seat 1-6',   age: 71,  status:'pickup', course:'COURSE 3', items:['4 · hanger','2 · halibut'], pacing:'on' },
  { id: '#846', tbl: '22 / Seat 1-8',   age: 58,  status:'cook',   course:'COURSE 3', items:['6 · hanger','2 · halibut'], pacing:'on' },
  { id: '#847', tbl: '19 / Seat 1-10',  age: 44,  status:'cook',   course:'COURSE 3', items:['8 · hanger','2 · veg'],     pacing:'late', allergens:['shellfish x1'] },
  { id: '#848', tbl: '07 / Seat 1-6',   age: 28,  status:'cook',   course:'COURSE 3', items:['4 · hanger','2 · halibut'], pacing:'on' },
  { id: '#849', tbl: '25 / Seat 1-8',   age: 14,  status:'mise',   course:'COURSE 3', items:['6 · hanger','2 · veg'],     pacing:'on' },
  { id: '#850', tbl: '03 / Seat 1-4',   age: 4,   status:'mise',   course:'COURSE 3', items:['3 · hanger','1 · halibut'], pacing:'on' },
];

window.LARIOS.lari = {
  predictions: [
    { sev:'warn',  txt:'Course 3 pacing will skew +6 min if band starts toasts at 8:25.',
      action:'Hold T19/T22 fire 2 min',  for:'expo' },
    { sev:'ok',    txt:'Halibut count adequate through 10:30. Wagyu OK through 11:00.',     for:'sous' },
    { sev:'alert', txt:'Bar throughput will spike to ~190/hr at set-break (9:15). Open service well.', for:'bar' },
    { sev:'warn',  txt:'Patio 88dB — band soundcheck audible at cocktail. Drop monitor by 4dB.', for:'stage' },
    { sev:'ok',    txt:'2 vegan covers reseated to T08 — fired correctly.', for:'server' },
    { sev:'alert', txt:'Walk-in #2 temp drifting +3°F since 5:40. Compressor cycle long.',    for:'gm' },
    { sev:'warn',  txt:'Veil & Vine florist still on patio. Cocktail wave begins in 11 min.', for:'host' },
    { sev:'ok',    txt:'Drummer\u2019s vegetarian meal staged at expo. Will go with crew dinner.', for:'coord' }
  ]
};

window.LARIOS.maint = [
  { sys:'Walk-in cooler #2', issue:'Compressor cycling long', sev:'alert', vendor:'Hill Country Refrig.', eta:'AM Mon' },
  { sys:'Ice machine #1',    issue:'Filter due in 4 days',     sev:'warn',  vendor:'self-service',         eta:'Tue PM' },
  { sys:'Hood #3 (sauté)',   issue:'Quarterly cleaning',       sev:'warn',  vendor:'Lonestar Hood',        eta:'May 22' },
  { sys:'Speaker FOH-R',     issue:'Intermittent crackle',     sev:'warn',  vendor:'Audio Junction',       eta:'Pending' },
  { sys:'POS-04',            issue:'Receipt printer jam',      sev:'ok',    vendor:'self-service',         eta:'Resolved' },
  { sys:'Stage riser',       issue:'Bolt #3 worn',             sev:'alert', vendor:'in-house carp.',       eta:'Today 5p' },
];

window.LARIOS.staff = [
  { id:'rj', n:'Renata Jiménez', r:'Sous chef', score:4.7, shift:'4–close', stat:'on', avatar:'RJ' },
  { id:'ms', n:'Marcus Steele',  r:'Expo',      score:4.5, shift:'5–close', stat:'on', avatar:'MS' },
  { id:'hl', n:'Hana Lê',        r:'Bartender', score:4.8, shift:'5–close', stat:'on', avatar:'HL' },
  { id:'dt', n:'Devon Tate',     r:'Server',    score:4.6, shift:'5–close', stat:'on', avatar:'DT' },
  { id:'es', n:'Esme Suárez',    r:'Server',    score:4.4, shift:'5–close', stat:'on', avatar:'ES' },
  { id:'pj', n:'Peter Joachim',  r:'Sound eng.',score:4.6, shift:'4–close', stat:'on', avatar:'PJ' },
  { id:'ai', n:'Aria Ito',       r:'Host',      score:4.9, shift:'4–11',    stat:'on', avatar:'AI' },
  { id:'kw', n:'Kai Wendt',      r:'Runner',    score:4.2, shift:'6–close', stat:'late',avatar:'KW' },
];

window.LARIOS.banlist = [
  { id:'B-2026-014', name:'(redacted) "Big Mike"', reason:'Repeated harassment of staff · 02/14',     length:'1 year',    issued:'2026-02-15', by:'GM A. Reed', photo:'BM' },
  { id:'B-2026-009', name:'(redacted) "Slim"',     reason:'Property damage · broken pint glass set', length:'90 days',   issued:'2026-03-22', by:'MOD J. Quan', photo:'SL' },
  { id:'B-2026-002', name:'(redacted)',            reason:'Open container outside premises',         length:'30 days',   issued:'2026-04-30', by:'Security · K. Boone', photo:'??' },
  { id:'B-2025-088', name:'(redacted)',            reason:'Threatening behavior toward band',        length:'Indefinite',issued:'2025-12-09', by:'Owner',       photo:'??' },
];

// Inventory snapshot
window.LARIOS.inv = [
  { sku:'BF-HANG-WAGYU',  name:'Wagyu hanger 6oz',   par:24, oh:18, unit:'each', vendor:'Niman Ranch',  trend:'down', stat:'warn' },
  { sku:'FISH-HALIB-LB',  name:'Halibut filet',      par:14, oh:12, unit:'lb',   vendor:'Sea Forager',  trend:'down', stat:'ok'   },
  { sku:'TOM-HEIRL-LB',   name:'Heirloom tomato',    par:30, oh:22, unit:'lb',   vendor:'Boggy Creek',  trend:'flat', stat:'ok'   },
  { sku:'BTL-CAVA-NV',    name:'Cava (sig cocktail)',par:36, oh:48, unit:'btl',  vendor:'Pinnacle Wine',trend:'up',   stat:'ok'   },
  { sku:'SP-MEZ-MM',      name:'Mezcal · Mal de Amor',par:6, oh:3,  unit:'btl',  vendor:'Pinnacle Wine',trend:'down', stat:'alert'},
  { sku:'DAIRY-CF-32',    name:'Crème fraîche 32oz', par:8,  oh:9,  unit:'tub',  vendor:'Mill King',    trend:'up',   stat:'ok'   },
];
