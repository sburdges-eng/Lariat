/* Pages — BOH, FOH, Bar, Event */
const D2 = window.LARIAT_DATA;
const { useState: uS, useMemo: uM, useEffect: uE } = React;

// ─── 1. COCKPIT — Chef daily overview ───
function Cockpit() {
  return (<div className="page">
    <PageHead eyebrow="Tonight · Saturday Apr 25" title="We're" em="in it." sub="218 covers seated of 240 forecast. Two stations flagged. Hot rush at 6:45."
      actions={<><span className="pill warn">2 flagged</span><button className="btn primary">Pre-shift brief</button></>}/>
    <div className="grid grid-4" style={{marginBottom:18}}>
      <KPI label="Covers" value="218" sub="of 240 forecast · 91%" tone="up"/>
      <KPI label="Sales" value="$9,420" sub="vs $10,200 fcst" tone="warn"/>
      <KPI label="Avg ticket time" value="11:24" sub="goal 10:00" tone="warn"/>
      <KPI label="Open tickets" value="14" sub="3 over SLA"  tone="down"/>
    </div>
    <div className="grid grid-2" style={{marginBottom:18}}>
      <div className="card"><div className="card-eyebrow">Sales — last 7 days</div>
        <BarChart data={D2.weekSales} getV={d=>d.s} getL={d=>d.d} w={520} h={170}/>
      </div>
      <div className="card"><div className="card-eyebrow">Covers by hour</div>
        <LineChart data={D2.hourly} getV={d=>d.covers} getL={d=>d.hr} w={520} h={170}/>
      </div>
    </div>
    <div className="grid grid-3">
      <div className="card"><div className="card-eyebrow">86'd right now</div>
        {D2.eightySix.map(e=>(<div className="row" key={e.item}>
          <div><div className="row-name">{e.item}</div><div className="row-meta">{e.since} · {e.by}</div></div>
        </div>))}
      </div>
      <div className="card"><div className="card-eyebrow">Tonight's VIPs</div>
        {D2.reservations.filter(r=>r.vip).map(r=>(<div className="row" key={r.name}>
          <div><div className="row-name">{r.name}</div><div className="row-meta">{r.time} · {r.party} guests · T{r.table}</div></div>
        </div>))}
      </div>
      <div className="card"><div className="card-eyebrow">Upcoming BEOs</div>
        {D2.beos.map(b=>(<div className="row" key={b.id}>
          <div><div className="row-name">{b.name}</div><div className="row-meta">{b.date} · {b.count} guests · {b.style}</div></div>
        </div>))}
      </div>
    </div>
  </div>);
}

// ─── 1A. DISH PIT ───
function DishPit() {
  const [chem, setChem] = uS({sani:200, temp:182});
  const [racks] = uS([{id:'A',n:8,age:2},{id:'B',n:12,age:6},{id:'C',n:5,age:1}]);
  return (<div className="page">
    <PageHead eyebrow="Dishwasher" title="The" em="pit"
      sub="Wall-mounted at the line return. Two-tap chemical log, racks-per-hour live."/>
    <div className="grid grid-4" style={{marginBottom:18}}>
      <KPI label="Racks queued" value={racks.reduce((a,b)=>a+b.n,0)} sub="≈ 6 min clear"/>
      <KPI label="High-temp" value="182°F" sub="rinse · in spec" tone="up"/>
      <KPI label="Sanitizer" value={`${chem.sani} ppm`} sub="target 150-400" tone="up"/>
      <KPI label="Throughput" value="48/hr" sub="last hour"/>
    </div>
    <div className="grid grid-2">
      <div className="card"><div className="card-head"><div className="card-title">Bus tubs in queue</div><span className="pill ember">{racks.length} stacks</span></div>
        {racks.map(r=>(<div className="row" key={r.id}>
          <span className="dot" style={{background:r.age>5?'var(--rust)':r.age>3?'var(--brass)':'var(--sage)'}}></span>
          <div className="row-name">Stack {r.id}</div>
          <div className="row-meta">{r.n} pieces</div>
          <div className="row-spacer"/>
          <span className="row-meta">{r.age}m old</span>
        </div>))}
      </div>
      <div className="card"><div className="card-eyebrow">Chemical log — today</div>
        <table className="tbl"><thead><tr><th>Time</th><th>Sani ppm</th><th>Rinse °F</th><th>Initials</th></tr></thead>
          <tbody>
            <tr><td className="mono">10:00</td><td className="num">220</td><td className="num">181</td><td>MD</td></tr>
            <tr><td className="mono">12:00</td><td className="num">200</td><td className="num">182</td><td>MD</td></tr>
            <tr><td className="mono">2:00</td><td className="num">190</td><td className="num">180</td><td>MD</td></tr>
            <tr><td className="mono">4:30</td><td className="num">200</td><td className="num">182</td><td>MD</td></tr>
          </tbody></table>
        <button className="btn primary" style={{marginTop:14,width:'100%'}}>+ Log reading</button>
      </div>
    </div>
    <div className="sec-head"><div className="sec-title">Deep clean — this week</div><div className="sec-sub">3 of 7 done</div></div>
    <div className="grid grid-3">
      {['Hood filters','Floor drains','Walk-in shelves','Grease trap','Ice machine','Mop sink','Trash dock'].map((t,i)=>(
        <div className="card" key={t} style={{padding:14}}>
          <div className="flex"><span className="dot" style={{background:i<3?'var(--sage)':'var(--hair)'}}/>
          <div className="row-name">{t}</div></div>
          <div className="row-meta" style={{marginTop:6}}>{i<3?'Done · photo attached':'Due Friday'}</div>
        </div>
      ))}
    </div>
  </div>);
}

// ─── 1B. PREP COOK ───
function PrepCook() {
  const list = [
    {id:'aji_verde',need:'2 qt',have:'0.5 qt',pct:25,for:'Pork chop·tacos'},
    {id:'queso_mac_sauce',need:'18 qt',have:'12 qt',pct:67,for:'Trio·Mac & Cheese'},
    {id:'green_chile',need:'8 qt',have:'2 qt',pct:25,for:'Green Chile cup/bowl'},
    {id:'bacon_jam',need:'4 qt',have:'4 qt',pct:100,for:'Rope Burger'},
    {id:'cornbread',need:'4 pan',have:'1 pan',pct:25,for:'Side · S01'},
    {id:'pickles',need:'4 qt',have:'4 qt',pct:100,for:'Burgers'},
  ];
  return (<div className="page">
    <PageHead eyebrow="Prep · Esteban Rivas" title="Tomorrow's" em="prep list"
      sub="Auto-built from Sunday's reservations (240 fcst), 1 BEO, current pars."
      actions={<><button className="btn">Print labels</button><button className="btn primary">Sign off</button></>}/>
    <div className="grid grid-4" style={{marginBottom:18}}>
      <KPI label="Items today" value="14" sub="6 not started" tone="warn"/>
      <KPI label="On par" value="3" sub="of 14"/>
      <KPI label="ETA finish" value="3:40 PM"/>
      <KPI label="Waste week" value="4.2%" sub="-0.6% vs last" tone="up"/>
    </div>
    <div className="card flush">
      <table className="tbl">
        <thead><tr><th>Item</th><th>Yield</th><th>For</th><th style={{width:200}}>Progress</th><th>Status</th></tr></thead>
        <tbody>{list.map(it=>{
          const r = D2.recipes.find(x=>x.id===it.id);
          return (<tr key={it.id}>
            <td><b>{r?.name||it.id}</b><div className="row-meta">{r?.station}</div></td>
            <td className="num">{it.need}</td>
            <td>{it.for}</td>
            <td><div className="bar-track"><div className="bar-fill" style={{width:`${it.pct}%`,background:it.pct>=100?'var(--sage)':it.pct>50?'var(--brass)':'var(--ember)'}}/></div></td>
            <td>{it.pct>=100?<span className="pill ok">Done</span>:it.pct>50?<span className="pill warn">In progress</span>:<span className="pill alert">To do</span>}</td>
          </tr>);
        })}</tbody>
      </table>
    </div>
    <div className="sec-head"><div className="sec-title">Active recipe</div><div className="sec-sub">Read-only · v3 of 4</div></div>
    <div className="card">
      <div className="split"><div><div className="card-eyebrow">Aji Verde · saute</div><div className="serif" style={{fontSize:30}}>3.2 qt yield · 7 ingredients</div></div>
        <span className="pill">Allergen: dairy</span></div>
      <hr/>
      <ol style={{lineHeight:1.7,paddingLeft:18,fontSize:14,maxWidth:680}}>
        <li>Wash & rough-chop <b>2 bunches cilantro</b>, reserve half for stage two.</li>
        <li>Combine first half cilantro + 4 jalapeños (seeded) + 1 cup mayo + 4 cloves garlic + lime juice in robot coupe — blend to paste.</li>
        <li>Add second half cilantro + ¼ cup queso fresco — pulse to combine, do not over-blend (color).</li>
        <li>Adjust salt; should taste sharp and herbal. <b>Date label: 4-day shelf.</b></li>
      </ol>
    </div>
  </div>);
}

// ─── 1C. LINE COOK / KDS ───
function Line() {
  return (<div className="page" style={{maxWidth:1500}}>
    <PageHead eyebrow="Live tickets · Expo" title="The" em="rail"
      sub="6:42 PM · Saturday rush. Color = age. Bump on completion."
      actions={<><span className="pill alert">1 over 14 min</span><button className="btn">86 board</button></>}/>
    <div className="kds" style={{margin:'0 auto'}}>
      <div className="kds-grid">
        {D2.tickets.map((t,i)=>{
          const cls = t.age>=12 ? 'late' : t.age>=8 ? 'warn' : '';
          return (<div className={`kds-tix ${cls}`} key={t.id}>
            <div className="kds-head">
              <span>T{t.table} · {t.seats}P</span>
              <span className="age">{t.age}:{t.age<10?'0':''}{t.age*7%60}</span>
            </div>
            <div style={{flex:1}}>{t.items.map((it,j)=>(<div className="kds-line" key={j}>{it}</div>))}</div>
            <button style={{background:'var(--ember)',color:'#1a1308',border:0,padding:'6px',borderRadius:3,fontFamily:'inherit',fontSize:10,letterSpacing:'.18em',textTransform:'uppercase',fontWeight:700,marginTop:8}}>BUMP</button>
          </div>);
        })}
        <div className="kds-tix" style={{borderStyle:'dashed',justifyContent:'center',alignItems:'center',color:'#a89e8a'}}>
          <div style={{fontSize:11,letterSpacing:'.18em',textTransform:'uppercase'}}>Recall last bumped</div>
          <div className="serif" style={{fontSize:18,marginTop:6}}>T9 · Pork Chop</div>
        </div>
      </div>
    </div>
    <div className="sec-head"><div className="sec-title">Station mise · sauté</div><div className="sec-sub">Pre-service · 4 of 6 ready</div></div>
    <div className="grid grid-3">
      {[
        {n:'Aji verde',q:'2 qt',ok:true},{n:'Mac sauce',q:'12 qt',ok:true},{n:'Achiote marinade',q:'1 gal',ok:true},
        {n:'Green chile',q:'2 qt',ok:false},{n:'Tomato soup',q:'4 qt',ok:true},{n:'Herb butter',q:'4 lb',ok:false},
      ].map(m=>(<div className="card" key={m.n} style={{padding:14}}>
        <div className="flex"><span className="dot" style={{background:m.ok?'var(--sage)':'var(--rust)'}}/>
        <div className="row-name">{m.n}</div><div className="row-spacer"/><div className="row-meta">{m.q}</div></div>
      </div>))}
    </div>
  </div>);
}

// ─── 86 BOARD ───
function EightySix() {
  return (<div className="page">
    <PageHead eyebrow="86 board" title="What's" em="out"
      sub="Tap an item to 86 — pushes instantly to POS, host stand, server devices."
      actions={<button className="btn primary">+ 86 an item</button>}/>
    <div className="grid grid-2">
      <div className="card"><div className="card-eyebrow">Out right now</div>
        {D2.eightySix.map(e=>(<div className="row" key={e.item}>
          <span className="dot" style={{background:'var(--rust)'}}/>
          <div><div className="row-name">{e.item}</div><div className="row-meta">{e.since} · {e.by}</div></div>
          <div className="row-spacer"/>
          <button className="btn sm">Restore</button>
        </div>))}
      </div>
      <div className="card"><div className="card-eyebrow">Cascade — might also be out</div>
        <div className="row"><span className="dot" style={{background:'var(--brass)'}}/>
          <div><div className="row-name">Trout pairing add-on</div><div className="row-meta">uses Whole Trout</div></div></div>
        <div className="row"><span className="dot" style={{background:'var(--brass)'}}/>
          <div><div className="row-name">Banana Pudding (BEO add-on)</div><div className="row-meta">uses banana_cream_pudding</div></div></div>
      </div>
    </div>
    <div className="sec-head"><div className="sec-title">Most-86'd this month</div><div className="sec-sub">heat by day of week</div></div>
    <div className="card">
      <Heatmap rows={['Whole Trout','Pork Chop','Banana Pudding','Mac Balls','Pig Wings']}
        cols={['Mon','Tue','Wed','Thu','Fri','Sat','Sun']}
        data={[[0,0,1,2,3,5,2],[0,0,0,1,1,2,1],[2,1,1,2,3,3,2],[0,0,0,0,0,1,0],[0,0,1,1,2,2,1]]} />
    </div>
  </div>);
}

// ─── SOUS CHEF ───
function SousChef() {
  return (<div className="page">
    <PageHead eyebrow="Sous · Diego Reyes" title="Walk" em="the line"
      sub="Pre-service line check. Score each station 1-5. Photos stick."
      actions={<><button className="btn">Schedule</button><button className="btn primary">Start line check</button></>}/>
    <div className="grid grid-4" style={{marginBottom:18}}>
      <KPI label="Stations checked" value="3" sub="of 6"/>
      <KPI label="Avg score" value="4.6" sub="this week" tone="up"/>
      <KPI label="Open vendors POs" value="4" sub="$8,420"/>
      <KPI label="Schedule gaps" value="0" tone="up"/>
    </div>
    <div className="grid grid-2">
      <div className="card flush">
        <div style={{padding:'14px 18px'}}><div className="card-eyebrow">Stations</div></div>
        <table className="tbl"><thead><tr><th>Station</th><th>Mise</th><th>Temp</th><th>Score</th></tr></thead>
          <tbody>
            {[{n:'Sauté',m:'4/6',t:'ok',s:5},{n:'Grill',m:'8/8',t:'ok',s:4},{n:'Fry',m:'7/7',t:'ok',s:5},
              {n:'Salad',m:'5/6',t:'flag',s:3},{n:'Expo',m:'3/4',t:'ok',s:4},{n:'Garde',m:'-',t:'-',s:'-'}].map(s=>(
                <tr key={s.n}><td><b>{s.n}</b></td><td className="num">{s.m}</td>
                <td>{s.t==='ok'?<span className="pill ok">In spec</span>:s.t==='flag'?<span className="pill warn">Walk-in 41°</span>:'—'}</td>
                <td className="num">{s.s}</td></tr>
            ))}
          </tbody></table>
      </div>
      <div className="card"><div className="card-eyebrow">Order portal · today</div>
        <table className="tbl"><thead><tr><th>Vendor</th><th>Items</th><th>Total</th><th></th></tr></thead><tbody>
          <tr><td>Sysco</td><td className="num">28</td><td className="num">$3,420</td><td><span className="pill ember">Send</span></td></tr>
          <tr><td>Cervantes Meats</td><td className="num">7</td><td className="num">$1,120</td><td><span className="pill ok">Sent</span></td></tr>
          <tr><td>Lariat Farms</td><td className="num">12</td><td className="num">$680</td><td><span className="pill ember">Send</span></td></tr>
        </tbody></table>
      </div>
    </div>
    <div className="sec-head"><div className="sec-title">Training matrix · this week</div><div className="sec-sub">cook × station</div></div>
    <div className="card">
      <Heatmap rows={['Tariq','June','Cody','Hana','Esteban']} cols={['Sauté','Grill','Fry','Salad','Expo','Garde']}
        data={[[3,5,4,3,4,2],[5,3,2,3,4,5],[4,3,5,3,3,2],[2,2,2,5,3,5],[5,4,4,4,5,3]]} max={5}/>
    </div>
  </div>);
}

// ─── MENU ENGINEERING ───
function MenuEng() {
  const [hover,setHover] = uS(null);
  const items = D2.menu.map(m=>({...m, margin:m.price-m.cost, marginPct:((m.price-m.cost)/m.price)*100, popularity:m.sold}));
  const popMid = 120;
  const margMid = 75; // % margin midline
  const w=820,h=500;
  const margMin = 55, margMax = 90;
  return (<div className="page">
    <PageHead eyebrow="Menu engineering" title="Stars," em="dogs, plowhorses"
      sub="Every item plotted by popularity vs contribution margin. Click to drill in."/>
    <div className="card" style={{position:'relative',padding:24}}>
      <svg className="chart" viewBox={`0 0 ${w} ${h}`}>
        <line x1="40" y1={h/2} x2={w-20} y2={h/2} stroke="var(--hair)" strokeDasharray="2 4"/>
        <line x1={w/2} y1="20" x2={w/2} y2={h-30} stroke="var(--hair)" strokeDasharray="2 4"/>
        <text x={w-30} y={h/2-8} fontSize="11" textAnchor="end" fill="var(--muted)" letterSpacing="2">POPULARITY →</text>
        <text x={w/2+8} y="32" fontSize="11" fill="var(--muted)" letterSpacing="2">↑ MARGIN</text>
        <text x="50" y="40" fontSize="12" fontFamily="Instrument Serif" fontStyle="italic" fill="var(--ember-deep)">Puzzles</text>
        <text x={w-90} y="40" fontSize="12" fontFamily="Instrument Serif" fontStyle="italic" fill="var(--sage)">★ Stars</text>
        <text x="50" y={h-40} fontSize="12" fontFamily="Instrument Serif" fontStyle="italic" fill="var(--rust)">Dogs</text>
        <text x={w-130} y={h-40} fontSize="12" fontFamily="Instrument Serif" fontStyle="italic" fill="var(--brass)">Plowhorses</text>
        {items.map(it=>{
          const x = 40 + (it.popularity/250)*(w-60);
          const y = h-40 - ((it.marginPct-margMin)/(margMax-margMin))*(h-70);
          const r = Math.sqrt(it.sold)/2.5+4;
          const star = it.popularity>popMid && it.marginPct>margMid;
          const dog = it.popularity<popMid && it.marginPct<margMid;
          return (<g key={it.id} onMouseEnter={()=>setHover(it)} onMouseLeave={()=>setHover(null)} style={{cursor:'pointer'}}>
            <circle cx={x} cy={y} r={r} fill={star?'var(--sage)':dog?'var(--rust)':it.popularity>popMid?'var(--brass)':'var(--ember)'} opacity=".75"/>
            <circle cx={x} cy={y} r={r} fill="none" stroke="var(--ink)" strokeWidth=".5" opacity=".3"/>
            <text x={x} y={y-r-4} fontSize="9" textAnchor="middle" fill="var(--ink)" opacity=".55">{it.name.split(' ').slice(-1)[0]}</text>
          </g>);
        })}
      </svg>
      {hover && <div style={{position:'absolute',top:30,right:30,background:'var(--cream)',border:'1px solid var(--hair)',borderRadius:4,padding:'12px 14px',minWidth:220}}>
        <div className="card-eyebrow">{hover.cat}</div>
        <div className="serif" style={{fontSize:18}}>{hover.name}</div>
        <div className="row-meta" style={{marginTop:6}}>${hover.price} · ${hover.cost} cost · {hover.sold} sold/wk</div>
        <div className="row-meta" style={{marginTop:2,color:'var(--ember-deep)'}}>Margin: ${hover.margin.toFixed(2)} ({hover.marginPct.toFixed(0)}%)</div>
      </div>}
    </div>
    <div className="grid grid-2" style={{marginTop:18}}>
      <div className="card"><div className="card-eyebrow">Top 5 stars · push these</div>
        <BarList items={items.filter(i=>i.popularity>popMid&&i.marginPct>margMid).slice(0,5)
          .map(i=>({l:i.name,v:i.sold,r:`$${i.margin.toFixed(2)}`,color:'var(--sage)'}))}/>
      </div>
      <div className="card"><div className="card-eyebrow">Dogs · consider replacing</div>
        <BarList items={items.filter(i=>i.popularity<popMid&&i.marginPct<margMid).slice(0,5)
          .map(i=>({l:i.name,v:i.sold,r:`$${i.margin.toFixed(2)}`,color:'var(--rust)'}))}/>
      </div>
    </div>
  </div>);
}

// ─── SPECIALS SANDBOX (R&D) ───
function Specials() {
  const [overstock,setO] = uS(['Trout (12 lb)','Pickled jalapeños','Sourdough crumbs']);
  const [margin,setM] = uS(68);
  return (<div className="page">
    <PageHead eyebrow="Chef R&D" title="Specials" em="sandbox"
      sub="Throw overstock at it. Slide the margin. Get costed concepts back."/>
    <div className="grid grid-2">
      <div className="card">
        <div className="card-eyebrow">Overstock to use up</div>
        <div className="chips" style={{margin:'10px 0'}}>{overstock.map(o=><span className="chip on" key={o}>{o} ×</span>)}
          <span className="chip">+ add</span>
        </div>
        <div className="card-eyebrow" style={{marginTop:18}}>Target margin · {margin}%</div>
        <input type="range" min="40" max="85" value={margin} onChange={e=>setM(+e.target.value)} style={{width:'100%',accentColor:'var(--ember)'}}/>
        <div className="card-eyebrow" style={{marginTop:18}}>Constraints</div>
        <div className="chips"><span className="chip on">GF available</span><span className="chip">≤ 2 stations</span><span className="chip on">Plates &lt; 6 min</span></div>
      </div>
      <div className="card flush">
        <div style={{padding:'14px 18px'}}><div className="card-eyebrow">Suggestions · ranked by margin × use-up</div></div>
        {[
          {n:'Pan-roasted trout, jalapeño-crumb gremolata',pr:'$24',m:71,use:'85%',plot:'top'},
          {n:'Fish & chips · housemade pickle tartar (special)',pr:'$19',m:68,use:'62%'},
          {n:'Smoked trout dip · sourdough toast point',pr:'$13',m:74,use:'78%'},
          {n:'Trout amandine · hand-cut frites',pr:'$26',m:67,use:'70%'},
        ].map((s,i)=>(<div className="row" key={i} style={{padding:'12px 18px'}}>
          <div style={{flex:1}}>
            <div className="row-name">{s.n}</div>
            <div className="row-meta">{s.pr} · {s.m}% margin · {s.use} of overstock used {s.plot==='top'&&<span style={{color:'var(--ember-deep)'}}> · top pick</span>}</div>
          </div>
          <button className="btn sm">Spec it</button>
        </div>))}
      </div>
    </div>
  </div>);
}

// ─── FOOD COST CONTROL CENTER ───
function FoodCost() {
  return (<div className="page">
    <PageHead eyebrow="Cost control" title="Theoretical" em="vs actual"
      sub="Period: Apr 1-25. Drill into any category to find the leak."/>
    <div className="grid grid-4" style={{marginBottom:18}}>
      <KPI label="Food cost %" value="28.4%" sub="goal 27.5%" tone="warn"/>
      <KPI label="Theoretical" value="26.9%" sub="ideal" tone="up"/>
      <KPI label="Variance" value="$3,680" sub="overshoot · period" tone="down"/>
      <KPI label="Bar cost %" value="22.1%" sub="goal 22%" tone="up"/>
    </div>
    <div className="grid grid-2">
      <div className="card"><div className="card-eyebrow">Variance by category</div>
        <BarList items={[
          {l:'Protein',v:1840,r:'+$1,840',color:'var(--rust)'},
          {l:'Produce',v:920,r:'+$920',color:'var(--rust)'},
          {l:'Dairy',v:380,r:'+$380',color:'var(--brass)'},
          {l:'Dry goods',v:260,r:'+$260',color:'var(--brass)'},
          {l:'Frozen',v:80,r:'-$80',color:'var(--sage)'},
          {l:'Bev (NA)',v:160,r:'-$160',color:'var(--sage)'},
        ]} max={2000}/>
      </div>
      <div className="card"><div className="card-eyebrow">Top variance items · Pareto</div>
        <table className="tbl">
          <thead><tr><th>Item</th><th>Theo</th><th>Actual</th><th>Δ</th></tr></thead>
          <tbody>
            <tr><td>Catfish (lb)</td><td className="num">86</td><td className="num">114</td><td className="num" style={{color:'var(--rust)'}}>+28</td></tr>
            <tr><td>Hatch chiles</td><td className="num">42</td><td className="num">58</td><td className="num" style={{color:'var(--rust)'}}>+16</td></tr>
            <tr><td>Brisket blend (lb)</td><td className="num">96</td><td className="num">108</td><td className="num" style={{color:'var(--rust)'}}>+12</td></tr>
            <tr><td>Cilantro (case)</td><td className="num">14</td><td className="num">22</td><td className="num" style={{color:'var(--rust)'}}>+8</td></tr>
            <tr><td>Avocado</td><td className="num">120</td><td className="num">112</td><td className="num" style={{color:'var(--sage)'}}>-8</td></tr>
          </tbody></table>
      </div>
    </div>
    <div className="sec-head"><div className="sec-title">Waste log · last 7 days</div></div>
    <div className="card">
      <BarChart data={[{d:'Mon',w:84},{d:'Tue',w:62},{d:'Wed',w:108},{d:'Thu',w:72},{d:'Fri',w:140},{d:'Sat',w:96},{d:'Sun',w:78}]} getV={d=>d.w} getL={d=>d.d} w={840} h={170}/>
    </div>
  </div>);
}

// ─── BEO MANAGER ───
function BEO() {
  return (<div className="page">
    <PageHead eyebrow="Banquet event orders" title="Private" em="dining"
      sub="3 events on the books · $14,820 booked next 14 days."
      actions={<button className="btn primary">+ New BEO</button>}/>
    <div className="grid" style={{gap:14}}>
      {D2.beos.map(b=>(<div className="card" key={b.id}>
        <div className="split">
          <div>
            <div className="card-eyebrow">{b.id} · {b.date}</div>
            <div className="serif" style={{fontSize:26}}>{b.name}</div>
            <div className="row-meta" style={{marginTop:4}}>{b.count} guests · {b.style} · contact {b.contact}</div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <span className="pill ok">Confirmed</span>
            <button className="btn sm">Open</button>
          </div>
        </div>
        <hr/>
        <div className="grid grid-3">
          <div><div className="card-eyebrow">Menu</div>
            <div style={{marginTop:6,fontSize:13}}>{b.menu.join(' · ')}</div></div>
          <div><div className="card-eyebrow">Allergies</div>
            <div style={{marginTop:6,fontSize:13}}>2× shellfish · 1× GF</div></div>
          <div><div className="card-eyebrow">Run sheet</div>
            <div style={{marginTop:6,fontSize:13}}>5:30 setup · 6:30 cocktails · 7:15 dinner · 9:30 cake</div></div>
        </div>
      </div>))}
    </div>
  </div>);
}

// ─── ALLERGEN MATRIX ───
function Allergen() {
  const allergens = ['Gluten','Dairy','Egg','Soy','Shellfish','Fish','Tree nut','Peanut'];
  const items = D2.menu.slice(0,12);
  // pseudo
  const has = (id,a) => {
    const m = id.charCodeAt(4)+a.charCodeAt(0);
    return m % 5 === 0 || m % 7 === 0;
  };
  return (<div className="page">
    <PageHead eyebrow="Allergen matrix" title="The" em="grid"
      sub="Auto-derived from recipe ingredients. Print for FOH binders."
      actions={<><button className="btn">Print PDF</button><button className="btn">Export CSV</button></>}/>
    <div className="card flush">
      <table className="tbl">
        <thead><tr><th>Item</th>{allergens.map(a=>(<th key={a} style={{textAlign:'center'}}>{a}</th>))}</tr></thead>
        <tbody>{items.map(it=>(<tr key={it.id}>
          <td><b>{it.name}</b><div className="row-meta">{it.station}</div></td>
          {allergens.map(a=>(<td key={a} style={{textAlign:'center'}}>
            {has(it.id,a) ? <span className="dot" style={{background:'var(--rust)'}}/> : <span className="muted">·</span>}
          </td>))}
        </tr>))}</tbody>
      </table>
    </div>
  </div>);
}

// ─── 2A. HOST STAND (iPad) ───
function HostStand() {
  return (<div className="page" style={{maxWidth:1500}}>
    <PageHead eyebrow="Host · Polly Vance" title="Floor &" em="reservations"
      sub="Saturday · 6:30 PM. Drag parties to seat. Wait time 18 min for walk-ins."
      actions={<><button className="btn">Waitlist (4)</button><button className="btn primary">+ Walk-in</button></>}/>
    <div className="grid" style={{gridTemplateColumns:'1fr 360px',gap:18}}>
      <div className="card flush" style={{padding:14}}>
        <div className="floor">
          {[
            {n:4,x:30,y:30,s:'seated',ts:'24m'},{n:7,x:120,y:30,s:'fired',ts:'Apt'},{n:9,x:210,y:30,s:'open'},
            {n:11,x:300,y:30,s:'seated',ts:'8m'},{n:12,x:390,y:30,s:'fired',ts:'14m'},{n:13,x:480,y:30,s:'dessert',ts:'52m'},
            {n:14,x:30,y:120,s:'open'},{n:16,x:120,y:120,s:'bus',ts:'Bus'},{n:18,x:210,y:120,s:'open'},
            {n:21,x:300,y:120,s:'fired',ts:'4m'},{n:22,x:390,y:120,s:'open'},{n:25,x:480,y:120,s:'open'},
            {n:5,x:30,y:230,s:'seated',ts:'18m'},{n:8,x:120,y:230,s:'open'},{n:10,x:210,y:230,s:'seated',ts:'62m'},
            {n:30,x:300,y:230,s:'open',ts:'8P · 10top'},
          ].map(t=>(<div key={t.n} className={`tableb ${t.s}`} style={{left:t.x,top:t.y,width:t.n===30?170:80,height:t.n===30?80:64}}>
            <div className="serif" style={{fontSize:t.n===30?22:18}}>{t.n}</div>
            <div className="ts">{t.ts||t.s}</div>
          </div>))}
          <div style={{position:'absolute',right:20,top:18,fontSize:10,letterSpacing:'.2em',color:'var(--muted)',textTransform:'uppercase'}}>The Lariat · Main Dining · 16 tables</div>
          <div style={{position:'absolute',left:30,bottom:18,display:'flex',gap:14,fontSize:10,letterSpacing:'.18em',textTransform:'uppercase',color:'var(--muted)'}}>
            <span><span className="dot" style={{background:'var(--sage)',marginRight:4}}/>seated</span>
            <span><span className="dot" style={{background:'var(--ember)',marginRight:4}}/>entrees fired</span>
            <span><span className="dot" style={{background:'var(--brass)',marginRight:4}}/>dessert</span>
            <span><span className="dot" style={{background:'var(--rust)',marginRight:4}}/>bus</span>
          </div>
        </div>
      </div>
      <div className="card flush" style={{maxHeight:600,overflowY:'auto'}}>
        <div style={{padding:'14px 18px',position:'sticky',top:0,background:'var(--cream)',borderBottom:'1px solid var(--hair)',zIndex:2}}>
          <div className="card-eyebrow">Reservations</div>
          <div className="serif" style={{fontSize:24}}>Tonight</div>
        </div>
        {D2.reservations.map(r=>(<div className="row" key={r.name} style={{padding:'12px 18px'}}>
          <div className="mono" style={{width:46,fontSize:12}}>{r.time}</div>
          <div style={{flex:1}}>
            <div className="row-name">{r.name} {r.vip&&<span className="pill ember sm" style={{marginLeft:6,padding:'2px 6px'}}>VIP</span>}</div>
            <div className="row-meta">{r.party}P · T{r.table}{r.note?` · ${r.note}`:''}</div>
          </div>
          <span className={`pill ${r.status==='seated'?'ok':r.status==='arrived'?'warn':''}`}>{r.status}</span>
        </div>))}
      </div>
    </div>
  </div>);
}

// ─── 2B. SERVER (phone) ───
function Server() {
  return (<div className="page">
    <PageHead eyebrow="Server · Tomás Huerta" title="My" em="tables"
      sub="Tonight's PWA view. Pulls live from POS. Tap a table to drop the check."/>
    <div className="device-row">
      <Phone label="My tables">
        <div style={{padding:'48px 16px 16px',height:'100%',overflowY:'auto',display:'flex',flexDirection:'column',gap:10}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'4px 6px'}}>
            <div className="serif" style={{fontSize:24}}>4 tables</div>
            <div className="row-meta">section 2</div>
          </div>
          {[
            {t:7,p:4,c:'Mains fired',age:'24m',note:'Anniv ★'},
            {t:9,p:2,c:'Apps cleared',age:'12m'},
            {t:11,p:3,c:'Just seated',age:'2m'},
            {t:18,p:5,c:'Check dropped',age:'68m',note:'Vegetarian x2'},
          ].map(t=>(<div className="card" key={t.t} style={{padding:14}}>
            <div className="split">
              <div className="serif" style={{fontSize:22}}>T{t.t} · {t.p}P</div>
              <span className="row-meta">{t.age}</span>
            </div>
            <div style={{fontSize:12,marginTop:4,color:'var(--char)'}}>{t.c}</div>
            {t.note&&<div className="row-meta" style={{marginTop:4}}>{t.note}</div>}
          </div>))}
          <div className="card" style={{padding:14,background:'var(--ember)',color:'#1a1308',border:0}}>
            <div className="card-eyebrow" style={{color:'#5a2a10'}}>Tip pool tonight</div>
            <div className="serif" style={{fontSize:30,marginTop:2}}>$184.20</div>
            <div style={{fontSize:11}}>Week to date · $1,124</div>
          </div>
        </div>
      </Phone>
      <Phone label="Menu lookup">
        <div style={{padding:'48px 14px 14px',height:'100%',overflowY:'auto'}}>
          <input className="search" placeholder="Search dishes…" style={{width:'100%',marginBottom:10}}/>
          <div className="card-eyebrow" style={{padding:'4px 6px'}}>Tonight's specials</div>
          <div className="card" style={{padding:12,marginBottom:10}}>
            <div className="serif" style={{fontSize:18}}>Pan-roasted trout</div>
            <div className="row-meta">Jalapeño-crumb gremolata · $24</div>
            <div style={{fontSize:11,marginTop:6,fontStyle:'italic',color:'var(--ember-deep)'}}>Push pair: Cab Franc · "from this morning's catch"</div>
          </div>
          <div className="card-eyebrow" style={{padding:'4px 6px'}}>86 right now</div>
          <div className="chips" style={{padding:'4px 6px'}}><span className="chip" style={{background:'var(--rust)',color:'#fff',border:0}}>Whole Trout</span>
          <span className="chip" style={{background:'var(--rust)',color:'#fff',border:0}}>Banana Pudding</span></div>
          <div className="card-eyebrow" style={{padding:'14px 6px 4px'}}>Mains</div>
          {D2.menu.filter(m=>m.cat==='main').slice(0,5).map(m=>(<div className="row" key={m.id} style={{padding:'8px 6px',fontSize:12}}>
            <div style={{flex:1}}><div className="row-name">{m.name}</div><div className="row-meta">${m.price}</div></div>
          </div>))}
        </div>
      </Phone>
      <Phone label="Guest profile">
        <div style={{padding:'48px 14px 14px',height:'100%',overflowY:'auto'}}>
          <div className="card-eyebrow">T7 · Okafor party</div>
          <div className="serif" style={{fontSize:24,marginTop:2}}>Tunde Okafor</div>
          <div className="row-meta">5th visit · Anniv tonight ★</div>
          <hr/>
          <div className="card-eyebrow">Past favorites</div>
          <div className="chips" style={{marginTop:6}}><span className="chip">Pork Chop ×3</span><span className="chip">Cab Franc</span></div>
          <div className="card-eyebrow" style={{marginTop:14}}>Avg spend</div>
          <div className="serif" style={{fontSize:30}}>$148</div>
          <div className="card-eyebrow" style={{marginTop:14}}>Allergies</div>
          <div style={{fontSize:13,marginTop:4}}>None on file</div>
          <div className="card-eyebrow" style={{marginTop:14}}>Notes</div>
          <div style={{fontSize:12,marginTop:4,fontStyle:'italic',color:'var(--char)'}}>"Loves the booth by the window — last visit Marisol comped the chocolate cake."</div>
        </div>
      </Phone>
    </div>
  </div>);
}

// ─── RUNNER / BUSSER ───
function Runner() {
  return (<div className="page">
    <PageHead eyebrow="Runner · Astrid Lowe" title="Expo" em="queue"/>
    <div className="device-row">
      <Tablet label="Run list">
        <div style={{padding:'14px 18px',height:'100%',overflow:'auto'}}>
          <div className="card-eyebrow">Up at the window</div>
          {[
            {t:7,seat:1,d:'Whole Trout',pos:'pass · 12 o'},
            {t:7,seat:3,d:'Burger med',pos:'pass'},
            {t:21,seat:2,d:'Pork chop',pos:'fly'},
            {t:14,seat:4,d:'Fish tacos',pos:'pass'},
          ].map((r,i)=>(<div className="row" key={i}>
            <span className="serif" style={{fontSize:22,width:50}}>T{r.t}</span>
            <div style={{flex:1}}><div className="row-name">{r.d}</div><div className="row-meta">seat {r.seat} · {r.pos}</div></div>
            <button className="btn sm primary">Run</button>
          </div>))}
        </div>
      </Tablet>
      <Tablet label="Bus priority">
        <div style={{padding:'14px 18px',height:'100%',overflow:'auto'}}>
          <div className="card-eyebrow">Tables to clear</div>
          {[
            {t:13,r:'High · party waiting'},{t:16,r:'Bus · was 4-top'},
            {t:25,r:'Pre-bus dessert'},{t:5,r:'Refill water'},
          ].map((b,i)=>(<div className="row" key={i}>
            <span className="serif" style={{fontSize:22,width:50}}>T{b.t}</span>
            <div className="row-name" style={{flex:1}}>{b.r}</div>
            <button className="btn sm">Done</button>
          </div>))}
        </div>
      </Tablet>
    </div>
  </div>);
}

// ─── 2D. MOD / FLOOR MANAGER ───
function MOD() {
  return (<div className="page">
    <PageHead eyebrow="Floor manager · Sasha Linwood" title="The" em="pulse"
      sub="Real-time service health. Approve comps. Cut labor."/>
    <div className="grid grid-4" style={{marginBottom:18}}>
      <KPI label="Open tickets" value="14" sub="3 over SLA" tone="warn"/>
      <KPI label="Avg ticket" value="11:24" sub="goal 10:00" tone="warn"/>
      <KPI label="Wait list" value="12" sub="quoted 18m"/>
      <KPI label="Labor / sales" value="32%" sub="goal 30%" tone="warn"/>
    </div>
    <div className="grid grid-2">
      <div className="card"><div className="card-eyebrow">Comp/void requests · pending</div>
        {[
          {srv:'Lila B.',t:11,amt:'$26',rsn:'Refire — pork chop overcooked'},
          {srv:'Marquise F.',t:16,amt:'$13',rsn:'Allergic reaction concern'},
        ].map((c,i)=>(<div className="row" key={i}>
          <div style={{flex:1}}><div className="row-name">T{c.t} · {c.amt}</div><div className="row-meta">{c.srv} · {c.rsn}</div></div>
          <button className="btn sm">Deny</button>
          <button className="btn sm primary">Approve</button>
        </div>))}
      </div>
      <div className="card"><div className="card-eyebrow">Cut list — labor adjuster</div>
        <div className="row-meta" style={{marginBottom:10}}>$140/hr over · suggest 2 cuts</div>
        {[
          {n:'Hana I.',role:'Salad',hrs:'7.5h',rsn:'lowest covers · OT in 30m',ok:true},
          {n:'Marquise F.',role:'Server',hrs:'6h',rsn:'newest · spare in section',ok:false},
          {n:'Astrid L.',role:'Runner',hrs:'5h',rsn:'pace ok'},
        ].map((c,i)=>(<div className="row" key={i}>
          <span className="dot" style={{background:c.ok?'var(--ember)':'var(--hair)'}}/>
          <div style={{flex:1}}><div className="row-name">{c.n}</div><div className="row-meta">{c.role} · {c.hrs} · {c.rsn}</div></div>
          {c.ok && <button className="btn sm primary">Cut</button>}
        </div>))}
      </div>
    </div>
    <div className="grid grid-2" style={{marginTop:18}}>
      <div className="card"><div className="card-eyebrow">Service SLA · last hour</div>
        <LineChart data={[{t:'5:00',v:9.2},{t:'5:30',v:10.1},{t:'6:00',v:11.4},{t:'6:30',v:12.2}]} getV={d=>d.v} getL={d=>d.t} w={520} h={160}/>
      </div>
      <div className="card"><div className="card-eyebrow">Touch-table tracker</div>
        <table className="tbl"><tbody>
          {[
            {t:7,note:'Anniv announced — bringing dessert comp',mood:'good'},
            {t:21,note:'Shellfish allergy reconfirmed',mood:'good'},
            {t:11,note:'Refired pork — apologized · comped',mood:'recovery'},
          ].map((r,i)=>(<tr key={i}>
            <td className="num">T{r.t}</td>
            <td>{r.note}</td>
            <td><span className={`pill ${r.mood==='good'?'ok':'warn'}`}>{r.mood}</span></td>
          </tr>))}
        </tbody></table>
      </div>
    </div>
  </div>);
}

// ─── NIGHTLY CLOSEOUT ───
function Closeout() {
  return (<div className="page">
    <PageHead eyebrow="Nightly closeout · Sat Apr 25" title="The" em="wrap"
      sub="Auto-compiled at midnight. Manager signs off — emails to GM/Owner."
      actions={<><button className="btn">Email PDF</button><button className="btn primary">Sign off</button></>}/>
    <div className="grid grid-4" style={{marginBottom:18}}>
      <KPI label="Total sales" value="$11,240" sub="vs $10,200 fcst" tone="up"/>
      <KPI label="Covers" value="248" sub="PPA $45.32"/>
      <KPI label="Labor %" value="31.8%" sub="goal 30%" tone="warn"/>
      <KPI label="Cash variance" value="$0" tone="up"/>
    </div>
    <div className="grid grid-3">
      <div className="card"><div className="card-eyebrow">Sales mix</div>
        <BarList items={[
          {l:'Food',v:8420,r:'$8,420'},{l:'Bar',v:2210,r:'$2,210'},{l:'NA Bev',v:610,r:'$610'}
        ]}/>
      </div>
      <div className="card"><div className="card-eyebrow">Comps & voids</div>
        <table className="tbl"><tbody>
          <tr><td>Comps</td><td className="num">$84</td></tr>
          <tr><td>Voids</td><td className="num">$26</td></tr>
          <tr><td>Discounts</td><td className="num">$0</td></tr>
          <tr><td>Promo</td><td className="num">$30</td></tr>
        </tbody></table>
      </div>
      <div className="card"><div className="card-eyebrow">Incidents</div>
        <div style={{fontSize:13}}>1 walk-out · T22 (refused pork temp)<br/>1 minor cut · BOH (logged)<br/>0 guest complaints written.</div>
      </div>
    </div>
  </div>);
}

// ─── 3A. BAR ───
function Bar() {
  return (<div className="page">
    <PageHead eyebrow="Bar · Wes Ackerman" title="Cocktails &" em="pour"
      sub="House recipe specs, pour cost calc, draft levels live."/>
    <div className="grid grid-2">
      <div className="card flush">
        <div style={{padding:'14px 18px'}}><div className="card-eyebrow">House cocktails · 12 specs</div></div>
        <table className="tbl"><thead><tr><th>Cocktail</th><th>Build</th><th>Cost</th><th>Pour %</th></tr></thead><tbody>
          {[
            {n:'Lariat Old Fashioned',b:'2oz Bourbon · ¼oz demerara · 3ds Ang.',c:'$2.40',p:14},
            {n:'Buena Vista Margarita',b:'2oz Tequila · 1oz lime · ¾oz mezcal',c:'$2.80',p:18},
            {n:'Smoked Paloma',b:'2oz Tequila · 4oz grapefruit · mezcal rinse',c:'$2.10',p:13},
            {n:'Honey Bee',b:'1.5oz gin · ¾oz lemon · ¾oz honey',c:'$1.90',p:16},
            {n:'Ranch Water',b:'2oz tequila · lime · Topo Chico',c:'$1.60',p:11},
          ].map(c=>(<tr key={c.n}>
            <td><b>{c.n}</b><div className="row-meta">{c.b}</div></td>
            <td className="num">{c.c}</td>
            <td className="num">{c.p}%</td>
            <td><span className={`pill ${c.p<15?'ok':c.p<18?'warn':'alert'}`}>{c.p<15?'in spec':c.p<18?'watch':'low'}</span></td>
          </tr>))}
        </tbody></table>
      </div>
      <div className="flex-col">
        <div className="card"><div className="card-eyebrow">Draft levels — 8 taps</div>
          {[
            {n:'Coors Banquet',pct:78},{n:'Avery White Rascal',pct:42},{n:'Bonfire Saison',pct:18},
            {n:'Modelo',pct:62},{n:'Local Pils',pct:8},{n:'Cider',pct:88},
          ].map(t=>(<div className="bar-row" key={t.n}>
            <div style={{width:140,fontSize:12,fontWeight:600}}>{t.n}</div>
            <div className="bar-track"><div className="bar-fill" style={{width:`${t.pct}%`,background:t.pct<20?'var(--rust)':t.pct<40?'var(--brass)':'var(--ember)'}}/></div>
            <div className="tnum" style={{fontSize:11,width:40,textAlign:'right'}}>{t.pct}%</div>
          </div>))}
        </div>
        <div className="card"><div className="card-eyebrow">Pour cost calculator</div>
          <div className="grid grid-2" style={{gap:8}}>
            <div><div className="row-meta">Bottle ($)</div><input className="in" defaultValue="22.50"/></div>
            <div><div className="row-meta">Pour (oz)</div><input className="in" defaultValue="1.5"/></div>
            <div><div className="row-meta">Menu price</div><input className="in" defaultValue="14.00"/></div>
            <div><div className="row-meta">Target %</div><input className="in" defaultValue="18"/></div>
          </div>
          <div className="quote" style={{marginTop:14,fontSize:18}}>Cost: $1.32 · Pour 9.4% · <span style={{color:'var(--sage)'}}>under target ✓</span></div>
        </div>
      </div>
    </div>
  </div>);
}

// ─── BAR INVENTORY ───
function BarInv() {
  return (<div className="page">
    <PageHead eyebrow="Bar inventory" title="Bottle" em="count"
      sub="Tap a bottle to set fill level. Variance auto-calcs against POS theoretical."/>
    <div className="card flush">
      <table className="tbl">
        <thead><tr><th>Bottle</th><th>Theo</th><th>On hand</th><th>Variance</th><th>$ var</th><th></th></tr></thead>
        <tbody>{[
          {n:'Buffalo Trace',t:0.34,o:0.30,v:-.04,$:'-$0.86'},
          {n:'Espolòn Reposado',t:0.62,o:0.55,v:-.07,$:'-$1.92'},
          {n:'Hendrick\'s Gin',t:0.81,o:0.78,v:-.03,$:'-$1.08'},
          {n:'Mezcal Vago',t:0.42,o:0.42,v:0,$:'$0.00'},
          {n:'Plymouth Gin',t:0.55,o:0.40,v:-.15,$:'-$3.40'},
        ].map(b=>(<tr key={b.n}>
          <td><b>{b.n}</b></td>
          <td className="num">{(b.t*100).toFixed(0)}%</td>
          <td><div className="bar-track" style={{width:120}}><div className="bar-fill" style={{width:`${b.o*100}%`,background:'var(--ember)'}}/></div></td>
          <td className="num">{(b.v*100).toFixed(0)}%</td>
          <td className="num" style={{color:b.v<-.05?'var(--rust)':'var(--char)'}}>{b.$}</td>
          <td><button className="btn sm">Adjust</button></td>
        </tr>))}</tbody>
      </table>
    </div>
  </div>);
}

function BarBack() {
  return (<div className="page">
    <PageHead eyebrow="Bar back · Phin Ortega" title="Restock" em="& runs"/>
    <div className="grid grid-3">
      {[{n:'Ice — well',pct:30,need:'restock'},{n:'Lemons',pct:60,need:'ok'},{n:'Limes',pct:20,need:'restock'},
        {n:'Mint',pct:80,need:'ok'},{n:'Oranges',pct:40,need:'soon'},{n:'Cherries',pct:90,need:'ok'},
        {n:'Coupes',pct:50,need:'soon'},{n:'Cocktail napkins',pct:70,need:'ok'},{n:'Straws',pct:15,need:'restock'}].map(p=>(
        <div className="card" key={p.n} style={{padding:14}}>
          <div className="split"><div className="row-name">{p.n}</div>
            <span className={`pill ${p.need==='restock'?'alert':p.need==='soon'?'warn':'ok'}`}>{p.need}</span></div>
          <div className="bar-track" style={{marginTop:10}}><div className="bar-fill" style={{width:`${p.pct}%`,background:p.pct<25?'var(--rust)':p.pct<60?'var(--brass)':'var(--sage)'}}/></div>
        </div>
      ))}
    </div>
  </div>);
}

// Sound / Booking / Stage / BoxOffice / Promo / Talent moved to pages-event.jsx
Object.assign(window, {
  Cockpit, DishPit, PrepCook, Line, EightySix, SousChef, MenuEng, Specials, FoodCost, BEO, Allergen,
  HostStand, Server, Runner, MOD, Closeout, Bar, BarInv, BarBack
  /* Sound, Booking, Stage moved to pages-event.jsx */
});
