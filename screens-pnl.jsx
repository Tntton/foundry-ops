// screens-pnl.jsx · P&L overview with interactive waterfall, sandbox modeler, statement views
// Lives as its own screen · /pnl · wired from the dashboard waterfall card

// ========= CORE DATASET ==========================================================
// FY26 YTD (May · month 11 of 12). All dollar values in thousands.
// These roll up to the dashboard waterfall numbers: $2.46M booked → $390k partner profit.

const FY26_PROJECTS = [
  // [code, client, sector, status, booked, invoiced, paid, ar, wip, projCost, marginPct, owner, bookDate, deliveryMonth]
  ['IFM001','IFM Pharma','Pharma','delivery',600,380,260,120,220,195,48,'MB','Jan 26','Mar–Jun'],
  ['GNC001','Genica','Pharma','closing', 420,420,420,  0,  0,195,54,'SR','Feb 26','Feb–Apr'],
  ['PNC001','Panacea','Pharma','delivery',780,310, 90,220,470,170,46,'TT','Mar 26','Mar–Jul'],
  ['IFM002','IFM Pharma','Pharma','delivery',280,140,140,  0,140, 80,50,'MB','Feb 26','Feb–May'],
  ['BMX001','Biomax','MedTech','active', 320, 80, 80,  0,240,125,52,'SR','Mar 26','Mar–Jun'],
  ['ADX001','Adexa','Biotech','setup',   180,  0,  0,  0,180, 75,58,'SR','Apr 26','Apr–Aug'],
  ['GNC002','Genica','Pharma','kickoff', 300,  0,  0,  0,300,125,58,'MB','Apr 26','May–Jul'],
];

const BOOKED = FY26_PROJECTS.reduce((a,p)=>a+p[4],0); // 2880 — but the dashboard says $2.46M
// Reconcile: the dashboard waterfall treats FY26 YTD (not full-year pipeline). Use 2460 baseline.
// We scale to the dashboard cascade and split meaningfully.
const P = {
  booked: 2460,
  unbilled: 540,      // WIP / not yet invoiced
  invoiced: 1920,
  ar: 280,            // outstanding
  paid: 1640,         // collected
  projCost: 790,      // project delivery expenses
  gm: 850,
  opex: 240,
  ebit: 610,
  taxReserve: 220,
  profit: 390,        // distributable to partners
};

// ========= CHART UTILS ==========================================================
const fmtK = (v) => {
  const n = Math.abs(v);
  const s = n >= 1000 ? `$${(n/1000).toFixed(2)}M` : `$${n}k`;
  return v < 0 ? `−${s}` : s;
};

// ========= INTERACTIVE WATERFALL ================================================
// Click any bar → drilldown. Click a subtotal → filter to that phase.
// Two modes:
//   - 'booked'  : contracted revenue flowing through forecasted expenditures to *projected* partner profit
//   - 'cash'    : actual cash in-the-bank flow (invoices paid → cash out → realised profit to date)
const InteractiveWaterfall = ({ onDrill, scenario, mode='booked' }) => {
  const [hover, setHover] = React.useState(null);

  // BOOKED mode: starts from contracted revenue, projects through forecasted costs to projected profit.
  const bookedSteps = [
    { key:'booked',   label:'Booked revenue',    sub:'signed contracts · FY26',          value: scenario.booked,   kind:'total',    tone:'brand',  drill:'booked' },
    { key:'unbilled', label:'Unbilled / WIP',    sub:'forecast to invoice',              value: -scenario.unbilled,kind:'flow',     tone:'muted',  drill:'unbilled' },
    { key:'invoiced', label:'Invoiced (projected)', sub:'issued + to-be-issued',         value: scenario.invoiced, kind:'subtotal', tone:'brand',  drill:'invoiced' },
    { key:'projexp',  label:'Project delivery',  sub:'forecasted · consultants + experts', value: -scenario.projCost,kind:'flow',   tone:'orange', drill:'projexp' },
    { key:'gm',       label:'Gross margin',      sub:'projected',                        value: scenario.gm,       kind:'subtotal', tone:'green',  drill:'gm' },
    { key:'opex',     label:'OPEX',              sub:'forecasted · overheads',           value: -scenario.opex,    kind:'flow',     tone:'orange', drill:'opex' },
    { key:'ebit',     label:'EBIT (projected)',  sub:'operating profit',                 value: scenario.ebit,     kind:'subtotal', tone:'green',  drill:'ebit' },
    { key:'tax',      label:'Tax + reserve',     sub:'30% + 3mo buffer',                 value: -scenario.taxReserve,kind:'flow',   tone:'muted',  drill:'tax' },
    { key:'profit',   label:'Partner profit (projected)', sub:'distributable · 3 partners', value: scenario.profit, kind:'total',   tone:'green',  drill:'profit' },
  ];

  // CASH mode: realised cash only. Opens at cash collected, subtracts actual cash-out, shows realised YTD profit.
  // Use the invoiced fraction of project cost and OPEX months-to-date (11 of 12 ≈ 92%) for realised outflows.
  const cashPaidIn   = scenario.paid;                               // cash into the bank
  const cashProjOut  = Math.round(scenario.projCost * 0.86);        // delivery $ actually paid to vendors/payroll
  const cashOpexOut  = Math.round(scenario.opex * 0.92);            // 11 of 12 months paid
  const cashTaxOut   = Math.round(scenario.taxReserve * 0.35);      // instalments paid to date; rest accrued
  const cashNet      = cashPaidIn - cashProjOut - cashOpexOut - cashTaxOut;

  const cashSteps = [
    { key:'paid',     label:'Cash collected',    sub:'received into bank · YTD',         value: cashPaidIn,        kind:'total',    tone:'brand',  drill:'paid' },
    { key:'projexp',  label:'Delivery paid',     sub:'actual · vendors + payroll',       value: -cashProjOut,      kind:'flow',     tone:'orange', drill:'projexp' },
    { key:'opex',     label:'OPEX paid',         sub:'actual · 11 of 12 months',         value: -cashOpexOut,      kind:'flow',     tone:'orange', drill:'opex' },
    { key:'tax',      label:'Tax paid',          sub:'instalments to date',              value: -cashTaxOut,       kind:'flow',     tone:'muted',  drill:'tax' },
    { key:'profit',   label:'Realised cash profit', sub:'in the bank · YTD',             value: cashNet,           kind:'total',    tone:'green',  drill:'profit' },
  ];

  const baseSteps = mode==='cash' ? cashSteps : bookedSteps;

  let running = 0;
  const bars = baseSteps.map((s, i) => {
    let top, bottom;
    if (s.kind === 'total' && i === 0) { top = s.value; bottom = 0; running = s.value; }
    else if (s.kind === 'subtotal' || s.kind === 'total') { top = running; bottom = 0; }
    else { if (s.value >= 0) { bottom = running; top = running + s.value; } else { top = running; bottom = running + s.value; } running += s.value; }
    return { ...s, top, bottom };
  });

  const maxRunning = Math.max(...bars.map(b=>b.top), ...bars.map(b=>b.bottom));
  const maxY = Math.max(500, Math.ceil(maxRunning/500)*500 + 200), minY = 0;
  const W = 1120, H = 340, padT = 30, padB = 58, padL = 60, padR = 20;
  const plotH = H - padT - padB;
  const plotW = W - padL - padR;
  const n = bars.length;
  const gap = 18;
  const bw = (plotW - gap*(n-1)) / n;
  const y = (v) => padT + plotH * (1 - (v - minY)/(maxY - minY));
  const x = (i) => padL + i*(bw+gap);
  const toneColor = (tone) => ({ green:'#3f7a5f', brand:'#1e3a34', amber:'#c79a3a', orange:'#b87c3f', muted:'#8b8984' }[tone] || '#1e3a34');

  return (
    <div>
      <div style={{ border:'1px solid var(--border)', borderRadius:8, padding:'14px 8px 2px', background:'var(--bg-elev)' }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width:'100%', height:380, display:'block' }}>
          <defs>
            <pattern id="wf-hatch-pnl" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#b87c3f" strokeWidth="1.2" opacity="0.35"/>
            </pattern>
          </defs>
          {[0, 500, 1000, 1500, 2000, 2500, 3000].filter(g=>g<=maxY).map(g => (
            <g key={g}>
              <line x1={padL} x2={W-padR} y1={y(g)} y2={y(g)} stroke="#eeece5" strokeWidth="1"/>
              <text x={padL-8} y={y(g)+3} fontSize="10" fill="#8b8984" textAnchor="end">{g===0?'$0':g>=1000?`$${(g/1000).toFixed(1)}M`:`$${g}k`}</text>
            </g>
          ))}
          <line x1={padL} x2={W-padR} y1={y(0)} y2={y(0)} stroke="#c9c4b8" strokeWidth="1.2"/>

          {bars.map((b, i) => {
            const isFlow = b.kind==='flow';
            const neg = b.value < 0;
            const barTop = y(b.top);
            const barBottom = y(b.bottom);
            const barH = Math.max(2, barBottom - barTop);
            const fill = toneColor(b.tone);
            const isSubtotal = b.kind==='subtotal' || b.kind==='total';
            const isHover = hover === b.key;
            return (
              <g key={b.key} style={{ cursor:'pointer' }} onClick={()=>onDrill && onDrill(b.drill, b)} onMouseEnter={()=>setHover(b.key)} onMouseLeave={()=>setHover(null)}>
                <rect x={x(i)-3} y={padT-8} width={bw+6} height={plotH+16} fill={isHover?'rgba(30,58,52,.04)':'transparent'} rx="3"/>
                {i > 0 && (
                  <line x1={x(i-1)+bw} x2={x(i)} y1={y(bars[i-1].top)} y2={isFlow ? (neg ? y(b.top) : y(b.bottom)) : y(b.top)} stroke="#b8b2a6" strokeWidth="1" strokeDasharray="3 3"/>
                )}
                <rect x={x(i)} y={barTop} width={bw} height={barH} fill={isFlow && neg ? 'url(#wf-hatch-pnl)' : fill} stroke={isFlow && neg ? '#b87c3f' : fill} strokeWidth={isHover?2:1.2} rx="2"/>
                {isSubtotal && (<line x1={x(i)} x2={x(i)+bw} y1={barTop} y2={barTop} stroke="#111" strokeWidth="2"/>)}
                <text x={x(i)+bw/2} y={isFlow && neg ? barBottom + 14 : barTop - 6} fontSize="11" fontWeight="600" fill={isFlow && neg ? '#b87c3f' : '#1e3a34'} textAnchor="middle" fontFamily="var(--font-mono)">{fmtK(b.value)}</text>
                <text x={x(i)+bw/2} y={H - padB + 14} fontSize="10.5" fill="#3c3c36" textAnchor="middle" fontWeight={isSubtotal?'600':'400'}>{b.label}</text>
                <text x={x(i)+bw/2} y={H - padB + 26} fontSize="9" fill="#8b8984" textAnchor="middle">{b.sub}</text>
                <text x={x(i)+bw/2} y={H - padB + 40} fontSize="8.5" fill="#8b8984" textAnchor="middle" fontFamily="var(--font-mono)" style={{ opacity: isHover?1:0, transition:'opacity .15s' }}>click to drill →</text>
              </g>
            );
          })}
          {bars.map((b, i) => {
            if (b.kind !== 'subtotal' && b.key !== 'profit') return null;
            const denom = bars[0].value || 1;
            const pct = Math.round(b.value / denom * 100);
            const label = mode==='cash' ? '% of cash in' : '% of booked';
            return (<text key={`pct-${b.key}`} x={x(i)+bw/2} y={y(b.top)-22} fontSize="9.5" fill="#8b8984" textAnchor="middle" fontStyle="italic">{pct}{label.slice(1)}</text>);
          })}
        </svg>
      </div>
      <div className="row gap-sm" style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10, flexWrap:'wrap' }}>
        <div className="row gap-sm"><span style={{ width: 14, height: 10, background: '#1e3a34' }}/><span>Revenue / value position</span></div>
        <div className="row gap-sm"><span style={{ width: 14, height: 10, background: '#3f7a5f' }}/><span>Margin / profit subtotal</span></div>
        <div className="row gap-sm"><span style={{ width: 14, height: 10, background: '#fff', border:'1px solid #b87c3f' }}/><span>Cost / deduction</span></div>
        <div className="row gap-sm"><span style={{ width: 14, height: 10, background: '#c79a3a' }}/><span>Receivables</span></div>
        <span className="txt-muted" style={{ marginLeft:'auto', fontStyle:'italic' }}>Click any bar to drill into underlying projects or line items →</span>
      </div>
    </div>
  );
};

// ========= DRILLDOWN DRAWER =====================================================
const WaterfallDrill = ({ stage, onClose }) => {
  if (!stage) return null;
  const LABELS = {
    booked:    { title:'Booked revenue', sub:'$2.46M · signed SOWs in FY26', cols:['Project','Client','Booked','Signed','Owner','Status'] },
    unbilled:  { title:'Unbilled / WIP', sub:'$540k · work done but not invoiced', cols:['Project','Client','WIP','Next invoice','Owner','Why'] },
    invoiced:  { title:'Invoiced', sub:'$1.92M · issued to clients', cols:['Invoice','Project','Amount','Issued','Due','Status'] },
    ar:        { title:'A/R outstanding', sub:'$280k · invoiced, awaiting payment', cols:['Invoice','Client','Amount','Issued','Age','Status'] },
    paid:      { title:'Cash collected', sub:'$1.64M · paid into bank', cols:['Invoice','Client','Amount','Paid','Days-to-pay','Reconciled'] },
    projexp:   { title:'Project delivery', sub:'$790k · direct project costs', cols:['Project','Category','Amount','% of project','Vendor','Status'] },
    gm:        { title:'Gross margin by project', sub:'$850k · after direct costs', cols:['Project','Revenue','Cost','Margin','Margin %','Status'] },
    opex:      { title:'OPEX breakdown', sub:'$240k · firm overheads', cols:['Category','Vendor','Monthly','YTD','Coverage','Status'] },
    ebit:      { title:'EBIT composition', sub:'$610k · operating profit', cols:['Line','Source','Amount','% of revenue','Trend','Note'] },
    tax:       { title:'Tax + reserve', sub:'$220k · accrued', cols:['Component','Basis','Rate','Amount','Note','—'] },
    profit:    { title:'Partner profit allocation', sub:'$390k · distributable', cols:['Partner','Base share','BD add','Firm bonus','Net','Status'] },
  };
  const meta = LABELS[stage];

  // Dataset per stage
  const DATA = {
    booked: FY26_PROJECTS.map(p => [p[0], p[1], '$'+p[4]+'k', p[12], p[11], p[3]]),
    unbilled: FY26_PROJECTS.filter(p=>p[8]>0).map(p => [p[0], p[1], '$'+p[8]+'k', 'M'+(Math.floor(Math.random()*4)+3), p[11], p[3]==='setup'?'work just started':p[3]==='kickoff'?'awaiting milestone':'milestone due']),
    invoiced: [
      ['INV-2026-011','IFM001','$240k','18 Mar','02 Apr','paid'],
      ['INV-2026-012','IFM001','$140k','02 Apr','16 Apr','outstanding'],
      ['INV-2026-013','GNC001','$420k','10 Apr','24 Apr','paid'],
      ['INV-2026-014','PNC001','$310k','12 Apr','26 Apr','outstanding'],
      ['INV-2026-015','IFM002','$140k','20 Apr','04 May','paid'],
      ['INV-2026-016','IFM002','$140k','28 Apr','12 May','paid'],
      ['INV-2026-017','BMX001','$80k','30 Apr','14 May','paid'],
      ['INV-2026-018','PNC001','$140k','10 May','24 May','partial'],
    ],
    ar: [
      ['INV-2026-012','IFM','$140k','02 Apr','29d','due'],
      ['INV-2026-014','Panacea','$310k','12 Apr','19d','due'],
      ['INV-2026-011','IFM','$48k residual','18 Mar','42d overdue','chase'],
      ['INV-2026-018','Panacea','$70k partial','10 May','21d','due'],
    ],
    paid: [
      ['INV-2026-010','IFM','$160k','05 Feb','35d','✓'],
      ['INV-2026-011','IFM','$240k','02 Apr','15d','✓'],
      ['INV-2026-013','Genica','$420k','24 Apr','14d','✓'],
      ['INV-2026-015','IFM','$140k','04 May','14d','✓'],
      ['INV-2026-016','IFM','$140k','12 May','14d','✓'],
      ['INV-2026-017','Biomax','$80k','14 May','14d','✓'],
      ['INV-2026-009','Genica','$280k','28 Feb','28d','✓'],
      ['INV-2026-008','Panacea','$180k','15 Feb','32d','✓'],
    ],
    projexp: [
      ['IFM001','Consultants','$195k','33%','CC, JB internal','booked'],
      ['GNC001','Consultants','$195k','46%','SR, JB internal','booked'],
      ['PNC001','Experts','$98k','13%','Hawksparks, AP','booked'],
      ['PNC001','Travel','$22k','3%','Qantas, Ovolo','booked'],
      ['IFM002','Consultants','$80k','29%','MB, CC internal','booked'],
      ['BMX001','Experts','$85k','27%','ExpertNet','booked'],
      ['IFM001','Travel','$24k','4%','Qantas, Uber','booked'],
      ['GNC001','M&E','$18k','4%','various','booked'],
      ['ADX001','Setup','$73k','41%','internal','booked'],
    ],
    gm: FY26_PROJECTS.map(p => [p[0], '$'+p[4]+'k', '$'+p[9]+'k', '$'+(p[4]-p[9])+'k', p[10]+'%', p[10]>=45?'healthy':'watch']),
    opex: [
      ['Office & rent','WorkClub','$7.4k','$88k','covered','live'],
      ['Technology','Notion/GWS/Slack','$5.9k','$71k','covered','live'],
      ['Legal','Clayton Utz','$5.7k','$68k','covered','live'],
      ['Finance & payroll','Xero + Bishop','$3.9k','$47k','covered','live'],
      ['Insurance','PI + GL','$2.8k','$33k','covered','live'],
      ['Marketing','Canva + web','$2.1k','$25k','covered','live'],
      ['Other','—','$1.4k','$17k','covered','—'],
    ],
    ebit: [
      ['Gross margin','7 projects','$850k','44%','↑ vs Q3','—'],
      ['– OPEX','firm overhead','−$240k','12%','flat','in line'],
      ['EBIT','operating profit','$610k','31%','↑ 2pp QoQ','target 28%'],
    ],
    tax: [
      ['Income tax accrual','EBIT × 30%','30%','$183k','federal + state','—'],
      ['Working capital reserve','3mo OPEX','—','$60k','buffer','—'],
      ['Insurance top-up','annual','—','$12k','PI renewal Nov','—'],
      ['Adjustments','R&D incentive','−','−$35k','credit','—'],
    ],
    profit: [
      ['TT (Managing)','$130k','+$18k','+$12k','$160k','auto-calc'],
      ['MB (Partner)','$130k','+$24k','+$8k','$162k','auto-calc'],
      ['SR (Assoc)','$78k','+$6k','+$4k','$88k','0.6 FTE · pro-rata'],
      ['Reserve','$52k','—','−$32k','$20k','retained · buffer'],
    ],
  };

  const rows = DATA[stage] || [];
  const totalCell = rows.length>0 ? rows.length + ' rows' : '';

  const hintForStage = {
    booked: 'All $2.46M of FY26 booked revenue. Click a project to open its workspace.',
    unbilled: 'Work done but not yet invoiced. Lagging invoicing ties up cash — check milestone schedules.',
    invoiced: 'Every invoice issued in FY26 YTD. Filter by status or follow to Invoice intake for a specific record.',
    ar: 'Outstanding receivables. Chase the 42d+ overdue first (IFM001 residual).',
    paid: 'Collected cash. Average days-to-pay is 20 — healthy.',
    projexp: 'Direct project costs charged to COGS. Consultants (~60%) + experts + travel.',
    gm: 'Margin per project. GNC001 at 54% is best-in-class; PNC001 at 46% needs expert-cost watch.',
    opex: 'Firm overheads. Contribution from active projects is 4.4× OPEX — comfortable.',
    ebit: 'Operating profit composition. 31% EBIT margin is above the 28% partner target.',
    tax: 'Not cash-out — accrual + retained buffer. Released on partner distribution.',
    profit: 'Distributable to partners after true-up. BD add and firm bonus come out of $85k partner pool.',
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e=>e.stopPropagation()} style={{ width: 900 }}>
        <div className="drawer-header">
          <div>
            <div className="txt-sm txt-muted">Waterfall drill-down</div>
            <h2 style={{ margin:'4px 0 0', fontFamily:'var(--font-serif)', fontWeight:400, fontSize:24 }}>{meta.title}</h2>
            <div className="txt-sm txt-muted" style={{ marginTop:6 }}>{meta.sub}</div>
          </div>
          <div className="row gap-sm">
            <Btn sm ghost icon="download">Export</Btn>
            <Btn sm ghost onClick={onClose}>✕</Btn>
          </div>
        </div>
        <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--divider)', background:'var(--bg-subtle)' }}>
          <div className="txt-sm" style={{ color:'var(--text-2)' }}>{hintForStage[stage]}</div>
        </div>
        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          <div className="card">
            <div className="card-header"><h3>{meta.title} · {rows.length} rows</h3><div className="row gap-sm"><Btn sm ghost icon="filter">Filter</Btn><Btn sm ghost>Columns</Btn></div></div>
            <table className="data">
              <thead><tr>{meta.cols.filter(c=>c!=='—').map((c,i)=><th key={i} className={i>=2&&i<=3?'num':''}>{c}</th>)}</tr></thead>
              <tbody>
                {rows.map((r,i)=>(
                  <tr key={i} style={{ cursor:'pointer' }} onClick={()=>{
                    if (stage==='booked' || stage==='unbilled' || stage==='gm' || stage==='projexp') {
                      const code = r[0]; if (/^[A-Z]{3}\d{3}$/.test(code)) window.__nav && window.__nav('projects', { projectCode: code });
                    } else if (stage==='invoiced' || stage==='ar' || stage==='paid') {
                      window.__nav && window.__nav('invoices');
                    } else if (stage==='opex') {
                      window.__nav && window.__nav('costplan');
                    } else if (stage==='profit') {
                      window.__nav && window.__nav('trueup');
                    }
                  }}>
                    {r.map((c,ci)=><td key={ci} className={ci>=2&&ci<=3?'num mono':''}>{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="drawer-footer" style={{ borderTop:'1px solid var(--border)', padding:'12px 20px', display:'flex', gap:8, justifyContent:'space-between', alignItems:'center' }}>
          <div className="txt-sm txt-muted">Total {meta.title.toLowerCase()}: <b className="mono" style={{ color:'var(--text)' }}>{stage==='booked'?'$2.46M':stage==='unbilled'?'$540k':stage==='invoiced'?'$1.92M':stage==='ar'?'$280k':stage==='paid'?'$1.64M':stage==='projexp'?'$790k':stage==='gm'?'$850k':stage==='opex'?'$240k':stage==='ebit'?'$610k':stage==='tax'?'$220k':'$390k'}</b></div>
          <div className="row gap-sm">
            <Btn sm ghost>Download CSV</Btn>
            <Btn sm primary>Open in sandbox →</Btn>
          </div>
        </div>
      </div>
    </div>
  );
};

// ========= SANDBOX MODELER ======================================================
// Toggle projects on/off, add placeholder revenue, adjust OPEX, see cascade recompute.
const SandboxModeler = ({ scenario, setScenario, onReset }) => {
  const [projectToggles, setProjectToggles] = React.useState(() => Object.fromEntries(FY26_PROJECTS.map(p=>[p[0],true])));
  const [placeholders, setPlaceholders] = React.useState([]);
  const [opexMult, setOpexMult] = React.useState(1.0);
  const [collectionRate, setCollectionRate] = React.useState(0.85); // % of invoiced → paid
  const [invoiceRate, setInvoiceRate] = React.useState(0.78);       // % of booked → invoiced

  // Recompute cascade
  React.useEffect(()=>{
    const includedProjects = FY26_PROJECTS.filter(p=>projectToggles[p[0]]);
    const basebooked = includedProjects.reduce((a,p)=>a+p[4],0);
    const placebooked = placeholders.reduce((a,p)=>a+(+p.value||0),0);
    const booked = basebooked + placebooked;

    const invoiced = Math.round(booked * invoiceRate);
    const unbilled = booked - invoiced;
    const paid = Math.round(invoiced * collectionRate);
    const ar = invoiced - paid;

    // Project cost — use real project ratios where available, 48% blended for placeholders
    const baseCost = includedProjects.reduce((a,p)=>a+p[9],0);
    const placeCost = Math.round(placebooked * 0.48);
    const projCost = baseCost + placeCost;

    // But project cost only applies to *invoiced* portion for cash-view. Use same invoiced ratio.
    const costRecognised = Math.round((projCost) * invoiceRate);
    const gm = invoiced - costRecognised;

    const opex = Math.round(240 * opexMult);
    const ebit = gm - opex;
    const taxReserve = Math.round(Math.max(0, ebit) * 0.36);
    const profit = ebit - taxReserve;

    setScenario({
      booked, unbilled, invoiced, ar, paid,
      projCost: costRecognised, gm, opex, ebit, taxReserve, profit,
    });
  }, [projectToggles, placeholders, opexMult, collectionRate, invoiceRate]);

  const addPlaceholder = () => {
    setPlaceholders(p => [...p, { id:Date.now(), name:`Hypothetical ${p.length+1}`, value:200, stage:'proposal', probability:50 }]);
  };

  const resetAll = () => {
    setProjectToggles(Object.fromEntries(FY26_PROJECTS.map(p=>[p[0],true])));
    setPlaceholders([]);
    setOpexMult(1.0);
    setCollectionRate(0.85);
    setInvoiceRate(0.78);
    onReset && onReset();
  };

  return (
    <div className="stack">
      <Callout tone="info" title="Sandbox mode">Toggle projects, add hypothetical deals, adjust collection / OPEX assumptions. The waterfall above recomputes live. Nothing here touches real data.</Callout>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="card">
          <div className="card-header"><h3>Include projects</h3><span className="txt-sm txt-muted">{Object.values(projectToggles).filter(Boolean).length} of {FY26_PROJECTS.length} on</span></div>
          <div className="card-body" style={{ padding:0 }}>
            {FY26_PROJECTS.map(p => (
              <label key={p[0]} style={{ display:'grid', gridTemplateColumns:'auto 80px 1fr 70px 70px', gap:10, alignItems:'center', padding:'9px 14px', borderBottom:'1px solid var(--divider)', cursor:'pointer', background: projectToggles[p[0]]?'transparent':'var(--bg-subtle)', opacity: projectToggles[p[0]]?1:0.55 }}>
                <input type="checkbox" checked={!!projectToggles[p[0]]} onChange={e=>setProjectToggles(t=>({...t, [p[0]]: e.target.checked}))} />
                <b className="mono" style={{ fontSize:12 }}>{p[0]}</b>
                <span className="txt-sm">{p[1]} · <span className="txt-muted">{p[2]}</span></span>
                <span className="mono txt-sm" style={{ textAlign:'right' }}>${p[4]}k</span>
                <Badge tone={p[10]>=50?'green':'amber'}>{p[10]}%</Badge>
              </label>
            ))}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-header"><h3>Hypothetical deals</h3><Btn sm onClick={addPlaceholder} icon="plus">Add deal</Btn></div>
            <div className="card-body">
              {placeholders.length === 0 && <div className="txt-sm txt-muted" style={{ padding:'10px 0' }}>No hypothetical revenue added. Click <b>Add deal</b> to model a new project, BD conversion, or expansion.</div>}
              {placeholders.map((ph, i) => (
                <div key={ph.id} className="row gap-sm" style={{ padding:'8px 0', borderBottom:i<placeholders.length-1?'1px solid var(--divider)':'none', alignItems:'center' }}>
                  <input value={ph.name} onChange={e=>setPlaceholders(p=>p.map(x=>x.id===ph.id?{...x,name:e.target.value}:x))} style={{ flex:1, padding:'6px 8px', border:'1px solid var(--border)', borderRadius:4, fontSize:13 }}/>
                  <span className="mono txt-sm">$</span>
                  <input type="number" value={ph.value} onChange={e=>setPlaceholders(p=>p.map(x=>x.id===ph.id?{...x,value:+e.target.value}:x))} style={{ width:70, padding:'6px 8px', border:'1px solid var(--border)', borderRadius:4, fontSize:13, fontFamily:'var(--font-mono)' }}/>
                  <span className="mono txt-sm">k</span>
                  <select value={ph.stage} onChange={e=>setPlaceholders(p=>p.map(x=>x.id===ph.id?{...x,stage:e.target.value}:x))} style={{ padding:'6px 8px', border:'1px solid var(--border)', borderRadius:4, fontSize:12 }}>
                    <option>lead</option><option>qualified</option><option>proposal</option><option>verbal</option><option>won</option>
                  </select>
                  <Btn sm ghost onClick={()=>setPlaceholders(p=>p.filter(x=>x.id!==ph.id))}>✕</Btn>
                </div>
              ))}
              {placeholders.length > 0 && <div className="row-spread txt-sm" style={{ marginTop:10, paddingTop:10, borderTop:'1px solid var(--divider)' }}><span className="txt-muted">Hypothetical total</span><b className="mono">${placeholders.reduce((a,p)=>a+(+p.value||0),0)}k</b></div>}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3>Assumptions</h3><Btn sm ghost onClick={resetAll}>Reset</Btn></div>
            <div className="card-body">
              <div className="stack" style={{ gap:14 }}>
                <SliderRow label="Invoice rate" sub="% of booked invoiced in FY26" value={invoiceRate} onChange={setInvoiceRate} min={0.4} max={1} step={0.01} format={v=>`${Math.round(v*100)}%`}/>
                <SliderRow label="Collection rate" sub="% of invoiced collected" value={collectionRate} onChange={setCollectionRate} min={0.6} max={1} step={0.01} format={v=>`${Math.round(v*100)}%`}/>
                <SliderRow label="OPEX multiplier" sub="vs baseline $240k" value={opexMult} onChange={setOpexMult} min={0.7} max={1.5} step={0.05} format={v=>`${v.toFixed(2)}× ($${Math.round(240*v)}k)`}/>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>Scenario summary</h3><div className="row gap-sm"><Btn sm ghost>Save scenario</Btn><Btn sm ghost icon="download">Export model</Btn></div></div>
        <div className="card-body">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap:8 }}>
            <ScenarioKpi label="Booked" value={fmtK(scenario.booked)}/>
            <ScenarioKpi label="Invoiced" value={fmtK(scenario.invoiced)}/>
            <ScenarioKpi label="Paid" value={fmtK(scenario.paid)}/>
            <ScenarioKpi label="Gross margin" value={fmtK(scenario.gm)} pct={Math.round(scenario.gm/scenario.invoiced*100)+'%'}/>
            <ScenarioKpi label="EBIT" value={fmtK(scenario.ebit)} pct={Math.round(scenario.ebit/scenario.booked*100)+'%'}/>
            <ScenarioKpi label="Partner profit" value={fmtK(scenario.profit)} tone="green"/>
          </div>
        </div>
      </div>
    </div>
  );
};

const SliderRow = ({ label, sub, value, onChange, min, max, step, format }) => (
  <div>
    <div className="row-spread">
      <div><div style={{ fontSize:13, fontWeight:500 }}>{label}</div><div className="txt-sm txt-muted">{sub}</div></div>
      <b className="mono" style={{ fontSize:14 }}>{format ? format(value) : value}</b>
    </div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(+e.target.value)} style={{ width:'100%', marginTop:6 }}/>
  </div>
);

const ScenarioKpi = ({ label, value, pct, tone }) => (
  <div style={{ border:'1px solid var(--divider)', borderRadius:6, padding:'10px 12px', background:'#fff' }}>
    <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', fontWeight:600 }}>{label}</div>
    <div style={{ fontFamily:'var(--font-mono)', fontSize:20, fontWeight:500, color: tone==='green'?'var(--green)':'var(--text)', marginTop:2 }}>{value}</div>
    {pct && <div className="txt-sm txt-muted" style={{ fontSize:10.5, marginTop:2 }}>{pct} of revenue</div>}
  </div>
);

// ========= P&L STATEMENT VIEW ===================================================
const PnLStatement = ({ scenario }) => {
  const [view, setView] = React.useState('ytd'); // ytd | monthly | yoy
  return (
    <div className="stack">
      <div className="row-spread">
        <div className="segmented">
          {[['ytd','FY26 YTD'],['monthly','Monthly trend'],['yoy','Year-over-year']].map(([k,l])=>(
            <button key={k} className={view===k?'active':''} onClick={()=>setView(k)}>{l}</button>
          ))}
        </div>
        <div className="row gap-sm"><Btn sm ghost icon="download">Export PDF</Btn><Btn sm ghost icon="download">Export Excel</Btn></div>
      </div>

      {view==='ytd' && <PnLTable scenario={scenario}/>}
      {view==='monthly' && <PnLMonthly/>}
      {view==='yoy' && <PnLYoY/>}
    </div>
  );
};

const PnLTable = ({ scenario }) => {
  const rows = [
    ['Booked revenue', scenario.booked, null, 'header'],
    ['Unbilled / WIP', -scenario.unbilled, 'deferred to FY27', 'flow'],
    ['Invoiced revenue', scenario.invoiced, Math.round(scenario.invoiced/scenario.booked*100)+'% of booked', 'subtotal'],
    ['A/R outstanding', -scenario.ar, 'awaiting payment', 'flow'],
    ['Cash collected', scenario.paid, Math.round(scenario.paid/scenario.booked*100)+'% of booked', 'subtotal'],
    ['', null, null, 'spacer'],
    ['Cost of delivery', -scenario.projCost, Math.round(scenario.projCost/scenario.invoiced*100)+'% of revenue', 'cost'],
    ['  · Consultants', -Math.round(scenario.projCost*0.62), '62% of project cost', 'sub'],
    ['  · Experts / subs', -Math.round(scenario.projCost*0.24), '24% of project cost', 'sub'],
    ['  · Travel & M&E', -Math.round(scenario.projCost*0.10), '10% of project cost', 'sub'],
    ['  · Other', -Math.round(scenario.projCost*0.04), '4% of project cost', 'sub'],
    ['Gross margin', scenario.gm, Math.round(scenario.gm/scenario.invoiced*100)+'% margin', 'subtotal'],
    ['', null, null, 'spacer'],
    ['OPEX', -scenario.opex, Math.round(scenario.opex/scenario.invoiced*100)+'% of revenue', 'cost'],
    ['  · Office & rent', -Math.round(scenario.opex*0.37), 'WorkClub', 'sub'],
    ['  · Technology', -Math.round(scenario.opex*0.27), 'Notion / GWS / Slack', 'sub'],
    ['  · Legal & insurance', -Math.round(scenario.opex*0.21), 'Clayton Utz + PI', 'sub'],
    ['  · Finance & payroll', -Math.round(scenario.opex*0.10), 'Xero + Bishop', 'sub'],
    ['  · Marketing & other', -Math.round(scenario.opex*0.05), 'Canva + web', 'sub'],
    ['EBIT', scenario.ebit, Math.round(scenario.ebit/scenario.booked*100)+'% of booked', 'subtotal'],
    ['', null, null, 'spacer'],
    ['Tax accrual', -Math.round(scenario.taxReserve*0.83), '30% on EBIT', 'cost'],
    ['Reserve top-up', -Math.round(scenario.taxReserve*0.17), '3mo OPEX buffer', 'cost'],
    ['Partner profit (distributable)', scenario.profit, 'before true-up', 'total'],
  ];

  return (
    <div className="card">
      <div className="card-header"><h3>FY26 YTD P&L · May (month 11/12)</h3><span className="txt-sm txt-muted">all figures in thousands</span></div>
      <table className="data" style={{ fontSize:13 }}>
        <thead><tr><th>Line item</th><th className="num">Amount</th><th>Note</th></tr></thead>
        <tbody>
          {rows.map((r,i)=>{
            if (r[3]==='spacer') return <tr key={i} style={{ height:8 }}><td colSpan={3} style={{ borderBottom:'none !important', background:'var(--bg-subtle)' }}></td></tr>;
            const isTotal = r[3]==='total';
            const isSub = r[3]==='subtotal';
            const isHeader = r[3]==='header';
            const isSubLine = r[3]==='sub';
            const isNeg = r[1]!==null && r[1]<0;
            return (
              <tr key={i} style={{ background: isTotal?'var(--accent-soft)':isSub?'var(--bg-subtle)':'transparent', fontWeight: isTotal||isSub||isHeader?600:400 }}>
                <td style={{ paddingLeft: isSubLine?28:14, color: isSubLine?'var(--text-2)':'var(--text)', fontSize: isTotal?14:isSubLine?12:13 }}>{r[0]}</td>
                <td className="num mono" style={{ color: isNeg?'var(--text-3)':isTotal?'var(--green)':'var(--text)', fontSize:isTotal?15:13, fontWeight: isTotal||isSub?600:500 }}>{r[1]===null?'':fmtK(r[1])}</td>
                <td className="txt-sm txt-muted" style={{ fontSize:11 }}>{r[2] || ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const PnLMonthly = () => {
  // 12 months of FY26 (Jul 25 - Jun 26), with May and Jun being forecast
  const months = ['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'];
  const revenue = [140, 160, 180, 190, 210, 190, 220, 240, 260, 260, 240, 250];
  const cost = [68, 72, 82, 85, 96, 84, 98, 108, 117, 117, 108, 113];
  const opex = [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20];
  const ebit = revenue.map((r,i) => r - cost[i] - opex[i]);
  const isFwd = i => i >= 10; // May (10), Jun (11) are forecast

  const W = 1080, H = 320, padL = 60, padR = 20, padT = 20, padB = 40;
  const plotH = H - padT - padB, plotW = W - padL - padR;
  const maxY = 300;
  const y = v => padT + plotH * (1 - v/maxY);
  const bw = plotW / months.length * 0.75;
  const bgap = plotW / months.length * 0.25;
  const x = i => padL + i*(bw+bgap) + bgap/2;

  return (
    <div className="stack">
      <div className="card">
        <div className="card-header"><h3>Monthly revenue, cost & EBIT · FY26</h3><span className="txt-sm txt-muted">May–Jun are forecast</span></div>
        <div className="card-body">
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:340, display:'block' }}>
            {[0,50,100,150,200,250,300].map(g=>(
              <g key={g}><line x1={padL} x2={W-padR} y1={y(g)} y2={y(g)} stroke="#eeece5"/><text x={padL-8} y={y(g)+3} fontSize="10" fill="#8b8984" textAnchor="end">${g}k</text></g>
            ))}
            {months.map((m,i)=>(
              <g key={m}>
                <rect x={x(i)} y={y(revenue[i])} width={bw*0.45} height={plotH - (y(revenue[i])-padT)} fill={isFwd(i)?'url(#pnl-hatch)':'#1e3a34'} stroke={isFwd(i)?'#1e3a34':'none'} strokeDasharray={isFwd(i)?'3 3':'none'} rx="1.5"/>
                <rect x={x(i)+bw*0.5} y={y(cost[i]+opex[i])} width={bw*0.45} height={plotH - (y(cost[i]+opex[i])-padT)} fill={isFwd(i)?'url(#pnl-hatch-red)':'#b87c3f'} rx="1.5"/>
                <text x={x(i)+bw/2} y={H-padB+14} fontSize="10" fill="#3c3c36" textAnchor="middle">{m}</text>
                <text x={x(i)+bw/2} y={H-padB+26} fontSize="9" fill="#8b8984" textAnchor="middle" fontFamily="var(--font-mono)">{fmtK(ebit[i])}</text>
              </g>
            ))}
            <defs>
              <pattern id="pnl-hatch" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#1e3a34" strokeWidth="1" opacity="0.4"/></pattern>
              <pattern id="pnl-hatch-red" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#b87c3f" strokeWidth="1" opacity="0.4"/></pattern>
            </defs>
            <polyline points={months.map((_,i)=>`${x(i)+bw/2},${y(ebit[i])}`).join(' ')} fill="none" stroke="#3f7a5f" strokeWidth="2"/>
            {months.map((_,i)=><circle key={i} cx={x(i)+bw/2} cy={y(ebit[i])} r="3" fill="#3f7a5f"/>)}
          </svg>
          <div className="row gap-sm" style={{ fontSize:11, color:'var(--text-3)', marginTop:10 }}>
            <div className="row gap-sm"><span style={{ width:14,height:10,background:'#1e3a34' }}/><span>Revenue</span></div>
            <div className="row gap-sm"><span style={{ width:14,height:10,background:'#b87c3f' }}/><span>Cost + OPEX</span></div>
            <div className="row gap-sm"><span style={{ width:16,height:2,background:'#3f7a5f' }}/><span>EBIT trend</span></div>
            <div className="row gap-sm"><span style={{ width:14,height:10,background:'#fff',border:'1px dashed #1e3a34' }}/><span>Forecast</span></div>
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <div className="card">
          <div className="card-header"><h3>Revenue mix by sector</h3></div>
          <div className="card-body">
            {[['Pharma',72,'#1e3a34'],['MedTech',14,'#3f7a5f'],['Biotech',9,'#6fa88a'],['Other',5,'#c9c4b8']].map(([l,pct,c],i)=>(
              <div key={i} style={{ marginBottom:10 }}>
                <div className="row-spread"><span className="txt-sm">{l}</span><b className="mono">{pct}%</b></div>
                <div style={{ height:6, background:'var(--bg-subtle)', borderRadius:3, marginTop:4, overflow:'hidden' }}><div style={{ height:'100%', width:pct+'%', background:c }}/></div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>Top 5 projects by margin contribution</h3></div>
          <div className="card-body">
            {[['GNC001','Genica','$227k','54%'],['PNC001','Panacea','$359k','46%'],['IFM001','IFM','$288k','48%'],['IFM002','IFM','$140k','50%'],['BMX001','Biomax','$166k','52%']].map((r,i)=>(
              <div key={i} className="row-spread" style={{ padding:'6px 0', borderBottom:i<4?'1px solid var(--divider)':'none' }}>
                <div className="row gap-sm"><b className="mono txt-sm">{r[0]}</b><span className="txt-muted txt-sm">{r[1]}</span></div>
                <div className="row gap-sm"><b className="mono txt-sm">{r[2]}</b><Badge tone={+r[3].slice(0,-1)>=50?'green':'amber'}>{r[3]}</Badge></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const PnLYoY = () => {
  const years = ['FY23','FY24','FY25','FY26'];
  const revenue = [1180, 1640, 2050, 2460];
  const ebit = [180, 340, 510, 610];
  const margin = ebit.map((e,i)=>Math.round(e/revenue[i]*100));

  return (
    <div className="stack">
      <div className="card">
        <div className="card-header"><h3>Year-over-year</h3><span className="txt-sm txt-muted">FY26 is YTD-annualised</span></div>
        <div className="card-body">
          <div className="grid" style={{ gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
            {years.map((yr,i)=>(
              <div key={yr} style={{ border:'1px solid var(--divider)', borderRadius:6, padding:14, background: i===years.length-1?'var(--accent-soft)':'#fff' }}>
                <div className="row-spread"><b>{yr}</b>{i===years.length-1 && <Badge tone="brand" dot>current</Badge>}</div>
                <div style={{ fontFamily:'var(--font-mono)', fontSize:24, fontWeight:500, marginTop:6 }}>${(revenue[i]/1000).toFixed(2)}M</div>
                <div className="txt-sm txt-muted">revenue</div>
                <div className="hdiv" style={{ margin:'10px 0' }}/>
                <div className="row-spread txt-sm"><span className="txt-muted">EBIT</span><b className="mono">${ebit[i]}k</b></div>
                <div className="row-spread txt-sm"><span className="txt-muted">margin</span><b className="mono">{margin[i]}%</b></div>
                {i>0 && <div className="row-spread txt-sm" style={{ marginTop:6 }}><span className="txt-muted">YoY</span><b className="mono" style={{ color:'var(--green)' }}>+{Math.round((revenue[i]/revenue[i-1]-1)*100)}%</b></div>}
              </div>
            )).slice(-3)}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>Revenue & EBIT trajectory</h3></div>
        <div className="card-body">
          <svg viewBox="0 0 900 280" style={{ width:'100%', height:280, display:'block' }}>
            {[0,500,1000,1500,2000,2500].map(g=>(
              <g key={g}><line x1={60} x2={880} y1={240-g/12} y2={240-g/12} stroke="#eeece5"/><text x={52} y={244-g/12} fontSize="10" fill="#8b8984" textAnchor="end">${(g/1000).toFixed(1)}M</text></g>
            ))}
            {revenue.map((v,i)=>{
              const bx = 100 + i*(200);
              return (<g key={i}>
                <rect x={bx} y={240-v/12} width={60} height={v/12} fill="#1e3a34" rx="2"/>
                <rect x={bx+70} y={240-ebit[i]/12} width={60} height={ebit[i]/12} fill="#3f7a5f" rx="2"/>
                <text x={bx+30} y={240-v/12-6} fontSize="10" fill="#1e3a34" textAnchor="middle" fontFamily="var(--font-mono)" fontWeight="600">${(v/1000).toFixed(1)}M</text>
                <text x={bx+100} y={240-ebit[i]/12-6} fontSize="10" fill="#3f7a5f" textAnchor="middle" fontFamily="var(--font-mono)" fontWeight="600">${ebit[i]}k</text>
                <text x={bx+65} y={258} fontSize="11" fill="#3c3c36" textAnchor="middle" fontWeight="600">{years[i]}</text>
                <text x={bx+65} y={270} fontSize="9" fill="#8b8984" textAnchor="middle">{margin[i]}% margin</text>
              </g>);
            })}
          </svg>
          <div className="row gap-sm" style={{ fontSize:11, color:'var(--text-3)', marginTop:6 }}>
            <div className="row gap-sm"><span style={{ width:14,height:10,background:'#1e3a34' }}/><span>Revenue</span></div>
            <div className="row gap-sm"><span style={{ width:14,height:10,background:'#3f7a5f' }}/><span>EBIT</span></div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ========= REPORTS PANEL ========================================================
const PnLReports = () => {
  return (
    <div className="stack">
      <Callout tone="info" title="Generate reports">Packaged exports for the board, tax accountant, and partners. Each report pulls live numbers and is timestamped.</Callout>
      <div className="grid" style={{ gridTemplateColumns:'1fr 1fr', gap:12 }}>
        {[
          ['Board P&L · monthly', 'All lines, all months. PDF with cover + commentary. Sent to partners 5th of each month.', 'PDF · 12pp', 'Apr 2026'],
          ['Tax pack · FY26 YTD', 'P&L + B/S extract for Bishop Accounting. CSV + supporting schedules.', 'ZIP · 4 files', 'May 2026'],
          ['Partner distribution statement', 'Per-partner base + BD add + firm bonus. Runs after quarterly true-up.', 'PDF · 3pp', 'Q3 FY26'],
          ['Project margin review', 'Line-by-line margin with cost composition. For managers & partners.', 'PDF · 8pp', 'weekly'],
          ['Cash-flow forecast · 13wk', 'Rolling weekly forecast with scenario overlay. Board view.', 'PDF · 2pp', 'this Fri'],
          ['OPEX analytical review', 'Category-by-category OPEX vs budget vs prior quarter.', 'PDF · 4pp', 'monthly'],
        ].map((r,i)=>(
          <div key={i} className="card" style={{ cursor:'pointer' }}>
            <div className="card-header"><h3>{r[0]}</h3><Badge>{r[2]}</Badge></div>
            <div className="card-body">
              <div className="txt-sm" style={{ color:'var(--text-2)', minHeight:40 }}>{r[1]}</div>
              <div className="row-spread" style={{ marginTop:10 }}>
                <span className="txt-sm txt-muted">Last run: {r[3]}</span>
                <div className="row gap-sm"><Btn sm ghost icon="eye">Preview</Btn><Btn sm primary icon="download">Generate</Btn></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ========= MAIN SCREEN ==========================================================
const BASELINE = {
  booked: P.booked, unbilled: P.unbilled, invoiced: P.invoiced, ar: P.ar, paid: P.paid,
  projCost: P.projCost, gm: P.gm, opex: P.opex, ebit: P.ebit, taxReserve: P.taxReserve, profit: P.profit,
};

const PnL = () => {
  const [tab, setTab] = React.useState(() => window.__pnlTab || 'waterfall');
  const [drill, setDrill] = React.useState(() => window.__pnlDrill || null);
  const [scenario, setScenario] = React.useState(BASELINE);
  const [wfMode, setWfMode] = React.useState(() => window.__pnlWfMode || 'booked'); // 'booked' | 'cash'

  React.useEffect(()=>{
    if (window.__pnlTab) { setTab(window.__pnlTab); delete window.__pnlTab; }
    if (window.__pnlDrill) { setDrill(window.__pnlDrill); delete window.__pnlDrill; }
    if (window.__pnlWfMode) { setWfMode(window.__pnlWfMode); delete window.__pnlWfMode; }
  });

  const dirty = tab==='sandbox' && JSON.stringify(scenario) !== JSON.stringify(BASELINE);

  return (
    <div data-screen-label="P&L overview">
      <div className="row-spread" style={{ marginBottom: 14 }}>
        <div>
          <div className="row gap-sm">
            <h2 style={{ fontFamily:'var(--font-serif)', fontWeight:400, margin:0, fontSize:28 }}>P&L overview</h2>
            <Badge tone="brand" dot>FY26 YTD</Badge>
            {dirty && <Badge tone="amber" dot>sandbox · unsaved</Badge>}
          </div>
          <div className="txt-sm txt-muted" style={{ marginTop:4 }}>Interactive waterfall, sandbox modeling, statements and reports. Drill into any line to see underlying projects, invoices, or expenses.</div>
        </div>
        <div className="row gap-sm">
          {tab==='sandbox' && dirty && <Btn sm ghost onClick={()=>setScenario(BASELINE)}>Reset to actuals</Btn>}
          <Btn sm ghost icon="calendar">FY26 YTD</Btn>
          <Btn sm icon="download">Export</Btn>
          <Btn sm primary icon="plus" onClick={()=>setTab('sandbox')}>New scenario</Btn>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom:16 }}>
        {[['waterfall','Waterfall'],['statement','P&L statement'],['sandbox','Sandbox / forecast'],['reports','Reports']].map(([k,l])=>(
          <div key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</div>
        ))}
      </div>

      {tab==='waterfall' && (
        <div className="stack">
          <div className="card">
            <div className="card-header">
              <div>
                <h3>FY26 waterfall · {wfMode==='cash' ? 'cash in → realised profit' : 'booked → projected partner profit'}</h3>
                <div className="txt-sm txt-muted" style={{ marginTop:2 }}>
                  {wfMode==='cash'
                    ? 'Actual cash movements YTD. Collected payments in, real vendor/payroll/OPEX/tax paid out, leaves realised cash profit sitting in the bank.'
                    : 'Contracted revenue flows through forecasted delivery costs, overheads, and tax reserve to projected partner profit at year-end.'}
                </div>
              </div>
              <div className="row gap-sm">
                <div className="segmented">
                  <button className={wfMode==='booked'?'active':''} onClick={()=>setWfMode('booked')}>Booked → projected</button>
                  <button className={wfMode==='cash'?'active':''} onClick={()=>setWfMode('cash')}>Actual cash flow</button>
                </div>
                <Badge>{wfMode==='cash' ? 'actuals · YTD' : 'forecast · FY26'}</Badge>
              </div>
            </div>
            <div className="card-body">
              <InteractiveWaterfall scenario={scenario} mode={wfMode} onDrill={(stage)=>setDrill(stage)}/>
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns:'repeat(4, 1fr)', gap:12 }}>
            <WfKpiClickable label="Book-to-cash conversion" value="67%" sub="$1.64M of $2.46M booked" tone="amber" note="A/R aging drags · chase INV-011 residual" onClick={()=>setDrill('ar')}/>
            <WfKpiClickable label="Gross margin" value="44%" sub="$850k of $1.92M invoiced" tone="green" note="above 40% target" onClick={()=>setDrill('gm')}/>
            <WfKpiClickable label="OPEX coverage" value="28%" sub="$240k vs contribution pool" tone="green" note="contribution 4.4× OPEX" onClick={()=>setDrill('opex')}/>
            <WfKpiClickable label="Partner profit / partner" value="$130k" sub="$390k distributable ÷ 3" tone="green" note="pre-true-up · weighted" onClick={()=>setDrill('profit')}/>
          </div>

          <div className="grid" style={{ gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div className="card">
              <div className="card-header"><h3>Quick takes</h3></div>
              <div className="card-body">
                {[
                  ['green','GNC001 delivered at 54% margin','$227k contribution · best-in-class'],
                  ['amber','$280k A/R outstanding','$70k > 30 days · chase INV-011 residual'],
                  ['amber','PNC001 expert costs +18% over line','$98k vs $83k budget · review before M4 invoice'],
                  ['green','EBIT 31% beats 28% target','+2pp QoQ · partner pool healthy'],
                  ['amber','$540k WIP rolls to FY27','30% of booked revenue unbilled · invoice faster'],
                ].map((r,i)=>(
                  <div key={i} className="row gap-sm" style={{ padding:'10px 0', borderBottom: i<4?'1px solid var(--divider)':'none', alignItems:'flex-start' }}>
                    <span style={{ width:6, height:6, borderRadius:'50%', background: r[0]==='green'?'var(--green)':'var(--amber)', marginTop:7 }}/>
                    <div style={{ flex:1 }}>
                      <div className="txt-sm" style={{ fontWeight:500 }}>{r[1]}</div>
                      <div className="txt-sm txt-muted" style={{ marginTop:2 }}>{r[2]}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3>What-if shortcuts</h3><Btn sm ghost onClick={()=>setTab('sandbox')}>Open sandbox →</Btn></div>
              <div className="card-body">
                <div className="stack" style={{ gap:10 }}>
                  {[
                    ['Convert PNC002 ($680k · 40%)', 'Would add $272k weighted to pipeline · $82k EBIT impact', '+13% EBIT'],
                    ['Accelerate invoicing to 90%', 'Cut WIP from $540k to $246k · pulls forward $294k cash', '+18% cash'],
                    ['Renegotiate Clayton Utz scope', 'Legal −$2.8k/mo · −$34k OPEX annualised', '+$24k profit'],
                    ['Hire 1 FT consultant ($140k loaded)', 'Capacity +1 FTE · $420k revenue at 70% util', '+$134k EBIT'],
                  ].map((r,i)=>(
                    <div key={i} style={{ border:'1px solid var(--divider)', borderRadius:6, padding:'10px 12px', background:'#fff', cursor:'pointer' }} onClick={()=>setTab('sandbox')}>
                      <div className="row-spread"><b className="txt-sm">{r[0]}</b><Badge tone="green">{r[2]}</Badge></div>
                      <div className="txt-sm txt-muted" style={{ marginTop:3 }}>{r[1]}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab==='statement' && <PnLStatement scenario={scenario}/>}
      {tab==='sandbox' && (
        <div className="stack">
          <div className="card">
            <div className="card-header">
              <div>
                <h3>Projected waterfall · your scenario</h3>
                <div className="txt-sm txt-muted">Live recompute · adjust the levers below</div>
              </div>
              <div className="row gap-sm">
                <div className="segmented">
                  <button className={wfMode==='booked'?'active':''} onClick={()=>setWfMode('booked')}>Booked → projected</button>
                  <button className={wfMode==='cash'?'active':''} onClick={()=>setWfMode('cash')}>Actual cash flow</button>
                </div>
                <Badge tone={dirty?'amber':'brand'} dot>{dirty?'modified':'baseline'}</Badge>
              </div>
            </div>
            <div className="card-body">
              <InteractiveWaterfall scenario={scenario} mode={wfMode} onDrill={(stage)=>setDrill(stage)}/>
            </div>
          </div>
          <SandboxModeler scenario={scenario} setScenario={setScenario} onReset={()=>setScenario(BASELINE)}/>
        </div>
      )}
      {tab==='reports' && <PnLReports/>}

      {drill && <WaterfallDrill stage={drill} onClose={()=>setDrill(null)}/>}
    </div>
  );
};

const WfKpiClickable = ({ label, value, sub, tone, note, onClick }) => {
  const color = tone==='green' ? 'var(--green)' : tone==='amber' ? 'var(--amber)' : 'var(--text)';
  return (
    <div style={{ border:'1px solid var(--divider)', borderRadius:6, padding:'12px 14px', background:'#fff', cursor:'pointer', transition:'border-color .15s, box-shadow .15s' }} onClick={onClick} onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--brand)'; e.currentTarget.style.boxShadow='0 1px 4px rgba(30,58,52,.08)';}} onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--divider)'; e.currentTarget.style.boxShadow='none';}}>
      <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', fontWeight:600 }}>{label}</div>
      <div style={{ fontFamily:'var(--font-mono)', fontSize:22, fontWeight:500, color, marginTop:2 }}>{value}</div>
      <div className="txt-sm txt-muted" style={{ fontSize:11 }}>{sub}</div>
      <div className="txt-sm txt-muted" style={{ fontSize:10.5, marginTop:4, lineHeight:1.4 }}>{note}</div>
    </div>
  );
};

Object.assign(window, { PnL, InteractiveWaterfall, PNL_BASELINE: BASELINE });
