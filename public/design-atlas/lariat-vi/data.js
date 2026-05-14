/* Lariat data: menu, recipes, staff, BEOs, etc. */
window.LARIAT_DATA = {
  recipes: [
    {id:'lariat_rub',name:'Lariat Rub',cat:'seasoning',yield:'6 cup',station:'all'},
    {id:'buttermilk_brine',name:'Buttermilk Brine',cat:'prep',yield:'12 qt',station:'fry'},
    {id:'queso_mac_sauce',name:'Queso / Mac Sauce',cat:'sauce',yield:'22 qt',station:'expo'},
    {id:'blackened_tomato_salsa',name:'Blackened Tomato Salsa',cat:'sauce',yield:'22 qt',station:'grill'},
    {id:'chicken_flour',name:'Chicken Flour',cat:'prep',yield:'22 qt',station:'fry'},
    {id:'nashville_hot_rub',name:'Nashville Hot Rub',cat:'seasoning',yield:'2 cup',station:'fry'},
    {id:'nashville_oil',name:'Nashville Oil',cat:'sauce',yield:'2 qt',station:'fry'},
    {id:'aji_verde',name:'Aji Verde',cat:'sauce',yield:'3.2 qt',station:'saute'},
    {id:'bacon_jam',name:'Bacon Jam',cat:'sauce',yield:'10 qt',station:'grill'},
    {id:'special_sauce',name:'Special Sauce',cat:'sauce',yield:'4 qt',station:'fry'},
    {id:'green_chile',name:'Green Chile',cat:'entree',yield:'8 qt',station:'expo'},
    {id:'cornbread',name:'Jalapeño Cheddar Cornbread',cat:'prep',yield:'2 pan',station:'grill'},
    {id:'birria',name:'Birria',cat:'entree',yield:'16 qt',station:'grill'},
    {id:'tomato_soup',name:'Tomato Soup',cat:'soup',yield:'4 qt',station:'saute'},
  ],
  menu: [
    {id:'MI-S01',name:'Jalapeño Cheddar Cornbread',cat:'shareable',price:10,station:'grill',cost:2.10,sold:142},
    {id:'MI-S02',name:'The Trio',cat:'shareable',price:15,station:'expo',cost:3.40,sold:188},
    {id:'MI-S03',name:'The Pig Wings',cat:'shareable',price:17,station:'fry',cost:5.20,sold:96},
    {id:'MI-S04',name:'Caprese Toast',cat:'shareable',price:13,station:'grill',cost:3.10,sold:64},
    {id:'MI-S05',name:'Mountain Mac & Cheese',cat:'shareable',price:13,station:'saute',cost:2.80,sold:124},
    {id:'MI-S06',name:'Chicken Wings',cat:'shareable',price:17,station:'fry',cost:4.60,sold:212},
    {id:'MI-SA01',name:'The Rope Salad',cat:'salad',price:15,station:'salad',cost:3.20,sold:88},
    {id:'MI-SA02',name:'Cobb Salad',cat:'salad',price:18,station:'salad',cost:4.40,sold:74},
    {id:'MI-SA03',name:'Green Chile',cat:'soup',price:8,station:'expo',cost:1.80,sold:156},
    {id:'MI-SA04',name:'Roasted Tomato Soup',cat:'soup',price:6,station:'expo',cost:1.30,sold:102},
    {id:'MI-M01',name:'Classic BLT',cat:'main',price:16,station:'grill',cost:4.10,sold:54},
    {id:'MI-M02',name:'The Rope Burger',cat:'main',price:17,station:'grill',cost:4.80,sold:241},
    {id:'MI-M03',name:'El Jefe Burger',cat:'main',price:17,station:'grill',cost:5.10,sold:118},
    {id:'MI-M04',name:'Nashville Hot Chicken Sandwich',cat:'main',price:16,station:'fry',cost:4.40,sold:198},
    {id:'MI-M05',name:'Whole Roasted Trout',cat:'main',price:22,station:'saute',cost:8.10,sold:42},
    {id:'MI-M06',name:'Fish and Chips',cat:'main',price:18,station:'fry',cost:5.60,sold:134},
    {id:'MI-M07',name:'Baja Fish Tacos',cat:'main',price:16,station:'fry',cost:4.90,sold:166},
    {id:'MI-M08',name:'Quesa Birria Tacos',cat:'main',price:16,station:'grill',cost:4.70,sold:184},
    {id:'MI-M09',name:'Roasted Chicken Leg',cat:'main',price:22,station:'fry',cost:6.30,sold:78},
    {id:'MI-M10',name:'Pork Chop',cat:'main',price:27,station:'saute',cost:9.40,sold:62},
  ],
  staff: [
    {id:1,name:'Marisol Vega',role:'Executive Chef',dept:'BOH',rate:34,hours:48,certs:['ServSafe','Food Handler']},
    {id:2,name:'Diego Reyes',role:'Sous Chef',dept:'BOH',rate:26,hours:42,certs:['ServSafe','Food Handler']},
    {id:3,name:'Tariq Boone',role:'Line — Grill',dept:'BOH',rate:21,hours:38,certs:['Food Handler']},
    {id:4,name:'June Park',role:'Line — Sauté',dept:'BOH',rate:21,hours:36,certs:['Food Handler']},
    {id:5,name:'Cody Whitlock',role:'Line — Fry',dept:'BOH',rate:19,hours:38,certs:['Food Handler']},
    {id:6,name:'Hana Imani',role:'Line — Salad',dept:'BOH',rate:18,hours:32,certs:['Food Handler']},
    {id:7,name:'Esteban Rivas',role:'Prep Cook',dept:'BOH',rate:18,hours:34,certs:['Food Handler']},
    {id:8,name:'Mickey Doyle',role:'Dishwasher',dept:'BOH',rate:17,hours:36,certs:[]},
    {id:9,name:'Ren Calloway',role:'GM',dept:'OFFICE',rate:38,hours:50,certs:['ServSafe','TABC']},
    {id:10,name:'Sasha Linwood',role:'Floor Manager',dept:'FOH',rate:24,hours:42,certs:['ServSafe','TABC']},
    {id:11,name:'Tomás Huerta',role:'Server',dept:'FOH',rate:9,hours:30,certs:['TABC']},
    {id:12,name:'Lila Brooks',role:'Server',dept:'FOH',rate:9,hours:32,certs:['TABC']},
    {id:13,name:'Marquise Field',role:'Server',dept:'FOH',rate:9,hours:28,certs:['TABC']},
    {id:14,name:'Polly Vance',role:'Host',dept:'FOH',rate:18,hours:30,certs:[]},
    {id:15,name:'Wes Ackerman',role:'Bartender',dept:'BAR',rate:14,hours:36,certs:['TABC']},
    {id:16,name:'Margo Sun',role:'Bartender',dept:'BAR',rate:14,hours:34,certs:['TABC']},
    {id:17,name:'Phin Ortega',role:'Bar Back',dept:'BAR',rate:16,hours:30,certs:['TABC']},
    {id:18,name:'Roan Bishop',role:'Sound Engineer',dept:'EVENT',rate:28,hours:24,certs:[]},
    {id:19,name:'Astrid Lowe',role:'Runner',dept:'FOH',rate:13,hours:24,certs:[]},
    {id:20,name:'Jules Carver',role:'Busser',dept:'FOH',rate:13,hours:24,certs:[]},
  ],
  reservations: [
    {time:'5:30',party:2,name:'Halpert',table:12,status:'seated',vip:false},
    {time:'5:45',party:4,name:'Okafor',table:7,status:'seated',vip:true,note:'Anniversary'},
    {time:'6:00',party:6,name:'Brennan',table:21,status:'arrived',vip:false,note:'Allergy: shellfish'},
    {time:'6:15',party:2,name:'Yuen',table:4,status:'seated',vip:false},
    {time:'6:30',party:4,name:'Rojas',table:14,status:'confirmed',vip:false},
    {time:'6:45',party:8,name:'Mercer party',table:30,status:'confirmed',vip:true,note:'Birthday — cake at 8pm'},
    {time:'7:00',party:2,name:'Kapoor',table:9,status:'confirmed',vip:false},
    {time:'7:15',party:5,name:'Demarco',table:18,status:'confirmed',vip:false,note:'Vegetarian x2'},
    {time:'7:30',party:3,name:'Hollings',table:11,status:'confirmed',vip:false},
    {time:'7:45',party:4,name:'Whitford',table:16,status:'confirmed',vip:true,note:'Regulars — booth pref'},
    {time:'8:00',party:6,name:'Ngata',table:22,status:'confirmed',vip:false},
    {time:'8:15',party:2,name:'Bell',table:5,status:'confirmed',vip:false},
    {time:'8:30',party:4,name:'Ito',table:13,status:'confirmed',vip:false,note:'GF'},
    {time:'8:45',party:2,name:'Tchaikov',table:8,status:'confirmed',vip:false},
    {time:'9:00',party:10,name:'Bandstand pre-show',table:25,status:'confirmed',vip:true,note:'Sound check 8:30'},
  ],
  tickets: [
    {id:101,table:7,seats:4,age:8,items:['Pig Wings','Cornbread','Trout','Burger x2','Mac & Cheese'],station:'expo'},
    {id:102,table:12,seats:2,age:14,items:['Cobb','Birria Tacos','Fries'],station:'expo',late:true},
    {id:103,table:21,seats:6,age:4,items:['Trio','Wings (Bama)','Pork Chop','BLT','Tacos x2','Salad'],station:'expo'},
    {id:104,table:4,seats:2,age:11,items:['Cornbread','Nashville Sando','Mac & Cheese'],station:'expo'},
    {id:105,table:14,seats:4,age:2,items:['Trio','Caprese','Burger','Trout','Fish & Chips'],station:'expo'},
  ],
  eightySix: [
    {item:'Whole Roasted Trout',since:'5:42 PM',by:'Diego R.',cascade:['Sub: rainbow trout out — 86 til AM delivery']},
    {item:'Banana Pudding',since:'4:18 PM',by:'Esteban R.',cascade:['Out til tomorrow']},
  ],
  bookings: [
    {date:'Apr 26',artist:'The Bramble Hollow',genre:'Alt-Country',guarantee:600,split:'70/30',draw:218,status:'confirmed'},
    {date:'Apr 27',artist:'DJ Lasso',genre:'DJ Set',guarantee:300,split:'door',draw:140,status:'confirmed'},
    {date:'May 02',artist:'Coyote Standard',genre:'Honky-tonk',guarantee:800,split:'80/20',draw:280,status:'confirmed'},
    {date:'May 03',artist:'Marigold Tooth',genre:'Indie Folk',guarantee:500,split:'70/30',draw:0,status:'hold'},
    {date:'May 09',artist:'Junior & The Aces',genre:'Soul',guarantee:1100,split:'85/15',draw:0,status:'confirmed'},
    {date:'May 10',artist:'TBD',genre:'—',guarantee:0,split:'—',draw:0,status:'open'},
    {date:'May 16',artist:'Sundown Strings',genre:'Bluegrass',guarantee:700,split:'75/25',draw:0,status:'tentative'},
  ],
  beos: [
    {id:'BEO-0428',date:'Apr 28',name:'Whitford 30th',count:42,style:'Plated',menu:['Pig Wings','Trout','Pork Chop'],contact:'Whitford'},
    {id:'BEO-0501',date:'May 01',name:'Aspen Tech offsite',count:80,style:'Buffet',menu:['Trio','Birria','Salad','Cornbread','Churros'],contact:'Vince O.'},
    {id:'BEO-0508',date:'May 08',name:'Brennan rehearsal dinner',count:32,style:'Family-style',menu:['Pig Wings','Burger','Salad'],contact:'Brennan'},
  ],
  vendors: [
    {name:'Shamrock',cat:'Dry/Frozen',spend:18420,delta:-2.1,terms:'Net 14'},
    {name:'Sysco',cat:'Broadline',spend:31870,delta:+1.4,terms:'Net 21'},
    {name:'Lariat Farms (Greens)',cat:'Produce',spend:4280,delta:+8.2,terms:'Net 7'},
    {name:'Cervantes Meats',cat:'Protein',spend:14660,delta:-0.6,terms:'Net 14'},
    {name:'High Country Dairy',cat:'Dairy',spend:5240,delta:+3.3,terms:'Net 14'},
    {name:'Front Range Bottling',cat:'Bev',spend:9920,delta:+0.4,terms:'Net 30'},
  ],
  haccpToday: [
    {area:'Walk-in 1',temp:38,target:'<40',status:'ok',time:'10:14 AM'},
    {area:'Walk-in 2',temp:39,target:'<40',status:'ok',time:'10:14 AM'},
    {area:'Reach-in (line)',temp:41,target:'<40',status:'flag',time:'2:08 PM',action:'Dropped to 39° after recheck @ 2:42'},
    {area:'Freezer 1',temp:-2,target:'<0',status:'ok',time:'10:14 AM'},
    {area:'Hot hold (queso)',temp:142,target:'>135',status:'ok',time:'3:00 PM'},
    {area:'Sani bucket — fry',temp:'200ppm',target:'150-400',status:'ok',time:'3:30 PM'},
  ],
  // Sales & ops snapshot
  kpis: {
    coversToday: 218, coversProj: 240, salesToday: 9420, salesProj: 10200,
    foodCostPct: 28.4, laborPct: 31.2, barCostPct: 22.1, primeCost: 59.6,
    avgTicket: 32, ppa: 43.20, openTabs: 18, avgTicketTime: 11.4,
  },
  hourly: [
    {hr:'11A',covers:8,sales:240}, {hr:'12P',covers:34,sales:1240}, {hr:'1P',covers:42,sales:1640},
    {hr:'2P',covers:18,sales:620}, {hr:'3P',covers:6,sales:180}, {hr:'4P',covers:12,sales:380},
    {hr:'5P',covers:28,sales:1020}, {hr:'6P',covers:38,sales:1580}, {hr:'7P',covers:32,sales:1480}, {hr:'8P',covers:0,sales:0}, {hr:'9P',covers:0,sales:0},
  ],
  weekSales: [
    {d:'Mon',s:7200}, {d:'Tue',s:6840}, {d:'Wed',s:8120}, {d:'Thu',s:9410}, {d:'Fri',s:13280}, {d:'Sat',s:14920}, {d:'Sun',s:9420},
  ],
  pl: {
    revenue: 412800, food: 117240, bar: 38160, labor: 128790, occupancy: 22000, mktg: 6200, other: 14800, net: 85610,
  },
  weeksYoY: [
    {wk:'W1',cur:62800,prev:54200},{wk:'W2',cur:68400,prev:58900},{wk:'W3',cur:71200,prev:61800},
    {wk:'W4',cur:74600,prev:64400},{wk:'W5',cur:69800,prev:66200},{wk:'W6',cur:73400,prev:62800},
    {wk:'W7',cur:78200,prev:67400},{wk:'W8',cur:81600,prev:69800},{wk:'W9',cur:84200,prev:71400},
    {wk:'W10',cur:79800,prev:73200},{wk:'W11',cur:86400,prev:74800},{wk:'W12',cur:92800,prev:76200},
  ],
  inventory: [
    {id:'INV-01',name:'Brisket (whole)',cat:'Protein',have:48,unit:'lb',par:80,vendor:'Cervantes',lastPaid:7.80,trend:+2.1},
    {id:'INV-02',name:'Chicken thigh',cat:'Protein',have:62,unit:'lb',par:90,vendor:'Cervantes',lastPaid:3.40,trend:-0.4},
    {id:'INV-03',name:'Trout (rainbow)',cat:'Protein',have:0,unit:'lb',par:24,vendor:'Sysco',lastPaid:11.20,trend:+8.2},
    {id:'INV-04',name:'Heirloom tomato',cat:'Produce',have:14,unit:'lb',par:24,vendor:'Lariat Farms',lastPaid:3.60,trend:+12.4},
    {id:'INV-05',name:'Romaine',cat:'Produce',have:18,unit:'cs',par:20,vendor:'Lariat Farms',lastPaid:42.00,trend:+1.8},
    {id:'INV-06',name:'Buttermilk',cat:'Dairy',have:6,unit:'gal',par:8,vendor:'High Country',lastPaid:5.40,trend:0},
    {id:'INV-07',name:'Cornmeal',cat:'Dry',have:42,unit:'lb',par:50,vendor:'Shamrock',lastPaid:1.20,trend:-0.6},
    {id:'INV-08',name:'Frying oil',cat:'Dry',have:4,unit:'cs',par:6,vendor:'Sysco',lastPaid:38.00,trend:+1.2},
    {id:'INV-09',name:'Yuengling kegs',cat:'Bev',have:2,unit:'kg',par:4,vendor:'Front Range',lastPaid:158.00,trend:0},
    {id:'INV-10',name:'Mezcal (Vago)',cat:'Bev',have:3,unit:'btl',par:6,vendor:'Front Range',lastPaid:42.00,trend:+3.4},
  ],
};

// staff tenure (months at Lariat) — added post-hoc
window.LARIAT_DATA.staff.forEach((s,i)=>{ s.tenure = [38,26,18,14,9,22,7,11,52,28,8,14,6,20,16,12,4,18,10,8][i] || 12; });

// ─── ENTERTAINMENT — venue / concert hall data ───
window.LARIAT_DATA.entertainment = {
  // Tonight's show — full picture
  tonight: {
    artist: 'The Bramble Hollow', genre: 'Alt-Country · 5-piece',
    date: 'Sat Apr 25', doors: '8:30 PM', set1: '9:30', set2: '10:45', curfew: '12:30',
    cap: 220, sold: 184, holdsComps: 18, walkupTarget: 18,
    advance: 184, presale: 142, doorPrice: 15, presalePrice: 12, ticketsRemaining: 18,
    guarantee: 1100, splitOver: '70/30', breakeven: 168,
    posterAvailable: true, mailerSent: true, radioSpotsRun: 14,
    contact: { mgr:'Rena Voigt', phone:'512-555-0181', email:'rena@bramblehollow.co' },
    transport:'Sprinter van · 2 trailers', parking:'Reserved · alley · 8:30-1AM',
    socials:{ig:'12.4k',fb:'8.1k',spotifyMonthly:'41k'},
  },

  // Hold/booking pipeline — funnel from inquiry to confirmed
  pipeline: [
    {stage:'Inquiry',count:14,recent:['Rosalia Cinco','Mavis Bone','The Halberd Co.','Joaquin & Pearl']},
    {stage:'Offer out',count:6,recent:['Marigold Tooth','Sundown Strings']},
    {stage:'Hold · 1st',count:9,recent:['The Pinedale Boys (May 24)','Antler Hours (Jun 06)']},
    {stage:'Hold · 2nd',count:4,recent:['DJ Ferris (May 31)']},
    {stage:'Confirmed',count:11,recent:['Bramble Hollow','Coyote Standard','Junior & The Aces']},
    {stage:'Contracted',count:8,recent:['signed riders + W-9 on file']},
  ],

  // Calendar — 5 weeks ahead
  calendar: [
    {date:'Apr 25',day:'Sat',artist:'The Bramble Hollow',genre:'Alt-Country',cap:220,sold:184,status:'tonight',price:'$12/$15'},
    {date:'Apr 26',day:'Sun',artist:'Sunday Sessions · open jam',genre:'Open',cap:120,sold:0,status:'free',price:'free'},
    {date:'Apr 30',day:'Thu',artist:'DJ Lasso',genre:'DJ Set',cap:220,sold:96,status:'on-sale',price:'$10'},
    {date:'May 02',day:'Fri',artist:'Coyote Standard',genre:'Honky-tonk',cap:220,sold:178,status:'on-sale',price:'$15/$18'},
    {date:'May 03',day:'Sat',artist:'Marigold Tooth',genre:'Indie Folk',cap:220,sold:0,status:'hold',price:'tbd'},
    {date:'May 09',day:'Fri',artist:'Junior & The Aces',genre:'Soul · 7pc',cap:220,sold:212,status:'near-sellout',price:'$20/$24'},
    {date:'May 10',day:'Sat',artist:'TBD',genre:'—',cap:220,sold:0,status:'open',price:'—'},
    {date:'May 16',day:'Fri',artist:'Sundown Strings',genre:'Bluegrass',cap:220,sold:0,status:'tentative',price:'$12/$15'},
    {date:'May 17',day:'Sat',artist:'Antler Hours + Rabbit Howl',genre:'Indie · double bill',cap:220,sold:0,status:'hold',price:'$18'},
    {date:'May 23',day:'Fri',artist:'The Pinedale Boys',genre:'Country',cap:220,sold:0,status:'hold',price:'tbd'},
  ],

  // Box office — ticket sales over time
  ticketCurve: [
    {d:'-21',sold:8},{d:'-18',sold:14},{d:'-14',sold:32},{d:'-10',sold:58},
    {d:'-7',sold:84},{d:'-5',sold:108},{d:'-3',sold:132},{d:'-2',sold:148},{d:'-1',sold:164},{d:'0',sold:184},
  ],
  willCall: [
    {name:'Aldridge, M.',qty:2,id:'WC-0142',paid:true,checkedIn:false},
    {name:'Beauchamp, T.',qty:4,id:'WC-0143',paid:true,checkedIn:true},
    {name:'Cantu, J.',qty:2,id:'WC-0148',paid:true,checkedIn:false},
    {name:'Donovan, R.',qty:1,id:'WC-0151',paid:true,checkedIn:true},
    {name:'Espinosa, F.',qty:6,id:'WC-0156',paid:true,checkedIn:false,note:'Birthday · cake at 10:30'},
    {name:'Forrest, C.',qty:2,id:'WC-0162',paid:false,checkedIn:false,note:'Pay at door'},
  ],
  comps: [
    {who:'Calder (owner)',qty:4,for:'Bramble Hollow'},
    {who:'KUTX morning host',qty:2,for:'Bramble Hollow',reason:'spin trade'},
    {who:'Press · ATX Weekly',qty:2,for:'Bramble Hollow',reason:'review'},
    {who:'Band · 8 plus 2',qty:10,for:'Bramble Hollow'},
  ],

  // Hospitality rider — what the band gets
  rider: {
    greenroom: ['Stocked cooler · 24 cans LaCroix, 12 Topo Chico, 12 Modelo, 6 Coors','2 bottles still water · room temp','Hot kettle · throat coat tea · honey','Towel set · 8 white','Iron + board','Mirror · full length'],
    hospitality:['Hot meal for 7 at 6:30 PM','One veg, one GF (mgmt confirmed)','Coffee service available til midnight','Late-night snack tray at 11:30'],
    tech:['Stage power: 4× 20A circuits, no shared with HVAC','Wireless: 4 channels, no cordless phones in 600MHz','House drum kit available · Yamaha Stage Custom 5pc','House Ampeg SVT cab on request'],
    hospitalityCost: 162.40,
    notes:'No M&Ms in greenroom (allergy). Dressing room locked til band arrives.',
  },

  // Sound — channel sheet, patches, monitors
  channels: [
    {ch:1,src:'Kick In',mic:'D6',phantom:false,gate:true,mix:'M2',pan:'C'},
    {ch:2,src:'Kick Out',mic:'B52',phantom:false,gate:false,mix:'M2',pan:'C'},
    {ch:3,src:'Snare Top',mic:'SM57',phantom:false,gate:true,mix:'M1·M2',pan:'C'},
    {ch:4,src:'Snare Bottom',mic:'e604',phantom:false,gate:true,mix:'M2',pan:'C',phase:true},
    {ch:5,src:'Hi-Hat',mic:'SM81',phantom:true,gate:false,mix:'M2',pan:'L25'},
    {ch:6,src:'Tom Rack',mic:'e604',phantom:false,gate:true,mix:'M2',pan:'L15'},
    {ch:7,src:'Tom Floor',mic:'e604',phantom:false,gate:true,mix:'M2',pan:'R20'},
    {ch:8,src:'OH-L',mic:'SM81',phantom:true,gate:false,mix:'M2',pan:'L40'},
    {ch:9,src:'OH-R',mic:'SM81',phantom:true,gate:false,mix:'M2',pan:'R40'},
    {ch:10,src:'Bass DI',mic:'Radial',phantom:true,gate:false,mix:'M1',pan:'C'},
    {ch:11,src:'Bass Mic',mic:'B52',phantom:false,gate:false,mix:'M1',pan:'C'},
    {ch:12,src:'Gtr 1',mic:'SM57',phantom:false,gate:false,mix:'M3',pan:'L20'},
    {ch:13,src:'Gtr 2',mic:'i5',phantom:false,gate:false,mix:'M3',pan:'R20'},
    {ch:14,src:'Pedal Steel DI',mic:'Radial',phantom:true,gate:false,mix:'M3',pan:'C'},
    {ch:15,src:'Vox Lead',mic:'Beta58',phantom:false,gate:true,mix:'M1·M2·M3',pan:'C'},
    {ch:16,src:'Vox Harm 1',mic:'SM58',phantom:false,gate:true,mix:'M1·M3',pan:'L10'},
    {ch:17,src:'Vox Harm 2',mic:'SM58',phantom:false,gate:true,mix:'M2',pan:'R10'},
    {ch:18,src:'Fiddle',mic:'KSM137',phantom:true,gate:false,mix:'M1',pan:'R15'},
  ],
  monitorMixes: [
    {mix:'M1',who:'Bass / Vox',sends:'Vox Lead +0, Bass +1, Kick -3',level:'-12dB',iems:false},
    {mix:'M2',who:'Drums',sends:'Click +2, Vox Lead -3, Bass -6',level:'-15dB',iems:true},
    {mix:'M3',who:'Gtr / Steel',sends:'Vox Lead -2, Gtr1 +0, Steel +1',level:'-10dB',iems:false},
    {mix:'M4',who:'Lead Vox · IEM',sends:'Vox Lead +3, Reverb +0, Drums -6',level:'-8dB',iems:true},
  ],
  splTrace: [
    {t:'8:30',v:78,note:'doors'},{t:'9:00',v:82},{t:'9:30',v:94,note:'set 1 in'},
    {t:'9:45',v:99},{t:'10:00',v:101},{t:'10:15',v:97},{t:'10:30',v:88,note:'break'},
    {t:'10:45',v:96,note:'set 2 in'},{t:'11:00',v:102},{t:'11:15',v:101},{t:'11:30',v:99},
    {t:'11:45',v:103,note:'PEAK · trim'},{t:'12:00',v:98},{t:'12:15',v:94,note:'encore'},{t:'12:30',v:0,note:'curfew'},
  ],
  splLimit: 102,

  // Run of show — minute-by-minute
  runOfShow: [
    {t:'4:00 PM',what:'Load-in opens · alley door',who:'Roan + 1 stage hand'},
    {t:'4:30',what:'Backline staging · house kit pulled',who:'Roan'},
    {t:'5:00',what:'Line check · all channels',who:'Roan'},
    {t:'5:30',what:'Soundcheck · drums → bass → gtrs → vox',who:'Band + Roan'},
    {t:'6:30',what:'Hot meal in greenroom',who:'Kitchen → Mira runs it back'},
    {t:'7:30',what:'House music up · doors prep',who:'Mira'},
    {t:'8:30',what:'Doors · ticket scan + ID at podium',who:'Box office · 2 staff'},
    {t:'9:15',what:'Lights to half · band call',who:'Roan'},
    {t:'9:30',what:'SET 1 · 50 min',who:'Band'},
    {t:'10:20',what:'Setbreak · merch table push',who:'Mira'},
    {t:'10:45',what:'SET 2 · 70 min',who:'Band'},
    {t:'11:55',what:'Encore window · 1-2 songs',who:'Band'},
    {t:'12:30',what:'Curfew · house up · last call',who:'Bar + sound'},
    {t:'12:45',what:'Settlement at office',who:'Booker + tour mgr'},
    {t:'1:30',what:'Load-out complete · alley clear',who:'Band'},
  ],

  // Settlement — last show
  settlement: {
    artist:'Coyote Standard', date:'Apr 18', cap:220, paid:178, comps:14, walkup:24,
    grossDoor: 178*15, presale:142*12, walkupRev:24*15,
    rows: [
      {label:'Presale (142 × $12)',amt:1704,type:'in'},
      {label:'Walkup (24 × $15)',amt:360,type:'in'},
      {label:'Door total',amt:2064,type:'sub'},
      {label:'Less: ticket fees (4%)',amt:-83,type:'fee'},
      {label:'Net door',amt:1981,type:'sub'},
      {label:'Guarantee',amt:800,type:'pay'},
      {label:'Over/under',amt:1181,type:'sub',note:'split 80/20 over guar'},
      {label:'Artist split (80%)',amt:945,type:'pay'},
      {label:'Hospitality / hot meal',amt:-148,type:'fee'},
      {label:'Sound buyout',amt:-200,type:'fee'},
      {label:'Total to artist',amt:1397,type:'tot'},
      {label:'House net door',amt:584,type:'tot'},
      {label:'Bar attributable (pour count)',amt:3142,type:'sub'},
    ],
  },

  // Talent A&R — pipeline of demos & scouts
  talent: [
    {act:'Rosalia Cinco',source:'Tiny Desk submission',hook:'Tejano · big voice',monthlySpotify:'8.4k',fit:0.82,note:'Strong Sat draw potential'},
    {act:'The Halberd Co.',source:'Booker referral',hook:'Folk-rock · 4pc',monthlySpotify:'12.1k',fit:0.71,note:'Available Jun-Aug'},
    {act:'Mavis Bone',source:'Sxsw scout',hook:'Country-soul solo',monthlySpotify:'22k',fit:0.88,note:'Travels light · low rider'},
    {act:'Joaquin & Pearl',source:'Open jam regular',hook:'Duo · originals',monthlySpotify:'1.2k',fit:0.54,note:'Build local · weekday support'},
    {act:'Antler Hours',source:'Direct demo',hook:'Indie · dreamy',monthlySpotify:'18.3k',fit:0.79,note:'Asked for double bill'},
    {act:'Rabbit Howl',source:'Pinedale referral',hook:'Lo-fi · 3pc',monthlySpotify:'6.8k',fit:0.68,note:'Pairs well with Antler'},
  ],

  // Marketing — promo per show
  promo: {
    posterDesigned: true, posterPosted: 14, postersOut: 18,
    socialDrops: [
      {when:'-21d',channel:'IG announce',reach:8400,clicks:212},
      {when:'-14d',channel:'IG reel · clip',reach:14200,clicks:418},
      {when:'-10d',channel:'Email · 2.4k list',reach:2400,clicks:184},
      {when:'-7d',channel:'FB event push',reach:6100,clicks:142},
      {when:'-3d',channel:'IG story · countdown',reach:3800,clicks:96},
      {when:'-1d',channel:'Day-of reel',reach:5200,clicks:128},
    ],
    radio: [{station:'KUTX',spots:8,rotation:'AM drive'},{station:'KOOP',spots:6,rotation:'midday'}],
    partners:[{partner:'Tito\'s',type:'pour sponsor',value:'$400 + signage'},{partner:'Allens Boots',type:'merch trade',value:'2 pair → giveaway'}],
    presaleSplit: { presale:142, walkup:42, comps:18 },
  },
};



// ─── ENTERTAINMENT — DEEPER DATA ───
Object.assign(window.LARIAT_DATA.entertainment, {
  // Tonight cockpit — live signal pulse
  livePulse: {
    nowMin: 622, // minutes from midnight ≈ 10:22 PM
    insideRoom: 168, atDoor: 4, smokeArea: 12, linedBar: 8,
    bandStatus: 'On stage · Set 2 · song 4 of 11',
    setlist: [
      {n:1,song:'Wagon Trail',min:4.2,played:true},
      {n:2,song:'Buffalo Coat',min:5.0,played:true},
      {n:3,song:'Same Old Saturday',min:3.8,played:true},
      {n:4,song:'Gravel & Pine',min:4.5,played:true,now:true},
      {n:5,song:'Ladybird Hollow',min:6.2,played:false},
      {n:6,song:'Long Way Out',min:4.8,played:false},
      {n:7,song:'Bramble',min:5.4,played:false},
      {n:8,song:'Burned Out West',min:3.9,played:false},
      {n:9,song:'Two-Lane Sermon',min:5.1,played:false},
      {n:10,song:'Cigarette Daughter',min:6.8,played:false},
      {n:11,song:'Encore: Goodnight, Texas',min:4.2,played:false,encore:true},
    ],
    bar: { tabsOpen:62, tabsAvg:48.20, topPour:'Tito\'s soda', specialPoured:24 },
    incidents: [
      {t:'9:42 PM', what:'Mic 7 (vox harm) · cable replaced · 2 min', sev:'low'},
      {t:'9:58 PM', what:'House left wedge buzz · ground fixed', sev:'low'},
      {t:'10:14 PM', what:'Guest medical · faint at bar · recovered', sev:'mid'},
    ],
  },

  // RF / Wireless coordination — real concert-hall problem
  rf: [
    {name:'Vox Lead',brand:'Shure ULXD',freq:'522.300',group:'G50',ch:'15',rssi:-52,battery:78},
    {name:'Vox Harm 1 (IEM)',brand:'Sennheiser EW',freq:'524.150',group:'G1',ch:'7',rssi:-58,battery:92},
    {name:'Drum IEM',brand:'Sennheiser EW',freq:'525.625',group:'G1',ch:'12',rssi:-49,battery:64},
    {name:'Lead Vox IEM',brand:'Shure PSM',freq:'527.800',group:'G50',ch:'22',rssi:-51,battery:88},
    {name:'Acoustic DI',brand:'Shure ULXD',freq:'529.450',group:'G50',ch:'31',rssi:-55,battery:71},
  ],
  rfNotes:'No conflicts with venue WiFi (2.4/5GHz). All units in TV ch 21-22 block. Scanned 4:50 PM.',

  // Avails — booking calendar matrix
  avails: [
    {wk:'May wk1',mon:'open',tue:'BEO Aspen',wed:'open',thu:'DJ Lasso',fri:'Coyote Standard',sat:'Marigold (hold)',sun:'open jam'},
    {wk:'May wk2',mon:'closed',tue:'open',wed:'open',thu:'open',fri:'Junior & The Aces',sat:'open',sun:'open jam'},
    {wk:'May wk3',mon:'closed',tue:'open',wed:'private',thu:'open',fri:'Sundown Strings (tent)',sat:'Antler+Rabbit (hold)',sun:'open jam'},
    {wk:'May wk4',mon:'closed',tue:'open',wed:'open',thu:'open',fri:'Pinedale (hold)',sat:'open',sun:'open jam'},
  ],

  // Equipment inventory — house gear
  inventory: [
    {item:'Yamaha Stage Custom 5pc kit',qty:1,location:'storage A',condition:'good',lastService:'Mar 22'},
    {item:'Ampeg SVT-CL bass head',qty:1,location:'storage A',condition:'good',lastService:'Feb 14'},
    {item:'Ampeg 8×10 cab',qty:1,location:'stage SR',condition:'good',lastService:'Feb 14'},
    {item:'Fender Twin Reverb',qty:1,location:'storage A',condition:'fair',lastService:'Jan 8',note:'crackle on ch1'},
    {item:'EV ELX200 wedge',qty:6,location:'stage / storage',condition:'good',lastService:'Apr 02'},
    {item:'JBL VRX932 main',qty:4,location:'flown',condition:'good',lastService:'Mar 30'},
    {item:'JBL SRX828 sub',qty:2,location:'stage front',condition:'good',lastService:'Mar 30'},
    {item:'Shure SM57',qty:8,location:'mic locker',condition:'7 good · 1 dent'},
    {item:'Shure SM58 / Beta58',qty:6,location:'mic locker',condition:'all good'},
    {item:'Shure SM81',qty:4,location:'mic locker',condition:'all good'},
    {item:'Sennheiser e604',qty:4,location:'mic locker',condition:'all good'},
    {item:'AKG D6',qty:1,location:'mic locker',condition:'good'},
    {item:'Radial JDI passive DI',qty:4,location:'stage box',condition:'good'},
    {item:'XLR cable 25\' / 50\'',qty:36,location:'stage box',condition:'4 to retire'},
  ],

  // Walkup curve — hour by hour during doors
  walkupHourly: [
    {h:'8:30',cum:8,ratePer15:8},{h:'8:45',cum:18,ratePer15:10},
    {h:'9:00',cum:32,ratePer15:14},{h:'9:15',cum:38,ratePer15:6},
    {h:'9:30',cum:42,ratePer15:4},{h:'9:45',cum:42,ratePer15:0},
    {h:'10:00',cum:42,ratePer15:0},
  ],

  // Promo budget per show
  promoBudget: { plan:1200, spent:842, breakdown: [
    {l:'Poster print + paste',v:180},
    {l:'IG paid boost · 2 reels',v:240},
    {l:'KUTX trade · 2 comps',v:0,note:'in-kind'},
    {l:'KOOP spots',v:160},
    {l:'Email send (Klaviyo)',v:32},
    {l:'Photographer · night-of',v:230},
  ]},

  // Promo wrap — 30-day post-show metrics on past show
  promoWrap: {
    show:'Coyote Standard · Apr 18', spent:780, sold:178, costPerSold:4.38,
    captures:{ instagrams:184, googleSearches:240, mailingListAdds:34, repeat:18 },
  },

  // Scouts: planned visits to other venues
  scouting: [
    {when:'Apr 28 · Mon',where:'Continental Club',who:'Iris',target:'Mavis Bone',note:'Late set · 11pm'},
    {when:'May 02 · Fri',where:'Cactus Cafe',who:'Calder',target:'Joaquin & Pearl',note:'Open mic spotlight'},
    {when:'May 09 · Fri',where:'Hole In The Wall',who:'Iris',target:'The Halberd Co.',note:'Touring stop'},
    {when:'May 16 · Sat',where:'Sam\'s Town Point',who:'Iris',target:'Antler Hours',note:'Headlining'},
  ],

  // Contact / outreach log
  outreach: [
    {when:'2 days ago',who:'Mavis Bone',ch:'Email',dir:'out',note:'Sent date hold for May 30 · awaiting'},
    {when:'5 days ago',who:'Joaquin & Pearl',ch:'IG DM',dir:'in',note:'Pitched as support slot'},
    {when:'1 wk ago',who:'The Halberd Co.',ch:'Phone',dir:'out',note:'Discussed Jun-Aug avails'},
    {when:'1 wk ago',who:'Antler Hours',ch:'Email',dir:'in',note:'Asked for double bill w/ Rabbit Howl'},
    {when:'2 wks ago',who:'Rosalia Cinco',ch:'Tiny Desk',dir:'in',note:'Submission · listened · queued'},
  ],

  // Contract status — required for confirmed shows
  contracts: [
    {show:'Apr 25 · Bramble Hollow',perf:'signed',w9:'on file',rider:'agreed',deposit:'paid',status:'complete'},
    {show:'Apr 30 · DJ Lasso',perf:'signed',w9:'on file',rider:'n/a',deposit:'n/a',status:'complete'},
    {show:'May 02 · Coyote Standard',perf:'signed',w9:'on file',rider:'agreed',deposit:'paid',status:'complete'},
    {show:'May 09 · Junior & The Aces',perf:'signed',w9:'pending',rider:'agreed',deposit:'paid',status:'pending'},
    {show:'May 16 · Sundown Strings',perf:'sent',w9:'requested',rider:'in-review',deposit:'n/a',status:'pending'},
  ],

  // Follow-up reminders
  followUps: [
    {artist:'Mavis Bone',action:'Reply to hold inquiry · May 30',due:'today',urgency:'today'},
    {artist:'The Halberd Co.',action:'Send Jun avails · 3 dates',due:'tomorrow',urgency:'soon'},
    {artist:'Antler Hours',action:'Confirm double-bill ask',due:'Apr 28',urgency:'soon'},
    {artist:'Rosalia Cinco',action:'Listen to 2nd EP · decide',due:'Apr 30',urgency:'later'},
    {artist:'Joaquin & Pearl',action:'Offer May 16 support slot',due:'May 02',urgency:'later'},
  ],
});
