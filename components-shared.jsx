// components-shared.jsx - shared primitives

const Tag = ({ children, tone = 'default' }) => (
  <span className={`tag ${tone}`}>{children}</span>
);

const ExcelPill = ({ state = 'synced', label }) => {
  const text = label || (state === 'synced' ? 'XLSX · synced 2m ago' : state === 'stale' ? 'XLSX · stale' : 'XLSX · conflict');
  return <span className={`excel-pill ${state}`}>📊 {text}</span>;
};

const SketchBtn = ({ children, primary, small, accent, onClick, style }) => (
  <button
    className={`sketch-btn ${primary ? 'primary' : ''} ${small ? 'small' : ''} ${accent || ''}`}
    onClick={onClick}
    style={style}
  >{children}</button>
);

const Sticky = ({ children, tone = '', rot = -1.5, style }) => (
  <div className={`sticky ${tone}`} style={{ transform: `rotate(${rot}deg)`, ...style }}>
    {children}
  </div>
);

const Placeholder = ({ h = 80, label = 'placeholder' }) => (
  <div className="ph" style={{ minHeight: h, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    [ {label} ]
  </div>
);

const Bar = ({ label, pct, val, tone = '' }) => (
  <div className="bar-row">
    <div className="lbl">{label}</div>
    <div className="bar-wrap"><div className={`bar-fill ${tone}`} style={{ width: `${pct}%` }} /></div>
    <div className="val">{val}</div>
  </div>
);

const KPI = ({ label, value, sub, note, tone }) => (
  <div className="kpi" style={tone === 'alert' ? { borderColor: 'var(--accent-red)' } : {}}>
    <div className="label">{label}</div>
    <div className="value">{value}</div>
    {sub && <div className="sub">{sub}</div>}
    {note && <div className="anno" style={{ top: -14, right: -10 }}>{note}</div>}
  </div>
);

const Stepper = ({ steps, cur }) => (
  <div className="stepper" style={{ flexWrap: 'wrap' }}>
    {steps.map((s, i) => (
      <React.Fragment key={i}>
        <div className={`step ${i === cur ? 'active' : ''}`}>
          <span className="code">{String(i+1).padStart(2,'0')}</span> {s}
        </div>
        {i < steps.length - 1 && <span className="step-arrow">→</span>}
      </React.Fragment>
    ))}
  </div>
);

const PenLine = () => <hr className="pen-line" />;

const DividerLbl = ({ children }) => (
  <div className="divider-lbl"><h3>✦ {children} ✦</h3></div>
);

const ScreenTitle = ({ title, subtitle, right }) => (
  <div className="screen-title-row">
    <h2>{title}</h2>
    {subtitle && <div className="small" style={{ color: 'var(--ink-soft)' }}>{subtitle}</div>}
    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>{right}</div>
  </div>
);

const VarTabs = ({ options, cur, onChange, label = 'Variations' }) => (
  <div className="var-tabs">
    <span className="label">{label} ↓</span>
    {options.map((o, i) => (
      <button key={i} className={i === cur ? 'active' : ''} onClick={() => onChange(i)}>
        {String.fromCharCode(65+i)}. {o}
      </button>
    ))}
  </div>
);

Object.assign(window, { Tag, ExcelPill, SketchBtn, Sticky, Placeholder, Bar, KPI, Stepper, PenLine, DividerLbl, ScreenTitle, VarTabs });
