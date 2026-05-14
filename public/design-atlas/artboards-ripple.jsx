// LaRiOS · Ripple Engine v2 — "The Night, Live"
// Drag any moment. Watch every surface recompute, see the pulses travel,
// see how tonight's whole timeline shifts, see the money and the risk move.

const { useState: useS, useEffect: useE, useRef: useR, useMemo } = React;

/* ── Scenarios (the knobs you can grab) ─────────────────────────── */
const SCENARIOS = [
  { id: 'cake',   label: 'Cake cut · retime',
    baseline: 21*60+30, current: 21*60+38, min: 21*60, max: 22*60+30, unit: 'min',
    origin: 'Stage call', color: '#e8784a' },
  { id: 'set1',   label: 'Set 1 · length',
    baseline: 45, current: 45, min: 30, max: 65, unit: 'min',
    origin: 'Stage', color: '#b8892f' },
  { id: 'covers', label: 'Walk-ins · headcount',
    baseline: 0,  current: 14, min: -10, max: 40, unit: 'guests',
    origin: 'Host stand', color: '#5d7a66' },
  { id: 'happy',  label: 'Happy-hour extension',
    baseline: 0,  current: 30, min: 0,  max: 90, unit: 'min',
    origin: 'Bar program', color: '#5b3a5a' }
];

function fmt(mins){
  let h=Math.floor(mins/60)%24,m=mins%60;const ap=h>=12?'PM':'AM';
  if(h>12)h-=12;if(h===0)h=12;return `${h}:${String(m).padStart(2,'0')} ${ap}`;
}
function clamp(x,a,b){return Math.max(a,Math.min(b,x));}

/* ── Tonight's baseline schedule (rendered on the timeline) ─────── */
const BASELINE_NIGHT = [
  { t: 17*60+30, label:'Doors open',       lane:'host' },
  { t: 18*60,    label:'Cocktail hour',    lane:'bar' },
  { t: 19*60,    label:'Patio seating',    lane:'host' },
  { t: 19*60+15, label:'Course I fire',    lane:'kitchen' },
  { t: 19*60+45, label:'Course II fire',   lane:'kitchen' },
  { t: 20*60+45, label:'Course III fire',  lane:'kitchen' },
  { t: 21*60+30, label:'Cake cut',         lane:'event' },
  { t: 21*60+30, label:'House dim 40%',    lane:'stage' },
  { t: 21*60+38, label:'Set 1 · downbeat', lane:'stage' },
  { t: 22*60+23, label:'Set break · bar surge', lane:'bar' },
  { t: 22*60+38, label:'Set 2 · downbeat', lane:'stage' },
  { t: 23*60+30, label:'Last call (kitchen)', lane:'kitchen' },
  { t: 23*60+30, label:'Shots cutoff',     lane:'bar' },
  { t: 24*60,    label:'Last call (bar)',  lane:'bar' },
  { t: 24*60+30, label:'Band load-out',    lane:'stage' }
];

const LANES = [
  ['host',    'Host',     '#a8c0ad'],
  ['kitchen', 'Kitchen',  '#e8784a'],
  ['bar',     'Bar',      '#b8892f'],
  ['stage',   'Stage',    '#5b3a5a'],
  ['event',   'Event',    '#e8a04a']
];

/* ── Domains around the pulse map ─────────────────────────────── */
const DOMAINS = [
  { id:'kitchen', name:'Kitchen',  angle: -90, dist: 240 },
  { id:'bar',     name:'Bar',      angle: -30, dist: 240 },
  { id:'host',    name:'Host',     angle: 30,  dist: 240 },
  { id:'stage',   name:'Stage',    angle: 90,  dist: 240 },
  { id:'inv',     name:'Inventory',angle: 150, dist: 240 },
  { id:'owner',   name:'Owner $',  angle: 210, dist: 240 }
];

/* ── Consequence engine ───────────────────────────────────────── */
function computeRipples(scenario, value){
  const d = value - scenario.baseline;
  const A = (sev,head,note,delta=0)=>({sev,head,note,delta});
  switch(scenario.id){
    case 'cake': return {
      kitchen: A(Math.abs(d)>5?'warn':'ok',
        `Course III fire ${fmt(20*60+45 + clamp(d,0,3))}`,
        d>5?`Hold halibut ${d-3}m at 140°. Plate at 9:${45+clamp(d,0,3)}.`
           :d<0?`Fire ${Math.abs(d)}m earlier — call line.`:'No change.', d),
      bar: A(Math.abs(d)>3?'warn':'ok',
        `Set-break surge ${fmt(22*60+23 + d)}`,
        d>0?`Prebatch +${Math.ceil(d/2)} Calloway Cups now.`:d<0?'Surge moves earlier.':'On schedule.', d),
      stage: A(d!==0?'live':'ok',
        `Set 1 ${fmt(21*60+38 + d)}`,
        d!==0?'Auto-notified band, FOH, lighting.':'No retiming.', d),
      host: A(d>10?'warn':'ok',
        d>10?`Floor wait +${d}m`:'Floor calm',
        d>10?'Comp 1 round to the rail.':'No guest impact.', d),
      inv: A('ok','Inventory steady','No additional draw.', 0),
      owner: A(d>25?'alert':'ok',
        d>25?`OT trigger · 3 servers · $${d*14}`:'No OT triggered',
        d>25?'Owner approval required.':'Within scheduled hours.',
        d>25?d*14:0)
    };
    case 'set1': return {
      bar: A(Math.abs(d)>8?'alert':'warn',
        `Set-break shifts ${d>=0?'+':''}${d}m`,
        d>8?'Open service well · call Tomas.':'Hana prebatches.', d),
      kitchen: A('ok','Course IV holds','Dessert plating decoupled.', 0),
      stage: A('live',`Set 1 ends ${fmt(22*60+23+d)}`,
        d>20?'Approaching 50-min policy after 10 PM.':'Within cap.', d),
      host: A(d>15?'warn':'ok',
        d>15?'Bar rail +28% load':'Floor calm',
        d>15?'Open patio overflow.':'No change.', d),
      inv: A(d>10?'warn':'ok',
        `Cava draw ${48+Math.max(0,d)}`,
        d>10?'Pull case from #2 walk-in.':'On par.', d),
      owner: A(d>0?'live':'ok',
        d>0?`Bar revenue +$${d*42}`:'Baseline revenue',
        d>0?'Extra glasses captured during overflow.':'—',
        d>0?d*42:0)
    };
    case 'covers': return {
      kitchen: A(d>20?'alert':d>10?'warn':'ok',
        d>20?`Halibut 86 risk in ${40-clamp(d,0,30)}m`:`Headroom ${clamp(100-d*2,40,100)}%`,
        d>20?'Pivot menu B to carrot agnolotti.':'Comfortable.', d),
      bar: A(d>15?'warn':'ok',
        `Throughput target ${Math.round(86 + d*2.1)}/hr`,
        d>15?'+1 floater bartender.':'Hana sustains 90s pours.', d),
      host: A(d>18?'alert':'ok',
        d>18?'Patio 96% capacity':`Used: ${clamp(72+d,40,100)}%`,
        d>18?'Cap walk-ins after 7:45.':'Comfortable.', d),
      stage: A('ok','No stage impact','Capacity decoupled.', 0),
      inv: A(d>15?'warn':'ok',
        `Cava draw ${Math.round(48 + d*1.4)}/48`,
        d>15?'Pull case from #2 walk-in.':'On par.', d),
      owner: A(d>0?'live':'ok',
        d>=0?`+$${d*94} revenue`:`-$${Math.abs(d)*94} revenue`,
        'Auto-rolls into weekly brief.',
        d*94)
    };
    case 'happy':
    default: return {
      bar: A(d>0?'live':'ok',
        `${d} min extra · ${Math.round(d*1.4)} extra drinks`,
        d>60?'Stress test — Hana solo.':'Comfortable margins.', d),
      kitchen: A(d>30?'warn':'ok',
        d>30?'Snack board demand +35%':'Normal flow',
        d>30?'Stage 2 boards at expo.':'No change.', d),
      host: A('ok','Patio dwell time +12 min','Comfortable.', 0),
      stage: A('ok','No impact','Set 1 unchanged.', 0),
      inv: A(d>45?'warn':'ok',
        d>45?'Olive draw at par':`Cava draw ${Math.round(48+d*0.8)}`,
        d>45?'Open case from pantry.':'On par.', d),
      owner: A(d>0?'live':'ok',
        `Bar revenue +$${Math.round(d*22)}`,
        'Food cost % steady. Margin neutral.',
        Math.round(d*22))
    };
  }
}

/* ── The main artboard ────────────────────────────────────────── */
function RippleEngine(){
  const [scenarioIdx, setScenarioIdx] = useS(0);
  const [values, setValues] = useS(SCENARIOS.map(s => s.current));
  const [tick, setTick] = useS(0);
  const scenario = SCENARIOS[scenarioIdx];
  const value = values[scenarioIdx];
  const delta = value - scenario.baseline;
  const pct = (value - scenario.min) / (scenario.max - scenario.min);

  useE(()=>{ setTick(t=>t+1); },[value, scenarioIdx]);

  // Keyboard shortcuts: 1-4 scenarios · ←/→ nudge · ⇧+arrow big step · R reset · 0 baseline · Space apply
  useE(()=>{
    const onKey = (ev)=>{
      if (ev.target && /input|textarea/i.test(ev.target.tagName)) return;
      const k = ev.key;
      if (k>='1' && k<='4') { setScenarioIdx(Number(k)-1); ev.preventDefault(); }
      else if (k==='ArrowLeft')  { setValue(clamp(value - (ev.shiftKey?5:1), scenario.min, scenario.max)); ev.preventDefault(); }
      else if (k==='ArrowRight') { setValue(clamp(value + (ev.shiftKey?5:1), scenario.min, scenario.max)); ev.preventDefault(); }
      else if (k==='0' || k==='r' || k==='R') { setValue(scenario.baseline); ev.preventDefault(); }
      else if (k===' ') { /* apply animation */ ev.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return ()=>window.removeEventListener('keydown', onKey);
  }, [value, scenario.min, scenario.max, scenario.baseline, scenarioIdx]);

  const setValue = v => setValues(vs => vs.map((x,i)=> i===scenarioIdx ? v : x));

  const ripples = useMemo(()=>computeRipples(scenario, value),[scenario.id, value]);

  // Total $ impact and risk score across all knobs (compound)
  const compound = useMemo(()=>{
    let dollars = 0, risk = 0, sev = 'ok';
    SCENARIOS.forEach((s,i)=>{
      const r = computeRipples(s, values[i]);
      Object.values(r).forEach(c=>{ dollars += c.delta && c.head.includes('$')? (c.delta>0?c.delta:0) : 0; });
      const owner = r.owner; if (owner && typeof owner.delta === 'number') dollars = dollars; // covered below
    });
    // Cleaner: just owner $ deltas from each scenario
    dollars = 0;
    SCENARIOS.forEach((s,i)=>{
      const r = computeRipples(s, values[i]);
      if (r.owner) dollars += (r.owner.delta || 0);
      Object.values(r).forEach(c=>{
        if (c.sev==='alert') { risk += 2; sev='alert'; }
        else if (c.sev==='warn' && sev!=='alert') { risk += 1; if (sev==='ok') sev='warn'; }
      });
    });
    return { dollars, risk, sev };
  }, [values]);

  return (
    <div data-screen-label="15 Ripple engine" style={{width:1920,height:1080,background:'var(--ink)',color:'var(--cream)',display:'flex',flexDirection:'column',position:'relative',overflow:'hidden',fontFamily:'var(--sans)'}}>
      <style>{`
        @keyframes ringPulse{ 0%{transform:scale(.4);opacity:.9} 100%{transform:scale(1.8);opacity:0} }
        @keyframes travelDot{ 0%{offset-distance:0%;opacity:0} 10%{opacity:1} 90%{opacity:1} 100%{offset-distance:100%;opacity:0} }
        @keyframes nodeFlash{ 0%,100%{box-shadow:0 0 0 0 currentColor} 50%{box-shadow:0 0 0 16px transparent} }
        @keyframes rippleIn{ 0%{opacity:0;transform:translateY(8px);background:rgba(232,120,74,.14)} 60%{opacity:1} 100%{opacity:1;transform:translateY(0);background:rgba(255,255,255,.03)} }
        @keyframes ghostShift{ from{stroke-dashoffset:0} to{stroke-dashoffset:-12} }
      `}</style>

      {/* BG */}
      <div style={{position:'absolute',inset:0,
        background:`
          radial-gradient(circle at 20% 0%, rgba(200,90,42,.16) 0%, transparent 50%),
          radial-gradient(circle at 90% 100%, rgba(91,58,90,.28) 0%, transparent 55%),
          repeating-linear-gradient(0deg, transparent 0 39px, rgba(255,255,255,.018) 39px 40px)
        `,pointerEvents:'none'}}/>

      {/* HEADER */}
      <div style={{padding:'20px 44px 16px',display:'flex',alignItems:'center',gap:18,position:'relative',zIndex:2,borderBottom:'1px solid rgba(255,255,255,.06)'}}>
        <window.LariSigil size={30}/>
        <div>
          <div style={{fontFamily:'var(--mono)',fontSize:10,letterSpacing:'.32em',color:'#e8a04a',whiteSpace:'nowrap'}}>15 · LARIOS · RIPPLE ENGINE</div>
          <div style={{fontFamily:'var(--serif)',fontSize:30,lineHeight:1}}>The night, <em style={{color:'#e8784a'}}>live</em>.</div>
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:6}}>
          {SCENARIOS.map((s,i)=>(
            <button key={s.id} onClick={()=>setScenarioIdx(i)} style={{
              padding:'10px 14px',
              background: i===scenarioIdx?'var(--ember)':'transparent',
              color: i===scenarioIdx?'#1a1308':'rgba(255,255,255,.55)',
              border:'1px solid '+(i===scenarioIdx?'var(--ember)':'rgba(255,255,255,.18)'),
              borderRadius:3,fontFamily:'var(--mono)',fontSize:10,letterSpacing:'.18em',cursor:'pointer',textTransform:'uppercase'}}>
              {s.id}
            </button>
          ))}
        </div>
        {/* Cumulative meter */}
        <div style={{display:'flex',gap:24,alignItems:'center',marginLeft:24,paddingLeft:24,borderLeft:'1px solid rgba(255,255,255,.1)'}}>
          <div style={{textAlign:'right'}}>
            <div style={{fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.22em',color:'rgba(255,255,255,.5)'}}>NET TONIGHT</div>
            <div style={{fontFamily:'var(--serif)',fontSize:30,lineHeight:1,color: compound.dollars>=0?'#a8c0ad':'#e8784a'}}>
              {compound.dollars>=0?'+':'−'}${Math.abs(Math.round(compound.dollars)).toLocaleString()}
            </div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.22em',color:'rgba(255,255,255,.5)'}}>RISK</div>
            <div style={{fontFamily:'var(--serif)',fontSize:30,lineHeight:1,color: compound.sev==='alert'?'#e8784a':compound.sev==='warn'?'#e8a04a':'#a8c0ad'}}>
              {compound.risk}<span style={{fontSize:14,color:'rgba(255,255,255,.4)',marginLeft:6,fontFamily:'var(--mono)',letterSpacing:'.16em'}}>PT</span>
            </div>
          </div>
        </div>
      </div>

      {/* THE KNOB */}
      <div style={{padding:'22px 44px 0',position:'relative',zIndex:2}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end'}}>
          <div>
            <div style={{fontFamily:'var(--mono)',fontSize:10,letterSpacing:'.28em',color:'rgba(255,255,255,.55)'}}>
              {scenario.label.toUpperCase()} · ORIGIN: {scenario.origin.toUpperCase()}
            </div>
            <div style={{fontFamily:'var(--serif)',fontSize:64,lineHeight:.9,marginTop:4,color:'var(--cream)'}}>
              {scenario.id==='cake' ? fmt(value)
                : scenario.unit==='min' ? `${value}:00`
                : (value>0?'+':'')+value}
              <span style={{fontSize:18,color:'rgba(255,255,255,.4)',marginLeft:12,fontFamily:'var(--mono)',letterSpacing:'.18em'}}>
                {delta===0?'BASELINE':(delta>0?'+':'')+delta+' '+scenario.unit.toUpperCase()}
              </span>
            </div>
          </div>
          <div style={{maxWidth:560,textAlign:'right'}}>
            <div style={{fontFamily:'var(--mono)',fontSize:10,letterSpacing:'.28em',color:'#e8a04a'}}>LARI · NARRATING</div>
            <div style={{fontFamily:'var(--serif)',fontSize:18,lineHeight:1.3,marginTop:4,color:'var(--cream)',fontStyle:'italic'}}>
              "{delta===0 ? `Holding ${scenario.label.toLowerCase()} at baseline. Tonight runs as planned.`
                : `That ${delta>0?'+':''}${delta}${scenario.unit==='min'?'m':''} touches ${Object.values(ripples).filter(r=>r.sev!=='ok').length} surfaces. Want me to apply?`}"
            </div>
          </div>
        </div>
        {/* Slider */}
        <div style={{position:'relative',height:50,marginTop:8}}>
          <div style={{position:'absolute',inset:'22px 0 22px 0',background:'rgba(255,255,255,.08)',borderRadius:2}}/>
          <div style={{position:'absolute',left:`${((scenario.baseline-scenario.min)/(scenario.max-scenario.min))*100}%`,top:14,bottom:14,width:2,background:'rgba(255,255,255,.45)',transform:'translateX(-1px)'}}/>
          <div style={{position:'absolute',
            left:`${Math.min(((scenario.baseline-scenario.min)/(scenario.max-scenario.min))*100, pct*100)}%`,
            right:`${100-Math.max(((scenario.baseline-scenario.min)/(scenario.max-scenario.min))*100, pct*100)}%`,
            top:24,height:4,background:scenario.color,borderRadius:2,boxShadow:`0 0 20px ${scenario.color}`}}/>
          <input type="range" min={scenario.min} max={scenario.max} value={value} onChange={e=>setValue(Number(e.target.value))}
            style={{position:'absolute',inset:'18px 0',width:'100%',opacity:0,cursor:'grab',height:14,margin:0}}/>
          <div style={{position:'absolute',left:`${pct*100}%`,top:10,width:28,height:28,background:scenario.color,borderRadius:'50%',transform:'translate(-50%,0)',boxShadow:`0 0 0 6px rgba(200,90,42,.22), 0 0 28px ${scenario.color}`,pointerEvents:'none'}}/>
        </div>
      </div>

      {/* TIMELINE — tonight's events with ghost-vs-shifted markers */}
      <div style={{padding:'8px 44px 0',position:'relative',zIndex:2}}>
        <Timeline scenario={scenario} value={value} delta={delta} tick={tick}/>
      </div>

      {/* CENTRAL: pulse map + ripple cards */}
      <div style={{flex:1,padding:'14px 44px 12px',position:'relative',zIndex:2,display:'grid',gridTemplateColumns:'520px 1fr',gap:24,minHeight:0}}>
        <PulseMap key={tick} scenario={scenario} ripples={ripples}/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gridTemplateRows:'1fr 1fr',gap:12}}>
          {DOMAINS.map((dom,i)=> (
            <RipplePanel key={dom.id+tick} domain={dom} r={ripples[dom.id]} delay={i*70} accent={scenario.color}/>
          ))}
        </div>
      </div>

      {/* Keyboard hint chip */}
      <div style={{position:'absolute',bottom:78,left:44,zIndex:3,display:'flex',gap:6,alignItems:'center',padding:'8px 12px',background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.08)',borderRadius:3,fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.22em',color:'rgba(255,255,255,.5)'}}>
        <kbd style={{padding:'2px 6px',background:'rgba(255,255,255,.06)',borderRadius:2,color:'#e8a04a'}}>1-4</kbd> SCENARIO
        <kbd style={{padding:'2px 6px',background:'rgba(255,255,255,.06)',borderRadius:2,color:'#e8a04a',marginLeft:8}}>← →</kbd> NUDGE
        <kbd style={{padding:'2px 6px',background:'rgba(255,255,255,.06)',borderRadius:2,color:'#e8a04a',marginLeft:8}}>⇧ + ← →</kbd> JUMP
        <kbd style={{padding:'2px 6px',background:'rgba(255,255,255,.06)',borderRadius:2,color:'#e8a04a',marginLeft:8}}>R</kbd> RESET
      </div>

      {/* FOOTER */}
      <div style={{padding:'10px 44px 16px',position:'relative',zIndex:2,display:'flex',justifyContent:'space-between',alignItems:'center',borderTop:'1px solid rgba(255,255,255,.06)'}}>
        <div style={{fontFamily:'var(--mono)',fontSize:10,letterSpacing:'.28em',color:'rgba(255,255,255,.4)'}}>
          ★ AGENTIC SIMULATION · COMPOUND ACROSS 4 KNOBS · NOTHING COMMITS UNTIL YOU APPLY
        </div>
        <div style={{display:'flex',gap:10}}>
          <button onClick={()=>setValues(SCENARIOS.map(s=>s.baseline))} style={{
            padding:'12px 18px',background:'transparent',color:'rgba(255,255,255,.65)',
            border:'1px solid rgba(255,255,255,.2)',borderRadius:3,fontFamily:'var(--mono)',fontSize:10,letterSpacing:'.18em',cursor:'pointer'}}>RESET ALL</button>
          <button onClick={()=>setValue(scenario.baseline)} style={{
            padding:'12px 18px',background:'transparent',color:'rgba(255,255,255,.65)',
            border:'1px solid rgba(255,255,255,.2)',borderRadius:3,fontFamily:'var(--mono)',fontSize:10,letterSpacing:'.18em',cursor:'pointer'}}>UNDO {scenario.id.toUpperCase()}</button>
          <button style={{
            padding:'12px 22px',background:'var(--ember)',color:'#1a1308',
            border:0,borderRadius:3,fontFamily:'var(--mono)',fontSize:11,letterSpacing:'.18em',cursor:'pointer',fontWeight:700,
            boxShadow:'0 0 30px rgba(232,120,74,.4)'}}>APPLY TO TONIGHT →</button>
        </div>
      </div>
    </div>
  );
}

/* ── Timeline ─────────────────────────────────────────────────── */
function Timeline({ scenario, value, delta, tick }){
  const start = 17*60+30, end = 25*60+30, span = end - start;
  // Shift events depending on scenario
  const shifted = BASELINE_NIGHT.map(e => {
    let dt = 0;
    if (scenario.id==='cake' && (e.label==='Cake cut' || e.label==='House dim 40%' || e.label==='Set 1 · downbeat' || e.label==='Set break · bar surge' || e.label==='Set 2 · downbeat')) dt = delta;
    if (scenario.id==='set1' && (e.label==='Set break · bar surge' || e.label==='Set 2 · downbeat')) dt = delta;
    return { ...e, baseT: e.t, t: e.t + dt };
  });
  return (
    <div style={{position:'relative',height:130,background:'rgba(255,255,255,.03)',border:'1px solid rgba(255,255,255,.07)',borderRadius:4,padding:'14px 18px'}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
        <div style={{fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.28em',color:'rgba(255,255,255,.5)'}}>TONIGHT · 5:30 PM → 1:30 AM</div>
        <div style={{display:'flex',gap:12}}>
          {LANES.map(([id,n,c])=>(
            <div key={id} style={{display:'flex',alignItems:'center',gap:5,fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.18em',color:'rgba(255,255,255,.55)'}}>
              <span style={{width:7,height:7,borderRadius:'50%',background:c}}/>{n.toUpperCase()}
            </div>
          ))}
        </div>
      </div>
      <div style={{position:'relative',height:74}}>
        {/* Lane rules */}
        {LANES.map(([id,_,c],i)=>(
          <div key={id} style={{position:'absolute',left:0,right:0,top:i*14+8,height:1,background:'rgba(255,255,255,.05)'}}/>
        ))}
        {/* Hour gridlines + labels */}
        {[18,19,20,21,22,23,24,25].map(h=>{
          const x = ((h*60 - start)/span)*100;
          return (
            <div key={h} style={{position:'absolute',left:`${x}%`,top:0,bottom:0,width:1,background:'rgba(255,255,255,.05)'}}>
              <div style={{position:'absolute',top:-2,left:4,fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.18em',color:'rgba(255,255,255,.35)'}}>
                {fmt(h*60).replace(':00 ','').replace(' ','')}
              </div>
            </div>
          );
        })}
        {/* Now marker */}
        <div style={{position:'absolute',left:`${((18*60+48-start)/span)*100}%`,top:0,bottom:0,width:2,background:'#e8784a',transform:'translateX(-1px)'}}>
          <div style={{position:'absolute',top:-4,left:-18,fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.18em',color:'#e8784a'}}>NOW</div>
        </div>
        {/* Events: baseline ghost + shifted */}
        {shifted.map((e,i)=>{
          const laneIdx = LANES.findIndex(([id])=>id===e.lane);
          const y = laneIdx*14+8;
          const baseX = ((e.baseT-start)/span)*100;
          const newX = ((e.t-start)/span)*100;
          const moved = e.t !== e.baseT;
          const color = LANES[laneIdx][2];
          return (
            <React.Fragment key={i}>
              {moved && (
                <>
                  {/* ghost baseline */}
                  <div style={{position:'absolute',left:`${baseX}%`,top:y-3,width:6,height:6,borderRadius:'50%',background:'transparent',border:'1px dashed rgba(255,255,255,.4)',transform:'translateX(-50%)'}}/>
                  {/* shift line */}
                  <svg style={{position:'absolute',left:0,top:0,right:0,bottom:0,pointerEvents:'none',width:'100%',height:'100%'}}>
                    <line x1={`${baseX}%`} y1={y} x2={`${newX}%`} y2={y}
                      stroke="#e8784a" strokeWidth="1" strokeDasharray="3 3"
                      style={{animation:'ghostShift 1.2s linear infinite'}}/>
                  </svg>
                </>
              )}
              <div style={{position:'absolute',left:`${newX}%`,top:y-4,transform:'translateX(-50%)',width:8,height:8,borderRadius:'50%',background:color,boxShadow: moved?`0 0 0 3px rgba(232,120,74,.35)`:'none'}}/>
              {/* label */}
              <div style={{position:'absolute',left:`${newX}%`,top:y+8,transform:'translateX(-50%)',whiteSpace:'nowrap',fontFamily:'var(--mono)',fontSize:8,letterSpacing:'.12em',color: moved?'#e8a04a':'rgba(255,255,255,.45)',
                display: i%2===0 || moved ? 'block':'none'}}>{e.label}</div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

/* ── Pulse map ────────────────────────────────────────────────── */
function PulseMap({ scenario, ripples }){
  const cx = 260, cy = 220;
  return (
    <div style={{position:'relative',background:'rgba(255,255,255,.025)',border:'1px solid rgba(255,255,255,.08)',borderRadius:4,overflow:'hidden'}}>
      <div style={{position:'absolute',top:14,left:18,fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.28em',color:'rgba(255,255,255,.55)'}}>PULSE MAP · CROSS-DOMAIN RIPPLE</div>
      <svg viewBox={`0 0 520 440`} style={{width:'100%',height:'100%'}}>
        <defs>
          <radialGradient id="origGlow"><stop offset="0%" stopColor={scenario.color} stopOpacity="0.7"/><stop offset="100%" stopColor={scenario.color} stopOpacity="0"/></radialGradient>
        </defs>
        {/* Concentric rings */}
        {[80,140,200].map((r,i)=>(
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,.05)" strokeDasharray="2 4"/>
        ))}
        {/* Origin glow */}
        <circle cx={cx} cy={cy} r="80" fill="url(#origGlow)"/>
        {/* Pulses */}
        {[0,1,2].map(i=>(
          <circle key={i} cx={cx} cy={cy} r="40" fill="none" stroke={scenario.color} strokeWidth="1.5"
            style={{transformOrigin:`${cx}px ${cy}px`,animation:`ringPulse 1.6s ease-out ${i*.5}s infinite`}}/>
        ))}
        {/* Origin label */}
        <circle cx={cx} cy={cy} r="28" fill={scenario.color}/>
        <text x={cx} y={cy-2} textAnchor="middle" fontFamily="var(--serif)" fontSize="14" fill="#1a1308" fontWeight="700">{scenario.id.toUpperCase()}</text>
        <text x={cx} y={cy+12} textAnchor="middle" fontFamily="var(--mono)" fontSize="8" letterSpacing="2" fill="#1a1308">ORIGIN</text>
        {/* Satellites */}
        {DOMAINS.map((d,i)=>{
          const rad = d.angle * Math.PI/180;
          const x = cx + Math.cos(rad)*180;
          const y = cy + Math.sin(rad)*150;
          const rip = ripples[d.id];
          const sev = rip?.sev || 'ok';
          const color = sev==='alert'?'#e8784a':sev==='warn'?'#e8a04a':sev==='live'?scenario.color:'#a8c0ad';
          return (
            <g key={d.id}>
              {/* path origin → satellite */}
              <path d={`M ${cx} ${cy} Q ${(cx+x)/2 + Math.cos(rad+1)*30} ${(cy+y)/2 + Math.sin(rad+1)*30} ${x} ${y}`}
                fill="none" stroke={color} strokeWidth={sev==='alert'?2:sev==='warn'?1.4:1} strokeOpacity={sev==='ok'?.25:.7} strokeDasharray={sev==='ok'?'2 6':'none'}/>
              {/* satellite */}
              <circle cx={x} cy={y} r="22" fill="rgba(20,18,14,.9)" stroke={color} strokeWidth="1.5"/>
              {sev!=='ok' && <circle cx={x} cy={y} r="22" fill="none" stroke={color} strokeWidth="1"
                style={{transformOrigin:`${x}px ${y}px`,animation:`ringPulse 1.8s ease-out infinite`}}/>}
              <text x={x} y={y-2} textAnchor="middle" fontFamily="var(--mono)" fontSize="8" letterSpacing="1.5" fill={color}>{d.name.toUpperCase()}</text>
              <text x={x} y={y+9} textAnchor="middle" fontFamily="var(--mono)" fontSize="7" fill="rgba(255,255,255,.5)" letterSpacing="1">{sev.toUpperCase()}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ── Ripple panel ─────────────────────────────────────────────── */
function RipplePanel({ domain, r, delay, accent }){
  if (!r) return null;
  const color = r.sev==='alert'?'#e8784a':r.sev==='warn'?'#e8a04a':r.sev==='live'?accent:'#a8c0ad';
  return (
    <div style={{
      background:'rgba(255,255,255,.03)',
      border:'1px solid rgba(255,255,255,.08)',
      borderLeft:`3px solid ${color}`,
      borderRadius:4,padding:'14px 16px',
      animation:`rippleIn .5s cubic-bezier(.2,.7,.3,1) ${delay}ms both`,
      display:'flex',flexDirection:'column',minHeight:0,overflow:'hidden'
    }}>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        <span style={{width:7,height:7,borderRadius:'50%',background:color}}/>
        <span style={{fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.26em',color:'rgba(255,255,255,.55)',textTransform:'uppercase'}}>{domain.name}</span>
        <span style={{marginLeft:'auto',fontFamily:'var(--mono)',fontSize:8.5,letterSpacing:'.22em',color,textTransform:'uppercase'}}>{r.sev}</span>
      </div>
      <div style={{fontFamily:'var(--serif)',fontSize:19,lineHeight:1.15,marginTop:8,color:'var(--cream)'}}>{r.head}</div>
      <div style={{fontSize:11.5,color:'rgba(255,255,255,.55)',marginTop:6,lineHeight:1.4,flex:1}}>{r.note}</div>
      <svg viewBox="0 0 200 22" style={{marginTop:6,width:'100%',height:22,opacity:.55}}>
        <polyline fill="none" stroke={color} strokeWidth="1.1"
          points={Array.from({length:24},(_,i)=>`${i*9},${11+Math.sin(i*0.5+delay/30)*5+(r.sev==='alert'?(i>16?-6:0):0)}`).join(' ')}/>
      </svg>
    </div>
  );
}

window.RippleEngine = RippleEngine;
