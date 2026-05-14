// LaRiOS · Operational artboards
// Wall KDS · Sous tablet · Bar tablet · Server tablet · Host tablet · Line phone · Inventory tablet

const { useState: useStateO } = React;

/* ── 2. WALL KDS · 1920 × 1080 ─────────────────────────────── */
function WallKDS(){
  const tix = window.LARIOS.tickets;
  return (
    <div className="k-dark" style={{width:1920,height:1080,position:'relative',display:'flex',flexDirection:'column',overflow:'hidden'}}>
      {/* Top rail */}
      <div style={{display:'flex',alignItems:'center',gap:24,padding:'16px 32px',borderBottom:'1px solid #2e2a24',background:'#1a1815'}}>
        <window.LariSigil size={28}/>
        <div>
          <div style={{fontFamily:'var(--mono)',fontSize:11,letterSpacing:'.28em',color:'#a89e8a'}}>02 · WALL KDS · EXPO</div>
          <div style={{fontFamily:'var(--serif)',fontSize:28,color:'#ece2cf',lineHeight:1}}>Garden Hall · Course Three</div>
        </div>
        <div style={{display:'flex',gap:30,marginLeft:'auto',fontFamily:'var(--mono)'}}>
          {[['ON LINE','10','#ece2cf'],['FIRE','3','#c85a2a'],['AVG','12:14','#ece2cf'],['LATE','1','#c85a2a'],['86 RISK','halibut · 38','#b8892f']].map((k,i)=>(
            <div key={i} style={{textAlign:'right'}}>
              <div style={{fontSize:10,letterSpacing:'.24em',color:'#a89e8a'}}>{k[0]}</div>
              <div style={{fontFamily:'var(--serif)',fontSize:32,color:k[2],lineHeight:1}}>{k[1]}</div>
            </div>
          ))}
        </div>
      </div>
      {/* tickets grid */}
      <div style={{flex:1,display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:14,padding:'18px 32px 8px',overflow:'hidden'}}>
        {tix.map(t=>(
          <div key={t.id} style={{
            background: t.pacing==='late'?'#2a1612':'#1a1815',
            border: `1px solid ${t.pacing==='late'?'#8b2e1f':t.status==='fire'?'#c85a2a':'#3a3530'}`,
            borderRadius:6,padding:14,display:'flex',flexDirection:'column',gap:8,
            position:'relative',color:'#ece2cf'
          }}>
            {t.status==='fire' && <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:'var(--ember)'}}/>}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
              <div style={{fontFamily:'var(--mono)',fontSize:14,letterSpacing:'.08em'}}>{t.id}</div>
              <div style={{fontFamily:'var(--serif)',fontSize:24,color: t.pacing==='late'?'#e8784a':t.age>90?'#c85a2a':'#ece2cf'}}>
                {Math.floor(t.age/60)}:{String(t.age%60).padStart(2,'0')}
              </div>
            </div>
            <div style={{fontFamily:'var(--mono)',fontSize:10,letterSpacing:'.2em',color:'#a89e8a'}}>{t.tbl}</div>
            <div style={{fontFamily:'var(--mono)',fontSize:10,letterSpacing:'.28em',color:'#e8a04a'}}>{t.course}</div>
            <div style={{flex:1,fontSize:15,lineHeight:1.4,paddingTop:6,borderTop:'1px dashed #3a3530'}}>
              {t.items.map((it,i)=><div key={i}>{it}</div>)}
            </div>
            {t.allergens && <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
              {t.allergens.map((a,i)=><span key={i} className="pill alert" style={{background:'#3a1612',color:'#e8784a',border:'1px solid #c85a2a',fontFamily:'var(--mono)'}}>⚠ {a}</span>)}
            </div>}
            <div style={{display:'flex',gap:6}}>
              <span className="pill" style={{
                background: t.status==='fire'?'#c85a2a':t.status==='plate'?'#b8892f':t.status==='pickup'?'#5d7a66':'#3a3530',
                color: t.status==='fire'||t.status==='pickup'||t.status==='plate'?'#1a1308':'#ece2cf',
                border:0
              }}>{t.status}</span>
              {t.pacing==='late' && <span className="pill alert" style={{background:'#5b2410',color:'#e8784a'}}>+2m late</span>}
              {t.pacing==='fast' && <span className="pill ok" style={{background:'rgba(93,122,102,.3)',color:'#a8c0ad'}}>+45s ahead</span>}
            </div>
          </div>
        ))}
      </div>
      {/* LaRi ambient strip */}
      <div style={{padding:'8px 32px 18px'}}>
        <window.LariAmbient role="expo"/>
      </div>
    </div>
  );
}

/* ── 3. SOUS · TABLET 1024×768 ─────────────────────────────── */
function SousTablet(){
  return (
    <div className="k-dark" style={{width:1024,height:768,display:'flex',flexDirection:'column',overflow:'hidden',position:'relative'}}>
      <div style={{padding:'14px 22px',borderBottom:'1px solid #2e2a24',display:'flex',alignItems:'center',gap:14,background:'#1a1815'}}>
        <window.LariSigil size={22}/>
        <div>
          <div style={{fontFamily:'var(--mono)',fontSize:10,letterSpacing:'.26em',color:'#a89e8a'}}>03 · SOUS · MISE</div>
          <div style={{fontFamily:'var(--serif)',fontSize:22,color:'#ece2cf',lineHeight:1}}>Renata · Course 3 mise</div>
        </div>
        <span className="pill" style={{marginLeft:'auto',background:'#c85a2a',color:'#1a1308'}}>cocktail phase</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',flex:1,gap:0}}>
        {/* Prep checklist */}
        <div style={{padding:18,borderRight:'1px solid #2e2a24'}}>
          <div className="eyebrow" style={{color:'#a89e8a'}}>Fire by 8:25</div>
          <div className="title-md" style={{color:'#ece2cf',marginTop:4}}>Mise checklist</div>
          <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:10}}>
            {[
              ['Wagyu hangers portioned · 24 of 24',true],
              ['Halibut filets butchered · 12 of 12',true],
              ['Marrow jus reduced',true],
              ['Sunchoke roasted · 2 hotels',false],
              ['Farro cooked, oiled, held',false],
              ['Carrot batons blanched · 20 vegan',false],
              ['Garnish trays staged at expo',false]
            ].map((it,i)=>(
              <label key={i} style={{display:'flex',gap:10,alignItems:'center',padding:'10px 12px',
                background:it[1]?'rgba(93,122,102,.12)':'#1a1815',border:'1px solid '+(it[1]?'#3a4f3e':'#3a3530'),borderRadius:4,color:'#ece2cf'}}>
                <input type="checkbox" defaultChecked={it[1]} style={{width:18,height:18,accentColor:'#c85a2a'}}/>
                <span style={{flex:1,fontSize:14,textDecoration:it[1]?'line-through':'none',opacity:it[1]?.7:1}}>{it[0]}</span>
              </label>
            ))}
          </div>
        </div>
        {/* Live counts + temps */}
        <div style={{padding:18}}>
          <div className="eyebrow" style={{color:'#a89e8a'}}>Live counts · 86 risk</div>
          <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:10}}>
            {[
              ['Wagyu hanger',84,100,'good'],
              ['Halibut · 6oz',38,80,'warn'],
              ['Heirloom tomato (1)',58,100,'good'],
              ['Olive oil cake (IV)',96,100,'good']
            ].map(([n,v,m,s])=>(
              <div key={n} style={{padding:10,background:'#211e19',borderRadius:4}}>
                <div className="split"><span style={{color:'#ece2cf',fontSize:13}}>{n}</span><span style={{color:s==='warn'?'#e8784a':'#a8c0ad',fontFamily:'var(--mono)'}}>{v} left</span></div>
                <div className="bar" style={{marginTop:6}}><i style={{width:`${(v/m)*100}%`,background:s==='warn'?'var(--ember)':'var(--sage)'}}/></div>
              </div>
            ))}
          </div>
          <div className="eyebrow" style={{color:'#a89e8a',marginTop:18}}>Walk-in temps · live</div>
          <div className="grid g3" style={{marginTop:8}}>
            {[['#1','34°','ok'],['#2','41°','warn'],['Freezer','-3°','ok']].map(([n,t,s])=>(
              <div key={n} style={{padding:10,background:'#211e19',borderRadius:4,textAlign:'center'}}>
                <div style={{fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.22em',color:'#a89e8a'}}>WALK-IN {n}</div>
                <div style={{fontFamily:'var(--serif)',fontSize:28,color:s==='warn'?'#e8784a':'#a8c0ad'}}>{t}</div>
              </div>
            ))}
          </div>
          <div style={{marginTop:14,padding:12,background:'rgba(200,90,42,.10)',border:'1px solid #5b2410',borderRadius:4,display:'flex',gap:10,color:'#ece2cf'}}>
            <window.LariOrb size="sm"/>
            <div style={{flex:1,fontSize:12}}>
              <div style={{fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.24em',color:'#e8a04a'}}>LARI · SUGGEST</div>
              Halibut count at 38 — switch one weak veg sub to carrot agnolotti to pace through 10:30.
            </div>
            <button className="btn xs" style={{background:'#c85a2a',color:'#1a1308'}}>OK</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 4. BAR · TABLET ─────────────────────────────── */
function BarTablet(){
  return (
    <div style={{width:1024,height:768,display:'flex',flexDirection:'column',background:'var(--bg)',overflow:'hidden',position:'relative'}}>
      <div style={{padding:'14px 22px',borderBottom:'1px solid var(--hair)',display:'flex',alignItems:'center',gap:14,background:'var(--cream)'}}>
        <window.LariSigil size={22}/>
        <div>
          <div className="eyebrow">04 · BAR · COCKTAIL</div>
          <div className="title-md">Hana · main bar</div>
        </div>
        <span className="pill ember" style={{marginLeft:'auto'}}>87 / 142 served</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1.4fr 1fr',flex:1}}>
        {/* Drink queue */}
        <div style={{padding:18,borderRight:'1px solid var(--hair)'}}>
          <div className="split">
            <div className="title-md">Active orders · 6</div>
            <div className="tnum mono" style={{fontSize:11,color:'var(--muted)'}}>avg wait 2:18</div>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:10,marginTop:14}}>
            {[
              ['#091','Table 11','2 × Calloway Cup · 1 × Honor Bees','1:42','ready'],
              ['#092','Patio · J. M.','3 × Tied the Knot','2:08','build'],
              ['#093','Patio · A. S.','1 × cava · 2 × old fashioned','2:34','build'],
              ['#094','Table 18','4 × Calloway Cup · 1 × NA spritz','3:11','queue'],
              ['#095','Mezzanine · Band','6 still water · 1 ginger','0:42','queue'],
              ['#096','Patio · L. Q.','1 × Tied the Knot · 2 × Negroni','0:18','queue']
            ].map(([id,t,it,age,st],i)=>(
              <div key={i} style={{padding:12,background:'var(--panel)',border:'1px solid var(--hair)',borderRadius:4,display:'flex',gap:14,alignItems:'center'}}>
                <div className="mono" style={{fontSize:11,color:'var(--muted)',width:44}}>{id}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600}}>{t}</div>
                  <div className="muted" style={{fontSize:12,marginTop:2}}>{it}</div>
                </div>
                <div className="tnum mono" style={{fontSize:13}}>{age}</div>
                <span className={`pill ${st==='ready'?'ok':st==='build'?'warn':''}`}>{st}</span>
              </div>
            ))}
          </div>
        </div>
        {/* Build cards + forecast */}
        <div style={{padding:18,display:'flex',flexDirection:'column',gap:12}}>
          <div className="eyebrow">Build · Calloway Cup</div>
          <div className="surface" style={{padding:14}}>
            <div style={{fontFamily:'var(--serif)',fontSize:22}}>The Calloway Cup</div>
            <div className="muted mono" style={{fontSize:10,letterSpacing:'.16em'}}>BUILD · GLASS: FLUTE</div>
            <ol style={{margin:'8px 0',paddingLeft:18,fontSize:13,lineHeight:1.7}}>
              <li>1.0 oz <b>lavender-infused gin</b></li>
              <li>0.5 oz fresh lemon</li>
              <li>0.25 oz simple</li>
              <li>shake · double strain</li>
              <li>top w/ cava · lemon twist · sage leaf</li>
            </ol>
            <div style={{display:'flex',gap:6}}>
              <button className="btn xs">Photo</button>
              <button className="btn xs ghost">86 it</button>
            </div>
          </div>
          <div className="surface" style={{padding:14}}>
            <div className="eyebrow">LaRi · forecast</div>
            <div style={{fontFamily:'var(--serif)',fontSize:18,marginTop:4,lineHeight:1.25}}>Set-break surge in <em>27 min</em></div>
            <div className="muted" style={{fontSize:12,marginTop:4}}>Open service well · prebatch 12 Calloway Cups now to keep 90-second pours.</div>
            <div className="bar" style={{marginTop:10}}><i style={{width:'68%'}}/></div>
            <div className="split mono" style={{fontSize:10,marginTop:4,color:'var(--muted)'}}><span>now · 86/hr</span><span>peak · 190/hr</span></div>
          </div>
          <div className="surface" style={{padding:14}}>
            <div className="eyebrow">Inventory call</div>
            {[['Cava NV',48,36,'ok'],['Mal de Amor mezcal',3,6,'alert'],['House lavender gin',6,12,'warn']].map(([n,oh,par,s],i)=>(
              <div key={i} className="split" style={{padding:'6px 0',borderBottom:'1px dashed var(--hair)',fontSize:12}}>
                <span>{n}</span>
                <span className="mono"><span className="muted">{oh}/{par}</span> <span className={`pill ${s}`} style={{marginLeft:6}}>{s}</span></span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <window.LariChat role="bar"/>
    </div>
  );
}

/* ── 5. SERVER · TABLET ─────────────────────────────── */
function ServerTablet(){
  const tables = [
    { n:11, st:'course-2', seats:8, ag:42, course:'Course 2 fired',  warn:false },
    { n:18, st:'course-3', seats:10, ag:18, course:'Course 3 pickup', warn:false },
    { n:8,  st:'course-3', seats:6, ag:11, course:'Course 3 pickup', warn:false },
    { n:14, st:'mid',      seats:10, ag:35, course:'Wines refilled', warn:true },
    { n:22, st:'cook',     seats:8, ag:6, course:'Course 3 cooking', warn:false },
    { n:12, st:'course-1', seats:8, ag:55, course:'Course 1 pickup', warn:false },
  ];
  return (
    <div style={{width:1024,height:768,display:'flex',flexDirection:'column',background:'var(--bg)',overflow:'hidden',position:'relative'}}>
      <div style={{padding:'14px 22px',borderBottom:'1px solid var(--hair)',display:'flex',alignItems:'center',gap:14,background:'var(--cream)'}}>
        <window.LariSigil size={22}/>
        <div>
          <div className="eyebrow">05 · SERVER · DEVON</div>
          <div className="title-md">My section · Garden Hall</div>
        </div>
        <span className="pill ok" style={{marginLeft:'auto'}}>6 tables · 50 covers</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 360px',flex:1}}>
        <div style={{padding:18}}>
          <div className="grid g3">
            {tables.map(t=>(
              <div key={t.n} className="surface lift" style={{padding:14,position:'relative',borderLeft:`4px solid ${t.warn?'var(--brass)':t.st==='course-3'?'var(--sage)':'var(--ember)'}`}}>
                <div className="split">
                  <div style={{fontFamily:'var(--serif)',fontSize:28,lineHeight:1}}>T-{t.n}</div>
                  <span className="mono muted" style={{fontSize:10}}>{t.seats}p</span>
                </div>
                <div className="eyebrow" style={{marginTop:8}}>{t.course}</div>
                <div className="tnum mono muted" style={{fontSize:11,marginTop:4}}>{t.ag}m on course</div>
                {t.warn && <div style={{marginTop:8,padding:6,background:'rgba(184,137,47,.15)',borderRadius:3,fontSize:11,color:'var(--brass-deep)'}}>
                  ⚠ T14 ready for wine refill (5min)
                </div>}
                <div style={{display:'flex',gap:6,marginTop:10}}>
                  <button className="btn xs">Mark fired</button>
                  <button className="btn xs ghost">Note</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{marginTop:18,padding:14,background:'var(--panel)',border:'1px solid var(--hair)',borderRadius:4}}>
            <div className="eyebrow">LaRi · whisper</div>
            <div style={{fontFamily:'var(--serif)',fontSize:18,marginTop:4}}>T-14 has a vegan recoded to seat 4 — already fired to BOH. You're good.</div>
          </div>
        </div>
        <aside style={{borderLeft:'1px solid var(--hair)',padding:18,background:'var(--cream)'}}>
          <div className="eyebrow">Tonight · BEO-2641</div>
          <div className="title-md" style={{marginTop:4}}>Calloway × Hong</div>
          <div className="muted" style={{fontSize:12,marginTop:6,lineHeight:1.5}}>4-course plated. No shots after 11:30. Bride's father seated T-12, Seat 1 — gluten free.</div>
          <div className="hair-dash" style={{margin:'14px 0'}}/>
          <div className="eyebrow">Course pacing</div>
          <div style={{display:'flex',flexDirection:'column',gap:6,marginTop:8}}>
            {[['I',true],['II',true],['III · now',false],['IV',false]].map((c,i)=>(
              <div key={i} className="split" style={{fontSize:13}}>
                <span style={{fontFamily:'var(--serif)'}}>{c[0]}</span>
                <span className={`pill ${c[1]?'ok':i===2?'ember':''}`}>{c[1]?'done':i===2?'live':'next'}</span>
              </div>
            ))}
          </div>
          <div className="hair-dash" style={{margin:'14px 0'}}/>
          <div className="eyebrow">Allergens · live</div>
          <div className="muted mono" style={{fontSize:11,marginTop:8,lineHeight:1.6}}>
            T-11 · 1 nut allergy<br/>
            T-12 · 2 gluten free<br/>
            T-19 · 1 shellfish
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ── 6. HOST · TABLET ─────────────────────────────── */
function HostTablet(){
  return (
    <div style={{width:1024,height:768,display:'flex',flexDirection:'column',background:'var(--bg)',overflow:'hidden',position:'relative'}}>
      <div style={{padding:'14px 22px',borderBottom:'1px solid var(--hair)',display:'flex',alignItems:'center',gap:14,background:'var(--cream)'}}>
        <window.LariSigil size={22}/>
        <div>
          <div className="eyebrow">06 · HOST · STAND</div>
          <div className="title-md">Aria · Patio · cocktail hour</div>
        </div>
        <span className="pill ember" style={{marginLeft:'auto'}}>Calloway party · 142</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1.2fr 1fr',flex:1}}>
        <div style={{padding:18}}>
          <div className="eyebrow">Patio + Garden Hall floor</div>
          <div style={{position:'relative',background:'var(--paper)',border:'1px solid var(--hair)',borderRadius:6,marginTop:8,height:380,padding:14}}>
            {/* Tables */}
            {[
              [40,30,'8',true],[180,30,'11',true],[320,30,'14',true],[460,30,'18',true],
              [40,140,'7',true],[180,140,'12',true],[320,140,'19',true],[460,140,'22',true],
              [40,250,'3',true],[180,250,'25',true],[320,250,'27',false],[460,250,'29',false],
            ].map(([x,y,n,seated],i)=>(
              <div key={i} style={{position:'absolute',left:x,top:y,width:88,height:78,
                background:seated?'rgba(93,122,102,.22)':'var(--cream)',
                border:`2px solid ${seated?'var(--sage)':'var(--hair)'}`,borderRadius:6,
                display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',fontSize:11,fontWeight:700,
                borderStyle:seated?'solid':'dashed'}}>
                <div style={{fontFamily:'var(--serif)',fontSize:22}}>{n}</div>
                <div className="mono" style={{fontSize:9,color:seated?'var(--sage-deep)':'var(--muted)'}}>{seated?'seated':'open'}</div>
              </div>
            ))}
            <div style={{position:'absolute',left:'56%',top:14,fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.22em',color:'var(--muted)'}}>↑ GARDEN HALL</div>
            <div style={{position:'absolute',left:14,bottom:14,fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.22em',color:'var(--muted)'}}>↓ PATIO</div>
          </div>
          <div style={{display:'flex',gap:14,marginTop:14,fontFamily:'var(--mono)',fontSize:10,letterSpacing:'.18em',color:'var(--muted)',textTransform:'uppercase'}}>
            <span><span className="dot ok" style={{marginRight:6,verticalAlign:'middle'}}/>seated · 10</span>
            <span><span className="dot" style={{marginRight:6,verticalAlign:'middle',background:'var(--hair)'}}/>open · 2</span>
            <span style={{marginLeft:'auto'}}>fire alarm path clear · 88%</span>
          </div>
        </div>
        <aside style={{borderLeft:'1px solid var(--hair)',padding:18,background:'var(--cream)',display:'flex',flexDirection:'column',gap:12}}>
          <div>
            <div className="eyebrow">VIPs tonight</div>
            <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:6}}>
              {[['Bride & Groom','T-12','allergies: bride GF'],['Bride\'s parents','T-11','—'],['Officiant','T-7','—']].map((v,i)=>(
                <div key={i} className="split" style={{padding:'8px 10px',background:'var(--panel)',border:'1px solid var(--hair)',borderRadius:4}}>
                  <div><div style={{fontSize:13,fontWeight:600}}>{v[0]}</div><div className="mono muted" style={{fontSize:10}}>{v[2]}</div></div>
                  <span className="pill ember">{v[1]}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="eyebrow">Watchlist · LaRi cross-check</div>
            <div style={{padding:10,background:'rgba(139,46,31,.10)',border:'1px solid #8b2e1f',borderRadius:4,marginTop:6,fontSize:12,color:'var(--ink)'}}>
              <window.LariOrb size="sm"/> <b>No matches</b> tonight. 4 active bans cross-checked against guest list.
            </div>
          </div>
          <div>
            <div className="eyebrow">Approaching arrivals</div>
            <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:6}}>
              {[['+2 min','Late guests · Hong cousins','GF · party of 2'],['+11 min','Vendor: florist load-out','South alley']].map((a,i)=>(
                <div key={i} className="surface" style={{padding:10,fontSize:12.5}}>
                  <div className="split"><b>{a[1]}</b><span className="mono muted" style={{fontSize:10}}>{a[0]}</span></div>
                  <div className="muted mono" style={{fontSize:10,marginTop:2}}>{a[2]}</div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ── 7. LINE COOK · PHONE ─────────────────────────────── */
function LinePhone(){
  return (
    <div style={{width:380,height:780,padding:14,background:'var(--bg)'}}>
      <div className="frame-phone" style={{margin:0}}>
        <div className="screen k-dark" style={{position:'relative'}}>
          <div className="notch"/>
          <div style={{padding:'46px 16px 12px',display:'flex',alignItems:'center',gap:10}}>
            <window.LariSigil size={18}/>
            <div>
              <div style={{fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.22em',color:'#a89e8a'}}>07 · LINE</div>
              <div style={{fontFamily:'var(--serif)',fontSize:18,color:'#ece2cf',lineHeight:1}}>Sauté · station 3</div>
            </div>
          </div>
          <div style={{padding:'0 16px 12px'}}>
            <div className="lari-surface" style={{padding:12,display:'flex',gap:10}}>
              <window.LariOrb size="sm"/>
              <div style={{flex:1,fontSize:12,color:'#ece2cf',lineHeight:1.4}}>
                <div style={{fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.22em',color:'#e8a04a'}}>LARI · NEXT FIRE</div>
                T-19 · 8 hangers MR · in 7 min
              </div>
            </div>
          </div>
          <div style={{padding:'0 16px',display:'flex',flexDirection:'column',gap:8,flex:1,overflow:'auto'}}>
            {[
              ['#846','T-22','6 hanger MR · 2 halibut','cook',58,'red'],
              ['#847','T-19','8 hanger MR · 2 veg','queued',44,'amber'],
              ['#848','T-7','4 hanger MR · 2 halibut','queued',28,'green'],
              ['#849','T-25','6 hanger MR · 2 veg','mise',14,'green'],
            ].map((t,i)=>(
              <div key={i} style={{padding:12,background:'#1a1815',border:'1px solid '+(t[5]==='red'?'#c85a2a':t[5]==='amber'?'#b8892f':'#3a3530'),borderRadius:6,color:'#ece2cf'}}>
                <div className="split">
                  <div style={{fontFamily:'var(--mono)',fontSize:11}}>{t[0]} · {t[1]}</div>
                  <div style={{fontFamily:'var(--serif)',fontSize:18,color:t[5]==='red'?'#e8784a':'#ece2cf'}}>{Math.floor(t[4]/60)}:{String(t[4]%60).padStart(2,'0')}</div>
                </div>
                <div style={{fontSize:13,marginTop:4}}>{t[2]}</div>
                <div className="split" style={{marginTop:8}}>
                  <span className="pill" style={{background:t[3]==='cook'?'#c85a2a':t[3]==='queued'?'#b8892f':'#3a3530',color:t[3]==='mise'?'#ece2cf':'#1a1308',border:0}}>{t[3]}</span>
                  <button className="btn xs" style={{background:'#3a3530',color:'#ece2cf',border:0}}>Bump →</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{padding:'12px 16px',borderTop:'1px solid #2e2a24',display:'flex',gap:8,background:'#1a1815'}}>
            <button className="btn sm" style={{flex:1,background:'#3a3530',color:'#ece2cf',border:0}}>Ask LaRi</button>
            <button className="btn sm primary" style={{flex:1}}>SOS expo</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 8. INVENTORY · TABLET ─────────────────────────────── */
function InvTablet(){
  return (
    <div style={{width:1024,height:768,display:'flex',flexDirection:'column',background:'var(--bg)',overflow:'hidden'}}>
      <div style={{padding:'14px 22px',borderBottom:'1px solid var(--hair)',display:'flex',alignItems:'center',gap:14,background:'var(--cream)'}}>
        <window.LariSigil size={22}/>
        <div>
          <div className="eyebrow">08 · INVENTORY · LEAD</div>
          <div className="title-md">Pantry, walk-ins, par</div>
        </div>
        <span className="pill warn" style={{marginLeft:'auto'}}>2 items below par</span>
      </div>
      <div style={{padding:18,flex:1,overflow:'auto'}} className="scroll">
        <window.InvSnap/>
      </div>
    </div>
  );
}

window.WallKDS = WallKDS;
window.SousTablet = SousTablet;
window.BarTablet = BarTablet;
window.ServerTablet = ServerTablet;
window.HostTablet = HostTablet;
window.LinePhone = LinePhone;
window.InvTablet = InvTablet;
