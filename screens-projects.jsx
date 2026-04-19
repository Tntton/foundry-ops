// screens-projects.jsx
const ProjectDetail = () => (
  <>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
      <span className="code" style={{ fontSize: 18, background: 'var(--highlight-yellow)', padding: '2px 8px' }}>IFM001</span>
      <h2>Integrated Market — Diligence Strategy</h2>
      <span className="tag blue">delivery</span>
      <ExcelPill state="synced" />
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        <SketchBtn small>📄 Generate invoice</SketchBtn>
        <SketchBtn small>📄 Change order</SketchBtn>
        <SketchBtn small primary>＋ Log activity</SketchBtn>
      </div>
    </div>
    <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
      {['Overview','P&L','Team & timesheets','Invoices','Expenses','Contracts','Referrals','Activity'].map((t,i)=>(
        <span key={i} className={`tag ${i===0?'yellow':''}`} style={{ fontSize: 13, padding: '3px 10px' }}>{t}</span>
      ))}
    </div>
    <div className="grid g-2-1">
      <div>
        <div className="sketch-box" style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4>Project P&amp;L · live</h4>
            <span className="small">auto-calculated · synced to Finance.xlsx</span>
          </div>
          <PenLine/>
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 80px 80px 70px 1fr', gap: 8, fontSize: 13, fontFamily: 'var(--mono)' }}>
            <div className="section-label">Line</div><div className="section-label">Budget</div><div className="section-label">Actual</div><div className="section-label">% fee</div><div className="section-label">Status</div>
            {[
              ['Gross fee','$600,000','$600,000','100%','contract v2 ✓'],
              ['– Project expenses','$300,000','$288,400','48.1%','on track (aim <50%)'],
              ['   Partners per-diem (0.5×3)','$180,000','$176,000','29.3%','TT MB SR'],
              ['   Consultant (CC 1.0)','$60,000','$58,000','9.7%',''],
              ['   Analyst (JB)','$24,000','$24,400','4.1%',''],
              ['   Experts (p/h)','$12,000','$8,200','1.4%','4h/wk US'],
              ['   Travel + meals','$4,800','$6,200','1.0%','⚠ over'],
              ['   Software/subs','$2,400','$2,100','0.35%',''],
              ['– BD referral (AP int 3%)','$18,000','$18,000','3.0%','paid'],
              ['– OPEX contribution (20%)','$120,000','$120,000','20.0%','auto'],
              ['– Firm profit pool (15%)','$90,000','$90,000','15.0%','auto'],
              ['= LT project share (residual)','$72,000','$83,600','13.9%','adj. at close'],
            ].map((r,i)=>(
              <React.Fragment key={i}>
                <div style={{ fontFamily: 'var(--hand)', fontSize: 13 }}>{r[0]}</div>
                <div>{r[1]}</div>
                <div>{r[2]}</div>
                <div>{r[3]}</div>
                <div className="small" style={{ fontFamily: 'var(--hand)' }}>{r[4]}</div>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="sketch-box sketch-box-2">
          <h4>Team & time (last 4 weeks)</h4>
          <PenLine/>
          <table className="sketch-table">
            <thead><tr><th>Member</th><th>Role</th><th>Alloc</th><th>Wk14</th><th>Wk15</th><th>Wk16</th><th>Wk17</th><th>Total hrs</th><th>$ to date</th></tr></thead>
            <tbody>
              {[
                ['MB','Lead partner','0.5','18','22','20','16','412','$82k'],
                ['TT','Expert partner','0.5','12','8','14','10','186','$37k'],
                ['SR','Assoc partner','0.5','14','16','12','18','243','$48k'],
                ['CC','Consultant','1.0','38','40','36','38','584','$58k'],
                ['JB','Analyst','1.0','40','40','38','42','612','$24k'],
              ].map((r,i)=>(<tr key={i}><td className="code">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td><td>{r[5]}</td><td>{r[6]}</td><td>{r[7]}</td><td>{r[8]}</td></tr>))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <div className="sketch-box sketch-box-3" style={{ marginBottom: 10 }}>
          <h4>Meta</h4>
          <PenLine/>
          <div className="list-row"><span>Client</span><b>Integrated Market</b></div>
          <div className="list-row"><span>Client type</span><span className="tag">Pharma</span></div>
          <div className="list-row"><span>Proj type</span><span className="tag">Strategy</span></div>
          <div className="list-row"><span>Start</span><span>06 Jan 2026</span></div>
          <div className="list-row"><span>End (planned)</span><span>28 Mar 2026</span></div>
          <div className="list-row"><span>Lead partner</span><b>MB</b></div>
          <div className="list-row"><span>Contract value</span><b>$600,000</b></div>
          <div className="list-row"><span>Invoiced / paid</span><span>$380k / $260k</span></div>
          <div className="list-row"><span>Referral</span><span>AP · 3% int · paid</span></div>
        </div>
        <Sticky tone="pink" style={{ marginBottom: 10 }}>
          <b>⚠ Travel over-budget by $1,400</b><br/>
          flag raised by financial controls (threshold 20%)
        </Sticky>
        <div className="sketch-box">
          <h4>Recent activity</h4>
          <PenLine/>
          <div className="list-row small"><span>MB logged 18h timesheet</span><span>2h ago</span></div>
          <div className="list-row small"><span>Invoice #11 sent to client</span><span>yesterday</span></div>
          <div className="list-row small"><span>CC added expense $340 (meals)</span><span>yesterday</span></div>
          <div className="list-row small"><span>Change order v2 signed</span><span>3d ago</span></div>
          <div className="list-row small"><span>Excel auto-synced (Finance.xlsx)</span><span>today</span></div>
        </div>
      </div>
    </div>
  </>
);

const ProjectWizard = () => (
  <>
    <Stepper steps={['Client & code','Contract','Team & rates','Financial model','Referrals','Review & sync']} cur={2}/>
    <div className="grid g-2-1">
      <div className="sketch-box">
        <h4>Step 3 — Team & rates</h4>
        <PenLine/>
        <div className="grid g2">
          <div className="sketch-box sketch-box-2">
            <div className="section-label">LEAD PARTNERS</div>
            {[['MB','Lead partner','0.5 FTE','$2,000/d'],['TT','Expert partner','0.5 FTE','$2,000/d · 1.5× weight'],['SR','Associate partner','0.5 FTE','$2,000/d']].map((r,i)=>(
              <div className="list-row" key={i}>
                <span><span className="sk-check on"/>{r[0]} — {r[1]}</span>
                <span className="small">{r[2]} · <b>{r[3]}</b></span>
              </div>
            ))}
            <SketchBtn small style={{marginTop:6}}>＋ add partner</SketchBtn>
          </div>
          <div className="sketch-box sketch-box-3">
            <div className="section-label">DELIVERY TEAM</div>
            <div className="list-row"><span><span className="sk-check on"/>CC — Consultant</span><span className="small">1.0 · $800/d</span></div>
            <div className="list-row"><span><span className="sk-check on"/>JB — Analyst</span><span className="small">1.0 · $400/d</span></div>
            <div className="list-row"><span><span className="sk-check"/>AP — External expert</span><span className="small">4h/wk · $250/h</span></div>
            <SketchBtn small style={{marginTop:6}}>＋ add team member</SketchBtn>
          </div>
        </div>
        <div className="sketch-box" style={{ marginTop: 10, background: 'var(--paper-2)' }}>
          <div className="section-label">AUTO-CALCULATED PROJECT BUDGET</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px 100px', gap: 6, marginTop: 6, fontFamily: 'var(--mono)', fontSize: 12 }}>
            <div>Line</div><div>Rate</div><div>Weeks</div><div>Total</div>
            <div>Manager/Consultant (CC)</div><div>800×2.5</div><div>12</div><div>$60,000</div>
            <div>Analyst (JB)</div><div>400×5</div><div>12</div><div>$24,000</div>
            <div>Experts (p/h)</div><div>250×4h</div><div>12</div><div>$12,000</div>
            <div>Leadership team (1.5 FTE)</div><div>2000×7.5</div><div>12</div><div>$180,000</div>
            <div style={{ gridColumn: '1/3', fontFamily: 'var(--hand)' }}><b>Project expenses</b></div><div></div><div><b>$313,200 · 52%</b></div>
          </div>
          <Sticky rot={-1} style={{ marginTop: 10 }}>⚠ expenses 52% &gt; 50% target — reduce expert hrs or re-weight LT?</Sticky>
        </div>
      </div>
      <div className="sketch-box sketch-box-3">
        <h4>Live flow-of-funds preview</h4>
        <PenLine/>
        <div className="donut"><div className="center">$600k<br/><small>gross</small></div></div>
        <div style={{ marginTop: 10 }}>
          <div className="list-row"><span>■ Project expenses</span><span>$313k · 52%</span></div>
          <div className="list-row"><span style={{color:'var(--accent-red)'}}>■ OPEX (20%)</span><span>$120k</span></div>
          <div className="list-row"><span style={{color:'var(--accent-green)'}}>■ Profit pool (15%)</span><span>$90k</span></div>
          <div className="list-row"><span>■ BD referral (3%)</span><span>$18k</span></div>
          <div className="list-row"><b>LT residual share</b><b>$59k · 9.8%</b></div>
        </div>
        <PenLine/>
        <div className="small">A project code <span className="code">IFM001</span> will be generated and propagated to:</div>
        <ul className="small" style={{ margin: '6px 0', paddingLeft: 18 }}>
          <li>📊 Finance.xlsx (master)</li>
          <li>⏱ Timesheet.xlsx (new col)</li>
          <li>🧾 Invoices register</li>
          <li>🎯 BD pipeline → Won</li>
        </ul>
      </div>
    </div>
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
      <SketchBtn>← Back</SketchBtn>
      <SketchBtn>Save draft</SketchBtn>
      <SketchBtn primary>Next: Financial model →</SketchBtn>
    </div>
  </>
);

Object.assign(window, { ProjectDetail, ProjectWizard });
