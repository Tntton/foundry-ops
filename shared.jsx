// components-shared.jsx
const Icon = ({ name, size = 16 }) => {
  const paths = {
    dashboard: 'M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z',
    briefcase: 'M4 7h16v13H4zM9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2',
    clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
    invoice: 'M14 3H6a2 2 0 0 0-2 2v14l3-2 2 2 2-2 3 2V5a2 2 0 0 0-2-2z M9 9h4M9 13h4',
    receipt: 'M4 4l1 18 4-2 3 2 3-2 4 2 1-18zM8 9h8M8 13h8M8 17h5',
    check: 'M4 12l5 5L20 6',
    team: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    chart: 'M3 3v18h18M7 14l4-4 3 3 6-7',
    target: 'M12 2a10 10 0 1 0 10 10M12 6a6 6 0 1 0 6 6M12 10a2 2 0 1 0 2 2',
    doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z',
    plus: 'M12 5v14M5 12h14',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
    upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    filter: 'M22 3H2l8 9.46V19l4 2v-8.54z',
    mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
    sheet: 'M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16',
    arrow: 'M5 12h14M13 6l6 6-6 6',
    chevron: 'M9 18l6-6-6-6',
    x: 'M18 6L6 18M6 6l12 12',
    zap: 'M13 2L3 14h9l-1 8 10-12h-9z',
    alert: 'M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
    sparkle: 'M12 3v18M3 12h18M5 5l14 14M19 5L5 19',
  };
  return (
    <svg className="ic" viewBox="0 0 24 24" width={size} height={size}>
      <path d={paths[name] || paths.dashboard} />
    </svg>
  );
};

const Badge = ({ tone = '', children, dot }) => (
  <span className={`badge ${tone}`}>{dot && <span className="dot"/>} {children}</span>
);

const XlsxPill = ({ state = 'synced', children }) => (
  <span className={`xlsx-pill ${state}`}>
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16"/></svg>
    {children || (state === 'synced' ? 'synced · 2m' : state === 'stale' ? 'stale' : 'conflict')}
  </span>
);

const Btn = ({ children, primary, ghost, sm, lg, icon, onClick }) => (
  <button className={`btn ${primary?'primary':''} ${ghost?'ghost':''} ${sm?'sm':''} ${lg?'lg':''}`} onClick={onClick}>
    {icon && <Icon name={icon} size={14}/>}
    {children}
  </button>
);

// ---------- Level-based avatar tones ----------
// Bands roughly follow the rate card in screens-directory-people.jsx.
// Palette is tonal (not rainbow) — pulls from brand tokens where possible,
// with oklch fills for bands that don't map to a semantic token.
const LEVEL_TONE = {
  // Partner tier — deepest brand forest
  mgpartner: 'var(--brand-ink)',
  L4: 'var(--brand)',
  L3: 'var(--brand-2)',
  // Leadership — steel blue
  L2: 'var(--blue)',
  L1: 'oklch(0.52 0.09 240)',
  // Consultant — teal, harmonious with brand forest
  T3: 'oklch(0.50 0.07 195)',
  T2: 'oklch(0.55 0.06 195)',
  T1: 'oklch(0.62 0.05 195)',
  // Fellow (clinical) — warm amber
  F2: 'var(--amber)',
  F1: 'oklch(0.62 0.10 70)',
  // Expert (external specialist) — plum
  E2: 'oklch(0.42 0.08 330)',
  E1: 'oklch(0.50 0.07 330)',
  // Analyst — warm sand
  A3: 'oklch(0.55 0.06 60)',
  A2: 'oklch(0.62 0.05 60)',
  A1: 'oklch(0.68 0.04 60)',
  // Intern — muted
  IO: 'var(--text-3)',
  // Ops (office manager) — slate
  office: 'oklch(0.50 0.02 250)',
};

// Initials → levelCode lookup (mirrors PERSON_DB in screens-directory-people.jsx).
// Keyed by initials so every Avatar in the product can resolve without props.
const PERSON_LEVEL = {
  TT: 'mgpartner', MB: 'L4', SR: 'L3',
  CC: 'T3', JB: 'A3', AP: 'E1', JS: 'office',
};

const toneForInitials = (init) => {
  if (!init) return 'var(--brand)';
  const key = String(init).toUpperCase().slice(0,3);
  const lvl = PERSON_LEVEL[key];
  if (lvl && LEVEL_TONE[lvl]) return LEVEL_TONE[lvl];
  return 'var(--text-3)'; // unknown person → neutral
};
const toneForLevel = (code) => LEVEL_TONE[code] || 'var(--brand)';
window.toneForInitials = toneForInitials;
window.toneForLevel = toneForLevel;
window.PERSON_LEVEL = PERSON_LEVEL;
window.LEVEL_TONE = LEVEL_TONE;

// ---------- Australian Financial Year helpers ----------
// AU FY runs Jul 1 → Jun 30. FY26 = Jul 2025 – Jun 2026.
// Today (Apr 19 2026) → FY26 Q4.
const AU_FY = (() => {
  const fyOf = (d=new Date()) => {
    const y = d.getFullYear();
    // Jul–Dec → FY is next calendar year; Jan–Jun → FY is this calendar year
    return d.getMonth() >= 6 ? y + 1 : y;
  };
  const fyLabel = (d=new Date()) => `FY${String(fyOf(d)).slice(-2)}`;
  // Q1=Jul-Sep, Q2=Oct-Dec, Q3=Jan-Mar, Q4=Apr-Jun
  const fyQuarter = (d=new Date()) => {
    const m = d.getMonth(); // 0-indexed
    if (m>=6 && m<=8) return 1;
    if (m>=9 && m<=11) return 2;
    if (m>=0 && m<=2) return 3;
    return 4;
  };
  const fyQuarterLabel = (d=new Date()) => `Q${fyQuarter(d)} ${fyLabel(d)}`;
  // Start (Jul 1) and end (Jun 30) for a given FY number (e.g. 26)
  const fyRange = (fy=fyOf()) => ({
    start: new Date(2000 + fy - 1, 6, 1),   // Jul 1 of prev CY
    end:   new Date(2000 + fy,     5, 30),  // Jun 30 of CY
  });
  // Human-readable spans for display
  const fyHuman = (fy=fyOf()) => `Jul ${2000+fy-1} – Jun ${2000+fy}`;
  // Month index within FY (0 = Jul, 11 = Jun) — used for YTD charts
  const fyMonthIdx = (d=new Date()) => (d.getMonth() + 6) % 12;
  // AU FY months in display order
  const FY_MONTHS = ['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'];
  return { fyOf, fyLabel, fyQuarter, fyQuarterLabel, fyRange, fyHuman, fyMonthIdx, FY_MONTHS };
})();
Object.assign(window, AU_FY);

const Avatar = ({ children, tone, size=28, level, src }) => {
  const initials = typeof children === 'string' ? children : '';
  // Auto-resolve photo from team data when given initials
  const resolvedSrc = src || (window.FT_BY_INITIALS?.[initials]?.avatar) || null;
  const resolved = tone
    || (level ? toneForLevel(level) : null)
    || toneForInitials(initials);
  const [err, setErr] = React.useState(false);
  if (resolvedSrc && !err) {
    return (
      <div className="avatar avatar-photo" style={{ width: size, height: size, fontSize: size<24?9:11, background: resolved }}>
        <img src={resolvedSrc} alt={initials} loading="lazy" onError={()=>setErr(true)}/>
      </div>
    );
  }
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size<24?9:11, background: resolved }}>{children}</div>
  );
};

const AvatarStack = ({ items }) => (
  <div className="avatar-stack">
    {items.map((a,i)=><div key={i} className="avatar" style={{ background: a.tone || toneForInitials(a.name) }}>{a.name}</div>)}
  </div>
);

const KPI = ({ label, value, sub, subTone, spark, delta, onClick, style }) => (
  <div className="card kpi" onClick={onClick} style={{ ...(onClick?{ cursor:'pointer' }:{}), ...(style||{}) }}>
    <div className="label">{label}</div>
    <div className="value">{value}</div>
    {sub && <div className="sub" style={{ color: subTone==='green'?'var(--green)':subTone==='red'?'var(--red)':subTone==='amber'?'var(--amber)':'var(--text-3)' }}>
      {delta && <span>{delta}</span>}
      {sub}
    </div>}
    {spark && (
      <div className="spark" style={{ marginTop: 10 }}>
        {spark.map((v,i)=><div key={i} className="b" style={{ height: `${v}%` }}/>)}
      </div>
    )}
  </div>
);

const Progress = ({ pct, tone }) => (
  <div className="progress"><div className={`fill ${tone||''}`} style={{ width: `${Math.min(100, pct)}%` }}/></div>
);

const BarRow = ({ label, pct, val, tone }) => (
  <div className="bar-row">
    <div className="lbl">{label}</div>
    <Progress pct={pct} tone={tone}/>
    <div className="val">{val}</div>
  </div>
);

const Callout = ({ tone, title, children }) => (
  <div className={`callout ${tone||''}`}>
    {title && <div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div>}
    {children}
  </div>
);

const SectionTitle = ({ children, right }) => (
  <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', margin:'8px 0 12px' }}>
    <h3 style={{ fontFamily:'var(--font-serif)', fontSize:22, fontWeight:400, margin:0, letterSpacing:'-0.01em' }}>{children}</h3>
    {right}
  </div>
);

Object.assign(window, { Icon, Badge, XlsxPill, Btn, Avatar, AvatarStack, KPI, Progress, BarRow, Callout, SectionTitle });
