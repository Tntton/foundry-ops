// ============ PROJECT SETTINGS + RISKS TABS ============
// Settings: sub-tabs matching wizard steps, full edit, admin-gated fields hidden for non-admins.
// Risks: RAID log with category + severity/likelihood matrix + approvals rollup.

// Admin = mgpartner, office. Everyone else can't see financial internals.
const isAdmin = (role) => role === 'mgpartner' || role === 'office';

// Tiny "admin only" wrapper — fully hides children from non-admins
const AdminOnly = ({ role, children }) => isAdmin(role) ? <>{children}</> : null;

// Field with small "last edited" stamp + optional admin lock
const SField = ({ label, v, set, edited, mono, asSelect, options, type, placeholder, help, wide, disabled }) => (
  <div style={wide?{gridColumn:'1/-1'}:{}}>
    <div className="row-spread" style={{ marginBottom: 4 }}>
      <span className="wl" style={{ margin:0 }}>{label}</span>
      {edited && <span className="txt-sm txt-muted" style={{ fontSize:10 }}>edited {edited}</span>}
    </div>
    {asSelect ? (
      <select className={`wi ${mono?'mono':''}`} value={v} onChange={e=>set && set(e.target.value)} disabled={disabled}>
        {(options||[]).map((o,i)=> Array.isArray(o) ? <option key={i} value={o[0]}>{o[1]}</option> : <option key={i} value={o}>{o}</option>)}
      </select>
    ) : (
      <input className={`wi ${mono?'mono':''}`} value={v} type={type||'text'} onChange={e=>set && set(e.target.value)} placeholder={placeholder} disabled={disabled}/>
    )}
    {help && <div className="txt-sm txt-muted" style={{ fontSize:10, marginTop:3 }}>{help}</div>}
  </div>
);

// ========== PROJECT SETTINGS TAB ==========
const ProjectSettingsTab = ({ role, code }) => {
  const [sub, setSub] = React.useState(() => localStorage.getItem('foundry.projset.sub') || 'client');
  React.useEffect(()=>{ localStorage.setItem('foundry.projset.sub', sub); }, [sub]);

  // Seeded from wizard data shape
  const [d, setD] = React.useState({
    clientName: 'Integrated Market (IFM Pharma)',
    clientCode: 'IFM',
    clientEntity: 'IFM Pharma Pty Ltd',
    projectName: 'Diligence Strategy',
    codeName: 'Project GEM',
    projectType: 'Strategy',
    startDate: '2026-01-06',
    endDate: '2026-03-28',
    durationWeeks: 12,
    leadPartner: 'MB',
    status: 'delivery',
    industry: 'Pharma',
    contractType: 'fixed',
    grossFee: 600000,
    currency: 'AUD',
    paymentSchedule: 'upfront-interim-final',
    paymentTerms: '30',
    poRequired: true,
    billingEntity: 'IFM Finance Pty Ltd',
    billingEmail: 'ap@ifm.com',
    ndaSigned: true,
    msaSigned: true,
    sowVersion: 'v2.0',
    leadership: [
      { code:'MB', role:'Lead partner',      fte:0.5, rate:2000, weight:1.0 },
      { code:'TT', role:'Expert partner',    fte:0.3, rate:2000, weight:1.5 },
      { code:'SR', role:'Associate partner', fte:0.3, rate:2000, weight:1.0 },
    ],
    delivery: [
      { code:'CC', role:'Consultant',      alloc:'1.0 FTE', rate:800, unit:'/d' },
      { code:'JB', role:'Analyst',         alloc:'1.0 FTE', rate:400, unit:'/d' },
      { code:'AP', role:'External expert', alloc:'4h/wk',   rate:250, unit:'/h' },
    ],
    opexPct: 20,
    profitPoolPct: 15,
    bdReferralPct: 3,
    expenseBudget: 18000,
    expTravel: 12000,
    expExperts: 4000,
    expData: 1500,
    expMisc: 500,
    referrals: [ { name:'AP · Alex Park', type:'BD · introducer', pct:3, notes:'Intro at BIO Asia · CEO relationship' } ],
  });
  const patch = p => setD(x => ({...x, ...p}));

  // Per-section edit stamps (simulated)
  const stamps = {
    client:    '3 wks ago · JS',
    contract:  '12 Feb · MB',
    team:      '8 Apr · MB',
    financial: 'at kickoff · TT',
    referrals: 'at kickoff · TT',
    docs:      'yesterday · JS',
  };

  const subs = [
    ['client', 'Client & naming'],
    ['contract', 'Contract'],
    ['team', 'Team & rates'],
    ['financial', 'Financial model'],
    ['referrals', 'Referrals'],
    ['docs', 'Documents'],
  ];

  return (
    <div className="grid" style={{ gridTemplateColumns:'220px 1fr', gap:20, alignItems:'flex-start' }}>
      <div className="card" style={{ position:'sticky', top:0 }}>
        <div className="card-header"><h3 style={{ fontSize:13 }}>Settings</h3></div>
        <div className="list">
          {subs.map(([k,l])=>(
            <div key={k} className="list-item" onClick={()=>setSub(k)} style={{ cursor:'pointer', background: sub===k?'var(--bg-subtle)':'transparent', borderLeft: sub===k?'2px solid var(--brand)':'2px solid transparent' }}>
              <div className="main" style={{ fontSize:13, fontWeight: sub===k?600:400 }}>{l}</div>
            </div>
          ))}
        </div>
        {!isAdmin(role) && (
          <div className="card-body" style={{ padding:12, borderTop:'1px solid var(--divider)' }}>
            <div className="txt-sm txt-muted" style={{ fontSize:11, lineHeight:1.45 }}>
              <b style={{ color:'var(--text-2)' }}>Note.</b> Some financial fields (rates, margin model, banking) are only visible to Managing Partners & Office.
            </div>
          </div>
        )}
      </div>

      <div className="stack">
        {sub==='client'    && <SettingsClient    role={role} d={d} patch={patch} stamp={stamps.client}/>}
        {sub==='contract'  && <SettingsContract  role={role} d={d} patch={patch} stamp={stamps.contract}/>}
        {sub==='team'      && <SettingsTeam      role={role} d={d} patch={patch} stamp={stamps.team}/>}
        {sub==='financial' && <SettingsFinancial role={role} d={d} patch={patch} stamp={stamps.financial}/>}
        {sub==='referrals' && <SettingsReferrals role={role} d={d} patch={patch} stamp={stamps.referrals}/>}
        {sub==='docs'      && <SettingsDocs      role={role} d={d} patch={patch} stamp={stamps.docs}/>}

        <div className="card" style={{ background:'var(--bg-subtle)', borderStyle:'dashed' }}>
          <div className="card-body row" style={{ alignItems:'center' }}>
            <div className="txt-sm txt-muted">Changes save on blur · propagate to <b>Finance.xlsx</b>, <b>Timesheet.xlsx</b>, <b>Invoices register</b></div>
            <div className="ml-auto row gap-sm">
              <Btn sm ghost>Revert section</Btn>
              <Btn sm primary>Save &amp; sync</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ----- CLIENT & NAMING -----
const SettingsClient = ({ role, d, patch, stamp }) => (
  <div className="card">
    <div className="card-header">
      <div><h3>Client &amp; naming</h3><div className="txt-sm txt-muted">last edited {stamp}</div></div>
      <Btn sm ghost icon="team" onClick={()=>window.__nav && window.__nav('directory')}>Open client profile →</Btn>
    </div>
    <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
      <SField label="Client" v={d.clientName} set={v=>patch({clientName:v})} asSelect options={['Integrated Market (IFM Pharma)','Panacea','Genica','Biomax','Adexa']}/>
      <SField label="Client code" v={d.clientCode} set={v=>patch({clientCode:v.toUpperCase().slice(0,3)})} mono help="3 letters · part of project code"/>
      <AdminOnly role={role}>
        <SField label="Legal billing entity" v={d.clientEntity} set={v=>patch({clientEntity:v})}/>
      </AdminOnly>
      <SField label="Industry" v={d.industry} set={v=>patch({industry:v})} asSelect options={['Pharma','Biotech','Medtech','Healthcare services','Digital health','Other']}/>

      <SField label="Project name" v={d.projectName} set={v=>patch({projectName:v})}/>
      <SField label="Code name (internal)" v={d.codeName} set={v=>patch({codeName:v})} help="shown in firm-only views"/>

      <div>
        <div className="wl">Project code</div>
        <input className="wi mono" value={d.clientCode + '001'} readOnly style={{ background:'var(--bg-subtle)', color:'var(--text-3)' }}/>
        <div className="txt-sm txt-muted" style={{ fontSize:10, marginTop:3 }}>locked after creation · propagates to 6 workbooks</div>
      </div>
      <SField label="Project type" v={d.projectType} set={v=>patch({projectType:v})} asSelect options={['Strategy','Due diligence','Market entry','Portfolio review','Commercial advisory','Retainer','Other']}/>

      <SField label="Start date" v={d.startDate} set={v=>patch({startDate:v})} type="date"/>
      <SField label="End date (planned)" v={d.endDate} set={v=>patch({endDate:v})} type="date"/>

      <SField label="Duration (weeks)" v={d.durationWeeks} set={v=>patch({durationWeeks:+v||0})} mono type="number"/>
      <SField label="Lead partner" v={d.leadPartner} set={v=>patch({leadPartner:v})} asSelect options={[['TT','TT · Trung'],['MB','MB · non-op partner'],['SR','SR · associate']]}/>

      <SField label="Project status" v={d.status} set={v=>patch({status:v})} asSelect options={[['scoping','Scoping'],['kickoff','Kickoff'],['delivery','Delivery'],['closing','Closing'],['closed','Closed'],['onhold','On hold']]}/>
    </div>
  </div>
);

// ----- CONTRACT -----
const SettingsContract = ({ role, d, patch, stamp }) => (<>
  <div className="card">
    <div className="card-header">
      <div><h3>Contract structure</h3><div className="txt-sm txt-muted">last edited {stamp}</div></div>
      <AdminOnly role={role}><Btn sm ghost icon="doc">Change order</Btn></AdminOnly>
    </div>
    <div className="card-body">
      <AdminOnly role={role}>
        <div className="grid g3" style={{ gap:10, marginBottom:14 }}>
          {[['fixed','Fixed fee','scope-locked'],['t&m','Time & materials','rate card × hours'],['retainer','Retainer','monthly recurring']].map(([k,l,s])=>(
            <div key={k} onClick={()=>patch({contractType:k})} style={{ border:`1.5px solid ${d.contractType===k?'var(--brand)':'var(--border)'}`, borderRadius:8, padding:12, cursor:'pointer', background:d.contractType===k?'rgba(30,58,52,0.04)':'transparent' }}>
              <div style={{ fontWeight:600, fontSize:13 }}>{l}</div>
              <div className="txt-sm txt-muted" style={{ fontSize:11 }}>{s}</div>
            </div>
          ))}
        </div>
      </AdminOnly>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
        <AdminOnly role={role}>
          <div>
            <div className="wl">Gross fee (contract value)</div>
            <div className="row gap-sm" style={{ alignItems:'center' }}>
              <span className="mono" style={{ color:'var(--text-3)' }}>$</span>
              <input className="wi mono" type="number" value={d.grossFee} onChange={e=>patch({grossFee:+e.target.value||0})}/>
            </div>
            <div className="txt-sm txt-muted" style={{ fontSize:10, marginTop:3 }}>changes require change-order signature</div>
          </div>
        </AdminOnly>
        <SField label="Currency" v={d.currency} set={v=>patch({currency:v})} asSelect options={['AUD','USD','SGD','EUR','GBP']} mono/>
        <AdminOnly role={role}>
          <SField label="Payment terms" v={d.paymentTerms} set={v=>patch({paymentTerms:v})} asSelect options={[['7','Net 7'],['14','Net 14'],['30','Net 30'],['45','Net 45'],['60','Net 60'],['90','Net 90']]}/>
        </AdminOnly>
      </div>
    </div>
  </div>

  <AdminOnly role={role}>
    <div className="card">
      <div className="card-header"><h3>Payment milestones</h3><Btn sm ghost icon="plus">Add milestone</Btn></div>
      <table className="tbl">
        <thead><tr><th>#</th><th>Milestone</th><th>Trigger</th><th className="num">% of fee</th><th className="num">Amount</th><th>Status</th></tr></thead>
        <tbody>
          {[
            ['01','Upfront / kickoff','On signature',33,'paid','green'],
            ['02','Interim report','Week 6 review',33,'invoiced','amber'],
            ['03','Final deliverable','Client sign-off',34,'pending','' ],
          ].map((r,i)=>(
            <tr key={i}>
              <td className="mono">{r[0]}</td>
              <td>{r[1]}</td>
              <td className="txt-sm">{r[2]}</td>
              <td className="num mono">{r[3]}%</td>
              <td className="num mono">${Math.round(d.grossFee*r[3]/100).toLocaleString()}</td>
              <td><Badge tone={r[5]||'accent'} dot>{r[4]}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </AdminOnly>

  <div className="card">
    <div className="card-header"><h3>Legal &amp; tax</h3></div>
    <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
      <div className="row-spread"><span className="txt-sm">NDA on file</span>{d.ndaSigned?<Badge tone="green" dot>signed</Badge>:<Btn sm>Generate</Btn>}</div>
      <div className="row-spread"><span className="txt-sm">MSA on file</span>{d.msaSigned?<Badge tone="green" dot>signed</Badge>:<Btn sm>Generate</Btn>}</div>
      <div className="row-spread"><span className="txt-sm">SOW version</span><Badge dot>{d.sowVersion}</Badge></div>
      <div className="row-spread"><span className="txt-sm">GST treatment</span><Badge dot>10% inc.</Badge></div>
      <AdminOnly role={role}>
        <SField label="Billing entity" v={d.billingEntity} set={v=>patch({billingEntity:v})}/>
        <SField label="Billing email (A/P)" v={d.billingEmail} set={v=>patch({billingEmail:v})}/>
        <div className="row-spread"><span className="txt-sm">PO required</span><input type="checkbox" checked={d.poRequired} onChange={e=>patch({poRequired:e.target.checked})}/></div>
      </AdminOnly>
    </div>
  </div>
</>);

// ----- TEAM & RATES -----
const SettingsTeam = ({ role, d, patch, stamp }) => {
  const admin = isAdmin(role);
  const editLead = (i,p) => patch({ leadership:d.leadership.map((r,ii)=>ii===i?{...r,...p}:r) });
  const editDel  = (i,p) => patch({ delivery:d.delivery.map((r,ii)=>ii===i?{...r,...p}:r) });
  const rmLead   = (i) => patch({ leadership:d.leadership.filter((_,ii)=>ii!==i) });
  const rmDel    = (i) => patch({ delivery:d.delivery.filter((_,ii)=>ii!==i) });
  const addLead  = () => patch({ leadership:[...d.leadership, { code:'', role:'Partner', fte:0.3, rate:2000, weight:1.0 }] });
  const addDel   = () => patch({ delivery:[...d.delivery, { code:'', role:'Consultant', alloc:'1.0 FTE', rate:800, unit:'/d' }] });

  return (<>
    <div className="card">
      <div className="card-header">
        <div><h3>Leadership team</h3><div className="txt-sm txt-muted">last edited {stamp}</div></div>
        <Btn sm icon="plus" ghost onClick={addLead}>Add partner</Btn>
      </div>
      <div style={{ padding:'4px 18px 16px' }}>
        <div style={{ display:'grid', gridTemplateColumns: admin?'36px 1fr 90px 110px 80px 90px 30px':'36px 1fr 90px 80px 30px', gap:10, fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-3)', padding:'6px 0', borderBottom:'1px solid var(--divider)' }}>
          <div/><div>Person · role</div><div>FTE</div>{admin && <div>Day rate</div>}<div>Weight</div>{admin && <div className="num">Fees</div>}<div/>
        </div>
        {d.leadership.map((r,i)=>{
          const fees = Math.round(r.fte*r.rate*5*d.durationWeeks);
          return (
            <div key={i} style={{ display:'grid', gridTemplateColumns: admin?'36px 1fr 90px 110px 80px 90px 30px':'36px 1fr 90px 80px 30px', gap:10, alignItems:'center', padding:'8px 0', borderBottom:'1px solid var(--divider)' }}>
              <Avatar>{r.code||'??'}</Avatar>
              <div>
                <input className="wi" value={r.code} onChange={e=>editLead(i,{code:e.target.value.toUpperCase()})} style={{ width:54, marginRight:8 }}/>
                <input className="wi" value={r.role} onChange={e=>editLead(i,{role:e.target.value})} style={{ width:'calc(100% - 64px)' }}/>
              </div>
              <input className="wi mono" type="number" step="0.1" value={r.fte} onChange={e=>editLead(i,{fte:+e.target.value||0})}/>
              {admin && <input className="wi mono" type="number" value={r.rate} onChange={e=>editLead(i,{rate:+e.target.value||0})}/>}
              <input className="wi mono" type="number" step="0.1" value={r.weight} onChange={e=>editLead(i,{weight:+e.target.value||0})}/>
              {admin && <div className="num mono" style={{ fontWeight:600 }}>${fees.toLocaleString()}</div>}
              <Btn sm ghost onClick={()=>rmLead(i)}>✕</Btn>
            </div>
          );
        })}
      </div>
    </div>

    <div className="card">
      <div className="card-header"><h3>Delivery team</h3><Btn sm icon="plus" ghost onClick={addDel}>Add member</Btn></div>
      <div style={{ padding:'4px 18px 16px' }}>
        <div style={{ display:'grid', gridTemplateColumns: admin?'36px 1fr 120px 130px 90px 30px':'36px 1fr 120px 30px', gap:10, fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-3)', padding:'6px 0', borderBottom:'1px solid var(--divider)' }}>
          <div/><div>Person · role</div><div>Allocation</div>{admin && <><div>Rate</div><div className="num">Fees</div></>}<div/>
        </div>
        {d.delivery.map((r,i)=>{
          const fte = parseFloat((r.alloc||'').split(' ')[0]) || 0.5;
          const hrs = parseFloat((r.alloc||'').split('h')[0]) || 4;
          const fees = r.unit==='/d' ? Math.round(fte*r.rate*5*d.durationWeeks) : Math.round(hrs*r.rate*d.durationWeeks);
          return (
            <div key={i} style={{ display:'grid', gridTemplateColumns: admin?'36px 1fr 120px 130px 90px 30px':'36px 1fr 120px 30px', gap:10, alignItems:'center', padding:'8px 0', borderBottom:'1px solid var(--divider)' }}>
              <Avatar>{r.code||'??'}</Avatar>
              <div>
                <input className="wi" value={r.code} onChange={e=>editDel(i,{code:e.target.value.toUpperCase()})} style={{ width:54, marginRight:8 }}/>
                <input className="wi" value={r.role} onChange={e=>editDel(i,{role:e.target.value})} style={{ width:'calc(100% - 64px)' }}/>
              </div>
              <input className="wi" value={r.alloc} onChange={e=>editDel(i,{alloc:e.target.value})}/>
              {admin && (
                <div className="row gap-sm">
                  <input className="wi mono" type="number" value={r.rate} onChange={e=>editDel(i,{rate:+e.target.value||0})} style={{ width:80 }}/>
                  <select className="wi mono" value={r.unit} onChange={e=>editDel(i,{unit:e.target.value})} style={{ width:44 }}><option value="/d">/d</option><option value="/h">/h</option></select>
                </div>
              )}
              {admin && <div className="num mono" style={{ fontWeight:600 }}>${fees.toLocaleString()}</div>}
              <Btn sm ghost onClick={()=>rmDel(i)}>✕</Btn>
            </div>
          );
        })}
      </div>
    </div>
  </>);
};

// ----- FINANCIAL MODEL (fully admin-gated) -----
const SettingsFinancial = ({ role, d, patch, stamp }) => {
  if (!isAdmin(role)) {
    return (
      <div className="card">
        <div className="card-header"><h3>Financial model</h3></div>
        <div className="card-body">
          <Callout tone="info" title="Admin only">
            <span className="txt-sm">Margin model, OPEX %, profit pool %, BD referral %, expense budgets and banking details are only visible to Managing Partners &amp; Office managers. Speak to TT or JS if you need a change.</span>
          </Callout>
        </div>
      </div>
    );
  }
  const opex = Math.round(d.grossFee*d.opexPct/100);
  const pool = Math.round(d.grossFee*d.profitPoolPct/100);
  const bd   = Math.round(d.grossFee*d.bdReferralPct/100);
  return (<>
    <div className="card">
      <div className="card-header"><div><h3>Margin model</h3><div className="txt-sm txt-muted">last edited {stamp} · firm defaults · override per project</div></div><Badge tone="amber" dot>admin only</Badge></div>
      <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:18 }}>
        <div>
          <div className="row-spread"><span className="wl" style={{margin:0}}>OPEX %</span><b className="mono">{d.opexPct}%</b></div>
          <input type="range" min={10} max={30} value={d.opexPct} onChange={e=>patch({opexPct:+e.target.value})} style={{ width:'100%', marginTop:6 }}/>
          <div className="txt-sm txt-muted" style={{ fontSize:11 }}>${opex.toLocaleString()}</div>
        </div>
        <div>
          <div className="row-spread"><span className="wl" style={{margin:0}}>Profit pool %</span><b className="mono">{d.profitPoolPct}%</b></div>
          <input type="range" min={5} max={30} value={d.profitPoolPct} onChange={e=>patch({profitPoolPct:+e.target.value})} style={{ width:'100%', marginTop:6 }}/>
          <div className="txt-sm txt-muted" style={{ fontSize:11 }}>${pool.toLocaleString()}</div>
        </div>
        <div>
          <div className="row-spread"><span className="wl" style={{margin:0}}>BD referral %</span><b className="mono">{d.bdReferralPct}%</b></div>
          <input type="range" min={0} max={10} value={d.bdReferralPct} onChange={e=>patch({bdReferralPct:+e.target.value})} style={{ width:'100%', marginTop:6 }}/>
          <div className="txt-sm txt-muted" style={{ fontSize:11 }}>${bd.toLocaleString()}</div>
        </div>
      </div>
    </div>

    <div className="card">
      <div className="card-header"><h3>Expense budget</h3><Btn sm ghost icon="pencil">Reset to template</Btn></div>
      <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        <SField label="Travel &amp; accommodation" v={d.expTravel} set={v=>patch({expTravel:+v||0})} mono type="number"/>
        <SField label="External experts" v={d.expExperts} set={v=>patch({expExperts:+v||0})} mono type="number"/>
        <SField label="Data / subscriptions" v={d.expData} set={v=>patch({expData:+v||0})} mono type="number"/>
        <SField label="Misc / contingency" v={d.expMisc} set={v=>patch({expMisc:+v||0})} mono type="number"/>
        <div className="row-spread" style={{ gridColumn:'1/-1', borderTop:'1px solid var(--divider)', paddingTop:10 }}>
          <span className="txt-sm">Total expense budget</span>
          <b className="mono">${(d.expTravel+d.expExperts+d.expData+d.expMisc).toLocaleString()}</b>
        </div>
      </div>
    </div>

    <div className="card">
      <div className="card-header"><h3>Firm bank details</h3><Badge tone="red" dot>sensitive</Badge></div>
      <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        <SField label="Account name" v="Foundry Health Pty Ltd" set={()=>{}} disabled/>
        <SField label="BSB" v="032 123" set={()=>{}} mono disabled/>
        <SField label="Account number" v="•••• •••• 7890" set={()=>{}} mono disabled/>
        <SField label="SWIFT (intl)" v="WPACAU2S" set={()=>{}} mono disabled/>
        <Callout tone="warn" wide>
          <span className="txt-sm">Bank details are firm-wide and edited in <b>Master admin → Banking</b>. Shown here read-only for invoice template reference.</span>
        </Callout>
      </div>
    </div>
  </>);
};

// ----- REFERRALS (admin only amounts) -----
const SettingsReferrals = ({ role, d, patch, stamp }) => {
  const admin = isAdmin(role);
  const edit = (i,p) => patch({ referrals:d.referrals.map((r,ii)=>ii===i?{...r,...p}:r) });
  const rm   = (i) => patch({ referrals:d.referrals.filter((_,ii)=>ii!==i) });
  const add  = () => patch({ referrals:[...d.referrals, { name:'', type:'BD · introducer', pct:3, notes:'' }] });

  if (!admin) {
    return (
      <div className="card">
        <div className="card-header"><h3>Referrals</h3></div>
        <div className="card-body">
          <Callout tone="info" title="Admin only">
            <span className="txt-sm">Referral attribution & percentages affect partner compensation and are visible only to Managing Partners & Office managers.</span>
          </Callout>
          <div className="hdiv"/>
          <div className="list">
            {d.referrals.map((r,i)=>(
              <div key={i} className="list-item">
                <div className="main"><div style={{ fontWeight:500 }}>{r.name}</div><div className="txt-sm txt-muted">{r.type}</div></div>
                <Badge dot>attribution recorded</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const totalPct = d.referrals.reduce((a,r)=>a+(+r.pct||0), 0);
  return (
    <div className="card">
      <div className="card-header"><div><h3>Referrals &amp; attribution</h3><div className="txt-sm txt-muted">last edited {stamp}</div></div><Btn sm icon="plus" ghost onClick={add}>Add referral</Btn></div>
      <div style={{ padding:'4px 18px 16px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr 100px 2fr 30px', gap:10, fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-3)', padding:'6px 0', borderBottom:'1px solid var(--divider)' }}>
          <div>Person / firm</div><div>Type</div><div>%</div><div>Context</div><div/>
        </div>
        {d.referrals.map((r,i)=>(
          <div key={i} style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr 100px 2fr 30px', gap:10, alignItems:'center', padding:'8px 0', borderBottom:'1px solid var(--divider)' }}>
            <input className="wi" value={r.name} onChange={e=>edit(i,{name:e.target.value})} placeholder="Person / firm"/>
            <select className="wi" value={r.type} onChange={e=>edit(i,{type:e.target.value})}>
              <option>BD · introducer</option><option>BD · closer</option><option>External referral partner</option><option>Client referral</option>
            </select>
            <div className="row gap-sm"><input className="wi mono" type="number" step="0.5" value={r.pct} onChange={e=>edit(i,{pct:+e.target.value||0})} style={{ width:60 }}/><span className="txt-sm txt-muted">%</span></div>
            <input className="wi" value={r.notes} onChange={e=>edit(i,{notes:e.target.value})} placeholder="Context"/>
            <Btn sm ghost onClick={()=>rm(i)}>✕</Btn>
          </div>
        ))}
      </div>
      <div className="card-body" style={{ paddingTop:0 }}>
        <div className="row-spread"><span className="txt-sm">Total attribution</span><b className="mono">{totalPct.toFixed(1)}% · ${Math.round(d.grossFee*totalPct/100).toLocaleString()}</b></div>
        {totalPct > 5 && <Callout tone="amber"><span className="txt-sm">Total referral attribution exceeds firm cap of 5% · needs Managing Partner sign-off.</span></Callout>}
      </div>
    </div>
  );
};

// ----- DOCS -----
const SettingsDocs = ({ role, d, patch, stamp }) => (
  <div className="card">
    <div className="card-header"><div><h3>Project documents</h3><div className="txt-sm txt-muted">last edited {stamp}</div></div><Btn sm icon="upload">Upload</Btn></div>
    <div className="list">
      {[
        ['📄 IFM001 — SOW v2.0.pdf', '412 kB', 'signed 12 Feb 2026', 'green'],
        ['📄 IFM001 — NDA.pdf', '48 kB', 'signed 06 Jan 2026', 'green'],
        ['📄 IFM — MSA 2024.pdf', '312 kB', 'parent agreement', ''],
        ['📄 Change Order #1.pdf', '92 kB', 'signed 28 Feb', 'green'],
        ['📄 Change Order #2 (draft).docx', '24 kB', 'MB drafting', 'amber'],
        ['📊 Financial Tracker — IFM001.xlsx', '180 kB', 'auto-synced', 'green'],
        ['📁 /Clients/IFM/IFM001/', '—', 'OneDrive · 142 files', ''],
      ].map((r,i)=>(
        <div key={i} className="list-item" style={{ cursor:'pointer' }}>
          <div className="main"><div style={{ fontWeight:500 }}>{r[0]}</div><div className="txt-sm txt-muted">{r[1]} · {r[2]}</div></div>
          <div className="row gap-sm">{r[3] && <Badge tone={r[3]} dot>{r[3]==='green'?'current':'draft'}</Badge>}<Btn sm ghost>Open</Btn></div>
        </div>
      ))}
    </div>
  </div>
);

// ============ PROJECT RISKS TAB ============

// RAID = Risks, Assumptions, Issues, Dependencies — we focus on Risks + Issues.
const RISK_SEED = [
  { id:'R01', cat:'Scope',    title:'Client requesting additional market (APAC ex-Japan) mid-project', sev:3, lik:4, status:'open',       owner:'MB', mitigation:'Scope workshop wk6 · change-order if accepted', flagged:true,  age:'4d', needsSignoff:true },
  { id:'R02', cat:'Margin',   title:'Travel line +30% over budget (CC site-visits)',                   sev:3, lik:5, status:'open',       owner:'MB', mitigation:'Freeze discretionary travel · use remote experts', flagged:true,  age:'2d', needsSignoff:false },
  { id:'R03', cat:'Team',     title:'JB analyst 90% allocated wks 18–19 — capacity conflict',          sev:2, lik:3, status:'mitigated',  owner:'TT', mitigation:'Moved PNC002 scoping to wk 20',                        flagged:false, age:'1wk', needsSignoff:false },
  { id:'R04', cat:'Client',   title:'New economic buyer (CEO transition Q2)',                           sev:4, lik:3, status:'open',       owner:'MB', mitigation:'Intro call booked wk18 · TT attending',                 flagged:true,  age:'6d', needsSignoff:true },
  { id:'R05', cat:'Delivery', title:'US expert cadence slipping (2 missed syncs)',                      sev:2, lik:3, status:'open',       owner:'CC', mitigation:'Switched to async video updates · weekly',             flagged:false, age:'3d', needsSignoff:false },
  { id:'R06', cat:'Legal',    title:'DPA refresh pending for 2025 data-handling update',                sev:2, lik:2, status:'accepted',   owner:'JS', mitigation:'Firm DPA v3 in circulation · non-blocking',             flagged:false, age:'2wk', needsSignoff:false },
];

const SEV_LABELS = ['', 'Low', 'Minor', 'Mod', 'High', 'Critical'];
const LIK_LABELS = ['', 'Rare', 'Unlikely', 'Possible', 'Likely', 'Certain'];

const sevTone = (s) => s>=4 ? 'red' : s>=3 ? 'amber' : 'text-3';
const riskScore = (r) => r.sev * r.lik;

const ProjectRisksTab = ({ role, code }) => {
  const [risks, setRisks] = React.useState(RISK_SEED);
  const [filter, setFilter] = React.useState('open');
  const [drawer, setDrawer] = React.useState(null);

  const visible = risks.filter(r => filter==='all' ? true : r.status===filter);
  const counts = {
    all: risks.length,
    open: risks.filter(r=>r.status==='open').length,
    mitigated: risks.filter(r=>r.status==='mitigated').length,
    accepted: risks.filter(r=>r.status==='accepted').length,
  };

  const highOpen = risks.filter(r => r.status==='open' && r.sev>=4);
  const pendingSignoff = risks.filter(r => r.needsSignoff && r.status==='open');

  const toggleFlag = (id) => setRisks(rs => rs.map(r => r.id===id ? {...r, needsSignoff: !r.needsSignoff} : r));
  const setStatus = (id, status) => setRisks(rs => rs.map(r => r.id===id ? {...r, status} : r));

  return (<>
    {/* rollup banner */}
    {(highOpen.length>0 || pendingSignoff.length>0) && (
      <Callout tone="warn" title={`${highOpen.length} high-severity · ${pendingSignoff.length} awaiting sign-off`}>
        <span className="txt-sm">Auto-queued to <a href="#" style={{ color:'var(--accent)', fontWeight:500 }} onClick={e=>{e.preventDefault(); window.__nav && window.__nav('approvals', { filter:'risks' });}}>Approvals →</a>. High-severity items require MP sign-off; others can be manually flagged.</span>
      </Callout>
    )}

    <div className="grid g-main-side">
      <div className="stack">
        <div className="card">
          <div className="card-header">
            <div><h3>Risk register</h3><div className="txt-sm txt-muted">RAID log · {risks.length} items tracked · updated daily</div></div>
            <div className="row gap-sm">
              <Btn sm ghost icon="filter">By category</Btn>
              <Btn sm primary icon="plus">Log risk</Btn>
            </div>
          </div>
          <div className="tabs" style={{ margin:'0 16px' }}>
            {[['open',`Open · ${counts.open}`],['mitigated',`Mitigated · ${counts.mitigated}`],['accepted',`Accepted · ${counts.accepted}`],['all',`All · ${counts.all}`]].map(([k,l])=>(
              <div key={k} className={`tab ${filter===k?'active':''}`} onClick={()=>setFilter(k)}>{l}</div>
            ))}
          </div>
          <table className="tbl">
            <thead><tr><th>ID</th><th>Category</th><th>Risk</th><th className="num">Score</th><th>Owner</th><th>Status</th><th>Age</th><th></th></tr></thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.id} style={{ cursor:'pointer' }} onClick={()=>setDrawer(r)}>
                  <td className="mono">{r.id}</td>
                  <td><Badge>{r.cat}</Badge></td>
                  <td><div style={{ maxWidth:380 }}>{r.title}{r.needsSignoff && <Badge tone="red" dot style={{ marginLeft:6 }}>sign-off</Badge>}</div><div className="txt-sm txt-muted" style={{ fontSize:11 }}>mitigation: {r.mitigation}</div></td>
                  <td className="num"><span className="mono" style={{ color:`var(--${sevTone(r.sev)})`, fontWeight:600 }}>{riskScore(r)}</span><div className="txt-sm txt-muted" style={{ fontSize:10 }}>S{r.sev}·L{r.lik}</div></td>
                  <td className="code-cell">{r.owner}</td>
                  <td><Badge tone={r.status==='open'?'amber':r.status==='mitigated'?'green':''} dot>{r.status}</Badge></td>
                  <td className="txt-sm txt-muted">{r.age}</td>
                  <td><Btn sm ghost onClick={e=>{e.stopPropagation(); setDrawer(r);}}>Open →</Btn></td>
                </tr>
              ))}
              {visible.length===0 && <tr><td colSpan="8" className="txt-muted" style={{ textAlign:'center', padding:30 }}>No {filter} risks.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-header"><h3>Severity × likelihood matrix</h3><div className="txt-sm txt-muted">heat map of open risks</div></div>
          <div className="card-body">
            <SevLikMatrix risks={risks.filter(r=>r.status==='open')} onCell={(s,l)=>{}}/>
          </div>
        </div>
      </div>

      <div className="stack">
        <div className="card kpi">
          <div className="label">Risk score</div>
          <div className="value" style={{ color: highOpen.length>0?'var(--amber)':'var(--green)' }}>{risks.filter(r=>r.status==='open').reduce((a,r)=>a+riskScore(r),0)}</div>
          <div className="sub">{highOpen.length} high-severity · {counts.open} open</div>
          <div className="hdiv"/>
          <div className="stack" style={{ gap:4 }}>
            {['Scope','Margin','Team','Client','Delivery','Legal'].map(c => {
              const n = risks.filter(r => r.cat===c && r.status==='open').length;
              return <div key={c} className="row-spread txt-sm"><span>{c}</span><Badge tone={n>0?'amber':''} dot>{n}</Badge></div>;
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>Awaiting sign-off</h3><Badge tone="red" dot>{pendingSignoff.length}</Badge></div>
          <div className="list">
            {pendingSignoff.length===0 && <div className="list-item txt-muted" style={{ justifyContent:'center', padding:20 }}>Nothing pending</div>}
            {pendingSignoff.map(r => (
              <div key={r.id} className="list-item" style={{ cursor:'pointer' }} onClick={()=>setDrawer(r)}>
                <div className="main"><div className="mono txt-sm" style={{ fontWeight:500 }}>{r.id} · {r.cat}</div><div className="txt-sm txt-muted">{r.title}</div></div>
                <Badge tone={sevTone(r.sev)} dot>S{r.sev}</Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>How scoring works</h3></div>
          <div className="card-body">
            <div className="txt-sm" style={{ lineHeight:1.55 }}>
              <b>Score = severity × likelihood</b> (1–25). Any open risk with severity ≥ <b>High (4)</b> auto-queues to Approvals for Managing Partner sign-off. Partners can also manually flag a lower-severity risk — it joins the same queue.
            </div>
          </div>
        </div>
      </div>
    </div>

    {drawer && <RiskDrawer risk={drawer} role={role} onClose={()=>setDrawer(null)} onToggleFlag={()=>toggleFlag(drawer.id)} onStatus={(s)=>{ setStatus(drawer.id, s); setDrawer({...drawer, status:s}); }}/>}
  </>);
};

// ---- severity × likelihood heatmap ----
const SevLikMatrix = ({ risks }) => {
  // rows = severity 5..1 (high top), cols = likelihood 1..5
  const cell = (s, l) => risks.filter(r => r.sev===s && r.lik===l);
  const cellBg = (s, l) => {
    const score = s * l;
    if (score >= 15) return 'rgba(165,52,47,0.18)';
    if (score >= 8)  return 'rgba(196,169,98,0.18)';
    if (score >= 4)  return 'rgba(63,124,92,0.10)';
    return 'rgba(0,0,0,0.03)';
  };
  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'80px repeat(5, 1fr)', gap:4, fontSize:11 }}>
        <div/>
        {[1,2,3,4,5].map(l => <div key={l} style={{ textAlign:'center', color:'var(--text-3)', fontSize:10, textTransform:'uppercase', letterSpacing:'.05em', paddingBottom:4 }}>{LIK_LABELS[l]}</div>)}
        {[5,4,3,2,1].map(s => (
          <React.Fragment key={s}>
            <div style={{ color:'var(--text-3)', fontSize:10, textTransform:'uppercase', letterSpacing:'.05em', display:'flex', alignItems:'center', justifyContent:'flex-end', paddingRight:8 }}>{SEV_LABELS[s]}</div>
            {[1,2,3,4,5].map(l => {
              const items = cell(s, l);
              return (
                <div key={l} style={{ background: cellBg(s,l), border:'1px solid var(--divider)', borderRadius:4, minHeight:60, padding:6, display:'flex', flexDirection:'column', gap:3 }}>
                  {items.map(r => (
                    <div key={r.id} className="mono" style={{ fontSize:10, background:'var(--bg)', border:'1px solid var(--border)', borderRadius:3, padding:'2px 5px', fontWeight:500 }} title={r.title}>{r.id}</div>
                  ))}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="row gap-sm" style={{ marginTop:10, justifyContent:'flex-end', fontSize:11 }}>
        <span className="txt-muted" style={{ fontSize:10 }}>LIKELIHOOD →</span>
        <span style={{ width:12, height:12, background:'rgba(165,52,47,0.35)', borderRadius:2 }}/> <span className="txt-sm">critical</span>
        <span style={{ width:12, height:12, background:'rgba(196,169,98,0.35)', borderRadius:2 }}/> <span className="txt-sm">elevated</span>
        <span style={{ width:12, height:12, background:'rgba(63,124,92,0.25)', borderRadius:2 }}/> <span className="txt-sm">low</span>
      </div>
    </div>
  );
};

// ---- risk drawer ----
const RiskDrawer = ({ risk, role, onClose, onToggleFlag, onStatus }) => {
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e=>e.stopPropagation()} style={{ width: 720 }}>
        <div className="drawer-header">
          <div>
            <div className="txt-sm txt-muted">Risk · {risk.id} · {risk.cat}</div>
            <h2 style={{ margin:'4px 0 0', fontFamily:'var(--font-serif)', fontWeight:400, fontSize:20 }}>{risk.title}</h2>
          </div>
          <Btn sm ghost onClick={onClose}>✕</Btn>
        </div>
        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          <div className="grid g3" style={{ marginBottom:14 }}>
            <div className="card kpi"><div className="label">Severity</div><div className="value" style={{ color:`var(--${sevTone(risk.sev)})` }}>{risk.sev}</div><div className="sub">{SEV_LABELS[risk.sev]}</div></div>
            <div className="card kpi"><div className="label">Likelihood</div><div className="value">{risk.lik}</div><div className="sub">{LIK_LABELS[risk.lik]}</div></div>
            <div className="card kpi"><div className="label">Score</div><div className="value" style={{ color:`var(--${sevTone(risk.sev)})` }}>{riskScore(risk)}</div><div className="sub">of 25</div></div>
          </div>

          <div className="card">
            <div className="card-header"><h3>Details</h3></div>
            <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <div className="field"><label>Owner</label><div className="v"><Avatar size={22}>{risk.owner}</Avatar> {risk.owner}</div></div>
              <div className="field"><label>Category</label><div className="v">{risk.cat}</div></div>
              <div className="field"><label>Status</label><div className="v">
                <select value={risk.status} onChange={e=>onStatus(e.target.value)}>
                  <option value="open">Open</option><option value="mitigated">Mitigated</option><option value="accepted">Accepted</option><option value="closed">Closed</option>
                </select>
              </div></div>
              <div className="field"><label>Age</label><div className="v">{risk.age}</div></div>
              <div className="field" style={{ gridColumn:'1/-1' }}><label>Mitigation / action</label><div className="v"><textarea defaultValue={risk.mitigation} rows={2} style={{ width:'100%', padding:8, border:'1px solid var(--border)', borderRadius:4, fontFamily:'inherit' }}/></div></div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3>Sign-off</h3><Badge tone={risk.needsSignoff?'red':''} dot>{risk.needsSignoff?'in approvals queue':'not flagged'}</Badge></div>
            <div className="card-body">
              <div className="row-spread">
                <div>
                  <div style={{ fontWeight:500, fontSize:13 }}>Require Managing Partner sign-off</div>
                  <div className="txt-sm txt-muted">{risk.sev>=4 ? 'Auto-flagged because severity ≥ High (4)' : 'Manually flag to request partner acknowledgement'}</div>
                </div>
                <button onClick={onToggleFlag} disabled={risk.sev>=4} style={{ padding:'6px 12px', borderRadius:6, border:'1px solid var(--border)', background: risk.needsSignoff?'var(--brand)':'var(--bg)', color: risk.needsSignoff?'#fff':'var(--text)', cursor: risk.sev>=4?'not-allowed':'pointer', opacity: risk.sev>=4?0.6:1 }}>
                  {risk.needsSignoff?'Flagged':'Flag for sign-off'}
                </button>
              </div>
              {risk.sev>=4 && <Callout tone="warn" style={{ marginTop:10 }}><span className="txt-sm">High-severity items cannot be unflagged — mitigate or downgrade severity instead.</span></Callout>}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3>Activity</h3></div>
            <div className="list">
              {[
                ['2d','MB','Status set to open · flagged for sign-off'],
                ['3d','MB','Mitigation plan logged'],
                ['4d','CC','Risk logged from weekly review'],
              ].map((a,i)=>(
                <div key={i} className="list-item" style={{ alignItems:'flex-start' }}>
                  <div style={{ width:40, fontSize:11, color:'var(--text-3)', fontFamily:'var(--font-mono)' }}>{a[0]}</div>
                  <Avatar size={22}>{a[1]}</Avatar>
                  <div className="main txt-sm">{a[2]}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="drawer-footer" style={{ borderTop:'1px solid var(--border)', padding:'12px 20px', display:'flex', gap:8, justifyContent:'flex-end' }}>
          <Btn sm ghost>Delete</Btn>
          <Btn sm>Save</Btn>
          <Btn sm primary onClick={()=>onStatus('mitigated')}>Mark mitigated</Btn>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { ProjectSettingsTab, ProjectRisksTab, RISK_SEED });
