// screens.jsx - all screens in one file to keep context tight

// ============ DASHBOARD ============
const DASH_SECTIONS_DEFAULT = [
  { id:'kpis',      label:'KPI row',                visible:true, collapsed:false },
  { id:'waterfall', label:'FY26 waterfall + Attention', visible:true, collapsed:false },
  { id:'opex',      label:'OPEX tracker',           visible:true, collapsed:false },
  { id:'portfolio', label:'Project portfolio',      visible:true, collapsed:false },
];
const DASH_LS_KEY = 'foundry.dash.sections.v1';

const loadDashSections = () => {
  try {
    const raw = localStorage.getItem(DASH_LS_KEY);
    if (!raw) return DASH_SECTIONS_DEFAULT;
    const parsed = JSON.parse(raw);
    // reconcile: ensure all default sections present, keep saved order/state
    const byId = Object.fromEntries(parsed.map(s => [s.id, s]));
    const merged = [
      ...parsed.filter(s => DASH_SECTIONS_DEFAULT.find(d => d.id === s.id)),
      ...DASH_SECTIONS_DEFAULT.filter(d => !byId[d.id]),
    ];
    return merged.map(s => ({ ...DASH_SECTIONS_DEFAULT.find(d=>d.id===s.id), ...s }));
  } catch(_) { return DASH_SECTIONS_DEFAULT; }
};

const DashSection = ({ id, label, collapsed, onToggleCollapse, onHide, dragHandlers, children }) => (
  <div
    style={{ marginBottom: 16, position:'relative' }}
    className={`dash-section${dragHandlers?.dragging?' dragging':''}${dragHandlers?.dropTarget?' drop-target':''}`}
    onDragOver={dragHandlers?.onDragOver}
    onDragLeave={dragHandlers?.onDragLeave}
    onDrop={dragHandlers?.onDrop}
  >
    <div className="dash-section-header"
      draggable={!!dragHandlers}
      onDragStart={dragHandlers?.onDragStart}
      onDragEnd={dragHandlers?.onDragEnd}
    >
      <span className="dash-grip" title="Drag to reorder">⋮⋮</span>
      <span className="dash-section-label">{label}</span>
      <div className="dash-section-actions">
        <button className="dash-icon-btn" onClick={onToggleCollapse} title={collapsed?'Expand':'Collapse'}>{collapsed?'▸':'▾'}</button>
        <button className="dash-icon-btn" onClick={onHide} title="Hide section">✕</button>
      </div>
    </div>
    {!collapsed && <div className="dash-section-body">{children}</div>}
  </div>
);

const Dashboard = () => {
  const go = (id, opts) => window.__nav && window.__nav(id, opts);
  const [sections, setSections] = React.useState(loadDashSections);
  const [configMode, setConfigMode] = React.useState(false);
  const [dragId, setDragId] = React.useState(null);
  const [dropId, setDropId] = React.useState(null);
  const [addOpen, setAddOpen] = React.useState(false);

  React.useEffect(()=>{ try { localStorage.setItem(DASH_LS_KEY, JSON.stringify(sections)); } catch(_){} }, [sections]);

  const toggleCollapse = (id) => setSections(ss => ss.map(s => s.id===id?{...s, collapsed:!s.collapsed}:s));
  const hide = (id) => setSections(ss => ss.map(s => s.id===id?{...s, visible:false}:s));
  const show = (id) => setSections(ss => ss.map(s => s.id===id?{...s, visible:true}:s));
  const resetLayout = () => setSections(DASH_SECTIONS_DEFAULT);
  const moveSection = (from, to) => {
    if (from===to) return;
    setSections(ss => {
      const next = [...ss];
      const fromIdx = next.findIndex(s => s.id===from);
      const toIdx = next.findIndex(s => s.id===to);
      if (fromIdx<0 || toIdx<0) return ss;
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const makeDragHandlers = (id) => configMode ? {
    dragging: dragId===id,
    dropTarget: dropId===id && dragId && dragId!==id,
    onDragStart: (e)=>{ setDragId(id); e.dataTransfer.effectAllowed='move'; try{ e.dataTransfer.setData('text/plain', id); }catch(_){} },
    onDragEnd: ()=>{ setDragId(null); setDropId(null); },
    onDragOver: (e)=>{ if(dragId && dragId!==id){ e.preventDefault(); e.dataTransfer.dropEffect='move'; if(dropId!==id) setDropId(id); } },
    onDragLeave: (e)=>{ if(!e.currentTarget.contains(e.relatedTarget)) setDropId(null); },
    onDrop: (e)=>{ e.preventDefault(); if(dragId) moveSection(dragId, id); setDragId(null); setDropId(null); },
  } : null;

  const hiddenSections = sections.filter(s => !s.visible);

  const renderSection = (s) => {
    if (!s.visible) return null;
    const common = {
      key:s.id, id:s.id, label:s.label,
      collapsed:s.collapsed,
      onToggleCollapse:()=>toggleCollapse(s.id),
      onHide:()=>hide(s.id),
      dragHandlers: makeDragHandlers(s.id),
    };
    if (s.id==='kpis') return (
      <DashSection {...common}>
        <div className="grid g4">
          <KPI label="FY26 Revenue" value="$1.42M" sub="71% of $2.0M target" subTone="green" delta="↑" spark={[30,45,38,60,55,72,68,85]} onClick={()=>go('reports')} style={{ cursor:'pointer' }}/>
          <KPI label="Active projects" value="7" sub="3 delivery · 2 closing · 2 kickoff" onClick={()=>go('projects')} style={{ cursor:'pointer' }}/>
          <KPI label="Weighted pipeline" value="$2.10M" sub="2.4× coverage" subTone="green" delta="↑" spark={[55,60,48,62,70,65,78,82]} onClick={()=>go('bd')} style={{ cursor:'pointer' }}/>
          <KPI label="Partner utilisation" value="62%" sub="target 30–50%" subTone="amber" delta="↑" onClick={()=>go('resource')} style={{ cursor:'pointer' }}/>
        </div>
      </DashSection>
    );
    if (s.id==='waterfall') return (
      <DashSection {...common}>
        <div className="grid g-main-side">
          <div className="card">
            <div className="card-header">
              <div>
                <h3>FY26 waterfall</h3>
                <div className="txt-sm txt-muted" style={{ marginTop: 2 }}>Firm P&amp;L cascade · click any bar to drill into underlying projects, invoices, or expenses</div>
              </div>
              <div className="row gap-sm">
                <Badge tone="">FY26 YTD</Badge>
                <Btn sm ghost icon="download">Export</Btn>
                <Btn sm primary onClick={()=>window.__nav && window.__nav('pnl')}>Open P&amp;L →</Btn>
              </div>
            </div>
            <div className="card-body">
              <FirmWaterfall/>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3>Needs your attention</h3><span className="badge red" style={{ cursor:'pointer' }} onClick={()=>go('approvals')}><span className="dot"/>3 urgent</span></div>
            <div className="list">
              {[
                ['high','Approve GNC001 invoice #14','$48,000 · over $20k threshold','TT · 2d','approvals'],
                ['med','Travel over-budget · IFM001','+$1,400 (+30%) over line','MB · today','project','IFM001','exp'],
                ['med','Invoices.xlsx conflict','2 rows differ from web','now','invoices'],
                ['low','PNC002 proposal due','$680k · Panacea follow-on','Fri','bd'],
                ['low','IFM001 AR aging','Invoice #11 · 42d outstanding','JS','project','IFM001','inv'],
              ].map((r,i)=>(
                <div key={i} className="list-item" style={{ cursor:'pointer' }} onClick={()=>{
                  if (r[4]==='project') go('projects', { projectCode: r[5], tab: r[6] });
                  else go(r[4]);
                }}>
                  <div className="main"><span className={`sev ${r[0]}`} style={{ width:8,height:8,borderRadius:4,background: r[0]==='high'?'var(--red)':r[0]==='med'?'var(--amber)':'var(--text-4)', flexShrink:0 }}/><div><div style={{ fontWeight:500 }}>{r[1]}</div><div className="txt-sm txt-muted">{r[2]}</div></div></div>
                  <div className="right">{r[3]}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DashSection>
    );
    if (s.id==='opex') return (
      <DashSection {...common}>
        <OpexTrackerCard/>
      </DashSection>
    );
    if (s.id==='portfolio') return (
      <DashSection {...common}>
        <div className="card">
          <div className="card-header">
            <div><h3>Project portfolio</h3><div className="txt-sm txt-muted" style={{ marginTop:2 }}>7 active projects · live from Finance.xlsx</div></div>
            <div className="row gap-sm"><Btn sm icon="filter">Filter</Btn><Btn sm icon="plus" primary onClick={()=>go('wizard')}>New project</Btn></div>
          </div>
          <table className="tbl">
            <thead><tr><th>Code</th><th>Client / project</th><th>Stage</th><th className="num">Contract</th><th className="num">Billed</th><th className="num">Exp %</th><th className="num">Margin</th><th>Team</th><th>Sync</th></tr></thead>
            <tbody>
              {[
                ['IFM001','Integrated Market · Diligence Strategy','delivery','blue','$600,000','$380,000','48%','31%',['MB','CC','TT','JB'],'synced'],
                ['GNC001','Genica · Portfolio Review','closing','green','$420,000','$420,000','54%','26%',['SR','MB','JB'],'synced'],
                ['PNC001','Panacea · Market Entry','delivery','blue','$780,000','$310,000','46%','34%',['TT','CC','AP'],'stale'],
                ['BMX001','Biomax · Diligence','kickoff','amber','$250,000','—','—','—',['MB'],'synced'],
                ['ADX001','Adexa · Strategic Retainer','delivery','blue','$180,000','$120,000','41%','38%',['SR'],'synced'],
              ].map((r,i)=>(
                <tr key={i} style={{ cursor:'pointer' }} onClick={()=>go('projects', { projectCode: r[0] })}>
                  <td className="code-cell">{r[0]}</td>
                  <td>{r[1]}</td>
                  <td><Badge tone={r[3]}><span className="dot"/>{r[2]}</Badge></td>
                  <td className="num">{r[4]}</td>
                  <td className="num">{r[5]}</td>
                  <td className="num">{r[6]}</td>
                  <td className="num" style={{ color: r[7]==='—'?'var(--text-4)':parseInt(r[7])>30?'var(--green)':'var(--amber)' }}>{r[7]}</td>
                  <td><AvatarStack items={r[8].map(n=>({name:n}))}/></td>
                  <td><XlsxPill state={r[9]} children={r[9]==='synced'?'synced':'stale'}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DashSection>
    );
    return null;
  };

  return (
  <>
    <div className="row" style={{ marginBottom: 12, gap:8 }}>
      <div className="ml-auto row gap-sm">
        {configMode && hiddenSections.length>0 && (
          <div className="dash-add-menu">
            <Btn sm icon="plus" onClick={()=>setAddOpen(o=>!o)}>Add section ({hiddenSections.length})</Btn>
            {addOpen && (
              <div className="dash-add-pop">
                {hiddenSections.map(s => (
                  <button key={s.id} className="dash-add-item" onClick={()=>{ show(s.id); setAddOpen(false); }}>+ {s.label}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {configMode && <Btn sm ghost onClick={resetLayout}>Reset layout</Btn>}
        <Btn sm ghost={!configMode} primary={configMode} icon={configMode?'check':undefined} onClick={()=>{ setConfigMode(m=>!m); setAddOpen(false); }}>{configMode?'Done':'✎ Customise layout'}</Btn>
      </div>
    </div>
    {configMode && (
      <div className="dash-config-banner">
        <span>✎ Customise layout — drag sections by the header, collapse with ▾, hide with ✕. Changes save automatically.</span>
      </div>
    )}
    <div className={configMode?'dash-config-on':''}>
      {sections.map(renderSection)}
    </div>
  </>
  );
};

// ============ FIRM WATERFALL (dashboard) ============
// Wraps the P&L screen's InteractiveWaterfall — same chart, same drill-downs, plus the
// Booked↔Cash toggle — so the dashboard and /pnl share a single source of truth.
const FirmWaterfall = () => {
  const [wfMode, setWfMode] = React.useState(() => localStorage.getItem('foundry.dash.wfMode') || 'booked');
  React.useEffect(()=>{ localStorage.setItem('foundry.dash.wfMode', wfMode); }, [wfMode]);

  const scenario = window.PNL_BASELINE || {
    booked:2460, unbilled:540, invoiced:1920, ar:280, paid:1640,
    projCost:790, gm:850, opex:240, ebit:610, taxReserve:220, profit:390,
  };

  const openDrill = (stage) => {
    window.__pnlDrill = stage;
    window.__pnlWfMode = wfMode;
    window.__nav && window.__nav('pnl');
  };

  return (
    <div>
      <div className="row-spread" style={{ marginBottom:10 }}>
        <div className="txt-sm txt-muted" style={{ fontStyle:'italic' }}>
          {wfMode==='cash'
            ? 'Actual cash movements YTD — collected in, vendor/payroll/OPEX/tax paid out, leaves realised cash in the bank.'
            : 'Contracted revenue flowing through forecasted delivery, overheads, and tax reserve to projected partner profit.'}
        </div>
        <div className="segmented">
          <button className={wfMode==='booked'?'active':''} onClick={()=>setWfMode('booked')}>Booked &rarr; projected</button>
          <button className={wfMode==='cash'?'active':''} onClick={()=>setWfMode('cash')}>Actual cash flow</button>
        </div>
      </div>

      {window.InteractiveWaterfall
        ? <window.InteractiveWaterfall scenario={scenario} mode={wfMode} onDrill={openDrill}/>
        : <div className="txt-sm txt-muted" style={{ padding:40, textAlign:'center' }}>Waterfall loading…</div>}

      <div className="hdiv"/>
      <div className="grid" style={{ gridTemplateColumns:'1fr 1fr 1fr 1fr', gap: 12 }}>
        <WfKpi label="Book-to-cash conversion" value="67%" sub="$1.64M of $2.46M booked" tone="amber" note="A/R aging drags · chase Invoice #11 (IFM001, 42d)" onClick={()=>openDrill('ar')}/>
        <WfKpi label="Gross margin" value="44%" sub="$850k of $1.92M invoiced" tone="green" note="above 40% target" onClick={()=>openDrill('gm')}/>
        <WfKpi label="OPEX coverage" value="28%" sub="$240k vs contribution pool" tone="green" note="contribution 4.4× OPEX" onClick={()=>openDrill('opex')}/>
        <WfKpi label="Partner profit / partner" value="$130k" sub="$390k distributable ÷ 3" tone="green" note="pre-true-up · weighted" onClick={()=>openDrill('profit')}/>
      </div>
    </div>
  );
};

const WfKpi = ({ label, value, sub, tone, note, onClick }) => {
  const color = tone==='green' ? 'var(--green)' : tone==='amber' ? 'var(--amber)' : 'var(--text)';
  return (
    <div style={{ border:'1px solid var(--divider)', borderRadius:6, padding:'10px 12px', background:'#fff', cursor: onClick?'pointer':'default', transition:'border-color .15s, box-shadow .15s' }} onClick={onClick} onMouseEnter={onClick?e=>{e.currentTarget.style.borderColor='var(--brand)'; e.currentTarget.style.boxShadow='0 1px 4px rgba(30,58,52,.08)';}:undefined} onMouseLeave={onClick?e=>{e.currentTarget.style.borderColor='var(--divider)'; e.currentTarget.style.boxShadow='none';}:undefined}>
      <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', fontWeight:600 }}>{label}</div>
      <div style={{ fontFamily:'var(--font-mono)', fontSize:22, fontWeight:500, color, marginTop:2 }}>{value}</div>
      <div className="txt-sm txt-muted" style={{ fontSize:11 }}>{sub}</div>
      <div className="txt-sm txt-muted" style={{ fontSize:10.5, marginTop:4, lineHeight:1.4 }}>{note}</div>
    </div>
  );
};

// ============ OPEX TRACKER (dashboard card) ============
// Compact version of the Cost Planning view — shows coverage, contribution vs. usage,
// top categories, and an 8-month trend so the firm can see at a glance whether
// active projects are funding overheads.
const OpexTrackerCard = () => {
  // Monthly contribution by project (value × opex% / duration in months, estimated)
  const contribByProject = [
    { code:'IFM001', mo: 40000 },
    { code:'GNC001', mo: 32000 },
    { code:'PNC001', mo: 31200 },
    { code:'BMX001', mo: 21300 },
    { code:'ADX001', mo: 12000 },
    { code:'GNC002', mo: 16000 },
  ];
  const contribIn = contribByProject.reduce((a,p)=>a+p.mo, 0); // 152.5k

  // Monthly usage by category (from cost-plan)
  const usage = [
    { cat:'Office & ops',   mo: 7370, hue: 22 },
    { cat:'Technology',     mo: 5931, hue: 162 },
    { cat:'Legal',          mo: 5665, hue: 48 },
    { cat:'Insurance',      mo: 3470, hue: 4 },
    { cat:'Finance & acct', mo: 4975, hue: 210 },
    { cat:'BD & mkt',       mo: 3895, hue: 280 },
    { cat:'People',         mo: 2960, hue: 140 },
  ];
  const usageOut = usage.reduce((a,u)=>a+u.mo, 0); // ~34.3k
  const delta = contribIn - usageOut;
  const covPct = Math.round((contribIn / usageOut) * 100);

  // 8-month trend — contribution and usage trendlines (USD/mo)
  const trend = {
    contrib: [82,  95,  110, 122, 118, 132, 145, 152],
    usage:   [28,  30,  30,  31,  33,  33,  34,  34],
    months:  ['Oct','Nov','Dec','Jan','Feb','Mar','Apr','May'],
  };
  const maxY = 160;
  const toY = (v) => 20 + (1 - v/maxY) * 110;
  const cx = (i) => 50 + i * (700/7);
  const cPath = trend.contrib.map((v,i)=>`${i===0?'M':'L'} ${cx(i)} ${toY(v)}`).join(' ');
  const uPath = trend.usage.map((v,i)=>`${i===0?'M':'L'} ${cx(i)} ${toY(v)}`).join(' ');

  const fmt = (n) => `$${(n/1000).toFixed(0)}k`;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header" style={{ cursor:'pointer' }} onClick={()=>window.__nav && window.__nav('costplan')}>
        <div>
          <h3>OPEX tracker · contribution vs. usage</h3>
          <div className="txt-sm txt-muted" style={{ marginTop: 2 }}>
            Monthly run-rate · surplus flows to firm reserve · shortfall drawn from partner account · <a href="#" style={{ color:'var(--brand)' }} onClick={e=>{e.preventDefault();window.__nav && window.__nav('costplan');}}>open Cost planning →</a>
          </div>
        </div>
        <div className="row gap-sm">
          <Badge tone={covPct>=100?'green':'amber'} dot>{covPct>=100?'covered':'shortfall'}</Badge>
          <Btn sm ghost icon="download">Export</Btn>
        </div>
      </div>
      <div className="card-body">
        {/* Top row: KPI trio + delta */}
        <div style={{ display:'grid', gridTemplateColumns:'1.1fr 1fr 1fr 1fr', gap:20, alignItems:'stretch' }}>
          <div>
            <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4, fontWeight:600 }}>Coverage</div>
            <div style={{ fontFamily:'var(--font-serif)', fontSize:40, fontWeight:400, letterSpacing:'-0.02em', lineHeight:1, color: covPct>=100?'var(--green)':'var(--amber)' }}>{covPct}%</div>
            <div className="txt-sm txt-muted" style={{ marginTop:4 }}>contribution ÷ OPEX usage</div>
            <div style={{ height:8, background:'var(--bg-elev)', borderRadius:4, overflow:'hidden', marginTop:10, position:'relative' }}>
              <div style={{ width:`${Math.min(covPct,200)*0.5}%`, height:'100%', background: covPct>=100?'var(--green)':'var(--amber)' }}/>
              <div style={{ position:'absolute', left:'50%', top:-3, bottom:-3, width:1, background:'var(--text-3)' }} title="100% line"/>
            </div>
            <div className="txt-sm txt-muted" style={{ fontSize:10, marginTop:4 }}>target 100% · currently <b style={{ color: covPct>=100?'var(--green)':'var(--amber)' }}>{covPct>=100?'+':''}{covPct-100}pp</b></div>
          </div>

          <div>
            <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4, fontWeight:600 }}>Contribution (in)</div>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:26, fontWeight:500 }}>{fmt(contribIn)}</div>
            <div className="txt-sm txt-muted">6 active projects · 20% firm default</div>
            <div style={{ height:22, display:'flex', borderRadius:3, overflow:'hidden', marginTop:10, border:'1px solid var(--border)' }}>
              {contribByProject.map((p,i)=>(
                <div key={i} style={{ flex:p.mo, background:`hsl(${160+i*12}, 28%, ${38+i*4}%)`, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:9, fontFamily:'var(--font-mono)', cursor:'pointer' }} title={`${p.code}: ${fmt(p.mo)}/mo · open project`} onClick={()=>window.__nav && window.__nav('projects', { projectCode: p.code })}>{p.code}</div>
              ))}
            </div>
          </div>

          <div>
            <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4, fontWeight:600 }}>Usage (out)</div>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:26, fontWeight:500 }}>{fmt(usageOut)}</div>
            <div className="txt-sm txt-muted">{fmt(usageOut*12)} annualised · 7 categories</div>
            <div style={{ height:22, display:'flex', borderRadius:3, overflow:'hidden', marginTop:10, border:'1px solid var(--border)' }}>
              {usage.map((u,i)=>(
                <div key={i} style={{ flex:u.mo, background:`hsl(${u.hue}, 42%, ${42+i*2}%)`, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:9, cursor:'pointer' }} title={`${u.cat}: ${fmt(u.mo)}/mo · open Cost planning`} onClick={()=>window.__nav && window.__nav('costplan')}>{u.cat.split(' ')[0]}</div>
              ))}
            </div>
          </div>

          <div>
            <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4, fontWeight:600 }}>Monthly delta</div>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:26, fontWeight:500, color: delta>=0?'var(--green)':'var(--red)' }}>{delta>=0?'+':''}{fmt(delta)}</div>
            <div className="txt-sm txt-muted">{delta>=0?'surplus → firm reserve':'shortfall → partner draw'}</div>
            <div className="hdiv" style={{ margin:'10px 0' }}/>
            <div className="row-spread" style={{ fontSize:11 }}>
              <span className="txt-muted">Firm reserve</span>
              <b className="mono">{fmt(348000)}</b>
            </div>
            <div className="row-spread" style={{ fontSize:11 }}>
              <span className="txt-muted">Target (3mo buffer)</span>
              <span className="mono">{fmt(usageOut*3)}</span>
            </div>
          </div>
        </div>

        {/* Trend chart */}
        <div className="hdiv"/>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 260px', gap:20, alignItems:'start' }}>
          <div>
            <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4, fontWeight:600 }}>8-month trend · contribution vs. usage</div>
            <div style={{ border:'1px solid var(--divider)', borderRadius:6, padding:'10px 8px 2px', background:'var(--bg-elev)' }}>
              <svg viewBox="0 0 780 160" preserveAspectRatio="none" style={{ width:'100%', height:150, display:'block' }}>
                <defs>
                  <linearGradient id="opex-contrib" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="#1e3a34" stopOpacity="0.22"/>
                    <stop offset="1" stopColor="#1e3a34" stopOpacity="0"/>
                  </linearGradient>
                </defs>
                {[20,50,80,110,140].map(y=>(
                  <line key={y} x1="40" x2="760" y1={y} y2={y} stroke="#eeece5" strokeWidth="1"/>
                ))}
                {/* Contribution area */}
                <path d={`${cPath} L ${cx(7)} 140 L ${cx(0)} 140 Z`} fill="url(#opex-contrib)"/>
                <path d={cPath} fill="none" stroke="#1e3a34" strokeWidth="2.4"/>
                {trend.contrib.map((v,i)=>(
                  <circle key={'c'+i} cx={cx(i)} cy={toY(v)} r="3.2" fill="#fff" stroke="#1e3a34" strokeWidth="2"/>
                ))}
                {/* Usage line */}
                <path d={uPath} fill="none" stroke="#b87c3f" strokeWidth="2" strokeDasharray="2 2"/>
                {trend.usage.map((v,i)=>(
                  <circle key={'u'+i} cx={cx(i)} cy={toY(v)} r="2.4" fill="#b87c3f"/>
                ))}
                {/* Shaded gap to show surplus at latest point */}
                <line x1={cx(7)} x2={cx(7)} y1={toY(trend.contrib[7])} y2={toY(trend.usage[7])} stroke="#5a8a78" strokeWidth="10" opacity="0.2"/>
                <text x={cx(7)+8} y={(toY(trend.contrib[7])+toY(trend.usage[7]))/2+3} fontSize="10" fill="#1e3a34" fontWeight="600">+$118k surplus</text>
                {/* End labels */}
                <text x={cx(7)+8} y={toY(trend.contrib[7])-8} fontSize="10" fill="#1e3a34" fontWeight="600">contrib $152k</text>
                <text x={cx(7)+8} y={toY(trend.usage[7])+14} fontSize="10" fill="#b87c3f" fontWeight="600">usage $34k</text>
                {trend.months.map((m,i)=>(
                  <text key={m} x={cx(i)} y="156" fontSize="10" fill="#8b8984" textAnchor="middle">{m}</text>
                ))}
                {/* Y axis labels */}
                {[[20,'$160k'],[50,'$120k'],[80,'$80k'],[110,'$40k'],[140,'$0']].map(([y,l])=>(
                  <text key={y} x="36" y={y+3} fontSize="9" fill="#8b8984" textAnchor="end">{l}</text>
                ))}
              </svg>
            </div>
            <div className="row gap-sm" style={{ fontSize:11, color:'var(--text-3)', marginTop:6 }}>
              <div className="row gap-sm"><span style={{ width:16, height:2, background:'#1e3a34' }}/><span>OPEX contribution · from projects</span></div>
              <div className="row gap-sm"><span style={{ width:16, height:1.5, background:'#b87c3f', borderTop:'1.5px dashed #b87c3f' }}/><span>OPEX usage · vendor run-rate</span></div>
              <div style={{ marginLeft:'auto' }}>Coverage up from <b>293%</b> (Oct) to <b style={{ color:'var(--green)' }}>{covPct}%</b></div>
            </div>
          </div>

          {/* Watchlist */}
          <div>
            <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4, fontWeight:600 }}>Watchlist</div>
            <div className="stack" style={{ gap:6 }}>
              {[
                ['Office HQ renewal','Aug 2026','$3,800/mo · negotiate down if team stays ≤10'],
                ['AI seats 5 → 12','Q3','move to enterprise tier · ~$300/mo saving'],
                ['HubSpot CRM review','this Q','duplicates Pipeline.xlsx · drop or upgrade'],
              ].map((w,i)=>(
                <div key={i} style={{ border:'1px solid var(--divider)', borderRadius:6, padding:'8px 10px', cursor:'pointer', transition:'background .15s' }} onClick={()=>window.__nav && window.__nav('costplan')} onMouseEnter={e=>e.currentTarget.style.background='var(--bg-subtle)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <div className="row-spread" style={{ alignItems:'baseline' }}>
                    <b className="txt-sm">{w[0]}</b>
                    <span className="txt-sm txt-muted" style={{ fontSize:11 }}>{w[1]}</span>
                  </div>
                  <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:2 }}>{w[2]}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============ PROJECTS OVERVIEW (kanban) ============
const projectsData = [
  // [code, client, name, stage, value, team, progress, lead, health, weeks, status]
  ['BMX002','Biomax','Portfolio review','setup','$220k',['TT','MB','JB'],5,'TT','green','10w','kickoff 22 Apr'],
  ['ADX001','Adexa','Commercial scan','setup','$180k',['SR','CC'],10,'SR','amber','8w','contract sent'],

  ['IFM001','IFM Pharma','Diligence Strategy','active','$600k',['MB','CC','JB','AP'],62,'MB','green','12w','wk 7/12'],
  ['PNC001','Panacea','Market Entry','active','$780k',['TT','MB','AP','CC'],45,'TT','green','16w','wk 7/16'],
  ['GNC001','Genica','Access Strategy','active','$420k',['SR','JB'],78,'SR','amber','10w','wk 8/10'],

  ['BMX001','Biomax','MedTech diligence','delivery','$550k',['TT','CC','JB'],90,'TT','green','10w','wk 9/10'],
  ['IFM002','IFM Pharma','Commercial extension','delivery','$280k',['MB','CC'],85,'MB','green','6w','wk 5/6'],

  ['PNC000','Panacea','FY25 Strategy refresh','closed','$680k',['TT','MB'],100,'TT','green','—','closed · paid'],
  ['GNC000','Genica','Pricing bench','closed','$240k',['SR'],100,'SR','green','—','closed · paid'],
];

const TeamStack = ({ members, lead }) => (
  <div style={{ display:'flex' }}>
    {members.slice(0,5).map((m,i)=>(
      <div key={i} style={{ marginLeft: i===0?0:-6, position:'relative', zIndex: 10-i, outline:'2px solid var(--bg-elev)', borderRadius:'50%' }}>
        <Avatar size={22} tone={m===lead?'var(--brand)':undefined}>{m}</Avatar>
      </div>
    ))}
    {members.length>5 && <div style={{ marginLeft:-6, width:22, height:22, borderRadius:'50%', background:'var(--bg-subtle)', border:'2px solid var(--bg-elev)', fontSize:10, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-3)' }}>+{members.length-5}</div>}
  </div>
);

const ProjectCard = ({ p, onOpen, dragHandlers }) => {
  const [code, client, name, stage, value, team, progress, lead, health, weeks, status] = p;
  const healthColor = health==='green' ? 'var(--green)' : health==='amber' ? 'var(--amber)' : 'var(--red)';
  return (
    <div className={`kb-card${dragHandlers?.dragging?' dragging':''}`} style={{ cursor: dragHandlers ? (dragHandlers.dragging?'grabbing':'grab') : 'pointer' }}
      draggable={!!dragHandlers}
      onDragStart={dragHandlers?.onDragStart}
      onDragEnd={dragHandlers?.onDragEnd}
      onClick={()=>{ if(dragHandlers?.suppressClick) return; onOpen && onOpen(code); }}
    >
      <div className="row" style={{ alignItems:'flex-start', gap:8 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:13, fontWeight:600, letterSpacing:'.02em', color:'var(--text)' }}>{code}</div>
          <div style={{ fontSize:13, fontWeight:600, marginTop:2, color:'var(--text)' }}>{client}</div>
          <div className="txt-sm txt-muted" style={{ fontSize:11.5, marginTop:2 }}>{name}</div>
        </div>
        <div style={{ width:8, height:8, borderRadius:'50%', background:healthColor, marginTop:6, flexShrink:0 }} title={`health: ${health}`}/>
      </div>
      {stage!=='closed' && (
        <div style={{ background:'var(--bg-subtle)', height:4, borderRadius:2, overflow:'hidden', marginTop:10 }}>
          <div style={{ width:`${progress}%`, height:'100%', background:'var(--brand)' }}/>
        </div>
      )}
      <div className="foot" style={{ marginTop:10 }}>
        <TeamStack members={team} lead={lead}/>
        <div className="txt-sm" style={{ fontSize:10.5, color:'var(--text-3)' }}>{weeks} · {status}</div>
      </div>
    </div>
  );
};

const ProjectsOverview = ({ onOpen, role }) => {
  const [view, setView] = React.useState('kanban');
  const isConsultant = role === 'consultant';
  const myCode = 'CC';
  const [projects, setProjects] = React.useState(projectsData);
  const [dragId, setDragId] = React.useState(null);
  const [dropStage, setDropStage] = React.useState(null);
  const data = isConsultant ? projects.filter(p => p[5].includes(myCode)) : projects;
  const stages = [
    { k:'setup',    label:'Setup',     sub:'contract · team · code', dot:'var(--text-3)' },
    { k:'active',   label:'Active',    sub:'in delivery',             dot:'var(--brand)' },
    { k:'delivery', label:'Wrapping',  sub:'final weeks · invoicing', dot:'var(--amber)' },
    { k:'closed',   label:'Closed',    sub:'paid · reconciled',       dot:'var(--green)' },
  ];
  const byStage = Object.fromEntries(stages.map(s=>[s.k, data.filter(p=>p[3]===s.k)]));

  const moveProject = (code, newStage) => {
    setProjects(ps => ps.map(p => p[0]===code ? [...p.slice(0,3), newStage, ...p.slice(4)] : p));
  };

  return (
    <>
      <div className="row" style={{ marginBottom:14, gap:10, flexWrap:'wrap' }}>
        <div>
          <h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, margin:0 }}>{isConsultant ? 'My projects' : 'Projects'}</h2>
          <div className="txt-sm txt-muted">{isConsultant ? `${data.length} assigned · you are CC` : '9 projects · 5 active · $3.95M in flight · live from Pipeline.xlsx'}</div>
        </div>
        <div className="ml-auto row gap-sm">
          <div className="tabs" style={{ marginBottom:0, borderBottom:'none' }}>
            {[['kanban','Kanban'],['grid','Grid'],['table','Table']].map(([k,l])=>(
              <div key={k} className={`tab ${view===k?'active':''}`} onClick={()=>setView(k)}>{l}</div>
            ))}
          </div>
          <Btn sm icon="filter">Client · type · lead</Btn>
          <Btn sm primary icon="plus">New project</Btn>
        </div>
      </div>

      {view==='kanban' && (
        <div className="grid" style={{ gridTemplateColumns:'repeat(4, minmax(0, 1fr))', gap:14 }}>
          {stages.map(s => (
            <div key={s.k}
              className={`kb-col-p${dropStage===s.k?' drop-target':''}`}
              style={{ background:'var(--bg-subtle)', borderRadius:8, padding:12, minHeight:400 }}
              onDragOver={e=>{ if(dragId){ e.preventDefault(); e.dataTransfer.dropEffect='move'; if(dropStage!==s.k) setDropStage(s.k); } }}
              onDragLeave={e=>{ if(!e.currentTarget.contains(e.relatedTarget)) setDropStage(null); }}
              onDrop={e=>{ e.preventDefault(); if(dragId) moveProject(dragId, s.k); setDragId(null); setDropStage(null); }}
            >
              <div className="kb-col-header">
                <div className="name"><span className="stage-dot" style={{ background:s.dot }}/>{s.label}<span className="count">{byStage[s.k].length}</span></div>
                <div className="txt-sm txt-muted" style={{ fontSize:10.5 }}>{s.sub}</div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:10, marginTop:10 }}>
                {byStage[s.k].map(p => (
                  <ProjectCard key={p[0]} p={p} onOpen={onOpen}
                    dragHandlers={{
                      dragging: dragId===p[0],
                      suppressClick: !!dragId,
                      onDragStart: (e)=>{ setDragId(p[0]); e.dataTransfer.effectAllowed='move'; try{ e.dataTransfer.setData('text/plain', p[0]); }catch(_){} },
                      onDragEnd: ()=>{ setDragId(null); setDropStage(null); },
                    }}
                  />
                ))}
                {s.k==='setup' && (
                  <div style={{ border:'1.5px dashed var(--border)', borderRadius:8, padding:14, textAlign:'center', color:'var(--text-3)', fontSize:12, cursor:'pointer' }} onClick={()=>onOpen && onOpen('__new')}>
                    + New project code
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {view==='grid' && (
        <div className="grid g3" style={{ gap:14 }}>
          {data.map(p => <ProjectCard key={p[0]} p={p} onOpen={onOpen}/>)}
        </div>
      )}

      {view==='table' && (
        <div className="card">
          <table className="tbl">
            <thead><tr><th>Code</th><th>Client</th><th>Project</th><th>Stage</th><th>Team</th><th className="num">Progress</th><th>Lead</th><th>Health</th><th>Status</th></tr></thead>
            <tbody>
              {data.map(p => (
                <tr key={p[0]} style={{ cursor:'pointer' }} onClick={()=>onOpen && onOpen(p[0])}>
                  <td className="code-cell"><b>{p[0]}</b></td>
                  <td><b>{p[1]}</b></td>
                  <td>{p[2]}</td>
                  <td><Badge tone={p[3]==='active'?'blue':p[3]==='delivery'?'amber':p[3]==='closed'?'green':undefined}>{p[3]}</Badge></td>
                  <td><TeamStack members={p[5]} lead={p[7]}/></td>
                  <td className="num mono">{p[6]}%</td>
                  <td><Avatar size={22}>{p[7]}</Avatar></td>
                  <td><span style={{ width:8, height:8, borderRadius:'50%', background: p[8]==='green'?'var(--green)':p[8]==='amber'?'var(--amber)':'var(--red)', display:'inline-block' }}/></td>
                  <td className="txt-sm txt-muted">{p[10]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

// ============ PROJECT DETAIL ============
const ProjectDetail = ({ onBack, code, role }) => {
  const [tab, setTab] = React.useState(() => window.__projectTab || 'pl');
  React.useEffect(()=>{ if (window.__projectTab) { setTab(window.__projectTab); delete window.__projectTab; } },[]);
  return (
    <>
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:6, flexWrap:'wrap' }}>
        {onBack && <Btn sm ghost onClick={onBack}>← All projects</Btn>}
        <span style={{ fontFamily:'var(--font-mono)', fontSize:13, background:'var(--bg-subtle)', padding:'3px 9px', borderRadius:5, fontWeight:500 }}>{code || 'IFM001'}</span>
        <h2 style={{ fontFamily:'var(--font-serif)', fontWeight:400, fontSize:28, margin:0, letterSpacing:'-0.01em' }}>Integrated Market · Diligence Strategy</h2>
        <Badge tone="blue" dot>delivery</Badge>
        <XlsxPill state="synced"/>
        <div className="ml-auto row gap-sm">
          <Btn sm icon="doc" onClick={()=>setTab('inv')}>Generate invoice</Btn>
          <Btn sm icon="doc" onClick={()=>setTab('contracts')}>Change order</Btn>
          <Btn sm primary icon="plus" onClick={()=>setTab('activity')}>Log activity</Btn>
        </div>
      </div>
      <div className="txt-sm txt-muted" style={{ marginBottom:20 }}>IFM Pharma · 12 weeks · started 06 Jan · lead partner MB · referred by AP (3% internal)</div>
      <div className="tabs">
        {[['pl','P&L'],['checklist','Checklist'],['team','Team & timesheets'],['risks','Risks'],['inv','Invoices'],['exp','Expenses'],['contracts','Contracts'],['refs','Referrals'],['activity','Activity'],['settings','Settings']].map(([k,l])=>(
          <div key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>
            {l}{k==='risks' && <Badge tone="amber" dot style={{ marginLeft:6 }}>3</Badge>}
          </div>
        ))}
      </div>
      {tab==='checklist' && <ProjectChecklist code={code || 'IFM001'}/>}
      {tab==='team' && <ProjectTeamTab/>}
      {tab==='risks' && <ProjectRisksTab role={role} code={code || 'IFM001'}/>}
      {tab==='inv' && <ProjectInvoicesTab/>}
      {tab==='exp' && <ProjectExpensesTab/>}
      {tab==='contracts' && <ProjectContractsTab/>}
      {tab==='refs' && <ProjectReferralsTab/>}
      {tab==='activity' && <ProjectActivityTab/>}
      {tab==='settings' && <ProjectSettingsTab role={role} code={code || 'IFM001'}/>}
      {tab==='pl' && <div className="grid g-main-side">
        <div className="stack">
          <div className="card">
            <div className="card-header">
              <div><h3>Project P&L · live</h3><div className="txt-sm txt-muted">auto-calculated · synced to Finance.xlsx</div></div>
              <Badge tone="green" dot>healthy</Badge>
            </div>
            <table className="tbl">
              <thead><tr><th>Line item</th><th className="num">Budget</th><th className="num">Actual</th><th className="num">% fee</th><th>Status</th></tr></thead>
              <tbody>
                {[
                  ['Gross fee','$600,000','$600,000','100%',''],
                  ['– Partners per-diem (0.5×3)','$180,000','$176,000','29.3%','TT, MB, SR'],
                  ['– Consultant (CC 1.0)','$60,000','$58,000','9.7%',''],
                  ['– Analyst (JB 1.0)','$24,000','$24,400','4.1%',''],
                  ['– Experts (p/h)','$12,000','$8,200','1.4%','4h/wk US'],
                  ['– Travel + meals','$4,800','$6,200','1.0%','over'],
                  ['– Software / subs','$2,400','$2,100','0.4%',''],
                  ['Project expense subtotal','$283,200','$274,900','45.8%','aim <50%'],
                  ['– BD referral (AP int 3%)','$18,000','$18,000','3.0%','paid'],
                  ['– OPEX contribution (20%)','$120,000','$120,000','20.0%','auto'],
                  ['– Firm profit pool (15%)','$90,000','$90,000','15.0%','auto'],
                  ['Net: LT project share','$88,800','$97,100','16.2%','adj. at close'],
                ].map((r,i)=>{
                  const bold = r[0].includes('subtotal') || r[0].startsWith('Net') || r[0].startsWith('Gross');
                  return (
                    <tr key={i} style={bold?{ background:'var(--bg-subtle)' }:{}}>
                      <td style={{ fontWeight: bold?600:400, paddingLeft: r[0].startsWith('–')?24:12 }}>{r[0]}</td>
                      <td className="num">{r[1]}</td>
                      <td className="num" style={{ fontWeight: bold?600:400 }}>{r[2]}</td>
                      <td className="num">{r[3]}</td>
                      <td><span className="txt-sm txt-muted">{r[4]}{r[4]==='over' && ' ⚠'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card">
            <div className="card-header"><h3>Team & hours · last 4 weeks</h3><Btn sm ghost icon="download">Export</Btn></div>
            <table className="tbl">
              <thead><tr><th>Member</th><th>Role</th><th className="num">FTE</th><th className="num">Wk14</th><th className="num">Wk15</th><th className="num">Wk16</th><th className="num">Wk17</th><th className="num">Total hrs</th><th className="num">$ accrued</th></tr></thead>
              <tbody>
                {[['MB','Lead partner',0.5,18,22,20,16,412,82000],['TT','Expert partner',0.5,12,8,14,10,186,37000],['SR','Assoc partner',0.5,14,16,12,18,243,48000],['CC','Consultant',1.0,38,40,36,38,584,58000],['JB','Analyst',1.0,40,40,38,42,612,24000]].map((r,i)=>(
                  <tr key={i}><td className="code-cell">{r[0]}</td><td>{r[1]}</td><td className="num">{r[2]}</td><td className="num">{r[3]}</td><td className="num">{r[4]}</td><td className="num">{r[5]}</td><td className="num">{r[6]}</td><td className="num"><b>{r[7]}h</b></td><td className="num">${r[8].toLocaleString()}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <div className="card-header"><h3>Meta</h3></div>
            <div className="card-body" style={{ padding: 0 }}>
              <div className="list">
                {[['Client','IFM (Pharma)','directory'],['Project type','Strategy',null],['Start','06 Jan 2026',null],['End (planned)','28 Mar 2026',null],['Lead partner','MB','directory'],['Contract','$600,000','contracts'],['Billed / paid','$380k / $260k','inv'],['AR outstanding','$120k (34d)','inv'],['Referral','AP · 3% int · paid','refs']].map((r,i)=>(
                  <div key={i} className="list-item" style={{ cursor: r[2]?'pointer':'default' }} onClick={()=> r[2] && (r[2]==='directory' ? window.__nav && window.__nav('directory') : setTab(r[2]))}><div className="main" style={{ flex:1 }}><span className="txt-muted">{r[0]}</span></div><div className="right"><b style={{ color:'var(--text)' }}>{r[1]}</b></div></div>
                ))}
              </div>
            </div>
          </div>
          <Callout tone="warn" title="Travel line +30% over"><span className="txt-sm">Flagged by controls (&gt;20% line overage). MB approval pending. <a href="#" style={{ color:'var(--accent)', fontWeight:500 }} onClick={e=>{e.preventDefault(); setTab('exp');}}>Review expenses →</a></span></Callout>
          <div className="card">
            <div className="card-header"><h3>Recent activity</h3><Btn sm ghost onClick={()=>setTab('activity')}>View all</Btn></div>
            <div className="list">
              {[['MB logged 18h · wk17','2h','team'],['Invoice #11 sent · $120k','1d','inv'],['CC added expense · $340','1d','exp'],['Change order v2 signed','3d','contracts'],['Auto-sync → Finance.xlsx','today','activity']].map((r,i)=>(
                <div key={i} className="list-item" style={{ cursor:'pointer' }} onClick={()=>setTab(r[2])}><div className="main txt-sm">{r[0]}</div><div className="right">{r[1]}</div></div>
              ))}
            </div>
          </div>
        </div>
      </div>}
    </>
  );
};

// ============ AVAILABILITY (sub-view of Timesheet) ============
const Availability = () => (
  <>
    <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
      <div>
        <div className="txt-sm txt-muted">Forecast · next 6 weeks · Apr 20 → May 31</div>
        <h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, margin:'2px 0 0' }}>CC's availability</h2>
      </div>
      <Badge tone="green" dot>up to date</Badge>
      <XlsxPill state="synced">Availability.xlsx</XlsxPill>
      <div className="ml-auto row gap-sm">
        <Btn sm ghost>← weeks</Btn>
        <Btn sm ghost>weeks →</Btn>
        <Btn sm>Copy pattern</Btn>
        <Btn sm primary icon="check">Publish forecast</Btn>
      </div>
    </div>
    <div className="callout info" style={{ marginBottom:16, display:'flex', alignItems:'center', gap:10 }}>
      <Icon name="zap"/>
      <div className="txt-sm"><b>Forecast, not commitment.</b> Partners use this to plan staffing. Actual hours still go through your weekly timesheet. Availability here auto-rolls into the <b>Pipeline.xlsx</b> capacity sheet.</div>
    </div>
    <table className="ts-grid">
      <thead>
        <tr>
          <th style={{ textAlign:'left', paddingLeft:16, minWidth:260 }}>Commitment / status</th>
          {[['Wk 17','Apr 13'],['Wk 18','Apr 20'],['Wk 19','Apr 27'],['Wk 20','May 4'],['Wk 21','May 11'],['Wk 22','May 18'],['Wk 23','May 25']].map(([w,d])=>(
            <th key={w} className="day-col" style={{ minWidth:90 }}>{w}<span className="date">{d}</span></th>
          ))}
          <th>Planned h</th>
        </tr>
      </thead>
      <tbody>
        {[
          ['IFM001','Diligence Strategy · allocated',[40,40,40,32,24,0,0],176,'#1e3a34'],
          ['GNC001','Portfolio Review · trailing',[5,4,2,0,0,0,0],11,'#2b5a8c'],
          ['PNC002','Proposal · Panacea · BD',[5,6,4,0,0,0,0],15,'#c4a962'],
          ['—','Leave / OOO',[0,0,0,0,16,40,40],96,'#a5342f'],
          ['—','Firm building / training · flex',[2,2,2,4,0,0,0],10,'#3f7c5c'],
        ].map((r,i)=>(
          <tr key={i}>
            <td className="proj-cell">
              <div className="nm" style={{ alignItems:'center' }}><span className="tag" style={{ background: r[4], color:'#fff', fontWeight:600 }}>{r[0]}</span>{r[1]}</div>
            </td>
            {r[2].map((h,j)=>(
              <td key={j} style={{ background: h>=40?'rgba(165,52,47,.1)':h>=30?'rgba(196,169,98,.18)':h>0?'rgba(63,124,92,.08)':'transparent' }}>
                <input defaultValue={h||''} style={{ color: r[4], fontWeight: h>0?600:400 }}/>
              </td>
            ))}
            <td className="total-cell">{r[3]}h</td>
          </tr>
        ))}
        <tr className="add-row"><td className="proj-cell">＋ add commitment or leave row</td><td colSpan="8"></td></tr>
        <tr className="total-row">
          <td className="proj-cell" style={{ color:'#fff' }}>Committed</td>
          <td>52h</td><td>52h</td><td>48h</td><td>36h</td><td>40h</td><td>40h</td><td>40h</td><td>308h</td>
        </tr>
        <tr style={{ background:'var(--bg-subtle)', fontFamily:'var(--font-mono)', fontWeight:600 }}>
          <td className="proj-cell">Free capacity <span className="txt-sm txt-muted" style={{ fontFamily:'var(--font-sans)', fontWeight:400 }}>(@40h baseline)</span></td>
          <td style={{ color:'var(--red)' }}>−12h</td>
          <td style={{ color:'var(--red)' }}>−12h</td>
          <td style={{ color:'var(--amber)' }}>−8h</td>
          <td style={{ color:'var(--green)' }}>+4h</td>
          <td style={{ color:'var(--text-3)' }}>0h</td>
          <td style={{ color:'var(--text-3)' }}>0h</td>
          <td style={{ color:'var(--text-3)' }}>0h</td>
          <td>−28h</td>
        </tr>
      </tbody>
    </table>
    <div className="row gap-sm" style={{ marginTop:12, flexWrap:'wrap' }}>
      <Badge tone="red"><span className="dot"/>Over-allocated weeks 17–19</Badge>
      <Badge tone="amber"><span className="dot"/>Leave booked wk 21–23 — flagged to MB</Badge>
      <Badge tone="green"><span className="dot"/>Auto-synced to firm capacity sheet</Badge>
      <span className="txt-sm txt-muted ml-auto mono">bulk: <b>ooo may 18-29</b> / <b>ifm001 wk18 40</b></span>
    </div>
    <div className="grid g3" style={{ marginTop:20 }}>
      <div className="card kpi">
        <div className="label">Forecast utilisation · next 6wk</div>
        <div className="value">89%</div>
        <div className="sub" style={{ color:'var(--amber)' }}>target 65–80% · heavily loaded</div>
        <div className="hdiv"/>
        <BarRow label="Committed" pct={78} val="212h"/>
        <BarRow label="BD / flex" pct={12} val="25h" tone="accent"/>
        <BarRow label="Leave / OOO" pct={34} val="96h" tone="red"/>
      </div>
      <div className="card">
        <div className="card-header"><h3>Leave requests</h3><Btn sm ghost icon="plus">Request</Btn></div>
        <div className="list">
          {[['Annual · 18–29 May','10 days','amber','pending MB'],['Public · 25 Apr (Anzac)','1 day','green','auto'],['Conference · 10 Jun','2 days','blue','draft']].map((r,i)=>(
            <div key={i} className="list-item"><div className="main"><div><div style={{ fontWeight:500 }}>{r[0]}</div><div className="txt-sm txt-muted">{r[1]}</div></div></div><Badge tone={r[2]} dot>{r[3]}</Badge></div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="card-header"><h3>What partners see</h3><Badge tone="accent">firm view</Badge></div>
        <div className="card-body">
          <div className="txt-sm txt-muted" style={{ marginBottom:10 }}>Your forecast rolls up into the <b>Capacity heatmap</b> on the Dashboard & Pipeline.</div>
          {[['TT','46%','green'],['MB','78%','amber'],['SR','52%','green'],['CC (you)','89%','red'],['JB','71%','green'],['AP','34%','green']].map((r,i)=>(
            <div key={i} style={{ display:'grid', gridTemplateColumns:'40px 1fr 50px', gap:10, alignItems:'center', padding:'4px 0' }}>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:12, fontWeight:600 }}>{r[0]}</div>
              <Progress pct={parseInt(r[1])} tone={r[2]}/>
              <div className="text-right mono" style={{ fontSize:11, color:`var(--${r[2]})` }}>{r[1]}</div>
            </div>
          ))}
          <Callout tone="info" title="Staffing signal">Partners drag open BD deals onto free capacity to staff new work.</Callout>
        </div>
      </div>
    </div>
  </>
);

// ============ TIMESHEET ============
const TimesheetView = () => (
  <>
    <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
      <div>
        <div className="txt-sm txt-muted">Week 17 · Apr 13–19, 2026</div>
        <h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, margin:'2px 0 0' }}>CC's timesheet</h2>
      </div>
      <Badge tone="amber" dot>draft</Badge>
      <XlsxPill state="synced">Timesheet.xlsx</XlsxPill>
      <div className="ml-auto row gap-sm">
        <Btn sm ghost>← week</Btn>
        <Btn sm ghost>week →</Btn>
        <Btn sm>Copy last week</Btn>
        <Btn sm primary>Submit for approval</Btn>
      </div>
    </div>
    <table className="ts-grid">
      <thead>
        <tr>
          <th style={{ textAlign:'left', paddingLeft: 16 }}>Project / activity</th>
          {[['Mon','13'],['Tue','14'],['Wed','15'],['Thu','16'],['Fri','17'],['Sat','18'],['Sun','19']].map(([d,n])=>(<th key={d} className="day-col">{d}<span className="date">{n}</span></th>))}
          <th>Total</th>
          <th>$ accrued</th>
        </tr>
      </thead>
      <tbody>
        {[
          ['IFM001','Diligence Strategy','delivery',[8,8,7,8,6,0,0],37,3700],
          ['GNC001','Portfolio Review','delivery',[0,0,2,0,3,0,0],5,500],
          ['PNC002','Proposal · Panacea','BD',[0,2,1,2,0,0,0],5,0],
          ['—','Firm building · website','OPEX',[0,0,0,0,2,0,0],2,0],
        ].map((r,i)=>(
          <tr key={i}>
            <td className="proj-cell">
              <div className="nm"><span className="tag">{r[0]}</span>{r[1]}</div>
              <div className="sub">{r[2]}</div>
            </td>
            {r[3].map((h,j)=>(<td key={j} className={j>=5?'weekend':''}><input defaultValue={h||''} /></td>))}
            <td className="total-cell">{r[4]}h</td>
            <td className="total-cell">${r[5]}</td>
          </tr>
        ))}
        <tr className="add-row"><td className="proj-cell">＋ add project row</td><td colSpan="9"></td></tr>
        <tr className="total-row">
          <td className="proj-cell" style={{ color:'#fff' }}>Daily total</td>
          <td>8</td><td>10</td><td>10</td><td>10</td><td>11</td><td>0</td><td>0</td><td>49h</td><td>$4,200</td>
        </tr>
      </tbody>
    </table>
    <div className="row gap-sm" style={{ marginTop:12, flexWrap:'wrap' }}>
      <Badge tone="amber"><span className="dot"/>Fri 11h exceeds 10h soft cap</Badge>
      <Badge tone="green"><span className="dot"/>All rows have project codes</Badge>
      <Badge>autosaves on blur</Badge>
      <span className="txt-sm txt-muted ml-auto mono">Bulk paste from Excel? Just Ctrl+V in any cell →</span>
    </div>
    <div className="grid g3" style={{ marginTop:20 }}>
      <div className="card kpi">
        <div className="label">Your utilisation · wk17</div>
        <div className="value">84%</div>
        <div className="sub" style={{ color:'var(--amber)' }}>target 65–80% · slightly over</div>
        <div className="hdiv"/>
        <BarRow label="Delivery" pct={76} val="37h"/>
        <BarRow label="BD" pct={10} val="5h" tone="blue"/>
        <BarRow label="Firm build" pct={4} val="2h" tone="green"/>
      </div>
      <div className="card">
        <div className="card-header"><h3>Quick-add via ⌘K</h3></div>
        <div className="card-body">
          <div className="mono txt-sm" style={{ background:'var(--bg-subtle)', padding:10, borderRadius:6, fontWeight:500 }}>IFM001 thu 8</div>
          <div className="txt-sm txt-muted" style={{ marginTop:6 }}>→ project IFM001 · Thu 16 · 8h delivery</div>
          <div className="mono txt-sm" style={{ background:'var(--bg-subtle)', padding:10, borderRadius:6, marginTop:10, fontWeight:500 }}>bd pnc002 tue 2h</div>
          <div className="txt-sm txt-muted" style={{ marginTop:6 }}>→ BD hours · PNC002 · Tue · 2h</div>
          <Callout tone="info" title="Friday 4pm nudge">System reminds you to submit at end of week.</Callout>
        </div>
      </div>
      <div className="card">
        <div className="card-header"><h3>Approval history</h3></div>
        <div className="list">
          {[['Wk 17 · this week','amber','draft'],['Wk 16 · Apr 6–12','green','approved · MB'],['Wk 15 · Mar 30–5','green','approved'],['Wk 14 · Mar 23–29','blue','1 flag resolved']].map((r,i)=>(
            <div key={i} className="list-item"><div className="main">{r[0]}</div><Badge tone={r[1]} dot>{r[2]}</Badge></div>
          ))}
        </div>
      </div>
    </div>
  </>
);

// ============ INVOICE OCR ============
const InvoiceOCR = () => (
  <>
    <div className="row" style={{ marginBottom:20, flexWrap:'wrap', gap:10 }}>
      <h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, margin:0 }}>Invoice intake</h2>
      <Badge>6 in queue</Badge>
      <XlsxPill state="synced">Invoices.xlsx</XlsxPill>
      <div className="ml-auto txt-sm txt-muted">📬 Forward PDFs to <span className="mono" style={{ color:'var(--text)' }}>invoices@foundry.health</span></div>
    </div>
    <div className="grid" style={{ gridTemplateColumns:'1fr 280px', gap:20 }}>
      <div className="stack">
        <div className="dropzone">
          <Icon name="upload" size={28}/>
          <h4>Drop PDFs or receipts here</h4>
          <p>or paste from clipboard · forward to email · sync from /Invoices/Inbox/</p>
          <div className="row gap-sm" style={{ justifyContent:'center', marginTop:12 }}>
            <Badge tone="green" dot>Consultant invoices</Badge>
            <Badge tone="green" dot>Supplier invoices</Badge>
            <Badge tone="green" dot>Receipts → expenses</Badge>
          </div>
        </div>
        <SectionTitle right={<><Badge>94% OCR confidence</Badge> <Btn sm ghost>← prev</Btn><Btn sm ghost>next →</Btn></>}>Review · Hawksparks-Apr2026.pdf</SectionTitle>
        <div className="ocr-split">
          <div className="ocr-pdf-wrap">
            <div className="ocr-pdf-page">
              <div style={{ fontFamily:'var(--font-serif)', fontSize:22 }}>HAWKSPARKS PTY LTD</div>
              <div className="txt-sm txt-muted">ABN 12 345 678 910 · Level 4, 220 Clarence St, Sydney</div>
              <div style={{ borderTop:'1px solid #ddd', margin:'14px 0' }}/>
              <div className="row gap-sm">Invoice # <span className="ocr-highlight good mono">HS-2041</span></div>
              <div style={{ marginTop:6 }}>Date: <span className="ocr-highlight good">18 April 2026</span></div>
              <div style={{ marginTop:6 }}>Bill to: Foundry Health Pty Ltd</div>
              <div style={{ marginTop:6 }}>Ref: <span className="ocr-highlight good">IFM001 — Diligence Strategy</span></div>
              <table style={{ width:'100%', marginTop:22, fontSize:13, borderCollapse:'collapse' }}>
                <thead><tr style={{ borderBottom:'1.5px solid #333' }}><th align="left" style={{ padding:'4px 0' }}>Item</th><th align="right">Qty</th><th align="right">Rate</th><th align="right">Amount</th></tr></thead>
                <tbody>
                  <tr><td style={{ padding:'4px 0' }}>Expert advisory (US pharma)</td><td align="right">8h</td><td align="right">$250</td><td align="right">$2,000</td></tr>
                  <tr><td style={{ padding:'4px 0' }}>Research subscription</td><td align="right">1</td><td align="right">$400</td><td align="right">$400</td></tr>
                  <tr style={{ borderTop:'1.5px solid #333' }}><td colSpan="3" align="right" style={{ padding:'8px 0', fontWeight:600 }}>Total (AUD)</td><td align="right" style={{ padding:'8px 0' }}><span className="ocr-highlight good" style={{ fontWeight:600 }}>$2,400.00</span></td></tr>
                </tbody>
              </table>
              <div style={{ marginTop:24, fontSize:12, color:'#888' }}>Payment: Westpac · BSB 032 123 · Acc 3456 7890</div>
              <div style={{ marginTop:10, fontSize:12 }}>Due: <span className="ocr-highlight low">30 days from invoice date</span></div>
            </div>
          </div>
          <div>
            <div style={{ marginBottom:10 }} className="txt-sm txt-muted"><b>Extracted fields</b> · edit anything</div>
            <div className="field"><label>Supplier <span className="conf">96%</span></label><div className="v"><input defaultValue="Hawksparks Pty Ltd"/></div></div>
            <div className="field"><label>ABN <span className="conf">99%</span></label><div className="v"><input defaultValue="12 345 678 910"/></div></div>
            <div className="field"><label>Invoice # <span className="conf">99%</span></label><div className="v"><input defaultValue="HS-2041"/></div></div>
            <div className="field"><label>Invoice date <span className="conf">95%</span></label><div className="v"><input defaultValue="18 Apr 2026"/></div></div>
            <div className="field"><label>Due date <span className="conf low">65% · inferred</span></label><div className="v"><input defaultValue="18 May 2026"/></div></div>
            <div className="field"><label>Amount (AUD) <span className="conf">99%</span></label><div className="v"><input defaultValue="$2,400.00"/></div></div>
            <div className="field"><label>GST <span className="conf low">not found</span></label><div className="v"><input placeholder="add if applicable"/></div></div>
            <div className="field matched"><label>Match to project <span className="conf">auto-matched</span></label><div className="v"><input defaultValue="IFM001 · Integrated Market"/></div></div>
            <div className="field"><label>Expense category <span className="conf">suggested</span></label><div className="v"><input defaultValue="Experts (p/h)"/></div></div>
            <div className="row gap-sm" style={{ justifyContent:'flex-end', marginTop:14 }}>
              <Btn sm>Skip</Btn>
              <Btn sm>Save draft</Btn>
              <Btn sm primary>Approve & post →</Btn>
            </div>
            <Callout tone="info" title="On approval">1) adds to <b>Invoices.xlsx</b> · 2) updates IFM001 P&L (experts line) · 3) routes for payment (TT approval · over $2k)</Callout>
          </div>
        </div>
      </div>
      <div className="stack">
        <div className="card">
          <div className="card-header"><h3>Queue · 6</h3><Btn sm ghost icon="filter">Filter</Btn></div>
          <div className="list">
            {[
              ['Hawksparks-Apr2026.pdf','IFM001','$2,400','reviewing','amber'],
              ['AP-invoice-0043.pdf','IFM001','$15,000','needs match',''],
              ['WorkClub-Apr.pdf','OPEX','$2,800','auto-categ.','green'],
              ['ExpertNet-Q1.pdf','?','$4,200','needs match','red'],
              ['FinXL-Tax-Mar.pdf','OPEX','$1,650','auto-categ.','green'],
              ['SR-consultant-Mar.pdf','GNC001','$48,000','reviewing','amber'],
            ].map((r,i)=>(
              <div key={i} className="list-item">
                <div className="main" style={{ minWidth:0 }}><div><div className="mono txt-sm" style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{r[0]}</div><div className="txt-sm txt-muted">{r[3]}</div></div></div>
                <div className="right" style={{ flexDirection:'column', alignItems:'flex-end', gap:2 }}><Badge tone={r[4]}>{r[1]}</Badge><b style={{ color:'var(--text)', fontSize:12 }}>{r[2]}</b></div>
              </div>
            ))}
          </div>
        </div>
        <Callout tone="info" title="How OCR works">1. upload/email PDF · 2. extract fields + match project · 3. human confirms · 4. post → Excel + live P&L</Callout>
      </div>
    </div>
  </>
);

const Timesheet = () => {
  const [tab, setTab] = React.useState(() => localStorage.getItem('foundry.ts.tab') || 'log');
  React.useEffect(()=>{ localStorage.setItem('foundry.ts.tab', tab); }, [tab]);
  return (
    <>
      <div className="tabs" style={{ marginBottom: 8 }}>
        <div className={`tab ${tab==='log'?'active':''}`} onClick={()=>setTab('log')}>
          <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}><Icon name="clock" size={14}/>Log hours · this week</span>
        </div>
        <div className={`tab ${tab==='forecast'?'active':''}`} onClick={()=>setTab('forecast')}>
          <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}><Icon name="chart" size={14}/>Availability forecast · next 6 weeks</span>
        </div>
      </div>
      {tab==='log' ? <TimesheetView/> : <Availability/>}
    </>
  );
};

Object.assign(window, { Dashboard, ProjectDetail, Timesheet, TimesheetView, Availability, InvoiceOCR });
