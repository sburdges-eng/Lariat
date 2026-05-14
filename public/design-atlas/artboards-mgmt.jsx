// LaRiOS · Management artboards
// Manager Command (desktop) · Owner Brief · Calendar/Schedule ·
// Maintenance · Performance reviews · Ban list · Handbooks

const { useState: useStateM, useEffect: useEffectM } = React;

/* ───────── Shared bits ───────── */
function SurfaceHeader({ surface, role, location, dim }){
  return (
    <div style={{display:'flex',alignItems:'center',gap:12,padding:'10px 16px',
      borderBottom:'1px solid var(--hair)',background:'var(--panel-2)',fontSize:11}}>
      <window.LariSigil size={20}/>
      <div>
        <div className="eyebrow" style={{lineHeight:1}}>{surface}</div>
        <div style={{fontFamily:'var(--serif)',fontSize:18,lineHeight:1.05,marginTop:2}}>{role}</div>
      </div>
      <span className="tag" style={{marginLeft:'auto'}}>{location}</span>
      <span className="tag">{dim}</span>
    </div>
  );
}

function Watermark({ children }){
  return <div style={{position:'absolute',top:14,right:18,zIndex:5,fontFamily:'var(--mono)',
    fontSize:9.5,letterSpacing:'.28em',color:'var(--muted)',textTransform:'uppercase'}}>{children}</div>;
}

/* ───────── 1. MANAGER COMMAND DESKTOP ─────────
   1440 × 900 — the "only true master" surface */
function MgmtCommand(){
  const [tab,setTab] = useStateM('overview');
  const beo = window.LARIOS.beo;
  const lari = window.LARIOS.lari.predictions;
  return (
    <div style={{width:1440,height:920,display:'flex',flexDirection:'column',background:'var(--bg)',position:'relative',overflow:'hidden'}}>
      <SurfaceHeader surface="01 · Management Command" role="GM · Andrea Reed" location="The Lariat · Buena Vista" dim="desktop · 1440 × 900"/>
      {/* Service strip */}
      <div style={{display:'flex',alignItems:'center',gap:18,padding:'10px 20px',borderBottom:'1px solid var(--hair)',background:'var(--cream)'}}>
        <div style={{display:'flex',alignItems:'center',gap:6,fontFamily:'var(--mono)',fontSize:10,letterSpacing:'.22em',textTransform:'uppercase'}}>
          <span className="dot ok"/> Open <span className="muted">10:00</span>
        </div>
        <div className="muted mono" style={{fontSize:10,letterSpacing:'.22em',textTransform:'uppercase'}}>· Lunch 11:30 · Mid 2:30 ·</div>
        <div style={{display:'flex',alignItems:'center',gap:6,fontFamily:'var(--mono)',fontSize:11,letterSpacing:'.18em',color:'var(--ember-deep)',fontWeight:700,textTransform:'uppercase'}}>
          <span className="dot ember" style={{boxShadow:'0 0 0 3px rgba(200,90,42,.18)'}}/> Cocktail · BEO Calloway
        </div>
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:18}}>
          <div className="tnum" style={{fontSize:13}}>6:48 PM</div>
          <span className="role"><span className="swatch"/> GM</span>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'220px 1fr 320px',flex:1,minHeight:0}}>
        {/* Rail */}
        <aside style={{borderRight:'1px solid var(--hair)',background:'var(--cream)',padding:'14px 10px',display:'flex',flexDirection:'column',gap:2}}>
          {[
            ['Overview','overview','◇'],['BEO · Calloway','beo','♢'],['Calendar','cal','▤'],
            ['Maintenance','maint','◌'],['People','people','◉'],['Inventory','inv','▦'],
            ['Handbooks','hand','❡'],['Ban list','ban','⊘'],['Comms','comms','✷'],
          ].map(([l,k,ic])=>(
            <button key={k} onClick={()=>setTab(k)} style={{
              display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:4,
              fontSize:13,fontWeight:600,textAlign:'left',
              background:tab===k?'var(--ink)':'transparent',color:tab===k?'var(--cream)':'var(--char)'
            }}>
              <span style={{width:18,opacity:.7}}>{ic}</span>{l}
            </button>
          ))}
          <div style={{marginTop:'auto',padding:10,borderTop:'1px dashed var(--hair)',fontSize:10,color:'var(--muted)',fontFamily:'var(--mono)',letterSpacing:'.18em',textTransform:'uppercase'}}>
            <div>· You can impersonate ·</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
              {['Expo','Sous','Bar','Server','Host','Stage','Coord','Owner'].map(r=>(
                <button key={r} className="btn xs ghost">{r}</button>
              ))}
            </div>
          </div>
        </aside>

        {/* Center stage */}
        <main style={{padding:'24px 28px',overflow:'auto'}} className="scroll">
          {tab==='overview' && <>
            <div className="eyebrow">Tonight · Saturday · BEO-2641</div>
            <div className="title-xl" style={{marginTop:6,marginBottom:6}}>
              The house is <em>calm</em>, the kitchen is <em>warm</em>.
            </div>
            <div className="muted" style={{fontSize:14,maxWidth:680,lineHeight:1.5}}>
              142 covers seated tonight. Bramble Riders soundcheck at 5:30. LaRi flagged 3 items for your attention.
            </div>

            {/* KPI strip */}
            <div className="grid g5" style={{marginTop:22}}>
              <div className="kpi"><div className="kpi-l">Covers · seated</div><div className="kpi-v">142</div><div className="kpi-s up">+18 vs forecast</div></div>
              <div className="kpi"><div className="kpi-l">Revenue · projected</div><div className="kpi-v">$42.8k</div><div className="kpi-s up">+12% vs BEO</div></div>
              <div className="kpi"><div className="kpi-l">Labor · burn</div><div className="kpi-v">24.1%</div><div className="kpi-s">target 26%</div></div>
              <div className="kpi"><div className="kpi-l">Avg ticket time</div><div className="kpi-v">14:32</div><div className="kpi-s warn">+1:08 trend</div></div>
              <div className="kpi"><div className="kpi-l">Guest sentiment</div><div className="kpi-v">4.7</div><div className="kpi-s up">3 mentions of band</div></div>
            </div>

            {/* Operational heatmap + LaRi */}
            <div className="grid" style={{gridTemplateColumns:'1.4fr 1fr',marginTop:18}}>
              <div className="surface" style={{padding:18}}>
                <div className="split"><div className="eyebrow">Live heatmap · BOH ↔ FOH ↔ Bar ↔ Stage</div>
                  <div className="muted mono" style={{fontSize:10}}>updated 8s ago</div></div>
                <Heatmap/>
                <div className="hair-dash" style={{margin:'14px 0'}}/>
                <div className="grid g4">
                  {[
                    ['Course pacing','on','#5d7a66','Course 2 → Course 3 in 7m'],
                    ['Bar throughput','spike soon','#b8892f','190/hr expected at set-break'],
                    ['Stage','soundcheck','#c85a2a','88dB on patio (target 84)'],
                    ['Floor','seated 71%','#5d7a66','Patio still receiving'],
                  ].map((c,i)=>(
                    <div key={i} style={{padding:12,border:'1px solid var(--hair)',borderRadius:4,background:'var(--cream)'}}>
                      <div className="eyebrow">{c[0]}</div>
                      <div style={{display:'flex',alignItems:'center',gap:6,marginTop:4}}>
                        <span className="dot" style={{background:c[2]}}/>
                        <span style={{fontFamily:'var(--serif)',fontSize:18}}>{c[1]}</span>
                      </div>
                      <div className="muted" style={{fontSize:11,marginTop:4}}>{c[3]}</div>
                    </div>
                  ))}
                </div>
              </div>
              <window.LariHUD role="gm" title="LaRi · GM advisor"/>
            </div>

            {/* Maintenance row */}
            <div className="grid" style={{gridTemplateColumns:'1fr 1fr',marginTop:18}}>
              <div className="surface" style={{padding:18}}>
                <div className="split">
                  <div className="title-md">Maintenance ledger</div>
                  <button className="btn xs">Open full →</button>
                </div>
                <div style={{marginTop:12,display:'flex',flexDirection:'column',gap:6}}>
                  {window.LARIOS.maint.slice(0,5).map((m,i)=>(
                    <div key={i} style={{display:'grid',gridTemplateColumns:'12px 1.4fr 2fr 1fr 1fr',alignItems:'center',gap:8,padding:'8px 0',borderBottom:'1px solid var(--hair)',fontSize:12.5}}>
                      <span className={`dot ${m.sev}`}/>
                      <b style={{fontWeight:600}}>{m.sys}</b>
                      <span className="muted">{m.issue}</span>
                      <span className="mono" style={{fontSize:11}}>{m.vendor}</span>
                      <span className="mono" style={{fontSize:11,textAlign:'right'}}>{m.eta}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="surface" style={{padding:18}}>
                <div className="split">
                  <div className="title-md">On shift · 8</div>
                  <button className="btn xs">Roster →</button>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:12}}>
                  {window.LARIOS.staff.slice(0,6).map(s=>(
                    <div key={s.id} style={{display:'flex',alignItems:'center',gap:10}}>
                      <div className="av sm">{s.avatar}</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:600}}>{s.n}</div>
                        <div className="muted mono" style={{fontSize:10}}>{s.r} · {s.shift}</div>
                      </div>
                      <span className={`pill ${s.stat==='late'?'warn':'ok'}`}>{s.stat==='late'?'4m late':'on'}</span>
                      <span className="mono muted" style={{fontSize:10}}>★ {s.score}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>}

          {tab==='beo' && <BEOSlim beo={beo}/>}
          {tab==='cal' && <CalendarView/>}
          {tab==='maint' && <MaintList/>}
          {tab==='people' && <PerformancePanel/>}
          {tab==='inv' && <InvSnap/>}
          {tab==='hand' && <HandbooksPanel/>}
          {tab==='ban' && <BanList/>}
          {tab==='comms' && <CommsPanel/>}
        </main>

        {/* Right Rail · LaRi + alerts */}
        <aside style={{borderLeft:'1px solid var(--hair)',background:'var(--cream)',display:'flex',flexDirection:'column',minHeight:0}}>
          <div style={{padding:'18px 18px 12px'}}>
            <div className="eyebrow">LaRi · ambient feed</div>
            <div className="title-md" style={{marginTop:4}}>What I'm watching</div>
          </div>
          <div style={{flex:1,overflow:'auto',padding:'0 14px 14px',display:'flex',flexDirection:'column',gap:8}} className="scroll">
            {lari.map((p,i)=>(
              <div key={i} style={{padding:'10px 12px',background:'var(--panel)',border:'1px solid var(--hair)',borderRadius:4,position:'relative'}}>
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                  <span className={`dot ${p.sev}`}/>
                  <span className="role"><span className="swatch" style={{background:'var(--ember)'}}/>{p.for}</span>
                </div>
                <div style={{fontSize:12.5,lineHeight:1.45}}>{p.txt}</div>
                {p.action && <div className="mono" style={{fontSize:10,color:'var(--ember-deep)',marginTop:4,letterSpacing:'.06em'}}>↳ {p.action}</div>}
                <div style={{display:'flex',gap:6,marginTop:8}}>
                  <button className="btn xs">Ack</button>
                  <button className="btn xs ghost">Detail</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{padding:14,borderTop:'1px solid var(--hair)',display:'flex',gap:8}}>
            <input className="in" placeholder="Ask LaRi… (⌘K)" style={{flex:1,padding:'8px 10px',border:'1px solid var(--hair)',borderRadius:4,fontFamily:'inherit',fontSize:12}}/>
            <button className="btn xs primary">Send</button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Heatmap(){
  // 4 lanes × 24 cells representing the next 4h of operations
  const lanes = [
    { name:'BOH ticket aging',   cells:[1,1,2,2,2,3,3,2,2,2,3,4,4,3,3,2,2,2,3,3,2,1,1,1] },
    { name:'Bar throughput',     cells:[1,1,1,2,2,2,3,3,2,2,2,3,4,5,4,3,3,2,2,3,3,2,1,1] },
    { name:'Floor turn rate',    cells:[0,1,1,2,2,3,3,3,2,2,2,2,3,3,3,2,2,2,2,1,1,1,1,0] },
    { name:'Stage / dB',         cells:[0,0,1,1,2,2,2,2,2,2,3,3,4,4,3,3,4,4,3,3,2,2,1,1] },
  ];
  const colors = ['#e3d8c1','#d6c9ad','#b8892f','#c85a2a','#9a3f1a','#5b2410'];
  return (
    <div style={{marginTop:14}}>
      {lanes.map(l=>(
        <div key={l.name} style={{display:'grid',gridTemplateColumns:'160px 1fr',alignItems:'center',gap:10,padding:'4px 0'}}>
          <div className="eyebrow" style={{fontSize:9}}>{l.name}</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(24,1fr)',gap:2}}>
            {l.cells.map((c,i)=>(<div key={i} style={{height:14,background:colors[c],borderRadius:1}} />))}
          </div>
        </div>
      ))}
      <div style={{display:'flex',gap:14,marginTop:8,fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.22em',color:'var(--muted)',textTransform:'uppercase'}}>
        <span>now</span><span style={{marginLeft:'auto'}}>+1h</span><span>+2h</span><span>+3h</span><span>+4h</span>
      </div>
    </div>
  );
}

/* sub-views, kept compact */
function BEOSlim({beo}){
  return (
    <>
      <div className="eyebrow">{beo.id} · {beo.kind}</div>
      <div className="title-xl" style={{margin:'6px 0 16px'}}>{beo.title} <em>· {beo.guests} guests</em></div>
      <div className="grid g3">
        <div className="surface" style={{padding:16}}>
          <div className="eyebrow">Timeline</div>
          {beo.schedule.map((s,i)=>(
            <div key={i} style={{display:'flex',gap:10,padding:'6px 0',borderBottom:'1px dashed var(--hair)',fontSize:12.5,
              opacity: s.group==='pre'?.55:s.group==='late'?.7:1}}>
              <span className="mono" style={{width:70,color: s.group==='now'?'var(--ember-deep)':'var(--muted)'}}>{s.t}</span>
              <span style={{flex:1}}>{s.what}</span>
              {s.group==='now' && <span className="pill ember">now</span>}
            </div>
          ))}
        </div>
        <div className="surface" style={{padding:16}}>
          <div className="eyebrow">Menu · 4-course</div>
          <div style={{marginTop:8}}>
            <div style={{fontFamily:'var(--serif)',fontSize:14,marginTop:6}}><i>Canapés ·</i> {beo.menu.canape.join(' · ')}</div>
            <div style={{fontFamily:'var(--serif)',fontSize:16,marginTop:10}}><i>I.</i> {beo.menu.course1}</div>
            <div style={{fontFamily:'var(--serif)',fontSize:16,marginTop:6}}><i>II.</i> {beo.menu.course2}</div>
            <div style={{fontFamily:'var(--serif)',fontSize:16,marginTop:6}}><i>III.</i> {beo.menu.course3a}<br/><span className="muted">· {beo.menu.course3b}<br/>· {beo.menu.course3c}</span></div>
            <div style={{fontFamily:'var(--serif)',fontSize:16,marginTop:6}}><i>IV.</i> {beo.menu.dessert}</div>
          </div>
        </div>
        <div className="surface" style={{padding:16}}>
          <div className="eyebrow">Bar program</div>
          <div className="muted" style={{fontSize:11,marginTop:4}}>{beo.bar.program}</div>
          <div style={{marginTop:10}}>
            {beo.bar.signatures.map((s,i)=>(
              <div key={i} style={{padding:'8px 0',borderBottom:'1px dashed var(--hair)'}}>
                <div style={{fontFamily:'var(--serif)',fontSize:16}}>{s.name}</div>
                <div className="muted mono" style={{fontSize:10}}>{s.pour}</div>
              </div>
            ))}
          </div>
          <div style={{marginTop:10,padding:10,background:'rgba(200,90,42,.06)',borderLeft:'3px solid var(--ember)',fontSize:12}}>
            <span className="eyebrow" style={{color:'var(--ember-deep)'}}>LaRi forecast</span><br/>{beo.bar.forecast}
          </div>
        </div>
      </div>

      <div className="grid g2" style={{marginTop:14}}>
        <div className="surface" style={{padding:16}}>
          <div className="eyebrow">Band rider · {beo.band.name}</div>
          <ul style={{margin:'8px 0',paddingLeft:18}}>
            {beo.band.rider.map((r,i)=><li key={i} style={{fontSize:13,padding:'2px 0'}}>{r}</li>)}
          </ul>
        </div>
        <div className="surface" style={{padding:16}}>
          <div className="eyebrow">Contacts</div>
          <div style={{marginTop:8,fontSize:13,lineHeight:1.7}}>
            <div><b>Primary:</b> {beo.contact.primary} · <span className="mono">{beo.contact.phone}</span></div>
            <div><b>Planner:</b> {beo.contact.planner}</div>
            <div><b>Spaces:</b> {beo.spaces.join(' · ')}</div>
          </div>
        </div>
      </div>
    </>
  );
}

function CalendarView(){
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const weeks = [
    [10,11,12,13,14,15,16],
    [17,18,19,20,21,22,23],
    [24,25,26,27,28,29,30],
  ];
  const evt = {
    16:[{l:'Calloway × Hong wedding',c:'ember'},{l:'Bramble Riders',c:'ink'}],
    18:[{l:'Vendor: Hill Country Refrig.',c:'warn'}],
    19:[{l:'Open mic',c:'ink'}],
    21:[{l:'Memorial Day prep',c:'warn'}],
    22:[{l:'Hood #3 quarterly',c:'warn'}],
    23:[{l:'Wedding · Park × Liu',c:'ember'},{l:'DJ Karou',c:'ink'}],
    25:[{l:'Memorial Day · holiday menu',c:'warn'}],
    27:[{l:'Wine dinner',c:'ember'}],
    30:[{l:'Wedding · Adler',c:'ember'},{l:'The Ferns (band)',c:'ink'}],
  };
  return (<>
    <div className="eyebrow">Schedule · May 2026</div>
    <div className="title-xl" style={{margin:'6px 0 16px'}}>Three weeks <em>at a glance</em></div>
    <div className="surface" style={{padding:14}}>
      <div className="grid g7" style={{gridTemplateColumns:'repeat(7,1fr)',gap:1,background:'var(--hair)',border:'1px solid var(--hair)'}}>
        {days.map(d=><div key={d} className="eyebrow" style={{padding:'6px 10px',background:'var(--paper-2)'}}>{d}</div>)}
        {weeks.flat().map(d=>(
          <div key={d} style={{padding:10,minHeight:96,background:'var(--cream)',position:'relative'}}>
            <div style={{display:'flex',justifyContent:'space-between'}}>
              <span style={{fontFamily:'var(--serif)',fontSize:18,color:d===16?'var(--ember-deep)':'var(--ink)'}}>{d}</span>
              {d===16 && <span className="pill ember">tonight</span>}
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:3,marginTop:4}}>
              {(evt[d]||[]).map((e,i)=>(
                <div key={i} style={{fontSize:10,fontFamily:'var(--mono)',padding:'2px 5px',
                  background: e.c==='ember'?'var(--ember)':e.c==='warn'?'rgba(184,137,47,.25)':'var(--ink)',
                  color:e.c==='ember'?'#1a1308':e.c==='warn'?'var(--brass-deep)':'var(--cream)',
                  borderRadius:2,letterSpacing:'.04em'}}>{e.l}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{display:'flex',gap:14,marginTop:12,fontSize:10,fontFamily:'var(--mono)',letterSpacing:'.18em',color:'var(--muted)',textTransform:'uppercase'}}>
        <span><span className="dot ember" style={{verticalAlign:'middle',marginRight:6}}/> Event / wedding</span>
        <span><span className="dot" style={{background:'var(--ink)',verticalAlign:'middle',marginRight:6}}/> Music</span>
        <span><span className="dot warn" style={{verticalAlign:'middle',marginRight:6}}/> Ops / maintenance</span>
        <span style={{marginLeft:'auto'}}>holidays auto-loaded</span>
      </div>
    </div>

    <div className="grid g2" style={{marginTop:14}}>
      <div className="surface" style={{padding:16}}>
        <div className="eyebrow">Staff schedule · this week</div>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,marginTop:8}}>
          <thead><tr>{['','Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(h=><th key={h} className="eyebrow" style={{textAlign:'left',padding:'6px 4px',borderBottom:'1px solid var(--hair)'}}>{h}</th>)}</tr></thead>
          <tbody>
            {[
              ['Renata J. · sous','—','12–10','12–10','off','4–c','4–c','—'],
              ['Marcus S. · expo','off','5–c','5–c','5–c','off','5–c','5–c'],
              ['Hana L. · bar','5–c','off','5–c','5–c','5–c','5–c','off'],
              ['Devon T. · server','5–c','5–c','off','5–c','5–c','5–c','off'],
              ['Aria I. · host','—','4–11','off','4–11','4–11','4–11','—'],
            ].map((r,i)=>(
              <tr key={i}>
                {r.map((c,j)=><td key={j} style={{padding:'8px 4px',borderBottom:'1px dashed var(--hair)',fontFamily:j===0?'inherit':'var(--mono)',fontSize:j===0?12:11,color:c==='off'?'var(--muted)':'var(--ink)'}}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="surface" style={{padding:16}}>
        <div className="eyebrow">Routine maintenance · upcoming</div>
        <div style={{marginTop:10,display:'flex',flexDirection:'column',gap:8}}>
          {window.LARIOS.maint.map((m,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',background:'var(--panel)',border:'1px solid var(--hair)',borderRadius:4}}>
              <span className={`dot ${m.sev}`}/>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600}}>{m.sys}</div>
                <div className="muted" style={{fontSize:11}}>{m.issue} · {m.vendor}</div>
              </div>
              <span className="mono" style={{fontSize:11,color:'var(--muted)'}}>{m.eta}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  </>);
}

function MaintList(){
  return <CalendarView/>;
}

function PerformancePanel(){
  const staff = window.LARIOS.staff;
  return (<>
    <div className="eyebrow">People · performance reviews</div>
    <div className="title-xl" style={{margin:'6px 0 16px'}}>The crew, <em>seen clearly</em></div>
    <div className="grid g3">
      {staff.map(s=>(
        <div key={s.id} className="surface lift" style={{padding:16}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div className="av lg">{s.avatar}</div>
            <div>
              <div style={{fontFamily:'var(--serif)',fontSize:22,lineHeight:1}}>{s.n}</div>
              <div className="muted mono" style={{fontSize:10,letterSpacing:'.18em',textTransform:'uppercase',marginTop:4}}>{s.r}</div>
            </div>
            <div style={{marginLeft:'auto',textAlign:'right'}}>
              <div style={{fontFamily:'var(--serif)',fontSize:28,lineHeight:1}}>★ {s.score}</div>
              <div className="muted mono" style={{fontSize:9}}>peer-reviewed</div>
            </div>
          </div>
          <div style={{marginTop:12}}>
            {[
              ['Pace under rush', .92],
              ['Cross-station help', .78],
              ['Guest sentiment lift', .85],
              ['Reliability', .96]
            ].map(([l,v])=>(
              <div key={l} style={{margin:'6px 0'}}>
                <div className="split" style={{fontSize:11}}><span>{l}</span><span className="mono">{Math.round(v*100)}</span></div>
                <div className="bar"><i style={{width:`${v*100}%`,background:v>.9?'var(--sage)':v>.8?'var(--ember)':'var(--brass)'}}/></div>
              </div>
            ))}
          </div>
          <div style={{display:'flex',gap:6,marginTop:12}}>
            <button className="btn xs">Open review</button>
            <button className="btn xs ghost">Gold star</button>
            <button className="btn xs ghost">1:1</button>
          </div>
          <div style={{marginTop:10,padding:10,background:'var(--paper-2)',borderRadius:3,fontSize:11,fontStyle:'italic',color:'var(--char)'}}>
            <span className="eyebrow" style={{color:'var(--ember-deep)'}}>LaRi note</span><br/>
            {s.r==='Sous chef' && 'Three back-to-back rushes handled with zero re-fires. Strong candidate for KP-lead.'}
            {s.r==='Bartender' && 'Prebatching pattern reduces set-break crunch by ~18%. Mentor to Kai.'}
            {s.r==='Expo'      && 'Pacing instincts good; allergen call-outs missed twice last week — coach.'}
            {s.r==='Server'    && 'Highest tip retention on patio; cross-trained for bar back next month.'}
            {!['Sous chef','Bartender','Expo','Server'].includes(s.r) && 'Steady. Logged 4 host-led save-the-night moments this period.'}
          </div>
        </div>
      ))}
    </div>
  </>);
}

function InvSnap(){
  const inv = window.LARIOS.inv;
  return (<>
    <div className="eyebrow">Inventory · equipment · order guide</div>
    <div className="title-xl" style={{margin:'6px 0 16px'}}>The pantry, <em>in real time</em></div>
    <div className="surface" style={{padding:18}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
        <thead><tr>{['SKU','Item','On hand','Par','Trend','Vendor','Status',''].map(h=>
          <th key={h} className="eyebrow" style={{textAlign:'left',padding:'8px 10px',borderBottom:'1px solid var(--hair)'}}>{h}</th>)}</tr></thead>
        <tbody>
          {inv.map(r=>(
            <tr key={r.sku}>
              <td className="mono" style={{padding:'10px',fontSize:11,color:'var(--muted)'}}>{r.sku}</td>
              <td style={{padding:10,fontWeight:600}}>{r.name}</td>
              <td className="mono" style={{padding:10}}>{r.oh} {r.unit}</td>
              <td className="mono" style={{padding:10}}>{r.par}</td>
              <td className="mono" style={{padding:10,color: r.trend==='down'?'var(--rust)':r.trend==='up'?'var(--sage)':'var(--muted)'}}>
                {r.trend==='down'?'▼':r.trend==='up'?'▲':'━'} {r.trend}
              </td>
              <td style={{padding:10,fontSize:12}}>{r.vendor}</td>
              <td style={{padding:10}}><span className={`pill ${r.stat}`}>{r.stat}</span></td>
              <td style={{padding:10}}><button className="btn xs">Order</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="grid g3" style={{marginTop:14}}>
      <div className="surface" style={{padding:16}}>
        <div className="eyebrow">LaRi suggested order · Mon</div>
        <ul style={{margin:'8px 0',paddingLeft:18,fontSize:13,lineHeight:1.7}}>
          <li>Wagyu hanger × 12 (Niman) — wedding 5/23 anchor</li>
          <li>Mezcal Mal de Amor × 6 — under par</li>
          <li>Heirloom tomato × 18 lb — Boggy Creek</li>
        </ul>
        <button className="btn primary sm">Approve & send</button>
      </div>
      <div className="surface" style={{padding:16}}>
        <div className="eyebrow">Equipment · status</div>
        {[['Range #2','OK','ok'],['Hood #3','Cleaning due','warn'],['Mixer · floor','OK','ok'],['Slicer · Avantco','Service log open','warn']].map(([n,s,c],i)=>(
          <div key={i} style={{display:'flex',gap:8,alignItems:'center',padding:'8px 0',borderBottom:'1px dashed var(--hair)'}}>
            <span className={`dot ${c}`}/><span style={{flex:1,fontSize:13}}>{n}</span><span className="mono muted" style={{fontSize:11}}>{s}</span>
          </div>
        ))}
      </div>
      <div className="surface" style={{padding:16}}>
        <div className="eyebrow">86 board</div>
        <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:8}}>
          {[['Halibut · COURSE 3','38 left',.55],['Wagyu hanger','84 left',.78],['Olive oil cake','full',.95]].map(([n,c,v],i)=>(
            <div key={i}>
              <div className="split" style={{fontSize:12}}><span>{n}</span><span className="mono muted">{c}</span></div>
              <div className="bar"><i style={{width:`${v*100}%`,background:v<.4?'var(--rust)':v<.7?'var(--brass)':'var(--sage)'}}/></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </>);
}

function HandbooksPanel(){
  const [book,setBook] = useStateM('recipe');
  const books = {
    recipe: { title:'Recipe book', sub:'40+ live recipes · photo-led', items:[
      ['Wagyu hanger','3:30 cook · medium-rare','105 plates 30d','#a04020'],
      ['Heirloom tomato I','plating · stracciatella','340 plates 30d','#7d4220'],
      ['Charred corn agnolotti','double pass · brown butter','220 plates 30d','#b8842f'],
      ['Olive oil cake','batch 24 · 45m','180 plates 30d','#9a6a30']
    ]},
    mix: { title:'Mixology', sub:'House cocktails · build cards', items:[
      ['The Calloway Cup','gin · lavender · cava','62 / hr','#a05030'],
      ['Tied the Knot','mezcal · ancho · grapefruit','48 / hr','#7a2510'],
      ['Honor Among Bees','bourbon · honey · sage','34 / hr','#a06a20'],
      ['Negroni Lariat','house','55 / hr','#9a2020']
    ]},
    emp: { title:'Employee handbook', sub:'Policies · scheduling · tips', items:[
      ['First-90 onboarding','3 modules','—','#5d7a66'],
      ['Tip-share policy','v3.2 · 2026','—','#3a5a7a'],
      ['Sexual harassment','annual · req.','—','#8b2e1f'],
      ['Uniform standards','BOH / FOH','—','#3a3530']
    ]},
    safe: { title:'Safety + HACCP', sub:'Temp logs · allergen matrix · drills', items:[
      ['Walk-in temp log','live · 32-38°F','OK','#5d7a66'],
      ['Allergen matrix','live · all menu','—','#b8892f'],
      ['Active shooter drill','last Q1 2026','passed','#8b2e1f'],
      ['Knife / slicer SOP','v2.1','—','#3a3530']
    ]}
  };
  const b = books[book];
  return (<>
    <div className="eyebrow">Living handbooks</div>
    <div className="title-xl" style={{margin:'6px 0 6px'}}>Knowledge that <em>doesn't gather dust</em>.</div>
    <div className="muted" style={{maxWidth:600,fontSize:13,lineHeight:1.5}}>Photo-led. Searchable. Updated by the people doing the work. LaRi watches for stale entries and offers rewrites.</div>
    <div className="tabs" style={{marginTop:18}}>
      {Object.entries(books).map(([k,v])=>(
        <button key={k} onClick={()=>setBook(k)} className={book===k?'on':''}>{v.title}</button>
      ))}
    </div>
    <div className="split" style={{marginTop:16}}>
      <div className="title-md">{b.title} <span className="muted" style={{fontSize:13,marginLeft:8}}>· {b.sub}</span></div>
      <div style={{display:'flex',gap:6}}>
        <input className="in" placeholder="Search…" style={{padding:'8px 10px',border:'1px solid var(--hair)',borderRadius:4,fontSize:12,width:200}}/>
        <button className="btn xs">＋ Upload photo</button>
        <button className="btn xs primary">＋ New entry</button>
      </div>
    </div>
    <div className="grid g4" style={{marginTop:14}}>
      {b.items.map((it,i)=>(
        <div key={i} className="surface lift" style={{padding:0,overflow:'hidden'}}>
          <div style={{height:140,background:`linear-gradient(135deg, ${it[3]} 0%, color-mix(in oklab, ${it[3]} 60%, #1d1a15) 100%)`,
            display:'flex',alignItems:'flex-end',padding:12,color:'#f3ece0',position:'relative'}}>
            <div style={{position:'absolute',top:10,right:10,fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.22em',color:'rgba(255,255,255,.55)',textTransform:'uppercase'}}>{book.toUpperCase()}</div>
            <div style={{fontFamily:'var(--serif)',fontSize:22,lineHeight:1.05}}>{it[0]}</div>
          </div>
          <div style={{padding:'10px 14px'}}>
            <div className="muted" style={{fontSize:11.5}}>{it[1]}</div>
            <div className="split" style={{marginTop:8}}>
              <span className="mono muted" style={{fontSize:10}}>{it[2]}</span>
              <button className="btn xs ghost">Open →</button>
            </div>
          </div>
        </div>
      ))}
      <button className="surface lift" style={{padding:0,minHeight:200,display:'flex',alignItems:'center',justifyContent:'center',
        flexDirection:'column',gap:6,borderStyle:'dashed',color:'var(--muted)'}}>
        <span style={{fontSize:32,fontFamily:'var(--serif)'}}>＋</span>
        <span className="eyebrow">Add entry · drop photo</span>
      </button>
    </div>
  </>);
}

function BanList(){
  const list = window.LARIOS.banlist;
  return (<>
    <div className="eyebrow">Trespass · 86'd patrons</div>
    <div className="title-xl" style={{margin:'6px 0 8px'}}>Not welcome <em>tonight</em>.</div>
    <div className="muted" style={{maxWidth:600,fontSize:13,lineHeight:1.5}}>Discreetly visible at the host stand, security tablet, and bartender. Photos are blurred unless tapped. LaRi flags any reservation that matches a name on the list.</div>
    <div className="split" style={{marginTop:18}}>
      <div style={{display:'flex',gap:6}}>
        <input className="in" placeholder="Search by name, date, reason…" style={{padding:'8px 10px',border:'1px solid var(--hair)',borderRadius:4,fontSize:12,width:280}}/>
        <button className="btn xs">Active only</button>
        <button className="btn xs ghost">Expired</button>
      </div>
      <button className="btn xs primary">＋ Add to list</button>
    </div>
    <div className="grid g2" style={{marginTop:14}}>
      {list.map(b=>(
        <div key={b.id} className="surface" style={{padding:16,display:'flex',gap:14}}>
          <div style={{width:88,height:108,background:'linear-gradient(135deg,#3a3530,#1d1a15)',color:'#ece2cf',
            display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'var(--serif)',fontSize:28,
            borderRadius:3,filter:'blur(2.5px)',position:'relative'}}>
            {b.photo}
            <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,.18)'}}/>
          </div>
          <div style={{flex:1}}>
            <div className="mono" style={{fontSize:10,color:'var(--muted)',letterSpacing:'.22em'}}>{b.id}</div>
            <div style={{fontFamily:'var(--serif)',fontSize:22,marginTop:4}}>{b.name}</div>
            <div className="muted" style={{fontSize:12,marginTop:6,lineHeight:1.5}}>{b.reason}</div>
            <div style={{display:'flex',gap:14,marginTop:10,fontFamily:'var(--mono)',fontSize:10,letterSpacing:'.16em',textTransform:'uppercase',color:'var(--muted)'}}>
              <span>· {b.length}</span><span>· issued {b.issued}</span><span>· by {b.by}</span>
            </div>
            <div style={{display:'flex',gap:6,marginTop:10}}>
              <button className="btn xs">Reveal photo</button>
              <button className="btn xs ghost">Incident report</button>
              <button className="btn xs ghost">Extend</button>
            </div>
          </div>
          <span className={`pill ${b.length==='Indefinite'?'alert':'warn'}`}>{b.length==='Indefinite'?'indef.':'active'}</span>
        </div>
      ))}
    </div>
  </>);
}

function CommsPanel(){
  return (<>
    <div className="eyebrow">Team comms</div>
    <div className="title-xl" style={{margin:'6px 0 16px'}}>One channel, <em>every shift</em>.</div>
    <div className="muted">LaRi summarizes thread activity per role. (placeholder)</div>
  </>);
}

window.MgmtCommand = MgmtCommand;
