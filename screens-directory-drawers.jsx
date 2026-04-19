// Client & Supplier profile drawers for Directory

const ClientDrawer = ({ client, onClose }) => {
  const [tab, setTab] = React.useState('overview');
  if (!client) return null;
  const codes = (client.projects||'').split(',').map(s=>s.trim()).filter(s=>s && s!=='—');
  const contacts = [
    { name:'Primary · CEO', role:'Economic buyer', email:`ceo@${client.name.toLowerCase()}.com`, phone:'+61 2 8xxx', champion:true },
    { name:'CCO', role:'Decision maker', email:`cco@${client.name.toLowerCase()}.com`, phone:'+61 2 8xxx' },
    { name:'Head of Strategy', role:'Day-to-day', email:`ops@${client.name.toLowerCase()}.com`, phone:'+61 2 8xxx' },
  ];
  const invoices = [
    { date:'12 Apr', ref:'INV-014', code: codes[0]||'—', amt:'$120,000', status:'outstanding·42d', tone:'amber' },
    { date:'28 Mar', ref:'INV-013', code: codes[0]||'—', amt:'$80,000',  status:'paid', tone:'green' },
    { date:'14 Mar', ref:'INV-012', code: codes[0]||'—', amt:'$60,000',  status:'paid', tone:'green' },
    { date:'28 Feb', ref:'INV-011', code: codes[0]||'—', amt:'$120,000', status:'paid', tone:'green' },
  ];
  const activity = [
    { when:'2d',  who:'MB', text:'Quarterly check-in call — exec feedback positive, expansion interest' },
    { when:'1wk', who:'MB', text:'Sent capability deck + case studies (Panacea, Biomax)' },
    { when:'3wk', who:'TT', text:'Offsite dinner with CEO · Sydney' },
    { when:'6wk', who:'MB', text:'Kicked off follow-on scoping workshop' },
  ];
  const contracts = [
    { name:`${client.name} — MSA 2024.pdf`, size:'312 kB', date:'signed 14 Jan 2024' },
    { name:'NDA — signed.pdf',              size:'48 kB',  date:'14 Jan 2024' },
    { name:'DPA — 2025 update.pdf',         size:'88 kB',  date:'08 Jan 2025' },
  ];

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e=>e.stopPropagation()} style={{ width: 820 }}>
        <div className="drawer-header">
          <div>
            <div className="txt-sm txt-muted">Client profile</div>
            <h2 style={{ margin:'4px 0 0', fontFamily:'var(--font-serif)', fontWeight:400, fontSize:24 }}>{client.name}</h2>
            <div className="row gap-sm" style={{ marginTop:6, alignItems:'center' }}>
              <Badge>{client.type}</Badge>
              {client.ar && client.ar!=='—' && <Badge tone="amber" dot>{client.ar} AR</Badge>}
              <span className="txt-sm txt-muted">LTV <b>{client.ltv}</b> · owner <Avatar size={20} inline>{client.owner}</Avatar></span>
            </div>
          </div>
          <div className="row gap-sm">
            <Btn sm icon="plus" primary>Log activity</Btn>
            <Btn sm ghost onClick={onClose}>✕</Btn>
          </div>
        </div>

        <div className="tabs" style={{ padding:'0 20px' }}>
          {[['overview','Overview'],['relmap','Relationship map'],['terms','Commercial terms'],['projects','Projects'],['contacts','Contacts'],['billing','Billing'],['docs','Documents'],['activity','Activity']].map(([k,l])=>(
            <div key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</div>
          ))}
        </div>

        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          {tab==='overview' && <div className="stack">
            <div className="grid g3">
              <div className="card kpi"><div className="label">Lifetime value</div><div className="value mono">{client.ltv}</div><div className="sub">{codes.length} projects</div></div>
              <div className="card kpi"><div className="label">AR outstanding</div><div className="value mono" style={{ color: client.ar==='—'?'var(--text-3)':'var(--amber)' }}>{client.ar||'—'}</div><div className="sub">aged</div></div>
              <div className="card kpi"><div className="label">NPS</div><div className="value" style={{ color:'var(--green)' }}>+68</div><div className="sub">last survey Q1</div></div>
            </div>
            <div className="card">
              <div className="card-header"><h3>Details</h3><Btn sm ghost icon="pencil">Edit</Btn></div>
              <div className="card-body">
                <div className="grid g2" style={{ gap:10 }}>
                  <div className="field"><label>Legal entity</label><div className="v"><input defaultValue={`${client.name} Pty Ltd`}/></div></div>
                  <div className="field"><label>Industry</label><div className="v"><input defaultValue={client.type}/></div></div>
                  <div className="field"><label>Owner</label><div className="v"><Avatar size={22}>{client.owner}</Avatar> {client.owner}</div></div>
                  <div className="field"><label>First engaged</label><div className="v">Jan 2024</div></div>
                  <div className="field"><label>HQ</label><div className="v"><input defaultValue="Sydney, AU"/></div></div>
                  <div className="field"><label>Billing entity</label><div className="v"><input defaultValue={`${client.name} Finance Pty Ltd`}/></div></div>
                </div>
              </div>
            </div>
          </div>}

          {tab==='relmap' && <ClientRelMapPanel client={client} onClose={onClose}/>}
          {tab==='terms' && <ClientTermsPanel client={client}/>}

          {tab==='projects' && <div className="card">
            <div className="card-header"><h3>Projects</h3><Btn sm icon="plus">New project</Btn></div>
            {codes.length===0 && <div className="card-body txt-muted" style={{ textAlign:'center', padding:40 }}>No projects yet — convert a BD deal or start a new project.</div>}
            {codes.length>0 && <table className="tbl">
              <thead><tr><th>Code</th><th>Name</th><th>Status</th><th className="num">Value</th><th>Start</th></tr></thead>
              <tbody>
                {codes.map((c,i)=>(
                  <tr key={c} style={{ cursor:'pointer' }} onClick={()=>{ onClose&&onClose(); window.__nav && window.__nav('projects', { projectCode: c }); }}>
                    <td className="code-cell">{c}</td>
                    <td>{i===0?'Diligence Strategy':'Follow-on · '+c}</td>
                    <td><Badge tone={i===0?'accent':'green'} dot>{i===0?'delivery':'scoping'}</Badge></td>
                    <td className="num mono">${(600-i*120)}k</td>
                    <td className="txt-sm">06 Jan 2026</td>
                  </tr>
                ))}
              </tbody>
            </table>}
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

          {tab==='billing' && <div className="stack">
            <div className="card">
              <div className="card-header"><h3>Billing details</h3><Btn sm ghost icon="pencil">Edit</Btn></div>
              <div className="card-body">
                <div className="grid g2" style={{ gap:10 }}>
                  <div className="field"><label>Payment terms</label><div className="v"><input defaultValue="Net 30"/></div></div>
                  <div className="field"><label>Currency</label><div className="v"><select defaultValue="AUD"><option>AUD</option><option>USD</option><option>EUR</option></select></div></div>
                  <div className="field"><label>PO required</label><div className="v"><input type="checkbox" defaultChecked/> yes</div></div>
                  <div className="field"><label>Billing email</label><div className="v"><input defaultValue={`ap@${client.name.toLowerCase()}.com`}/></div></div>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3>Recent invoices</h3><Btn sm ghost onClick={()=>{ onClose&&onClose(); window.__nav && window.__nav('invoices'); }}>Open Invoices →</Btn></div>
              <table className="tbl">
                <thead><tr><th>Date</th><th>Ref</th><th>Project</th><th className="num">Amount</th><th>Status</th></tr></thead>
                <tbody>{invoices.map((r,i)=>(<tr key={i}><td>{r.date}</td><td className="mono">{r.ref}</td><td className="code-cell">{r.code}</td><td className="num mono">{r.amt}</td><td><Badge tone={r.tone} dot>{r.status}</Badge></td></tr>))}</tbody>
              </table>
            </div>
          </div>}

          {tab==='docs' && <div className="card">
            <div className="card-header"><h3>Documents</h3><Btn sm icon="upload">Upload</Btn></div>
            <div className="list">
              {contracts.map((d,i)=>(
                <div key={i} className="list-item" style={{ cursor:'pointer' }}>
                  <div className="main"><div style={{ fontWeight:500 }}>📄 {d.name}</div><div className="txt-sm txt-muted">{d.size} · {d.date}</div></div>
                  <Btn sm ghost>Open</Btn>
                </div>
              ))}
            </div>
          </div>}

          {tab==='activity' && <div className="stack">
            <div className="card"><div className="card-body"><textarea placeholder="Log activity…" rows={3} style={{ width:'100%', fontFamily:'inherit', padding:8, border:'1px solid var(--border)', borderRadius:4 }}/><div className="row gap-sm" style={{ justifyContent:'flex-end', marginTop:8 }}><Btn sm primary>Post</Btn></div></div></div>
            <div className="card">
              <div className="list">
                {activity.map((a,i)=>(
                  <div key={i} className="list-item" style={{ alignItems:'flex-start' }}>
                    <div style={{ width:48, fontSize:11, color:'var(--text-3)', fontFamily:'var(--font-mono)' }}>{a.when}</div>
                    <Avatar size={24}>{a.who}</Avatar>
                    <div className="main" style={{ fontSize:13 }}>{a.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>}
        </div>

        <div className="drawer-footer" style={{ borderTop:'1px solid var(--border)', padding:'12px 20px', display:'flex', gap:8, justifyContent:'flex-end' }}>
          <Btn sm>Send proposal</Btn>
          <Btn sm primary icon="plus">New project</Btn>
        </div>
      </div>
    </div>
  );
};

const SupplierDrawer = ({ supplier, onClose }) => {
  const [tab, setTab] = React.useState('overview');
  if (!supplier) return null;
  const invoices = [
    { date:'12 Apr', ref:'HS-2041', amt:'$4,800', status:'paid', tone:'green' },
    { date:'12 Mar', ref:'HS-2038', amt:'$4,800', status:'paid', tone:'green' },
    { date:'12 Feb', ref:'HS-2032', amt:'$4,800', status:'paid', tone:'green' },
    { date:'12 Jan', ref:'HS-2028', amt:'$4,800', status:'paid', tone:'green' },
  ];
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e=>e.stopPropagation()} style={{ width: 820 }}>
        <div className="drawer-header">
          <div>
            <div className="txt-sm txt-muted">Supplier profile</div>
            <h2 style={{ margin:'4px 0 0', fontFamily:'var(--font-serif)', fontWeight:400, fontSize:24 }}>{supplier.name}</h2>
            <div className="row gap-sm" style={{ marginTop:6, alignItems:'center' }}>
              <Badge>{supplier.category}</Badge>
              <span className="txt-sm txt-muted">{supplier.terms}</span>
              {supplier.outstanding && supplier.outstanding!=='—' && <Badge tone="amber" dot>{supplier.outstanding} outstanding</Badge>}
            </div>
          </div>
          <div className="row gap-sm">
            <Btn sm icon="plus">Log invoice</Btn>
            <Btn sm ghost onClick={onClose}>✕</Btn>
          </div>
        </div>

        <div className="tabs" style={{ padding:'0 20px' }}>
          {[['overview','Overview'],['invoices','Invoices'],['contract','Contract & docs'],['contacts','Contacts']].map(([k,l])=>(
            <div key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</div>
          ))}
        </div>

        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          {tab==='overview' && <div className="stack">
            <div className="grid g3">
              <div className="card kpi"><div className="label">YTD spend</div><div className="value mono">{supplier.ytd}</div><div className="sub">FY26</div></div>
              <div className="card kpi"><div className="label">Outstanding</div><div className="value mono" style={{ color: supplier.outstanding==='—'?'var(--text-3)':'var(--amber)' }}>{supplier.outstanding||'—'}</div><div className="sub">to be paid</div></div>
              <div className="card kpi"><div className="label">Since</div><div className="value" style={{ fontSize:20 }}>Jan 2024</div><div className="sub">active</div></div>
            </div>
            <div className="card">
              <div className="card-header"><h3>Details</h3><Btn sm ghost icon="pencil">Edit</Btn></div>
              <div className="card-body">
                <div className="grid g2" style={{ gap:10 }}>
                  <div className="field"><label>Legal entity</label><div className="v"><input defaultValue={`${supplier.name} Pty Ltd`}/></div></div>
                  <div className="field"><label>Category</label><div className="v"><select defaultValue={supplier.category}><option>{supplier.category}</option></select></div></div>
                  <div className="field"><label>Payment terms</label><div className="v"><input defaultValue={supplier.terms}/></div></div>
                  <div className="field"><label>Currency</label><div className="v"><select defaultValue="AUD"><option>AUD</option><option>USD</option></select></div></div>
                  <div className="field"><label>ABN</label><div className="v"><input placeholder="12 345 678 910"/></div></div>
                  <div className="field"><label>Billing email</label><div className="v"><input defaultValue={`billing@${supplier.name.toLowerCase()}.com`}/></div></div>
                </div>
              </div>
            </div>
            <Callout tone="info" title="Linked capability">This supplier is mapped in Cost Planning. <a href="#" style={{ color:'var(--brand)' }} onClick={e=>{e.preventDefault(); onClose&&onClose(); window.__nav && window.__nav('costplan');}}>Open in Cost planning →</a></Callout>
          </div>}
          {tab==='invoices' && <div className="card">
            <div className="card-header"><h3>Received invoices</h3><Btn sm icon="plus">Log invoice</Btn></div>
            <table className="tbl">
              <thead><tr><th>Date</th><th>Ref</th><th className="num">Amount</th><th>Status</th></tr></thead>
              <tbody>{invoices.map((r,i)=>(<tr key={i}><td>{r.date}</td><td className="mono">{r.ref}</td><td className="num mono">{r.amt}</td><td><Badge tone={r.tone} dot>{r.status}</Badge></td></tr>))}</tbody>
            </table>
          </div>}
          {tab==='contract' && <div className="card">
            <div className="card-header"><h3>Contract & documents</h3><Btn sm icon="upload">Upload</Btn></div>
            <div className="card-body">
              <div className="grid g2" style={{ gap:10 }}>
                <div className="field"><label>Contract type</label><div className="v">Master Services Agreement</div></div>
                <div className="field"><label>Start / end</label><div className="v">14 Jan 2025 — 14 Jan 2027</div></div>
                <div className="field"><label>Notice period</label><div className="v">60 days</div></div>
                <div className="field"><label>Auto-renew</label><div className="v">Yes</div></div>
              </div>
            </div>
            <div className="list">
              {['MSA 2025.pdf','Order form.pdf','DPA.pdf','Insurance cert.pdf'].map((n,i)=>(
                <div key={i} className="list-item" style={{ cursor:'pointer' }}><div className="main">📄 {n}</div><Btn sm ghost>Open</Btn></div>
              ))}
            </div>
          </div>}
          {tab==='contacts' && <div className="card">
            <div className="card-header"><h3>Vendor contacts</h3><Btn sm icon="plus">Add contact</Btn></div>
            <div className="list">
              <div className="list-item"><div className="main"><b>Account manager</b><div className="txt-sm txt-muted">accounts@{supplier.name.toLowerCase()}.com</div></div><Btn sm ghost>Email</Btn></div>
              <div className="list-item"><div className="main"><b>Support</b><div className="txt-sm txt-muted">support@{supplier.name.toLowerCase()}.com</div></div><Btn sm ghost>Email</Btn></div>
            </div>
          </div>}
        </div>

        <div className="drawer-footer" style={{ borderTop:'1px solid var(--border)', padding:'12px 20px', display:'flex', gap:8, justifyContent:'space-between' }}>
          <Btn sm ghost style={{ color:'var(--red)' }}>Mark inactive</Btn>
          <div className="row gap-sm"><Btn sm>Run SOV check</Btn><Btn sm primary>Renew contract</Btn></div>
        </div>
      </div>
    </div>
  );
};

// ========== CLIENT · RELATIONSHIP MAP ==========
// Stakeholder grid: influence (rows, high→low) × stance (cols: champion / supporter / neutral / skeptic / blocker).
// Click a node to edit; lines show reporting / influence. Concise, no org-chart bloat.

const REL_SEED = [
  { id:'ceo',   name:'Dr. R. Vale',        role:'CEO',              buyer:'economic',  inf:5, stance:'champion',  owner:'TT', lastTouch:'3wk', notes:'Long-time TT relationship · endorsed engagement to board' },
  { id:'cco',   name:'M. Laurent',         role:'CCO',              buyer:'decision',  inf:4, stance:'supporter', owner:'MB', lastTouch:'1wk', notes:'Day-to-day sponsor · signs SOWs' },
  { id:'cfo',   name:'J. Okafor',          role:'CFO',              buyer:'ratifier',  inf:4, stance:'skeptic',   owner:'MB', lastTouch:'5wk', notes:'Cost-sensitive · wants quarterly ROI tracking' },
  { id:'strat', name:'A. Huang',           role:'Head of Strategy', buyer:'user',      inf:3, stance:'champion',  owner:'MB', lastTouch:'2d',  notes:'Joint working group · daily comms' },
  { id:'ops',   name:'L. Fernández',       role:'COO',              buyer:'influencer',inf:3, stance:'neutral',   owner:'TT', lastTouch:'2mo', notes:'Needs more visibility · warm up next Q' },
  { id:'com',   name:'T. Whitfield',       role:'VP Commercial',    buyer:'user',      inf:2, stance:'supporter', owner:'SR', lastTouch:'2wk', notes:'Consumer of outputs — wants tighter turnaround' },
  { id:'leg',   name:'P. Nair',            role:'General Counsel',  buyer:'gatekeeper',inf:2, stance:'neutral',   owner:'JS', lastTouch:'6wk', notes:'MSA + DPA liaison' },
  { id:'proc',  name:'S. Azar',            role:'Procurement lead', buyer:'gatekeeper',inf:3, stance:'skeptic',   owner:'MB', lastTouch:'3wk', notes:'Pushed back on rate card · escalates to CFO' },
];

const stanceTone = (s) => s==='champion'?'green':s==='supporter'?'blue':s==='skeptic'?'amber':s==='blocker'?'red':'';
const STANCES = [
  { k:'champion',  l:'Champion',  hint:'advocates internally' },
  { k:'supporter', l:'Supporter', hint:'positive, not vocal'  },
  { k:'neutral',   l:'Neutral',   hint:'no strong view'       },
  { k:'skeptic',   l:'Skeptic',   hint:'friction, needs proof'},
  { k:'blocker',   l:'Blocker',   hint:'actively opposed'     },
];

const ClientRelMapPanel = ({ client, onClose }) => {
  const [people, setPeople] = React.useState(REL_SEED);
  const [sel, setSel] = React.useState(null);

  const byCell = (inf, stance) => people.filter(p => p.inf===inf && p.stance===stance);
  const champions = people.filter(p=>p.stance==='champion').length;
  const skeptics = people.filter(p=>p.stance==='skeptic' || p.stance==='blocker').length;
  const stale = people.filter(p => /mo/.test(p.lastTouch)).length;

  const updateStance = (id, stance) => setPeople(ps => ps.map(p => p.id===id ? {...p, stance} : p));
  const updateInf = (id, inf) => setPeople(ps => ps.map(p => p.id===id ? {...p, inf} : p));

  return (
    <div className="stack">
      <div className="grid g3">
        <div className="card kpi"><div className="label">Champions</div><div className="value" style={{ color:'var(--green)' }}>{champions}</div><div className="sub">advocating internally</div></div>
        <div className="card kpi"><div className="label">Skeptics / blockers</div><div className="value" style={{ color: skeptics>1?'var(--amber)':'var(--text)' }}>{skeptics}</div><div className="sub">needs air-cover</div></div>
        <div className="card kpi"><div className="label">Stale contacts</div><div className="value" style={{ color: stale>2?'var(--amber)':'var(--text)' }}>{stale}</div><div className="sub">no touch &gt;1 month</div></div>
      </div>

      <div className="card">
        <div className="card-header">
          <div><h3>Stakeholder map</h3><div className="txt-sm txt-muted">influence × stance · {people.length} tracked</div></div>
          <div className="row gap-sm"><Btn sm ghost icon="download">PNG</Btn><Btn sm primary icon="plus">Add stakeholder</Btn></div>
        </div>
        <div className="card-body">
          {/* matrix */}
          <div style={{ display:'grid', gridTemplateColumns:'90px repeat(5, 1fr)', gap:4, fontSize:11 }}>
            <div/>
            {STANCES.map(s => (
              <div key={s.k} style={{ textAlign:'center', paddingBottom:6 }}>
                <div style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-3)', fontWeight:600 }}>{s.l}</div>
                <div className="txt-sm txt-muted" style={{ fontSize:10 }}>{s.hint}</div>
              </div>
            ))}
            {[5,4,3,2,1].map(inf => (
              <React.Fragment key={inf}>
                <div style={{ color:'var(--text-3)', fontSize:10, textTransform:'uppercase', letterSpacing:'.05em', display:'flex', alignItems:'center', justifyContent:'flex-end', paddingRight:8, fontWeight:600 }}>
                  {inf===5?'Exec':inf===4?'High':inf===3?'Mid':inf===2?'Low':'Peripheral'}
                </div>
                {STANCES.map(s => {
                  const nodes = byCell(inf, s.k);
                  const bg = s.k==='champion' ? 'rgba(63,124,92,0.07)'
                           : s.k==='supporter' ? 'rgba(99,131,167,0.07)'
                           : s.k==='skeptic'   ? 'rgba(196,169,98,0.10)'
                           : s.k==='blocker'   ? 'rgba(165,52,47,0.10)'
                           : 'rgba(0,0,0,0.02)';
                  return (
                    <div key={s.k} style={{ background:bg, border:'1px solid var(--divider)', borderRadius:4, minHeight:72, padding:6, display:'flex', flexDirection:'column', gap:4 }}>
                      {nodes.map(p => (
                        <div key={p.id} onClick={()=>setSel(p)} title={`${p.role} · last touch ${p.lastTouch}`}
                             style={{ background:'var(--bg)', border:`1px solid ${sel?.id===p.id?'var(--brand)':'var(--border)'}`, borderRadius:4, padding:'4px 6px', cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                          <Avatar size={20} tone={stanceTone(p.stance)==='green'?'var(--green)':stanceTone(p.stance)==='red'?'var(--red)':'var(--text-3)'}>{p.name.split(' ').slice(-1)[0][0]}</Avatar>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:11, fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.name}</div>
                            <div className="txt-sm txt-muted" style={{ fontSize:10, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.role}</div>
                          </div>
                          {/mo/.test(p.lastTouch) && <span title="stale" style={{ width:6, height:6, borderRadius:'50%', background:'var(--amber)' }}/>}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>

          <div className="row gap-sm" style={{ marginTop:12, fontSize:11, color:'var(--text-3)' }}>
            <span>↑ influence</span>
            <span className="ml-auto">Click a node to edit · drag to reposition (TBD)</span>
          </div>
        </div>
      </div>

      {sel && (
        <div className="card" style={{ borderColor:'var(--brand)' }}>
          <div className="card-header">
            <div><h3 style={{ fontSize:14 }}>{sel.name}</h3><div className="txt-sm txt-muted">{sel.role} · {sel.buyer} buyer · owner {sel.owner}</div></div>
            <Btn sm ghost onClick={()=>setSel(null)}>Close</Btn>
          </div>
          <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
            <div>
              <div className="wl" style={{ margin:0, marginBottom:4 }}>Stance</div>
              <select value={sel.stance} onChange={e=>{ updateStance(sel.id, e.target.value); setSel({...sel, stance:e.target.value}); }} style={{ width:'100%' }}>
                {STANCES.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}
              </select>
            </div>
            <div>
              <div className="wl" style={{ margin:0, marginBottom:4 }}>Influence</div>
              <select value={sel.inf} onChange={e=>{ updateInf(sel.id, +e.target.value); setSel({...sel, inf:+e.target.value}); }} style={{ width:'100%' }}>
                <option value={5}>5 · Exec</option><option value={4}>4 · High</option><option value={3}>3 · Mid</option><option value={2}>2 · Low</option><option value={1}>1 · Peripheral</option>
              </select>
            </div>
            <div>
              <div className="wl" style={{ margin:0, marginBottom:4 }}>Last touch</div>
              <div className="v" style={{ fontSize:13 }}>{sel.lastTouch} ago <Btn sm ghost style={{ marginLeft:8 }}>Log →</Btn></div>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <div className="wl" style={{ margin:0, marginBottom:4 }}>Notes</div>
              <textarea defaultValue={sel.notes} rows={2} style={{ width:'100%', padding:8, border:'1px solid var(--border)', borderRadius:4, fontFamily:'inherit' }}/>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ========== CLIENT · COMMERCIAL TERMS ==========
// What we've agreed in the MSA + how rates deviate from standard — visible to partners only.
// Shows: pricing method, rate-card discounts, payment terms, volume commitments, renewal structure, risk-sharing clauses.

const ClientTermsPanel = ({ client }) => {
  const [terms, setTerms] = React.useState({
    msaVersion: 'MSA 2024 · v1.2',
    msaStart: '14 Jan 2024',
    msaEnd: '14 Jan 2027',
    autoRenew: true,
    noticePeriod: 60,
    // Pricing
    pricingMethod: 'rate-card-discount',
    rateCardDiscount: 8,           // % off standard rate card
    preferredPartnerTier: 'tier-2', // tier-1 / tier-2 / standard
    // Volume
    volumeCommitmentAU: 1500000,   // committed spend over MSA term
    volumeToDate: 880000,
    // Payment
    paymentTerms: 30,
    earlyPayDiscount: 2,            // %
    earlyPayDays: 10,
    latePenaltyPct: 1.5,
    poRequired: true,
    // Risk sharing
    riskShare: 'milestone',         // none / milestone / success-fee
    successFeeCap: 15,              // % upside of contract
    // Exclusivity
    exclusivity: 'category',        // none / category / geo / full
    exclusivityNotes: 'Digital-health category, APAC region',
  });

  const patch = (p) => setTerms(t => ({...t, ...p}));
  const volUtil = Math.round(terms.volumeToDate / terms.volumeCommitmentAU * 100);

  return (
    <div className="stack">
      <Callout tone="info">
        <span className="txt-sm">These terms govern <b>all projects</b> under the {terms.msaVersion}. Deviations per engagement are negotiated in the SOW and tracked on the project's Contract tab.</span>
      </Callout>

      <div className="grid g3">
        <div className="card kpi">
          <div className="label">MSA status</div>
          <div className="value" style={{ fontSize:20 }}>{terms.msaVersion.split(' · ')[1]}</div>
          <div className="sub">{terms.msaStart} → {terms.msaEnd} {terms.autoRenew && '· auto-renew'}</div>
        </div>
        <div className="card kpi">
          <div className="label">Volume commitment</div>
          <div className="value mono">${(terms.volumeCommitmentAU/1e6).toFixed(2)}M</div>
          <div className="sub" style={{ color: volUtil>80?'var(--amber)':'var(--text-3)' }}>
            {volUtil}% utilised · ${(terms.volumeToDate/1e3).toFixed(0)}k to date
          </div>
          <div style={{ height:4, background:'var(--bg-subtle)', borderRadius:2, marginTop:6, overflow:'hidden' }}>
            <div style={{ width:`${Math.min(100,volUtil)}%`, height:'100%', background: volUtil>80?'var(--amber)':'var(--green)' }}/>
          </div>
        </div>
        <div className="card kpi">
          <div className="label">Rate-card discount</div>
          <div className="value mono" style={{ color:'var(--brand)' }}>−{terms.rateCardDiscount}%</div>
          <div className="sub">preferred {terms.preferredPartnerTier.replace('-',' ')} pricing</div>
        </div>
      </div>

      {/* Pricing */}
      <div className="card">
        <div className="card-header"><h3>Pricing structure</h3><Btn sm ghost icon="pencil">Edit</Btn></div>
        <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          <div>
            <div className="wl" style={{ margin:0, marginBottom:4 }}>Pricing method</div>
            <select value={terms.pricingMethod} onChange={e=>patch({pricingMethod:e.target.value})} style={{ width:'100%' }}>
              <option value="rate-card-discount">Rate card − discount %</option>
              <option value="fixed-fee">Fixed fee per engagement</option>
              <option value="retainer">Monthly retainer</option>
              <option value="hybrid">Hybrid (fixed + variable)</option>
            </select>
          </div>
          <div>
            <div className="wl" style={{ margin:0, marginBottom:4 }}>Preferred partner tier</div>
            <select value={terms.preferredPartnerTier} onChange={e=>patch({preferredPartnerTier:e.target.value})} style={{ width:'100%' }}>
              <option value="tier-1">Tier 1 · 15% off</option>
              <option value="tier-2">Tier 2 · 8% off</option>
              <option value="standard">Standard · no discount</option>
            </select>
          </div>
          <div>
            <div className="row-spread"><span className="wl" style={{ margin:0 }}>Rate-card discount</span><b className="mono">{terms.rateCardDiscount}%</b></div>
            <input type="range" min={0} max={25} value={terms.rateCardDiscount} onChange={e=>patch({rateCardDiscount:+e.target.value})} style={{ width:'100%', marginTop:6 }}/>
          </div>
          <div>
            <div className="row-spread"><span className="wl" style={{ margin:0 }}>Volume commitment (MSA term)</span><b className="mono">${(terms.volumeCommitmentAU/1e6).toFixed(2)}M</b></div>
            <input type="range" min={250000} max={5000000} step={250000} value={terms.volumeCommitmentAU} onChange={e=>patch({volumeCommitmentAU:+e.target.value})} style={{ width:'100%', marginTop:6 }}/>
          </div>
        </div>
      </div>

      {/* Payment */}
      <div className="card">
        <div className="card-header"><h3>Payment &amp; settlement</h3><Btn sm ghost icon="pencil">Edit</Btn></div>
        <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
          <div>
            <div className="wl" style={{ margin:0, marginBottom:4 }}>Standard terms</div>
            <select value={terms.paymentTerms} onChange={e=>patch({paymentTerms:+e.target.value})} style={{ width:'100%' }}>
              <option value={7}>Net 7</option><option value={14}>Net 14</option><option value={30}>Net 30</option><option value={45}>Net 45</option><option value={60}>Net 60</option>
            </select>
          </div>
          <div>
            <div className="wl" style={{ margin:0, marginBottom:4 }}>Early-pay discount</div>
            <div className="row gap-sm"><input type="number" value={terms.earlyPayDiscount} onChange={e=>patch({earlyPayDiscount:+e.target.value})} className="mono" style={{ width:60 }}/><span className="txt-sm">% if paid within</span><input type="number" value={terms.earlyPayDays} onChange={e=>patch({earlyPayDays:+e.target.value})} className="mono" style={{ width:60 }}/><span className="txt-sm">days</span></div>
          </div>
          <div>
            <div className="wl" style={{ margin:0, marginBottom:4 }}>Late penalty</div>
            <div className="row gap-sm"><input type="number" step="0.25" value={terms.latePenaltyPct} onChange={e=>patch({latePenaltyPct:+e.target.value})} className="mono" style={{ width:60 }}/><span className="txt-sm">% per month overdue</span></div>
          </div>
          <div className="row" style={{ gridColumn:'1/-1', gap:14, borderTop:'1px solid var(--divider)', paddingTop:10 }}>
            <label className="row gap-sm txt-sm"><input type="checkbox" checked={terms.poRequired} onChange={e=>patch({poRequired:e.target.checked})}/> PO number required per invoice</label>
            <span className="ml-auto txt-sm txt-muted">Applies to all projects under this MSA · override per SOW if needed</span>
          </div>
        </div>
      </div>

      {/* Risk sharing */}
      <div className="card">
        <div className="card-header"><h3>Risk sharing &amp; exclusivity</h3><Badge tone="amber" dot>partner review</Badge></div>
        <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          <div>
            <div className="wl" style={{ margin:0, marginBottom:4 }}>Risk-share model</div>
            <select value={terms.riskShare} onChange={e=>patch({riskShare:e.target.value})} style={{ width:'100%' }}>
              <option value="none">None · T&amp;M only</option>
              <option value="milestone">Milestone-gated</option>
              <option value="success-fee">Success fee on outcome</option>
              <option value="equity">Equity / warrant</option>
            </select>
          </div>
          <div>
            <div className="row-spread"><span className="wl" style={{ margin:0 }}>Success-fee cap</span><b className="mono">{terms.successFeeCap}%</b></div>
            <input type="range" min={0} max={50} value={terms.successFeeCap} onChange={e=>patch({successFeeCap:+e.target.value})} style={{ width:'100%', marginTop:6 }}/>
            <div className="txt-sm txt-muted" style={{ fontSize:11 }}>as % of contract value</div>
          </div>
          <div>
            <div className="wl" style={{ margin:0, marginBottom:4 }}>Exclusivity</div>
            <select value={terms.exclusivity} onChange={e=>patch({exclusivity:e.target.value})} style={{ width:'100%' }}>
              <option value="none">None</option>
              <option value="category">By category</option>
              <option value="geo">By geography</option>
              <option value="full">Full exclusivity</option>
            </select>
          </div>
          <div>
            <div className="wl" style={{ margin:0, marginBottom:4 }}>Exclusivity scope</div>
            <input className="wi" value={terms.exclusivityNotes} onChange={e=>patch({exclusivityNotes:e.target.value})} placeholder="e.g. Digital-health, APAC"/>
          </div>
        </div>
      </div>

      {/* Renewal */}
      <div className="card">
        <div className="card-header"><h3>Renewal &amp; termination</h3></div>
        <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
          <div>
            <div className="wl" style={{ margin:0, marginBottom:4 }}>Notice period</div>
            <div className="row gap-sm"><input type="number" value={terms.noticePeriod} onChange={e=>patch({noticePeriod:+e.target.value})} className="mono" style={{ width:70 }}/><span className="txt-sm">days</span></div>
          </div>
          <div className="row-spread">
            <span className="wl" style={{ margin:0 }}>Auto-renew</span>
            <input type="checkbox" checked={terms.autoRenew} onChange={e=>patch({autoRenew:e.target.checked})}/>
          </div>
          <div>
            <div className="wl" style={{ margin:0, marginBottom:4 }}>Next review</div>
            <div className="v" style={{ fontSize:13 }}>Oct 2026 · 90d before renewal</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ background:'var(--bg-subtle)', borderStyle:'dashed' }}>
        <div className="card-body row">
          <div className="txt-sm txt-muted">Changes produce a new MSA revision · all active SOWs re-reference on next invoice cycle</div>
          <div className="ml-auto row gap-sm"><Btn sm ghost>Export PDF</Btn><Btn sm primary>Save &amp; bump version</Btn></div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { ClientDrawer, SupplierDrawer, ClientRelMapPanel, ClientTermsPanel });