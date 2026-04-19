// ============ MANAGER (PM) DASHBOARD ============
// Project manager view: all projects they lead, operational QC focus, drill into any

const ManagerHome = () => {
  const go = (id, opts) => window.__nav && window.__nav(id, opts);
  const [filter, setFilter] = React.useState('mine');
  // [code, client, name, stage, value, team, progress, lead, health, weeks, status, exp%, margin%, ar, deliverables, risks]
  const pmProjects = [
    ['IFM001','IFM Pharma','Diligence Strategy','active','$600k',['MB','CC','JB','AP'],62,'MB','green','wk 7/12','on track',48,32,'$120k','3/6 due','timesheet lag JB'],
    ['PNC001','Panacea','Market Entry','active','$780k',['TT','MB','AP','CC'],45,'MB','amber','wk 7/16','scope creep',54,24,'$160k','2/8 due','expert costs over'],
    ['IFM002','IFM Pharma','Commercial ext.','delivery','$280k',['MB','CC'],85,'MB','green','wk 5/6','wrapping',42,34,'$0','5/6 delivered','final QC Thu'],
  ];
  const allProjects = pmProjects; // in a real build, would filter by pm===userCode
  const data = filter==='mine' ? allProjects : allProjects;

  return (<>
    <div className="row" style={{ marginBottom:14, gap:12, flexWrap:'wrap' }}>
      <div>
        <div className="txt-sm txt-muted">Project manager · MB · 3 projects led · FY26 Q3</div>
        <h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, margin:'2px 0 0' }}>Manager dashboard</h2>
      </div>
      <div className="ml-auto row gap-sm">
        <div className="role-switcher">
          {[['mine','My projects'],['all','All firm']].map(([k,l])=>(<button key={k} className={filter===k?'active':''} onClick={()=>setFilter(k)}>{l}</button>))}
        </div>
        <Btn sm icon="filter">Filter</Btn>
        <Btn sm primary icon="plus">New activity</Btn>
      </div>
    </div>

    <div className="grid g4" style={{ marginBottom:14 }}>
      <div className="kpi" style={{ cursor:'pointer' }} onClick={()=>go('projects')}><div className="label">Projects led</div><div className="value">3</div><div className="sub">2 active · 1 wrapping</div></div>
      <div className="kpi" style={{ cursor:'pointer' }} onClick={()=>go('resource')}><div className="label">Team utilisation</div><div className="value">78%</div><div className="sub" style={{ color:'var(--green)' }}>above target 75%</div></div>
      <div className="kpi" style={{ cursor:'pointer' }} onClick={()=>go('approvals')}><div className="label">Open risks</div><div className="value" style={{ color:'var(--amber)' }}>4</div><div className="sub">1 margin · 2 delivery · 1 timesheet</div></div>
      <div className="kpi" style={{ cursor:'pointer' }} onClick={()=>go('projects')}><div className="label">Avg margin</div><div className="value">30%</div><div className="sub" style={{ color:'var(--amber)' }}>target 30%+</div></div>
    </div>

    <div className="grid g-main-side">
      <div className="stack">

        {/* Operational QC per project */}
        <div className="card">
          <div className="card-header"><h3>Operational QC · all my projects</h3><div className="txt-sm txt-muted">financial + delivery + team health, at a glance</div></div>
          <div className="card-body" style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {data.map(p => {
              const [code, client, name, stage, value, team, prog, lead, health, weeks, status, expPct, margin, ar, deliv, risk] = p;
              const healthColor = health==='green'?'var(--green)':health==='amber'?'var(--amber)':'var(--red)';
              return (
                <div key={code} style={{ border:'1px solid var(--border)', borderRadius:8, padding:14, cursor:'pointer' }} onClick={()=>go('projects', { projectCode: code })}>
                  <div className="row" style={{ alignItems:'flex-start', gap:14, flexWrap:'wrap' }}>
                    <div style={{ flex:'1 1 260px' }}>
                      <div className="row gap-sm" style={{ marginBottom:2 }}>
                        <span style={{ fontFamily:'var(--font-mono)', fontSize:12, fontWeight:600, background:'var(--bg-subtle)', padding:'2px 7px', borderRadius:4 }}>{code}</span>
                        <b>{client}</b>
                        <Badge tone={stage==='active'?'blue':stage==='delivery'?'amber':undefined}>{stage}</Badge>
                        <div style={{ width:8, height:8, borderRadius:'50%', background:healthColor }}/>
                      </div>
                      <div className="txt-sm">{name}</div>
                      <div className="txt-sm txt-muted" style={{ fontSize:11 }}>{weeks} · lead MB · team {team.join(', ')}</div>
                    </div>

                    <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 90px)', gap:10 }}>
                      <div><div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em' }}>Progress</div><div style={{ fontFamily:'var(--font-mono)', fontWeight:600 }}>{prog}%</div></div>
                      <div><div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em' }}>Expense</div><div style={{ fontFamily:'var(--font-mono)', fontWeight:600, color: expPct>50?'var(--red)':expPct>45?'var(--amber)':'var(--green)' }}>{expPct}%</div></div>
                      <div><div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em' }}>Margin</div><div style={{ fontFamily:'var(--font-mono)', fontWeight:600, color: margin<30?'var(--amber)':'var(--green)' }}>{margin}%</div></div>
                      <div><div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em' }}>AR</div><div style={{ fontFamily:'var(--font-mono)', fontWeight:600 }}>{ar}</div></div>
                    </div>

                    <div style={{ flex:'0 0 auto' }}>
                      <div className="row gap-sm" onClick={e=>e.stopPropagation()}><Btn sm icon="check" onClick={()=>go('approvals')}>QC</Btn><Btn sm ghost onClick={()=>go('projects', { projectCode: code })}>Open →</Btn></div>
                    </div>
                  </div>

                  <div style={{ background:'var(--bg-subtle)', height:4, borderRadius:2, overflow:'hidden', margin:'10px 0' }}>
                    <div style={{ width:`${prog}%`, height:'100%', background:'var(--brand)' }}/>
                  </div>

                  <div className="row gap-sm" style={{ flexWrap:'wrap', fontSize:11.5, color:'var(--text-2)' }}>
                    <span style={{ padding:'2px 8px', background:'var(--bg-subtle)', borderRadius:4 }}>📦 {deliv}</span>
                    <span style={{ padding:'2px 8px', background: risk.length?'var(--amber-soft)':'var(--bg-subtle)', borderRadius:4, color: risk.length?'var(--amber)':undefined }}>⚠ {risk || 'no risks'}</span>
                    <span style={{ padding:'2px 8px', background:'var(--bg-subtle)', borderRadius:4 }}>{status}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Team / staffing */}
        <div className="card">
          <div className="card-header"><h3>Team across my projects · this week</h3><Btn sm icon="calendar" onClick={()=>go('resource')}>Staffing grid</Btn></div>
          <table className="tbl">
            <thead><tr><th>Member</th><th>Role</th><th>IFM001</th><th>PNC001</th><th>IFM002</th><th className="num">This wk</th><th className="num">Util</th><th>TS status</th></tr></thead>
            <tbody>
              {[
                ['MB','Partner·lead','20h','14h','6h','40h','100%','submitted','green'],
                ['CC','Consultant','18h','14h','0h','32h','80%','submitted','green'],
                ['JB','Analyst','24h','0h','0h','24h','60%','2 days missing','amber'],
                ['AP','Assoc · contractor','0h','16h','0h','16h','40%','submitted','green'],
              ].map((r,i)=>(
                <tr key={i}>
                  <td><div className="row gap-sm"><Avatar>{r[0]}</Avatar><b>{r[0]}</b></div></td>
                  <td className="txt-sm">{r[1]}</td>
                  <td className="num mono">{r[2]}</td>
                  <td className="num mono">{r[3]}</td>
                  <td className="num mono">{r[4]}</td>
                  <td className="num"><b>{r[5]}</b></td>
                  <td className="num"><span style={{ color: parseInt(r[6])>=75?'var(--green)':'var(--amber)' }}>{r[6]}</span></td>
                  <td><Badge tone={r[8]} dot>{r[7]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* QC queue */}
        <div className="card">
          <div className="card-header"><h3>QC queue</h3><div className="txt-sm txt-muted">items needing manager review · across my projects</div></div>
          <table className="tbl">
            <thead><tr><th>Item</th><th>Project</th><th>Raised by</th><th>Type</th><th>Value/impact</th><th>Age</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {[
                ['Expert invoice · A.Lee','PNC001','JS','Sub-contractor','$4,200','1d','needs approval','amber'],
                ['Slide pack · mid-review','IFM001','MB','Deliverable','milestone 2','3h','peer review','blue'],
                ['Timesheet gap · JB 2 days','IFM001','system','Compliance','2 days','2d','action required','red'],
                ['Scope change · PNC001','PNC001','TT','Scope','+$60k','1d','client confirmed','green'],
                ['Invoice 2 · IFM001 ready','IFM001','JS','Billing','$240k','—','ready to send','blue'],
                ['Expense · $318 M&E','PNC001','CC','Expense','missing receipt','5h','blocked','red'],
              ].map((r,i)=>(
                <tr key={i}>
                  <td><b className="txt-sm">{r[0]}</b></td>
                  <td className="code-cell">{r[1]}</td>
                  <td><Avatar size={22}>{r[2]}</Avatar></td>
                  <td><Badge>{r[3]}</Badge></td>
                  <td className="txt-sm mono">{r[4]}</td>
                  <td className="txt-sm txt-muted">{r[5]}</td>
                  <td><Badge tone={r[7]} dot>{r[6]}</Badge></td>
                  <td><div className="row gap-sm"><Btn sm onClick={()=>go('approvals')}>Review</Btn></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <div className="card-header"><h3>Firm overview</h3><Badge>all projects</Badge></div>
          <div className="card-body">
            <BarRow label="Projects in delivery" pct={71} val="5/7"/>
            <BarRow label="On-track %" pct={71} val="5/7" tone="green"/>
            <BarRow label="At-risk (amber)" pct={28} val="2/7" tone="accent"/>
            <BarRow label="Off-track (red)" pct={0} val="0" tone="blue"/>
            <div className="hdiv"/>
            <div className="row-spread"><span className="txt-sm txt-muted">Avg expense ratio</span><b className="mono">47%</b></div>
            <div className="row-spread"><span className="txt-sm txt-muted">Avg margin</span><b className="mono" style={{ color:'var(--green)' }}>32%</b></div>
            <div className="row-spread"><span className="txt-sm txt-muted">Firm utilisation</span><b className="mono">76%</b></div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>This week</h3></div>
          <div className="list">
            {[['Mon','IFM001 team standup','09:00'],['Mon','PNC001 expert intake','14:00'],['Tue','IFM001 client update','10:00'],['Wed','IFM002 final QC','—'],['Thu','Invoice 2 send · IFM001','—'],['Fri','Timesheet lock','17:00']].map((r,i)=>(
              <div key={i} className="list-item"><div className="main"><b className="txt-sm">{r[0]}</b> · <span className="txt-sm">{r[1]}</span></div><div className="right txt-sm txt-muted mono">{r[2]}</div></div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>Alerts</h3></div>
          <div className="card-body" style={{ display:'flex', flexDirection:'column', gap:8 }}>
            <div style={{ padding:10, background:'var(--red-soft)', borderRadius:6, fontSize:12, border:'1px solid rgba(180,63,63,.2)' }}><b>PNC001</b> expense ratio 54% — above 50% target. <Btn sm style={{ marginTop:6 }} onClick={()=>go('projects', { projectCode:'PNC001' })}>Open P&L</Btn></div>
            <div style={{ padding:10, background:'var(--amber-soft)', borderRadius:6, fontSize:12, border:'1px solid rgba(180,124,63,.2)' }}><b>JB</b> missing 2 days timesheet on IFM001. <Btn sm style={{ marginTop:6 }} onClick={()=>go('approvals')}>Nudge</Btn></div>
            <div style={{ padding:10, background:'var(--accent-soft)', borderRadius:6, fontSize:12, cursor:'pointer' }} onClick={()=>go('trueup')}>Partner true-up Q3 closes 30 Apr — log firm-building hours.</div>
          </div>
        </div>
      </div>
    </div>
  </>);
};
