// LaRi — the AI nervous system. Three presentation modes:
//   • ambient  : a sliver dock at the bottom of the surface (KDS, tablets)
//   • hud      : floating mission-control card (overlay)
//   • chat     : conversational drawer (manager-class screens)
// All modes share the same predictions stream.

const { useState, useEffect, useRef } = React;

function LariOrb({ size='md', live=true }){
  return <span className={`lari-orb ${size==='sm'?'sm':''}`} aria-hidden="true" style={!live?{animation:'none'}:{}}/>;
}

function LariSigil({ size=28 }){
  // little "L" mark used as inline brand
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".55"/>
      <path d="M11 8 V20 H22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/>
      <circle cx="22" cy="20" r="2.2" fill="currentColor"/>
    </svg>
  );
}

// Ambient dock — strip across a KDS or tablet bottom
function LariAmbient({ role, items, dense=false }){
  const list = (items || window.LARIOS.lari.predictions.filter(p => !role || p.for === role)).slice(0,3);
  return (
    <div className="lari-ambient lari-surface" style={{padding: dense?'10px 14px':'12px 18px',
      display:'flex',alignItems:'center',gap:14}}>
      <LariOrb/>
      <span style={{fontFamily:'var(--mono)',fontSize:10,letterSpacing:'.28em',color:'#e8a04a',fontWeight:700}}>LaRi</span>
      <div style={{flex:1,display:'flex',gap:18,overflow:'hidden',alignItems:'center'}}>
        {list.map((p,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:8,flex:'0 0 auto',
            opacity: i===0?1:.7,fontSize:13,color:'#ece2cf'}}>
            <span className={`dot ${p.sev}`} style={{background: p.sev==='alert'?'#c85a2a':p.sev==='warn'?'#b8892f':'#5d7a66'}}/>
            <span style={{whiteSpace:'nowrap',textOverflow:'ellipsis',overflow:'hidden',maxWidth:dense?280:420}}>{p.txt}</span>
          </div>
        ))}
      </div>
      <button className="btn xs" style={{background:'#2b2723',color:'#e8a04a',border:'1px solid #3a3530'}}>
        Ask LaRi
      </button>
    </div>
  );
}

// HUD card — floating predictive panel
function LariHUD({ role, items, title='LaRi · live read' }){
  const list = items || window.LARIOS.lari.predictions.filter(p => !role || p.for === role).slice(0,4);
  return (
    <div className="lari-surface" style={{padding:'14px 16px',display:'flex',flexDirection:'column',gap:10}}>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <LariOrb/>
        <div>
          <div style={{fontFamily:'var(--mono)',fontSize:9.5,letterSpacing:'.28em',color:'#e8a04a',fontWeight:700}}>{title}</div>
          <div style={{fontFamily:'var(--serif)',fontSize:18,color:'#ece2cf',lineHeight:1}}>Reading the room</div>
        </div>
        <div style={{marginLeft:'auto',fontFamily:'var(--mono)',fontSize:10,color:'#a89e8a'}}>
          <span style={{display:'inline-block',width:6,height:6,borderRadius:'50%',background:'#5d7a66',marginRight:6,verticalAlign:'middle'}}/>
          confidence 0.88
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {list.map((p,i)=>(
          <div key={i} style={{display:'flex',gap:10,alignItems:'flex-start',padding:'8px 10px',
            background:'rgba(255,255,255,.03)',border:'1px solid #2e2a24',borderRadius:4}}>
            <span style={{width:10,height:10,borderRadius:'50%',marginTop:5,flexShrink:0,
              background:p.sev==='alert'?'#c85a2a':p.sev==='warn'?'#b8892f':'#5d7a66'}}/>
            <div style={{flex:1,fontSize:12.5,color:'#ece2cf',lineHeight:1.45}}>
              {p.txt}
              {p.action && <div style={{marginTop:4,fontFamily:'var(--mono)',fontSize:10,color:'#e8a04a',letterSpacing:'.06em'}}>↳ {p.action}</div>}
            </div>
            <button className="btn xs" style={{background:'transparent',color:'#a89e8a',border:'1px solid #3a3530',padding:'2px 6px'}}>ack</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Inline chip — sits on a tile when LaRi has something contextual to say
function LariChip({ children, sev='warn' }){
  const col = sev==='alert'?'#c85a2a':sev==='warn'?'#b8892f':'#5d7a66';
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:6,fontFamily:'var(--mono)',
      fontSize:9.5,letterSpacing:'.16em',textTransform:'uppercase',fontWeight:700,
      padding:'3px 7px 3px 5px',borderRadius:99,
      background:'rgba(29,26,21,.92)',color:'#ece2cf',border:`1px solid ${col}`,
    }}>
      <LariOrb size="sm"/> {children}
    </span>
  );
}

// Chat drawer
function LariChat({ role }){
  const [open,setOpen] = useState(false);
  const [msgs,setMsgs] = useState([
    { who:'lari', txt:'Cocktail wave starts in 11 min. Patio looks 71% full. Want me to flag the host stand?' },
    { who:'me',   txt:'Yes. And check the band\u2019s soundcheck volume.' },
    { who:'lari', txt:'Noted — host alerted. Soundcheck reading 88dB at patio, 4dB over our cocktail target. I\u2019ll suggest stage trim monitors.' },
  ]);
  const [draft,setDraft] = useState('');
  function send(){
    if(!draft.trim()) return;
    const q = draft.trim();
    setMsgs(m=>[...m, {who:'me',txt:q}, {who:'lari',txt:'…thinking',pending:true}]);
    setDraft('');
    setTimeout(()=>{
      setMsgs(m=>{
        const copy = m.slice();
        copy[copy.length-1] = { who:'lari', txt: simulate(q) };
        return copy;
      });
    }, 900);
  }
  function simulate(q){
    const ql = q.toLowerCase();
    if(/(bar|drink|cocktail|booze)/.test(ql)) return 'Bar pacing is 3.8 drinks/guest. Forecast 4.1 by end of cocktail hour. Hana is ahead on prebatch.';
    if(/(kitchen|kds|ticket|fire)/.test(ql)) return 'BOH on time. Course 2 plating, Course 3 fires in 7 min for T18/T08. Renata wants 2 more halibut pulled.';
    if(/(band|music|sound|stage)/.test(ql)) return 'Bramble Riders ready. Set 1 at 9:30. Drummer\u2019s vegetarian meal at expo. Mezz dB target 92 — we\u2019ll trim FOH 2dB during cake cut.';
    return 'I\u2019ll keep watching. Want me to alert you when something changes?';
  }
  return (
    <>
      <button onClick={()=>setOpen(o=>!o)} className="lari-fab" style={{
        position:'absolute',bottom:18,right:18,zIndex:20,display:'flex',alignItems:'center',gap:10,
        padding:'10px 14px',borderRadius:99,background:'#1d1a15',color:'#ece2cf',
        border:'1px solid #3a3530',boxShadow:'0 10px 30px rgba(0,0,0,.25)'
      }}>
        <LariOrb/>
        <span style={{fontFamily:'var(--mono)',fontSize:10,letterSpacing:'.24em',color:'#e8a04a',fontWeight:700}}>LaRi</span>
        <span style={{fontFamily:'var(--mono)',fontSize:10,color:'#a89e8a'}}>{open?'close':'ask'}</span>
      </button>
      {open && (
        <div className="lari-surface" style={{
          position:'absolute',bottom:74,right:18,width:380,maxHeight:480,
          display:'flex',flexDirection:'column',zIndex:21
        }}>
          <div style={{padding:'14px 16px',borderBottom:'1px solid #2e2a24',display:'flex',alignItems:'center',gap:10}}>
            <LariOrb/>
            <div>
              <div style={{fontFamily:'var(--serif)',fontSize:18,color:'#ece2cf',lineHeight:1}}>LaRi</div>
              <div style={{fontFamily:'var(--mono)',fontSize:9,letterSpacing:'.22em',color:'#a89e8a'}}>operations concierge</div>
            </div>
            <button onClick={()=>setOpen(false)} style={{marginLeft:'auto',color:'#a89e8a'}}>✕</button>
          </div>
          <div style={{flex:1,overflowY:'auto',padding:14,display:'flex',flexDirection:'column',gap:10}}>
            {msgs.map((m,i)=>(
              <div key={i} style={{
                alignSelf: m.who==='me'?'flex-end':'flex-start',
                background: m.who==='me'?'#c85a2a':'#211e19',
                color: m.who==='me'?'#1a1308':'#ece2cf',
                padding:'10px 14px',borderRadius:14,maxWidth:'82%',fontSize:13,lineHeight:1.45,
                borderBottomRightRadius:m.who==='me'?3:14,
                borderBottomLeftRadius:m.who==='lari'?3:14
              }}>
                {m.pending ? <span className="lari-shim">{m.txt}</span> : m.txt}
              </div>
            ))}
          </div>
          <div style={{padding:10,borderTop:'1px solid #2e2a24',display:'flex',gap:8}}>
            <input value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()}
              placeholder="Ask LaRi anything…"
              style={{flex:1,background:'#0e0d0b',border:'1px solid #3a3530',color:'#ece2cf',
                borderRadius:4,padding:'8px 10px',fontSize:13,fontFamily:'inherit'}}/>
            <button onClick={send} className="btn xs primary">Send</button>
          </div>
        </div>
      )}
    </>
  );
}

// Shared bits exported
window.LariOrb = LariOrb;
window.LariSigil = LariSigil;
window.LariAmbient = LariAmbient;
window.LariHUD = LariHUD;
window.LariChip = LariChip;
window.LariChat = LariChat;
