// Capability drawer — opens when clicking any capability row on Cost Planning
// Shows vendor profile, cost profile, history, contract, alternatives + edit form

const CapabilityDrawer = ({ cap, group, onClose }) => {
  const [tab, setTab] = React.useState('overview');
  const [editing, setEditing] = React.useState(false);
  if (!cap) return null;

  // Synthesised mock profile for the selected capability
  const invoices = [
    { date:'01 Apr 2026', amt:cap.monthly, status:'paid',    ref:'INV-'+Math.floor(Math.random()*900+100) },
    { date:'01 Mar 2026', amt:cap.monthly, status:'paid',    ref:'INV-'+Math.floor(Math.random()*900+100) },
    { date:'01 Feb 2026', amt:cap.monthly, status:'paid',    ref:'INV-'+Math.floor(Math.random()*900+100) },
    { date:'01 Jan 2026', amt:cap.monthly, status:'paid',    ref:'INV-'+Math.floor(Math.random()*900+100) },
    { date:'01 Dec 2025', amt:Math.round(cap.monthly*0.92), status:'paid',    ref:'INV-'+Math.floor(Math.random()*900+100) },
    { date:'01 Nov 2025', amt:Math.round(cap.monthly*0.92), status:'paid',    ref:'INV-'+Math.floor(Math.random()*900+100) },
  ];
  const alternatives = {
    'AI / LLM platform':[{v:'OpenAI Team', plan:'5 seats', monthly: 625, note:'switched last yr'}, {v:'Gemini Workspace', plan:'—', monthly: 720}],
    'Project management':[{v:'Linear', plan:'Business', monthly: 180}, {v:'Asana', plan:'Business', monthly: 252}],
    'CRM · BD pipeline':[{v:'Attio', plan:'Pro · 3 seats', monthly: 135, note:'evaluating'}, {v:'Native sheet', plan:'—', monthly: 0}],
    'Legal counsel · retainer':[{v:'Minter Ellison', plan:'Retainer', monthly: 5200}, {v:'K&L Gates', plan:'As-needed', monthly: 3800}],
  }[cap.cap] || [{v:'—', plan:'no alternatives evaluated', monthly:0}];

  const contacts = [
    { role:'Account mgr', name:cap.vendor.split(' ')[0]+' team', email: (cap.vendor.split(' ')[0].toLowerCase())+'@'+(cap.vendor.split(' ')[0].toLowerCase())+'.com', phone:'+61 2 8xxx' },
    { role:'Support', name:'24/7 portal', email:'support@'+(cap.vendor.split(' ')[0].toLowerCase())+'.com' },
  ];
  const contractDocs = [
    { name: cap.vendor+' — MSA 2025.pdf', size:'412 kB', date:'signed 14 Jan 2025' },
    { name: cap.vendor+' — Order form.pdf', size:'86 kB', date:'renewed 14 Jan 2026' },
    { name: cap.vendor+' — DPA.pdf', size:'128 kB', date:'15 Jan 2025' },
  ];
  const notes = [
    { when:'12 Apr 2026', who:'JS', text:'Renewed seats — added 2, removed 1.' },
    { when:'02 Feb 2026', who:'TT', text:'Negotiated 8% off on annual commit.' },
    { when:'14 Jan 2025', who:'TT', text:'Initial procurement. Evaluated 3 vendors.' },
  ];

  const fmt = (n) => `$${n.toLocaleString()}`;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e=>e.stopPropagation()} style={{ width: 820 }}>
        <div className="drawer-header">
          <div>
            <div className="txt-sm txt-muted">{group.label} · capability profile</div>
            <h2 style={{ margin:'4px 0 0', fontFamily:'var(--font-serif)', fontWeight:400, fontSize:24 }}>
              {cap.cap}
              {cap.must && <span style={{ marginLeft:8, fontSize:10, padding:'2px 7px', border:'1px solid var(--border)', borderRadius:3, color:'var(--text-3)', fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'.05em', verticalAlign:'middle' }}>core</span>}
            </h2>
            <div className="row gap-sm" style={{ marginTop:6, alignItems:'center' }}>
              <b>{cap.vendor}</b><span className="txt-sm txt-muted">· {cap.plan}</span>
              {cap.status==='live' && <Badge tone="green" dot>live</Badge>}
              {cap.status==='review' && <Badge tone="amber" dot>review</Badge>}
              {cap.status==='gap' && <Badge tone="red" dot>gap</Badge>}
            </div>
          </div>
          <div className="row gap-sm">
            {!editing && <Btn sm onClick={()=>setEditing(true)} icon="pencil">Edit</Btn>}
            {editing && <Btn sm primary onClick={()=>setEditing(false)}>Save</Btn>}
            {editing && <Btn sm ghost onClick={()=>setEditing(false)}>Cancel</Btn>}
            <Btn sm ghost onClick={onClose}>✕</Btn>
          </div>
        </div>

        <div className="tabs" style={{ padding:'0 20px' }}>
          {[['overview','Overview'],['cost','Cost profile'],['contract','Contract & docs'],['contacts','Contacts'],['alternatives','Alternatives'],['notes','Notes & history']].map(([k,l])=>(
            <div key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</div>
          ))}
        </div>

        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          {tab==='overview' && <div className="stack">
            <div className="grid g3">
              <div className="card kpi"><div className="label">Monthly</div><div className="value mono">{fmt(cap.monthly)}</div><div className="sub">run-rate</div></div>
              <div className="card kpi"><div className="label">Annual</div><div className="value mono">{fmt(cap.monthly*12)}</div><div className="sub">contract value</div></div>
              <div className="card kpi"><div className="label">Next renewal</div><div className="value" style={{ fontSize:22 }}>14 Jan 2027</div><div className="sub">9 mo · auto-renews</div></div>
            </div>
            <div className="card">
              <div className="card-header"><h3>Details</h3>{!editing && <Btn sm ghost icon="pencil" onClick={()=>setEditing(true)}>Edit</Btn>}</div>
              <div className="card-body">
                <div className="grid g2" style={{ gap:10 }}>
                  <div className="field"><label>Capability</label><div className="v">{editing ? <input defaultValue={cap.cap}/> : <b>{cap.cap}</b>}</div></div>
                  <div className="field"><label>Category</label><div className="v">{editing ? <select defaultValue={group.id}><option>{group.label}</option></select> : group.label}</div></div>
                  <div className="field"><label>Vendor</label><div className="v">{editing ? <input defaultValue={cap.vendor}/> : <b>{cap.vendor}</b>}</div></div>
                  <div className="field"><label>Plan</label><div className="v">{editing ? <input defaultValue={cap.plan}/> : cap.plan}</div></div>
                  <div className="field"><label>Monthly cost</label><div className="v">{editing ? <input defaultValue={cap.monthly}/> : <span className="mono">{fmt(cap.monthly)}</span>}</div></div>
                  <div className="field"><label>Owner</label><div className="v">{editing ? <input defaultValue={cap.owner}/> : (cap.owner!=='—'?<Avatar size={22}>{cap.owner}</Avatar>:'—')}</div></div>
                  <div className="field"><label>Status</label><div className="v">{editing ? <select defaultValue={cap.status}><option>live</option><option>review</option><option>gap</option></select> : cap.status}</div></div>
                  <div className="field"><label>Core / non-optional</label><div className="v">{editing ? <input type="checkbox" defaultChecked={cap.must}/> : (cap.must?'Yes · core':'No')}</div></div>
                </div>
                {cap.note && !editing && <Callout tone="amber" title="Note">{cap.note}</Callout>}
                {editing && <div className="field" style={{ marginTop:10 }}><label>Notes</label><div className="v"><textarea defaultValue={cap.note||''} rows={3} style={{ width:'100%', fontFamily:'inherit' }}/></div></div>}
              </div>
            </div>
          </div>}

          {tab==='cost' && <div className="stack">
            <div className="card">
              <div className="card-header"><h3>Historical spend · 12 mo</h3></div>
              <div className="card-body">
                <div style={{ display:'flex', alignItems:'flex-end', gap:4, height:100, padding:'4px 0' }}>
                  {Array.from({length:12}).map((_,i)=>{
                    const v = i<6 ? cap.monthly*0.92 : cap.monthly;
                    const h = (v/cap.monthly)*90;
                    return <div key={i} style={{ flex:1, height:h, background: i>=6?'var(--brand)':'var(--text-3)', borderRadius:'2px 2px 0 0' }} title={fmt(Math.round(v))+'/mo'}/>;
                  })}
                </div>
                <div className="row-spread txt-sm txt-muted" style={{ marginTop:6 }}><span>May 25</span><span>Apr 26</span></div>
                <div className="hdiv"/>
                <div className="grid g3">
                  <div><div className="txt-sm txt-muted">12-mo total</div><div className="mono" style={{ fontSize:20, fontWeight:600 }}>{fmt(Math.round(cap.monthly*11.5))}</div></div>
                  <div><div className="txt-sm txt-muted">YoY change</div><div className="mono" style={{ fontSize:20, fontWeight:600, color:'var(--amber)' }}>+8.7%</div></div>
                  <div><div className="txt-sm txt-muted">% of firm OPEX</div><div className="mono" style={{ fontSize:20, fontWeight:600 }}>{((cap.monthly/24000)*100).toFixed(1)}%</div></div>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3>Paid invoices</h3><Btn sm ghost onClick={()=>{ onClose && onClose(); window.__nav && window.__nav('invoices'); }}>Open Invoices →</Btn></div>
              <table className="tbl">
                <thead><tr><th>Date</th><th>Reference</th><th className="num">Amount</th><th>Status</th></tr></thead>
                <tbody>{invoices.map((r,i)=>(<tr key={i}><td>{r.date}</td><td className="mono">{r.ref}</td><td className="num mono">{fmt(r.amt)}</td><td><Badge tone="green" dot>{r.status}</Badge></td></tr>))}</tbody>
              </table>
            </div>
          </div>}

          {tab==='contract' && <div className="stack">
            <div className="card">
              <div className="card-header"><h3>Contract terms</h3><Btn sm ghost>Edit terms</Btn></div>
              <div className="card-body">
                <div className="grid g2" style={{ gap:10 }}>
                  <div className="field"><label>Contract type</label><div className="v">Master Services Agreement + Order Form</div></div>
                  <div className="field"><label>Term</label><div className="v">12 months · auto-renews</div></div>
                  <div className="field"><label>Start</label><div className="v">14 Jan 2025</div></div>
                  <div className="field"><label>End / renewal</label><div className="v">14 Jan 2027</div></div>
                  <div className="field"><label>Payment terms</label><div className="v">Net 30 · monthly invoicing</div></div>
                  <div className="field"><label>Cancellation notice</label><div className="v">60 days written</div></div>
                  <div className="field"><label>DPA signed</label><div className="v">Yes · 15 Jan 2025</div></div>
                  <div className="field"><label>SLA</label><div className="v">99.9% uptime · support &lt; 24h</div></div>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3>Documents</h3><Btn sm icon="upload">Upload</Btn></div>
              <div className="list">
                {contractDocs.map((d,i)=>(
                  <div key={i} className="list-item" style={{ cursor:'pointer' }}>
                    <div className="main"><div style={{ fontWeight:500 }}>📄 {d.name}</div><div className="txt-sm txt-muted">{d.size} · {d.date}</div></div>
                    <Btn sm ghost>Open</Btn>
                  </div>
                ))}
              </div>
            </div>
          </div>}

          {tab==='contacts' && <div className="stack">
            <div className="card">
              <div className="card-header"><h3>Vendor contacts</h3><Btn sm icon="plus">Add contact</Btn></div>
              <div className="list">
                {contacts.map((c,i)=>(
                  <div key={i} className="list-item">
                    <div className="main"><div style={{ fontWeight:500 }}>{c.name}</div><div className="txt-sm txt-muted">{c.role} · {c.email}{c.phone?' · '+c.phone:''}</div></div>
                    <Btn sm ghost>Email</Btn>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3>Internal owner</h3></div>
              <div className="card-body">
                <div className="row gap-sm">
                  {cap.owner!=='—' ? <Avatar size={36}>{cap.owner}</Avatar> : <div className="txt-muted">No owner assigned</div>}
                  <div><b>{cap.owner}</b><div className="txt-sm txt-muted">responsible for renewal, escalations, usage review</div></div>
                  <Btn sm ghost style={{ marginLeft:'auto' }} onClick={()=>{ onClose && onClose(); window.__nav && window.__nav('directory'); }}>Open profile →</Btn>
                </div>
              </div>
            </div>
          </div>}

          {tab==='alternatives' && <div className="card">
            <div className="card-header"><h3>Evaluated alternatives</h3><Btn sm icon="plus">Add alternative</Btn></div>
            <table className="tbl">
              <thead><tr><th>Vendor</th><th>Plan</th><th className="num">Monthly</th><th className="num">Δ vs. current</th><th>Note</th></tr></thead>
              <tbody>
                <tr style={{ background:'var(--accent-soft)' }}>
                  <td><b>{cap.vendor}</b> <Badge tone="accent">current</Badge></td>
                  <td>{cap.plan}</td>
                  <td className="num mono">{fmt(cap.monthly)}</td>
                  <td className="num mono txt-muted">—</td>
                  <td className="txt-sm txt-muted">chosen</td>
                </tr>
                {alternatives.map((a,i)=>{
                  const d = a.monthly - cap.monthly;
                  return <tr key={i}><td>{a.v}</td><td>{a.plan}</td><td className="num mono">{fmt(a.monthly)}</td><td className="num mono" style={{ color: d<=0?'var(--green)':'var(--amber)' }}>{d<=0?'':'+'}{fmt(d)}</td><td className="txt-sm txt-muted">{a.note||'—'}</td></tr>;
                })}
              </tbody>
            </table>
          </div>}

          {tab==='notes' && <div className="card">
            <div className="card-header"><h3>Activity & notes</h3><Btn sm icon="plus">Add note</Btn></div>
            <div className="card-body">
              <textarea placeholder="Add a note…" rows={3} style={{ width:'100%', fontFamily:'inherit', padding:8, border:'1px solid var(--border)', borderRadius:4 }}/>
              <div className="row gap-sm" style={{ justifyContent:'flex-end', marginTop:8 }}><Btn sm primary>Post</Btn></div>
            </div>
            <div className="list">
              {notes.map((n,i)=>(
                <div key={i} className="list-item" style={{ alignItems:'flex-start' }}>
                  <Avatar size={28}>{n.who}</Avatar>
                  <div className="main"><div className="txt-sm" style={{ fontWeight:500 }}>{n.who} · <span className="txt-muted">{n.when}</span></div><div style={{ marginTop:2, fontSize:13 }}>{n.text}</div></div>
                </div>
              ))}
            </div>
          </div>}
        </div>

        <div className="drawer-footer" style={{ borderTop:'1px solid var(--border)', padding:'12px 20px', display:'flex', gap:8, justifyContent:'space-between' }}>
          <Btn sm ghost style={{ color:'var(--red)' }}>Remove capability</Btn>
          <div className="row gap-sm">
            <Btn sm>Flag for review</Btn>
            <Btn sm primary icon="arrow">Renew / change plan</Btn>
          </div>
        </div>
      </div>
    </div>
  );
};

// Add Capability wizard — opens from "+ Add capability" buttons
const AddCapabilityModal = ({ group, onClose, onSave }) => {
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e=>e.stopPropagation()} style={{ width: 580 }}>
        <div className="drawer-header">
          <div>
            <div className="txt-sm txt-muted">{group?group.label:'New capability'}</div>
            <h2 style={{ margin:'4px 0 0', fontFamily:'var(--font-serif)', fontWeight:400, fontSize:22 }}>Add capability</h2>
          </div>
          <Btn sm ghost onClick={onClose}>✕</Btn>
        </div>
        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          <div className="stack">
            <div className="field"><label>Capability name *</label><div className="v"><input placeholder="e.g. Data room hosting"/></div></div>
            <div className="field"><label>Category</label><div className="v"><select defaultValue={group?group.id:'tech'}><option value="tech">Technology platform</option><option value="legal">Legal & compliance</option><option value="insurance">Insurance & indemnity</option><option value="finance">Finance & accounting</option><option value="ops">Office & operations</option><option value="people">People & capability</option><option value="bd">BD & marketing</option></select></div></div>
            <div className="field"><label>Vendor *</label><div className="v"><input placeholder="e.g. Datasite"/></div></div>
            <div className="field"><label>Plan / tier</label><div className="v"><input placeholder="e.g. Business · 5 seats"/></div></div>
            <div className="grid g2" style={{ gap:10 }}>
              <div className="field"><label>Monthly cost (AUD)</label><div className="v"><input type="number" placeholder="0"/></div></div>
              <div className="field"><label>Contract term (mo)</label><div className="v"><input type="number" defaultValue={12}/></div></div>
            </div>
            <div className="grid g2" style={{ gap:10 }}>
              <div className="field"><label>Owner</label><div className="v"><select defaultValue="JS"><option>TT</option><option>MB</option><option>SR</option><option>JS</option><option>CC</option></select></div></div>
              <div className="field"><label>Status</label><div className="v"><select defaultValue="review"><option>review</option><option>live</option><option>gap</option></select></div></div>
            </div>
            <div className="field"><label>Core / non-optional</label><div className="v"><label><input type="checkbox"/> yes — this is a must-have</label></div></div>
            <div className="field"><label>Notes</label><div className="v"><textarea rows={3} placeholder="why we need this, what we evaluated, links to docs" style={{ width:'100%', fontFamily:'inherit' }}/></div></div>
          </div>
        </div>
        <div className="drawer-footer" style={{ borderTop:'1px solid var(--border)', padding:'12px 20px', display:'flex', gap:8, justifyContent:'flex-end' }}>
          <Btn sm ghost onClick={onClose}>Cancel</Btn>
          <Btn sm primary onClick={()=>{ onSave&&onSave(); onClose&&onClose(); }}>Add capability</Btn>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { CapabilityDrawer, AddCapabilityModal });
