// Line-item drawers for Project detail tabs (and reused across the app)

const InvoiceDrawer = ({ inv, onClose }) => {
  const [tab, setTab] = React.useState('overview');
  if (!inv) return null;
  const direction = inv.direction || 'out'; // out = client invoice; in = supplier
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e=>e.stopPropagation()} style={{ width: 760 }}>
        <div className="drawer-header">
          <div>
            <div className="txt-sm txt-muted">{direction==='out'?'Invoice out · to client':'Invoice in · from supplier'} · <span className="mono">{inv.ref}</span></div>
            <h2 style={{ margin:'4px 0 0', fontFamily:'var(--font-serif)', fontWeight:400, fontSize:24 }}>{inv.title || inv.milestone || inv.supplier || 'Invoice'}</h2>
            <div className="row gap-sm" style={{ marginTop:6, alignItems:'center' }}>
              <span className="mono" style={{ fontWeight:600 }}>{inv.amount}</span>
              <Badge tone={inv.tone||'amber'} dot>{inv.status||'outstanding'}</Badge>
              {inv.code && <Badge>{inv.code}</Badge>}
            </div>
          </div>
          <div className="row gap-sm">
            {direction==='out' && inv.status!=='paid' && <Btn sm primary icon="arrow">Send reminder</Btn>}
            {direction==='in' && inv.status==='pending' && <Btn sm primary icon="check">Approve</Btn>}
            <Btn sm icon="download">PDF</Btn>
            <Btn sm ghost onClick={onClose}>✕</Btn>
          </div>
        </div>
        <div className="tabs" style={{ padding:'0 20px' }}>
          {[['overview','Overview'],['lineitems','Line items'],['docs','Docs'],['activity','Activity']].map(([k,l])=>(<div key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</div>))}
        </div>
        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          {tab==='overview' && <div className="stack">
            <div className="card">
              <div className="card-header"><h3>Details</h3><Btn sm ghost icon="pencil">Edit</Btn></div>
              <div className="card-body">
                <div className="grid g2" style={{ gap:10 }}>
                  <div className="field"><label>{direction==='out'?'Client':'Supplier'}</label><div className="v"><b>{inv.party || 'IFM Pty Ltd'}</b></div></div>
                  <div className="field"><label>Project</label><div className="v"><span className="mono">{inv.code||'IFM001'}</span></div></div>
                  <div className="field"><label>{direction==='out'?'Milestone':'Category'}</label><div className="v">{inv.milestone || inv.category || '—'}</div></div>
                  <div className="field"><label>Issue date</label><div className="v">{inv.issued||'07 Mar 2026'}</div></div>
                  <div className="field"><label>Due date</label><div className="v">{inv.due||'06 Apr 2026'}</div></div>
                  <div className="field"><label>Payment terms</label><div className="v">Net 30</div></div>
                  <div className="field"><label>Currency</label><div className="v">AUD</div></div>
                  <div className="field"><label>Status</label><div className="v"><Badge tone={inv.tone||'amber'} dot>{inv.status||'outstanding'}</Badge></div></div>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3>Amount</h3></div>
              <div className="card-body">
                <div className="row-spread"><span>Subtotal</span><span className="mono">{inv.amount}</span></div>
                <div className="row-spread"><span>GST 10%</span><span className="mono txt-muted">incl.</span></div>
                <div className="hdiv"/>
                <div className="row-spread"><b>Total</b><b className="mono" style={{ fontSize:18 }}>{inv.amount}</b></div>
              </div>
            </div>
            {direction==='out' && inv.status==='outstanding' && <Callout tone="amber" title="34 days outstanding"><span className="txt-sm">Within 30-day terms · no reminder sent yet. Chaser recommended at day 35.</span></Callout>}
          </div>}
          {tab==='lineitems' && <div className="card">
            <div className="card-header"><h3>Line items</h3><Btn sm icon="plus">Add line</Btn></div>
            <table className="tbl">
              <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
              <tbody>
                <tr><td>{inv.milestone||inv.supplier||'Services'}</td><td className="num">1</td><td className="num mono">{inv.amount}</td><td className="num mono">{inv.amount}</td></tr>
              </tbody>
            </table>
          </div>}
          {tab==='docs' && <div className="card">
            <div className="card-header"><h3>Documents</h3><Btn sm icon="upload">Upload</Btn></div>
            <div className="list">
              <div className="list-item" style={{ cursor:'pointer' }}><div className="main">📄 {inv.ref}.pdf</div><Btn sm ghost>Open</Btn></div>
              {direction==='in' && <div className="list-item" style={{ cursor:'pointer' }}><div className="main">📄 receipt.pdf</div><Btn sm ghost>Open</Btn></div>}
            </div>
          </div>}
          {tab==='activity' && <div className="card">
            <div className="list">
              {[{w:'today',who:'System',t:`${direction==='out'?'Invoice sent to client':'Invoice received + OCR'}`},{w:'yesterday',who:'JS',t:'Assigned to project'},{w:'2d',who:'System',t:'OCR parsed · 94% confidence'}].map((a,i)=>(<div key={i} className="list-item" style={{ alignItems:'flex-start' }}><div style={{ width:60, fontSize:11, color:'var(--text-3)' }}>{a.w}</div><Avatar size={22}>{a.who[0]}</Avatar><div className="main txt-sm">{a.t}</div></div>))}
            </div>
          </div>}
        </div>
        <div className="drawer-footer" style={{ borderTop:'1px solid var(--border)', padding:'12px 20px', display:'flex', gap:8, justifyContent:'space-between' }}>
          <Btn sm ghost style={{ color:'var(--red)' }}>Void</Btn>
          <div className="row gap-sm">
            {direction==='out' && inv.status==='outstanding' && <Btn sm>Mark as paid</Btn>}
            {direction==='in' && <Btn sm>Reject</Btn>}
            <Btn sm primary>Download PDF</Btn>
          </div>
        </div>
      </div>
    </div>
  );
};

const ExpenseDrawer = ({ exp, onClose }) => {
  if (!exp) return null;
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e=>e.stopPropagation()} style={{ width: 680 }}>
        <div className="drawer-header">
          <div>
            <div className="txt-sm txt-muted">Expense · {exp.date}</div>
            <h2 style={{ margin:'4px 0 0', fontFamily:'var(--font-serif)', fontWeight:400, fontSize:22 }}>{exp.merchant}</h2>
            <div className="row gap-sm" style={{ marginTop:6, alignItems:'center' }}>
              <span className="mono" style={{ fontWeight:600 }}>{exp.amount}</span>
              <Badge>{exp.category}</Badge>
              {exp.code && <Badge tone="accent">{exp.code}</Badge>}
              <Badge tone={exp.tone||'green'} dot>{exp.status||'approved'}</Badge>
            </div>
          </div>
          <div className="row gap-sm">
            {exp.status==='pending' && <Btn sm primary icon="check">Approve</Btn>}
            <Btn sm ghost onClick={onClose}>✕</Btn>
          </div>
        </div>
        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          <div className="stack">
            <div className="card">
              <div className="card-header"><h3>Details</h3><Btn sm ghost icon="pencil">Edit</Btn></div>
              <div className="card-body">
                <div className="grid g2" style={{ gap:10 }}>
                  <div className="field"><label>Date</label><div className="v"><input defaultValue={exp.date}/></div></div>
                  <div className="field"><label>Amount</label><div className="v"><input defaultValue={exp.amount}/></div></div>
                  <div className="field"><label>Merchant</label><div className="v"><input defaultValue={exp.merchant}/></div></div>
                  <div className="field"><label>Category</label><div className="v"><select defaultValue={exp.category}><option>Travel</option><option>Meals</option><option>Subs</option><option>Other</option></select></div></div>
                  <div className="field"><label>Project</label><div className="v"><input defaultValue={exp.code||'—'}/></div></div>
                  <div className="field"><label>Billable</label><div className="v"><input type="checkbox" defaultChecked={exp.code!=='—'}/> yes</div></div>
                  <div className="field"><label>Paid by</label><div className="v">{exp.by||'CC'} · Amex ••4211</div></div>
                  <div className="field"><label>Status</label><div className="v"><Badge tone={exp.tone||'green'} dot>{exp.status||'approved'}</Badge></div></div>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3>Receipt</h3><Btn sm icon="upload">Replace</Btn></div>
              <div className="card-body" style={{ textAlign:'center', padding:40, background:'var(--bg-subtle)' }}>
                <div style={{ fontSize:40 }}>🧾</div>
                <div className="txt-sm txt-muted" style={{ marginTop:6 }}>{exp.merchant}-{exp.date.replace(/\s/g,'')}.pdf · 128kB</div>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3>Activity</h3></div>
              <div className="list">
                <div className="list-item"><div className="main txt-sm">{exp.by||'CC'} logged expense</div><div className="right">{exp.date}</div></div>
                {exp.status==='pending' && <div className="list-item"><div className="main txt-sm">Awaiting approval · MB</div><div className="right">today</div></div>}
                {exp.status==='approved' && <div className="list-item"><div className="main txt-sm">Approved · MB</div><div className="right">1d</div></div>}
              </div>
            </div>
          </div>
        </div>
        <div className="drawer-footer" style={{ borderTop:'1px solid var(--border)', padding:'12px 20px', display:'flex', gap:8, justifyContent:'space-between' }}>
          <Btn sm ghost style={{ color:'var(--red)' }}>Delete</Btn>
          <div className="row gap-sm">{exp.status==='pending' && <Btn sm>Reject</Btn>}<Btn sm primary>Save</Btn></div>
        </div>
      </div>
    </div>
  );
};

const MilestoneDrawer = ({ ms, onClose }) => {
  if (!ms) return null;
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e=>e.stopPropagation()} style={{ width: 620 }}>
        <div className="drawer-header">
          <div>
            <div className="txt-sm txt-muted">Milestone · {ms.id}</div>
            <h2 style={{ margin:'4px 0 0', fontFamily:'var(--font-serif)', fontWeight:400, fontSize:22 }}>{ms.name}</h2>
            <div className="row gap-sm" style={{ marginTop:6, alignItems:'center' }}>
              <span className="mono" style={{ fontWeight:600 }}>{ms.amount}</span>
              <Badge tone={ms.tone||'blue'} dot>{ms.status}</Badge>
            </div>
          </div>
          <Btn sm ghost onClick={onClose}>✕</Btn>
        </div>
        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          <div className="card">
            <div className="card-header"><h3>Details</h3><Btn sm ghost icon="pencil">Edit</Btn></div>
            <div className="card-body">
              <div className="grid g2" style={{ gap:10 }}>
                <div className="field"><label>Name</label><div className="v"><input defaultValue={ms.name}/></div></div>
                <div className="field"><label>Target week</label><div className="v"><input defaultValue={ms.target}/></div></div>
                <div className="field"><label>Billing amount</label><div className="v"><input defaultValue={ms.amount}/></div></div>
                <div className="field"><label>Status</label><div className="v"><select defaultValue={ms.status}><option>upcoming</option><option>in progress</option><option>invoiced</option><option>paid</option></select></div></div>
              </div>
              <div className="field" style={{ marginTop:10 }}><label>Acceptance criteria</label><div className="v"><textarea rows={3} defaultValue="Client sign-off on deliverable + readout meeting completed." style={{ width:'100%', fontFamily:'inherit' }}/></div></div>
            </div>
          </div>
        </div>
        <div className="drawer-footer" style={{ borderTop:'1px solid var(--border)', padding:'12px 20px', display:'flex', gap:8, justifyContent:'flex-end' }}>
          <Btn sm>Generate invoice</Btn>
          <Btn sm primary>Mark complete</Btn>
        </div>
      </div>
    </div>
  );
};

const TeamMemberDrawer = ({ m, onClose }) => {
  if (!m) return null;
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e=>e.stopPropagation()} style={{ width: 620 }}>
        <div className="drawer-header">
          <div>
            <div className="txt-sm txt-muted">Team member on IFM001</div>
            <h2 style={{ margin:'4px 0 0', fontFamily:'var(--font-serif)', fontWeight:400, fontSize:22 }}>{m.name} — {m.role}</h2>
          </div>
          <Btn sm ghost onClick={onClose}>✕</Btn>
        </div>
        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          <div className="stack">
            <div className="card">
              <div className="card-header"><h3>Allocation</h3><Btn sm ghost icon="pencil">Edit</Btn></div>
              <div className="card-body">
                <div className="grid g2" style={{ gap:10 }}>
                  <div className="field"><label>FTE</label><div className="v"><input defaultValue={m.fte}/></div></div>
                  <div className="field"><label>Rate</label><div className="v"><input defaultValue={m.rate}/></div></div>
                  <div className="field"><label>Planned hours</label><div className="v"><input defaultValue={m.planned}/></div></div>
                  <div className="field"><label>Actual hours</label><div className="v"><span className="mono">{m.actual}</span> <span className="txt-sm" style={{ color: m.tone==='green'?'var(--green)':'var(--amber)' }}>· {m.variance}</span></div></div>
                  <div className="field"><label>Start</label><div className="v">06 Jan 2026</div></div>
                  <div className="field"><label>End (planned)</label><div className="v">28 Mar 2026</div></div>
                </div>
              </div>
            </div>
            <div className="row gap-sm"><Btn sm onClick={()=>{ onClose&&onClose(); window.__nav && window.__nav('directory'); }}>Open full profile →</Btn></div>
          </div>
        </div>
        <div className="drawer-footer" style={{ borderTop:'1px solid var(--border)', padding:'12px 20px', display:'flex', gap:8, justifyContent:'space-between' }}>
          <Btn sm ghost style={{ color:'var(--red)' }}>Remove from project</Btn>
          <Btn sm primary>Save changes</Btn>
        </div>
      </div>
    </div>
  );
};

const ContractDocDrawer = ({ doc, onClose }) => {
  if (!doc) return null;
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e=>e.stopPropagation()} style={{ width: 620 }}>
        <div className="drawer-header">
          <div>
            <div className="txt-sm txt-muted">Contract document</div>
            <h2 style={{ margin:'4px 0 0', fontFamily:'var(--font-serif)', fontWeight:400, fontSize:22 }}>{doc.name}</h2>
            <div className="row gap-sm" style={{ marginTop:6, alignItems:'center' }}>
              <Badge tone={doc.status==='signed'?'green':'amber'} dot>{doc.status}</Badge>
              <span className="txt-sm txt-muted">· {doc.date} · {doc.note}</span>
            </div>
          </div>
          <Btn sm ghost onClick={onClose}>✕</Btn>
        </div>
        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          <div className="stack">
            <div className="card" style={{ minHeight: 280 }}>
              <div className="card-body" style={{ textAlign:'center', padding:40 }}>
                <div style={{ fontSize:48 }}>📄</div>
                <div className="txt-sm txt-muted" style={{ marginTop:8 }}>PDF preview</div>
                <Btn sm icon="download" style={{ marginTop:12 }}>Download</Btn>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3>Parties & signatures</h3></div>
              <div className="list">
                <div className="list-item"><div className="main"><b>Foundry Health Pty Ltd</b><div className="txt-sm txt-muted">TT · signed {doc.date}</div></div><Badge tone="green" dot>signed</Badge></div>
                <div className="list-item"><div className="main"><b>Client counterparty</b><div className="txt-sm txt-muted">Legal · {doc.date}</div></div><Badge tone={doc.status==='signed'?'green':'amber'} dot>{doc.status}</Badge></div>
              </div>
            </div>
          </div>
        </div>
        <div className="drawer-footer" style={{ borderTop:'1px solid var(--border)', padding:'12px 20px', display:'flex', gap:8, justifyContent:'space-between' }}>
          <Btn sm ghost>Send for signature</Btn>
          <div className="row gap-sm"><Btn sm>Upload new version</Btn><Btn sm primary>Open PDF</Btn></div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { InvoiceDrawer, ExpenseDrawer, MilestoneDrawer, TeamMemberDrawer, ContractDocDrawer });
