// BD deal profile drawer — opens when clicking any BD card / row
// Shows deal profile, contacts, activity, proposal docs, economics + next actions

const BDDealDrawer = ({ deal, onClose, onConvert }) => {
  const [tab, setTab] = React.useState('overview');
  const [stage, setStage] = React.useState(deal?.stage || 'Lead');
  if (!deal) return null;

  const contacts = [
    { name: deal.client+' · CEO', role:'Primary sponsor', email: `ceo@${deal.client.toLowerCase()}.com`, phone:'+61 2 8xxx', champion:true },
    { name: 'Chief Commercial Officer', role:'Economic buyer', email: `cco@${deal.client.toLowerCase()}.com`, phone:'+61 2 8xxx', champion:false },
    { name: 'Head of Strategy',    role:'Day-to-day contact', email: `strategy@${deal.client.toLowerCase()}.com`, phone:'+61 2 8xxx', champion:false },
  ];

  const activity = [
    { when:'12 Apr',  who:deal.team?.[0]||'MB', type:'call',    text:'Pricing call — client pushed back on $680k. Offered $620k + scope tightening.' },
    { when:'08 Apr',  who:'MB', type:'meeting', text:'Exec readout. Received verbal nod from CEO. Legal to start redlines.' },
    { when:'02 Apr',  who:'MB', type:'note',    text:'Proposal v3 sent. 48-page deck + pricing appendix.' },
    { when:'28 Mar',  who:'CC', type:'email',   text:'Sent clarifying email on scope — 3 workstreams confirmed.' },
    { when:'24 Mar',  who:'MB', type:'meeting', text:'Kick-off diligence call. Intro to 4 clinical leads.' },
    { when:'15 Mar',  who:'TT', type:'note',    text:'Deal qualified. Decision-maker identified. Budget $600-750k confirmed.' },
    { when:'02 Mar',  who:'MB', type:'note',    text:'Inbound lead via AP referral. Aligned on scope and next steps.' },
  ];

  const documents = [
    { name:'Proposal v3 — 02 Apr.pdf', size:'4.2 MB', by:'MB' },
    { name:'Pricing appendix.xlsx',    size:'86 kB',  by:'MB' },
    { name:'MSA redlines v2.docx',     size:'124 kB', by:'TT' },
    { name:'Capability deck.pdf',      size:'8.1 MB', by:'CC' },
  ];

  const value = parseInt((deal.value||'$0').replace(/\D/g,''))*1000;
  const probMap = { Lead:10, Qualified:25, Proposal:40, Verbal:75, Won:100 };
  const prob = probMap[stage] || 10;
  const weighted = Math.round(value * prob/100);
  const fmt = (n) => `$${(n/1000).toFixed(0)}k`;

  const stageColors = { Lead:'var(--text-4)', Qualified:'var(--blue)', Proposal:'var(--accent)', Verbal:'var(--amber)', Won:'var(--green)' };
  const stages = ['Lead','Qualified','Proposal','Verbal','Won'];

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e=>e.stopPropagation()} style={{ width: 820 }}>
        <div className="drawer-header">
          <div>
            <div className="txt-sm txt-muted">BD deal · <span className="mono">{deal.code}</span></div>
            <h2 style={{ margin:'4px 0 0', fontFamily:'var(--font-serif)', fontWeight:400, fontSize:24 }}>{deal.client} — {deal.name}</h2>
            <div className="row gap-sm" style={{ marginTop:6, alignItems:'center' }}>
              <Badge>{deal.type}</Badge>
              <span className="mono" style={{ fontWeight:600 }}>{deal.value}</span>
              <span className="txt-sm txt-muted">· {prob}% · weighted <b className="mono" style={{ color:'var(--text)' }}>{fmt(weighted)}</b></span>
            </div>
          </div>
          <div className="row gap-sm">
            <Btn sm primary onClick={onConvert} icon="arrow">Convert → Project</Btn>
            <Btn sm ghost onClick={onClose}>✕</Btn>
          </div>
        </div>

        {/* Stage stepper */}
        <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', background:'var(--bg-elev)' }}>
          <div className="txt-sm txt-muted" style={{ marginBottom:6 }}>Stage — click to advance</div>
          <div style={{ display:'flex', gap:4 }}>
            {stages.map((s,i)=>{
              const active = s===stage;
              const past = stages.indexOf(stage) > i;
              return (
                <button key={s} onClick={()=>setStage(s)} style={{ flex:1, padding:'8px 10px', background: active? stageColors[s] : past?'var(--accent-soft)':'var(--bg-subtle)', color: active?'#fff':'var(--text)', border:'none', borderRadius:3, cursor:'pointer', fontWeight: active?600:400, fontSize:12 }}>
                  <div>{s}</div>
                  <div style={{ fontSize:10, opacity:.8, marginTop:2 }}>{probMap[s]}%</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="tabs" style={{ padding:'0 20px' }}>
          {[['overview','Overview'],['contacts','Contacts'],['activity','Activity'],['docs','Proposal & docs'],['economics','Economics']].map(([k,l])=>(
            <div key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</div>
          ))}
        </div>

        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          {tab==='overview' && <div className="stack">
            <div className="grid g3">
              <div className="card kpi"><div className="label">Contract value</div><div className="value mono">{deal.value}</div><div className="sub">unweighted</div></div>
              <div className="card kpi"><div className="label">Probability</div><div className="value">{prob}%</div><div className="sub">{stage} stage</div></div>
              <div className="card kpi"><div className="label">Weighted</div><div className="value mono" style={{ color:'var(--brand)' }}>{fmt(weighted)}</div><div className="sub">contributes to forecast</div></div>
            </div>
            <div className="card">
              <div className="card-header"><h3>Deal details</h3><Btn sm ghost icon="pencil">Edit</Btn></div>
              <div className="card-body">
                <div className="grid g2" style={{ gap:10 }}>
                  <div className="field"><label>Client</label><div className="v"><b>{deal.client}</b> <Btn sm ghost onClick={()=>{ onClose&&onClose(); window.__nav && window.__nav('directory'); }}>open →</Btn></div></div>
                  <div className="field"><label>Project name</label><div className="v"><input defaultValue={deal.name}/></div></div>
                  <div className="field"><label>Type</label><div className="v"><select defaultValue={deal.type}><option>Pharma</option><option>Biotech</option><option>MedTech</option><option>Payer</option></select></div></div>
                  <div className="field"><label>Owner</label><div className="v"><Avatar size={22}>{deal.team?.[0]||'MB'}</Avatar> {deal.team?.[0]||'MB'}</div></div>
                  <div className="field"><label>Next step</label><div className="v"><input defaultValue="SOW signoff"/></div></div>
                  <div className="field"><label>Expected close</label><div className="v"><input defaultValue="24 Apr 2026"/></div></div>
                  <div className="field"><label>Source</label><div className="v">{deal.referral ? <span><Badge tone="accent">referral</Badge> {deal.referral}</span> : 'Direct outbound'}</div></div>
                  <div className="field"><label>Suggested project code</label><div className="v"><span className="mono">{deal.suggestedCode||deal.code}</span></div></div>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3>Team</h3><Btn sm icon="plus">Add member</Btn></div>
              <div className="card-body">
                <div className="row gap-sm">
                  {(deal.team||['MB']).map((m,i)=>(<div key={i} className="row gap-sm" style={{ padding:'4px 10px 4px 4px', background:'var(--bg-elev)', borderRadius:20 }}><Avatar size={24}>{m}</Avatar><span className="txt-sm">{m}</span></div>))}
                </div>
              </div>
            </div>
          </div>}

          {tab==='contacts' && <div className="card">
            <div className="card-header"><h3>Client contacts</h3><Btn sm icon="plus">Add contact</Btn></div>
            <div className="list">
              {contacts.map((c,i)=>(
                <div key={i} className="list-item">
                  <Avatar size={32} tone={c.champion?'var(--green)':'var(--text-3)'}>{c.name.split(' ').slice(-1)[0][0]||'?'}</Avatar>
                  <div className="main">
                    <div style={{ fontWeight:500 }}>{c.name} {c.champion && <Badge tone="green" dot>champion</Badge>}</div>
                    <div className="txt-sm txt-muted">{c.role} · {c.email} · {c.phone}</div>
                  </div>
                  <div className="row gap-sm"><Btn sm ghost>Email</Btn><Btn sm ghost>Log call</Btn></div>
                </div>
              ))}
            </div>
          </div>}

          {tab==='activity' && <div className="stack">
            <div className="card">
              <div className="card-body">
                <div className="row gap-sm"><select style={{ padding:'4px 8px', border:'1px solid var(--border)', borderRadius:4 }}><option>Note</option><option>Call</option><option>Email</option><option>Meeting</option></select></div>
                <textarea placeholder="Log activity…" rows={3} style={{ width:'100%', fontFamily:'inherit', padding:8, border:'1px solid var(--border)', borderRadius:4, marginTop:8 }}/>
                <div className="row gap-sm" style={{ justifyContent:'flex-end', marginTop:8 }}><Btn sm primary>Post</Btn></div>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3>Timeline</h3></div>
              <div className="list">
                {activity.map((a,i)=>(
                  <div key={i} className="list-item" style={{ alignItems:'flex-start' }}>
                    <div style={{ width:50, fontSize:11, color:'var(--text-3)', fontFamily:'var(--font-mono)' }}>{a.when}</div>
                    <div style={{ width:54 }}><Badge>{a.type}</Badge></div>
                    <Avatar size={24}>{a.who}</Avatar>
                    <div className="main" style={{ fontSize:13 }}>{a.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>}

          {tab==='docs' && <div className="card">
            <div className="card-header"><h3>Proposal & docs</h3><Btn sm icon="upload">Upload</Btn></div>
            <div className="list">
              {documents.map((d,i)=>(
                <div key={i} className="list-item" style={{ cursor:'pointer' }}>
                  <div className="main"><div style={{ fontWeight:500 }}>📄 {d.name}</div><div className="txt-sm txt-muted">{d.size} · by {d.by}</div></div>
                  <Btn sm ghost>Open</Btn>
                </div>
              ))}
            </div>
          </div>}

          {tab==='economics' && <div className="stack">
            <div className="card">
              <div className="card-header"><h3>Revenue & margin projection</h3></div>
              <div className="card-body">
                <div className="grid g2" style={{ gap:10 }}>
                  <div className="field"><label>Contract value</label><div className="v"><b className="mono">{deal.value}</b></div></div>
                  <div className="field"><label>Project duration</label><div className="v"><input defaultValue="12 weeks"/></div></div>
                  <div className="field"><label>Est. delivery cost</label><div className="v"><span className="mono">{fmt(value*0.45)}</span></div></div>
                  <div className="field"><label>Est. OPEX contribution</label><div className="v"><span className="mono">{fmt(value*0.2)}</span> <span className="txt-sm txt-muted">· 20%</span></div></div>
                  <div className="field"><label>Est. gross margin</label><div className="v"><b className="mono" style={{ color:'var(--green)' }}>{fmt(value*0.35)} · 35%</b></div></div>
                  <div className="field"><label>Partner pool</label><div className="v"><span className="mono">{fmt(value*0.15)}</span> <span className="txt-sm txt-muted">· 15%</span></div></div>
                </div>
                {deal.referral && <Callout tone="info" title="Referral fee"><span className="txt-sm">{deal.referral} · deducted from partner pool.</span></Callout>}
              </div>
            </div>
          </div>}
        </div>

        <div className="drawer-footer" style={{ borderTop:'1px solid var(--border)', padding:'12px 20px', display:'flex', gap:8, justifyContent:'space-between' }}>
          <div className="row gap-sm">
            <Btn sm ghost style={{ color:'var(--red)' }}>Mark lost</Btn>
            <Btn sm ghost>Mark on hold</Btn>
          </div>
          <div className="row gap-sm">
            <Btn sm>Log activity</Btn>
            <Btn sm primary icon="arrow" onClick={onConvert}>Convert → Project</Btn>
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { BDDealDrawer });
