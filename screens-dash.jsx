// screens-1-nav-dashboard.jsx

// --- NAV VARIATIONS ---
const NavVariantSidebar = ({ cur, onNav }) => {
  const items = [
    { section: 'Analyze', rows: [
      { k: 'dashboard', label: '📊 Dashboard' },
      { k: 'reports', label: '📈 Reports' },
      { k: 'bd', label: '🎯 BD Pipeline' },
    ]},
    { section: 'Work', rows: [
      { k: 'projects', label: '📁 Projects', badge: '14' },
      { k: 'project-detail', label: '   └ IFM001 detail' },
      { k: 'timesheet', label: '⏱ Timesheets' },
      { k: 'invoices', label: '🧾 Invoices', badge: '6' },
      { k: 'expenses', label: '💳 Expenses' },
      { k: 'approvals', label: '✓ Approvals', badge: '3' },
    ]},
    { section: 'Data', rows: [
      { k: 'directories', label: '👥 Directory' },
      { k: 'templates', label: '📄 Templates' },
      { k: 'admin', label: '⚙ Admin & Excel Sync' },
      { k: 'wizard', label: '＋ New Project' },
    ]},
  ];
  return (
    <div className="sidebar" style={{ minHeight: 620 }}>
      {items.map(s => (
        <div key={s.section}>
          <h4>{s.section}</h4>
          <ul>
            {s.rows.map(r => (
              <li key={r.k} className={cur === r.k ? 'active' : ''} onClick={() => onNav && onNav(r.k)}>
                <span>{r.label}</span>
                {r.badge && <span className="count">{r.badge}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <PenLine />
      <div className="small" style={{ padding: '6px 4px' }}>
        <ExcelPill state="synced" /> <br/>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-faint)' }}>OneDrive/Foundry Finance.xlsx</span>
      </div>
    </div>
  );
};

const NavVariantTopTabs = () => (
  <div style={{ border: '1.5px solid var(--line)', borderRadius: 6, padding: 10, background: 'var(--paper)' }}>
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '2px solid var(--line)', paddingBottom: 8, marginBottom: 10 }}>
      {['Dashboard','Projects','BD Pipeline','Timesheets','Invoices','Expenses','Approvals','Directory','Reports','Templates','Admin'].map((t,i) => (
        <button key={i} className={`sketch-btn small ${i===0?'primary':''}`}>{t}</button>
      ))}
    </div>
    <div className="small" style={{ color: 'var(--ink-soft)' }}>
      Secondary tabs appear within each section →
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <span className="tag yellow">Overview</span>
        <span className="tag">Finance</span>
        <span className="tag">Team</span>
        <span className="tag">Activity</span>
      </div>
    </div>
  </div>
);

const NavVariantCommand = () => (
  <div style={{ border: '1.5px solid var(--line)', borderRadius: 6, padding: 14, background: 'var(--paper)', textAlign: 'center' }}>
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <h3 style={{ textAlign: 'left', marginBottom: 8 }}>⌘K — type anywhere</h3>
      <div style={{ border: '2px solid var(--line)', borderRadius: 6, padding: '10px 14px', textAlign: 'left', background: 'var(--paper-2)' }}>
        <span className="code" style={{ color: 'var(--accent-red)' }}>&gt;</span> <span style={{ fontFamily: 'var(--hand)', fontSize: 17 }}>IFM001 log expense|</span>
      </div>
      <div style={{ marginTop: 10, textAlign: 'left' }}>
        <div className="small" style={{ fontFamily: 'var(--mono)', textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 4 }}>Results</div>
        <div className="list-row"><span>📁 <b>IFM001</b> — Integrated Market Study</span><span className="small">go to project →</span></div>
        <div className="list-row"><span>💳 Log expense to <b>IFM001</b></span><span className="small">↵</span></div>
        <div className="list-row"><span>🧾 Upload invoice → <b>IFM001</b></span><span className="small">⇧↵</span></div>
        <div className="list-row"><span>📄 Generate draft invoice (Word) for IFM001</span><span className="small">⌥↵</span></div>
        <div className="list-row"><span>📊 Show IFM001 P&amp;L</span></div>
      </div>
      <div className="small" style={{ marginTop: 12 }}>Minimal chrome. Left rail shows only pinned/recent — everything reached by ⌘K.</div>
    </div>
  </div>
);

// --- DASHBOARD VARIATIONS ---
const DashKpiRow = () => (
  <div className="grid g5" style={{ marginBottom: 10 }}>
    <KPI label="FY26 REVENUE" value="$1.42M" sub="of $2.0M target · 71%" note="on track" />
    <KPI label="ACTIVE PROJECTS" value="7" sub="3 delivery · 2 close · 2 kickoff" />
    <KPI label="BD PIPELINE" value="$4.8M" sub="weighted $2.1M · 2.4× target" />
    <KPI label="OPEX BUFFER" value="$84K" sub="target 20% · tracking 18.6%" tone="alert" />
    <KPI label="UTILISATION" value="62%" sub="team avg · partners 41%" />
  </div>
);

const DashVariantA = () => (
  <>
    <DashKpiRow />
    <div className="grid g-2-1">
      <div className="sketch-box sketch-box-2">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h4>Revenue & margin · last 6 months</h4>
          <span className="small">vs 2M target ––––</span>
        </div>
        <div style={{ height: 180, position: 'relative', borderBottom: '1.5px solid var(--line)', borderLeft: '1.5px solid var(--line)', padding: '6px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: '100%' }}>
            {[60, 40, 85, 70, 95, 110, 130, 120].map((h, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <div style={{ height: `${h}px`, width: '100%', background: 'repeating-linear-gradient(45deg, var(--ink), var(--ink) 2px, transparent 2px, transparent 5px)', border: '1.2px solid var(--line)' }}/>
                <div className="code" style={{ fontSize: 9 }}>{['Oct','Nov','Dec','Jan','Feb','Mar','Apr','May'][i]}</div>
              </div>
            ))}
          </div>
          <div style={{ position: 'absolute', top: 30, left: 8, right: 8, borderTop: '1.5px dashed var(--accent-red)' }}>
            <span className="anno" style={{ top: -20, right: 0 }}>target $166k/mo ↘</span>
          </div>
        </div>
        <PenLine />
        <div className="grid g3" style={{ gap: 8 }}>
          <div>
            <div className="section-label">Margin mix</div>
            <Bar label="Project exp" pct={52} val="52%" tone="red" />
            <Bar label="OPEX" pct={20} val="20%" />
            <Bar label="Profit pool" pct={15} val="15%" tone="green" />
            <Bar label="LT share" pct={13} val="13%" tone="blue" />
          </div>
          <div>
            <div className="section-label">By client type</div>
            <Bar label="Pharma" pct={68} val="$980k" />
            <Bar label="MedTech" pct={34} val="$300k" tone="blue" />
            <Bar label="Payers" pct={18} val="$140k" tone="green" />
          </div>
          <div>
            <div className="section-label">By project type</div>
            <Bar label="Strategy" pct={72} val="5 proj" />
            <Bar label="Dil. dx." pct={40} val="3 proj" tone="blue" />
            <Bar label="Advisory" pct={22} val="2 proj" tone="green" />
          </div>
        </div>
      </div>
      <div className="sketch-box sketch-box-3">
        <h4>What needs you now</h4>
        <PenLine />
        <div className="list-row"><span><span className="tag pink">APPROVE</span> GNC001 invoice #14 · $48k</span><span className="small">TT</span></div>
        <div className="list-row"><span><span className="tag yellow">REVIEW</span> 3 expenses flagged {'>'}threshold</span><span className="small">2d</span></div>
        <div className="list-row"><span><span className="tag">SYNC</span> Timesheets.xlsx conflict (2 rows)</span><span className="small">1h</span></div>
        <div className="list-row"><span><span className="tag green">NEW</span> PNC002 proposal due Fri</span><span className="small">MB</span></div>
        <div className="list-row"><span><span className="tag">CHASE</span> IFM001 invoice #11 · 42d aged</span><span className="small">AR</span></div>
        <PenLine />
        <Sticky rot={-1.2}>Utilisation: CC 84% · MB 71% · SR 58% <br/>→ SR could take GNC001 work?</Sticky>
      </div>
    </div>
    <DividerLbl>Project portfolio</DividerLbl>
    <table className="sketch-table">
      <thead><tr><th>Code</th><th>Client / name</th><th>Stage</th><th>Contract</th><th>Billed</th><th>Exp %</th><th>Margin</th><th>Utilisation</th><th>XLSX</th></tr></thead>
      <tbody>
        {[
          ['IFM001','IFM / Diligence Strategy','delivery','$600k','$380k','48%','31%','0.5 MB, 1.0 CC, 0.5 TT','synced'],
          ['GNC001','Genica / Portfolio Review','closing','$420k','$420k','54%','26%','0.5 SR, 0.5 MB, 1.0 JB','synced'],
          ['PNC001','Panacea / Market Entry','delivery','$780k','$310k','46%','34%','0.5 TT, 1.0 CC, 1.0 AP','stale'],
          ['BMX001','Biomax / Diligence','kickoff','$250k','—','—','—','0.5 MB','synced'],
          ['ADX001','Adexa / Retainer','delivery','$180k','$120k','41%','38%','0.25 SR','synced'],
        ].map((r,i) => (
          <tr key={i}>
            <td className="code">{r[0]}</td>
            <td>{r[1]}</td>
            <td><span className={`tag ${r[2]==='delivery'?'blue':r[2]==='closing'?'green':'yellow'}`}>{r[2]}</span></td>
            <td>{r[3]}</td>
            <td>{r[4]}</td>
            <td>{r[5]}</td>
            <td>{r[6]}</td>
            <td className="small">{r[7]}</td>
            <td><ExcelPill state={r[8]} label={r[8]==='synced'?'✓':'stale'} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  </>
);

const DashVariantB = () => (
  <>
    <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', marginBottom: 10 }}>
      <div className="sketch-box" style={{ flex: '0 0 280px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div className="section-label">FY26 · HOW ARE WE TRACKING</div>
        <div style={{ fontFamily: 'var(--hand-title)', fontSize: 72, lineHeight: 1 }}>71%</div>
        <div style={{ width: '100%', height: 20, border: '1.5px solid var(--line)', borderRadius: 4, marginTop: 6, position: 'relative', overflow: 'hidden' }}>
          <div style={{ width: '71%', height: '100%', background: 'repeating-linear-gradient(45deg, var(--ink), var(--ink) 2px, transparent 2px, transparent 5px)' }} />
          <div style={{ position: 'absolute', top: -2, bottom: -2, left: '80%', width: 2, background: 'var(--accent-red)' }} />
        </div>
        <div className="small" style={{ marginTop: 4 }}>$1.42M of $2.0M · target by EOFY</div>
      </div>
      <div style={{ flex: 1 }}>
        <div className="grid g4" style={{ height: '100%' }}>
          <KPI label="Active proj" value="7" sub="$2.36M booked"/>
          <KPI label="Pipeline wt." value="$2.1M" sub="2.4× coverage"/>
          <KPI label="Profit pool" value="$213k" sub="15% accrual"/>
          <KPI label="OPEX used" value="$84k" sub="18.6% · ⚠ watch"/>
          <KPI label="Avg margin" value="31%" sub="target >30% ✓"/>
          <KPI label="AR outstd" value="$312k" sub="42d avg"/>
          <KPI label="Team util" value="62%" sub="partners 41%"/>
          <KPI label="Proj/partner" value="1.4" sub="benchmark 2.0"/>
        </div>
      </div>
    </div>
    <div className="grid g3">
      <div className="sketch-box sketch-box-2">
        <h4>Revenue flow · FY26</h4>
        <PenLine/>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
          <div className="list-row"><span>Gross project value</span><b>$1,420k</b></div>
          <div className="list-row" style={{ paddingLeft: 10 }}><span>– Project expenses (48%)</span><span>$682k</span></div>
          <div className="list-row" style={{ paddingLeft: 10 }}><span>– OPEX (20%)</span><span>$284k</span></div>
          <div className="list-row" style={{ paddingLeft: 10 }}><span>– Profit pool (15%)</span><span>$213k</span></div>
          <div className="list-row"><b>= LT / partner share</b><b>$241k</b></div>
        </div>
        <Sticky rot={1} style={{ marginTop: 10 }}>Benchmark: EBITDA 15–20% — we're at 17%. On target ✓</Sticky>
      </div>
      <div className="sketch-box">
        <h4>Consultant utilisation</h4>
        <PenLine/>
        <Bar label="CC (FT cons)" pct={84} val="84%" tone="red"/>
        <Bar label="MB (partner)" pct={71} val="71%" />
        <Bar label="TT (partner)" pct={48} val="48%" tone="blue"/>
        <Bar label="SR (partner)" pct={58} val="58%" />
        <Bar label="JB (analyst)" pct={92} val="92%" tone="red"/>
        <Bar label="AP (contract)" pct={33} val="33%" tone="green"/>
        <Bar label="JS (office)" pct={100} val="OPEX"/>
        <div className="small" style={{ marginTop: 6 }}>target: non-partner 65–80%, partner 30–50%</div>
      </div>
      <div className="sketch-box sketch-box-3">
        <h4>Pipeline snapshot</h4>
        <PenLine/>
        <div className="funnel-row"><span className="stage">Lead</span><div className="bar-wrap"><div className="bar-fill" style={{width:'95%'}}/></div><span className="code">$4.8M</span></div>
        <div className="funnel-row"><span className="stage">Qualified</span><div className="bar-wrap"><div className="bar-fill" style={{width:'70%'}}/></div><span className="code">$3.2M</span></div>
        <div className="funnel-row"><span className="stage">Proposal</span><div className="bar-wrap"><div className="bar-fill" style={{width:'48%'}}/></div><span className="code">$1.9M</span></div>
        <div className="funnel-row"><span className="stage">Verbal</span><div className="bar-wrap"><div className="bar-fill" style={{width:'22%'}}/></div><span className="code">$780k</span></div>
        <div className="funnel-row"><span className="stage">Won</span><div className="bar-wrap"><div className="bar-fill" style={{width:'14%'}}/></div><span className="code">$520k</span></div>
        <Sticky tone="pink" rot={-2} style={{ marginTop: 10 }}>Win rate 22% — below 30% target</Sticky>
      </div>
    </div>
  </>
);

const DashVariantC = () => (
  <>
    <div className="sketch-box" style={{ marginBottom: 10, padding: '14px 18px', background: 'var(--paper-2)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 42 }}>Good morning, TT —</h2>
        <div className="small">Thursday 18 April 2026 · FY26 Q4</div>
      </div>
      <p style={{ fontSize: 17, fontFamily: 'var(--hand)', margin: '8px 0 0', maxWidth: 900 }}>
        Revenue <span className="highlighter">$1.42M of $2M target (71%)</span>, margin holding at <b>31%</b>. &nbsp;
        <span className="underline-wavy">3 items need your eyes</span> and the pipeline is <b>2.4× covered</b>. &nbsp;
        OPEX is tight at <span className="circled">18.6%</span> — watch BD spend this month.
      </p>
    </div>
    <div className="grid g2" style={{ marginBottom: 10 }}>
      <div className="sketch-box">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h4>Today's focus ⏱</h4>
          <span className="small">4 items</span>
        </div>
        <PenLine/>
        {[
          ['⚠','Approve GNC001 invoice #14 ($48k) — TT only, 2d'],
          ['📝','Sign IFM001 change order (v2) before Fri'],
          ['💬','Review SR per-diem true-up — Q3 profit pool'],
          ['📞','Call with Biomax CFO · 2:30pm · BMX001 kickoff'],
        ].map(([i,t],k)=>(
          <div className="list-row" key={k}><span>{i}&nbsp;&nbsp;{t}</span><span className="small">→</span></div>
        ))}
      </div>
      <div className="sketch-box sketch-box-2">
        <h4>The numbers right now</h4>
        <PenLine/>
        <div className="grid g2" style={{ gap: 6 }}>
          <KPI label="Revenue" value="$1.42M" sub="71% of target"/>
          <KPI label="Margin" value="31%" sub="aim >30% ✓"/>
          <KPI label="Pipeline" value="$4.8M" sub="2.4× cover"/>
          <KPI label="Utilisation" value="62%" sub="partners 41%"/>
        </div>
      </div>
    </div>
    <div className="grid g3">
      <div className="sketch-box">
        <h4>Projects in motion</h4>
        <PenLine/>
        {[
          ['IFM001','48%','on track'],
          ['GNC001','54%','closing'],
          ['PNC001','46%','on track'],
          ['BMX001','—','kickoff'],
          ['ADX001','41%','on track'],
        ].map((r,i) => (
          <div className="list-row" key={i}>
            <span><span className="code">{r[0]}</span> &nbsp; expenses {r[1]}</span>
            <span className={`tag ${r[2]==='closing'?'green':r[2]==='kickoff'?'yellow':''}`}>{r[2]}</span>
          </div>
        ))}
      </div>
      <div className="sketch-box sketch-box-3">
        <h4>Cash & AR</h4>
        <PenLine/>
        <Bar label="Invoiced" pct={82} val="$1.16M"/>
        <Bar label="Collected" pct={60} val="$850k" tone="green"/>
        <Bar label="AR 0-30d" pct={25} val="$140k"/>
        <Bar label="AR 30-60d" pct={18} val="$112k" tone="blue"/>
        <Bar label="AR 60d+" pct={12} val="$60k" tone="red"/>
        <div className="small" style={{ marginTop: 6 }}>avg collection 42d (target 30d)</div>
      </div>
      <div className="sketch-box sketch-box-2">
        <h4>BD spotlight</h4>
        <PenLine/>
        <div className="list-row"><span>🔥 PNC002 — $680k proposal</span><span className="tag yellow">due Fri</span></div>
        <div className="list-row"><span>GNC002 — extension</span><span className="tag">verbal</span></div>
        <div className="list-row"><span>BMX001 — kickoff next wk</span><span className="tag green">won</span></div>
        <div className="list-row"><span>NXS — intro call 24 Apr</span><span className="tag blue">lead</span></div>
      </div>
    </div>
  </>
);

Object.assign(window, { NavVariantSidebar, NavVariantTopTabs, NavVariantCommand, DashVariantA, DashVariantB, DashVariantC });
