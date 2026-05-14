// LaRiOS · Event + entertainment artboards
// BEO desktop · Stage manager · Public signage · Owner brief

const { useState: useStateE } = React;

/* ── 9. BEO DESKTOP — event coordinator ─────────────── */
function BEODesktop(){
  const beo = window.LARIOS.beo;
  return (
    <div style={{width:1440,height:920,display:'flex',flexDirection:'column',background:'var(--bg)',overflow:'hidden',position:'relative'}}>
      <div style={{padding:'14px 22px',borderBottom:'1px solid var(--hair)',display:'flex',alignItems:'center',gap:14,background:'var(--cream)'}}>
        <window.LariSigil size={22}/>
        <div>
          <div className="eyebrow">09 · EVENT COORDINATOR · BEO</div>
          <div className="title-md">Banquet Event Order · {beo.id}</div>
        </div>
        <span className="pill ember" style={{marginLeft:'auto'}}>Tonight · cocktail phase</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 380px',flex:1,minHeight:0}}>
        <main style={{padding:'24px 28px',overflow:'auto'}} className="scroll">
          <div className="eyebrow">Saturday May 16 · 142 guests · plated 4-course</div>
          <div className="title-xl" style={{margin:'4px 0 4px'}}>{beo.title}, <em>welcomed.</em></div>
          <div className="muted" style={{fontSize:13,maxWidth:640}}>Cross-domain BEO. Every change here ripples through kitchen pacing, bar forecast, stage call sheet, and tonight's payroll.</div>

          {/* Timeline */}
          <div style={{marginTop:24}}>
            <div className="split" style={{marginBottom:8}}>
              <div className="title-md">Tonight's timeline</div>
              <div className="muted mono" style={{fontSize:11}}>auto-syncs to KDS / Bar / Stage</div>
            </div>
            <div className="surface" style={{padding:0,overflow:'hidden'}}>
              <div style={{position:'relative',padding:'24px 24px 18px'}}>
                <div style={{position:'absolute',left:24,right:24,top:46,height:2,background:'var(--hair)'}}/>
                <div style={{position:'absolute',left:24,top:46,width:'62%',height:2,background:'var(--ember)'}}/>
                <div style={{display:'grid',gridTemplateColumns:`repeat(${beo.schedule.length},1fr)`,gap:4}}>
                  {beo.schedule.map((s,i)=>{
                    const isNow = s.group==='now';
                    const isPast = s.group==='pre';
                    return (
                      <div key={i} style={{position:'relative',paddingTop:32,textAlign:'center'}}>
                        <div style={{position:'absolute',top:18,left:'50%',transform:'translateX(-50%)',
                          width: isNow?14:8,height:isNow?14:8,borderRadius:'50%',
                          background: isNow?'var(--ember)':isPast?'var(--char)':'var(--cream)',
                          border: `2px solid ${isNow?'var(--ember)':isPast?'var(--char)':'var(--hair)'}`,
                          boxShadow: isNow?'0 0 0 5px rgba(200,90,42,.18)':'none'}}/>
                        <div className="mono" style={{fontSize:10,letterSpacing:'.14em',color: isNow?'var(--ember-deep)':'var(--muted)',fontWeight:isNow?700:400}}>{s.t}</div>
                        <div style={{fontSize:11,marginTop:4,lineHeight:1.3,color:isPast?'var(--muted)':'var(--ink)'}}>{s.what}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Cross-domain mesh */}
          <div className="grid g3" style={{marginTop:24}}>
            <div className="surface" style={{padding:16}}>
              <div className="eyebrow">→ Kitchen impact</div>
              <div className="title-md" style={{marginTop:4}}>BOH pacing locked</div>
              <ul style={{margin:'8px 0',paddingLeft:18,fontSize:13,lineHeight:1.7}}>
                <li>Course 3 fire @ 8:45 · auto-set</li>
                <li>2 allergen flags propagated</li>
                <li>Crew meal · drummer veg @ 9:30</li>
              </ul>
              <button className="btn xs">View KDS feed →</button>
            </div>
            <div className="surface" style={{padding:16}}>
              <div className="eyebrow">→ Bar impact</div>
              <div className="title-md" style={{marginTop:4}}>4.1 drinks/guest</div>
              <ul style={{margin:'8px 0',paddingLeft:18,fontSize:13,lineHeight:1.7}}>
                <li>3 signature cocktails active</li>
                <li>Set-break surge auto-staffed</li>
                <li>No shots after 11:30 (enforced)</li>
              </ul>
              <button className="btn xs">Bar program →</button>
            </div>
            <div className="surface" style={{padding:16}}>
              <div className="eyebrow">→ Stage impact</div>
              <div className="title-md" style={{marginTop:4}}>Bramble Riders · loaded</div>
              <ul style={{margin:'8px 0',paddingLeft:18,fontSize:13,lineHeight:1.7}}>
                <li>Set 1 · 9:30 (after cake)</li>
                <li>Mezz dB cap · 92</li>
                <li>Rider · 5 items honored</li>
              </ul>
              <button className="btn xs">Open stage call →</button>
            </div>
          </div>

          {/* Menu + bar grid */}
          <div className="grid g2" style={{marginTop:18}}>
            <div className="surface" style={{padding:18}}>
              <div className="eyebrow">Menu · 4-course</div>
              <div style={{marginTop:8,fontFamily:'var(--serif)',fontSize:15,lineHeight:1.7}}>
                <div><i>Canapés</i> — {beo.menu.canape.join(' · ')}</div>
                <div style={{marginTop:8}}><i>I.</i> {beo.menu.course1}</div>
                <div style={{marginTop:4}}><i>II.</i> {beo.menu.course2}</div>
                <div style={{marginTop:4}}><i>III.</i> {beo.menu.course3a}</div>
                <div style={{marginLeft:18,color:'var(--muted)',fontSize:13}}>· {beo.menu.course3b}</div>
                <div style={{marginLeft:18,color:'var(--muted)',fontSize:13}}>· {beo.menu.course3c}</div>
                <div style={{marginTop:4}}><i>IV.</i> {beo.menu.dessert}</div>
              </div>
            </div>
            <div className="surface" style={{padding:18}}>
              <div className="eyebrow">Special accommodations</div>
              <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:10}}>
                {[
                  ['Bride · gluten-free entrée','T-12, S-1','GF'],
                  ['Officiant · vegan','T-7, S-2','VG'],
                  ['Drummer · vegetarian','Backstage 9:30','VEG'],
                  ['Guest #41 · shellfish allergy','T-19, S-3','⚠ allergen'],
                  ['Guest #88 · nut allergy','T-11, S-5','⚠ allergen']
                ].map((a,i)=>(
                  <div key={i} className="split" style={{padding:'8px 10px',background:'var(--paper-2)',borderRadius:3}}>
                    <span style={{fontSize:13}}>{a[0]} <span className="muted mono" style={{fontSize:10,marginLeft:6}}>{a[1]}</span></span>
                    <span className="pill warn">{a[2]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
        <aside style={{borderLeft:'1px solid var(--hair)',background:'var(--cream)',display:'flex',flexDirection:'column'}}>
          <div style={{padding:18,borderBottom:'1px solid var(--hair)'}}>
            <div className="eyebrow">Headcounts · live</div>
            <div style={{display:'flex',gap:14,marginTop:8}}>
              <div><div style={{fontFamily:'var(--serif)',fontSize:34,lineHeight:1}}>142</div><div className="muted mono" style={{fontSize:10}}>SEATED</div></div>
              <div><div style={{fontFamily:'var(--serif)',fontSize:34,lineHeight:1,color:'var(--sage-deep)'}}>118</div><div className="muted mono" style={{fontSize:10}}>ON-PATIO</div></div>
              <div><div style={{fontFamily:'var(--serif)',fontSize:34,lineHeight:1,color:'var(--ember-deep)'}}>5</div><div className="muted mono" style={{fontSize:10}}>BAND</div></div>
            </div>
          </div>
          <div style={{padding:18,borderBottom:'1px solid var(--hair)'}}>
            <div className="eyebrow">Contacts</div>
            <div style={{marginTop:8,fontSize:13,lineHeight:1.7}}>
              <div><b>{beo.contact.primary}</b><br/><span className="mono muted" style={{fontSize:11}}>{beo.contact.phone}</span></div>
              <div style={{marginTop:6}}><b>{beo.contact.planner}</b><br/><span className="muted" style={{fontSize:11}}>Veil & Vine</span></div>
            </div>
          </div>
          <div style={{padding:18,flex:1,overflow:'auto'}} className="scroll">
            <div className="eyebrow">LaRi · coordinator brief</div>
            <window.LariHUD role="coord" title="LaRi · BEO watch"/>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ── 10. STAGE MANAGER · DESKTOP ─────────────────────────── */
function StageMgr(){
  const band = window.LARIOS.beo.band;
  const [tab,setTab] = useStateE('set');
  return (
    <div className="k-night" style={{width:1440,height:920,display:'flex',flexDirection:'column',overflow:'hidden',position:'relative'}}>
      <div style={{padding:'14px 22px',borderBottom:'1px solid #3a2f4f',display:'flex',alignItems:'center',gap:14,background:'#15121f'}}>
        <window.LariSigil size={22}/>
        <div>
          <div style={{fontFamily:'var(--mono)',fontSize:10,letterSpacing:'.24em',color:'#9c8fbf'}}>10 · STAGE MGR · SOUND</div>
          <div style={{fontFamily:'var(--serif)',fontSize:22,color:'#ece2cf',lineHeight:1}}>{band.name} · Mezzanine</div>
        </div>
        <span className="pill" style={{marginLeft:'auto',background:'#c85a2a',color:'#1a1308'}}>SET 1 · 9:30 PM</span>
      </div>
      <div className="tabs" style={{padding:'0 22px',borderBottom:'1px solid #3a2f4f',background:'#15121f'}}>
        {[['Set / queue','set'],['Stage plot','plot'],['dB & monitors','db'],['Rider & notes','rider'],['Artist memory','memory']].map(([l,k])=>(
          <button key={k} onClick={()=>setTab(k)} className={tab===k?'on':''} style={{color:tab===k?'#ece2cf':'#9c8fbf'}}>{l}</button>
        ))}
      </div>

      <div style={{flex:1,padding:'22px 26px',display:'grid',gridTemplateColumns:'1fr 380px',gap:18,overflow:'auto'}} className="scroll">
        <div>
          {tab==='set' && <SetList/>}
          {tab==='plot' && <StagePlot band={band}/>}
          {tab==='db'   && <DBPanel/>}
          {tab==='rider'&& <RiderTab band={band}/>}
          {tab==='memory'&& <ArtistMemory band={band}/>}
        </div>
        <aside style={{display:'flex',flexDirection:'column',gap:14}}>
          <div className="lari-surface" style={{padding:14}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <window.LariOrb/>
              <div style={{fontFamily:'var(--mono)',fontSize:9.5,letterSpacing:'.24em',color:'#e8a04a'}}>LARI · STAGE</div>
            </div>
            <div style={{fontFamily:'var(--serif)',fontSize:20,color:'#ece2cf',lineHeight:1.2,marginTop:6}}>
              Cake cut moves to 9:30. Push set 1 to 9:38?
            </div>
            <div style={{display:'flex',gap:6,marginTop:10}}>
              <button className="btn xs primary">Push 8 min</button>
              <button className="btn xs" style={{background:'transparent',color:'#9c8fbf',border:'1px solid #3a2f4f'}}>Keep</button>
            </div>
          </div>
          <div className="surface" style={{padding:14,background:'#1d1828',borderColor:'#3a2f4f',color:'#ece2cf'}}>
            <div style={{fontFamily:'var(--mono)',fontSize:9.5,letterSpacing:'.24em',color:'#9c8fbf'}}>BAND ON SITE</div>
            <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:6}}>
              {[['Jonah Castille','lead vocal · acoustic'],['Sara McAdams','drums · vegetarian'],['Wes Park','bass'],['Lucia Romm','fiddle · stage L'],['Eli Dorn','keys']].map(([n,r],i)=>(
                <div key={i} className="split" style={{fontSize:12.5}}>
                  <b>{n}</b><span style={{color:'#9c8fbf',fontFamily:'var(--mono)',fontSize:10}}>{r}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="surface" style={{padding:14,background:'#1d1828',borderColor:'#3a2f4f',color:'#ece2cf'}}>
            <div style={{fontFamily:'var(--mono)',fontSize:9.5,letterSpacing:'.24em',color:'#9c8fbf'}}>RUN OF SHOW</div>
            <div style={{marginTop:8,fontSize:12,lineHeight:1.6}}>
              <div>9:30 · cake cut · house dim 40%</div>
              <div>9:35 · band intro by MOH</div>
              <div>9:38 · set 1 · 45 min</div>
              <div>10:23 · set break · prebatch</div>
              <div>10:38 · set 2 · 50 min</div>
              <div>12:00 · last call · load-out</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SetList(){
  const songs = [
    ['1','Wagon Wheel (open)','Cover · key D','4:12','requested by bride'],
    ['2','House of the Rising Sun','Cover · key A min','5:08',''],
    ['3','Original · "Burning Bridges"','original','4:30','—'],
    ['4','First dance · "Marigold"','custom','5:55','recorded by bride'],
    ['5','Father-daughter · "Landslide"','cover','4:18',''],
    ['6','Take It Easy','cover','3:34','requested'],
    ['7','Original · "Sundogs"','original','3:58',''],
    ['8','Long Black Veil','cover','4:02','encore?'],
  ];
  return (
    <div className="surface" style={{padding:18,background:'#1d1828',borderColor:'#3a2f4f',color:'#ece2cf'}}>
      <div className="split">
        <div style={{fontFamily:'var(--serif)',fontSize:24}}>Set 1 · queue</div>
        <button className="btn xs primary">＋ Add song</button>
      </div>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,marginTop:14}}>
        <thead><tr>{['#','Song','Type / key','Len','Notes',''].map(h=><th key={h} style={{textAlign:'left',padding:'8px 6px',borderBottom:'1px solid #3a2f4f',fontFamily:'var(--mono)',fontSize:9.5,letterSpacing:'.22em',color:'#9c8fbf'}}>{h}</th>)}</tr></thead>
        <tbody>
          {songs.map((s,i)=>(
            <tr key={i}>
              <td className="mono" style={{padding:'10px 6px',color:'#9c8fbf'}}>{s[0]}</td>
              <td style={{padding:'10px 6px',fontWeight:600,fontFamily:'var(--serif)',fontSize:16}}>{s[1]}</td>
              <td style={{padding:'10px 6px',fontFamily:'var(--mono)',fontSize:11,color:'#9c8fbf'}}>{s[2]}</td>
              <td style={{padding:'10px 6px',fontFamily:'var(--mono)',fontSize:11}}>{s[3]}</td>
              <td style={{padding:'10px 6px',fontSize:11,color:'#e8a04a'}}>{s[4]}</td>
              <td style={{padding:'10px 6px',textAlign:'right'}}><button className="btn xs" style={{background:'transparent',color:'#9c8fbf',border:'1px solid #3a2f4f'}}>↕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{marginTop:14,padding:12,background:'rgba(200,90,42,.12)',border:'1px solid #5b2410',borderRadius:4,fontSize:12,display:'flex',gap:10}}>
        <window.LariOrb size="sm"/>
        <div>
          <span style={{fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.24em',color:'#e8a04a'}}>LARI · SETLIST READ</span><br/>
          Bride's mother previously requested "Have You Ever Seen the Rain" (per 2024 family rehearsal dinner). Want me to suggest adding it?
        </div>
      </div>
    </div>
  );
}

function StagePlot({ band }){
  return (
    <div className="surface" style={{padding:18,background:'#1d1828',borderColor:'#3a2f4f',color:'#ece2cf'}}>
      <div className="split">
        <div style={{fontFamily:'var(--serif)',fontSize:24}}>Stage plot · Mezzanine</div>
        <div style={{display:'flex',gap:6}}>
          <button className="btn xs" style={{background:'transparent',color:'#9c8fbf',border:'1px solid #3a2f4f'}}>Edit</button>
          <button className="btn xs primary">Print riser</button>
        </div>
      </div>
      <div style={{position:'relative',height:380,background:'#0c0a14',border:'1px solid #3a2f4f',borderRadius:6,marginTop:14}}>
        {/* riser outline */}
        <div style={{position:'absolute',inset:24,border:'1px dashed #5b3a5a',borderRadius:4}}/>
        {/* downstage label */}
        <div style={{position:'absolute',bottom:6,left:'50%',transform:'translateX(-50%)',fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.32em',color:'#9c8fbf'}}>↓ AUDIENCE ↓</div>
        {/* gear */}
        {[
          ['Drums · Sara',     270,150, 130, 90, '#c85a2a'],
          ['Bass amp · Wes',   430,180, 100, 60, '#3a5a7a'],
          ['Keys · Eli',       430,90,  100, 60, '#5b3a5a'],
          ['Lead vox · Jonah', 180,200, 80,  60, '#b8892f'],
          ['Fiddle · Lucia',   80,150,  80,  60, '#5d7a66'],
          ['Monitor 1',        180,290, 60,  20, '#3a3530'],
          ['Monitor 2',        280,290, 60,  20, '#3a3530'],
        ].map((g,i)=>(
          <div key={i} style={{position:'absolute',left:g[1],top:g[2],width:g[3],height:g[4],
            background:g[5]+'33',border:'1.5px solid '+g[5],borderRadius:3,
            display:'flex',alignItems:'center',justifyContent:'center',
            fontSize:11,fontFamily:'var(--mono)',color:'#ece2cf',letterSpacing:'.04em',textAlign:'center',padding:4}}>{g[0]}</div>
        ))}
        {/* DI / cable runs */}
        <svg style={{position:'absolute',inset:0,pointerEvents:'none'}} viewBox="0 0 600 360" preserveAspectRatio="none">
          <path d="M 100 320 L 100 180" stroke="#5b3a5a" strokeWidth=".8" strokeDasharray="3 3" fill="none"/>
          <path d="M 200 320 L 200 230" stroke="#5b3a5a" strokeWidth=".8" strokeDasharray="3 3" fill="none"/>
          <path d="M 300 320 L 300 180" stroke="#5b3a5a" strokeWidth=".8" strokeDasharray="3 3" fill="none"/>
        </svg>
        <div style={{position:'absolute',top:10,right:14,fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.22em',color:'#9c8fbf'}}>↑ STAGE LEFT (Lucia)</div>
        <div style={{position:'absolute',top:30,right:14,fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.22em',color:'#9c8fbf'}}>↓ STAGE RIGHT (amps)</div>
      </div>
      <div style={{display:'flex',gap:14,marginTop:12,fontSize:11,fontFamily:'var(--mono)',letterSpacing:'.16em',textTransform:'uppercase',color:'#9c8fbf'}}>
        <span><span className="dot" style={{background:'#c85a2a',marginRight:6,verticalAlign:'middle'}}/>Drums</span>
        <span><span className="dot" style={{background:'#3a5a7a',marginRight:6,verticalAlign:'middle'}}/>Amps</span>
        <span><span className="dot" style={{background:'#5b3a5a',marginRight:6,verticalAlign:'middle'}}/>Keys</span>
        <span><span className="dot" style={{background:'#b8892f',marginRight:6,verticalAlign:'middle'}}/>Vox</span>
        <span><span className="dot" style={{background:'#5d7a66',marginRight:6,verticalAlign:'middle'}}/>Strings</span>
      </div>
    </div>
  );
}

function DBPanel(){
  // synthetic dB readings
  const bars = [62,66,71,74,72,78,82,84,86,88,87,84,80,76,72,70,68,66,64,62,60,62,64,66,68,70,72,74];
  const max = 92;
  return (
    <div className="surface" style={{padding:18,background:'#1d1828',borderColor:'#3a2f4f',color:'#ece2cf'}}>
      <div className="split">
        <div style={{fontFamily:'var(--serif)',fontSize:24}}>Decibel meter</div>
        <div style={{display:'flex',gap:6}}>
          <span className="pill" style={{background:'#3a2f4f',color:'#ece2cf',border:0}}>FOH</span>
          <span className="pill" style={{background:'transparent',color:'#9c8fbf',border:'1px solid #3a2f4f'}}>Mezz</span>
          <span className="pill" style={{background:'transparent',color:'#9c8fbf',border:'1px solid #3a2f4f'}}>Patio</span>
        </div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:24,marginTop:14}}>
        <div style={{fontFamily:'var(--serif)',fontSize:96,lineHeight:.85,color:'#e8784a',fontWeight:400}}>88<span style={{fontSize:32,color:'#9c8fbf'}}>dB</span></div>
        <div style={{flex:1}}>
          <div className="split" style={{fontFamily:'var(--mono)',fontSize:10,color:'#9c8fbf',letterSpacing:'.16em'}}>
            <span>SOUNDCHECK · 30s rolling</span><span>CAP: {max}dB</span>
          </div>
          <div style={{display:'flex',gap:2,alignItems:'flex-end',height:80,marginTop:6}}>
            {bars.map((b,i)=>(
              <div key={i} style={{flex:1,height:`${(b/max)*100}%`,
                background:b>=85?'#c85a2a':b>=78?'#b8892f':'#5d7a66',borderRadius:1}}/>
            ))}
          </div>
          <div className="split mono" style={{fontSize:10,color:'#9c8fbf',marginTop:4,letterSpacing:'.16em'}}>
            <span>−30s</span><span>now</span>
          </div>
        </div>
      </div>
      <div style={{marginTop:18,padding:12,background:'rgba(200,90,42,.10)',border:'1px solid #c85a2a',borderRadius:4,display:'flex',gap:10}}>
        <window.LariOrb size="sm"/>
        <div style={{fontSize:12.5}}>
          <span style={{fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.24em',color:'#e8a04a'}}>LARI · ALERT</span><br/>
          Patio readings 88dB — 4 over the cocktail-phase target (84). Trim FOH-R by 3dB or stop drum check.
        </div>
      </div>
      <div className="grid g3" style={{marginTop:18,gap:10}}>
        {[['FOH-L','82'],['FOH-R','86'],['Sub','78'],['Mon 1','74'],['Mon 2','71'],['IEM-A','62']].map(([n,v],i)=>(
          <div key={i} style={{padding:12,background:'#0c0a14',border:'1px solid #3a2f4f',borderRadius:4}}>
            <div className="split">
              <span style={{fontFamily:'var(--mono)',fontSize:10,color:'#9c8fbf',letterSpacing:'.22em'}}>{n}</span>
              <span style={{fontFamily:'var(--serif)',fontSize:20,color:'#ece2cf'}}>{v}</span>
            </div>
            <div className="bar" style={{marginTop:6,background:'#3a2f4f'}}>
              <i style={{width:`${(Number(v)/92)*100}%`,background:Number(v)>82?'#c85a2a':'#5d7a66'}}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RiderTab({ band }){
  return (
    <div className="surface" style={{padding:18,background:'#1d1828',borderColor:'#3a2f4f',color:'#ece2cf'}}>
      <div style={{fontFamily:'var(--serif)',fontSize:24}}>Rider · {band.name}</div>
      <div className="muted mono" style={{fontSize:10,letterSpacing:'.22em',color:'#9c8fbf',marginTop:4}}>tonight · checked & honored</div>
      <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:8}}>
        {band.rider.map((r,i)=>(
          <label key={i} style={{display:'flex',gap:10,alignItems:'center',padding:'10px 12px',background:'#15121f',border:'1px solid #3a2f4f',borderRadius:4}}>
            <input type="checkbox" defaultChecked={i<5} style={{width:16,height:16,accentColor:'#c85a2a'}}/>
            <span style={{flex:1,fontSize:13}}>{r}</span>
            <span className="mono" style={{fontSize:10,color:i<5?'#5d7a66':'#9c8fbf'}}>{i<5?'done':'pending'}</span>
          </label>
        ))}
      </div>
      <div style={{marginTop:18,padding:14,background:'#15121f',border:'1px solid #3a2f4f',borderRadius:4}}>
        <div style={{fontFamily:'var(--mono)',fontSize:9.5,letterSpacing:'.24em',color:'#e8a04a'}}>SPECIAL REQUESTS · NIGHT-OF</div>
        <textarea placeholder="Anything new from the band — log here so it's remembered next time."
          style={{width:'100%',marginTop:8,background:'#0c0a14',border:'1px solid #3a2f4f',color:'#ece2cf',
            padding:10,borderRadius:3,minHeight:80,fontFamily:'inherit',fontSize:13,resize:'vertical'}}>Sara asked for ice water on the riser between songs 3 and 4.</textarea>
        <div style={{display:'flex',gap:6,marginTop:8}}>
          <button className="btn xs primary">Save to artist memory</button>
          <button className="btn xs" style={{background:'transparent',color:'#9c8fbf',border:'1px solid #3a2f4f'}}>Notify expo</button>
        </div>
      </div>
    </div>
  );
}

function ArtistMemory({ band }){
  return (
    <div className="surface" style={{padding:18,background:'#1d1828',borderColor:'#3a2f4f',color:'#ece2cf'}}>
      <div className="split">
        <div>
          <div style={{fontFamily:'var(--serif)',fontSize:24}}>Artist memory</div>
          <div className="muted mono" style={{fontSize:10,letterSpacing:'.22em',color:'#9c8fbf',marginTop:4}}>everything we've learned about {band.name}</div>
        </div>
        <button className="btn xs primary">＋ Add note</button>
      </div>
      <div style={{marginTop:16,display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <div>
          <div className="eyebrow" style={{color:'#9c8fbf'}}>Food & drink</div>
          <ul style={{margin:'8px 0',paddingLeft:18,fontSize:13,lineHeight:1.7}}>
            <li>Sara · strict vegetarian, no mushrooms</li>
            <li>Jonah · prefers hot black tea pre-set</li>
            <li>Wes · gluten sensitivity, not celiac</li>
            <li>Whole band · loves the olive oil cake</li>
            <li>No alcohol on stage during sets (rule)</li>
          </ul>
        </div>
        <div>
          <div className="eyebrow" style={{color:'#9c8fbf'}}>Audio & stage</div>
          <ul style={{margin:'8px 0',paddingLeft:18,fontSize:13,lineHeight:1.7}}>
            <li>Lucia always stage left — sight line for cues</li>
            <li>IEM mix 2 hot on Lucia's fiddle</li>
            <li>Drums one foot back-of-center for tight rooms</li>
            <li>Will not play above 96dB FOH</li>
            <li>5 min between sets, exactly</li>
          </ul>
        </div>
        <div style={{gridColumn:'span 2'}}>
          <div className="eyebrow" style={{color:'#9c8fbf'}}>Performance history</div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5,marginTop:6}}>
            <thead><tr>{['Date','Event','Vibe','Notes'].map(h=><th key={h} style={{textAlign:'left',padding:6,borderBottom:'1px solid #3a2f4f',fontFamily:'var(--mono)',fontSize:9.5,letterSpacing:'.22em',color:'#9c8fbf'}}>{h}</th>)}</tr></thead>
            <tbody>{[
              ['2025-09-12','Album release','5★','Encore added · "Sundogs" got the loudest cheer'],
              ['2025-06-04','Private wedding','4★','Set 2 ran 7 min long · OK with venue'],
              ['2025-02-18','Tuesday residency','4★','Asked for honey for tea after the set']
            ].map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j} style={{padding:'8px 6px',borderBottom:'1px dashed #3a2f4f'}}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── 11. OWNER BRIEF · DESKTOP ─────────────────────────── */
function OwnerBrief(){
  return (
    <div style={{width:1440,height:920,display:'flex',flexDirection:'column',background:'var(--bg)',overflow:'hidden',position:'relative'}}>
      <div style={{padding:'14px 22px',borderBottom:'1px solid var(--hair)',display:'flex',alignItems:'center',gap:14,background:'var(--cream)'}}>
        <window.LariSigil size={22}/>
        <div>
          <div className="eyebrow">11 · OWNERSHIP · WEEKLY BRIEF</div>
          <div className="title-md">The week, distilled</div>
        </div>
        <span className="pill ink" style={{marginLeft:'auto'}}>Week 20 · May 11–17</span>
      </div>
      <main style={{padding:'30px 36px',flex:1,overflow:'auto'}} className="scroll">
        <div className="eyebrow">For Owner · A. Whitlock</div>
        <div className="title-xl" style={{margin:'4px 0 8px'}}>A confident week, with <em>two notes</em>.</div>
        <div className="muted" style={{fontSize:14,maxWidth:680,lineHeight:1.5}}>Net positive. Wedding income lifted the period; refrigeration repair appears in OPEX. LaRi suggests two strategic moves below.</div>

        <div className="grid g4" style={{marginTop:24}}>
          {[['Net revenue','$184,210','+9.4% vs LW','up'],['Food cost %','28.4','-1.1pt','up'],['Labor %','24.7','+0.6pt','warn'],['Guest sentiment','4.7','steady','up']].map((k,i)=>(
            <div key={i} className="kpi" style={{padding:'18px 20px'}}>
              <div className="kpi-l">{k[0]}</div>
              <div className="kpi-v" style={{fontSize:48}}>{k[1]}</div>
              <div className={`kpi-s ${k[3]}`}>{k[2]}</div>
            </div>
          ))}
        </div>

        <div className="grid g2" style={{marginTop:24}}>
          <div className="surface" style={{padding:22}}>
            <div className="eyebrow">LaRi · strategic notes</div>
            <div style={{display:'flex',flexDirection:'column',gap:14,marginTop:10}}>
              <div style={{padding:14,background:'rgba(200,90,42,.06)',borderLeft:'3px solid var(--ember)'}}>
                <div className="title-md">Hire 1 floater bartender by June 1.</div>
                <div className="muted" style={{fontSize:13,marginTop:4}}>Hana solos 3 set-break surges/week. Throughput cap leaves ~$3.2k/wk on the table. Payback &lt; 6 weeks.</div>
              </div>
              <div style={{padding:14,background:'rgba(184,137,47,.10)',borderLeft:'3px solid var(--brass)'}}>
                <div className="title-md">Lock olive oil cake as your $14 sweet anchor.</div>
                <div className="muted" style={{fontSize:13,marginTop:4}}>Repeat-order rate 41%, food cost 18%. Best margin per dessert this quarter.</div>
              </div>
              <div style={{padding:14,background:'rgba(139,46,31,.08)',borderLeft:'3px solid var(--rust)'}}>
                <div className="title-md">Refrigeration #2 needs a decision.</div>
                <div className="muted" style={{fontSize:13,marginTop:4}}>Third repair in 14 months. Replace ($8.4k) recovers in 11 weeks at current loss-of-product trend.</div>
              </div>
            </div>
          </div>
          <div className="surface" style={{padding:22}}>
            <div className="eyebrow">Cash · last 8 weeks</div>
            <svg viewBox="0 0 400 200" style={{width:'100%',height:180,marginTop:8}}>
              <polyline points="0,140 50,120 100,130 150,90 200,100 250,70 300,80 350,50 400,40"
                fill="none" stroke="var(--ember)" strokeWidth="2"/>
              <polyline points="0,140 50,120 100,130 150,90 200,100 250,70 300,80 350,50 400,40 400,200 0,200"
                fill="var(--ember)" opacity=".08"/>
              {[0,50,100,150,200,250,300,350].map((x,i)=>(<circle key={i} cx={x} cy={[140,120,130,90,100,70,80,50][i]} r="3" fill="var(--ember-deep)"/>))}
            </svg>
            <div className="eyebrow" style={{marginTop:18}}>Distributions · scenario</div>
            <div style={{marginTop:8,padding:14,background:'var(--panel)',border:'1px solid var(--hair)',borderRadius:4}}>
              <div className="split">
                <div><div style={{fontFamily:'var(--serif)',fontSize:28}}>$24,800</div><div className="muted mono" style={{fontSize:10}}>available this period</div></div>
                <button className="btn primary sm">Approve distribution</button>
              </div>
            </div>
          </div>
        </div>

        <div className="surface" style={{padding:22,marginTop:18}}>
          <div className="eyebrow">Upcoming · 4 weeks</div>
          <div className="grid g4" style={{marginTop:8}}>
            {[['May 23','Park × Liu wedding · 160',true],['May 25','Memorial Day · holiday menu',false],['May 27','Wine dinner ticketed',true],['May 30','Adler wedding · The Ferns',true]].map((e,i)=>(
              <div key={i} style={{padding:14,border:'1px solid var(--hair)',borderRadius:4,background:'var(--cream)'}}>
                <div className="mono" style={{fontSize:10,letterSpacing:'.22em',color:'var(--muted)'}}>{e[0]}</div>
                <div style={{fontFamily:'var(--serif)',fontSize:18,marginTop:4}}>{e[1]}</div>
                {e[2] && <span className="pill ember" style={{marginTop:8,display:'inline-flex'}}>revenue event</span>}
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ── 12. PUBLIC SIGNAGE · 1920 × 1080 ─────────────────── */
function Signage(){
  return (
    <div className="k-night" style={{width:1920,height:1080,position:'relative',overflow:'hidden',
      background:'radial-gradient(circle at 50% 30%, #2a1832 0%, #0c0a14 75%)'}}>
      <div style={{position:'absolute',inset:0,
        backgroundImage:`repeating-linear-gradient(45deg, rgba(200,90,42,.04) 0 1px, transparent 1px 12px)`}}/>
      <div style={{position:'absolute',top:42,left:64,right:64,display:'flex',alignItems:'center',gap:16,zIndex:2}}>
        <window.LariSigil size={36}/>
        <div>
          <div style={{fontFamily:'var(--mono)',fontSize:12,letterSpacing:'.32em',color:'#9c8fbf'}}>THE LARIAT · BUENA VISTA · TONIGHT</div>
          <div style={{fontFamily:'var(--serif)',fontSize:34,color:'#ece2cf',lineHeight:1}}>Saturday, May 16</div>
        </div>
        <div style={{marginLeft:'auto',fontFamily:'var(--mono)',fontSize:14,color:'#9c8fbf',letterSpacing:'.18em'}}>6 : 48 PM</div>
      </div>
      <div style={{position:'absolute',top:200,left:64,right:64,zIndex:2}}>
        <div style={{fontFamily:'var(--mono)',fontSize:14,letterSpacing:'.36em',color:'#e8a04a'}}>EATS · LIBATIONS · MUSIC</div>
        <div style={{fontFamily:'var(--serif)',fontSize:160,lineHeight:.88,color:'#ece2cf',marginTop:16}}>
          The <em style={{color:'#e8784a',fontStyle:'italic'}}>Bramble Riders</em>
        </div>
        <div style={{fontFamily:'var(--serif)',fontSize:64,lineHeight:1,color:'#9c8fbf',marginTop:18}}>
          live on the Mezzanine · two sets · 9:30 + 10:38
        </div>
      </div>
      <div style={{position:'absolute',bottom:120,left:64,right:64,display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:32,zIndex:2}}>
        {[
          ['Cocktail hour','now · patio','The Calloway Cup · gin · lavender · cava'],
          ['Plated dinner','seating 8:00','Heirloom tomato · agnolotti · hanger · halibut'],
          ['Late hours','12:00 AM','last call · open bar continues to 11:30']
        ].map((c,i)=>(
          <div key={i}>
            <div style={{fontFamily:'var(--mono)',fontSize:13,letterSpacing:'.28em',color:'#e8a04a'}}>{c[0].toUpperCase()}</div>
            <div style={{fontFamily:'var(--serif)',fontSize:38,color:'#ece2cf',marginTop:6,fontStyle:'italic'}}>{c[1]}</div>
            <div style={{fontFamily:'var(--serif)',fontSize:18,color:'#9c8fbf',marginTop:8,lineHeight:1.4}}>{c[2]}</div>
          </div>
        ))}
      </div>
      <div style={{position:'absolute',bottom:34,left:64,right:64,display:'flex',justifyContent:'space-between',fontFamily:'var(--mono)',fontSize:11,letterSpacing:'.32em',color:'#5b3a5a'}}>
        <span>12 · PUBLIC SIGNAGE · LOBBY 4K</span>
        <span>EVENT-AWARE · AUTO-UPDATED BY LARI</span>
      </div>
    </div>
  );
}

window.BEODesktop = BEODesktop;
window.StageMgr = StageMgr;
window.OwnerBrief = OwnerBrief;
window.Signage = Signage;
