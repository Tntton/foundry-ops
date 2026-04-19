// screens-3.jsx — additional tab content (project detail, admin, directory)

// ===== Project Detail tab panels =====

const ProjectTeamTab = () => {
  const [assign, setAssign] = React.useState(false);
  const [openM, setOpenM] = React.useState(null);
  return (
  <div className="grid g-main-side">
    {assign && <window.AddTeamMemberModal onClose={()=>setAssign(false)}/>}
    {openM && window.TeamMemberDrawer && <window.TeamMemberDrawer m={openM} onClose={()=>setOpenM(null)}/>}
    <div className="stack">
      <div className="card">
        <div className="card-header"><h3>Assigned team · IFM001</h3><Btn sm icon="plus" onClick={()=>setAssign(true)}>Assign</Btn></div>
        <table className="tbl">
          <thead><tr><th>Member</th><th>Role</th><th className="num">FTE</th><th className="num">Rate</th><th className="num">Planned h</th><th className="num">Actual h</th><th className="num">Variance</th><th>Status</th></tr></thead>
          <tbody>
            {[['MB','Lead partner',0.5,'$2,000/d',240,246,'+2%','green'],['TT','Expert partner',0.5,'$2,000/d',180,186,'+3%','green'],['SR','Assoc partner',0.5,'$2,000/d',240,214,'−11%','amber'],['CC','Consultant',1.0,'$800/d',480,492,'+3%','green'],['JB','Analyst',1.0,'$400/d',480,512,'+7%','amber'],['AP','External expert','4h/wk','$250/h',48,33,'−31%','amber']].map((r,i)=>(
              <tr key={i} style={{ cursor:'pointer' }} onClick={()=>setOpenM({ name:r[0], role:r[1], fte:r[2], rate:r[3], planned:r[4], actual:r[5], variance:r[6], tone:r[7] })}><td><div className="row gap-sm"><Avatar>{r[0]}</Avatar><b>{r[0]}</b></div></td><td>{r[1]}</td><td className="num">{r[2]}</td><td className="num">{r[3]}</td><td className="num">{r[4]}h</td><td className="num"><b>{r[5]}h</b></td><td className="num" style={{ color:`var(--${r[7]})` }}>{r[6]}</td><td><Badge tone={r[7]} dot>{r[7]==='green'?'on track':'watch'}</Badge></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <div className="card-header"><h3>Weekly burn · last 8 weeks</h3><XlsxPill state="synced">Timesheet.xlsx</XlsxPill></div>
        <div className="card-body">
          <div className="chart" style={{ height: 140 }}>
            <svg viewBox="0 0 800 140" preserveAspectRatio="none">
              {[0,35,70,105,140].map(y=><line key={y} x1="0" x2="800" y1={y} y2={y} stroke="#eeece5"/>)}
              <line x1="0" x2="800" y1="50" y2="50" stroke="#c4a962" strokeDasharray="3 3"/>
              <text x="790" y="46" fontSize="10" fill="#b8741e" textAnchor="end">plan 160h/wk</text>
              {[[40,70],[140,55],[240,48],[340,52],[440,60],[540,45],[640,40],[740,38]].map(([x,y],i)=>(
                <rect key={i} x={x-22} y={y} width="44" height={140-y} fill="#1e3a34" opacity=".85" rx="2"/>
              ))}
              {['w10','w11','w12','w13','w14','w15','w16','w17'].map((w,i)=>(<text key={w} x={40+i*100} y="135" fontSize="10" fill="#8b8984" textAnchor="middle">{w}</text>))}
            </svg>
          </div>
          <div className="grid g3" style={{ marginTop:10 }}>
            <div><div className="txt-sm txt-muted">Planned to date</div><b>1,280h</b></div>
            <div><div className="txt-sm txt-muted">Actual to date</div><b>1,241h</b> <span style={{ color:'var(--green)' }}>−3%</span></div>
            <div><div className="txt-sm txt-muted">Burn rate</div><b>103h/wk</b> <span className="txt-muted">avg</span></div>
          </div>
        </div>
      </div>
    </div>
    <div className="stack">
      <div className="card kpi">
        <div className="label">Team margin · live</div>
        <div className="value">31%</div>
        <div className="sub" style={{ color:'var(--green)' }}>target &gt;30% · on track</div>
      </div>
      <Callout tone="warn" title="JB over-utilised">+7% on this project · plus 92% YTD utilisation across all projects. Consider rebalancing to PNC001.</Callout>
      <div className="card">
        <div className="card-header"><h3>Pending timesheets</h3></div>
        <div className="list">
          {[['CC wk17','draft','amber'],['JB wk17','draft','amber'],['AP wk16','submitted','blue'],['SR wk17','—','red']].map((r,i)=>(<div key={i} className="list-item"><div className="main">{r[0]}</div><Badge tone={r[2]} dot>{r[1]}</Badge></div>))}
        </div>
      </div>
    </div>
  </div>
  );
};

const ProjectInvoicesTab = () => {
  const [openInv, setOpenInv] = React.useState(null);
  const outRows = [['INV-009','M1 · Kickoff','20 Jan','19 Feb','$60,000','paid','green','12 Feb'],['INV-010','M2 · Hypothesis','14 Feb','16 Mar','$80,000','paid','green','09 Mar'],['INV-011','M3 · Diligence','07 Mar','06 Apr','$120,000','outstanding','amber','—'],['INV-012','M4 · Synthesis','draft','—','$120,000','draft','','—'],['INV-013','M5 · Final','—','—','$220,000','scheduled','blue','—']];
  const inRows = [['Hawksparks','HS-2041','Experts','18 Apr','$2,400','pending TT','—','amber'],['AP (contractor)','INV-0043','Partner per-diem','12 Apr','$15,000','approved','—','blue'],['ExpertNet','EN-0991','Experts · DB','02 Apr','$4,200','approved','paid','green']];
  return (
  <div className="stack">
    {openInv && window.InvoiceDrawer && <window.InvoiceDrawer inv={openInv} onClose={()=>setOpenInv(null)}/>}
    <div className="grid g4">
      <KPI label="Contract value" value="$600,000"/>
      <KPI label="Invoiced to date" value="$380,000" sub="63% of contract"/>
      <KPI label="Paid" value="$260,000" sub="$120k outstanding" subTone="amber"/>
      <KPI label="Oldest AR" value="34d" sub="Invoice #11 · within terms" subTone="green"/>
    </div>
    <div className="card">
      <div className="card-header"><h3>Invoices out · IFM001</h3><div className="row gap-sm"><Btn sm icon="doc">Generate next</Btn><Btn sm icon="download">All PDFs</Btn></div></div>
      <table className="tbl">
        <thead><tr><th>#</th><th>Milestone</th><th>Sent</th><th>Due</th><th className="num">Amount</th><th>Status</th><th>Paid</th><th>Actions</th></tr></thead>
        <tbody>
          {outRows.map((r,i)=>(
            <tr key={i} style={{ cursor:'pointer' }} onClick={()=>setOpenInv({ direction:'out', ref:r[0], milestone:r[1], issued:r[2], due:r[3], amount:r[4], status:r[5], tone:r[6], code:'IFM001', party:'IFM Pty Ltd' })}><td className="code-cell">{r[0]}</td><td>{r[1]}</td><td className="txt-sm">{r[2]}</td><td className="txt-sm">{r[3]}</td><td className="num"><b>{r[4]}</b></td><td><Badge tone={r[6]} dot>{r[5]}</Badge></td><td className="txt-sm">{r[7]}</td><td><Btn sm ghost>View</Btn></td></tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="card">
      <div className="card-header"><h3>Invoices in · supplier / consultant</h3></div>
      <table className="tbl">
        <thead><tr><th>Supplier</th><th>Ref</th><th>Category</th><th>Received</th><th className="num">Amount</th><th>Approved</th><th>Paid</th></tr></thead>
        <tbody>
          {inRows.map((r,i)=>(
            <tr key={i} style={{ cursor:'pointer' }} onClick={()=>setOpenInv({ direction:'in', supplier:r[0], ref:r[1], category:r[2], issued:r[3], amount:r[4], status:r[5].includes('pending')?'pending':r[5], tone:r[7], code:'IFM001', party:r[0] })}><td><b>{r[0]}</b></td><td className="code-cell">{r[1]}</td><td><Badge>{r[2]}</Badge></td><td className="txt-sm">{r[3]}</td><td className="num">{r[4]}</td><td><Badge tone={r[7]} dot>{r[5]}</Badge></td><td className="txt-sm">{r[6]}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
  );
};

const ProjectExpensesTab = () => {
  const [openExp, setOpenExp] = React.useState(null);
  const rows = [['14 Apr','Qantas SYD→MEL','Travel','$420','📎','CC','approved','green'],['12 Apr','Uber · client site','Travel','$52','📎','CC','approved','green'],['10 Apr','Bistro Guillaume','Meals','$186','📎','MB','pending','amber'],['05 Apr','Holiday Inn · 2 nights','Travel','$680','📎','MB','approved','green'],['28 Mar','Taxi · airport','Travel','$84','📎','TT','approved','green'],['24 Mar','Client lunch','Meals','$142','📎','MB','approved','green'],['18 Mar','Adobe Acrobat','Subs','$22','📎','CC','approved','green']];
  return (
  <div className="grid g-main-side">
    {openExp && window.ExpenseDrawer && <window.ExpenseDrawer exp={openExp} onClose={()=>setOpenExp(null)}/>}
    <div className="card">
      <div className="card-header"><h3>IFM001 · expenses</h3><div className="row gap-sm"><Btn sm icon="filter">Filter</Btn><Btn sm icon="plus">Log</Btn></div></div>
      <table className="tbl">
        <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th className="num">Amount</th><th>Receipt</th><th>By</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((r,i)=>(
            <tr key={i} style={{ cursor:'pointer' }} onClick={()=>setOpenExp({ date:r[0], merchant:r[1], category:r[2], amount:r[3], by:r[5], status:r[6], tone:r[7], code:'IFM001' })}><td>{r[0]}</td><td>{r[1]}</td><td><Badge>{r[2]}</Badge></td><td className="num"><b>{r[3]}</b></td><td>{r[4]}</td><td><Avatar size={22}>{r[5]}</Avatar></td><td><Badge tone={r[7]} dot>{r[6]}</Badge></td></tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="stack">
      <div className="card">
        <div className="card-header"><h3>By category</h3></div>
        <div className="card-body">
          <BarRow label="Travel" pct={68} val="$4,220"/>
          <BarRow label="Meals" pct={28} val="$1,180" tone="blue"/>
          <BarRow label="Subs" pct={8} val="$420" tone="green"/>
          <BarRow label="Other" pct={4} val="$200" tone="accent"/>
        </div>
      </div>
      <div className="card kpi">
        <div className="label">Expense line · vs plan</div>
        <div className="value">$6,200</div>
        <div className="sub" style={{ color:'var(--amber)' }}>plan $4,800 · +29%</div>
      </div>
      <Callout tone="warn">Travel line +30% — MB approval requested. Flagged to governance.</Callout>
    </div>
  </div>
  );
};

const ProjectContractsTab = () => {
  const [scope, setScope] = React.useState(false);
  const [deliv, setDeliv] = React.useState(false);
  const [openDoc, setOpenDoc] = React.useState(null);
  const [openMs, setOpenMs] = React.useState(null);
  const docs = [['MSA — IFM × Foundry','signed','06 Jan 2026','TT + IFM Legal'],['SOW v1 · IFM001','signed','06 Jan 2026','$600k · 12wk'],['Change Order v1','signed','28 Feb 2026','+ 2wk timeline'],['Change Order v2 · draft','pending','—','+ $45k scope'],['NDA — mutual','signed','18 Dec 2025','standard'],['Data Processing Agreement','signed','06 Jan 2026','EU data']];
  const ms = [['M1','Kickoff + workplan','Wk 2','$60k','paid','green'],['M2','Hypothesis complete','Wk 4','$80k','paid','green'],['M3','Diligence midpoint','Wk 7','$120k','invoiced','amber'],['M4','Synthesis ready','Wk 10','$120k','upcoming','blue'],['M5','Final readout','Wk 12','$220k','upcoming','blue']];
  return (
  <div className="grid g-main-side">
    {scope && <window.EditScopeModal onClose={()=>setScope(false)}/>}
    {deliv && <window.AddDeliverableModal onClose={()=>setDeliv(false)}/>}
    {openDoc && window.ContractDocDrawer && <window.ContractDocDrawer doc={openDoc} onClose={()=>setOpenDoc(null)}/>}
    {openMs && window.MilestoneDrawer && <window.MilestoneDrawer ms={openMs} onClose={()=>setOpenMs(null)}/>}
    <div className="stack">
      <div className="card">
        <div className="card-header"><h3>Contract documents</h3><Btn sm icon="upload">Upload</Btn></div>
        <div className="list">
          {docs.map((r,i)=>(
            <div key={i} className="list-item" style={{ cursor:'pointer' }} onClick={()=>setOpenDoc({ name:r[0], status:r[1], date:r[2], note:r[3] })}><div className="main"><Icon name="doc"/><div><div style={{ fontWeight:500 }}>{r[0]}</div><div className="txt-sm txt-muted">{r[2]} · {r[3]}</div></div></div><Badge tone={r[1]==='signed'?'green':'amber'} dot>{r[1]}</Badge></div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="card-header"><h3>Milestones & billing schedule</h3></div>
        <table className="tbl">
          <thead><tr><th>#</th><th>Milestone</th><th>Target</th><th className="num">Amount</th><th>Status</th></tr></thead>
          <tbody>
            {ms.map((r,i)=>(
              <tr key={i} style={{ cursor:'pointer' }} onClick={()=>setOpenMs({ id:r[0], name:r[1], target:r[2], amount:r[3], status:r[4], tone:r[5] })}><td className="code-cell">{r[0]}</td><td>{r[1]}</td><td className="txt-sm">{r[2]}</td><td className="num"><b>{r[3]}</b></td><td><Badge tone={r[5]} dot>{r[4]}</Badge></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    <div className="stack">
      <div className="card">
        <div className="card-header"><h3>Key terms</h3></div>
        <div className="list">
          {[['Contract value','$600,000'],['Currency','AUD'],['Term','12 weeks'],['Payment','Net 30'],['Late fee','1.5% / mo'],['IP assignment','Client'],['Exclusivity','None'],['Governing law','NSW, AU']].map((r,i)=>(<div key={i} className="list-item"><div className="main txt-muted">{r[0]}</div><b>{r[1]}</b></div>))}
        </div>
      </div>
      <Btn primary icon="doc" onClick={()=>setScope(true)}>Generate change order</Btn>
      <Btn icon="plus" onClick={()=>setDeliv(true)}>Add milestone</Btn>
    </div>
  </div>
  );
};

const ProjectReferralsTab = () => (
  <div className="grid g-main-side">
    <div className="stack">
      <div className="card">
        <div className="card-header"><h3>Referral ledger · IFM001</h3><Btn sm icon="plus">Add</Btn></div>
        <table className="tbl">
          <thead><tr><th>Referrer</th><th>Type</th><th className="num">%</th><th className="num">Fee</th><th>Cap applied</th><th>Status</th></tr></thead>
          <tbody>
            <tr><td><div className="row gap-sm"><Avatar>AP</Avatar><b>AP</b></div></td><td>Internal referral</td><td className="num">3%</td><td className="num"><b>$18,000</b></td><td className="txt-sm">n/a · under cap</td><td><Badge tone="green" dot>paid · 20 Feb</Badge></td></tr>
          </tbody>
        </table>
      </div>
      <div className="card">
        <div className="card-header"><h3>Referral policy · applied</h3><Badge tone="accent">FY26 Governance</Badge></div>
        <div className="card-body">
          <div className="grid g3" style={{ gap:10 }}>
            {[['External warm intro','5%','cap $50k'],['External co-sell','10%','cap $50k'],['Internal','2–5%','bonus'],['Partner','0%','profit pool'],['Multi-year','first 12mo only',''],['Recurring','if clearly tied','']].map((r,i)=>(
              <div key={i} style={{ padding:10, border:'1px solid var(--border)', borderRadius:8, background:'var(--bg-subtle)' }}>
                <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', fontWeight:600 }}>{r[0]}</div>
                <div style={{ fontFamily:'var(--font-serif)', fontSize:20 }}>{r[1]}</div>
                <div className="txt-sm txt-muted">{r[2]}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    <div className="stack">
      <div className="card kpi">
        <div className="label">Total paid · IFM001</div>
        <div className="value">$18,000</div>
        <div className="sub">3% of $600k · well under $50k cap</div>
      </div>
      <Callout tone="info" title="How this flows">Referral fee is deducted pre-net-revenue per governance model. Recorded to <b>Referrals.xlsx</b> and auto-posted in P&L.</Callout>
    </div>
  </div>
);

const ProjectActivityTab = () => (
  <div className="grid g-main-side">
    <div className="card">
      <div className="card-header"><h3>All activity · IFM001</h3><div className="row gap-sm"><Btn sm icon="filter">Filter</Btn><Badge>42 events</Badge></div></div>
      <div className="list">
        {[
          ['MB','logged 18h · wk17','—','2h ago'],
          ['system','auto-sync → Finance.xlsx','all P&L lines updated','3h ago'],
          ['CC','added expense','$340 · Uber · travel','yesterday'],
          ['TT','approved invoice #11','$120,000 · IFM001','yesterday'],
          ['MB','created change order v2','+$45k · scope extension','2d ago'],
          ['system','OCR matched invoice','Hawksparks-Apr2026.pdf → experts line','2d ago'],
          ['JS','reconciled expenses','6 receipts · $1,240','3d ago'],
          ['SR','joined project','assoc partner · 0.5 FTE','4d ago'],
          ['system','invoice scheduled','INV-012 · $120k · 14 May','5d ago'],
          ['MB','updated milestone','M3 complete','6d ago'],
          ['system','Finance.xlsx diff detected','1 row · auto-merged','7d ago'],
        ].map((r,i)=>(
          <div key={i} className="list-item"><div className="main"><Avatar size={22}>{r[0]==='system'?'•':r[0]}</Avatar><div><div style={{ fontWeight:500 }}><b>{r[0]}</b> {r[1]}</div>{r[2]!=='—'&&<div className="txt-sm txt-muted">{r[2]}</div>}</div></div><div className="right">{r[3]}</div></div>
        ))}
      </div>
    </div>
    <div className="stack">
      <div className="card">
        <div className="card-header"><h3>Audit summary</h3></div>
        <div className="list">
          {[['Total events','142'],['By MB','38'],['By CC','24'],['By JB','18'],['System events','46'],['Last activity','2h ago']].map((r,i)=>(<div key={i} className="list-item"><div className="main txt-muted">{r[0]}</div><b>{r[1]}</b></div>))}
        </div>
      </div>
      <Btn icon="download">Export audit log</Btn>
    </div>
  </div>
);

// ===== Admin tab panels =====

const AdminUsersTab = () => (
  <div className="grid g-main-side">
    <div className="card">
      <div className="card-header"><h3>Users & roles</h3><div className="row gap-sm"><Btn sm icon="filter">Filter</Btn><Btn sm icon="plus">Invite</Btn></div></div>
      <table className="tbl">
        <thead><tr><th>Member</th><th>Type</th><th>Role</th><th>Projects</th><th>Login portal</th><th>Last active</th><th>Status</th></tr></thead>
        <tbody>
          {[
            ['TT','FT Partner','Mgn Partner · full admin','all','web + mobile','now','green'],
            ['MB','FT Partner','Partner','IFM001, PNC001','web + mobile','12m','green'],
            ['SR','PT Partner','Assoc partner','GNC001','web','1h','green'],
            ['CC','FT','Consultant','IFM001, PNC001','web + mobile','now','green'],
            ['JB','FT','Analyst · contributor','IFM001, GNC001','web','4h','green'],
            ['JS','FT','Office mgr · finance admin','all (Excel)','web','now','green'],
            ['AP','External','Contractor · portal only','PNC001','portal','2d','amber'],
            ['ExpertNet','External','Supplier portal','—','portal','14d','amber'],
          ].map((r,i)=>(
            <tr key={i}><td><div className="row gap-sm"><Avatar>{r[0]}</Avatar><b>{r[0]}</b></div></td><td>{r[1]}</td><td>{r[2]}</td><td className="txt-sm">{r[3]}</td><td className="txt-sm txt-muted">{r[4]}</td><td className="txt-sm">{r[5]}</td><td><Badge tone={r[6]} dot>{r[6]==='green'?'active':'idle'}</Badge></td></tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="stack">
      <div className="card">
        <div className="card-header"><h3>Role templates</h3></div>
        <div className="list">
          {[['Managing partner','full · all Excel · 2-partner override'],['Partner','projects led + firm reports'],['Assoc partner','own projects + BD'],['Consultant','assigned projects · own t-sheet'],['Analyst','assigned projects (read P&L)'],['Office mgr','finance admin · all Excel · no partner data'],['Contractor portal','own invoices + timesheets only'],['Supplier portal','submit invoices only']].map((r,i)=>(
            <div key={i} className="list-item"><div className="main"><div><div style={{ fontWeight:500 }}>{r[0]}</div><div className="txt-sm txt-muted">{r[1]}</div></div></div></div>
          ))}
        </div>
      </div>
      <Callout tone="info" title="SSO">Microsoft 365 sign-in for FT staff. Magic-link for contractor / supplier portals.</Callout>
    </div>
  </div>
);

const AdminControlsTab = () => (
  <div className="grid g2">
    <div className="card">
      <div className="card-header"><h3>Auto-allocation rules</h3><Badge tone="accent">FY26 Governance</Badge></div>
      <div className="list">
        {[['Project OPEX contribution','20%'],['Firm profit pool','15%'],['Project expense target','< 50%'],['Net revenue target','> 30%'],['EBITDA target','15–20%'],['Partner per-diem','$2,000'],['Consultant rate','$800/d'],['Analyst rate','$400/d']].map((r,i)=>(<div key={i} className="list-item"><div className="main">{r[0]}</div><b>{r[1]}</b></div>))}
      </div>
    </div>
    <div className="card">
      <div className="card-header"><h3>Approval thresholds</h3></div>
      <table className="tbl">
        <thead><tr><th>Trigger</th><th>Approver</th><th>SLA</th></tr></thead>
        <tbody>
          {[['Expense > $500','PM','1d'],['Expense / invoice > $2,000','Partner','2d'],['Invoice out > $20k','Mgn Partner','2d'],['Meals > $150/head','Partner','1d'],['Line > 20% over budget','Lead partner','1d'],['BD referral > 5%','Partnership','3d'],['Change order','Lead + Mgn','2d'],['New project','Partnership','3d']].map((r,i)=>(
            <tr key={i}><td>{r[0]}</td><td><Badge>{r[1]}</Badge></td><td className="num">{r[2]}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="card">
      <div className="card-header"><h3>Exemption criteria</h3><Badge>governance §5</Badge></div>
      <div className="card-body">
        <div className="txt-sm txt-muted" style={{ marginBottom:10 }}>Aspects of the financial governance model may be exempted on agreement from the partnership for projects that meet <b>all</b> of:</div>
        {[['< $25,000 AUD total','check'],['≤ 1 partner involved','check'],['No FH OPEX resources','check'],['Rep / BD value only','check']].map((r,i)=>(<div key={i} className="row gap-sm" style={{ padding:'6px 0' }}><Icon name={r[1]} size={14}/>{r[0]}</div>))}
      </div>
    </div>
    <div className="card">
      <div className="card-header"><h3>Audit & change log</h3><Btn sm ghost icon="download">Export</Btn></div>
      <div className="list">
        {[['TT updated partner per-diem','$1,800 → $2,000','18 Dec 2025'],['Partnership added exemption rule','<$25k bypass','15 Dec 2025'],['TT set profit pool','15%','12 Dec 2025'],['TT set OPEX','20%','12 Dec 2025']].map((r,i)=>(<div key={i} className="list-item"><div className="main"><div><div style={{ fontWeight:500 }}>{r[0]}</div><div className="txt-sm txt-muted">{r[1]}</div></div></div><div className="right">{r[2]}</div></div>))}
      </div>
    </div>
  </div>
);

const AdminProjectTypesTab = () => (
  <div className="grid g2">
    <div className="card">
      <div className="card-header"><h3>Project types</h3><Btn sm icon="plus">Add</Btn></div>
      <table className="tbl">
        <thead><tr><th>Code prefix</th><th>Type</th><th>Default margin</th><th>Template</th><th>Active</th></tr></thead>
        <tbody>
          {[['IFM / GNC / PNC','Strategy','32%','Strategy SOW',8],['BMX / KLX','Diligence','28%','Diligence SOW',5],['ADX','Advisory retainer','38%','Retainer v2',2],['NXS','Market entry','30%','Strategy SOW',1],['—','Research','25%','Research SOW',0]].map((r,i)=>(
            <tr key={i}><td className="code-cell">{r[0]}</td><td><b>{r[1]}</b></td><td className="num">{r[2]}</td><td className="txt-sm">{r[3]}</td><td><Badge>{r[4]} active</Badge></td></tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="card">
      <div className="card-header"><h3>Client types</h3></div>
      <div className="card-body">
        <BarRow label="Pharma" pct={68} val="5 clients"/>
        <BarRow label="MedTech" pct={25} val="2 clients" tone="blue"/>
        <BarRow label="Biotech" pct={18} val="2 clients" tone="green"/>
        <BarRow label="Payer" pct={8} val="1 client" tone="accent"/>
        <div className="hdiv"/>
        <div className="txt-sm txt-muted" style={{ marginBottom:8, fontWeight:600 }}>Activity categories</div>
        {['Delivery','BD / proposal','Firm building','OPEX','Training','Leave'].map((t,i)=>(<Badge key={i}>{t}</Badge>))}
      </div>
    </div>
  </div>
);

const AdminRatesTab = () => (
  <div className="grid g2">
    <div className="card">
      <div className="card-header"><h3>Standard rates</h3><Badge tone="accent">FY26</Badge></div>
      <table className="tbl">
        <thead><tr><th>Role</th><th className="num">Daily</th><th className="num">Hourly</th><th>Applied to</th></tr></thead>
        <tbody>
          {[['Partner (FT)','$2,000','$250','leadership team, per-diem'],['Expert partner (1.5×)','$3,000','$375','weighted for expertise'],['Assoc partner','$2,000','$250','partner pool'],['Consultant','$800','$100','full-time delivery'],['Analyst','$400','$50','coverage'],['External expert','—','$250–$450','US often higher'],['Contractor','neg.','neg.','case-by-case']].map((r,i)=>(
            <tr key={i}><td><b>{r[0]}</b></td><td className="num">{r[1]}</td><td className="num">{r[2]}</td><td className="txt-sm txt-muted">{r[3]}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="card">
      <div className="card-header"><h3>Project-specific overrides</h3></div>
      <table className="tbl">
        <thead><tr><th>Project</th><th>Role</th><th className="num">Rate</th><th>Reason</th></tr></thead>
        <tbody>
          {[['PNC001','External expert (US)','$450/h','US market premium'],['ADX001','Partner (SR)','$1,800/d','retainer discount'],['BMX001','Consultant (CC)','$900/d','specialist premium']].map((r,i)=>(
            <tr key={i}><td className="code-cell">{r[0]}</td><td>{r[1]}</td><td className="num"><b>{r[2]}</b></td><td className="txt-sm txt-muted">{r[3]}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const AdminBoltOnsTab = () => (
  <div className="grid g3">
    {[
      ['📬 Email-to-invoice','enabled','Forward PDF to invoices@foundry.health','green'],
      ['📄 Word template gen','enabled','Invoice, contract, change order, close-out','green'],
      ['✍️ e-Signature','enabled','DocuSign · routed on contract gen','green'],
      ['🔗 Xero sync','configuring','AR / AP · GL codes mapped','amber'],
      ['🔗 MYOB','available','Alt. to Xero','' ],
      ['🔗 QuickBooks','available','For US clients','' ],
      ['💬 Slack notify','enabled','Approvals, flags, #ops channel','green'],
      ['💬 MS Teams','available','Or pick one','' ],
      ['📊 Power BI export','enabled','Nightly to datalake','green'],
      ['🔒 DocuSign audit vault','enabled','Contract archive','green'],
      ['🧾 Stripe invoicing','available','For USD clients','' ],
      ['🤖 Auto-categoriser','enabled','ML on expense receipts · 94%','green'],
    ].map((r,i)=>(
      <div key={i} className="card">
        <div className="card-body">
          <div className="row-spread"><h3 style={{ margin:0, fontSize:14 }}>{r[0]}</h3><Badge tone={r[3]} dot>{r[1]}</Badge></div>
          <div className="txt-sm txt-muted" style={{ marginTop:6 }}>{r[2]}</div>
          <div className="row gap-sm" style={{ marginTop:10 }}><Btn sm ghost>Configure</Btn>{r[1]==='available' && <Btn sm primary>Enable</Btn>}</div>
        </div>
      </div>
    ))}
  </div>
);

const AdminAuditTab = () => (
  <div className="card">
    <div className="card-header"><h3>Audit log · last 30 days</h3><div className="row gap-sm"><Btn sm icon="filter">Filter</Btn><Btn sm icon="download">Export CSV</Btn></div></div>
    <table className="tbl">
      <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Before</th><th>After</th><th>Source</th></tr></thead>
      <tbody>
        {[
          ['2m ago','system','sync','Finance.xlsx','—','row 47 updated','Excel'],
          ['18m ago','TT','approve','INV-011','pending','approved','web'],
          ['1h ago','MB','create','CO-v2 · IFM001','—','draft','web'],
          ['3h ago','CC','edit','timesheet wk17','7h Wed','8h Wed','web'],
          ['yesterday','JS','reconcile','Expenses.xlsx','6 rows','all categorised','Excel'],
          ['yesterday','system','conflict','INV-011 amount','$48,000','$48,400 (Excel)','auto'],
          ['2d ago','TT','update','rule · OPEX','22%','20%','web'],
          ['3d ago','AP','submit','INV-0043','—','$15,000','portal'],
          ['4d ago','system','OCR','Hawksparks-Apr.pdf','—','matched IFM001','auto'],
          ['5d ago','MB','delete','draft INV-013','scheduled','removed','web'],
        ].map((r,i)=>(
          <tr key={i}><td className="txt-sm">{r[0]}</td><td><Avatar size={22}>{r[1]==='system'?'•':r[1]}</Avatar></td><td><Badge>{r[2]}</Badge></td><td className="code-cell">{r[3]}</td><td className="txt-sm txt-muted mono">{r[4]}</td><td className="txt-sm mono">{r[5]}</td><td className="txt-sm txt-muted">{r[6]}</td></tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ===== Directory tab panels =====

const DirConsultantsTab = ({ onOpen }) => (
  <div className="card">
    <div className="card-header"><h3>Consultants & analysts</h3><div className="txt-sm txt-muted">3 FT · 1 contractor · 0 PT · click a row to open profile</div></div>
    <table className="tbl">
      <thead><tr><th>Member</th><th>Role</th><th>Type</th><th className="num">Rate</th><th className="num">Utilisation</th><th>Projects</th><th className="num">YTD earnings</th><th>Status</th></tr></thead>
      <tbody>
        {[['CC','Consultant','FT','$800/d','84%','IFM001, PNC001','$74k','green'],['JB','Analyst','FT','$400/d','92%','IFM001, GNC001','$38k','amber'],['AP','Expert consult.','Contractor','$2,000/d','33%','PNC001','$62k','blue'],['RG','Analyst (grad)','FT · new','$400/d','—','—','—','']].map((r,i)=>(
          <tr key={i} onClick={()=>onOpen && onOpen(r[0])} style={{ cursor:'pointer' }}><td><div className="row gap-sm"><Avatar>{r[0]}</Avatar><b>{r[0]}</b></div></td><td>{r[1]}</td><td>{r[2]}</td><td className="num">{r[3]}</td><td className="num">{r[4]}</td><td className="txt-sm">{r[5]}</td><td className="num"><b>{r[6]}</b></td><td><Badge tone={r[7]} dot>{r[7]==='green'?'healthy':r[7]==='amber'?'over':r[7]==='blue'?'light':'onboarding'}</Badge></td></tr>
        ))}
      </tbody>
    </table>
  </div>
);

const DirContractorsTab = ({ onOpen }) => (
  <div className="card">
    <div className="card-header"><h3>Contractors & external experts</h3></div>
    <table className="tbl">
      <thead><tr><th>Name</th><th>Firm</th><th>Domain</th><th className="num">Rate</th><th>Active projects</th><th className="num">YTD</th><th>Portal</th></tr></thead>
      <tbody>
        {[['AP','Solo','Market strategy','$2,000/d','PNC001','$62k','active'],['Hawksparks','Hawksparks Pty','US pharma experts','$250–450/h','IFM001','$24k','active'],['ExpertNet','ExpertNet','Expert calls','$4,200 avg','PNC001','$12k','active'],['Karen L.','Solo','Regulatory','$1,800/d','—','—','dormant']].map((r,i)=>(
          <tr key={i} onClick={()=>onOpen && onOpen(r[0])} style={{ cursor:'pointer' }}><td><div className="row gap-sm"><Avatar tone="var(--text-3)">{r[0].slice(0,2).toUpperCase()}</Avatar><b>{r[0]}</b></div></td><td>{r[1]}</td><td><Badge>{r[2]}</Badge></td><td className="num">{r[3]}</td><td className="txt-sm">{r[4]}</td><td className="num">{r[5]}</td><td><Badge tone={r[6]==='active'?'green':''} dot>{r[6]}</Badge></td></tr>
        ))}
      </tbody>
    </table>
  </div>
);

const DirClientsTab = () => {
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [openClient, setOpenClient] = React.useState(null);
  const Wiz = window.AddClientWizard;
  const rows = [['IFM','Pharma','IFM001, IFM002','$880k','$120k','MB','now'],['Genica','Pharma','GNC001, GNC002','$720k','—','SR','1d'],['Panacea','Pharma','PNC001, PNC002','$1.46M','$220k','TT','2d'],['Biomax','MedTech','BMX001, BMX002','$770k','—','TT','4d'],['Adexa','Pharma','ADX001','$180k','$36k','SR','1wk'],['NexusBio','Biotech','—','—','—','MB','new lead']];
  return (
    <div className="card">
      <div className="card-header"><h3>All clients</h3><Btn sm icon="plus" primary onClick={()=>setWizardOpen(true)}>Add client</Btn></div>
      <table className="tbl">
        <thead><tr><th>Client</th><th>Type</th><th>Active projects</th><th className="num">LTV</th><th className="num">AR</th><th>Owner</th><th>Last engaged</th></tr></thead>
        <tbody>
          {rows.map((r,i)=>(
            <tr key={i} style={{ cursor:'pointer' }} onClick={()=>setOpenClient({ name:r[0], type:r[1], projects:r[2], ltv:r[3], ar:r[4], owner:r[5] })}><td><b>{r[0]}</b></td><td><Badge>{r[1]}</Badge></td><td className="txt-sm">{r[2]}</td><td className="num"><b>{r[3]}</b></td><td className="num" style={{ color: r[4]==='—'?'var(--text-4)':'var(--text)' }}>{r[4]}</td><td><Avatar size={22}>{r[5]}</Avatar></td><td className="txt-sm txt-muted">{r[6]}</td></tr>
          ))}
        </tbody>
      </table>
      {wizardOpen && Wiz && <Wiz onClose={()=>setWizardOpen(false)} onFinish={()=>setWizardOpen(false)}/>}
      {openClient && window.ClientDrawer && <window.ClientDrawer client={openClient} onClose={()=>setOpenClient(null)}/>}
    </div>
  );
};

const DirSuppliersTab = () => {
  const [wizard, setWizard] = React.useState(false);
  const [open, setOpen] = React.useState(null);
  const rows = [['WorkClub','OPEX · office','monthly','$33,600','—','active','green'],['Microsoft 365','OPEX · subs','annual','$4,800','—','active','green'],['LegalVision','OPEX · legal','retainer','$18,000','—','active','green'],['FinXL','OPEX · tax','project','$6,400','$1,650','active','green'],['Hawksparks','Project · experts','Net 30','$24,000','$2,400','active','green'],['ExpertNet','Project · experts','Net 14','$12,000','—','active','green'],['Clickup','OPEX · tooling','annual','$1,800','—','active','green']];
  return (
    <div className="card">
      <div className="card-header">
        <h3>Suppliers & OPEX vendors</h3>
        <Btn sm primary icon="plus" onClick={()=>setWizard(true)}>Add supplier</Btn>
      </div>
      <table className="tbl">
        <thead><tr><th>Supplier</th><th>Category</th><th>Terms</th><th className="num">YTD spend</th><th className="num">Outstanding</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((r,i)=>(
            <tr key={i} style={{ cursor:'pointer' }} onClick={()=>setOpen({ name:r[0], category:r[1], terms:r[2], ytd:r[3], outstanding:r[4] })}><td><b>{r[0]}</b></td><td><Badge>{r[1]}</Badge></td><td className="txt-sm">{r[2]}</td><td className="num"><b>{r[3]}</b></td><td className="num" style={{ color: r[4]==='—'?'var(--text-4)':'var(--amber)' }}>{r[4]}</td><td><Badge tone={r[6]} dot>{r[5]}</Badge></td></tr>
          ))}
        </tbody>
      </table>
      {wizard && <window.AddSupplierWizard onClose={()=>setWizard(false)}/>}
      {open && window.SupplierDrawer && <window.SupplierDrawer supplier={open} onClose={()=>setOpen(null)}/>}
    </div>
  );
};

Object.assign(window, { ProjectTeamTab, ProjectInvoicesTab, ProjectExpensesTab, ProjectContractsTab, ProjectReferralsTab, ProjectActivityTab, AdminUsersTab, AdminControlsTab, AdminProjectTypesTab, AdminRatesTab, AdminBoltOnsTab, AdminAuditTab, DirConsultantsTab, DirContractorsTab, DirClientsTab, DirSuppliersTab });
