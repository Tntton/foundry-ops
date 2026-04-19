// Partner true-up drawer — deep view of one partner's Q

const TrueUpPartnerDrawer = ({ p, onClose }) => {
  const [tab, setTab] = React.useState('breakdown');
  if (!p) return null;
  const [code, name, role, perDiem, projShare, bdRef, compBuild, ownership, proposed, status] = p;
  const statusTone = { signed:'green', disputed:'red', pending:'amber' };

  const projects = [
    { code:'IFM001', client:'IFM', hours:246, rate:'$2,000/d', base:'$123,000', share:'$22,000' },
    { code:'PNC001', client:'Panacea', hours:152, rate:'$2,000/d', base:'$76,000', share:'$14,000' },
  ];
  const bdItems = [
    { deal:'GNC002', role:'co-sell', fee:'$8k' },
    { deal:'NXS001', role:'warm intro', fee:'$6k' },
  ];
  const firmItems = [
    { cat:'Hiring — 2 FT roles',       hours:36, owner:'MB', ref:'FHO004' },
    { cat:'MSA refresh',                hours:18, owner:'MB', ref:'FHO003' },
    { cat:'FinXL audit coordination',   hours:14, owner:'MB', ref:'FHO003' },
  ];

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e=>e.stopPropagation()} style={{ width: 820 }}>
        <div className="drawer-header">
          <div>
            <div className="txt-sm txt-muted">Partner true-up · Q3 FY26</div>
            <h2 style={{ margin:'4px 0 0', fontFamily:'var(--font-serif)', fontWeight:400, fontSize:24 }}>{code} — {name}</h2>
            <div className="row gap-sm" style={{ marginTop:6, alignItems:'center' }}>
              <Badge>{role}</Badge>
              <span className="mono" style={{ fontWeight:600 }}>proposed {proposed}</span>
              <Badge tone={statusTone[status]} dot>{status}</Badge>
            </div>
          </div>
          <div className="row gap-sm">
            <Btn sm icon="download">Export PDF</Btn>
            <Btn sm ghost onClick={onClose}>✕</Btn>
          </div>
        </div>

        <div className="tabs" style={{ padding:'0 20px' }}>
          {[['breakdown','Breakdown'],['projects','Projects'],['bd','BD · referrals'],['firm','Firm-building'],['ledger','Ledger']].map(([k,l])=>(<div key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</div>))}
        </div>

        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          {tab==='breakdown' && <div className="stack">
            <div className="card">
              <div className="card-header"><h3>Component totals</h3></div>
              <div className="card-body">
                {[['Per-diem base', perDiem, 'from Timesheet.xlsx', 'var(--text)'],['Project LT share', projShare, 'post-OPEX residual', 'var(--blue)'],['BD referrals', bdRef, 'capped framework', 'var(--accent)'],['Firm-building', compBuild, 'FHO003 + FHO004 hours', 'var(--green)'],['Ownership / stewardship', ownership, 'partner cadence · culture', 'var(--amber)']].map((r,i)=>(
                  <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'10px 0', borderBottom:'1px solid var(--divider)' }}>
                    <div><b style={{ color:r[3] }}>{r[0]}</b><div className="txt-sm txt-muted">{r[2]}</div></div>
                    <b className="mono" style={{ fontSize:16 }}>{r[1]}</b>
                  </div>
                ))}
                <div style={{ display:'flex', justifyContent:'space-between', padding:'12px 0 0', fontSize:18 }}>
                  <b>Proposed total</b><b className="mono" style={{ color:'var(--brand)' }}>{proposed}</b>
                </div>
              </div>
            </div>
            {status==='disputed' && <Callout tone="warn" title="Dispute raised"><span className="txt-sm">BD weighting challenged on NXS001. Re-review scheduled with TT + SR.</span></Callout>}
          </div>}

          {tab==='projects' && <div className="card">
            <div className="card-header"><h3>Projects — per-diem + residual</h3></div>
            <table className="tbl">
              <thead><tr><th>Code</th><th>Client</th><th className="num">Hours</th><th className="num">Rate</th><th className="num">Base</th><th className="num">LT share</th></tr></thead>
              <tbody>{projects.map((r,i)=>(
                <tr key={i} style={{ cursor:'pointer' }} onClick={()=>{ onClose&&onClose(); window.__nav && window.__nav('projects', { projectCode:r.code }); }}>
                  <td className="code-cell">{r.code}</td><td>{r.client}</td><td className="num">{r.hours}h</td><td className="num mono">{r.rate}</td><td className="num mono">{r.base}</td><td className="num mono">{r.share}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>}

          {tab==='bd' && <div className="card">
            <div className="card-header"><h3>BD referrals this Q</h3></div>
            <table className="tbl">
              <thead><tr><th>Deal</th><th>Role</th><th className="num">Fee</th></tr></thead>
              <tbody>{bdItems.map((r,i)=>(
                <tr key={i} style={{ cursor:'pointer' }} onClick={()=>{ onClose&&onClose(); window.__nav && window.__nav('bd'); }}>
                  <td className="code-cell">{r.deal}</td><td>{r.role}</td><td className="num mono">{r.fee}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>}

          {tab==='firm' && <div className="card">
            <div className="card-header"><h3>Firm-building — logged hours</h3></div>
            <table className="tbl">
              <thead><tr><th>Category</th><th className="num">Hours</th><th>Owner</th><th>Ref</th></tr></thead>
              <tbody>{firmItems.map((r,i)=>(
                <tr key={i}><td>{r.cat}</td><td className="num">{r.hours}h</td><td><Avatar size={22}>{r.owner}</Avatar></td><td className="code-cell">{r.ref}</td></tr>
              ))}</tbody>
            </table>
          </div>}

          {tab==='ledger' && <div className="card">
            <div className="card-header"><h3>Historical ledger</h3></div>
            <table className="tbl">
              <thead><tr><th>Quarter</th><th className="num">Per-diem</th><th className="num">Project</th><th className="num">BD</th><th className="num">Firm</th><th className="num">Ownership</th><th className="num">Total</th></tr></thead>
              <tbody>
                <tr><td>Q2 FY26</td><td className="num mono">$142k</td><td className="num mono">$32k</td><td className="num mono">$11k</td><td className="num mono">$14k</td><td className="num mono">$16k</td><td className="num mono"><b>$215k</b></td></tr>
                <tr><td>Q1 FY26</td><td className="num mono">$136k</td><td className="num mono">$28k</td><td className="num mono">$9k</td><td className="num mono">$12k</td><td className="num mono">$14k</td><td className="num mono"><b>$199k</b></td></tr>
                <tr><td>Q4 FY25</td><td className="num mono">$128k</td><td className="num mono">$22k</td><td className="num mono">$6k</td><td className="num mono">$10k</td><td className="num mono">$12k</td><td className="num mono"><b>$178k</b></td></tr>
              </tbody>
            </table>
          </div>}
        </div>

        <div className="drawer-footer" style={{ borderTop:'1px solid var(--border)', padding:'12px 20px', display:'flex', gap:8, justifyContent:'space-between' }}>
          {status==='disputed' ? <Btn sm primary>Open partner review</Btn> : <Btn sm ghost style={{ color:'var(--red)' }}>Dispute</Btn>}
          <div className="row gap-sm"><Btn sm>Re-weight</Btn><Btn sm primary>Sign off</Btn></div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { TrueUpPartnerDrawer });
