// ============ PARTNER TRUE-UP ENGINE ============

const TrueUp = () => {
  const [q, setQ] = React.useState('Q3');
  const [sel, setSel] = React.useState('MB');
  const [drawer, setDrawer] = React.useState(null);
  const partners = [
    // [code, name, role, perDiem, projectShare, bdReferral, compBuild, ownership, proposed, status]
    ['TT','Managing partner','FT Partner',  '$186k', '$42k', '$8k',  '$28k', '$30k', '$294k', 'signed'],
    ['MB','Partner · Strategy','FT Partner','$148k', '$36k', '$14k', '$16k', '$18k', '$232k', 'disputed'],
    ['SR','Assoc partner','PT Partner',     '$102k', '$24k', '$6k',  '$4k',  '$6k',  '$142k', 'pending'],
    ['AP','Associate','Contractor',         '$62k',  '$19k', '$18k', '—',    '—',    '$99k',  'signed'],
  ];
  const statusTone = { signed:'green', disputed:'red', pending:'amber' };

  const partner = partners.find(p=>p[0]===sel) || partners[1];
  const effort = [
    ['BD effort', 'Led 2 pitches · 1 warm intro · 1 co-sell', 'GNC002, NXS001', 28, 22],
    ['Company-building', 'Hiring (2 FT), MSA refresh, FinXL audit coord', '16 days logged', 20, 16],
    ['Ownership / stewardship', 'P&L review, partner cadence, culture', 'quarterly avg', 14, 10],
  ];

  return (<>
    <div className="row" style={{ marginBottom:14, gap:12, flexWrap:'wrap' }}>
      <div>
        <h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, margin:0 }}>Partner true-up</h2>
        <div className="txt-sm txt-muted">Quarterly reconciliation · profit pool 15% = <b>$87,400</b> · reconciled from <span className="mono">Profit-pool.xlsx</span></div>
      </div>
      <div className="ml-auto row gap-sm">
        <div className="role-switcher">
          {['Q1','Q2','Q3','Q4'].map(k=>(<button key={k} className={q===k?'active':''} onClick={()=>setQ(k)}>{k} FY26</button>))}
        </div>
        <Btn sm icon="download">Export PDF</Btn>
        <Btn sm primary icon="check">Propose split</Btn>
      </div>
    </div>

    <div className="grid g4" style={{ marginBottom:14 }}>
      <div className="kpi"><div className="label">Net revenue Q3</div><div className="value">$582k</div><div className="sub">OPEX 20% · firm 15%</div></div>
      <div className="kpi"><div className="label">Profit pool</div><div className="value">$87.4k</div><div className="sub" style={{ color:'var(--green)' }}>reserved · not distributed</div></div>
      <div className="kpi"><div className="label">Per-diem base paid</div><div className="value">$498k</div><div className="sub">reconciled from Timesheet.xlsx</div></div>
      <div className="kpi"><div className="label">Disputes</div><div className="value" style={{ color:'var(--red)' }}>1</div><div className="sub">MB flagged BD weighting</div></div>
    </div>

    <div className="grid g-main-side">
      <div className="stack">
        <div className="card">
          <div className="card-header">
            <h3>Reconciliation · all partners</h3>
            <div className="txt-sm txt-muted">base + project share + BD + firm-building + ownership</div>
          </div>
          <table className="tbl">
            <thead><tr><th>Partner</th><th>Role</th><th className="num">Per-diem base</th><th className="num">Project share</th><th className="num">BD referral</th><th className="num">Firm-build</th><th className="num">Ownership</th><th className="num">Proposed</th><th>Status</th></tr></thead>
            <tbody>
              {partners.map(p=>(
                <tr key={p[0]} onClick={()=>setSel(p[0])} style={{ cursor:'pointer', background: sel===p[0]?'var(--accent-soft)':undefined }}>
                  <td><div className="row gap-sm"><Avatar>{p[0]}</Avatar><b>{p[0]}</b> {sel===p[0] && <Btn sm ghost onClick={e=>{ e.stopPropagation(); setDrawer(p); }}>details →</Btn>}</div></td>
                  <td className="txt-sm">{p[2]}</td>
                  <td className="num">{p[3]}</td>
                  <td className="num">{p[4]}</td>
                  <td className="num">{p[5]}</td>
                  <td className="num">{p[6]}</td>
                  <td className="num">{p[7]}</td>
                  <td className="num"><b>{p[8]}</b></td>
                  <td><Badge tone={statusTone[p[9]]} dot>{p[9]}</Badge></td>
                </tr>
              ))}
              <tr className="total-row" style={{ background:'var(--brand-ink)', color:'#fff' }}>
                <td style={{ color:'#fff' }}><b>Totals</b></td><td/><td className="num" style={{ color:'#fff' }}>$498k</td><td className="num" style={{ color:'#fff' }}>$121k</td><td className="num" style={{ color:'#fff' }}>$46k</td><td className="num" style={{ color:'#fff' }}>$48k</td><td className="num" style={{ color:'#fff' }}>$54k</td><td className="num" style={{ color:'#fff' }}><b>$767k</b></td><td/>
              </tr>
            </tbody>
          </table>
          <div className="card-body">
            <Callout tone="info" title="How this is computed">
              <span className="txt-sm">Per-diem base pulls from <span className="mono">Timesheet.xlsx</span>. Project share comes from each project's post-OPEX, post-margin residual (LT share). BD referral uses the Referral Framework (5/10% external, 2–5% internal, capped). Firm-building + ownership are weighted from logged company-task hours and partner self-ratings, reviewed by 2 other partners.</span>
            </Callout>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>{partner[0]} · effort breakdown this quarter</h3><Badge tone={statusTone[partner[9]]} dot>{partner[9]}</Badge></div>
          <div className="card-body">
            <div style={{ display:'grid', gridTemplateColumns:'140px 1fr 120px 110px 120px', gap:12, fontSize:11, fontWeight:600, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'.06em', paddingBottom:8, borderBottom:'1px solid var(--border)' }}>
              <div>Category</div><div>Evidence</div><div>Reference</div><div className="num">Claimed %</div><div className="num">Agreed %</div>
            </div>
            {effort.map((e,i)=>(
              <div key={i} style={{ display:'grid', gridTemplateColumns:'140px 1fr 120px 110px 120px', gap:12, padding:'12px 0', borderBottom:'1px solid var(--divider)', alignItems:'center' }}>
                <div><b>{e[0]}</b></div>
                <div className="txt-sm">{e[1]}</div>
                <div className="txt-sm mono" style={{ color:'var(--text-3)' }}>{e[2]}</div>
                <div className="num mono">{e[3]}%</div>
                <div className="num" style={{ color: e[3]!==e[4] ? 'var(--red)' : 'var(--green)' }}>
                  <b>{e[4]}%</b> {e[3]!==e[4] && <span className="txt-sm txt-muted"> ({e[3]-e[4]>0?'-':'+'}{Math.abs(e[3]-e[4])})</span>}
                </div>
              </div>
            ))}
            {partner[9]==='disputed' && (
              <Callout tone="warn" title="Dispute raised by MB">
                <span className="txt-sm">"BD weighting underweights co-sell time on NXS001 — requesting re-review by TT + SR."</span>
                <div className="row gap-sm" style={{ marginTop:8 }}>
                  <Btn sm>Re-weight</Btn><Btn sm>Accept as-is</Btn><Btn sm primary>Open partner review</Btn>
                </div>
              </Callout>
            )}
          </div>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <div className="card-header"><h3>Allocation waterfall</h3></div>
          <div className="card-body">
            {[
              ['Gross net revenue','$582k',100,'var(--text)'],
              ['− OPEX 20% (fixed)','-$116k',20,'var(--text-3)'],
              ['− Firm margin 15% (retained)','-$87k',15,'var(--amber)'],
              ['= Profit pool to allocate','$87k',15,'var(--green)'],
              ['− Base reconciliation (per-diem)','-$498k',null,'var(--text-3)'],
              ['+ Project LT share (residual)','$121k',null,'var(--blue)'],
              ['+ BD referrals','$46k',null,'var(--blue)'],
            ].map((r,i)=>(
              <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid var(--divider)', fontSize:13 }}>
                <span style={{ color:r[3] }}>{r[0]}</span>
                <b className="mono" style={{ color:r[3] }}>{r[1]}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>Sign-off</h3></div>
          <div className="card-body" style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {partners.map(p=>(
              <div key={p[0]} className="row gap-sm" style={{ justifyContent:'space-between' }}>
                <div className="row gap-sm"><Avatar size={22}>{p[0]}</Avatar><b className="txt-sm">{p[0]}</b></div>
                <Badge tone={statusTone[p[9]]} dot>{p[9]}</Badge>
              </div>
            ))}
            <div className="hdiv"/>
            <div className="txt-sm txt-muted">Quarterly true-up requires all partners to sign. Disputes trigger a 2-partner review. Locked reports are archived to <span className="mono">Profit-pool.xlsx</span>.</div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>History</h3></div>
          <div className="list">
            {[['Q2 FY26','$74k pool · 4 signed'],['Q1 FY26','$62k pool · 4 signed'],['Q4 FY25','$48k pool · 3 signed · 1 disputed']].map((r,i)=>(
              <div key={i} className="list-item"><div className="main">{r[0]}</div><div className="right txt-sm txt-muted">{r[1]}</div></div>
            ))}
          </div>
        </div>
      </div>
    </div>
    {drawer && window.TrueUpPartnerDrawer && <window.TrueUpPartnerDrawer p={drawer} onClose={()=>setDrawer(null)}/>}
  </>);
};

// ============ CONVERT BD DEAL → PROJECT MODAL ============
const ConvertBDModal = ({ deal, onClose }) => {
  if (!deal) return null;
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(14,12,10,.55)', zIndex:80, display:'flex', alignItems:'center', justifyContent:'center', padding:40 }} onClick={onClose}>
      <div className="card" style={{ maxWidth:760, width:'100%' }} onClick={e=>e.stopPropagation()}>
        <div className="card-header">
          <div>
            <div className="txt-sm txt-muted">Convert BD deal → Project</div>
            <h3 style={{ margin:'2px 0 0' }}>{deal.client} · {deal.name}</h3>
          </div>
          <Btn sm ghost onClick={onClose}>✕</Btn>
        </div>
        <div className="card-body">
          <div className="txt-sm txt-muted" style={{ marginBottom:10 }}>Stage: <Badge tone="amber" dot>{deal.stage}</Badge> — confirming this will spawn a project code, contract draft, first invoice schedule, and staffing plan. All data lands in Finance.xlsx, Pipeline.xlsx, and Timesheet.xlsx simultaneously.</div>

          <div className="grid g2" style={{ gap:14 }}>
            <div>
              <div className="txt-sm" style={{ fontWeight:600, marginBottom:6 }}>1 · Project code</div>
              <div style={{ background:'var(--bg-subtle)', padding:'8px 12px', borderRadius:6, fontFamily:'var(--font-mono)', fontSize:14, fontWeight:600 }}>{deal.suggestedCode}</div>
              <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:4 }}>auto-generated · next in client sequence</div>
            </div>
            <div>
              <div className="txt-sm" style={{ fontWeight:600, marginBottom:6 }}>2 · Contract value</div>
              <div style={{ background:'var(--bg-subtle)', padding:'8px 12px', borderRadius:6, fontFamily:'var(--font-mono)', fontSize:14, fontWeight:600 }}>{deal.value}</div>
              <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:4 }}>carried from pipeline · editable</div>
            </div>
            <div>
              <div className="txt-sm" style={{ fontWeight:600, marginBottom:6 }}>3 · Team (proposed)</div>
              <div className="row gap-sm">
                {deal.team.map((t,i)=>(<div key={i} className="row gap-sm" style={{ padding:'4px 8px', background:'var(--bg-subtle)', borderRadius:14 }}><Avatar size={20}>{t}</Avatar><span className="txt-sm">{t}</span></div>))}
              </div>
            </div>
            <div>
              <div className="txt-sm" style={{ fontWeight:600, marginBottom:6 }}>4 · Invoice schedule</div>
              <div className="txt-sm">3 milestones · 40% / 30% / 30%</div>
              <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:4 }}>default for {deal.type} · change in wizard</div>
            </div>
            <div>
              <div className="txt-sm" style={{ fontWeight:600, marginBottom:6 }}>5 · Referral</div>
              <div className="txt-sm">{deal.referral || 'None'}</div>
              <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:4 }}>will accrue on first invoice</div>
            </div>
            <div>
              <div className="txt-sm" style={{ fontWeight:600, marginBottom:6 }}>6 · Documents</div>
              <div className="txt-sm">SOW draft · MSA check · kickoff deck</div>
              <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:4 }}>from Word templates</div>
            </div>
          </div>

          <Callout tone="info" title="What happens on confirm">
            <div className="txt-sm" style={{ lineHeight:1.6 }}>
              → New row in <span className="mono">Finance.xlsx · Projects</span><br/>
              → Pipeline card moves to <b>Won</b>, archived<br/>
              → Contract draft generated in <span className="mono">Contracts/</span><br/>
              → Team members receive onboarding in Timesheet portal<br/>
              → Referral accrual queued (unpaid until invoice 1 receipt)
            </div>
          </Callout>

          <div className="row gap-sm" style={{ marginTop:14, justifyContent:'flex-end' }}>
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn>Customise in wizard</Btn>
            <Btn primary>Confirm & spawn project</Btn>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============ CONSULTANT PORTAL ============

const ConsultantHome = () => {
  const go = (id, opts) => window.__nav && window.__nav(id, opts);
  return (<>
    <div className="row" style={{ marginBottom:14, flexWrap:'wrap', gap:10 }}>
      <div>
        <div className="txt-sm txt-muted">Welcome back, CC · week 16 · FY26</div>
        <h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, margin:'2px 0 0' }}>My week</h2>
      </div>
      <div className="ml-auto row gap-sm">
        <Btn sm icon="clock" onClick={()=>go('timesheet')}>Log time</Btn>
        <Btn sm icon="receipt" onClick={()=>go('expenses')}>New expense</Btn>
        <Btn sm primary icon="plus" onClick={()=>go('timesheet')}>Quick log</Btn>
      </div>
    </div>

    <div className="grid g4" style={{ marginBottom:14 }}>
      <div className="kpi" style={{ cursor:'pointer' }} onClick={()=>go('timesheet')}><div className="label">Hours this week</div><div className="value">32.5</div><div className="sub" style={{ color:'var(--green)' }}>on track · 40 target</div></div>
      <div className="kpi"><div className="label">Utilisation MTD</div><div className="value">84%</div><div className="sub" style={{ color:'var(--green)' }}>↑ 6pt vs last mo</div></div>
      <div className="kpi" style={{ cursor:'pointer' }} onClick={()=>go('timesheet')}><div className="label">Timesheet status</div><div className="value" style={{ color:'var(--amber)' }}>2 days</div><div className="sub">due Fri · 2 missing</div></div>
      <div className="kpi" style={{ cursor:'pointer' }} onClick={()=>go('expenses')}><div className="label">Expenses unfiled</div><div className="value">3</div><div className="sub">2 receipts · $318</div></div>
    </div>

    <div className="grid g-main-side">
      <div className="stack">
        <div className="card">
          <div className="card-header"><h3>Active projects</h3><div className="txt-sm txt-muted">2 assigned · this week</div></div>
          <div className="card-body" style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {[
              ['IFM001','IFM Pharma','Diligence Strategy','MB', 18, 24, 'wk 7/12', 'Slide review Thu'],
              ['PNC001','Panacea','Market Entry','TT', 14.5, 16, 'wk 7/16', 'Interview prep Wed'],
            ].map(p=>(
              <div key={p[0]} style={{ border:'1px solid var(--border)', borderRadius:8, padding:14, display:'grid', gridTemplateColumns:'1fr auto auto auto', gap:16, alignItems:'center', cursor:'pointer' }} onClick={()=>go('projects', { projectCode: p[0] })}>
                <div>
                  <div className="row gap-sm" style={{ marginBottom:2 }}><span style={{ fontFamily:'var(--font-mono)', fontSize:12, fontWeight:600 }}>{p[0]}</span><b className="txt-sm">{p[1]}</b></div>
                  <div className="txt-sm">{p[2]}</div>
                  <div className="txt-sm txt-muted" style={{ fontSize:11 }}>lead {p[3]} · {p[6]} · next: {p[7]}</div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em' }}>this week</div>
                  <div style={{ fontFamily:'var(--font-mono)', fontWeight:600 }}>{p[4]}h / {p[5]}h</div>
                </div>
                <div style={{ width:100, background:'var(--bg-subtle)', height:4, borderRadius:2, overflow:'hidden' }}>
                  <div style={{ width:`${p[4]/p[5]*100}%`, height:'100%', background: p[4]>=p[5]?'var(--amber)':'var(--brand)' }}/>
                </div>
                <div className="row gap-sm" onClick={e=>e.stopPropagation()}>
                  <Btn sm icon="clock" onClick={()=>go('timesheet')}>Log</Btn>
                  <Btn sm ghost onClick={()=>go('projects', { projectCode: p[0] })}>Open</Btn>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>Quick timesheet · this week</h3><div className="row gap-sm"><Btn sm icon="calendar">Import from calendar</Btn><Btn sm primary onClick={()=>go('timesheet')}>Submit week</Btn></div></div>
          <div style={{ padding:'8px 18px 16px' }}>
            <table className="ts-grid">
              <thead><tr><th className="proj-cell" style={{ textAlign:'left' }}>Project</th>{['Mon 14','Tue 15','Wed 16','Thu 17','Fri 18','Sat','Sun'].map((d,i)=>(<th key={i} className="day-col"><span className="date">{d}</span></th>))}<th>Total</th></tr></thead>
              <tbody>
                {[
                  ['IFM001','IFM · Diligence',[8,7,7,8,6,0,0]],
                  ['PNC001','Panacea · Market',[4,5,4,3,4,0,0]],
                  ['OPEX','Firm · learning',[0,0,0,0,2,0,0]],
                ].map((r,i)=>{
                  const total = r[2].reduce((a,b)=>a+b,0);
                  return (
                    <tr key={i}>
                      <td className="proj-cell"><div className="nm"><span className="tag">{r[0]}</span>{r[1]}</div></td>
                      {r[2].map((h,j)=>(<td key={j} className={j>=5?'weekend':''}><input defaultValue={h||''}/></td>))}
                      <td className="total-cell">{total}</td>
                    </tr>
                  );
                })}
                <tr className="total-row"><td className="proj-cell">Day total</td>{[12,12,11,11,12,0,0].map((h,j)=>(<td key={j}>{h}</td>))}<td>58</td></tr>
              </tbody>
            </table>
            <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:8 }}>Saves live to <span className="mono">Timesheet.xlsx</span> · submit locks the week for approval</div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>My expenses · pending</h3><Btn sm icon="plus" onClick={()=>go('expenses')}>Add</Btn></div>
          <table className="tbl">
            <thead><tr><th>Date</th><th>Merchant</th><th>Project</th><th>Category</th><th className="num">Amount</th><th>Receipt</th><th>Status</th></tr></thead>
            <tbody>
              {[
                ['14 Apr','Qantas · SYD→MEL','IFM001','Travel','$418','✓','pending','amber'],
                ['15 Apr','Ovolo Hotel','IFM001','Accom','$240','✓','pending','amber'],
                ['16 Apr','Client dinner · 4 pax','PNC001','M&E','$318','—','needs receipt','red'],
              ].map((r,i)=>(
                <tr key={i} style={{ cursor:'pointer' }} onClick={()=>go('projects', { projectCode: r[2], tab:'exp' })}>
                  <td className="txt-sm">{r[0]}</td><td>{r[1]}</td><td className="code-cell">{r[2]}</td><td><Badge>{r[3]}</Badge></td><td className="num"><b>{r[4]}</b></td><td>{r[5]}</td><td><Badge tone={r[7]} dot>{r[6]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <div className="card-header"><h3>Upcoming (next 2 wks)</h3></div>
          <div className="list">
            {[['Mon 21','IFM001 kickoff II','10:00'],['Tue 22','PNC001 expert call','14:30'],['Wed 23','IFM001 slide review','09:00'],['Fri 25','Timesheet lock','17:00'],['Mon 28','Team offsite · OPEX','—'],['Thu 1 May','Invoice 2 IFM001','—']].map((r,i)=>(
              <div key={i} className="list-item"><div className="main"><b className="txt-sm">{r[0]}</b> · <span className="txt-sm">{r[1]}</span></div><div className="right txt-sm txt-muted mono">{r[2]}</div></div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>My YTD</h3></div>
          <div className="card-body">
            <BarRow label="Utilisation" pct={84} val="84% · target 75%+"/>
            <BarRow label="IFM001" pct={52} val="420h"/>
            <BarRow label="PNC001" pct={32} val="260h" tone="blue"/>
            <BarRow label="BMX001" pct={12} val="96h" tone="green"/>
            <BarRow label="Firm / OPEX" pct={6} val="48h" tone="accent"/>
            <div className="hdiv"/>
            <div className="row-spread"><span className="txt-sm txt-muted">Base YTD</span><b className="mono">$64,800</b></div>
            <div className="row-spread"><span className="txt-sm txt-muted">Bonus accrued</span><b className="mono">$4,200</b></div>
            <div className="row-spread"><span className="txt-sm txt-muted">Expenses reimbursed</span><b className="mono">$2,140</b></div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>Announcements</h3></div>
          <div className="card-body" style={{ display:'flex', flexDirection:'column', gap:8 }}>
            <div style={{ padding:10, background:'var(--accent-soft)', borderRadius:6, fontSize:12, cursor:'pointer' }} onClick={()=>go('trueup')}><b>Q3 true-up</b> closes 30 Apr. Log firm-building hours by 25 Apr.</div>
            <div style={{ padding:10, background:'var(--bg-subtle)', borderRadius:6, fontSize:12 }}><b>New template</b>: expense receipt scanner (beta).</div>
          </div>
        </div>
      </div>
    </div>
  </>);
};
