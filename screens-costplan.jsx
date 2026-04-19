// ============ COST PLANNING TAB (Master admin) ============
// Issue-tree of capability requirements → chosen vendor → cost.
// Tallies OPEX usage vs. OPEX contribution from active projects.

const CostPlanningTab = () => {
  const [mode, setMode] = React.useState('tree'); // tree | table | vendors
  const [expanded, setExpanded] = React.useState({ tech:true, legal:true, ops:true, people:false, finance:false, insurance:false, bd:false });
  const [openCap, setOpenCap] = React.useState(null); // {cap, group}
  const [addCap, setAddCap] = React.useState(null);   // group object or true

  // Capability issue-tree. Each leaf = required capability; with vendor + monthly cost.
  const tree = [
    { id:'tech', label:'Technology platform', note:'the firm\'s digital spine', children:[
      { cap:'AI / LLM platform',         vendor:'Claude Pro Team',         plan:'5 seats',         monthly: 750,  status:'live',  owner:'TT', must:true },
      { cap:'AI agents / automation',    vendor:'Zapier + n8n',            plan:'Business',        monthly: 240,  status:'live',  owner:'JS' },
      { cap:'Project management',        vendor:'ClickUp',                 plan:'Business · 12 seats', monthly: 228,  status:'live',  owner:'JS', must:true },
      { cap:'File store · source of truth', vendor:'Google Workspace',     plan:'Business Std · 12',  monthly: 240, status:'live',  owner:'JS', must:true },
      { cap:'Spreadsheet · workbooks',   vendor:'Microsoft 365 Business',  plan:'12 seats',        monthly: 300,  status:'live',  owner:'JS', must:true },
      { cap:'Team comms',                vendor:'Slack + WhatsApp Business', plan:'Pro',           monthly: 168,  status:'live',  owner:'JS' },
      { cap:'Video conferencing',        vendor:'Zoom',                    plan:'Business',        monthly: 180,  status:'live',  owner:'JS' },
      { cap:'Password manager',          vendor:'1Password',               plan:'Business · 12',   monthly: 96,   status:'live',  owner:'JS' },
      { cap:'Design / prototyping',      vendor:'Figma',                   plan:'Professional · 3',monthly: 54,   status:'live',  owner:'CC' },
      { cap:'Market intelligence',       vendor:'Evaluate Pharma',         plan:'2 seats',         monthly: 2400, status:'live',  owner:'MB', must:true },
      { cap:'Patent / IP data',          vendor:'Cortellis',               plan:'1 seat',          monthly: 1100, status:'live',  owner:'TT' },
      { cap:'Literature / references',   vendor:'PubMed · free',           plan:'—',               monthly: 0,    status:'live',  owner:'—' },
      { cap:'Website · marketing',       vendor:'Framer',                  plan:'Pro',             monthly: 45,   status:'live',  owner:'MB' },
      { cap:'CRM · BD pipeline',         vendor:'HubSpot (starter)',       plan:'Starter',         monthly: 90,   status:'review', owner:'MB', note:'evaluating Attio vs. native sheet' },
    ]},
    { id:'legal', label:'Legal & compliance', note:'contracts, IP, privacy', children:[
      { cap:'Legal counsel · retainer',  vendor:'Herbert Smith Freehills', plan:'Monthly retainer',monthly: 4500, status:'live',  owner:'TT', must:true },
      { cap:'Contract platform',         vendor:'Ironclad',                plan:'Essentials',      monthly: 680,  status:'live',  owner:'JS' },
      { cap:'E-signature',               vendor:'DocuSign',                plan:'Business Pro',    monthly: 85,   status:'live',  owner:'JS' },
      { cap:'Privacy / DPA',             vendor:'HSF · bundled',           plan:'in retainer',     monthly: 0,    status:'live',  owner:'TT' },
      { cap:'IP / trademark counsel',    vendor:'Spruson & Ferguson',      plan:'as-needed',       monthly: 400,  status:'live',  owner:'TT' },
    ]},
    { id:'insurance', label:'Insurance & indemnity', note:'professional cover', children:[
      { cap:'Professional indemnity',    vendor:'Berkley Re',              plan:'$10M cover · annual', monthly: 1850, status:'live', owner:'JS', must:true },
      { cap:'Public liability',          vendor:'QBE',                     plan:'$20M cover',      monthly: 420,  status:'live',  owner:'JS' },
      { cap:'Cyber insurance',           vendor:'Chubb',                   plan:'$5M cover',       monthly: 560,  status:'live',  owner:'JS' },
      { cap:'Directors & officers',      vendor:'AIG',                     plan:'$5M cover',       monthly: 380,  status:'live',  owner:'TT' },
      { cap:'WorkCover',                 vendor:'icare NSW',               plan:'statutory',       monthly: 260,  status:'live',  owner:'JS' },
    ]},
    { id:'finance', label:'Finance & accounting', children:[
      { cap:'Accounting platform',       vendor:'Xero',                    plan:'Business',        monthly: 85,   status:'live',  owner:'JS', must:true },
      { cap:'External bookkeeping',      vendor:'Ledger Co',               plan:'2d/wk',           monthly: 3200, status:'live',  owner:'JS' },
      { cap:'External tax / BAS',        vendor:'Pitcher Partners',        plan:'quarterly',       monthly: 1400, status:'live',  owner:'TT' },
      { cap:'Payroll',                   vendor:'Employment Hero',         plan:'Premium · 12',    monthly: 180,  status:'live',  owner:'JS' },
      { cap:'Expense capture / OCR',     vendor:'Dext',                    plan:'Business',        monthly: 110,  status:'live',  owner:'JS' },
      { cap:'Corp card · travel',        vendor:'Airwallex',               plan:'free tier',       monthly: 0,    status:'live',  owner:'TT' },
      { cap:'FX / treasury',             vendor:'Wise Business',           plan:'—',               monthly: 0,    status:'live',  owner:'TT' },
    ]},
    { id:'ops', label:'Office & operations', children:[
      { cap:'Office · HQ',               vendor:'WorkClub Martin Pl',      plan:'10 seats · HD',   monthly: 3800, status:'live',  owner:'JS', must:true },
      { cap:'Office · Melbourne hot-desk', vendor:'Hub Australia',         plan:'flex · 2',        monthly: 780,  status:'live',  owner:'SR' },
      { cap:'Office · Singapore access', vendor:'The Great Room',          plan:'Flex',            monthly: 640,  status:'live',  owner:'TT' },
      { cap:'IT / hardware',             vendor:'Apple Financial · lease', plan:'12 devices',      monthly: 1850, status:'live',  owner:'JS' },
      { cap:'Printer / scan',            vendor:'Ricoh',                   plan:'lease',           monthly: 120,  status:'live',  owner:'JS' },
      { cap:'Stationery · consumables',  vendor:'Officeworks',             plan:'monthly avg',     monthly: 180,  status:'live',  owner:'JS' },
    ]},
    { id:'people', label:'People & capability', note:'L&D, HR, wellbeing', children:[
      { cap:'HRIS',                      vendor:'Employment Hero',         plan:'bundled w/ payroll', monthly: 0, status:'live',  owner:'JS' },
      { cap:'Recruitment · exec search', vendor:'Russell Reynolds · as-needed', plan:'project-based', monthly: 0, status:'review',  owner:'MB' },
      { cap:'Learning & development',    vendor:'MasterClass for Business',plan:'8 seats',         monthly: 280,  status:'live',  owner:'MB' },
      { cap:'EAP · wellbeing',           vendor:'Sonder',                  plan:'12 seats',        monthly: 180,  status:'live',  owner:'JS' },
      { cap:'Team offsites',             vendor:'Various',                 plan:'accrual · 2/yr',  monthly: 2500, status:'live',  owner:'MB' },
    ]},
    { id:'bd', label:'BD & marketing', children:[
      { cap:'Conference · BIO',          vendor:'BIO International',       plan:'annual · 2 pax',  monthly: 1400, status:'live',  owner:'MB' },
      { cap:'Conference · JPM',          vendor:'JP Morgan HC conf',       plan:'annual · 1 pax',  monthly: 950,  status:'live',  owner:'TT' },
      { cap:'Industry memberships',      vendor:'AusBiotech + BioMelbourne',plan:'annual',         monthly: 320,  status:'live',  owner:'MB' },
      { cap:'Thought leadership · publishing', vendor:'Substack Pro',      plan:'—',               monthly: 25,   status:'live',  owner:'MB' },
      { cap:'Events · hosting',          vendor:'Various venues',          plan:'accrual',         monthly: 1200, status:'live',  owner:'MB' },
    ]},
  ];

  // Totals
  const groupTotals = tree.map(g => ({ id:g.id, label:g.label, total:g.children.reduce((a,c)=>a+c.monthly,0), n:g.children.length }));
  const totalOpex = groupTotals.reduce((a,g)=>a+g.total, 0);
  const totalAnnual = totalOpex * 12;

  // OPEX contribution (from active projects at firm default 20%)
  const activeProjects = [
    { code:'IFM001', value:600000,  opexPct:20 },
    { code:'GNC001', value:480000,  opexPct:20 },
    { code:'PAN001', value:520000,  opexPct:18 }, // override
    { code:'BMX001', value:320000,  opexPct:20 },
    { code:'ADX001', value:180000,  opexPct:20 },
    { code:'GNC002', value:240000,  opexPct:20 }, // retainer
  ];
  // contribution in the month = sum(monthly_contribution) where monthly_contribution ≈ project_value * opexPct% / project_duration_in_months
  // For illustration use flat estimate of 3-month avg run-rate
  const monthlyContribution = Math.round(activeProjects.reduce((a,p)=>a + (p.value * p.opexPct/100)/3, 0));
  const delta = monthlyContribution - totalOpex;
  const covRatio = Math.round((monthlyContribution/totalOpex)*100);

  const fmt = (n) => `$${n.toLocaleString()}`;

  return (<div className="stack">
    {/* ===== HERO: OPEX USAGE vs CONTRIBUTION ===== */}
    <div className="card">
      <div className="card-header">
        <h3>OPEX usage vs. contribution</h3>
        <div className="txt-sm txt-muted">monthly run-rate · firm default 20% of contract value feeds OPEX pool</div>
      </div>
      <div className="card-body">
        <div style={{ display:'grid', gridTemplateColumns:'1.3fr 1fr 1fr 1fr', gap:20, alignItems:'stretch' }}>
          <div>
            <div className="wl" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-3)', marginBottom:4 }}>Coverage</div>
            <div style={{ fontFamily:'var(--font-serif)', fontSize:42, fontWeight:400, letterSpacing:'-0.02em', lineHeight:1, color: covRatio>=100?'var(--green)':'var(--amber)' }}>{covRatio}%</div>
            <div className="txt-sm txt-muted" style={{ marginTop:4 }}>contribution covers OPEX</div>
            <div style={{ height:10, background:'var(--bg-elev)', borderRadius:5, overflow:'hidden', marginTop:10, position:'relative' }}>
              <div style={{ width:`${Math.min(covRatio,150)*0.66}%`, height:'100%', background: covRatio>=100?'var(--green)':'var(--amber)' }}/>
              <div style={{ position:'absolute', left:'66%', top:-2, width:1, height:14, background:'var(--text-3)' }} title="100% line"/>
            </div>
            <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:4 }}>dashed line = 100% coverage</div>
          </div>

          <div>
            <div className="wl" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-3)', marginBottom:4 }}>OPEX contribution (in)</div>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:26, fontWeight:500 }}>{fmt(monthlyContribution)}</div>
            <div className="txt-sm txt-muted">from {activeProjects.length} active projects · mo run-rate</div>
            <div className="hdiv"/>
            <div className="stack" style={{ gap:3 }}>
              {activeProjects.map(p=>(
                <div key={p.code} className="row-spread" style={{ fontSize:11, cursor:'pointer' }} onClick={()=>window.__nav && window.__nav('projects', { projectCode: p.code })}>
                  <span className="mono">{p.code}</span>
                  <span className="mono txt-muted">{fmt(Math.round((p.value*p.opexPct/100)/3))}/mo</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="wl" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-3)', marginBottom:4 }}>OPEX usage (out)</div>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:26, fontWeight:500 }}>{fmt(totalOpex)}</div>
            <div className="txt-sm txt-muted">{fmt(totalAnnual)} annualised · {groupTotals.reduce((a,g)=>a+g.n,0)} vendors</div>
            <div className="hdiv"/>
            <div className="stack" style={{ gap:3 }}>
              {groupTotals.sort((a,b)=>b.total-a.total).slice(0,5).map(g=>(
                <div key={g.id} className="row-spread" style={{ fontSize:11 }}>
                  <span>{g.label}</span>
                  <span className="mono txt-muted">{fmt(g.total)}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="wl" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-3)', marginBottom:4 }}>Delta</div>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:26, fontWeight:500, color: delta>=0?'var(--green)':'var(--red)' }}>{delta>=0?'+':''}{fmt(delta)}</div>
            <div className="txt-sm txt-muted">{delta>=0?'surplus to firm reserve':'shortfall drawn from partner account'}</div>
            <div className="hdiv"/>
            <div className="txt-sm txt-muted" style={{ fontSize:11, lineHeight:1.55 }}>
              If contribution &gt; usage, surplus flows to <b>firm reserve</b> (3-mo cash buffer target).<br/>
              If &lt;, shortfall is covered from <b>partner account</b> quarterly.
            </div>
            <Btn sm style={{ marginTop:8 }} icon="arrow">Open reserve ledger</Btn>
          </div>
        </div>

        {/* Stacked bar — contribution vs. usage breakdown */}
        <div className="hdiv"/>
        <div style={{ display:'grid', gridTemplateColumns:'100px 1fr', gap:14, alignItems:'center' }}>
          <div className="txt-sm txt-muted">Contribution</div>
          <div style={{ display:'flex', height:26, borderRadius:4, overflow:'hidden', border:'1px solid var(--border)' }}>
            {activeProjects.map((p,i)=>{
              const c = Math.round((p.value*p.opexPct/100)/3);
              return <div key={i} style={{ flex:c, background:`hsl(${160+i*12}, 28%, ${38+i*4}%)`, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:10, fontFamily:'var(--font-mono)' }} title={`${p.code}: ${fmt(c)}/mo`}>{p.code}</div>;
            })}
          </div>
          <div className="txt-sm txt-muted">Usage</div>
          <div style={{ display:'flex', height:26, borderRadius:4, overflow:'hidden', border:'1px solid var(--border)' }}>
            {groupTotals.map((g,i)=>(
              <div key={g.id} style={{ flex:g.total, background:`hsl(${22+i*18}, 40%, ${42+i*3}%)`, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:10 }} title={`${g.label}: ${fmt(g.total)}/mo`}>{g.label.split(' ')[0]}</div>
            ))}
          </div>
        </div>
      </div>
    </div>

    {/* ===== TOOLBAR ===== */}
    <div className="row gap-sm" style={{ alignItems:'center', flexWrap:'wrap' }}>
      <div className="role-switcher">
        <button className={mode==='tree'?'active':''} onClick={()=>setMode('tree')}>Issue tree</button>
        <button className={mode==='table'?'active':''} onClick={()=>setMode('table')}>Flat table</button>
        <button className={mode==='vendors'?'active':''} onClick={()=>setMode('vendors')}>By vendor</button>
      </div>
      <div className="ml-auto row gap-sm">
        <Btn sm icon="plus" onClick={()=>setAddCap({id:'tech', label:'Technology platform'})}>Add capability</Btn>
        <Btn sm icon="download">Export</Btn>
        <XlsxPill state="synced">Cost Plan.xlsx</XlsxPill>
      </div>
    </div>

    {/* ===== ISSUE TREE ===== */}
    {mode==='tree' && (
      <div className="stack">
        {tree.map(group => {
          const isOpen = expanded[group.id];
          const gTotal = group.children.reduce((a,c)=>a+c.monthly,0);
          const gPct = Math.round((gTotal/totalOpex)*100);
          return (
            <div key={group.id} className="card">
              <div className="card-header" style={{ cursor:'pointer' }} onClick={()=>setExpanded(e=>({...e, [group.id]:!e[group.id]}))}>
                <div className="row gap-sm" style={{ alignItems:'baseline' }}>
                  <span style={{ fontFamily:'var(--font-mono)', color:'var(--text-3)', width:18, display:'inline-block' }}>{isOpen?'▾':'▸'}</span>
                  <h3 style={{ margin:0 }}>{group.label}</h3>
                  {group.note && <span className="txt-sm txt-muted">· {group.note}</span>}
                </div>
                <div className="row gap-sm" style={{ alignItems:'center' }}>
                  <Badge>{group.children.length} capabilities</Badge>
                  <span className="mono" style={{ fontSize:14, fontWeight:600 }}>{fmt(gTotal)}/mo</span>
                  <Badge tone="accent">{gPct}% of OPEX</Badge>
                </div>
              </div>
              {isOpen && (
                <div style={{ padding:'0 0 6px' }}>
                  {/* column header */}
                  <div style={{ display:'grid', gridTemplateColumns:'260px 1fr 180px 110px 80px 40px', gap:12, padding:'6px 18px', fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-3)', borderTop:'1px solid var(--divider)', borderBottom:'1px solid var(--divider)', background:'var(--bg-elev)' }}>
                    <div>Capability</div><div>Vendor · plan</div><div className="num">Monthly</div><div>Status</div><div>Owner</div><div/>
                  </div>
                  {group.children.map((c,i)=>{
                    const pctOfGroup = Math.round((c.monthly/gTotal)*100);
                    return (
                      <div key={i} onClick={()=>setOpenCap({cap:c, group})} style={{ display:'grid', gridTemplateColumns:'260px 1fr 180px 110px 80px 40px', gap:12, padding:'10px 18px', alignItems:'center', borderBottom:'1px solid var(--divider)', fontSize:13, cursor:'pointer' }}
                        onMouseEnter={e=>e.currentTarget.style.background='var(--bg-elev)'} onMouseLeave={e=>e.currentTarget.style.background=''}>
                        <div>
                          <div style={{ fontWeight:600, display:'flex', alignItems:'center', gap:6 }}>
                            {c.cap}
                            {c.must && <span title="Must-have / non-optional" style={{ fontSize:9, padding:'1px 6px', border:'1px solid var(--border)', borderRadius:3, color:'var(--text-3)', fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'.05em' }}>core</span>}
                          </div>
                          {c.note && <div className="txt-sm txt-muted" style={{ fontSize:11 }}>{c.note}</div>}
                        </div>
                        <div>
                          <div style={{ fontWeight:500 }}>{c.vendor}</div>
                          <div className="txt-sm txt-muted" style={{ fontSize:11 }}>{c.plan}</div>
                        </div>
                        <div className="num">
                          <div className="mono" style={{ fontWeight:600 }}>{fmt(c.monthly)}</div>
                          <div style={{ height:3, background:'var(--bg-elev)', borderRadius:2, marginTop:4, overflow:'hidden' }}>
                            <div style={{ width:`${pctOfGroup}%`, height:'100%', background:'var(--brand)' }}/>
                          </div>
                        </div>
                        <div>
                          {c.status==='live' && <Badge tone="green" dot>live</Badge>}
                          {c.status==='review' && <Badge tone="amber" dot>review</Badge>}
                          {c.status==='gap' && <Badge tone="red" dot>gap</Badge>}
                        </div>
                        <div>{c.owner!=='—' ? <Avatar size={24}>{c.owner}</Avatar> : <span className="txt-sm txt-muted">—</span>}</div>
                        <Btn sm ghost>⋯</Btn>
                      </div>
                    );
                  })}
                  {/* gap row — add capability */}
                  <div style={{ padding:'10px 18px', borderTop:'1px dashed var(--divider)', fontSize:12 }}>
                    <Btn sm icon="plus" ghost onClick={()=>setAddCap(group)}>Add capability to {group.label}</Btn>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    )}

    {/* ===== FLAT TABLE ===== */}
    {mode==='table' && (
      <div className="card">
        <div className="card-header"><h3>All capabilities · flat</h3><div className="txt-sm txt-muted">{groupTotals.reduce((a,g)=>a+g.n,0)} rows · sortable</div></div>
        <table className="tbl">
          <thead><tr><th>Category</th><th>Capability</th><th>Vendor · plan</th><th className="num">Monthly</th><th className="num">Annual</th><th>Status</th><th>Owner</th></tr></thead>
          <tbody>
            {tree.flatMap(g => g.children.map((c,i)=>(
              <tr key={g.id+i} style={{ cursor:'pointer' }} onClick={()=>setOpenCap({cap:c, group:g})}>
                <td><Badge>{g.label}</Badge></td>
                <td><b>{c.cap}</b>{c.must && <span style={{ marginLeft:6, fontSize:9, padding:'1px 5px', border:'1px solid var(--border)', borderRadius:3, color:'var(--text-3)', fontFamily:'var(--font-mono)' }}>core</span>}</td>
                <td>{c.vendor} <span className="txt-muted">· {c.plan}</span></td>
                <td className="num mono">{fmt(c.monthly)}</td>
                <td className="num mono txt-muted">{fmt(c.monthly*12)}</td>
                <td><Badge tone={c.status==='live'?'green':c.status==='review'?'amber':'red'} dot>{c.status}</Badge></td>
                <td>{c.owner!=='—' ? <Avatar size={22}>{c.owner}</Avatar> : '—'}</td>
              </tr>
            )))}
            <tr style={{ background:'var(--bg-elev)', fontWeight:600 }}>
              <td colSpan={3}>TOTAL</td>
              <td className="num mono">{fmt(totalOpex)}</td>
              <td className="num mono">{fmt(totalAnnual)}</td>
              <td colSpan={2}/>
            </tr>
          </tbody>
        </table>
      </div>
    )}

    {/* ===== BY VENDOR ===== */}
    {mode==='vendors' && (
      <div className="card">
        <div className="card-header"><h3>By vendor · consolidated</h3><div className="txt-sm txt-muted">where we use the same vendor across multiple capabilities</div></div>
        <table className="tbl">
          <thead><tr><th>Vendor</th><th>Capabilities</th><th className="num">Monthly</th><th className="num">Annual</th><th>Renewal</th></tr></thead>
          <tbody>
            {(() => {
              const byV = {};
              tree.forEach(g=>g.children.forEach(c=>{ (byV[c.vendor]=byV[c.vendor]||{caps:[], total:0}); byV[c.vendor].caps.push(c.cap); byV[c.vendor].total+=c.monthly; }));
              const rows = Object.entries(byV).sort((a,b)=>b[1].total-a[1].total);
              const renewals = ['Feb 2027','May 2026','Aug 2026','Jan 2027','Nov 2026','monthly','annual'];
              return rows.map(([v, d], i)=>{
                // find first matching capability to open
                let firstCap=null, firstGroup=null;
                outer: for (const g of tree) { for (const c of g.children) { if (c.vendor===v) { firstCap=c; firstGroup=g; break outer; } } }
                return (
                <tr key={v} style={{ cursor:'pointer' }} onClick={()=> firstCap && setOpenCap({cap:firstCap, group:firstGroup})}>
                  <td><b>{v}</b></td>
                  <td><div className="txt-sm">{d.caps.slice(0,3).join(' · ')}{d.caps.length>3 && <span className="txt-muted"> +{d.caps.length-3} more</span>}</div></td>
                  <td className="num mono">{fmt(d.total)}</td>
                  <td className="num mono txt-muted">{fmt(d.total*12)}</td>
                  <td className="txt-sm txt-muted">{renewals[i%renewals.length]}</td>
                </tr>
              );});
            })()}
          </tbody>
        </table>
      </div>
    )}

    {/* ===== GAPS / REVIEW ===== */}
    <div className="card">
      <div className="card-header"><h3>Watchlist</h3><div className="txt-sm txt-muted">capabilities under review or identified as gaps</div></div>
      <div className="card-body">
        <div className="stack" style={{ gap:8 }}>
          {(() => {
            const find = (capName) => { for (const g of tree) { for (const c of g.children) { if (c.cap===capName) return {cap:c, group:g}; } } return null; };
            return [
              { title:'CRM · BD pipeline — under review', tone:'amber', body:'HubSpot Starter at $90/mo duplicates what Pipeline.xlsx does. TT to decide Q2: drop, upgrade to Attio, or standardise on sheet.', match: find('CRM · BD pipeline') },
              { title:'Exec search — no retained partner', tone:'amber', body:'Project-based only. If hiring 2+ senior consultants this year, retainer with Russell Reynolds may reduce blended cost.', match: find('Recruitment · exec search') },
              { title:'AI platform — renegotiate in Aug', tone:'info',  body:'Claude seats growing 5→12. Negotiate enterprise tier; projected saving ~$300/mo.', match: find('AI / LLM platform') },
            ].map((w,i)=>(
              <div key={i} style={{ cursor: w.match?'pointer':'default' }} onClick={()=>w.match && setOpenCap(w.match)}>
                <Callout tone={w.tone} title={w.title}><span className="txt-sm">{w.body}{w.match && <span style={{ marginLeft:6, color:'var(--brand)', fontWeight:500 }}>Open capability →</span>}</span></Callout>
              </div>
            ));
          })()}
        </div>
      </div>
    </div>

    {openCap && <CapabilityDrawer cap={openCap.cap} group={openCap.group} onClose={()=>setOpenCap(null)}/>}
    {addCap && <AddCapabilityModal group={addCap} onClose={()=>setAddCap(null)}/>}
  </div>);
};

Object.assign(window, { CostPlanningTab });
