/* Pages — Office, Cross-cutting */
const D3 = window.LARIAT_DATA;
const { useState: uS3 } = React;

// ─── 5A. GM COMMAND CENTER — Broadsheet bureau layout ───
function GM() {
  const D = D3;
  const usd = n => '$' + n.toLocaleString('en-US');
  const usdK = n => '$' + (n/1000).toFixed(1) + 'k';
  return (<div className="page bureau" style={{padding:'24px 36px 60px',position:'relative'}}>
    <BureauFold left="BUREAU · GM LENS · MARISOL QUIÑONES" right="EST. MMXXVI · DAILY"/>
    <BureauNameplate name="The Bureau" tagline="— filed at six forty-two · saturday morning —" stars={9}/>
    <FileTab no="2026-129" sub="GM MORNING BRIEF · CLASS · 1"/>

    <BureauTicker items={[
      'Friday close · $14,217 · 142 covers · prime cost 56.2 % ',
      'GUEST · "Best meal in years" · M. Klein · booth 4 · auto-flagged',
      'SUPPLIER · Sysco butter +12 % effective Mon · review',
      'COMP · t-12 · main returned · MOD signoff · -$48',
      'CERT · ServSafe expires 14 d · 3 cooks',
      'CASH · drawer 2 · -$23 short · reconciling',
      'EVENTS · Centennial dinner deposit · $4,800 received',
      'LICENSE · liquor renewal · 47 d',
    ]}/>

    {/* HERO */}
    <section style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:32,paddingBottom:22,borderBottom:'1px solid #5a5147',alignItems:'center',position:'relative',marginBottom:18}}>
      <div>
        <div style={{fontFamily:"'Iowan Old Style',Georgia,serif",fontSize:156,lineHeight:.85,fontWeight:700,letterSpacing:'-.04em',color:'#0e0c08'}}>7</div>
        <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:9.5,letterSpacing:'.32em',color:'#5a5147',textTransform:'uppercase',marginTop:6}}>Items needing attention</div>
      </div>
      <div style={{position:'relative'}}>
        <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:10,letterSpacing:'.4em',textTransform:'uppercase',color:'#9a3f1a',marginBottom:12}}>Today · Front page</div>
        <h1 style={{fontFamily:"'Iowan Old Style',Georgia,serif",fontSize:42,lineHeight:1.04,letterSpacing:'-.02em',fontWeight:700,fontStyle:'italic',color:'#0e0c08',margin:'0 0 12px'}}>
          Friday closed strong; Saturday is loaded — <span style={{color:'#9a3f1a'}}>Centennial dinner</span> on top of a normal book.
        </h1>
        <p style={{fontFamily:"'Iowan Old Style',Georgia,serif",fontSize:16,lineHeight:1.4,color:'#3a3530',maxWidth:'60ch'}}>
          Last night printed <b>$14,217</b> on <b>142</b> covers, twelve points over forecast. Food held at <b>31.4%</b>, labor at <b>24.8%</b> — prime cost a clean <b>56.2%</b>. Tonight the room is booked at ninety-six percent of capacity with the Cattlemen's centennial dinner riding on top. Three certs and a butter price hike want eyes before service.
        </p>
        <div style={{position:'absolute',top:-10,right:-8}}>
          <BureauStamp>FILED<br/>09·V·26<br/>06·42</BureauStamp>
        </div>
      </div>
    </section>

    <BureauSummary cells={[
      {label:'SALES · FRI',  value:'$14.2k', sub:'tgt $12.6k · +13%', amber:true},
      {label:'COVERS',       value:'142',    sub:'tgt 130 · +9%'},
      {label:'FOOD %',       value:'31.4%',  sub:'tgt 32.0% · ↓'},
      {label:'LABOR %',      value:'24.8%',  sub:'tgt 26.0% · ↓'},
      {label:'PRIME %',      value:'56.2%',  sub:'tgt 58.0% · ↓', amber:true},
    ]}/>

    {/* THREE-COLUMN BODY */}
    <div className="bureau-three">
      {/* COL 1 — THE ROOM */}
      <div className="b-col">
        <div className="card-eyebrow"><span>The room</span><span>p. 1</span></div>
        <h3 className="bureau-storyhead">One hundred forty-two through the door; sentiment held high.</h3>
        <div className="bureau-byline">From the floor desk · 06:14 fetch</div>
        <p className="bureau-para">
          <span className="bureau-drop">F</span>riday turned the dining room three and a half times. Theo ran section A, and three of the night's four highest checks landed at his tables — including booth 4 at <span className="bureau-amber">$612</span>. NPS settled at <span className="bureau-amber">8.4</span>, down a tenth on Thursday but holding the eight-point line we set for May.
        </p>

        <div className="card-eyebrow" style={{marginTop:14}}><span>Service notes · MOD</span></div>
        {[
          {t:'20:14',title:'T-12 · ribeye returned · over-rest',sub:'MOD comp · re-fired · 22% tip',pill:'COMP',pc:'#7a2f0f'},
          {t:'21:02',title:'Booth 8 · anniversary · gratis dessert',sub:'Marie + David Klein · 12th anniv.',pill:'VIP',pc:'#5d7a66'},
          {t:'22:18',title:'Bar · NPS-10 comment card',sub:'see pull-quote',pill:'FLAG',pc:'#5d7a66'},
        ].map((e,i)=>(
          <div key={i} style={{display:'grid',gridTemplateColumns:'auto 1fr auto',gap:12,padding:'8px 0',borderBottom:'1px dotted #b8a98a',alignItems:'baseline'}}>
            <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:12,color:'#3a3530',minWidth:48}}>{e.t}</span>
            <div>
              <div style={{fontSize:14,color:'#0e0c08',lineHeight:1.3}}>{e.title}</div>
              <div style={{fontSize:11,color:'#5a5147',marginTop:2}}>{e.sub}</div>
            </div>
            <span className="pill" style={{color:e.pc}}>{e.pill}</span>
          </div>
        ))}

        <PullNote label="Comment card · NPS 10 · Fri · 22:14" who="M. Klein · regular · 4th visit">
          “Theo described the walleye like he'd caught it himself. We changed our order. Best meal in years.”
        </PullNote>
      </div>

      {/* COL 2 — THE BOOKS */}
      <div className="b-col">
        <div className="card-eyebrow"><span>The books</span><span>p. 2</span></div>
        <h3 className="bureau-storyhead">MTD on the books: $284,820 — eleven points over a year ago.</h3>
        <div className="bureau-byline">From the back office · 06:32 fetch</div>
        <p className="bureau-para">
          <span className="bureau-drop">F</span>ood and labor each came in under target — food a half point under, labor a full point under. The bar pulled <span className="bureau-amber">$58.4k</span> against an average $48k month. Prime cost a clean <span className="bureau-amber">58.8%</span> against a 60% goal. Walleye and ribeye carried the protein side; peach galette stayed dead in the water, third night running.
        </p>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',border:'1px solid #0e0c08',background:'#000',color:'#e8a04a',fontFamily:'JetBrains Mono,monospace',marginTop:12,marginBottom:14}}>
          {[['MTD REV','$284.8k',true],['BAR REV','$58.4k',true],['PPA','$43.20',false],['COMPS·VOIDS','2 · 1',false],['FOOD COST','28.4%',false],['LABOR','31.2%',false]].map(([k,v,a],i)=>(
            <div key={i} style={{padding:'8px 12px',borderLeft:i%2?'1px solid #3a342a':'none',borderTop:i>1?'1px solid #3a342a':'none',display:'flex',flexDirection:'column'}}>
              <span style={{fontSize:9,letterSpacing:'.22em',color:'#7d7560'}}>{k}</span>
              <span style={{fontSize:14,color:a?'#e8a04a':'#cdbf95',marginTop:2,fontWeight:500}}>{v}</span>
            </div>
          ))}
        </div>

        <div className="card-eyebrow"><span>Top movers · this week</span></div>
        <table className="tbl">
          <tbody>
            {D.menu.sort((a,b)=>b.sold-a.sold).slice(0,6).map(m=>{
              const margin = ((m.price-m.cost)/m.price)*100;
              return (<tr key={m.id}>
                <td style={{fontFamily:"'Iowan Old Style',Georgia,serif"}}>{m.name}</td>
                <td className="num">{m.sold}</td>
                <td className="num">${(m.sold*m.price).toFixed(0)}</td>
                <td className="num" style={{color:margin>70?'#5d7a66':margin<55?'#7a2f0f':'#9a3f1a'}}>{margin.toFixed(0)}% {margin>70?'↑':margin<55?'↓':'→'}</td>
              </tr>);
            })}
          </tbody>
        </table>

        <div style={{marginTop:14,padding:'12px 14px',border:'1px solid #0e0c08',background:'#f8f3e7'}}>
          <div className="card-eyebrow"><span>Week sales · Mon → Sun · WK 17</span></div>
          <div style={{fontFamily:'JetBrains Mono,monospace',color:'#9a3f1a',fontSize:38,lineHeight:1,letterSpacing:'.12em'}}>
            {(() => {
              const vals = D.weekSales.map(d=>d.s);
              const max = Math.max(...vals), min = Math.min(...vals);
              const blocks = '▁▂▃▄▅▆▇█';
              return vals.map(v => blocks[Math.min(7, Math.floor(((v-min)/(max-min||1))*7))]).join('');
            })()}
          </div>
          <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:9.5,color:'#5a5147',letterSpacing:'.18em',marginTop:8,display:'flex',justifyContent:'space-between'}}>
            {D.weekSales.map(d=><span key={d.d}>{d.d.toUpperCase()}</span>)}
          </div>
        </div>
      </div>

      {/* COL 3 — TONIGHT & AHEAD */}
      <div className="b-col">
        <div className="card-eyebrow"><span>Tonight</span><span>p. 3</span></div>
        <h3 className="bureau-storyhead">218 covers projected; band at nine.</h3>
        <div className="bureau-byline">From the desk · 06:38 fetch</div>
        <p className="bureau-para">
          The Cattlemen's centennial dinner runs the private room — sixty-four covers seated at seven, four-course tasting on the BEO. The main room books one-forty-two with twelve walk-ins penciled. Reso pace tracks at <span className="bureau-amber">96%</span> of YoY same-Saturday.
        </p>

        {[
          {time:'5:00 PM',title:'Doors · Saturday dinner service',sub:'38 covers booked',state:'soon'},
          {time:'5:30 PM',title:'Pre-shift · staff meal · briefing',sub:'centennial briefing · 14 staff',state:'soon'},
          {time:'7:00 PM',title:'Centennial dinner · private',sub:'64 covers · seated 7:00',state:'later'},
          {time:'9:00 PM',title:'The Bramble Hollow · live',sub:'opener 8:30 · sound check 7:30',state:'later'},
          {time:'11:30 PM',title:'Close · cash count · log',sub:'closeout to GM Sun-AM',state:'later'},
        ].map((e,i)=>(
          <div key={i} style={{display:'grid',gridTemplateColumns:'auto 1fr auto',gap:12,padding:'8px 0',borderBottom:'1px dotted #b8a98a',alignItems:'baseline'}}>
            <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:12,color:e.state==='now'?'#9a3f1a':'#3a3530',minWidth:64,fontWeight:e.state==='now'?700:400}}>{e.time}</span>
            <div>
              <div style={{fontSize:14,color:'#0e0c08',lineHeight:1.3}}>{e.title}</div>
              <div style={{fontSize:11,color:'#5a5147',marginTop:2}}>{e.sub}</div>
            </div>
            <span className="pill" style={{color:e.state==='now'?'#9a3f1a':e.state==='soon'?'#7a2f0f':'#5a5147'}}>
              {e.state==='now'?'NOW':e.state==='soon'?'T-1H':'LATER'}
            </span>
          </div>
        ))}

        <div style={{marginTop:14,padding:'12px 14px',border:'1px solid #0e0c08',background:'#f8f3e7'}}>
          <div className="card-eyebrow"><span>Labor · today</span></div>
          <table className="tbl">
            <tbody>
              <tr><td>BOH · 8 on</td><td className="num">68 h</td><td className="num bureau-amber">12.4%</td></tr>
              <tr><td>FOH · 7 on</td><td className="num">48 h</td><td className="num bureau-amber">11.2%</td></tr>
              <tr><td>Bar · 3 on</td><td className="num">22 h</td><td className="num bureau-amber">3.4%</td></tr>
            </tbody>
          </table>
          <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:10.5,color:'#7a2f0f',marginTop:8,letterSpacing:'.04em'}}>
            ⚠ Cody · 41.5h · cap before Sunday
          </div>
        </div>

        <div style={{marginTop:14,padding:'12px 14px',border:'1px solid #0e0c08',background:'#f8f3e7'}}>
          <div className="card-eyebrow"><span>Compliance · 60-day window</span></div>
          <table className="tbl">
            <tbody>
              <tr><td>Marco · line</td><td>ServSafe</td><td className="num" style={{color:'#7a2f0f'}}>14 d</td></tr>
              <tr><td>Owen · steward</td><td>ServSafe</td><td className="num" style={{color:'#9a3f1a'}}>22 d</td></tr>
              <tr><td>House</td><td>Liquor lic.</td><td className="num" style={{color:'#5d7a66'}}>47 d</td></tr>
              <tr><td>Kitchen</td><td>Hood inspect.</td><td className="num" style={{color:'#5d7a66'}}>61 d</td></tr>
              <tr><td>House</td><td>Health insp.</td><td className="num" style={{color:'#9a3f1a'}}>TBD</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div style={{marginTop:30,paddingTop:14,borderTop:'2px solid #0e0c08',display:'flex',justifyContent:'space-between',fontFamily:'JetBrains Mono,monospace',fontSize:9.5,letterSpacing:'.3em',color:'#5a5147',textTransform:'uppercase'}}>
      <span>— end of file —</span>
      <span style={{color:'#9a3f1a'}}>RELOAD TO REFETCH · LIVE</span>
      <span>Lariat Bureau · est. MMXXVI</span>
    </div>
  </div>);
}

// ─── P&L ───
function PL() {
  return (<div className="page">
    <PageHead eyebrow="P&L · April 1-25" title="Profit &" em="loss"
      sub="USAR-mapped chart of accounts · drill into any line."
      actions={<><button className="btn">CSV</button><button className="btn">PDF</button></>}/>
    <div className="card flush">
      <table className="tbl pl">
        <thead><tr><th>Account</th><th>MTD</th><th>% rev</th><th>YoY</th><th>Trend</th></tr></thead>
        <tbody>
          <tr className="grp"><td colSpan="5">Revenue</td></tr>
          <tr><td>Food sales</td><td className="num">$214,820</td><td className="num">75.4%</td><td className="num up">+9%</td><td><Spark v={[180,190,205,212,210,215,218]}/></td></tr>
          <tr><td>Bar sales</td><td className="num">$58,440</td><td className="num">20.5%</td><td className="num up">+18%</td><td><Spark v={[44,48,52,55,57,58,58]}/></td></tr>
          <tr><td>Events / private</td><td className="num">$11,560</td><td className="num">4.1%</td><td className="num up">+22%</td><td><Spark v={[6,8,9,11,11,12,11]}/></td></tr>
          <tr className="tot"><td>Total revenue</td><td className="num">$284,820</td><td className="num">100%</td><td className="num up">+11%</td><td></td></tr>
          <tr className="grp"><td colSpan="5">Cost of goods</td></tr>
          <tr><td>Food cost</td><td className="num">$60,820</td><td className="num">28.4%</td><td className="num down">+0.9%</td><td><Spark v={[27,28,28,29,29,28,28]}/></td></tr>
          <tr><td>Bar cost</td><td className="num">$12,920</td><td className="num">22.1%</td><td className="num up">-1.2%</td><td><Spark v={[24,23,23,22,22,22,22]}/></td></tr>
          <tr className="grp"><td colSpan="5">Labor</td></tr>
          <tr><td>BOH wages</td><td className="num">$51,260</td><td className="num">18.0%</td><td className="num up">-0.8%</td><td><Spark v={[19,18,18,18,18,18,18]}/></td></tr>
          <tr><td>FOH wages</td><td className="num">$25,640</td><td className="num">9.0%</td><td className="num">±0%</td><td><Spark v={[9,9,9,9,9,9,9]}/></td></tr>
          <tr><td>Mgmt salary</td><td className="num">$14,000</td><td className="num">4.9%</td><td/><td/></tr>
          <tr className="tot"><td>Prime cost</td><td className="num">$164,640</td><td className="num">57.8%</td><td className="num up">-0.4%</td><td/></tr>
          <tr className="grp"><td colSpan="5">Operating expenses</td></tr>
          <tr><td>Rent / lease</td><td className="num">$18,500</td><td className="num">6.5%</td><td/><td/></tr>
          <tr><td>Utilities</td><td className="num">$6,820</td><td className="num">2.4%</td><td/><td/></tr>
          <tr><td>Insurance</td><td className="num">$4,200</td><td className="num">1.5%</td><td/><td/></tr>
          <tr><td>Marketing</td><td className="num">$3,100</td><td className="num">1.1%</td><td/><td/></tr>
          <tr className="tot"><td>Net income</td><td className="num up">$87,560</td><td className="num">30.7%</td><td className="num up">+14%</td><td/></tr>
        </tbody>
      </table>
    </div>
  </div>);
}

// ─── 5B. OWNER / INVESTOR ───
function Owner() {
  return (<div className="page">
    <PageHead eyebrow="Ownership · Calder & Ines" title="Investor" em="dashboard"
      sub="Q1 closed · cash position $312K · YTD net $268K · two distributions paid."/>
    <div className="grid grid-4" style={{marginBottom:18}}>
      <KPI label="YTD revenue" value="$1.12M" sub="+13% YoY" tone="up"/>
      <KPI label="Net income" value="$268K" sub="23.9% net margin" tone="up"/>
      <KPI label="Cash position" value="$312K" sub="incl. reserves"/>
      <KPI label="Distributions" value="$84K" sub="paid YTD"/>
    </div>
    <div className="grid grid-2" style={{marginBottom:18}}>
      <div className="card"><div className="card-eyebrow">12-month rolling P&L</div>
        <BarChart data={[
          {d:'May',s:84},{d:'Jun',s:96},{d:'Jul',s:108},{d:'Aug',s:104},{d:'Sep',s:112},{d:'Oct',s:128},
          {d:'Nov',s:142},{d:'Dec',s:168},{d:'Jan',s:118},{d:'Feb',s:124},{d:'Mar',s:138},{d:'Apr',s:142}
        ]} getV={d=>d.s} getL={d=>d.d} w={520} h={200}/>
      </div>
      <div className="card"><div className="card-eyebrow">Scenario modeler</div>
        <div className="row-meta">Adjust the levers · see net impact</div>
        {[
          {l:'Food cost %',v:28.4,goal:'27.5'},
          {l:'Labor %',v:31.8,goal:'30'},
          {l:'Covers / week',v:1240,goal:'1300'},
          {l:'Avg PPA',v:45.32,goal:'48'},
        ].map(s=>(<div key={s.l} style={{margin:'10px 0'}}>
          <div className="split" style={{marginBottom:4}}><span className="row-meta">{s.l}</span><span className="mono" style={{fontSize:12}}>{s.v} → {s.goal}</span></div>
          <input type="range" defaultValue="50" style={{width:'100%',accentColor:'var(--ember)'}}/>
        </div>))}
        <div className="quote" style={{marginTop:12,fontSize:18}}>Net income at goal: <b style={{color:'var(--ember-deep)'}}>+$58,400 / yr</b></div>
      </div>
    </div>
    <div className="grid grid-3">
      <div className="card"><div className="card-eyebrow">Capex tracker</div>
        <table className="tbl"><tbody>
          <tr><td>New 6-burner range</td><td className="num">$8,400</td></tr>
          <tr><td>Stage lighting refresh</td><td className="num">$12,800</td></tr>
          <tr><td>Patio heaters (×4)</td><td className="num">$3,200</td></tr>
        </tbody></table>
      </div>
      <div className="card"><div className="card-eyebrow">Lease · key dates</div>
        <table className="tbl"><tbody>
          <tr><td>Renewal option</td><td className="mono">Sep 2027</td></tr>
          <tr><td>Rent escalation</td><td className="mono">Jan 1 · +3%</td></tr>
          <tr><td>CAM reconciliation</td><td className="mono">Jul 2026</td></tr>
        </tbody></table>
      </div>
      <div className="card"><div className="card-eyebrow">Distribution forecast</div>
        <div className="serif" style={{fontSize:30,marginTop:6}}>$148,000</div>
        <div className="row-meta">projected YE distribution (after 8% reserve)</div>
      </div>
    </div>
  </div>);
}

// ─── 5C. ACCOUNTING ───
function Accounting() {
  return (<div className="page">
    <PageHead eyebrow="Accounting" title="Books &" em="reconciliation"/>
    <div className="grid grid-4" style={{marginBottom:18}}>
      <KPI label="AP · open" value="$28,420" sub="14 invoices"/>
      <KPI label="AR · open" value="$8,210" sub="3 house accounts"/>
      <KPI label="Cash variance" value="$0" sub="period to date" tone="up"/>
      <KPI label="Next payroll" value="Apr 28" sub="$54,200 est"/>
    </div>
    <div className="grid grid-2">
      <div className="card flush">
        <div style={{padding:'14px 18px'}}><div className="card-eyebrow">AP aging</div></div>
        <table className="tbl"><thead><tr><th>Vendor</th><th>0-30</th><th>30-60</th><th>60+</th><th>Total</th></tr></thead>
          <tbody>
            <tr><td>Sysco</td><td className="num">$12,400</td><td className="num">$0</td><td className="num">$0</td><td className="num">$12,400</td></tr>
            <tr><td>Cervantes Meats</td><td className="num">$4,820</td><td className="num">$1,200</td><td className="num">$0</td><td className="num">$6,020</td></tr>
            <tr><td>Lariat Farms</td><td className="num">$2,800</td><td className="num">$0</td><td className="num">$0</td><td className="num">$2,800</td></tr>
            <tr><td>Republic Wine</td><td className="num">$3,400</td><td className="num">$2,200</td><td className="num">$1,580</td><td className="num">$7,180</td></tr>
          </tbody></table>
      </div>
      <div className="card"><div className="card-eyebrow">Daily sales journal · last 7</div>
        <table className="tbl"><thead><tr><th>Date</th><th>Cash</th><th>Card</th><th>Total</th></tr></thead><tbody>
          {[{d:'Apr 19',c:480,k:8420},{d:'Apr 20',c:520,k:11480},{d:'Apr 21',c:380,k:7240},{d:'Apr 22',c:420,k:8180},
            {d:'Apr 23',c:610,k:9920},{d:'Apr 24',c:580,k:10840},{d:'Apr 25',c:640,k:10600}].map(d=>(
            <tr key={d.d}><td>{d.d}</td><td className="num">${d.c}</td><td className="num">${d.k.toLocaleString()}</td><td className="num">${(d.c+d.k).toLocaleString()}</td></tr>
          ))}
        </tbody></table>
      </div>
    </div>
  </div>);
}

// ─── 5D. HR ───
function HR() {
  return (<div className="page">
    <PageHead eyebrow="People ops · Renata Cho" title="The" em="roster"
      sub="34 active employees · 4 onboarding · 2 certs expiring this month."/>
    <div className="grid grid-4" style={{marginBottom:18}}>
      <KPI label="Active staff" value="34"/>
      <KPI label="Onboarding" value="4" sub="2 finish this week"/>
      <KPI label="Certs expiring" value="2" sub="ServSafe · TABC" tone="warn"/>
      <KPI label="Open write-ups" value="1"/>
    </div>
    <div className="grid grid-2">
      <div className="card flush">
        <div style={{padding:'14px 18px'}}><div className="card-eyebrow">Roster</div></div>
        <table className="tbl"><thead><tr><th>Name</th><th>Role</th><th>Tenure</th><th>Certs</th></tr></thead>
          <tbody>{D3.staff.slice(0,8).map(s=>(<tr key={s.name}>
            <td><b>{s.name}</b></td><td>{s.role}</td><td className="num">{s.tenure} mo</td>
            <td>{s.certs.map(c=>(<span className="chip" key={c} style={{fontSize:10,padding:'2px 8px',marginRight:4}}>{c}</span>))}</td>
          </tr>))}</tbody>
        </table>
      </div>
      <div className="flex-col">
        <div className="card"><div className="card-eyebrow">Onboarding · in progress</div>
          {[{n:'Junior Hsiao',role:'Line cook',pct:60},{n:'Marquise Field',role:'Server',pct:30},
            {n:'Astrid Lowe',role:'Runner',pct:90},{n:'Phin Ortega',role:'Bar back',pct:45}].map(o=>(
            <div className="bar-row" key={o.n}>
              <div style={{width:160}}><div className="row-name">{o.n}</div><div className="row-meta">{o.role}</div></div>
              <div className="bar-track"><div className="bar-fill" style={{width:`${o.pct}%`,background:'var(--ember)'}}/></div>
              <div className="tnum" style={{fontSize:11,width:36,textAlign:'right'}}>{o.pct}%</div>
            </div>
          ))}
        </div>
        <div className="card"><div className="card-eyebrow">Certs expiring · next 60d</div>
          <div className="row"><span className="dot" style={{background:'var(--rust)'}}/>
            <div><div className="row-name">Esteban R. · ServSafe</div><div className="row-meta">expires May 2 · 7 days</div></div></div>
          <div className="row"><span className="dot" style={{background:'var(--brass)'}}/>
            <div><div className="row-name">Lila B. · TABC</div><div className="row-meta">expires Jun 14 · 50 days</div></div></div>
        </div>
      </div>
    </div>
  </div>);
}

// ─── 6B. INVENTORY ───
function Inventory() {
  return (<div className="page">
    <PageHead eyebrow="Inventory & purchasing" title="On" em="hand"
      sub="Perpetual count from POS. Receiving log, par alerts, vendor watch."
      actions={<button className="btn primary">+ PO</button>}/>
    <div className="grid grid-4" style={{marginBottom:18}}>
      <KPI label="Below par" value="14" tone="warn"/>
      <KPI label="Open POs" value="6" sub="$8,420"/>
      <KPI label="Recall flags" value="0" tone="up"/>
      <KPI label="Receiving today" value="3" sub="Sysco · CM · LF"/>
    </div>
    <div className="card flush">
      <table className="tbl">
        <thead><tr><th>Item</th><th>Cat</th><th>On hand</th><th>Par</th><th>Vendor</th><th>Last paid</th><th>Trend</th></tr></thead>
        <tbody>{D3.inventory.map(i=>(<tr key={i.id}>
          <td><b>{i.name}</b></td><td>{i.cat}</td>
          <td className="num">{i.have} {i.unit}</td>
          <td><div className="bar-track" style={{width:120}}><div className="bar-fill" style={{width:`${Math.min(100,i.have/i.par*100)}%`,background:i.have<i.par?'var(--rust)':'var(--ember)'}}/></div></td>
          <td>{i.vendor}</td><td className="num">${i.lastPaid?.toFixed(2)}</td>
          <td className={`num ${i.trend>0?'down':i.trend<0?'up':''}`}>{i.trend>0?'+':''}{i.trend}%</td>
        </tr>))}</tbody>
      </table>
    </div>
  </div>);
}

// ─── HACCP ───
function HACCP() {
  return (<div className="page">
    <PageHead eyebrow="HACCP & food safety" title="The" em="logbook"
      sub="CCPs, cooling, hot/cold hold, sanitation. Out-of-range triggers corrective action."/>
    <div className="grid grid-4" style={{marginBottom:18}}>
      <KPI label="Today's checks" value="14/16" sub="2 due in 30m" tone="warn"/>
      <KPI label="OOR last 7d" value="2" sub="both corrected" tone="up"/>
      <KPI label="Pest log" value="clean" sub="last visit 4/18" tone="up"/>
      <KPI label="Health score" value="98" sub="last inspection"/>
    </div>
    <div className="grid grid-2">
      <div className="card"><div className="card-eyebrow">Temp log · today</div>
        <table className="tbl"><thead><tr><th>Unit</th><th>Target</th><th>Last</th><th>Status</th></tr></thead><tbody>
          {[
            {u:'Walk-in #1',t:'≤41°F',v:'38°F',ok:1},
            {u:'Walk-in #2',t:'≤41°F',v:'42°F',ok:0},
            {u:'Reach-in line',t:'≤41°F',v:'40°F',ok:1},
            {u:'Freezer #1',t:'≤0°F',v:'-2°F',ok:1},
            {u:'Hot hold · soup',t:'≥135°F',v:'142°F',ok:1},
            {u:'Sanitizer · 3-comp',t:'150-400ppm',v:'200ppm',ok:1},
          ].map(t=>(<tr key={t.u}><td>{t.u}</td><td className="mono">{t.t}</td><td className="num">{t.v}</td>
            <td><span className={`pill ${t.ok?'ok':'alert'}`}>{t.ok?'in spec':'OOR'}</span></td></tr>))}
        </tbody></table>
      </div>
      <div className="card"><div className="card-eyebrow">Cooling log · 2-stage</div>
        <table className="tbl"><thead><tr><th>Item</th><th>Started</th><th>135→70°F</th><th>70→41°F</th></tr></thead><tbody>
          <tr><td>Green chile</td><td className="mono">2:14 PM</td><td><span className="pill ok">1:48</span></td><td><span className="pill ok">3:22</span></td></tr>
          <tr><td>Soup of day</td><td className="mono">3:02 PM</td><td><span className="pill ok">1:32</span></td><td><span className="pill ember">in progress</span></td></tr>
          <tr><td>Mac sauce</td><td className="mono">4:18 PM</td><td><span className="pill ember">in progress</span></td><td>—</td></tr>
        </tbody></table>
        <div className="card-eyebrow" style={{marginTop:14}}>Recall watch</div>
        <div className="row-meta">No active FDA recalls match current inventory.</div>
      </div>
    </div>
  </div>);
}

// ─── ANALYTICS ───
function Analytics() {
  return (<div className="page">
    <PageHead eyebrow="Reporting & analytics" title="Sales" em="cube"
      sub="Slice by hour · day · category · server · daypart. From Toast import + perpetual."/>
    <div className="grid grid-2" style={{marginBottom:18}}>
      <div className="card"><div className="card-eyebrow">Sales by hour × day · this week</div>
        <Heatmap rows={['Mon','Tue','Wed','Thu','Fri','Sat','Sun']}
          cols={['11a','12','1p','2','3','4','5','6','7','8','9','10']}
          data={[
            [12,28,32,18,8,6,18,42,52,48,32,18],
            [10,24,28,16,6,8,22,46,58,54,38,20],
            [14,30,34,20,8,10,28,52,62,58,42,24],
            [16,32,38,22,10,12,32,58,68,64,46,28],
            [22,42,48,28,14,18,42,72,84,82,68,48],
            [28,48,54,34,20,24,52,88,102,98,84,62],
            [32,52,48,30,16,20,38,68,72,64,42,18],
          ]} max={102}/>
      </div>
      <div className="card"><div className="card-eyebrow">Product mix · top 10</div>
        <BarList items={D3.menu.slice(0,10).sort((a,b)=>b.sold-a.sold).map(m=>({l:m.name,v:m.sold,r:`${m.sold}/wk`}))}/>
      </div>
    </div>
    <div className="grid grid-3">
      <div className="card"><div className="card-eyebrow">Daypart split</div>
        <Donut data={[{l:'Lunch',v:38,c:'var(--brass)'},{l:'Happy hr',v:14,c:'var(--ember)'},{l:'Dinner',v:42,c:'var(--ember-deep)'},{l:'Late',v:6,c:'var(--char)'}]}/>
      </div>
      <div className="card"><div className="card-eyebrow">Weather correlation</div>
        <div className="row-meta" style={{marginBottom:8}}>Last 30 days · covers vs daily high °F</div>
        <Scatter data={Array.from({length:30},(_,i)=>({x:60+Math.random()*30,y:180+Math.random()*100}))}/>
        <div className="row-meta" style={{marginTop:6,fontStyle:'italic'}}>+0.42 correlation · warmer = more covers</div>
      </div>
      <div className="card"><div className="card-eyebrow">RevPASH · last 30d</div>
        <div className="serif" style={{fontSize:46}}>$28.40</div>
        <div className="row-meta">Revenue per available seat hour</div>
        <hr/>
        <div className="card-eyebrow">Best hour</div>
        <div style={{fontSize:14,marginTop:4}}>Sat 7-8 PM · <b>$58.20</b> RevPASH</div>
      </div>
    </div>
  </div>);
}

// ─── GUEST EXPERIENCE ───
function Guest() {
  return (<div className="page">
    <PageHead eyebrow="Guest experience" title="What" em="they're saying"
      sub="Yelp · Google · OpenTable · in-house · sentiment scored · routed."/>
    <div className="grid grid-4" style={{marginBottom:18}}>
      <KPI label="Avg rating" value="4.6" sub="488 reviews · 30d" tone="up"/>
      <KPI label="NPS" value="62" sub="excellent" tone="up"/>
      <KPI label="Loyalty members" value="1,284" sub="+82 mo"/>
      <KPI label="Gift card balance" value="$24.4K" sub="outstanding"/>
    </div>
    <div className="grid grid-2">
      <div className="card"><div className="card-eyebrow">Recent reviews</div>
        {[
          {s:'Google',r:5,t:'Best pork chop in the county. Marisol comped my anniversary dessert.',a:'Tunde O.',d:'2d'},
          {s:'Yelp',r:3,t:'Great food, but the wait was long. Music too loud at 9pm.',a:'Jana M.',d:'4d'},
          {s:'OpenTable',r:5,t:'Bramble Hollow show was magic. Trout was perfectly cooked.',a:'Diego P.',d:'5d'},
        ].map((r,i)=>(<div className="row" key={i}>
          <div style={{flex:1}}>
            <div className="split"><div className="row-name">{r.s} · {'★'.repeat(r.r)}{'☆'.repeat(5-r.r)}</div>
              <div className="row-meta">{r.d}</div></div>
            <div style={{fontSize:13,marginTop:4,fontStyle:'italic'}}>"{r.t}"</div>
            <div className="row-meta" style={{marginTop:4}}>— {r.a}</div>
          </div>
        </div>))}
      </div>
      <div className="card"><div className="card-eyebrow">Sentiment by category</div>
        {[
          {c:'Food quality',s:92},{c:'Service',s:84},{c:'Ambiance',s:88},{c:'Value',s:74},{c:'Music/Events',s:91},{c:'Wait time',s:62}
        ].map(c=>(<div className="bar-row" key={c.c}>
          <div style={{width:120,fontSize:13}}>{c.c}</div>
          <div className="bar-track"><div className="bar-fill" style={{width:`${c.s}%`,background:c.s>85?'var(--sage)':c.s>70?'var(--brass)':'var(--rust)'}}/></div>
          <div className="tnum" style={{fontSize:11,width:36,textAlign:'right'}}>{c.s}</div>
        </div>))}
      </div>
    </div>
  </div>);
}

// ─── COMMS / LOGBOOK ───
function Comms() {
  return (<div className="page">
    <PageHead eyebrow="Communications" title="The" em="logbook"
      sub="Manager log · team channels · documents. Searchable history."/>
    <div className="grid" style={{gridTemplateColumns:'220px 1fr',gap:18}}>
      <div className="card flush">
        <div style={{padding:'12px 14px'}}><div className="card-eyebrow">Channels</div></div>
        {['#general (34)','#boh (18)','#foh (12)','#bar (5)','#mgmt (4)','#events (3)'].map((c,i)=>(
          <div key={c} className="row" style={{padding:'10px 14px',borderTop:'1px solid var(--hair)',background:i===0?'var(--paper-2)':'transparent',cursor:'pointer'}}>
            <div className="row-name">{c}</div>
          </div>
        ))}
      </div>
      <div className="card flush" style={{padding:0}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid var(--hair)'}}>
          <div className="card-eyebrow">#general · today</div>
          <div className="serif" style={{fontSize:24}}>Pre-shift broadcast</div>
        </div>
        <div style={{padding:'14px 18px',display:'flex',flexDirection:'column',gap:14}}>
          {[
            {u:'Marisol',role:'GM',t:'Heads up — health inspector likely Mon-Wed. Tighten line checks. Photos to logbook.',ts:'4:12 PM'},
            {u:'Diego',role:'Sous',t:'86 update: trout going off the menu after rush. We have 4 portions left.',ts:'4:28 PM'},
            {u:'Roan',role:'Sound',t:'Bramble Hollow loaded in. Soundcheck at 7:00 sharp. Wedge 2 has hum, swapping.',ts:'5:02 PM'},
            {u:'Polly',role:'Host',t:'Okafor anniversary — T7. Marisol approved chocolate cake comp.',ts:'5:48 PM'},
          ].map((m,i)=>(<div key={i} className="row" style={{padding:0,border:0}}>
            <div className="avatar">{m.u[0]}</div>
            <div style={{flex:1}}>
              <div className="split"><div><b>{m.u}</b> <span className="row-meta">· {m.role}</span></div>
                <div className="row-meta">{m.ts}</div></div>
              <div style={{fontSize:14,marginTop:2}}>{m.t}</div>
            </div>
          </div>))}
        </div>
        <div style={{padding:'14px 18px',borderTop:'1px solid var(--hair)'}}>
          <input className="in" placeholder="Write to #general…" style={{width:'100%'}}/>
        </div>
      </div>
    </div>
  </div>);
}

// ─── KITCHEN ASSISTANT ───
function Assistant() {
  const [msgs] = uS3([
    {who:'me',t:"What's on the books for tomorrow night?"},
    {who:'ai',t:"Sunday Apr 26 — 184 reservations covering 218 guests. Two parties of 10+: the Alvaredo rehearsal dinner (BEO-2026-118, prix-fixe, 18 guests, 6:30) and a corporate group of 12 at 7:45. Three shellfish allergies on the books, one tree nut. Bramble Hollow loads in at 4:30 — soundcheck 6, doors 8."},
    {who:'me',t:"Build me tomorrow's prep list."},
    {who:'ai',t:"Generated. 22 items, 12 already at par. Top three to pre-stage: aji verde (need 2 qt, have 0.5), green chile (need 8 qt, have 2 — also feeds the BEO), bacon jam (4 qt batch). Estimated ETA from one prep cook: 4h 20m. Want me to print FIFO labels and assign to Esteban?"},
  ]);
  return (<div className="page">
    <PageHead eyebrow="Kitchen assistant" title="Ask" em="anything"
      sub="Grounded in live data — recipes, inventory, sales, BEOs, allergens."/>
    <div className="card flush" style={{maxWidth:880,margin:'0 auto',display:'flex',flexDirection:'column',height:560}}>
      <div style={{flex:1,overflowY:'auto',padding:24,display:'flex',flexDirection:'column',gap:16}}>
        {msgs.map((m,i)=>(<div key={i} className={`bubble ${m.who}`}>{m.t}</div>))}
      </div>
      <div style={{padding:16,borderTop:'1px solid var(--hair)',display:'flex',gap:8}}>
        <input className="in" placeholder="Ask the kitchen anything…" style={{flex:1}}/>
        <button className="btn primary">Ask</button>
      </div>
    </div>
  </div>);
}

Object.assign(window, { GM, PL, Owner, Accounting, HR, Inventory, HACCP, Analytics, Guest, Comms, Assistant });
