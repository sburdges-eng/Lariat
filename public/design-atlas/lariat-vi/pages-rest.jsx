/* Remaining office pages + canvas */
const D4 = window.LARIAT_DATA;
const { useState: uS4 } = React;

function Labor() {
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  return (<div className="page">
    <PageHead eyebrow="Labor suite" title="The" em="schedule"
      sub="Drag shifts, watch the labor %, OT alerts. 4 swap requests pending."
      actions={<><button className="btn">Publish</button><button className="btn primary">Auto-fill</button></>}/>
    <div className="grid grid-4" style={{marginBottom:18}}>
      <KPI label="Labor %" value="31.8%" sub="goal 30%" tone="warn"/>
      <KPI label="OT this week" value="6.2h" sub="3 employees"/>
      <KPI label="Open shifts" value="2" sub="Sat dinner"/>
      <KPI label="Swap requests" value="4" sub="pending"/>
    </div>
    <div className="card flush">
      <div style={{padding:'14px 18px'}}><div className="card-eyebrow">Schedule · this week</div></div>
      <table className="tbl">
        <thead><tr><th>Employee · role</th>{days.map(d=><th key={d}>{d}</th>)}<th>Hrs</th></tr></thead>
        <tbody>{D4.staff.slice(0,8).map(s=>(<tr key={s.name}>
          <td><b>{s.name}</b><div className="row-meta">{s.role}</div></td>
          {days.map((d,i)=>{
            const off = (i+s.name.length)%7===0;
            return <td key={d} className="num" style={{fontSize:11}}>
              {off? <span className="muted">OFF</span> : <><span className="mono">{((i+s.name.length)%3+1)*4}h</span></>}
            </td>;
          })}
          <td className="num"><b>{((s.name.length*3)%14)+24}h</b></td>
        </tr>))}</tbody>
      </table>
    </div>
  </div>);
}

function Hiring() {
  return (<div className="page">
    <PageHead eyebrow="Hiring pipeline" title="In the" em="funnel"
      sub="3 open positions · 24 applicants in flight."/>
    <div className="grid" style={{gridTemplateColumns:'repeat(5,1fr)',gap:10}}>
      {[
        {s:'Applied',n:14,c:'var(--paper-2)'},{s:'Phone screen',n:8,c:'var(--brass)'},
        {s:'Interview',n:5,c:'var(--ember)'},{s:'Trail shift',n:2,c:'var(--ember-deep)'},{s:'Offer',n:2,c:'var(--sage)'}
      ].map(s=>(<div className="card" key={s.s} style={{padding:14,borderTop:`3px solid ${s.c}`}}>
        <div className="card-eyebrow">{s.s}</div>
        <div className="serif" style={{fontSize:36,marginTop:4}}>{s.n}</div>
      </div>))}
    </div>
    <div className="sec-head"><div className="sec-title">Active candidates</div></div>
    <div className="card flush">
      <table className="tbl"><thead><tr><th>Name</th><th>Position</th><th>Stage</th><th>Source</th><th></th></tr></thead><tbody>
        {[
          {n:'Maya Bren',p:'Line cook',s:'Interview',src:'Indeed'},
          {n:'Carlos Vega',p:'Line cook',s:'Trail shift',src:'Referral · Diego'},
          {n:'Sienna Park',p:'Server',s:'Offer',src:'Walk-in'},
          {n:'Kai Lindo',p:'Server',s:'Phone screen',src:'Craigslist'},
          {n:'Tomás García',p:'Bar back',s:'Applied',src:'Indeed'},
        ].map(c=>(<tr key={c.n}><td><b>{c.n}</b></td><td>{c.p}</td>
          <td><span className="pill ember">{c.s}</span></td><td>{c.src}</td>
          <td><button className="btn sm">Open</button></td></tr>))}
      </tbody></table>
    </div>
  </div>);
}

function Vendors() {
  return (<div className="page">
    <PageHead eyebrow="Vendors" title="The" em="rolodex"
      sub="14 vendors · price-watch on 86 line items · 2 contracts up Q3."/>
    <div className="card flush">
      <table className="tbl"><thead><tr><th>Vendor</th><th>Cat</th><th>Schedule</th><th>Spend MTD</th><th>Price changes</th><th>Contract</th></tr></thead>
        <tbody>{[
          {n:'Sysco',c:'Broadliner',s:'Tu/Th/Sa',sp:18420,p:'+2 items',ct:'Jan 2027'},
          {n:'Cervantes Meats',c:'Protein',s:'Mon/Fri',sp:9820,p:'+1 (brisket +6%)',ct:'Apr 2026 · 90d'},
          {n:'Lariat Farms',c:'Produce',s:'Tu/Fr',sp:4810,p:'-2 items',ct:'-'},
          {n:'Republic Wine',c:'Bev',s:'Wed',sp:7280,p:'0',ct:'Aug 2026'},
          {n:'Roca Coffee',c:'Bev',s:'Mon',sp:1240,p:'0',ct:'-'},
          {n:'Ace Linens',c:'Service',s:'Daily',sp:1820,p:'0',ct:'Dec 2026'},
        ].map(v=>(<tr key={v.n}><td><b>{v.n}</b></td><td>{v.c}</td><td className="mono">{v.s}</td>
          <td className="num">${v.sp.toLocaleString()}</td>
          <td>{v.p==='0'?<span className="muted">—</span>:<span className="pill warn">{v.p}</span>}</td>
          <td className="mono">{v.ct}</td></tr>))}
        </tbody></table>
    </div>
  </div>);
}

function Marketing() {
  return (<div className="page">
    <PageHead eyebrow="Marketing calendar" title="What's" em="going out"
      sub="Social · email · partnerships · live music promotion. Cross-channel view."/>
    <div className="grid grid-4" style={{marginBottom:18}}>
      <KPI label="Email open" value="38%" sub="last 4 sends" tone="up"/>
      <KPI label="IG followers" value="8.4K" sub="+184 mo"/>
      <KPI label="Loyalty signups" value="82" sub="this month"/>
      <KPI label="Marketing ROI" value="3.8x" sub="30d attributable"/>
    </div>
    <div className="card flush">
      <div style={{padding:'14px 18px'}}><div className="card-eyebrow">Next 14 days</div></div>
      <table className="tbl"><thead><tr><th>Date</th><th>Channel</th><th>Campaign</th><th>Status</th></tr></thead><tbody>
        {[
          {d:'Apr 26',c:'IG',n:'Bramble Hollow show recap reel',s:'scheduled'},
          {d:'Apr 28',c:'Email',n:'May menu reveal · 2,840 subs',s:'draft'},
          {d:'May 1',c:'IG',n:'Cinco de Mayo specials',s:'draft'},
          {d:'May 3',c:'Print',n:'Local paper · half-page',s:'sent'},
          {d:'May 5',c:'Event',n:'Cinco · live music + tasting',s:'live'},
          {d:'May 10',c:'Email',n:"Mother's Day · prix fixe",s:'queued'},
        ].map((m,i)=>(<tr key={i}>
          <td className="mono">{m.d}</td><td>{m.c}</td><td>{m.n}</td>
          <td><span className={`pill ${m.s==='live'?'ok':m.s==='scheduled'?'ember':'warn'}`}>{m.s}</span></td>
        </tr>))}
      </tbody></table>
    </div>
  </div>);
}

function Maintenance() {
  return (<div className="page">
    <PageHead eyebrow="Maintenance" title="The" em="work order"
      sub="Open requests · preventive schedule · spend tracking."/>
    <div className="grid grid-2">
      <div className="card flush">
        <div style={{padding:'14px 18px'}}><div className="card-eyebrow">Open · 6</div></div>
        <table className="tbl"><tbody>{[
          {p:'high',n:'Walk-in #2 · door seal',v:'GeoCool',d:'2d open'},
          {p:'high',n:'Hood vent #4 · vibration',v:'Hood Co.',d:'1d open'},
          {p:'med',n:'Ice machine · slow production',v:'Manitowoc',d:'3d open'},
          {p:'med',n:'POS terminal #2 · screen flicker',v:'Toast',d:'4d open'},
          {p:'low',n:'Front patio bulb out',v:'in-house',d:'1d'},
          {p:'low',n:'Restroom #2 · slow drain',v:'in-house',d:'today'},
        ].map((m,i)=>(<tr key={i}>
          <td><span className="dot" style={{background:m.p==='high'?'var(--rust)':m.p==='med'?'var(--brass)':'var(--hair)',marginRight:8}}/><b>{m.n}</b></td>
          <td>{m.v}</td>
          <td className="mono">{m.d}</td>
        </tr>))}</tbody></table>
      </div>
      <div className="card"><div className="card-eyebrow">Preventive · upcoming</div>
        {[
          {n:'Walk-in coil clean',d:'May 1',f:'monthly'},
          {n:'Hood deep clean',d:'May 4',f:'quarterly'},
          {n:'Fryer boil-out',d:'Apr 28',f:'weekly'},
          {n:'Pest control · interior',d:'May 6',f:'monthly'},
          {n:'Fire suppression',d:'May 28',f:'semi-annual'},
        ].map(p=>(<div className="row" key={p.n}>
          <div className="mono" style={{width:60,color:'var(--ember-deep)'}}>{p.d}</div>
          <div style={{flex:1}}><div className="row-name">{p.n}</div><div className="row-meta">{p.f}</div></div>
        </div>))}
      </div>
    </div>
  </div>);
}

function Compliance() {
  return (<div className="page">
    <PageHead eyebrow="Compliance calendar" title="What's" em="due"
      sub="Health · liquor · fire · ADA · insurance · TABC. Alerts at 90/60/30/14/0."/>
    <div className="card flush">
      <table className="tbl"><thead><tr><th>Item</th><th>Authority</th><th>Due</th><th>Days</th><th>Status</th></tr></thead>
        <tbody>{[
          {i:'Health re-inspection',a:'Custer Co Health',d:'May 4',ds:9,s:'prep'},
          {i:'Liquor license renewal',a:'Colorado LED',d:'May 12',ds:17,s:'submitted'},
          {i:'Fire suppression service',a:'Cintas',d:'May 28',ds:33,s:'scheduled'},
          {i:'TABC certs · 4 staff',a:'Internal',d:'Jun 8',ds:44,s:'in progress'},
          {i:'GL insurance renewal',a:'AmTrust',d:'Jul 1',ds:67,s:'on file'},
          {i:'ADA self-audit',a:'Internal',d:'Aug 15',ds:112,s:'queued'},
        ].map((c,i)=>(<tr key={i}>
          <td><b>{c.i}</b></td><td>{c.a}</td><td className="mono">{c.d}</td>
          <td className="num" style={{color:c.ds<14?'var(--rust)':c.ds<30?'var(--brass)':'var(--char)'}}>{c.ds}</td>
          <td><span className={`pill ${c.s==='submitted'||c.s==='on file'?'ok':c.s==='prep'?'warn':'ember'}`}>{c.s}</span></td>
        </tr>))}</tbody></table>
    </div>
  </div>);
}

function Scenario() {
  const [food,setF] = uS4(28.4);
  const [labor,setL] = uS4(31.8);
  const [covers,setC] = uS4(1240);
  const [ppa,setP] = uS4(45.32);
  const rev = covers * ppa * 52;
  const net = rev * (1 - food/100 - labor/100 - 0.16);
  return (<div className="page">
    <PageHead eyebrow="Scenario modeler" title="What" em="if?"
      sub="Move the levers · see the impact on annualized net income."/>
    <div className="grid grid-2">
      <div className="card">
        {[
          {l:'Food cost %',v:food,set:setF,min:25,max:35,step:0.1,sfx:'%'},
          {l:'Labor cost %',v:labor,set:setL,min:25,max:38,step:0.1,sfx:'%'},
          {l:'Covers / week',v:covers,set:setC,min:900,max:1600,step:10,sfx:''},
          {l:'Avg PPA',v:ppa,set:setP,min:38,max:58,step:0.25,sfx:'$'},
        ].map(x=>(<div key={x.l} style={{margin:'18px 0'}}>
          <div className="split"><div className="card-eyebrow">{x.l}</div>
            <div className="mono" style={{fontSize:14,color:'var(--ember-deep)'}}>{x.sfx==='$'?'$':''}{x.v}{x.sfx==='%'?'%':''}</div></div>
          <input type="range" min={x.min} max={x.max} step={x.step} value={x.v} onChange={e=>x.set(+e.target.value)}
            style={{width:'100%',accentColor:'var(--ember)',marginTop:6}}/>
        </div>))}
      </div>
      <div className="card" style={{display:'flex',flexDirection:'column',justifyContent:'center'}}>
        <div className="card-eyebrow">Annualized projection</div>
        <div className="serif" style={{fontSize:64,marginTop:8,lineHeight:1}}>${(rev/1000).toFixed(0)}K</div>
        <div className="row-meta">revenue</div>
        <hr/>
        <div className="card-eyebrow">Net income</div>
        <div className="serif" style={{fontSize:64,color:net>200000?'var(--sage)':'var(--ember-deep)',lineHeight:1}}>${(net/1000).toFixed(0)}K</div>
        <div className="row-meta">{((net/rev)*100).toFixed(1)}% net margin · break-even at {Math.round((rev*0.16+rev*food/100+rev*labor/100)/(ppa*52))} covers/wk</div>
      </div>
    </div>
  </div>);
}

// ─── CANVAS OVERVIEW ───
function Canvas({ onNav }) {
  const tiles = {
    cockpit: 'Single-screen overview · covers, sales, ticket times, 86 list, VIPs, BEOs',
    dish: 'Wall tablet · chemical log, deep clean checklist, throughput',
    prep: 'Auto-built prep list from tomorrow\'s book · recipe viewer · waste log',
    line: 'Live KDS · ticket rail with age coloring · station mise · 86',
    eightySix: '86 board · pushes to POS, host stand, server devices instantly',
    sous: 'Line check, ordering, scheduling, training matrix',
    menuEng: 'Stars / Plowhorses / Puzzles / Dogs · click-to-drill',
    specials: 'R&D sandbox · overstock in, costed concepts out',
    foodCost: 'Theoretical vs actual · variance by category · waste Pareto',
    beo: 'Banquet event orders · run sheets · allergens · staffing',
    allergen: 'Auto-derived grid · every dish × every allergen',
    host: 'Floor map · drag to seat · waitlist · reservations · VIP flags',
    server: 'PWA on phone · my tables · menu lookup · guest profile · tips',
    runner: 'Expo run queue · bus priority · pre-bus checklist',
    mod: 'Floor pulse · comp/void approvals · cut list · table touches',
    closeout: 'Auto-compiled night report · sales · labor · comps · incidents',
    bar: 'Cocktail specs · pour cost · draft levels · variance',
    barInv: 'Bottle-by-bottle count · variance vs theoretical',
    barBack: 'Restock pars · keg log · ice machine status',
    sound: 'Stage plot · 18-ch sheet · monitor world · scene · live SPL trace',
    booking: 'Pipeline funnel · 5-week calendar · settlement · offer template',
    stage: 'Six layouts · run-of-show · hospitality + tech rider',
    boxOffice: 'Ticket curve · will-call · comps · presale/walkup mix',
    promo: 'Poster · social drop calendar · radio · partner trades · footprint',
    talent: 'Demos · A&R fit score · genre balance · hold candidates',
    gm: 'Single-page command center · revenue, costs, guest score, calendar',
    pl: 'Full P&L · USAR-mapped chart of accounts · drill-down',
    labor: 'Schedule builder · OT alerts · swap requests · break compliance',
    hiring: 'Funnel · candidates · onboarding · shadow shifts',
    vendors: 'Rolodex · price watch · contract renewals · spend',
    marketing: 'Calendar · social · email · loyalty · ROI',
    feedback: 'Yelp · Google · OpenTable · sentiment routed',
    maint: 'Open work orders · preventive schedule · spend',
    compliance: 'Health · liquor · fire · ADA · insurance · alerts',
    owner: 'Investor view · cash · distributions · scenario modeler',
    scenario: 'Slide the levers · see net impact',
    accounting: 'Daily journal · AP · AR · payroll · bank rec',
    inventory: 'Perpetual + receiving + pars · price-watch · recall',
    haccp: 'CCP monitoring · cooling · hot/cold hold · sanitation · pest',
    analytics: 'Hour × day heat · product mix · daypart · weather · RevPASH',
    guests: 'Reviews · NPS · loyalty · gift cards · texting',
    comms: 'Logbook · channels · SOPs · document library',
    assistant: 'Grounded LLM · live data · voice · action engine',
    hr: 'Roster · onboarding · certs · reviews · write-ups',
  };
  return (<div className="canvas-host">
    <div className="canvas-pad">
      <div className="page-head" style={{padding:'0 8px',marginBottom:36}}>
        <div>
          <div className="page-eyebrow">Feature atlas · 38 modules</div>
          <h1 className="page-title">Every page, <em>at once</em></h1>
          <div className="page-sub">Click any tile to open the page. Organized by department, mirroring the BOH/FOH/Bar/Entertainment/Office/Cross-cutting structure of the spec.</div>
        </div>
      </div>
      {NAV.map((sec,si)=>(<div className="canvas-band" key={sec.sec}>
        <div className="canvas-band-head">
          <div className="canvas-band-num">0{si+1}</div>
          <div className="canvas-band-title">{sec.sec}</div>
          <div className="canvas-band-sub">{sec.items.length} modules</div>
        </div>
        <div className="canvas-grid">
          {sec.items.filter(it=>it.id!=='canvas').map(it=>(
            <div className="canvas-tile" key={it.id} onClick={()=>onNav(it.id)}>
              <div className="canvas-tile-eyebrow">{it.dept} · {it.role||'shared'}</div>
              <div className="canvas-tile-title">{it.label}</div>
              <div className="canvas-tile-desc">{tiles[it.id]||'—'}</div>
              <div className="canvas-tile-foot">
                {it.mode==='kitchen' && <span className="pill">kitchen mode</span>}
                {it.role && <span className="pill ember">{it.role}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>))}
    </div>
  </div>);
}

Object.assign(window, { Labor, Hiring, Vendors, Marketing, Maintenance, Compliance, Scenario, Canvas });
