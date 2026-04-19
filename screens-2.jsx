// screens-2.jsx - remaining screens

// ============ BD PIPELINE ============
const bdDeals = [
  ['PNC002','Panacea','Market Entry II','$680k','Pharma','Proposal','TT','40%'],
  ['GNC002','Genica','Extension','$300k','Pharma','Verbal','SR','75%'],
  ['NXS001','NexusBio','Diligence','$450k','Biotech','Qualified','MB','25%'],
  ['IFM002','IFM','Follow-on','$280k','Pharma','Lead','MB','10%'],
  ['BMX002','Biomax','Phase 2','$520k','MedTech','Lead','TT','10%'],
  ['PAY001','PayerCo','Advisory','$180k','Payer','Qualified','SR','25%'],
  ['KLX001','Klix','Diligence','$380k','Biotech','Proposal','CC','40%'],
];

const BDPipeline = () => {
  const [view, setView] = React.useState('kanban');
  const [deals, setDeals] = React.useState(bdDeals);
  const [dragId, setDragId] = React.useState(null);
  const [dropStage, setDropStage] = React.useState(null);
  const stages = ['Lead','Qualified','Proposal','Verbal','Won'];
  const stageColors = { Lead:'var(--text-4)', Qualified:'var(--blue)', Proposal:'var(--accent)', Verbal:'var(--amber)', Won:'var(--green)' };

  const moveDeal = (code, newStage) => {
    setDeals(ds => ds.map(d => d[0]===code ? [...d.slice(0,5), newStage, ...d.slice(6)] : d));
  };
  return (
    <>
      <div className="row" style={{ marginBottom:16, gap:12 }}>
        <div>
          <div className="txt-sm txt-muted">$2.79M unweighted · $886k weighted</div>
          <h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, margin:'2px 0 0' }}>BD pipeline</h2>
        </div>
        <Badge tone="amber" dot>coverage 2.4× · target 2–3×</Badge>
        <div className="ml-auto row gap-sm">
          <div className="role-switcher">
            {[['kanban','Kanban'],['funnel','Funnel'],['table','Table']].map(([k,l])=>(
              <button key={k} className={view===k?'active':''} onClick={()=>setView(k)}>{l}</button>
            ))}
          </div>
          <Btn sm icon="filter">Filter</Btn>
          <Btn sm primary icon="plus">New deal</Btn>
        </div>
      </div>
      {view==='kanban' && (
        <div className="kanban">
          {stages.map(st => {
            const items = deals.filter(d => d[5] === st);
            const total = items.reduce((s,d)=>s + parseInt(d[3].replace(/\D/g,'')),0);
            return (
              <div
                className={`kb-col${dropStage===st?' drop-target':''}`}
                key={st}
                onDragOver={e=>{ if(dragId){ e.preventDefault(); e.dataTransfer.dropEffect='move'; if(dropStage!==st) setDropStage(st); } }}
                onDragLeave={e=>{ if(!e.currentTarget.contains(e.relatedTarget)) setDropStage(null); }}
                onDrop={e=>{ e.preventDefault(); if(dragId) moveDeal(dragId, st); setDragId(null); setDropStage(null); }}
              >
                <div className="kb-col-header">
                  <div className="name"><span className="stage-dot" style={{ background: stageColors[st] }}/>{st}</div>
                  <div className="count">{items.length} · ${total}k</div>
                </div>
                {items.map((d,i)=>(
                  <div
                    className={`kb-card${dragId===d[0]?' dragging':''}`}
                    key={d[0]}
                    draggable
                    onDragStart={e=>{ setDragId(d[0]); e.dataTransfer.effectAllowed='move'; try{ e.dataTransfer.setData('text/plain', d[0]); }catch(_){} }}
                    onDragEnd={()=>{ setDragId(null); setDropStage(null); }}
                    style={{ cursor: dragId===d[0] ? 'grabbing' : 'grab' }}
                    onClick={()=>{ if(dragId) return; window.__openBDDeal && window.__openBDDeal({ code:d[0], client:d[1], name:d[2], value:d[3], type:d[4], stage:d[5], team:[d[6],'MB','CC'], suggestedCode:d[0], referral: d[6]==='AP'?'3% internal · AP':null }); }}
                  >
                    <div className="code-line">{d[0]} · {d[7]} confidence</div>
                    <div className="name">{d[1]} — {d[2]}</div>
                    <div className="val">{d[3]}</div>
                    <div className="foot"><Badge>{d[4]}</Badge><span>{d[6]}</span></div>
                    {(st==='Verbal' || st==='Won') && (
                      <div style={{ marginTop:8, paddingTop:8, borderTop:'1px solid var(--divider)' }} onClick={e=>e.stopPropagation()}>
                        <Btn sm primary onClick={()=>window.__openConvertBD && window.__openConvertBD({ code:d[0], client:d[1], name:d[2], value:d[3], type:d[4], stage:d[5], team:[d[6],'MB','CC'], suggestedCode:d[0], referral: d[6]==='AP'?'3% internal · AP':null })}>Convert → Project</Btn>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {view==='funnel' && (
        <div className="grid g-2-1">
          <div className="card">
            <div className="card-header"><h3>Weighted forecast funnel</h3><Badge tone="blue">FY26</Badge></div>
            <div className="card-body">
              {[['Lead',10,800,80],['Qualified',25,630,157],['Proposal',40,1060,424],['Verbal',75,300,225],['Won',100,250,250]].map((r,i)=>(
                <div className="funnel-row" key={i}>
                  <div className="stage"><span className="stage-dot" style={{ width:8,height:8,borderRadius:4,background:stageColors[r[0]],display:'inline-block' }}/>{r[0]} <span className="txt-muted">({r[1]}%)</span></div>
                  <div className="funnel-bar"><div className="fill" style={{ width: `${r[2]/12}%` }}/></div>
                  <div className="val">${r[2]}k → <b>${r[3]}k</b></div>
                </div>
              ))}
              <div className="hdiv"/>
              <div className="row-spread">
                <div><div className="txt-sm txt-muted">Unweighted</div><div style={{ fontFamily:'var(--font-serif)', fontSize:24 }}>$3.04M</div></div>
                <div style={{ textAlign:'right' }}><div className="txt-sm txt-muted">Weighted</div><div style={{ fontFamily:'var(--font-serif)', fontSize:32, color:'var(--brand)' }}>$1.06M</div></div>
              </div>
              <Callout tone="warn" title="Coverage gap"><span className="txt-sm">Target $2M × 2.5 = <b>$5M pipeline</b>. Current <b>$3.04M</b> — roughly $2M short.</span></Callout>
            </div>
          </div>
          <div className="stack">
            <div className="card">
              <div className="card-header"><h3>Weighted by client type</h3></div>
              <div className="card-body">
                <BarRow label="Pharma" pct={70} val="$740k"/>
                <BarRow label="Biotech" pct={25} val="$260k" tone="blue"/>
                <BarRow label="MedTech" pct={12} val="$120k" tone="green"/>
                <BarRow label="Payer" pct={6} val="$60k" tone="accent"/>
              </div>
            </div>
            <div className="card kpi">
              <div className="label">Win rate · trailing 12mo</div>
              <div className="value">22%</div>
              <div className="sub" style={{ color:'var(--amber)' }}>target 30% · benchmark 20–40%</div>
            </div>
          </div>
        </div>
      )}
      {view==='table' && (
        <div className="card">
          <table className="tbl">
            <thead><tr><th>Code</th><th>Client</th><th>Name</th><th>Stage</th><th className="num">Prob</th><th className="num">Value</th><th className="num">Weighted</th><th>Owner</th><th>Next step</th><th>Close</th></tr></thead>
            <tbody>
              {[
                ['PNC002','Panacea','Market entry II','Proposal','accent','40%','$680k','$272k','TT','SOW signoff','24 Apr'],
                ['GNC002','Genica','Extension','Verbal','amber','75%','$300k','$225k','SR','Contract redline','30 Apr'],
                ['NXS001','NexusBio','Diligence','Qualified','blue','25%','$450k','$112k','MB','Scoping call','15 May'],
                ['IFM002','IFM','Follow-on','Lead','','10%','$280k','$28k','MB','Pending brief','—'],
                ['BMX002','Biomax','Phase 2','Lead','','10%','$520k','$52k','TT','Intro 24 Apr','—'],
                ['PAY001','PayerCo','Advisory','Qualified','blue','25%','$180k','$45k','SR','Proposal draft','10 May'],
                ['KLX001','Klix','Diligence','Proposal','accent','40%','$380k','$152k','CC','Pricing revision','02 May'],
              ].map((r,i)=>(
                <tr key={i} style={{ cursor:'pointer' }} onClick={()=>window.__openBDDeal && window.__openBDDeal({ code:r[0], client:r[1], name:r[2], value:r[6], type:'—', stage:r[3], team:[r[8],'MB','CC'], suggestedCode:r[0] })}><td className="code-cell">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td><Badge tone={r[4]} dot>{r[3]}</Badge></td><td className="num">{r[5]}</td><td className="num">{r[6]}</td><td className="num"><b>{r[7]}</b></td><td><Avatar size={22}>{r[8]}</Avatar></td><td className="txt-sm">{r[9]}</td><td className="txt-sm">{r[10]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

// ============ APPROVALS ============
const Approvals = () => {
  const [invItem, setInvItem] = React.useState(null);
  const [tsItem, setTsItem] = React.useState(null);
  const [expItem, setExpItem] = React.useState(null);

  const items = [
    ['high','GNC001 · Invoice out #14 · $48,000','TT · >$20k threshold','2d overdue','red','inv'],
    ['med','IFM001 · Travel expense over +30%','MB (lead) · line >20% over budget','today','amber','exp'],
    ['med','SR-consultant-Mar.pdf · $48,000','TT · supplier invoice >$20k','today','amber','inv'],
    ['low','CC expense · Qantas $420','MB (PM) · >$500','1d','','exp'],
    ['low','JB timesheet wk16 · 52h','MB (PM) · >50h/wk soft cap','1d','','ts'],
    ['low','PNC001 · Change order v2 ($45k)','MB + TT · change order','3d','','inv'],
    ['low','BMX001 · BD referral 8% external','Partnership · new project BD >5%','2d','','inv'],
  ];

  const openItem = (r) => {
    const payload = { title:r[1], sub:r[2] };
    if (r[5]==='inv') setInvItem(payload);
    else if (r[5]==='ts') setTsItem({ ...payload, who:'JB' });
    else if (r[5]==='exp') setExpItem(payload);
  };

  return (
    <>
      <div className="row" style={{ marginBottom:16 }}>
        <div><div className="txt-sm txt-muted">12 items pending · 3 urgent</div><h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, margin:'2px 0 0' }}>Approvals queue</h2></div>
        <div className="ml-auto row gap-sm"><Btn sm ghost>Bulk approve</Btn><Btn sm icon="filter">Filter</Btn></div>
      </div>
      <div className="grid g3" style={{ marginBottom:20 }}>
        <div className="card">
          <div className="card-header"><h3>Thresholds · auto-flag</h3></div>
          <div className="list">
            {[['Expense > $500','PM'],['Expense / invoice > $2,000','Partner'],['Invoice out > $20k','Mgn Partner'],['Meals > $150/head','Partner'],['Line > 20% over budget','Lead Partner'],['New project BD ref > 5%','Partnership']].map((r,i)=>(
              <div key={i} className="list-item"><div className="main txt-sm">{r[0]}</div><Badge>{r[1]}</Badge></div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>By type · this week</h3></div>
          <div className="card-body">
            <BarRow label="Invoice out" pct={48} val="4"/>
            <BarRow label="Invoice in" pct={72} val="6" tone="blue"/>
            <BarRow label="Expenses" pct={28} val="2" tone="green"/>
            <BarRow label="Timesheets" pct={56} val="4" tone="accent"/>
            <BarRow label="Change orders" pct={14} val="1" tone="red"/>
          </div>
        </div>
        <div className="card kpi">
          <div className="label">Avg turn-around</div>
          <div className="value">1.4d</div>
          <div className="sub" style={{ color:'var(--green)' }}>target &lt; 2d · SLA met ✓</div>
          <div className="hdiv"/>
          <div className="txt-sm txt-muted">TT has 5 pending · SR 1. Consider rebalance.</div>
        </div>
      </div>
      <div className="card">
        <div className="card-header"><h3>Pending</h3><Badge tone="red">3 urgent</Badge></div>
        {items.map((r,i)=>(
          <div key={i} className="queue-item" onClick={()=>openItem(r)} style={{ cursor:'pointer' }}>
            <span className={`sev ${r[0]}`}/>
            <div className="main"><div className="title">{r[1]}</div><div className="sub">→ {r[2]}</div></div>
            <span className="txt-sm txt-muted nowrap">{r[3]}</span>
            <Badge tone={r[4]}>{r[0]==='high'?'urgent':r[0]==='med'?'watch':'standard'}</Badge>
            <div className="row gap-sm" onClick={e=>e.stopPropagation()}><Btn sm ghost>Reject</Btn><Btn sm primary onClick={()=>openItem(r)}>Approve</Btn></div>
          </div>
        ))}
      </div>

      {invItem && <window.ApproveInvoiceDrawer item={invItem} onClose={()=>setInvItem(null)}/>}
      {tsItem && <window.ApproveTimesheetDrawer item={tsItem} onClose={()=>setTsItem(null)}/>}
      {expItem && <window.ApproveExpenseDrawer item={expItem} onClose={()=>setExpItem(null)}/>}
    </>
  );
};

// ============ DIRECTORY ============
const Directory = ({ role } = {}) => {
  const hideFinancials = role === 'manager' || role === 'consultant';
  const [t,setT] = React.useState('partners');
  const [openPerson, setOpenPerson] = React.useState(null);
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [clientWizardOpen, setClientWizardOpen] = React.useState(false);
  const [openClient, setOpenClient] = React.useState(null);
  const [q, setQ] = React.useState('');
  if (openPerson) return <PersonProfile personId={openPerson} onBack={()=>setOpenPerson(null)}/>;

  const team = window.FOUNDRY_TEAM || [];
  const byBand = (bands) => team.filter(p => bands.includes(p.band));
  const partners   = byBand(['Partner','Leadership','Ops']);
  const consultants = byBand(['Expert','Consultant']);
  const analysts = byBand(['Analyst']);
  const activeList = t==='partners' ? partners : t==='consultants' ? consultants : t==='analysts' ? analysts : [];
  const filtered = q
    ? activeList.filter(p => `${p.first} ${p.last} ${p.initials} ${p.title} ${p.location}`.toLowerCase().includes(q.toLowerCase()))
    : activeList;

  // Focus-partner — pinned profile on the right
  const focusPartner = (window.FT_BY_INITIALS && window.FT_BY_INITIALS.MB) || partners[0];

  return (<>
    <div className="row" style={{ marginBottom:16 }}>
      <div>
        <h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:500, letterSpacing:'-0.02em', margin:0 }}>Directory</h2>
        <div className="txt-sm txt-muted">{team.length} people · {partners.length} partners & leadership · {consultants.length} consultants · {analysts.length} analysts</div>
      </div>
      <div className="ml-auto row gap-sm">
        <Btn sm icon="plus" onClick={()=>setClientWizardOpen(true)}>Client</Btn>
        <Btn sm primary icon="plus" onClick={()=>setWizardOpen(true)}>Add person</Btn>
      </div>
    </div>
    <div className="tabs">
      {[['partners',`Partners & leadership · ${partners.length}`],['consultants',`Consultants · ${consultants.length}`],['analysts',`Analysts · ${analysts.length}`],['contractors','Contractors'],['clients','Clients'],['suppliers','Suppliers'],['ratecard','Rate card']].map(([k,l])=>(
        <div key={k} className={`tab ${t===k?'active':''}`} onClick={()=>setT(k)}>{l}</div>
      ))}
    </div>
    {t==='contractors' && <DirContractorsTab onOpen={setOpenPerson}/>}
    {t==='clients' && <DirClientsTab/>}
    {t==='suppliers' && <DirSuppliersTab/>}
    {t==='ratecard' && <RateCardScreen/>}
    {(t==='partners' || t==='consultants' || t==='analysts') && <>
      <div className="grid g-main-side">
        <div className="stack">
          <div className="card">
            <div className="card-header">
              <div>
                <h3>{t==='partners' ? 'Partners, leadership & ops' : t==='consultants' ? 'Consultant team' : 'Analyst team'}</h3>
                <div className="txt-sm txt-muted">{filtered.length} of {activeList.length}{q ? ` · filtered on "${q}"` : ''} · click a row to open profile</div>
              </div>
              <div className="row gap-sm">
                <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name, location…"
                  style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, width:200, fontFamily:'inherit', background:'var(--bg)' }}/>
              </div>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Location</th>
                  <th className="num">FTE</th>
                  {!hideFinancials && <th className="num">Rate</th>}
                  {!hideFinancials && <th className="num">Util.</th>}
                  <th>Active projects</th>
                  {!hideFinancials && <th className="num">YTD earnings</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const m = window.synthMetrics ? window.synthMetrics(p) : { util:70, ytd:100000, projects:'—' };
                  const utilTone = m.util > 85 ? 'var(--amber)' : m.util >= 50 ? 'var(--green)' : 'var(--text-3)';
                  const rateLabel = p.rateUnit==='salary' ? 'salary'
                    : p.rateUnit==='/d' ? `$${p.rate.toLocaleString()}/d`
                    : `$${p.rate}${p.rateUnit}`;
                  return (
                    <tr key={p.id} onClick={()=>setOpenPerson(p.id)} style={{ cursor:'pointer' }}>
                      <td>
                        <div className="row gap-sm" style={{ minWidth:180 }}>
                          <Avatar size={32}>{p.initials}</Avatar>
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontWeight:600, fontSize:13, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.first} {p.last}</div>
                            <div className="txt-sm txt-muted" style={{ fontSize:11 }}>{p.degrees?.split(' ').slice(0,3).join(' ')}{p.degrees?.split(' ').length>3 ? '…' : ''}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize:13 }}>{p.title}</div>
                        <div className="txt-sm txt-muted" style={{ fontSize:11 }}>{p.employment}</div>
                      </td>
                      <td className="txt-sm">{p.location}</td>
                      <td className="num">{p.fte?.toFixed(1) ?? '—'}</td>
                      {!hideFinancials && <td className="num">{rateLabel}</td>}
                      {!hideFinancials && <td className="num"><span style={{ color:utilTone }}>{m.util}%</span></td>}
                      <td className="txt-sm" style={{ fontFamily:'var(--font-mono)', fontSize:11 }}>{m.projects}</td>
                      {!hideFinancials && <td className="num"><b>${(m.ytd/1000).toFixed(0)}k</b></td>}
                    </tr>
                  );
                })}
                {filtered.length===0 && (
                  <tr><td colSpan="8" style={{ textAlign:'center', padding:'30px 0', color:'var(--text-3)' }}>No one matches "{q}"</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {t==='partners' && (
          <div className="card">
            <div className="card-header"><h3>Clients</h3></div>
            <table className="tbl">
              <thead><tr><th>Client</th><th>Type</th><th>Projects</th><th className="num">LTV</th><th className="num">AR</th><th>Owner</th></tr></thead>
              <tbody>
                {[['IFM','Pharma','IFM001, IFM002','$880k','$120k','MB'],['Genica','Pharma','GNC001, GNC002','$720k','—','WM'],['Panacea','Pharma','PNC001, PNC002','$1.46M','$220k','TT'],['Biomax','MedTech','BMX001, BMX002','$770k','—','TT'],['Adexa','Pharma','ADX001','$180k','$36k','CP']].map((r,i)=>(
                  <tr key={i} style={{ cursor:'pointer' }} onClick={()=>setOpenClient({ name:r[0], type:r[1], projects:r[2], ltv:r[3], ar:r[4], owner:r[5] })}>
                    <td><b>{r[0]}</b></td>
                    <td><Badge>{r[1]}</Badge></td>
                    <td className="txt-sm">{r[2]}</td>
                    <td className="num">{r[3]}</td>
                    <td className="num" style={{ color: r[4]==='—'?'var(--text-4)':'var(--text)' }}>{r[4]}</td>
                    <td><Avatar size={22}>{r[5]}</Avatar></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>

        {focusPartner && (
          <div className="card">
            <div className="card-header">
              <h3>{focusPartner.initials} · profile</h3>
              <Btn sm ghost onClick={()=>setOpenPerson(focusPartner.id)}>Open full profile →</Btn>
            </div>
            <div className="card-body" style={{ textAlign:'center' }}>
              <div style={{ display:'inline-block' }}><Avatar size={96}>{focusPartner.initials}</Avatar></div>
              <div style={{ fontFamily:'var(--font-serif)', fontSize:20, fontWeight:500, marginTop:12, letterSpacing:'-0.01em' }}>{focusPartner.first} {focusPartner.last}</div>
              <div className="txt-sm txt-muted">{focusPartner.title} · {focusPartner.location}</div>
              <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:4 }}>{focusPartner.degrees}</div>
            </div>
            <div className="list">
              {(() => {
                const m = window.synthMetrics ? window.synthMetrics(focusPartner) : { util:71, ytd:186000 };
                const rows = [
                  ['Type', focusPartner.employment],
                  !hideFinancials && ['Per-diem / rate', focusPartner.rateUnit==='/d' ? `$${focusPartner.rate?.toLocaleString()}/d` : focusPartner.rateUnit==='salary' ? 'salary' : `$${focusPartner.rate}${focusPartner.rateUnit}`],
                  ['FTE', focusPartner.fte?.toFixed(1)],
                  !hideFinancials && ['YTD earnings', `$${(m.ytd/1000).toFixed(0)}k`],
                  !hideFinancials && ['Utilisation', `${m.util}%`],
                  ['Email', focusPartner.email],
                ].filter(Boolean);
                return rows.map((r,i)=>(
                  <div key={i} className="list-item"><div className="main txt-muted">{r[0]}</div><div className="right txt-strong" style={{ fontSize:12, wordBreak:'break-all' }}>{r[1]}</div></div>
                ));
              })()}
            </div>
            <div className="card-body">
              {!hideFinancials && <Callout tone="info">All earning streams feed the <b>Partner True-up Report</b> each quarter.</Callout>}
            </div>
          </div>
        )}
      </div>
    </>}
    {wizardOpen && <AddPersonWizard onClose={()=>setWizardOpen(false)} onFinish={(p)=>{ console.log('new person', p); }}/>}
    {clientWizardOpen && window.AddClientWizard && <window.AddClientWizard onClose={()=>setClientWizardOpen(false)} onFinish={(c)=>{ console.log('new client', c); }}/>}
    {openClient && window.ClientDrawer && <window.ClientDrawer client={openClient} onClose={()=>setOpenClient(null)}/>}
  </>);
};

// ============ REPORTS ============
const Reports = () => (
  <>
    <div className="row" style={{ marginBottom:16 }}>
      <div><h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, margin:0 }}>Reports & analytics</h2><div className="txt-sm txt-muted">All reports exportable as XLSX, PDF, or Word</div></div>
      <div className="ml-auto row gap-sm"><Btn sm icon="filter">Filter</Btn><Btn sm primary icon="plus">Build report</Btn></div>
    </div>
    <div className="grid g3">
      {[
        ['Firm P&L · FY26 YTD','Monthly revenue, costs, margin vs target','Finance, Partners','weekly','dashboard'],
        ['Project portfolio scorecard','Active projects · expense %, margin, utilisation','Partners','weekly','projects'],
        ['Utilisation & leverage','Per-person billable % · FT vs PT vs contractor','Partners, Office Mgr','weekly','resource'],
        ['BD pipeline forecast','Weighted pipeline by stage / client type','Partners','bi-weekly','bd'],
        ['Cash & AR aging','Invoices outstanding 0/30/60/90d','Finance','weekly','invoices'],
        ['OPEX vs budget','Line-by-line against 20% OPEX plan','Finance, Office Mgr','monthly','costplan'],
        ['Profit pool reconciliation','15% accrual · true-up allocation','Partnership','quarterly','trueup'],
        ['Partner true-up','Per-diem × utilisation + BD + project share','Partnership','quarterly','trueup'],
        ['Client concentration','Revenue by client · pharma / biotech / medtech','Partners','quarterly','directory'],
        ['Referral ledger','All referral fees · capped, internal/external','Finance','monthly','approvals'],
        ['Close-out packet','Per-project wrap: final P&L, learnings','PM','project close','projects'],
        ['Board pack','Summary of all above, branded','Partnership','monthly','dashboard'],
      ].map((r,i)=>(
        <div key={i} className="card">
          <div className="card-body">
            <div className="row-spread" style={{ marginBottom:8 }}><h3 style={{ fontSize:14, margin:0 }}>{r[0]}</h3><Badge>{r[3]}</Badge></div>
            <div className="txt-sm txt-muted">{r[1]}</div>
            <div className="txt-sm txt-muted" style={{ marginTop:10 }}>Audience: {r[2]}</div>
            <div className="row gap-sm" style={{ marginTop:12 }}><Btn sm onClick={()=>window.__nav && window.__nav(r[4])}>View</Btn><Btn sm ghost>XLSX</Btn><Btn sm ghost>PDF</Btn></div>
          </div>
        </div>
      ))}
    </div>
    <div className="card" style={{ marginTop:20 }}>
      <div className="card-header"><h3>Ad-hoc report builder</h3><Badge tone="accent" dot>beta</Badge></div>
      <div className="card-body">
        <div className="row" style={{ flexWrap:'wrap', fontSize:15, gap:8, lineHeight:2 }}>
          Show <Badge tone="solid">revenue</Badge> by <Badge>client type</Badge> for <Badge>last 12 months</Badge> grouped by <Badge>lead partner</Badge> where margin is <Badge tone="green">&gt; 30%</Badge>
          <div className="ml-auto"><Btn primary sm icon="arrow">Run</Btn></div>
        </div>
        <div className="hdiv"/>
        <div className="dropzone" style={{ padding: 28 }}>
          <Icon name="chart" size={24}/>
          <h4>Pivot preview renders here</h4>
          <p>Save as a scheduled report · email to partners on a cadence</p>
        </div>
      </div>
    </div>
  </>
);

// ============ TEMPLATES ============
const Templates = () => (
  <>
    <div className="row" style={{ marginBottom:16 }}>
      <div><h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, margin:0 }}>Templates & generation</h2><div className="txt-sm txt-muted">Word templates with merge fields · auto-populated from platform data</div></div>
      <div className="ml-auto row gap-sm"><Btn sm icon="upload">Upload template</Btn><Btn sm primary icon="plus">Generate</Btn></div>
    </div>
    <div className="grid g2">
      <div className="card">
        <div className="card-header"><h3>Generate · IFM001 invoice #12</h3><Badge tone="blue">draft</Badge></div>
        <div className="card-body">
          <div className="grid g2" style={{ gap:10 }}>
            <div className="field"><label>Template</label><div className="v">Foundry Standard Invoice v4 ▾</div></div>
            <div className="field"><label>Project</label><div className="v">IFM001 · Integrated Market</div></div>
            <div className="field"><label>Period</label><div className="v">March 2026</div></div>
            <div className="field"><label>Amount</label><div className="v">$120,000 (milestone 2 of 5)</div></div>
            <div className="field"><label>Currency</label><div className="v">AUD</div></div>
            <div className="field"><label>Due date</label><div className="v">+30d → 18 May 2026</div></div>
            <div className="field"><label>Ref number</label><div className="v">IFM001-INV-012</div></div>
            <div className="field"><label>Bill to</label><div className="v">IFM Finance · ap@ifm.com</div></div>
          </div>
          <div className="hdiv"/>
          <div className="txt-sm txt-muted" style={{ marginBottom:6, fontWeight:600 }}>Merge fields · auto-populated</div>
          <div className="mono txt-sm" style={{ background:'var(--bg-subtle)', padding:12, borderRadius:6, lineHeight:1.7 }}>
            {'{{client.name}} · {{project.code}} · {{invoice.number}} · {{amount}} · {{due_date}} · {{abn}} · {{line_items}}'}
          </div>
          <div className="row gap-sm" style={{ justifyContent:'flex-end', marginTop:14 }}>
            <Btn sm>Preview</Btn><Btn sm>Save .docx</Btn><Btn sm primary icon="arrow">Generate & route</Btn>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-header"><h3>Template library</h3><Btn sm ghost icon="plus">Add</Btn></div>
        <div className="list">
          {[['Foundry Standard Invoice v4','.docx','41×','auto'],['Foundry Project Contract v3','.docx','14×','manual'],['Foundry Consulting Agreement','.docx','6×','manual'],['Change Order v2','.docx','9×','auto'],['SOW — Strategy','.docx','8×','auto'],['Referral agreement v1','.docx','3×','manual'],['Close-out letter','.docx','11×','auto'],['NDA — mutual','.docx','18×','manual']].map((r,i)=>(
            <div key={i} className="list-item"><div className="main"><Icon name="doc"/><div><div style={{ fontWeight:500 }}>{r[0]}</div><div className="txt-sm txt-muted">{r[1]} · used {r[2]}</div></div></div><Badge tone={r[3]==='auto'?'green':''}>{r[3]}</Badge></div>
          ))}
        </div>
        <div className="card-body"><Callout tone="info" title="Bolt-on modules">📬 Email-to-invoice · 📄 Auto-gen contracts · ✍️ e-sign connector · 🔗 Xero sync</Callout></div>
      </div>
    </div>
  </>
);

// ============ ADMIN ============
const Admin = () => {
  const [tab, setTab] = React.useState('excel');
  const tabs = [['users','Users & roles'],['excel','Excel sync'],['ctrl','Financial controls'],['types','Project types'],['rates','Rates'],['bolt','Bolt-ons'],['audit','Audit log']];
  return (
  <>
    <div className="row" style={{ marginBottom:16 }}>
      <div><h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, margin:0 }}>Admin</h2><div className="txt-sm txt-muted">Users, roles, Excel sync, financial controls</div></div>
    </div>
    <div className="tabs">
      {tabs.map(([k,l])=>(<div key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</div>))}
    </div>
    {tab==='users' && <AdminUsersTab/>}
    {tab==='ctrl' && <AdminControlsTab/>}
    {tab==='types' && <AdminProjectTypesTab/>}
    {tab==='rates' && <AdminRatesTab/>}
    {tab==='bolt' && <AdminBoltOnsTab/>}
    {tab==='audit' && <AdminAuditTab/>}
    {tab==='excel' && <>
    <div className="grid g2">
      <div className="card">
        <div className="card-header"><h3>Connected workbooks</h3><Btn sm icon="plus">Connect</Btn></div>
        <table className="tbl">
          <thead><tr><th>Workbook</th><th>Location</th><th>Sync</th><th>Last</th><th>Owner</th></tr></thead>
          <tbody>
            {[['Finance.xlsx','OneDrive /Foundry/','2-way','2m','TT','synced'],['Timesheet.xlsx','OneDrive /Foundry/','2-way','4m','JS','synced'],['Invoices.xlsx','OneDrive /Foundry/','2-way','2h','JS','stale'],['Expenses.xlsx','OneDrive /Foundry/','2-way','now','JS','synced'],['Pipeline.xlsx','OneDrive /Foundry/','2-way','30s','MB','synced'],['Profit-pool.xlsx','OneDrive /Partners/','read-only','1h','TT','synced']].map((r,i)=>(
              <tr key={i}><td><div className="row gap-sm"><Icon name="sheet"/><b>{r[0]}</b></div></td><td className="txt-sm mono">{r[1]}</td><td><Badge>{r[2]}</Badge></td><td className="txt-sm">{r[3]}</td><td><Avatar size={22}>{r[4]}</Avatar></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <div className="card-header"><h3>Conflicts pending review</h3><Badge tone="red">2</Badge></div>
        <div className="card-body">
          <div style={{ display:'grid', gridTemplateColumns:'140px 1fr 1fr auto', gap:10, fontSize:12, fontWeight:600, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'.06em', padding:'6px 0', borderBottom:'1px solid var(--border)' }}>
            <div>Row</div><div>Web says</div><div>Excel says</div><div></div>
          </div>
          {[['INV-009 · Due','18 May 2026','25 May 2026'],['INV-011 · Amount','$48,000','$48,400']].map((r,i)=>(
            <div key={i} style={{ display:'grid', gridTemplateColumns:'140px 1fr 1fr auto', gap:10, padding:'12px 0', borderBottom:'1px solid var(--divider)', alignItems:'center' }}>
              <div className="txt-sm"><b>{r[0]}</b></div>
              <div style={{ background:'var(--blue-soft)', padding:'4px 8px', borderRadius:4, fontFamily:'var(--font-mono)', fontSize:12 }}>{r[1]}</div>
              <div style={{ background:'var(--green-soft)', padding:'4px 8px', borderRadius:4, fontFamily:'var(--font-mono)', fontSize:12 }}>{r[2]}</div>
              <div className="row gap-sm"><Btn sm ghost>Web</Btn><Btn sm ghost>Excel</Btn></div>
            </div>
          ))}
          <div className="hdiv"/>
          <div className="txt-sm txt-muted"><b>Two-way sync</b> — both web & Excel can edit. Conflicts surface here for human review. Users can fall back to Excel at any time (low bar by design).</div>
        </div>
      </div>
    </div>
    <div className="grid g2" style={{ marginTop:20 }}>
      <div className="card">
        <div className="card-header"><h3>Users & roles</h3><Btn sm icon="plus">Invite</Btn></div>
        <table className="tbl">
          <thead><tr><th>Member</th><th>Role</th><th>Scope</th></tr></thead>
          <tbody>
            {[['TT','Managing partner','full admin'],['MB','Partner','partner · lead IFM001, PNC001'],['SR','Assoc partner','partner · lead GNC001'],['CC','Consultant','contributor · timesheets, exp'],['JB','Analyst','contributor · timesheets'],['JS','Office manager','finance admin · all Excel'],['AP','External contractor','portal only · own invoices']].map((r,i)=>(
              <tr key={i}><td><div className="row gap-sm"><Avatar>{r[0]}</Avatar><b>{r[0]}</b></div></td><td>{r[1]}</td><td className="txt-sm txt-muted">{r[2]}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <div className="card-header"><h3>Financial controls</h3><Badge tone="accent">from Governance FY26</Badge></div>
        <div className="card-body">
          <div className="txt-sm txt-muted" style={{ fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', fontSize:10, marginBottom:6 }}>Auto-allocation</div>
          <div className="list">
            {[['Project OPEX contribution','20%'],['Firm profit pool','15%'],['Project expense target','< 50%'],['Net revenue target','> 30%'],['EBITDA target','15–20%']].map((r,i)=>(
              <div key={i} className="list-item"><div className="main">{r[0]}</div><b>{r[1]}</b></div>
            ))}
          </div>
          <div className="txt-sm txt-muted" style={{ fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', fontSize:10, margin:'12px 0 6px' }}>Referral caps</div>
          <div className="list">
            {[['External warm intro','5% · cap $50k'],['External co-sell','10% · cap $50k'],['Internal referral','2–5%'],['Partner referral','profit pool allocation']].map((r,i)=>(
              <div key={i} className="list-item"><div className="main">{r[0]}</div><b>{r[1]}</b></div>
            ))}
          </div>
          <Callout tone="info" title="Audit">Changes to these rules require 2 partner sign-off and create an audit log entry.</Callout>
        </div>
      </div>
    </div>
    </>}
  </>
  );
};

// ============ EXPENSES ============
const Expenses = () => {
  const [add, setAdd] = React.useState(false);
  return (
  <>
    <div className="row" style={{ marginBottom:16, gap:10 }}>
      <h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, margin:0 }}>Log an expense</h2>
      <XlsxPill state="synced">Expenses.xlsx</XlsxPill>
      <div className="ml-auto row gap-sm">
        <div className="txt-sm txt-muted">📬 <span className="mono" style={{ color:'var(--text)' }}>receipts@foundry.health</span></div>
        <Btn sm primary icon="plus" onClick={()=>setAdd(true)}>Quick log</Btn>
      </div>
    </div>
    {add && <window.AddExpenseModal onClose={()=>setAdd(false)}/>}
    <div className="grid" style={{ gridTemplateColumns:'1fr 1.5fr', gap:20, marginBottom:20 }}>
      <div className="dropzone">
        <Icon name="upload" size={28}/>
        <h4>Drop receipts or snap a photo</h4>
        <p>Uploads below</p>
        <div className="stack" style={{ marginTop:16, gap:6 }}>
          {[['📸 taxi-airport.jpg','$52'],['📄 dinner-gnc-client.pdf','$186'],['📸 flights-syd-mel.png','$420']].map((r,i)=>(
            <div key={i} style={{ display:'flex', justifyContent:'space-between', background:'var(--bg-elev)', padding:'8px 12px', borderRadius:6, border:'1px solid var(--border)', fontSize:13 }}>
              <span>{r[0]}</span><b>{r[1]}</b>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="card-header"><h3>New expense · auto-populated</h3><Badge tone="accent" dot>OCR 94%</Badge></div>
        <div className="card-body">
          <div className="grid g2" style={{ gap:10 }}>
            <div className="field"><label>Date</label><div className="v"><input defaultValue="14 Apr 2026"/></div></div>
            <div className="field"><label>Amount (AUD)</label><div className="v"><input defaultValue="$186.00"/></div></div>
            <div className="field"><label>Merchant</label><div className="v"><input defaultValue="Bistro Guillaume"/></div></div>
            <div className="field"><label>Category</label><div className="v"><input defaultValue="Meals & entertainment"/></div></div>
            <div className="field matched"><label>Project / OPEX</label><div className="v"><input defaultValue="GNC001"/></div></div>
            <div className="field"><label>Billable</label><div className="v"><input defaultValue="Yes · client dinner"/></div></div>
            <div className="field"><label>Attendees</label><div className="v"><input defaultValue="MB, SR, client×2"/></div></div>
            <div className="field"><label>Payment</label><div className="v"><input defaultValue="Amex ••4211 (TT)"/></div></div>
          </div>
          <Callout tone="warn" title="Meals > $150/head"><span className="txt-sm">Requires partner approval per policy · routed to MB on submit.</span></Callout>
          <div className="row gap-sm" style={{ justifyContent:'flex-end', marginTop:12 }}><Btn sm>Save draft</Btn><Btn sm primary icon="arrow">Submit</Btn></div>
        </div>
      </div>
    </div>
    <div className="card">
      <div className="card-header"><h3>This month · $3,240</h3><Btn sm icon="download">Export</Btn></div>
      <table className="tbl">
        <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Project</th><th className="num">Amount</th><th>By</th><th>Status</th><th>Receipt</th></tr></thead>
        <tbody>
          {[['14 Apr','Bistro Guillaume','Meals','GNC001','$186','MB','pending','amber'],['12 Apr','Qantas','Travel','IFM001','$420','CC','approved','green'],['10 Apr','Uber','Travel','IFM001','$52','CC','approved','green'],['08 Apr','WorkClub','OPEX','—','$2,800','JS','approved','green'],['05 Apr','Zoom','Subs · OPEX','—','$89','JS','approved','green']].map((r,i)=>(
            <tr key={i} style={{ cursor: r[3]==='—'?'default':'pointer' }} onClick={()=> r[3]!=='—' && window.__nav && window.__nav('projects', { projectCode: r[3], tab: 'exp' })}><td>{r[0]}</td><td>{r[1]}</td><td><Badge>{r[2]}</Badge></td><td className="code-cell">{r[3]}</td><td className="num">{r[4]}</td><td><Avatar size={22}>{r[5]}</Avatar></td><td><Badge tone={r[7]} dot>{r[6]}</Badge></td><td>📎</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  </>
  );
};

Object.assign(window, { BDPipeline, Approvals, Directory, Reports, Templates, Admin, Expenses });
