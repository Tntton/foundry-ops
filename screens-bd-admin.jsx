// screens-bd-admin.jsx - BD pipeline (3 variants), Approvals, Directory, Reports, Templates, Admin + Excel sync (3 variants)

// --- BD PIPELINE VARIANTS ---
const bdDeals = [
  ['PNC002','Panacea','Mkt entry II','$680k','Pharma','Proposal','TT'],
  ['GNC002','Genica','Extension','$300k','Pharma','Verbal','SR'],
  ['NXS001','NexusBio','Diligence','$450k','Biotech','Qualified','MB'],
  ['IFM002','IFM','Follow-on','$280k','Pharma','Lead','MB'],
  ['BMX002','Biomax','Phase 2','$520k','MedTech','Lead','TT'],
  ['PAY001','PayerCo','Advisory','$180k','Payer','Qualified','SR'],
  ['KLX001','Klix','Diligence','$380k','Biotech','Proposal','CC'],
];

const BDKanban = () => (
  <div className="kanban">
    {['Lead','Qualified','Proposal','Verbal','Won'].map((st, idx) => {
      const items = bdDeals.filter(d => d[5] === st);
      const stageTotals = {'Lead':'$800k','Qualified':'$630k','Proposal':'$1.06M','Verbal':'$300k','Won':'$250k'}[st];
      return (
        <div className="kanban-col" key={st}>
          <h4>{st} <span className="code small">{stageTotals}</span></h4>
          {items.map((d,i)=>(
            <div className="kanban-card" key={i}>
              <div className="code">{d[0]}</div>
              <div>{d[1]} — {d[2]}</div>
              <div className="val">{d[3]}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span className="tag" style={{ fontSize: 10 }}>{d[4]}</span>
                <span className="small">{d[6]}</span>
              </div>
            </div>
          ))}
          <div style={{ border: '1.5px dashed var(--line-soft)', padding: 6, textAlign: 'center', fontSize: 12, color: 'var(--ink-faint)', marginTop: 6, borderRadius: 3 }}>＋ add</div>
        </div>
      );
    })}
  </div>
);

const BDFunnel = () => (
  <div className="grid g-2-1">
    <div className="sketch-box">
      <h4>Weighted forecast funnel</h4>
      <PenLine/>
      {[
        ['Lead',10,800,8],
        ['Qualified',25,630,157],
        ['Proposal',40,1060,424],
        ['Verbal',75,300,225],
        ['Won',100,250,250],
      ].map((r,i)=>(
        <div className="funnel-row" key={i}>
          <span className="stage">{r[0]} <span className="small">({r[1]}%)</span></span>
          <div className="bar-wrap"><div className="bar-fill" style={{ width: `${Math.min(100, r[2]/12)}%` }}/></div>
          <span className="code">${r[2]}k → <b>${r[3]}k</b></span>
        </div>
      ))}
      <PenLine/>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span>Total unweighted · <b>$3.04M</b></span>
        <span>Weighted pipeline · <b style={{ fontFamily: 'var(--hand-title)', fontSize: 28, color: 'var(--accent-blue)' }}>$1.06M</b></span>
      </div>
      <Sticky rot={-1} style={{ marginTop: 10 }}>Need 2–3× target — $2M × 2.5 = <b>$5M</b> pipeline. Currently <b>$3.04M</b> ⚠ short by ~$2M</Sticky>
    </div>
    <div className="sketch-box sketch-box-2">
      <h4>By client type · weighted</h4>
      <PenLine/>
      <Bar label="Pharma" pct={70} val="$740k"/>
      <Bar label="Biotech" pct={25} val="$260k" tone="blue"/>
      <Bar label="MedTech" pct={12} val="$120k" tone="green"/>
      <Bar label="Payer" pct={6} val="$60k"/>
      <h4 style={{ marginTop: 14 }}>Win rate trailing 12mo</h4>
      <PenLine/>
      <div style={{ fontFamily: 'var(--hand-title)', fontSize: 44 }}>22%</div>
      <div className="small">target 30% · benchmark 20–40%</div>
    </div>
  </div>
);

const BDTable = () => (
  <>
    <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
      {['All stages','Pharma','Biotech','MedTech','Payer','Mine only','Close this Q'].map((f,i)=>(<span key={i} className={`tag ${i===0?'yellow':''}`}>{f}</span>))}
    </div>
    <table className="sketch-table">
      <thead><tr><th>Code</th><th>Client</th><th>Name</th><th>Stage</th><th>Prob</th><th>Value</th><th>Weighted</th><th>Owner</th><th>Next step</th><th>Close date</th><th>Source</th></tr></thead>
      <tbody>
        {[
          ['PNC002','Panacea','Market entry II','Proposal','40%','$680k','$272k','TT','SOW signoff','24 Apr','AP referral 10%'],
          ['GNC002','Genica','Extension','Verbal','75%','$300k','$225k','SR','Contract redline','30 Apr','existing'],
          ['NXS001','NexusBio','Diligence','Qualified','25%','$450k','$112k','MB','Scoping call','15 May','cold'],
          ['IFM002','IFM','Follow-on','Lead','10%','$280k','$28k','MB','Pending brief','—','existing'],
          ['BMX002','Biomax','Phase 2','Lead','10%','$520k','$52k','TT','Intro call 24 Apr','—','existing'],
          ['PAY001','PayerCo','Advisory','Qualified','25%','$180k','$45k','SR','Proposal draft','10 May','MB referral'],
          ['KLX001','Klix','Diligence','Proposal','40%','$380k','$152k','CC','Pricing revision','02 May','CC referral 3%'],
        ].map((r,i)=>(<tr key={i}>{r.map((c,j)=>(<td key={j} className={j===0?'code':''}>{c}</td>))}</tr>))}
      </tbody>
      <tfoot>
        <tr style={{ background: 'var(--paper-2)' }}>
          <td colSpan="5" style={{ fontFamily: 'var(--hand)', fontWeight: 700 }}>Totals (7 deals)</td>
          <td><b>$2.79M</b></td>
          <td><b>$886k</b></td>
          <td colSpan="4"></td>
        </tr>
      </tfoot>
    </table>
  </>
);

// --- APPROVALS ---
const Approvals = () => (
  <>
    <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      <h3>Approvals queue</h3>
      <span className="tag pink">3 urgent</span>
      <span className="tag">12 total</span>
      <div className="small" style={{ marginLeft: 'auto' }}>rules: see <u>Admin → Financial controls</u></div>
    </div>
    <div className="grid g3" style={{ marginBottom: 10 }}>
      <div className="sketch-box"><div className="section-label">thresholds · auto-flag</div>
        <div className="list-row"><span>Expense &gt; $500</span><span className="tag">PM</span></div>
        <div className="list-row"><span>Expense &gt; $2,000</span><span className="tag">Partner</span></div>
        <div className="list-row"><span>Invoice &gt; $20k</span><span className="tag">Partner</span></div>
        <div className="list-row"><span>Meals &gt; $150/head</span><span className="tag">Partner</span></div>
        <div className="list-row"><span>Expense line &gt; 20% over budget</span><span className="tag">Lead Partner</span></div>
        <div className="list-row"><span>New project BD ref &gt; 5%</span><span className="tag">Partnership</span></div>
      </div>
      <div className="sketch-box sketch-box-2"><div className="section-label">by type · this week</div>
        <Bar label="Invoice out" pct={48} val="4"/>
        <Bar label="Invoice in" pct={72} val="6" tone="blue"/>
        <Bar label="Expenses" pct={28} val="2" tone="green"/>
        <Bar label="Timesheets" pct={56} val="4"/>
        <Bar label="Change orders" pct={14} val="1" tone="red"/>
      </div>
      <div className="sketch-box sketch-box-3"><div className="section-label">avg turn-around</div>
        <div style={{ fontFamily: 'var(--hand-title)', fontSize: 42 }}>1.4 days</div>
        <div className="small">target &lt; 2d · SLA ✓</div>
        <Sticky rot={-1} style={{ marginTop: 8 }}>TT has 5 pending; SR 1. Rebalance?</Sticky>
      </div>
    </div>
    <div className="sketch-box">
      {[
        ['🚨','GNC001 · Invoice out #14 · $48,000','TT','>$20k','2d overdue','pink'],
        ['⚠','IFM001 · Travel exp over +30%','MB (lead)','>20% line over','today','yellow'],
        ['⚠','SR-consultant-Mar.pdf supplier invoice · $48k','TT','>$20k','today','yellow'],
        ['','CC expense · Qantas $420','MB (PM)','>$500','1d',''],
        ['','JB timesheet wk16 · 52h','MB (PM)','>50h/wk','1d',''],
        ['','PNC001 · Change order v2 ($45k)','MB + TT','change order','3d',''],
        ['','BMX001 · BD referral 8% external','Partnership','new project BD >5%','2d',''],
      ].map((r,i)=>(
        <div className="queue-item" key={i}>
          <span><span className={`tag ${r[5]}`}>{r[3]}</span></span>
          <span>{r[0]} {r[1]}</span>
          <span className="small">→ {r[2]}</span>
          <span className="small">{r[4]}</span>
          <span style={{ display: 'flex', gap: 4 }}>
            <SketchBtn small>reject</SketchBtn>
            <SketchBtn small primary>approve</SketchBtn>
          </span>
        </div>
      ))}
    </div>
  </>
);

// --- DIRECTORIES ---
const Directory = () => (
  <>
    <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
      {['All','People (FT)','People (PT)','Partners','Contractors','Experts','Clients','Suppliers'].map((t,i)=>(<span key={i} className={`tag ${i===3?'yellow':''}`} style={{ fontSize: 13, padding: '3px 10px' }}>{t}</span>))}
      <SketchBtn small style={{ marginLeft: 'auto' }}>＋ add person</SketchBtn>
      <SketchBtn small>＋ add client</SketchBtn>
    </div>
    <div className="grid g-2-1">
      <div>
        <DividerLbl>Consultants & partners</DividerLbl>
        <table className="sketch-table">
          <thead><tr><th>Init</th><th>Name / role</th><th>Type</th><th>FTE</th><th>Rate</th><th>Utilisation</th><th>Active projects</th><th>BD referrals</th></tr></thead>
          <tbody>
            {[
              ['TT','Partner · Lead','FT Partner','1.0','$2000/d','48%','PNC001, BMX001','PAY001 3%'],
              ['MB','Partner · Strategy','FT Partner','1.0','$2000/d','71%','IFM001, PNC001','NXS001 —'],
              ['SR','Assoc Partner','PT Partner','0.6','$2000/d','58%','GNC001','PAY001 3%'],
              ['CC','Consultant','FT','1.0','$800/d','84%','IFM001, PNC001','KLX001 3%'],
              ['JB','Analyst','FT','1.0','$400/d','92%','IFM001, GNC001','—'],
              ['AP','Associate','Contractor','—','$2000/d','33%','PNC001','IFM001 3%'],
              ['JS','Office Manager','FT','1.0','OPEX','100% OPEX','—','—'],
            ].map((r,i)=>(<tr key={i}><td className="code">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td><td>{r[5]}</td><td className="small">{r[6]}</td><td className="small">{r[7]}</td></tr>))}
          </tbody>
        </table>
        <DividerLbl>Clients</DividerLbl>
        <table className="sketch-table">
          <thead><tr><th>Client</th><th>Type</th><th>Projects</th><th>LTV</th><th>AR</th><th>Relationship owner</th></tr></thead>
          <tbody>
            {[
              ['IFM','Pharma','IFM001, IFM002','$880k','$120k','MB'],
              ['Genica','Pharma','GNC001, GNC002','$720k','$0','SR'],
              ['Panacea','Pharma','PNC001, PNC002','$1.46M','$220k','TT'],
              ['Biomax','MedTech','BMX001, BMX002','$770k','$0','TT'],
              ['Adexa','Pharma','ADX001','$180k','$36k','SR'],
            ].map((r,i)=>(<tr key={i}>{r.map((c,j)=>(<td key={j}>{c}</td>))}</tr>))}
          </tbody>
        </table>
      </div>
      <div>
        <div className="sketch-box sketch-box-3">
          <h4>MB · profile</h4>
          <PenLine/>
          <div style={{ width: 80, height: 80, border: '1.5px solid var(--line)', borderRadius: '50% 45% 50% 40%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--hand-title)', fontSize: 38, margin: '6px 0' }}>MB</div>
          <div className="list-row"><span>Role</span><span>Partner · Strategy</span></div>
          <div className="list-row"><span>Type</span><span>FT Partner</span></div>
          <div className="list-row"><span>Per-diem</span><span>$2,000</span></div>
          <div className="list-row"><span>Baseline salary</span><span>OPEX — $18k/mo</span></div>
          <div className="list-row"><span>YTD earnings</span><span><b>$186,400</b></span></div>
          <div className="list-row"><span>Utilisation</span><span>71% (target 30–50% partner)</span></div>
          <div className="list-row"><span>Project share YTD</span><span>$42k</span></div>
          <div className="list-row"><span>BD referral YTD</span><span>$6k · 1 deal</span></div>
          <PenLine/>
          <Sticky tone="blue">All earning streams here feed the <b>Partner True-up Report</b> each quarter</Sticky>
        </div>
      </div>
    </div>
  </>
);

// --- REPORTS ---
const Reports = () => (
  <>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
      <h3>Reports & exports</h3>
      <div className="small" style={{ marginLeft: 'auto' }}>all reports exportable as XLSX, PDF, or native Word</div>
    </div>
    <div className="grid g3">
      {[
        ['Firm P&L · FY26 YTD','Monthly revenue, costs, margin vs target','Finance, Partners','weekly'],
        ['Project portfolio scorecard','All active projects · expense %, margin, utilisation','Partners','weekly'],
        ['Utilisation & leverage','Per-person billable % · FT vs PT vs contractor','Partners, Office Mgr','weekly'],
        ['BD pipeline forecast','Weighted pipeline by stage / client type','Partners','bi-weekly'],
        ['Cash & AR aging','Invoices outstanding 0/30/60/90d','Finance','weekly'],
        ['OPEX vs budget','Line-by-line against 20% OPEX plan','Finance, Office Mgr','monthly'],
        ['Profit pool reconciliation','15% accrual · true-up allocation','Partnership','quarterly'],
        ['Partner true-up','Per-diem × utilisation + BD + project share','Partnership','quarterly'],
        ['Client concentration','Revenue by client · pharma / biotech / medtech','Partners','quarterly'],
        ['Referral ledger','All referral fees · capped, internal/external','Finance','monthly'],
        ['Close-out packet','Per-project wrap: final P&L, learnings','PM','project close'],
        ['Board pack','Summary of all above · branded','Partnership','monthly'],
      ].map((r,i)=>(
        <div className="sketch-box" key={i} style={{ minHeight: 130 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <h4 style={{ fontSize: 16 }}>{r[0]}</h4>
            <span className="tag">{r[3]}</span>
          </div>
          <PenLine/>
          <div className="small">{r[1]}</div>
          <div className="small" style={{ marginTop: 6, color: 'var(--ink-faint)' }}>👥 {r[2]}</div>
          <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
            <SketchBtn small>view</SketchBtn>
            <SketchBtn small>XLSX</SketchBtn>
            <SketchBtn small>PDF</SketchBtn>
          </div>
        </div>
      ))}
    </div>
    <DividerLbl>Ad-hoc report builder</DividerLbl>
    <div className="sketch-box" style={{ background: 'var(--paper-2)' }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontFamily: 'var(--hand)', fontSize: 16 }}>
        Show <span className="tag yellow">revenue</span> by <span className="tag">client type</span> for <span className="tag">last 12 months</span> grouped by <span className="tag">lead partner</span> where margin is <span className="tag">&gt; 30%</span>
        <SketchBtn primary small style={{ marginLeft: 'auto' }}>run →</SketchBtn>
      </div>
      <PenLine/>
      <div className="ph">[ pivot preview — table renders here, saveable as a scheduled report ]</div>
    </div>
  </>
);

// --- TEMPLATES ---
const Templates = () => (
  <>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
      <h3>Contract & invoice templates</h3>
      <span className="tag">generate Word/PDF · fields auto-merged from platform</span>
    </div>
    <div className="grid g2">
      <div className="sketch-box">
        <h4>Generate invoice · IFM001 · #12</h4>
        <PenLine/>
        <div className="grid g2" style={{ gap: 8 }}>
          <div className="field"><label>Template</label><div className="v">Foundry Standard Invoice v4 (Word) ▾</div></div>
          <div className="field"><label>Project</label><div className="v">IFM001 · Integrated Market</div></div>
          <div className="field"><label>Period</label><div className="v">Mar 2026</div></div>
          <div className="field"><label>Amount</label><div className="v">$120,000 (milestone 2 of 5)</div></div>
          <div className="field"><label>Currency</label><div className="v">AUD</div></div>
          <div className="field"><label>Due date</label><div className="v">+30d → 18 May 2026</div></div>
          <div className="field"><label>Ref</label><div className="v">IFM001-INV-012</div></div>
          <div className="field"><label>Bill to</label><div className="v">IFM Finance · ap@ifm.com</div></div>
        </div>
        <PenLine/>
        <div className="section-label">merge fields · auto-populated from platform data</div>
        <div className="code small" style={{ background: 'var(--paper-2)', padding: 8, borderRadius: 4 }}>
          {'{{client.name}} · {{project.code}} · {{invoice.number}} · {{amount}} · {{due_date}} · {{abn}} · {{line_items}}'}
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
          <SketchBtn small>preview</SketchBtn>
          <SketchBtn small>save .docx</SketchBtn>
          <SketchBtn small primary>generate &amp; route for approval →</SketchBtn>
        </div>
      </div>
      <div className="sketch-box sketch-box-2">
        <h4>Template library</h4>
        <PenLine/>
        {[
          ['Foundry Standard Invoice v4','.docx','used 41×','auto'],
          ['Foundry Project Contract v3','.docx','used 14×','manual'],
          ['Foundry Consulting Agreement','.docx','used 6×','manual'],
          ['Change Order v2','.docx','used 9×','auto'],
          ['SOW — Strategy template','.docx','used 8×','auto'],
          ['Referral agreement v1','.docx','used 3×','manual'],
          ['Close-out letter','.docx','used 11×','auto'],
          ['NDA — mutual','.docx','used 18×','manual'],
        ].map((r,i)=>(
          <div className="list-row" key={i}>
            <span>📄 <b>{r[0]}</b> <span className="small">{r[1]}</span></span>
            <span className="small">{r[2]} <span className="tag" style={{ fontSize: 10 }}>{r[3]}</span></span>
          </div>
        ))}
        <PenLine/>
        <Sticky>Bolt-on modules (optional):<br/>📬 Email-to-invoice · 📄 Auto-gen contracts · 🤖 e-sign · Xero sync</Sticky>
      </div>
    </div>
  </>
);

// --- EXCEL SYNC VARIANTS ---
const ExcelSyncInvisible = () => (
  <div className="sketch-box">
    <h4>Option A — Invisible</h4>
    <PenLine/>
    <div className="small">Excel is a silent backing store. Users see nothing about it in-app.</div>
    <div style={{ marginTop: 10, border: '1.5px solid var(--line)', padding: 10, borderRadius: 4, background: 'var(--paper-2)' }}>
      <div className="section-label">Admin only · set up once</div>
      <div className="list-row"><span>📊 Finance.xlsx master</span><span className="small">OneDrive /Foundry/</span></div>
      <div className="list-row"><span>⏱ Timesheet.xlsx</span><span className="small">OneDrive /Foundry/</span></div>
      <div className="list-row"><span>🧾 Invoices.xlsx</span><span className="small">OneDrive /Foundry/</span></div>
      <div className="list-row"><span>💳 Expenses.xlsx</span><span className="small">OneDrive /Foundry/</span></div>
      <div className="list-row"><span>🎯 Pipeline.xlsx</span><span className="small">OneDrive /Foundry/</span></div>
    </div>
    <Sticky rot={-1} style={{ marginTop: 10 }}>Pros: clean UI, zero learning curve<br/>Cons: users don't know when sync breaks</Sticky>
  </div>
);

const ExcelSyncExplicit = () => (
  <div className="sketch-box sketch-box-2">
    <h4>Option B — Explicit (recommended)</h4>
    <PenLine/>
    <div className="small">Sync is visible everywhere: status pills, "open in Excel" buttons, stale warnings.</div>
    <div style={{ marginTop: 10, padding: 10, border: '1.5px solid var(--line)', borderRadius: 4 }}>
      <div className="list-row"><span>📊 Finance.xlsx</span><ExcelPill state="synced" label="synced 2m ago"/></div>
      <div className="list-row"><span>⏱ Timesheet.xlsx</span><ExcelPill state="synced" label="synced 4m ago"/></div>
      <div className="list-row"><span>🧾 Invoices.xlsx</span><ExcelPill state="stale" label="stale · 2h"/></div>
      <div className="list-row"><span>💳 Expenses.xlsx</span><ExcelPill state="synced"/></div>
      <div className="list-row"><span>🎯 Pipeline.xlsx</span><ExcelPill state="synced"/></div>
    </div>
    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
      <SketchBtn small>open in Excel</SketchBtn>
      <SketchBtn small>force sync</SketchBtn>
    </div>
    <Sticky tone="green" rot={1} style={{ marginTop: 10 }}>Pros: trust builds quickly · users can "fall back" to Excel<br/>Cons: more UI clutter</Sticky>
  </div>
);

const ExcelSyncTwoWay = () => (
  <div className="sketch-box sketch-box-3">
    <h4>Option C — Two-way live w/ diff review</h4>
    <PenLine/>
    <div className="small">Users edit in web or Excel. Conflicts surface as diffs for human resolution.</div>
    <div style={{ marginTop: 10, padding: 10, border: '1.5px solid var(--accent-red)', borderRadius: 4, background: 'rgba(251,195,188,.2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <b>2 conflicts · Invoices.xlsx</b>
        <span className="tag pink">needs review</span>
      </div>
      <div className="diff-row" style={{ fontWeight: 700, borderBottom: '1.5px solid var(--line)' }}>
        <div>Row</div><div>Web says</div><div>Excel says</div><div></div>
      </div>
      <div className="diff-row">
        <div>INV-009 · Due</div>
        <div className="cell web">18 May 2026</div>
        <div className="cell xlsx">25 May 2026</div>
        <div style={{ display: 'flex', gap: 3 }}><SketchBtn small>web</SketchBtn><SketchBtn small>xlsx</SketchBtn></div>
      </div>
      <div className="diff-row">
        <div>INV-011 · Amount</div>
        <div className="cell web">$48,000</div>
        <div className="cell xlsx">$48,400</div>
        <div style={{ display: 'flex', gap: 3 }}><SketchBtn small>web</SketchBtn><SketchBtn small>xlsx</SketchBtn></div>
      </div>
    </div>
    <Sticky rot={-2} style={{ marginTop: 10 }}>Pros: maximum flexibility — matches Foundry's low bar to fall back to Excel<br/>Cons: conflict UX must be obvious</Sticky>
  </div>
);

// --- ADMIN ---
const Admin = () => (
  <>
    <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
      {['Users & roles','Excel sync','Financial controls','Project types','Clients','Rates & per-diems','Bolt-ons','Audit log'].map((t,i)=>(<span key={i} className={`tag ${i===1?'yellow':''}`} style={{ fontSize: 13, padding: '3px 10px' }}>{t}</span>))}
    </div>
    <DividerLbl>Excel sync — where everything lives</DividerLbl>
    <div className="grid g2">
      <div>
        <div className="sketch-box">
          <h4>Connected workbooks</h4>
          <PenLine/>
          <table className="sketch-table">
            <thead><tr><th>File</th><th>Location</th><th>Sync</th><th>Last</th><th>Owner</th></tr></thead>
            <tbody>
              {[
                ['📊 Finance.xlsx','OneDrive /Foundry/','2-way','2m','TT'],
                ['⏱ Timesheet.xlsx','OneDrive /Foundry/','2-way','4m','JS'],
                ['🧾 Invoices.xlsx','OneDrive /Foundry/','2-way','2h ⚠','JS'],
                ['💳 Expenses.xlsx','OneDrive /Foundry/','2-way','now','JS'],
                ['🎯 Pipeline.xlsx','OneDrive /Foundry/','2-way','30s','MB'],
                ['📈 Profit-pool.xlsx','OneDrive /Partners/','read-only','1h','TT'],
              ].map((r,i)=>(<tr key={i}><td>{r[0]}</td><td className="small code">{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td></tr>))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <SketchBtn small>＋ connect workbook</SketchBtn>
            <SketchBtn small>map columns →</SketchBtn>
            <SketchBtn small>sync all now</SketchBtn>
          </div>
        </div>
        <div className="sketch-box sketch-box-2" style={{ marginTop: 10 }}>
          <h4>Users & roles</h4>
          <PenLine/>
          {[
            ['TT','Managing partner','full admin'],
            ['MB','Partner','partner · lead IFM001, PNC001'],
            ['SR','Assoc partner','partner · lead GNC001'],
            ['CC','Consultant','contributor · timesheets, exp'],
            ['JB','Analyst','contributor · timesheets'],
            ['JS','Office manager','finance admin · all Excel'],
            ['AP','External contractor','portal only · own invoices'],
          ].map((r,i)=>(
            <div className="list-row" key={i}>
              <span className="code">{r[0]}</span>
              <span>{r[1]}</span>
              <span className="small">{r[2]}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="sketch-box sketch-box-3">
          <h4>Financial controls</h4>
          <PenLine/>
          <div className="section-label">AUTO-ALLOCATION (from §Governance)</div>
          <div className="list-row"><span>Project OPEX contribution</span><b>20%</b></div>
          <div className="list-row"><span>Firm profit pool</span><b>15%</b></div>
          <div className="list-row"><span>Project expense target</span><b>&lt; 50%</b></div>
          <div className="list-row"><span>Net revenue target</span><b>&gt; 30%</b></div>
          <div className="list-row"><span>EBITDA target</span><b>15–20%</b></div>
          <PenLine/>
          <div className="section-label">REFERRAL CAPS</div>
          <div className="list-row"><span>External warm intro</span><b>5% · cap $50k</b></div>
          <div className="list-row"><span>External co-sell</span><b>10% · cap $50k</b></div>
          <div className="list-row"><span>Internal referral</span><b>2–5%</b></div>
          <div className="list-row"><span>Partner referral</span><em>profit pool allocation</em></div>
          <PenLine/>
          <div className="section-label">APPROVAL THRESHOLDS</div>
          <div className="list-row"><span>Expense &gt; $500</span><b>→ PM</b></div>
          <div className="list-row"><span>Expense / invoice &gt; $2k</span><b>→ Partner</b></div>
          <div className="list-row"><span>Invoice &gt; $20k out</span><b>→ Managing Partner</b></div>
          <div className="list-row"><span>Line over budget &gt; 20%</span><b>→ Lead Partner</b></div>
        </div>
        <Sticky tone="blue" style={{ marginTop: 10 }}>Changes to these rules create a new <b>audit-log</b> entry and require 2 partner sign-off.</Sticky>
      </div>
    </div>
  </>
);

Object.assign(window, { BDKanban, BDFunnel, BDTable, Approvals, Directory, Reports, Templates, Admin, ExcelSyncInvisible, ExcelSyncExplicit, ExcelSyncTwoWay });
