/* Pages — Entertainment / Music venue ops */
const DE = window.LARIAT_DATA.entertainment;
const { useState: uSE, useMemo: uME } = React;

// shared chrome — marquee strip used at top of event pages
function Marquee({ items }) {
  return (<div className="marquee">
    <div className="marquee-rail">
      {items.concat(items).map((t,i)=>(<span key={i} className="marquee-item">★ {t}</span>))}
    </div>
  </div>);
}

// ─── 4A. SOUND ENGINEER ───
function Sound() {
  const t = DE.tonight;
  const [hi, setHi] = uSE(null);
  return (<div className="page">
    <PageHead eyebrow={`Sound · Roan Bishop · ${t.date}`} title="Tonight:" em={t.artist}
      sub={`${t.genre} · doors ${t.doors} · set 1 ${t.set1} · set 2 ${t.set2} · curfew ${t.curfew}.`}
      actions={<><span className="pill warn">SPL limit {DE.splLimit} dB</span><button className="btn primary">Save scene</button></>}/>

    <div className="grid grid-4" style={{marginBottom:18}}>
      <KPI label="Channels live" value={DE.channels.length} sub="of 32 on console"/>
      <KPI label="Monitor mixes" value={DE.monitorMixes.length} sub="2 wedges · 2 IEM"/>
      <KPI label="Soundcheck" value="5:30 PM" sub="band on stage"/>
      <KPI label="Last peak" value="103 dB" sub="11:45 last show" tone="warn"/>
    </div>

    <div className="grid" style={{gridTemplateColumns:'1.1fr .9fr',gap:18,marginBottom:18}}>
      <div className="card"><div className="card-eyebrow"><span>Stage plot · {t.artist}</span><span>house left ← stage → house right</span></div>
        <svg viewBox="0 0 520 320" className="chart" style={{width:'100%',height:'auto'}}>
          <rect x="10" y="10" width="500" height="300" fill="var(--paper-2)" stroke="var(--hair)" rx="4"/>
          {/* upstage line */}
          <line x1="10" y1="60" x2="510" y2="60" stroke="var(--hair)" strokeDasharray="3 3"/>
          <text x="20" y="55" fontSize="9" fill="var(--muted)" letterSpacing="2">UPSTAGE</text>
          <line x1="10" y1="260" x2="510" y2="260" stroke="var(--hair)" strokeDasharray="3 3"/>
          <text x="20" y="275" fontSize="9" fill="var(--muted)" letterSpacing="2">DOWNSTAGE · APRON</text>

          {/* drum riser */}
          <rect x="220" y="80" width="100" height="80" fill="var(--paper)" stroke="var(--ember)" strokeWidth="1.5" strokeDasharray="2 2"/>
          <text x="270" y="98" fontSize="9" textAnchor="middle" fill="var(--muted)" letterSpacing="2">DRUM RISER · 4×8</text>
          <circle cx="270" cy="125" r="12" fill="none" stroke="var(--char)"/><text x="270" y="129" fontSize="8" textAnchor="middle">KIK</text>
          <circle cx="245" cy="115" r="5" fill="var(--ember)"/><text x="245" y="106" fontSize="7" textAnchor="middle">SN</text>
          <circle cx="295" cy="115" r="4" fill="var(--ember)"/><text x="295" y="106" fontSize="7" textAnchor="middle">HH</text>
          <circle cx="240" cy="92" r="3" fill="var(--ember)"/><text x="240" y="86" fontSize="7" textAnchor="middle">OH-L</text>
          <circle cx="300" cy="92" r="3" fill="var(--ember)"/><text x="300" y="86" fontSize="7" textAnchor="middle">OH-R</text>

          {/* bass SR */}
          <rect x="60" y="160" width="80" height="50" fill="none" stroke="var(--char)" strokeWidth="1.4"/>
          <text x="100" y="180" fontSize="9" textAnchor="middle">BASS · SVT</text>
          <circle cx="100" cy="200" r="3" fill="var(--ember)"/>
          <rect x="60" y="220" width="80" height="22" fill="var(--paper)" stroke="var(--char)"/>
          <text x="100" y="234" fontSize="8" textAnchor="middle">WEDGE · M1</text>

          {/* gtr SL */}
          <rect x="380" y="160" width="80" height="50" fill="none" stroke="var(--char)" strokeWidth="1.4"/>
          <text x="420" y="180" fontSize="9" textAnchor="middle">GTR · 2×12</text>
          <circle cx="420" cy="200" r="3" fill="var(--ember)"/>
          <rect x="380" y="220" width="80" height="22" fill="var(--paper)" stroke="var(--char)"/>
          <text x="420" y="234" fontSize="8" textAnchor="middle">WEDGE · M3</text>

          {/* pedal steel CSL */}
          <rect x="320" y="180" width="56" height="40" fill="none" stroke="var(--char)" strokeWidth="1.2"/>
          <text x="348" y="195" fontSize="8" textAnchor="middle">P. STEEL</text>
          <circle cx="348" cy="208" r="2" fill="var(--ember)"/>

          {/* lead vox center */}
          <circle cx="260" cy="220" r="5" fill="var(--ember-deep)"/>
          <text x="260" y="245" fontSize="9" textAnchor="middle" fill="var(--char)">VOX LD · IEM</text>

          {/* harm 2 SR */}
          <circle cx="170" cy="225" r="4" fill="var(--ember)"/>
          <text x="170" y="245" fontSize="8" textAnchor="middle">HARM 1</text>

          {/* fiddle SL */}
          <circle cx="350" cy="225" r="4" fill="var(--ember)"/>
          <text x="350" y="245" fontSize="8" textAnchor="middle">FIDDLE / HARM 2</text>

          {/* power tags */}
          <text x="20" y="300" fontSize="8" fill="var(--muted)" letterSpacing="2">POWER · 4× 20A · L1 SR · L2 SL · L3 RISER · L4 FOH</text>
        </svg>
      </div>

      <div className="card"><div className="card-eyebrow"><span>Channel sheet · {DE.channels.length} ch</span><span>hover · highlight on plot</span></div>
        <div style={{maxHeight:380,overflow:'auto'}}>
          <table className="tbl">
            <thead><tr><th>Ch</th><th>Source</th><th>Mic / DI</th><th>+48</th><th>Gate</th><th>Mix sends</th><th>Pan</th></tr></thead>
            <tbody>{DE.channels.map(c=>(
              <tr key={c.ch} onMouseEnter={()=>setHi(c.ch)} onMouseLeave={()=>setHi(null)}
                  style={{background:hi===c.ch?'rgba(217,117,87,.08)':'transparent',cursor:'crosshair'}}>
                <td className="mono">{c.ch}</td>
                <td><b>{c.src}</b></td>
                <td className="mono">{c.mic}</td>
                <td>{c.phantom?<span className="pill ok">+48</span>:<span className="row-meta">—</span>}</td>
                <td>{c.gate?<span className="pill">G</span>:'—'}</td>
                <td className="mono" style={{fontSize:11}}>{c.mix}</td>
                <td className="mono" style={{fontSize:11}}>{c.pan}{c.phase?' · ⌽':''}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div className="grid grid-2" style={{marginBottom:18}}>
      <div className="card"><div className="card-eyebrow"><span>Monitor world</span><span>4 mixes</span></div>
        <table className="tbl">
          <thead><tr><th>Mix</th><th>Who</th><th>Send notes</th><th>Level</th><th></th></tr></thead>
          <tbody>{DE.monitorMixes.map(m=>(<tr key={m.mix}>
            <td className="mono"><b>{m.mix}</b></td>
            <td>{m.who}</td>
            <td className="row-meta" style={{fontSize:12}}>{m.sends}</td>
            <td className="mono">{m.level}</td>
            <td>{m.iems?<span className="pill ok">IEM</span>:<span className="pill">wedge</span>}</td>
          </tr>))}</tbody>
        </table>
      </div>
      <div className="card"><div className="card-eyebrow"><span>FOH preset · scene 03</span><span>Bramble Hollow · saved 4:42 PM</span></div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',gap:6,marginTop:8}}>
          {DE.channels.slice(0,16).map(c=>(<div key={c.ch} style={{textAlign:'center'}}>
            <div className="row-meta" style={{fontSize:9,marginBottom:2}}>{c.src.split(' ')[0].slice(0,6)}</div>
            <div style={{position:'relative',height:64,background:'var(--paper-2)',border:'1px solid var(--hair)',borderRadius:2}}>
              <div style={{position:'absolute',left:0,right:0,bottom:0,height:`${30+Math.random()*55}%`,background:'linear-gradient(to top,var(--ember),var(--ember-deep))',opacity:.85}}/>
              <div style={{position:'absolute',left:0,right:0,top:'30%',borderTop:'1px dashed var(--hair)'}}/>
            </div>
            <div className="mono" style={{fontSize:9,marginTop:2}}>{(Math.random()*8-4).toFixed(1)}</div>
          </div>))}
        </div>
        <div className="row-meta" style={{marginTop:10}}>Scene auto-recalls when ticket scan opens at 8:30. Compressor on Vox Ld · 4:1 / -16dB.</div>
      </div>
    </div>

    <div className="card">
      <div className="card-eyebrow"><span>SPL trace · last show · 30-min Leq</span><span>limit {DE.splLimit} dB · annotations clickable</span></div>
      <div style={{position:'relative'}}>
        <LineChart data={DE.splTrace} getV={d=>d.v} getL={d=>d.t} w={1100} h={180}/>
        <div style={{display:'flex',gap:14,marginTop:6,flexWrap:'wrap'}}>
          {DE.splTrace.filter(p=>p.note).map(p=>(<div key={p.t} className="row-meta" style={{fontSize:11}}>
            <span className="mono">{p.t}</span> · {p.note} · <b>{p.v} dB</b>
          </div>))}
        </div>
      </div>
    </div>

    {/* RF / WIRELESS COORDINATION */}
    <div className="sec-head" style={{marginTop:24}}><div className="sec-title">RF coordination</div><div className="sec-sub">{DE.rfNotes}</div></div>
    <div className="grid" style={{gridTemplateColumns:'1.4fr 1fr',gap:18}}>
      <div className="card flush"><table className="tbl">
        <thead><tr><th>Unit</th><th>Brand</th><th>Freq · MHz</th><th>Group</th><th className="num">RSSI</th><th>Battery</th></tr></thead>
        <tbody>{DE.rf.map((r,i)=>(<tr key={i}>
          <td><b>{r.name}</b></td>
          <td className="row-meta">{r.brand}</td>
          <td className="mono">{r.freq}</td>
          <td className="mono">{r.group} · ch {r.ch}</td>
          <td className="num mono" style={{color:r.rssi>-55?'var(--char)':r.rssi>-65?'#a55':'var(--ember-deep)'}}>{r.rssi}</td>
          <td><div style={{width:60,height:10,background:'var(--paper-2)',border:'1px solid var(--hair)',borderRadius:2,position:'relative'}}>
            <div style={{position:'absolute',inset:'0 0 0 0',width:`${r.battery}%`,background:r.battery>50?'var(--char)':r.battery>25?'var(--ember)':'var(--ember-deep)'}}/>
          </div><span className="mono" style={{fontSize:11,marginLeft:6}}>{r.battery}%</span></td>
        </tr>))}</tbody>
      </table></div>
      <div className="card"><div className="card-eyebrow">Frequency map · 470-608 MHz</div>
        <svg viewBox="0 0 360 120" style={{width:'100%'}}>
          {/* TV ch 14-36 banding */}
          {[470,476,482,488,494,500,506,512,518,524,530,536,542,548,554,560,566,572,578,584,590,596,602].map((f,i)=>(
            <line key={i} x1={20+(f-470)*2.5} y1="20" x2={20+(f-470)*2.5} y2="80" stroke="var(--hair)" strokeWidth=".5"/>
          ))}
          <rect x={20+(516-470)*2.5} y="22" width={2.5*16} height="56" fill="var(--ember)" opacity=".15"/>
          <text x={20+(524-470)*2.5} y="98" fontSize="9" fill="var(--ember-deep)" textAnchor="middle">CH 21-22</text>
          {DE.rf.map((r,i)=>(<g key={i}>
            <line x1={20+(parseFloat(r.freq)-470)*2.5} x2={20+(parseFloat(r.freq)-470)*2.5} y1="22" y2="78" stroke="var(--ember-deep)" strokeWidth="2"/>
            <text x={20+(parseFloat(r.freq)-470)*2.5} y={32+i*8} fontSize="8" fill="var(--char)">{r.name.split(' ')[0]}</text>
          </g>))}
          <text x="20" y="14" fontSize="9" fill="var(--muted)">470</text>
          <text x="340" y="14" fontSize="9" fill="var(--muted)" textAnchor="end">608 MHz</text>
        </svg>
      </div>
    </div>

    {/* SETLIST CUES */}
    <div className="sec-head" style={{marginTop:24}}><div className="sec-title">Setlist cues</div><div className="sec-sub">passed by tour mgr · 7:42 PM</div></div>
    <div className="card flush"><table className="tbl">
      <thead><tr><th style={{width:48}}>#</th><th>Song</th><th>Tempo</th><th>Tuning</th><th>Lead instrument</th><th>FX cue</th></tr></thead>
      <tbody>
        <tr><td>1</td><td><b>Wagon Trail</b></td><td className="mono">122</td><td className="mono">Std</td><td>Acoustic</td><td>Reverb · plate-L</td></tr>
        <tr><td>2</td><td><b>Buffalo Coat</b></td><td className="mono">98</td><td className="mono">Drop D</td><td>Pedal steel solo @ 2:40</td><td>Slap delay on solo</td></tr>
        <tr><td>3</td><td><b>Same Old Saturday</b></td><td className="mono">144</td><td className="mono">Std</td><td>Twin gtrs · harmony</td><td>Stereo chorus</td></tr>
        <tr><td>4</td><td><b>Gravel & Pine</b></td><td className="mono">88</td><td className="mono">Open G</td><td>Fiddle break</td><td>Hall verb · 2.4s</td></tr>
        <tr><td>5</td><td><b>Ladybird Hollow</b></td><td className="mono">132</td><td className="mono">Std</td><td>Full band</td><td>Mute kick gate</td></tr>
        <tr><td colSpan="6" className="row-meta" style={{textAlign:'center',padding:'6px 0',fontSize:11,letterSpacing:'.16em'}}>… 6 more · full sheet on console</td></tr>
      </tbody>
    </table></div>
  </div>);
}

// ─── 4B. BOOKING & SETTLEMENT ───
function Booking() {
  const cal = DE.calendar;
  const pip = DE.pipeline;
  const set = DE.settlement;
  return (<div className="page">
    <PageHead eyebrow="Booking · Iris Holladay" title="The" em="calendar"
      sub="From inquiry to settlement. Every show, every dollar, every hold."
      actions={<><button className="btn">Open hold</button><button className="btn primary">+ New offer</button></>}/>

    <Marquee items={['11 confirmed · 4 holds · 3 open weekends through May','Bramble Hollow · 184 sold · 36 to sellout','Junior & The Aces · 212 sold · near sellout May 9','Coyote Standard settled · house net $584 · bar $3,142']}/>

    {/* PIPELINE FUNNEL */}
    <div className="sec-head"><div className="sec-title">Booking pipeline</div><div className="sec-sub">live count by stage</div></div>
    <div className="grid" style={{gridTemplateColumns:`repeat(${pip.length},1fr)`,gap:8,marginBottom:24}}>
      {pip.map((p,i)=>(<div key={p.stage} className="card" style={{padding:'12px 14px',position:'relative',background:i>=4?'var(--cream)':'var(--paper)'}}>
        <div className="row-meta" style={{fontSize:10,letterSpacing:'.16em'}}>STAGE {i+1}</div>
        <div className="serif" style={{fontSize:34,lineHeight:1,color:i>=4?'var(--ember-deep)':'var(--char)'}}>{p.count}</div>
        <div style={{fontWeight:600,marginTop:4}}>{p.stage}</div>
        <div className="row-meta" style={{fontSize:11,marginTop:6,minHeight:42}}>
          {p.recent.slice(0,2).map((r,j)=>(<div key={j}>· {r}</div>))}
        </div>
        {i<pip.length-1 && <div style={{position:'absolute',right:-6,top:'50%',transform:'translateY(-50%)',color:'var(--muted)',zIndex:2}}>›</div>}
      </div>))}
    </div>

    {/* CALENDAR GRID */}
    <div className="sec-head"><div className="sec-title">Five weeks ahead</div><div className="sec-sub">click a date to open the offer / settlement</div></div>
    <div className="card flush" style={{marginBottom:18}}>
      <table className="tbl">
        <thead><tr><th style={{width:90}}>Date</th><th>Artist</th><th>Genre</th><th className="num">Cap</th><th className="num">Sold</th><th>Sell-thru</th><th className="num">Price</th><th>Status</th><th></th></tr></thead>
        <tbody>{cal.map((b,i)=>{
          const pct = b.sold/b.cap;
          return (<tr key={i} style={b.status==='tonight'?{background:'rgba(217,117,87,.08)'}:{}}>
            <td className="mono"><b>{b.day}</b> {b.date}</td>
            <td><b>{b.artist}</b></td>
            <td className="row-meta">{b.genre}</td>
            <td className="num">{b.cap}</td>
            <td className="num">{b.sold||'—'}</td>
            <td><div style={{width:120,height:8,background:'var(--paper-2)',borderRadius:2,overflow:'hidden'}}>
              <div style={{width:`${pct*100}%`,height:'100%',background:pct>.9?'var(--ember-deep)':pct>.5?'var(--ember)':'var(--char)'}}/>
            </div></td>
            <td className="num mono">{b.price}</td>
            <td><span className={`pill ${b.status==='tonight'?'alert':b.status==='confirmed'||b.status==='near-sellout'?'ok':b.status==='hold'||b.status==='tentative'?'warn':b.status==='free'?'':b.status==='open'?'alert':''}`}>{b.status}</span></td>
            <td><button className="btn sm">Open</button></td>
          </tr>);
        })}</tbody>
      </table>
    </div>

    {/* SETTLEMENT — most recent show */}
    <div className="grid" style={{gridTemplateColumns:'1fr 1fr',gap:18}}>
      <div className="card"><div className="card-eyebrow"><span>Settlement · {set.artist}</span><span>{set.date} · {set.paid + set.walkup} paid + {set.comps} comp</span></div>
        <table className="tbl">
          <tbody>{set.rows.map((r,i)=>(<tr key={i} className={r.type==='tot'?'tot':r.type==='sub'?'grp':''}>
            <td>{r.label}{r.note?<span className="row-meta" style={{marginLeft:8,fontSize:11}}>· {r.note}</span>:''}</td>
            <td className="num" style={{color:r.amt<0?'var(--ember-deep)':'inherit',fontWeight:r.type==='tot'?700:400}}>
              {r.amt<0?'-$':'$'}{Math.abs(r.amt).toLocaleString()}
            </td>
          </tr>))}</tbody>
        </table>
        <div className="row-meta" style={{marginTop:10}}>Tour mgr signed · 12:48 AM · cash in office safe envelope #218</div>
      </div>

      <div className="card"><div className="card-eyebrow"><span>Offer template</span><span>auto-fills from artist card</span></div>
        <div style={{padding:'4px 0'}}>
          <div className="quote" style={{fontSize:16,marginBottom:14}}>To: <b>Marigold Tooth · Indie Folk</b></div>
          <table className="tbl"><tbody>
            <tr><td>Date</td><td className="mono">Sat May 03</td></tr>
            <tr><td>Cap / age</td><td className="mono">220 · 21+</td></tr>
            <tr><td>Set length</td><td className="mono">75 min · one set</td></tr>
            <tr><td>Doors / set</td><td className="mono">8:30 / 9:30</td></tr>
            <tr><td>Guarantee</td><td className="mono">$500</td></tr>
            <tr><td>Door split</td><td className="mono">70% over guar</td></tr>
            <tr><td>Sound buyout</td><td className="mono">$200</td></tr>
            <tr><td>Hospitality</td><td className="mono">Hot meal × 4 · greenroom</td></tr>
            <tr><td>Merch</td><td className="mono">100% to artist · no fee</td></tr>
            <tr><td>Marketing</td><td className="mono">House poster + 2 IG drops + email</td></tr>
          </tbody></table>
          <div style={{display:'flex',gap:8,marginTop:14}}>
            <button className="btn sm">Save draft</button>
            <button className="btn sm primary">Send offer</button>
          </div>
        </div>
      </div>
    </div>

    {/* AVAILS MATRIX */}
    <div className="sec-head" style={{marginTop:24}}><div className="sec-title">Avails matrix · next 4 weeks</div><div className="sec-sub">green = open · amber = hold · ember = booked</div></div>
    <div className="card flush" style={{marginBottom:18}}>
      <table className="tbl">
        <thead><tr><th></th><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Sat</th><th>Sun</th></tr></thead>
        <tbody>{DE.avails.map((w,i)=>(<tr key={i}>
          <td><b>{w.wk}</b></td>
          {['mon','tue','wed','thu','fri','sat','sun'].map(d=>{
            const v = w[d];
            const isOpen = v==='open';
            const isHold = v.includes('hold')||v.includes('tent');
            const isClosed = v==='closed';
            const bg = isOpen?'rgba(108,140,90,.18)':isHold?'rgba(217,117,87,.18)':isClosed?'var(--paper-2)':'rgba(154,63,26,.18)';
            return (<td key={d} style={{background:bg,fontSize:11,padding:'10px 8px',verticalAlign:'top'}}>
              <div style={{fontWeight:isOpen?400:600}}>{v}</div>
            </td>);
          })}
        </tr>))}</tbody>
      </table>
    </div>

    {/* CONTRACTS STATUS */}
    <div className="sec-head"><div className="sec-title">Contract pipeline</div><div className="sec-sub">performance agreement · W-9 · rider · deposit</div></div>
    <div className="card flush"><table className="tbl">
      <thead><tr><th>Show</th><th>Performance</th><th>W-9</th><th>Rider</th><th>Deposit</th><th>Status</th></tr></thead>
      <tbody>{DE.contracts.map((c,i)=>{
        const tag = (v)=>{
          if (v==='signed'||v==='on file'||v==='agreed'||v==='paid'||v==='complete') return <span className="pill ok">{v}</span>;
          if (v==='pending'||v==='in-review'||v==='requested') return <span className="pill warn">{v}</span>;
          if (v==='sent') return <span className="pill">{v}</span>;
          return <span className="row-meta">{v}</span>;
        };
        return (<tr key={i}>
          <td><b>{c.show}</b></td>
          <td>{tag(c.perf)}</td>
          <td>{tag(c.w9)}</td>
          <td>{tag(c.rider)}</td>
          <td>{tag(c.deposit)}</td>
          <td>{tag(c.status)}</td>
        </tr>);
      })}</tbody>
    </table></div>
  </div>);
}

// ─── 4C. STAGE / ROOM SETUP ───
function Stage() {
  const configs = [
    {n:'Listening Room · 220 std',desc:'Theater rows · all attention on stage',rows:'14 rows × 16 chairs · risers back third',people:'5 · 35 min',cap:220,best:'Singer-songwriters · acoustic acts'},
    {n:'Cabaret · 160',desc:'Tops of 4 with food/drink service',rows:'40× 4-tops · 32 in main · 8 mezz',people:'5 · 40 min',cap:160,best:'Jazz · soul · dinner shows'},
    {n:'Half-house · 180 std',desc:'Half-tops · half open floor',rows:'20× 4-tops front · standing back',people:'4 · 22 min',cap:180,best:'Folk-rock · 4-5 piece bands'},
    {n:'Dance Floor · 240 std',desc:'All standing · open dance pit',rows:'no tops · barrier 6\' from stage',people:'5 · 35 min',cap:240,best:'DJ sets · honky-tonk · loud shows'},
    {n:'Private Dining · 60',desc:'Long tables · stage dressed for ambiance',rows:'2× banquet rows · 30 each',people:'4 · 30 min',cap:60,best:'Rehearsal dinners · corp offsites'},
    {n:'Open Jam · 140 std',desc:'Sun nights · loose, mixed',rows:'12× tops floor · open bar zone',people:'3 · 18 min',cap:140,best:'Free Sunday sessions'},
  ];
  return (<div className="page">
    <PageHead eyebrow="Room setup · Mira C." title="Configurations" em="& load-in flow"
      sub="Six layouts. Every show maps to one. Changeover is choreographed."/>

    <div className="grid grid-3" style={{marginBottom:24}}>
      {configs.map(t=>(<div className="card" key={t.n}>
        <div className="card-eyebrow"><span>{t.n.split('·')[0].trim()}</span><span className="mono">cap {t.cap}</span></div>
        <div className="serif" style={{fontSize:22,marginTop:4,lineHeight:1.15}}>{t.desc}</div>
        <hr/>
        <div className="row-meta" style={{fontSize:12,marginBottom:6}}>{t.rows}</div>
        <div className="row-meta" style={{fontSize:12}}>Best for: <b style={{color:'var(--char)'}}>{t.best}</b></div>
        <div className="split" style={{marginTop:12}}>
          <span className="row-meta">Changeover</span>
          <span className="mono"><b>{t.people}</b></span>
        </div>
        <button className="btn sm" style={{marginTop:10}}>Open template</button>
      </div>))}
    </div>

    {/* RUN OF SHOW */}
    <div className="sec-head"><div className="sec-title">Tonight's run of show</div><div className="sec-sub">Bramble Hollow · half-house</div></div>
    <div className="card" style={{marginBottom:18}}>
      <div style={{display:'grid',gridTemplateColumns:'80px 1fr 200px',gap:0}}>
        {DE.runOfShow.map((r,i)=>{
          const isShow = r.what.includes('SET') || r.what.includes('Encore');
          const isCurfew = r.what.includes('Curfew') || r.what.includes('Settlement') || r.what.includes('Load-out');
          return (<React.Fragment key={i}>
            <div className="mono" style={{padding:'10px 8px',borderTop:i?'1px solid var(--hair)':'none',color:'var(--muted)',fontSize:12}}>{r.t}</div>
            <div style={{padding:'10px 12px',borderTop:i?'1px solid var(--hair)':'none',
                          background:isShow?'rgba(217,117,87,.06)':isCurfew?'var(--cream)':'transparent'}}>
              <div style={{fontWeight:isShow?700:500,color:isShow?'var(--ember-deep)':'inherit'}}>{r.what}</div>
            </div>
            <div className="row-meta" style={{padding:'10px 12px',borderTop:i?'1px solid var(--hair)':'none',fontSize:12}}>{r.who}</div>
          </React.Fragment>);
        })}
      </div>
    </div>

    {/* HOSPITALITY RIDER */}
    <div className="grid grid-2">
      <div className="card"><div className="card-eyebrow"><span>Hospitality rider · greenroom</span><span>cost ${DE.rider.hospitalityCost.toFixed(2)}</span></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
          <div>
            <div className="row-meta" style={{fontSize:11,marginBottom:6,letterSpacing:'.14em'}}>BEVERAGE</div>
            <ul style={{paddingLeft:18,margin:0,fontSize:13,lineHeight:1.7}}>{DE.rider.greenroom.map((g,i)=>(<li key={i}>{g}</li>))}</ul>
          </div>
          <div>
            <div className="row-meta" style={{fontSize:11,marginBottom:6,letterSpacing:'.14em'}}>FOOD & SERVICE</div>
            <ul style={{paddingLeft:18,margin:0,fontSize:13,lineHeight:1.7}}>{DE.rider.hospitality.map((g,i)=>(<li key={i}>{g}</li>))}</ul>
          </div>
        </div>
        <hr/>
        <div className="row-meta" style={{fontSize:12}}><b style={{color:'var(--ember-deep)'}}>Note · </b>{DE.rider.notes}</div>
      </div>
      <div className="card"><div className="card-eyebrow"><span>Tech rider</span><span>house provides</span></div>
        <ul style={{paddingLeft:18,margin:0,fontSize:13,lineHeight:1.8}}>{DE.rider.tech.map((g,i)=>(<li key={i}>{g}</li>))}</ul>
        <hr/>
        <div className="row-meta" style={{fontSize:11,marginBottom:6,letterSpacing:'.14em'}}>TRANSPORT & PARKING</div>
        <table className="tbl"><tbody>
          <tr><td>Vehicle</td><td className="mono">{DE.tonight.transport}</td></tr>
          <tr><td>Parking</td><td className="mono">{DE.tonight.parking}</td></tr>
          <tr><td>Tour mgr</td><td className="mono">{DE.tonight.contact.mgr} · {DE.tonight.contact.phone}</td></tr>
        </tbody></table>
      </div>
    </div>

    {/* CHANGEOVER GANTT — half-house build */}
    <div className="sec-head" style={{marginTop:24}}><div className="sec-title">Changeover · half-house build</div><div className="sec-sub">22 minutes · 4 staff · color = task</div></div>
    <div className="card">
      {(() => {
        const tasks = [
          {who:'Mira',color:'var(--ember-deep)',rows:[
            {l:'Strike 8× 4-tops',s:0,d:6},
            {l:'Set barrier',s:6,d:3},
            {l:'Quick floor sweep',s:14,d:4},
          ]},
          {who:'Jules',color:'var(--ember)',rows:[
            {l:'Pull tops to storage',s:0,d:7},
            {l:'Re-set bar zone',s:8,d:6},
            {l:'House lights to half',s:18,d:2},
          ]},
          {who:'Roan',color:'var(--char)',rows:[
            {l:'Power up FOH',s:2,d:3},
            {l:'Recall scene 03',s:6,d:1},
            {l:'Line check',s:9,d:8},
          ]},
          {who:'Theo',color:'#7a4a2e',rows:[
            {l:'Greenroom check + restock',s:0,d:5},
            {l:'Hot meal delivered',s:5,d:3},
            {l:'Door podium set',s:12,d:6},
          ]},
        ];
        const max = 22;
        return (<div>
          {/* time axis */}
          <div style={{display:'grid',gridTemplateColumns:'80px 1fr',gap:8,marginBottom:6}}>
            <div></div>
            <div style={{position:'relative',height:18}}>
              {[0,5,10,15,20].map(m=>(<div key={m} style={{position:'absolute',left:`${m/max*100}%`,fontSize:10,fontFamily:'JetBrains Mono,monospace',color:'var(--muted)',transform:'translateX(-50%)'}}>{m}m</div>))}
            </div>
          </div>
          {tasks.map(t=>(<div key={t.who} style={{display:'grid',gridTemplateColumns:'80px 1fr',gap:8,alignItems:'center',marginBottom:6}}>
            <div style={{fontWeight:600,fontSize:12}}>{t.who}</div>
            <div style={{position:'relative',height:30,background:'var(--paper-2)',borderRadius:2}}>
              {t.rows.map((r,i)=>(<div key={i} title={r.l} style={{
                position:'absolute',left:`${r.s/max*100}%`,width:`${r.d/max*100}%`,
                top:3,bottom:3,background:t.color,borderRadius:2,padding:'0 6px',
                color:'var(--paper)',fontSize:11,display:'flex',alignItems:'center',whiteSpace:'nowrap',overflow:'hidden'
              }}>{r.l}</div>))}
            </div>
          </div>))}
        </div>);
      })()}
    </div>

    {/* HOUSE EQUIPMENT INVENTORY */}
    <div className="sec-head" style={{marginTop:24}}><div className="sec-title">House equipment</div><div className="sec-sub">{DE.inventory.length} items · last audit Apr 02</div></div>
    <div className="grid" style={{gridTemplateColumns:'1.2fr 1fr',gap:18}}>
      <div className="card flush"><table className="tbl">
        <thead><tr><th>Item</th><th className="num">Qty</th><th>Location</th><th>Condition</th></tr></thead>
        <tbody>{DE.inventory.slice(0,8).map((it,i)=>(<tr key={i}>
          <td><b>{it.item}</b></td>
          <td className="num">{it.qty}</td>
          <td className="row-meta">{it.location}</td>
          <td className="row-meta">{it.condition}{it.note?<span style={{color:'var(--ember-deep)'}}> · {it.note}</span>:''}</td>
        </tr>))}</tbody>
      </table></div>
      <div className="card flush"><table className="tbl">
        <thead><tr><th>Item</th><th className="num">Qty</th><th>Location</th><th>Condition</th></tr></thead>
        <tbody>{DE.inventory.slice(8).map((it,i)=>(<tr key={i}>
          <td><b>{it.item}</b></td>
          <td className="num">{it.qty}</td>
          <td className="row-meta">{it.location}</td>
          <td className="row-meta">{it.condition}{it.note?<span style={{color:'var(--ember-deep)'}}> · {it.note}</span>:''}</td>
        </tr>))}</tbody>
      </table></div>
    </div>
  </div>);
}

// ─── 4D. BOX OFFICE ───
function BoxOffice() {
  const t = DE.tonight;
  const wc = DE.willCall;
  const comps = DE.comps;
  const totalComps = comps.reduce((a,c)=>a+c.qty,0);
  const [filter, setFilter] = uSE('all');
  const filteredWC = wc.filter(w=>filter==='all'||(filter==='checked'&&w.checkedIn)||(filter==='waiting'&&!w.checkedIn));
  return (<div className="page">
    <PageHead eyebrow={`Box office · ${t.date}`} title="Tonight at" em="the door"
      sub={`${t.sold} sold of ${t.cap} · ${t.cap-t.sold} remaining · presale ${t.presale} · walkup target ${t.walkupTarget}.`}
      actions={<><span className="pill ok">Scanner online</span><button className="btn primary">Open doors</button></>}/>

    <div className="grid grid-4" style={{marginBottom:18}}>
      <KPI label="Sold" value={t.sold} sub={`${Math.round(t.sold/t.cap*100)}% of cap`} tone="up"/>
      <KPI label="Remaining" value={t.cap-t.sold} sub={`presale @ $${t.presalePrice} · door @ $${t.doorPrice}`}/>
      <KPI label="Comps allotted" value={totalComps} sub={`${comps.length} guest list lines`}/>
      <KPI label="Gross to date" value={`$${(t.presale*t.presalePrice).toLocaleString()}`} sub="presale only" tone="up"/>
    </div>

    {/* SALES CURVE */}
    <div className="grid" style={{gridTemplateColumns:'2fr 1fr',gap:18,marginBottom:18}}>
      <div className="card"><div className="card-eyebrow"><span>Ticket curve · 21-day window</span><span>cap line at {t.cap}</span></div>
        <svg viewBox="0 0 800 240" style={{width:'100%',height:'auto'}}>
          {/* cap line */}
          <line x1="40" y1="40" x2="780" y2="40" stroke="var(--ember-deep)" strokeDasharray="4 4" strokeWidth="1"/>
          <text x="780" y="36" fontSize="10" textAnchor="end" fill="var(--ember-deep)">cap {t.cap}</text>
          {/* breakeven line */}
          <line x1="40" y1="80" x2="780" y2="80" stroke="var(--char)" strokeDasharray="2 4" strokeWidth="1" opacity=".5"/>
          <text x="780" y="76" fontSize="10" textAnchor="end" fill="var(--muted)">breakeven 168</text>
          {/* curve */}
          {(() => {
            const pts = DE.ticketCurve.map((p,i)=>{
              const x = 40 + (i/(DE.ticketCurve.length-1))*740;
              const y = 220 - (p.sold/220)*180;
              return [x,y,p];
            });
            const path = pts.map((p,i)=>`${i?'L':'M'} ${p[0]} ${p[1]}`).join(' ');
            const area = path + ` L 780 220 L 40 220 Z`;
            return (<g>
              <path d={area} fill="var(--ember)" opacity=".15"/>
              <path d={path} fill="none" stroke="var(--ember-deep)" strokeWidth="2"/>
              {pts.map((p,i)=>(<g key={i}>
                <circle cx={p[0]} cy={p[1]} r="3.5" fill="var(--ember-deep)"/>
                <text x={p[0]} y="234" fontSize="9" textAnchor="middle" fill="var(--muted)">{p[2].d===0?'today':`${p[2].d}d`}</text>
              </g>))}
              <text x={pts[pts.length-1][0]} y={pts[pts.length-1][1]-10} fontSize="11" textAnchor="end" fill="var(--char)" fontWeight="700">{pts[pts.length-1][2].sold}</text>
            </g>);
          })()}
        </svg>
      </div>
      <div className="card"><div className="card-eyebrow"><span>Mix tonight</span><span>184 sold</span></div>
        {(() => {
          const ps = DE.promo.presaleSplit;
          const total = ps.presale+ps.walkup+ps.comps;
          return (<svg viewBox="0 0 200 200" style={{width:'80%',display:'block',margin:'0 auto'}}>
            {(() => {
              let acc = 0;
              const segs = [
                {l:'Presale',v:ps.presale,c:'var(--ember-deep)'},
                {l:'Walkup proj.',v:ps.walkup,c:'var(--ember)'},
                {l:'Comps',v:ps.comps,c:'var(--char)'},
              ];
              return segs.map((s,i)=>{
                const start = acc/total*Math.PI*2 - Math.PI/2;
                acc += s.v;
                const end = acc/total*Math.PI*2 - Math.PI/2;
                const large = end-start>Math.PI?1:0;
                const r=80, cx=100, cy=100;
                const x1=cx+Math.cos(start)*r, y1=cy+Math.sin(start)*r;
                const x2=cx+Math.cos(end)*r, y2=cy+Math.sin(end)*r;
                return <path key={i} d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`} fill={s.c}/>;
              });
            })()}
            <circle cx="100" cy="100" r="48" fill="var(--paper)"/>
            <text x="100" y="96" fontSize="11" textAnchor="middle" fill="var(--muted)" letterSpacing="2">PROJ</text>
            <text x="100" y="116" fontSize="22" textAnchor="middle" fill="var(--ember-deep)" fontFamily="Instrument Serif, serif">{total}</text>
          </svg>);
        })()}
        <div style={{display:'flex',justifyContent:'center',gap:14,marginTop:8,flexWrap:'wrap'}}>
          <span className="row-meta"><b style={{color:'var(--ember-deep)'}}>■</b> Presale 142</span>
          <span className="row-meta"><b style={{color:'var(--ember)'}}>■</b> Walkup 42</span>
          <span className="row-meta"><b style={{color:'var(--char)'}}>■</b> Comps 18</span>
        </div>
      </div>
    </div>

    {/* WILL-CALL + COMPS */}
    <div className="grid" style={{gridTemplateColumns:'1.4fr 1fr',gap:18}}>
      <div className="card flush">
        <div style={{padding:'12px 16px',borderBottom:'1px solid var(--hair)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div className="card-eyebrow" style={{padding:0,margin:0}}><span>Will-call list</span></div>
            <div className="row-meta" style={{fontSize:12,marginTop:2}}>{wc.filter(w=>w.checkedIn).length} of {wc.length} checked in</div>
          </div>
          <div style={{display:'flex',gap:6}}>
            {['all','waiting','checked'].map(f=>(<button key={f} className={`btn sm ${filter===f?'primary':''}`} onClick={()=>setFilter(f)}>{f}</button>))}
          </div>
        </div>
        <table className="tbl">
          <thead><tr><th>Name</th><th className="num">Qty</th><th>ID</th><th>Paid</th><th></th><th>Note</th></tr></thead>
          <tbody>{filteredWC.map(w=>(<tr key={w.id} style={w.checkedIn?{opacity:.55}:{}}>
            <td><b>{w.name}</b></td>
            <td className="num">{w.qty}</td>
            <td className="mono" style={{fontSize:11}}>{w.id}</td>
            <td>{w.paid?<span className="pill ok">paid</span>:<span className="pill alert">door</span>}</td>
            <td>{w.checkedIn?<span className="pill">✓ in</span>:<button className="btn sm">scan</button>}</td>
            <td className="row-meta" style={{fontSize:11}}>{w.note||''}</td>
          </tr>))}</tbody>
        </table>
      </div>

      <div className="card"><div className="card-eyebrow"><span>Guest list · comps</span><span>{totalComps} total</span></div>
        <table className="tbl">
          <tbody>{comps.map((c,i)=>(<tr key={i}>
            <td><b>{c.who}</b><br/><span className="row-meta" style={{fontSize:11}}>{c.reason||c.for}</span></td>
            <td className="num"><span className="pill" style={{fontSize:11}}>{c.qty}</span></td>
          </tr>))}</tbody>
        </table>
        <hr/>
        <div className="quote" style={{fontSize:14}}>Comp policy: 8% of paid attendance, capped at 24. <b>Currently 18 / 24.</b></div>
      </div>
    </div>

    {/* WALKUP HOUR-BY-HOUR */}
    <div className="sec-head" style={{marginTop:24}}><div className="sec-title">Door pace · 15-min cohorts</div><div className="sec-sub">walkups since door open · target 42 by show start</div></div>
    <div className="card">
      {(() => {
        const w = DE.walkupHourly;
        const max = Math.max(...w.map(x=>x.cum));
        return (<div style={{display:'grid',gridTemplateColumns:`repeat(${w.length},1fr)`,gap:8}}>
          {w.map((p,i)=>(<div key={i} style={{textAlign:'center'}}>
            <div style={{height:160,position:'relative',background:'var(--paper-2)',borderRadius:2,overflow:'hidden'}}>
              <div style={{position:'absolute',left:0,right:0,bottom:0,height:`${p.cum/max*100}%`,background:'linear-gradient(to top,var(--ember),var(--ember-deep))'}}/>
              <div style={{position:'absolute',top:6,left:0,right:0,fontFamily:'Instrument Serif,serif',fontSize:18,color:'var(--paper)',mixBlendMode:'difference'}}>{p.cum}</div>
            </div>
            <div className="mono" style={{fontSize:10,marginTop:4}}>{p.h}</div>
            <div className="row-meta" style={{fontSize:10}}>+{p.ratePer15}</div>
          </div>))}
        </div>);
      })()}
      <hr/>
      <div className="row-meta" style={{fontSize:12}}>Pace cooled after 9:30 · expected (set started). <b>0 walkups since 9:45.</b> Door close at 11:30 unless surge.</div>
    </div>

    {/* COMP POLICY DETAIL */}
    <div className="grid grid-3" style={{marginTop:18}}>
      <div className="card"><div className="card-eyebrow">Refund window</div>
        <div className="serif" style={{fontSize:36}}>0 today</div>
        <div className="row-meta" style={{marginTop:4}}>72-hour rule · all settled</div>
      </div>
      <div className="card"><div className="card-eyebrow">No-shows</div>
        <div className="serif" style={{fontSize:36}}>~14 est.</div>
        <div className="row-meta" style={{marginTop:4}}>~7.6% · within band 5-12%</div>
      </div>
      <div className="card"><div className="card-eyebrow">Scanner queue</div>
        <div className="serif" style={{fontSize:36}}>0</div>
        <div className="row-meta" style={{marginTop:4}}>moved through 184 in 47 min</div>
      </div>
    </div>
  </div>);
}

// ─── 4E. PROMO / MARKETING ───
function Promo() {
  const t = DE.tonight;
  const p = DE.promo;
  return (<div className="page">
    <PageHead eyebrow={`Promo · ${t.artist}`} title="Selling" em="the show"
      sub={`Poster · social · radio · partners. Budget guardrails: $400/show standard, $1,200/show flagship.`}
      actions={<><span className="pill ok">Poster v3 final</span><button className="btn primary">Schedule drop</button></>}/>

    <div className="grid grid-4" style={{marginBottom:18}}>
      <KPI label="Total reach" value={p.socialDrops.reduce((a,d)=>a+d.reach,0).toLocaleString()} sub="6 drops · 14 days"/>
      <KPI label="Click-thru" value={p.socialDrops.reduce((a,d)=>a+d.clicks,0).toLocaleString()} sub="to ticketing"/>
      <KPI label="Radio spots" value={p.radio.reduce((a,r)=>a+r.spots,0)} sub={`${p.radio.length} stations`}/>
      <KPI label="Posters out" value={`${p.postersOut} / ${p.posterPosted+p.postersOut}`} sub="6 routes covered"/>
    </div>

    <div className="grid" style={{gridTemplateColumns:'1fr 1.4fr',gap:18,marginBottom:18}}>
      {/* MOCK POSTER */}
      <div className="card" style={{padding:0,overflow:'hidden'}}>
        <div className="card-eyebrow" style={{padding:'10px 14px'}}><span>Show poster · v3</span><span>11×17 · 4-color</span></div>
        <div style={{aspectRatio:'11/17',background:'var(--char)',color:'var(--paper)',padding:'24px 22px',display:'flex',flexDirection:'column',position:'relative',overflow:'hidden'}}>
          <div style={{position:'absolute',inset:0,background:'radial-gradient(circle at 30% 20%, rgba(217,117,87,.4), transparent 60%)'}}/>
          <div style={{position:'relative',fontSize:10,letterSpacing:'.32em',color:'var(--ember)',marginBottom:6}}>★ LARIAT PRESENTS ★</div>
          <div style={{position:'relative',fontFamily:'Instrument Serif, serif',fontSize:46,lineHeight:1,fontWeight:400,marginBottom:8}}>The Bramble<br/>Hollow</div>
          <div style={{position:'relative',fontSize:11,letterSpacing:'.18em',color:'var(--ember)',marginBottom:14}}>— ALT-COUNTRY · FIVE PIECE —</div>
          <div style={{position:'relative',flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>
            <div style={{width:120,height:120,borderRadius:'50%',background:'linear-gradient(135deg,var(--ember-deep),var(--ember))',opacity:.85,boxShadow:'0 0 40px rgba(217,117,87,.5)'}}/>
          </div>
          <div style={{position:'relative',marginTop:'auto'}}>
            <div style={{fontFamily:'Instrument Serif, serif',fontSize:30,lineHeight:1}}>Sat · Apr 25</div>
            <div style={{fontSize:11,letterSpacing:'.18em',marginTop:4,opacity:.85}}>DOORS 8:30 · SHOW 9:30 · $12 ADV / $15 DOOR</div>
            <div style={{fontSize:10,letterSpacing:'.22em',marginTop:14,color:'var(--ember)',borderTop:'1px solid rgba(217,117,87,.3)',paddingTop:10}}>LARIAT · 1819 ALAMO ST · 21+</div>
          </div>
        </div>
      </div>

      <div>
        {/* DROP SCHEDULE */}
        <div className="card" style={{marginBottom:14}}><div className="card-eyebrow"><span>Drop schedule · social</span><span>last 21d</span></div>
          <table className="tbl">
            <thead><tr><th>When</th><th>Channel</th><th className="num">Reach</th><th className="num">Clicks</th><th>CTR</th></tr></thead>
            <tbody>{p.socialDrops.map((d,i)=>{
              const ctr = (d.clicks/d.reach*100).toFixed(1);
              return (<tr key={i}>
                <td className="mono">{d.when}</td>
                <td><b>{d.channel}</b></td>
                <td className="num">{d.reach.toLocaleString()}</td>
                <td className="num">{d.clicks}</td>
                <td className="num">{ctr}%</td>
              </tr>);
            })}</tbody>
          </table>
        </div>
        {/* RADIO + PARTNERS */}
        <div className="grid grid-2">
          <div className="card"><div className="card-eyebrow">Radio</div>
            <table className="tbl"><tbody>{p.radio.map((r,i)=>(<tr key={i}>
              <td><b>{r.station}</b></td>
              <td className="num">{r.spots} spots</td>
              <td className="row-meta" style={{fontSize:11}}>{r.rotation}</td>
            </tr>))}</tbody></table>
            <hr/>
            <div className="row-meta" style={{fontSize:11}}>Spin-trade: 2 comps to KUTX morning host · already in box-office list.</div>
          </div>
          <div className="card"><div className="card-eyebrow">Partner trades</div>
            {p.partners.map((pa,i)=>(<div key={i} style={{padding:'8px 0',borderBottom:i<p.partners.length-1?'1px solid var(--hair)':'none'}}>
              <div style={{fontWeight:600}}>{pa.partner}</div>
              <div className="row-meta" style={{fontSize:11}}>{pa.type} · {pa.value}</div>
            </div>))}
          </div>
        </div>
      </div>
    </div>

    {/* SOCIAL FOOTPRINT */}
    <div className="card">
      <div className="card-eyebrow"><span>Artist footprint · {t.artist}</span><span>at offer time</span></div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:24,marginTop:8}}>
        <div><div className="row-meta" style={{fontSize:11,letterSpacing:'.16em'}}>INSTAGRAM</div><div className="serif" style={{fontSize:32}}>{t.socials.ig}</div></div>
        <div><div className="row-meta" style={{fontSize:11,letterSpacing:'.16em'}}>FACEBOOK</div><div className="serif" style={{fontSize:32}}>{t.socials.fb}</div></div>
        <div><div className="row-meta" style={{fontSize:11,letterSpacing:'.16em'}}>SPOTIFY · MO LISTENERS</div><div className="serif" style={{fontSize:32}}>{t.socials.spotifyMonthly}</div></div>
        <div><div className="row-meta" style={{fontSize:11,letterSpacing:'.16em'}}>LOCAL DRAW · LAST VISIT</div><div className="serif" style={{fontSize:32}}>184</div></div>
      </div>
    </div>

    {/* CAMPAIGN BUDGET */}
    <div className="sec-head" style={{marginTop:24}}><div className="sec-title">Campaign budget · {t.artist}</div><div className="sec-sub">flagship show · plan ${DE.promoBudget.plan} · spent ${DE.promoBudget.spent}</div></div>
    <div className="grid" style={{gridTemplateColumns:'1fr 1fr',gap:18}}>
      <div className="card"><div className="card-eyebrow">Spend by lever</div>
        <table className="tbl"><tbody>
          {DE.promoBudget.breakdown.map((b,i)=>(<tr key={i}>
            <td>{b.l}{b.note?<span className="row-meta" style={{marginLeft:6,fontSize:11}}>· {b.note}</span>:''}</td>
            <td className="num">${b.v}</td>
          </tr>))}
          <tr className="tot"><td>Spent</td><td className="num">${DE.promoBudget.spent}</td></tr>
          <tr><td className="row-meta">Remaining</td><td className="num row-meta">${DE.promoBudget.plan - DE.promoBudget.spent}</td></tr>
        </tbody></table>
      </div>
      <div className="card"><div className="card-eyebrow"><span>Post-show wrap</span><span>{DE.promoWrap.show}</span></div>
        <div className="grid grid-2" style={{gap:14}}>
          <div><div className="row-meta" style={{fontSize:11,letterSpacing:'.16em'}}>SPENT</div><div className="serif" style={{fontSize:30}}>${DE.promoWrap.spent}</div></div>
          <div><div className="row-meta" style={{fontSize:11,letterSpacing:'.16em'}}>SOLD</div><div className="serif" style={{fontSize:30}}>{DE.promoWrap.sold}</div></div>
          <div><div className="row-meta" style={{fontSize:11,letterSpacing:'.16em'}}>$ / TICKET SOLD</div><div className="serif" style={{fontSize:30,color:'var(--ember-deep)'}}>${DE.promoWrap.costPerSold}</div></div>
          <div><div className="row-meta" style={{fontSize:11,letterSpacing:'.16em'}}>NEW LIST ADDS</div><div className="serif" style={{fontSize:30}}>{DE.promoWrap.captures.mailingListAdds}</div></div>
        </div>
        <hr/>
        <table className="tbl"><tbody>
          <tr><td>Net new IG follows</td><td className="num">{DE.promoWrap.captures.instagrams}</td></tr>
          <tr><td>"Lariat austin" Google searches</td><td className="num">{DE.promoWrap.captures.googleSearches}</td></tr>
          <tr><td>Repeat from prior shows</td><td className="num">{DE.promoWrap.captures.repeat}</td></tr>
        </tbody></table>
      </div>
    </div>
  </div>);
}

// ─── 4F. TALENT PIPELINE / A&R ───
function Talent() {
  const [sort,setSort] = uSE('fit');
  const sorted = uME(()=>{
    const a = [...DE.talent];
    if (sort==='fit') a.sort((x,y)=>y.fit-x.fit);
    if (sort==='spotify') a.sort((x,y)=>parseInt(y.monthlySpotify)-parseInt(x.monthlySpotify));
    return a;
  },[sort]);
  return (<div className="page">
    <PageHead eyebrow="Talent · A&R · Iris H." title="The" em="pipeline"
      sub="Demos · scout submissions · referrals. Fit score weighs draw potential, genre balance, calendar gap, ask vs budget."
      actions={<><button className="btn">Import demo</button><button className="btn primary">+ Log inquiry</button></>}/>

    {/* SORT BAR */}
    <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:14}}>
      <span className="row-meta" style={{fontSize:11,letterSpacing:'.16em'}}>SORT BY</span>
      {[['fit','Fit score'],['spotify','Spotify reach']].map(s=>(
        <button key={s[0]} className={`btn sm ${sort===s[0]?'primary':''}`} onClick={()=>setSort(s[0])}>{s[1]}</button>
      ))}
    </div>

    <div className="grid grid-2" style={{gap:14}}>
      {sorted.map(a=>(<div className="card" key={a.act}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
          <div>
            <div className="row-meta" style={{fontSize:11,letterSpacing:'.16em',marginBottom:4}}>{a.source.toUpperCase()}</div>
            <div className="serif" style={{fontSize:28,lineHeight:1.05}}>{a.act}</div>
            <div className="row-meta" style={{fontSize:13,marginTop:4,fontStyle:'italic'}}>{a.hook}</div>
          </div>
          <div style={{textAlign:'right'}}>
            <div className="row-meta" style={{fontSize:10,letterSpacing:'.16em'}}>FIT</div>
            <div className="serif" style={{fontSize:34,color:a.fit>=.8?'var(--ember-deep)':a.fit>=.7?'var(--ember)':'var(--muted)',lineHeight:1}}>{(a.fit*100).toFixed(0)}</div>
          </div>
        </div>
        {/* fit bar */}
        <div style={{height:6,background:'var(--paper-2)',borderRadius:2,marginTop:12,overflow:'hidden'}}>
          <div style={{width:`${a.fit*100}%`,height:'100%',background:'linear-gradient(to right,var(--ember),var(--ember-deep))'}}/>
        </div>
        <div className="grid" style={{gridTemplateColumns:'1fr 1fr',gap:10,marginTop:14}}>
          <div><div className="row-meta" style={{fontSize:10,letterSpacing:'.14em'}}>SPOTIFY MO</div><div className="mono" style={{fontSize:14}}>{a.monthlySpotify}</div></div>
          <div><div className="row-meta" style={{fontSize:10,letterSpacing:'.14em'}}>NOTE</div><div style={{fontSize:12}}>{a.note}</div></div>
        </div>
        <div style={{display:'flex',gap:6,marginTop:14}}>
          <button className="btn sm">Listen</button>
          <button className="btn sm">Add hold</button>
          <button className="btn sm primary">Send offer</button>
        </div>
      </div>))}
    </div>

    {/* GENRE BALANCE */}
    <div className="sec-head" style={{marginTop:24}}><div className="sec-title">Genre balance · last 90 days</div><div className="sec-sub">we keep no single genre over 40%</div></div>
    <div className="card">
      {(() => {
        const g = [
          {k:'Country / Honky-tonk',v:6,c:'var(--ember-deep)'},
          {k:'Folk / Singer-songwriter',v:5,c:'var(--ember)'},
          {k:'Soul / R&B',v:3,c:'#7a4a2e'},
          {k:'Indie / Rock',v:4,c:'#a85a3a'},
          {k:'DJ / Electronic',v:2,c:'#c08760'},
          {k:'Bluegrass / Acoustic',v:2,c:'#d4a585'},
        ];
        const total = g.reduce((a,x)=>a+x.v,0);
        return (<div>
          <div style={{height:32,display:'flex',borderRadius:2,overflow:'hidden',marginBottom:12}}>
            {g.map((x,i)=>(<div key={i} style={{width:`${x.v/total*100}%`,background:x.c,position:'relative'}}>
              <span style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',color:'var(--paper)',fontSize:11,fontWeight:600}}>{x.v}</span>
            </div>))}
          </div>
          <div style={{display:'flex',gap:18,flexWrap:'wrap'}}>
            {g.map(x=>(<div key={x.k} className="row-meta" style={{fontSize:12}}>
              <b style={{color:x.c}}>■</b> {x.k} <span className="mono" style={{color:'var(--muted)'}}>· {(x.v/total*100).toFixed(0)}%</span>
            </div>))}
          </div>
        </div>);
      })()}
    </div>

    {/* SCOUT CALENDAR — next 14 days */}
    <div className="sec-head" style={{marginTop:24}}><div className="sec-title">Scout calendar · next field nights</div><div className="sec-sub">{DE.scouting.length} planned visits · 2 scouts</div></div>
    <div className="card flush"><table className="tbl">
      <thead><tr><th>When</th><th>Venue</th><th>Target</th><th>Scout</th><th>Note</th></tr></thead>
      <tbody>{DE.scouting.map((s,i)=>(<tr key={i}>
        <td className="mono">{s.when}</td>
        <td><b>{s.where}</b></td>
        <td>{s.target}</td>
        <td className="row-meta">{s.who}</td>
        <td className="row-meta">{s.note}</td>
      </tr>))}</tbody>
    </table></div>

    {/* CONTACT LOG */}
    <div className="grid" style={{gridTemplateColumns:'1.4fr 1fr',gap:18,marginTop:18}}>
      <div className="card flush"><div className="card-eyebrow" style={{padding:'14px 18px 0'}}><span>Contact log · last 21 days</span><span>{DE.outreach.length} touches</span></div>
        <table className="tbl">
          <thead><tr><th>When</th><th>Artist · Channel</th><th>Notes</th></tr></thead>
          <tbody>{DE.outreach.map((c,i)=>(<tr key={i}>
            <td className="mono" style={{whiteSpace:'nowrap'}}>{c.when}</td>
            <td><b>{c.who}</b><br/><span className="row-meta" style={{fontSize:11}}>{c.ch} · {c.dir==='out'?'sent':'received'}</span></td>
            <td className="row-meta">{c.note}</td>
          </tr>))}</tbody>
        </table>
      </div>
      <div className="card"><div className="card-eyebrow"><span>Follow-up reminders</span><span>{DE.followUps.length} due</span></div>
        <ul style={{listStyle:'none',padding:0,margin:0}}>
          {DE.followUps.map((f,i)=>(<li key={i} style={{padding:'10px 0',borderBottom:'1px solid var(--hair)'}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
              <b>{f.artist}</b>
              <span className="mono" style={{fontSize:11,color:f.urgency==='today'?'var(--ember-deep)':'var(--muted)'}}>{f.due}</span>
            </div>
            <div className="row-meta" style={{fontSize:12,marginTop:2}}>{f.action}</div>
          </li>))}
        </ul>
      </div>
    </div>
  </div>);
}



// ─── 4G. TONIGHT — live show cockpit ───
function Tonight() {
  const t = DE.tonight;
  const lp = DE.livePulse;
  const setlistDone = lp.setlist.filter(s=>s.played).length;
  const minutesLeft = lp.setlist.filter(s=>!s.played).reduce((a,s)=>a+s.min,0);
  return (<div className="page">
    <PageHead eyebrow={`LIVE · ${t.date} · 10:22 PM`} title="Tonight." em={t.artist}
      sub={`${t.genre} · curfew ${t.curfew} · ${minutesLeft.toFixed(0)} minutes of music remaining.`}
      actions={<><span className="pill ok">● LIVE</span><button className="btn primary">Push update to FOH</button></>}/>

    {/* LIVE PULSE STRIP */}
    <div className="grid" style={{gridTemplateColumns:'repeat(6,1fr)',gap:8,marginBottom:18}}>
      <KPI label="In room" value={lp.insideRoom} sub={`/ ${t.cap} cap`} tone="up"/>
      <KPI label="At door" value={lp.atDoor} sub="active scan"/>
      <KPI label="Smoke / patio" value={lp.smokeArea} sub="loose count"/>
      <KPI label="Lined at bar" value={lp.linedBar} sub="3+ deep"/>
      <KPI label="Tabs open" value={lp.bar.tabsOpen} sub={`avg $${lp.bar.tabsAvg}`}/>
      <KPI label="SPL · 30m Leq" value="98 dB" sub={`limit ${DE.splLimit}`} tone="warn"/>
    </div>

    <div className="grid" style={{gridTemplateColumns:'1.2fr 1fr',gap:18,marginBottom:18}}>
      {/* SETLIST PROGRESS */}
      <div className="card"><div className="card-eyebrow"><span>{lp.bandStatus}</span><span>{setlistDone} of {lp.setlist.length} played</span></div>
        <div style={{display:'grid',gridTemplateColumns:'40px 1fr 60px 80px',gap:0,marginTop:6}}>
          {lp.setlist.map(s=>{
            const stateColor = s.now?'var(--ember-deep)':s.played?'var(--muted)':'var(--char)';
            const bg = s.now?'rgba(217,117,87,.12)':'transparent';
            return (<React.Fragment key={s.n}>
              <div style={{padding:'8px 4px',background:bg,fontFamily:'JetBrains Mono,monospace',fontSize:11,color:stateColor,textAlign:'center'}}>{s.n}</div>
              <div style={{padding:'8px 8px',background:bg,fontWeight:s.now?700:s.encore?600:400,color:stateColor,textDecoration:s.played&&!s.now?'line-through':'none'}}>
                {s.song}{s.encore&&<span className="row-meta" style={{marginLeft:8,fontSize:11,letterSpacing:'.16em',color:'var(--ember-deep)'}}>· ENCORE</span>}
              </div>
              <div style={{padding:'8px 4px',background:bg,fontFamily:'JetBrains Mono,monospace',fontSize:11,color:'var(--muted)'}}>{s.min}m</div>
              <div style={{padding:'8px 8px',background:bg,fontSize:11,color:stateColor}}>
                {s.now?<span className="pill alert" style={{fontSize:9}}>NOW</span>:s.played?<span className="row-meta">done</span>:<span className="row-meta">queued</span>}
              </div>
            </React.Fragment>);
          })}
        </div>
      </div>

      {/* LIVE FEEDS — bar + door */}
      <div>
        <div className="card" style={{marginBottom:14}}><div className="card-eyebrow"><span>Bar pulse</span><span>last 15 min</span></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
            <div>
              <div className="row-meta" style={{fontSize:10,letterSpacing:'.16em'}}>TOP POUR</div>
              <div className="serif" style={{fontSize:24,lineHeight:1.05}}>{lp.bar.topPour}</div>
              <div className="row-meta" style={{fontSize:11,marginTop:2}}>2-for-1 setbreak ran til 10:45</div>
            </div>
            <div>
              <div className="row-meta" style={{fontSize:10,letterSpacing:'.16em'}}>SHOW SPECIAL</div>
              <div className="serif" style={{fontSize:24,lineHeight:1.05}}>{lp.bar.specialPoured} poured</div>
              <div className="row-meta" style={{fontSize:11,marginTop:2}}>"Bramble Old Fashioned" · $14</div>
            </div>
          </div>
          <hr/>
          <div className="row-meta" style={{fontSize:11}}>Pacing: 4.2 drinks per cover · target 3.5. <b style={{color:'var(--ember-deep)'}}>Hot night.</b></div>
        </div>

        <div className="card"><div className="card-eyebrow"><span>Incidents · last 90 min</span><span>{lp.incidents.length} logged</span></div>
          {lp.incidents.map((i,k)=>(<div key={k} style={{padding:'8px 0',borderBottom:k<lp.incidents.length-1?'1px solid var(--hair)':'none',display:'flex',gap:12,alignItems:'flex-start'}}>
            <span className="mono" style={{fontSize:11,color:'var(--muted)',width:64,flexShrink:0}}>{i.t}</span>
            <span style={{flex:1,fontSize:13}}>{i.what}</span>
            <span className={`pill ${i.sev==='mid'?'warn':''}`} style={{fontSize:10}}>{i.sev}</span>
          </div>))}
        </div>
      </div>
    </div>

    {/* CURFEW + LOAD-OUT */}
    <div className="grid grid-3">
      <div className="card"><div className="card-eyebrow">Curfew countdown</div>
        <div className="serif" style={{fontSize:64,lineHeight:1,color:'var(--ember-deep)'}}>2h 08m</div>
        <div className="row-meta" style={{marginTop:6}}>City permit · noise stops 12:30 sharp</div>
        <hr/>
        <div className="row-meta" style={{fontSize:12}}>Encore window 11:55 · last call 12:15.</div>
      </div>
      <div className="card"><div className="card-eyebrow">Settlement queued</div>
        <div className="serif" style={{fontSize:46,lineHeight:1.05}}>~$1,840</div>
        <div className="row-meta" style={{marginTop:6}}>est. payout to {t.artist} · pending final scan</div>
        <hr/>
        <div className="row-meta" style={{fontSize:12}}>Iris in office at 12:45 with cash + 1099 stub.</div>
      </div>
      <div className="card"><div className="card-eyebrow">Load-out window</div>
        <div className="serif" style={{fontSize:46,lineHeight:1.05}}>1:30 AM</div>
        <div className="row-meta" style={{marginTop:6}}>alley reservation expires</div>
        <hr/>
        <div className="row-meta" style={{fontSize:12}}>Roan + 1 hand · house kit stays · band breaks own backline.</div>
      </div>
    </div>

    {/* QUICK ACTIONS — link out */}
    <div className="sec-head" style={{marginTop:24}}><div className="sec-title">Jump to</div></div>
    <div className="grid grid-3" style={{gap:8}}>
      {[
        {l:'Box Office · scanner',sub:'check in remaining will-call'},
        {l:'Sound · scene + SPL',sub:'live trace + monitor mixes'},
        {l:'Stage · run of show',sub:'curfew clock + load-out plan'},
      ].map(q=>(<button key={q.l} className="card" style={{textAlign:'left',cursor:'pointer',border:'1px solid var(--hair)'}}>
        <div style={{fontWeight:600}}>{q.l}</div>
        <div className="row-meta" style={{fontSize:12,marginTop:4}}>{q.sub}</div>
      </button>))}
    </div>
  </div>);
}

Object.assign(window, { Sound, Booking, Stage, BoxOffice, Promo, Talent });
