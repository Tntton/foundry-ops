// ============ DIRECTORY · PEOPLE WIZARD + PROFILE ============
// Add-person wizard modal (5 steps) + expandable profile page with editable
// fields, platform permissions matrix, notes & documents.

// ---------- Small field primitives (scoped to this file) ----------
const PFieldRow = ({ label, hint, children, full, readonly }) => (
  <div style={{ gridColumn: full ? '1/-1' : 'auto', minWidth:0 }}>
    <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4, display:'flex', justifyContent:'space-between', gap:8 }}>
      <span style={{ whiteSpace:'nowrap' }}>{label}</span>
      {readonly && <span style={{ textTransform:'none', letterSpacing:0, color:'var(--text-4)', flexShrink:0 }}>read-only</span>}
    </div>
    {children}
    {hint && <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:4 }}>{hint}</div>}
  </div>
);

const PInput = ({ v, set, placeholder, mono, disabled }) => (
  <input value={v} onChange={e=>set && set(e.target.value)} placeholder={placeholder} disabled={disabled}
    style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13,
      fontFamily: mono?'var(--font-mono)':'inherit', background: disabled?'var(--bg-subtle)':'var(--bg)',
      color: disabled?'var(--text-3)':'var(--text)' }}/>
);

const PTextarea = ({ v, set, placeholder, rows=3 }) => (
  <textarea value={v} onChange={e=>set && set(e.target.value)} placeholder={placeholder} rows={rows}
    style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, fontFamily:'inherit', resize:'vertical', lineHeight:1.5 }}/>
);

const PSelect = ({ v, set, options }) => (
  <select value={v} onChange={e=>set && set(e.target.value)}
    style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--bg)' }}>
    {(options||[]).map((o,i)=> Array.isArray(o) ? <option key={i} value={o[0]}>{o[1]}</option> : <option key={i} value={o}>{o}</option>)}
  </select>
);

const PChipGroup = ({ v, set, options, multi }) => {
  const sel = multi ? (v||[]) : [v];
  const toggle = (o) => {
    if (!set) return;
    if (multi) {
      const has = sel.includes(o);
      set(has ? sel.filter(x=>x!==o) : [...sel, o]);
    } else set(o);
  };
  return (
    <div className="row" style={{ gap:6, flexWrap:'wrap' }}>
      {options.map(o=>(
        <button key={o} onClick={()=>toggle(o)} style={{
          padding:'6px 12px', borderRadius:999, fontSize:12, cursor:'pointer',
          border: sel.includes(o)?'1px solid var(--brand)':'1px solid var(--border)',
          background: sel.includes(o)?'color-mix(in oklab, var(--brand) 12%, var(--bg))':'var(--bg)',
          color: sel.includes(o)?'var(--brand)':'var(--text-2)',
          fontWeight: sel.includes(o)?600:400,
        }}>{o}</button>
      ))}
    </div>
  );
};

// ---------- Permissions matrix data ----------
// Roles → preset caps across modules
const PERM_MODULES = [
  { id:'projects',   label:'Projects',            desc:'Project detail, team, milestones' },
  { id:'timesheet',  label:'Own timesheet',       desc:'Submit + edit own hours' },
  { id:'allhours',   label:'All hours',           desc:'View + approve team hours' },
  { id:'expenses',   label:'Expenses',            desc:'Submit + approve firm expenses' },
  { id:'invoicesIn', label:'Client invoices',     desc:'Raise + send invoices to clients' },
  { id:'invoicesSelf',label:'Self-invoice Foundry',desc:'Generate own invoice to Foundry' },
  { id:'bd',         label:'BD pipeline',         desc:'See + edit deals, forecast, convert' },
  { id:'costplan',   label:'Cost planning',       desc:'Firm forecast, OPEX, margin targets' },
  { id:'reports',    label:'Reports',             desc:'Run + schedule reports' },
  { id:'trueup',     label:'Partner true-up',     desc:'See partner earnings + allocations' },
  { id:'directory',  label:'Directory · edit',    desc:'Add + edit people / clients' },
  { id:'admin',      label:'Master admin',        desc:'Settings, rate cards, templates' },
  { id:'approvals',  label:'Approve > $2k',       desc:'Second-signature on large items' },
];

// Level: 'none' | 'own' | 'team' | 'read' | 'edit' | 'admin'
const PERM_PRESETS = (() => {
  const partner = {
    projects:'team', timesheet:'edit', allhours:'team', expenses:'team',
    invoicesIn:'team', invoicesSelf:'edit', bd:'edit', costplan:'read',
    reports:'edit', trueup:'read', directory:'read', admin:'none', approvals:'edit',
  };
  const manager = {
    projects:'team', timesheet:'edit', allhours:'team', expenses:'team',
    invoicesIn:'read', invoicesSelf:'none', bd:'read', costplan:'none',
    reports:'read', trueup:'none', directory:'read', admin:'none', approvals:'none',
  };
  const consultant = {
    projects:'own', timesheet:'edit', allhours:'none', expenses:'own',
    invoicesIn:'none', invoicesSelf:'edit', bd:'none', costplan:'none',
    reports:'none', trueup:'none', directory:'read', admin:'none', approvals:'none',
  };
  const expert = {
    projects:'own', timesheet:'edit', allhours:'none', expenses:'own',
    invoicesIn:'none', invoicesSelf:'edit', bd:'none', costplan:'none',
    reports:'none', trueup:'none', directory:'none', admin:'none', approvals:'none',
  };
  const analyst = {
    projects:'own', timesheet:'edit', allhours:'none', expenses:'own',
    invoicesIn:'none', invoicesSelf:'none', bd:'none', costplan:'none',
    reports:'none', trueup:'none', directory:'read', admin:'none', approvals:'none',
  };
  return {
    L4: partner, L3: partner,
    L2: manager, L1: manager,
    E2: expert, E1: expert,
    T3: consultant, T2: consultant, T1: consultant,
    F2: consultant, F1: consultant,
    A3: analyst, A2: analyst, A1: analyst,
    IO: analyst,
    mgpartner: {
      projects:'admin', timesheet:'edit', allhours:'admin', expenses:'admin',
      invoicesIn:'admin', invoicesSelf:'edit', bd:'admin', costplan:'admin',
      reports:'admin', trueup:'admin', directory:'admin', admin:'admin', approvals:'admin',
    },
    office: {
      projects:'admin', timesheet:'admin', allhours:'admin', expenses:'admin',
      invoicesIn:'admin', invoicesSelf:'none', bd:'read', costplan:'edit',
      reports:'admin', trueup:'none', directory:'admin', admin:'edit', approvals:'edit',
    },
  };
})();

const LEVEL_META = {
  none:  { label:'—',         tone:'',      color:'var(--text-4)' },
  own:   { label:'own only',  tone:'',      color:'var(--text-3)' },
  team:  { label:'team',      tone:'blue',  color:'var(--blue)' },
  read:  { label:'read',      tone:'',      color:'var(--text-2)' },
  edit:  { label:'edit',      tone:'green', color:'var(--green)' },
  admin: { label:'admin',     tone:'amber', color:'var(--amber)' },
};

const levelsForModule = (modId) => {
  // Hide levels that don't apply to a module (e.g. 'own' for trueup)
  const base = ['none','read','edit','admin'];
  if (['timesheet','expenses'].includes(modId)) return ['none','own','team','admin'];
  if (['projects','allhours','invoicesIn','bd','approvals'].includes(modId)) return ['none','own','team','edit','admin'];
  return base;
};

// ---------- Role presets (one per rate card level — rates are negotiable per-person) ----------
// Maps 1:1 with FOUNDRY_LEVELS from foundry-ratecard.jsx.
// `defaultRate` is seeded from the AU hourly rate card at the time this is loaded;
// per-person rate is negotiable and editable in the wizard.
const ROLE_PRESETS = [
  { id:'L4',  levelCode:'L4', label:'Partner',                         band:'Partner',     type:'FT Partner', defaultRate:null, unit:'/d', sub:'Firm leadership · equity partner · negotiated per-diem' },
  { id:'L3',  levelCode:'L3', label:'Associate Partner',               band:'Partner',     type:'FT Partner', defaultRate:null, unit:'/d', sub:'Leads projects · on track to equity partnership' },
  { id:'L2',  levelCode:'L2', label:'Project Director / Senior Manager',band:'Leadership', type:'FT',         defaultRate:180,  unit:'/h', sub:'Leads projects with little oversight · owns client relationships' },
  { id:'L1',  levelCode:'L1', label:'Project Manager / Manager',       band:'Leadership',  type:'FT',         defaultRate:200,  unit:'/h', sub:'Leads key workstreams for projects' },
  { id:'E2',  levelCode:'E2', label:'Senior Expert',                   band:'Expert',      type:'Contractor', defaultRate:300,  unit:'/h', sub:'Senior industry leader · firm-of-record expert' },
  { id:'E1',  levelCode:'E1', label:'Expert',                          band:'Expert',      type:'Contractor', defaultRate:200,  unit:'/h', sub:'Professor / senior academic expert support' },
  { id:'T3',  levelCode:'T3', label:'Senior Consultant',               band:'Consultant',  type:'FT',         defaultRate:150,  unit:'/h', sub:'Leads workstreams · PGY6 or fellowed clinician' },
  { id:'F2',  levelCode:'F2', label:'Fellow',                          band:'Fellow',      type:'FT',         defaultRate:150,  unit:'/h', sub:'Fellowed clinician · deep technical knowledge, no consulting exp' },
  { id:'T2',  levelCode:'T2', label:'Consultant',                      band:'Consultant',  type:'FT',         defaultRate:120,  unit:'/h', sub:'Supports & leads within workstreams · >4yr clinical' },
  { id:'F1',  levelCode:'F1', label:'Junior Fellow',                   band:'Fellow',      type:'FT',         defaultRate:120,  unit:'/h', sub:'Advanced trainee nearing fellowship, no consulting exp' },
  { id:'T1',  levelCode:'T1', label:'Consultant (junior)',             band:'Consultant',  type:'FT',         defaultRate:80,   unit:'/h', sub:'Recent graduate · up to 4yr clinical' },
  { id:'A3',  levelCode:'A3', label:'Senior Analyst',                  band:'Analyst',     type:'FT',         defaultRate:65,   unit:'/h', sub:'Senior analyst · several years at FH or other' },
  { id:'A2',  levelCode:'A2', label:'Analyst',                         band:'Analyst',     type:'FT',         defaultRate:50,   unit:'/h', sub:'Emerging team member · undergrad, MD candidate' },
  { id:'A1',  levelCode:'A1', label:'Junior Analyst',                  band:'Analyst',     type:'PT',         defaultRate:45,   unit:'/h', sub:'Probationary 6–12 months · undergrad, MD candidate' },
  { id:'IO',  levelCode:'IO', label:'Intern',                          band:'Intern',      type:'Intern',     defaultRate:0,    unit:'/h', sub:'Non-clinical undergraduate · probationary' },
  // Special non-level roles — kept at end
  { id:'mgpartner', levelCode:'L4', label:'Managing Partner',          band:'Partner',     type:'FT Partner', defaultRate:null, unit:'/d', sub:'Everything + admin + true-up · special role' },
  { id:'office',    levelCode:null,label:'Office Manager',             band:'Ops',         type:'FT',         defaultRate:0,    unit:'salary', sub:'Operations · admin + approvals · salaried' },
];

// ============ ADD PERSON WIZARD ============
const AddPersonWizard = ({ onClose, onFinish }) => {
  const [step, setStep] = React.useState(0);
  const steps = ['Basics','Personal','Engagement','Permissions','Notes & docs','Review'];

  // Basics
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName]   = React.useState('');
  const [initials, setInitials]   = React.useState('');
  const [email, setEmail]         = React.useState('');
  const [phone, setPhone]         = React.useState('');
  const [location, setLocation]   = React.useState('Sydney, AU');
  const [startDate, setStartDate] = React.useState('2026-06-01');

  // Personal
  const [personalEmail, setPersonalEmail] = React.useState('');
  const [personalPhone, setPersonalPhone] = React.useState('');
  const [homeAddress, setHomeAddress]   = React.useState('');
  const [dob, setDob]                   = React.useState('');
  const [emergencyName, setEmergencyName]   = React.useState('');
  const [emergencyRelation, setEmergencyRelation] = React.useState('Partner');
  const [emergencyPhone, setEmergencyPhone] = React.useState('');
  const [cvFile, setCvFile]             = React.useState(null);

  // Engagement
  const [roleId, setRoleId]       = React.useState('T2');
  const [levelCode, setLevelCode] = React.useState('T2');
  const [region, setRegion]       = React.useState('AU');
  const [customTitle, setTitle]   = React.useState('');
  const [employment, setEmp]      = React.useState('FT');
  const [rate, setRate]           = React.useState(120);
  const [rateUnit, setRateUnit]   = React.useState('/h');
  const [fte, setFte]             = React.useState(1.0);
  const [contractEnd, setContractEnd] = React.useState('');
  const [disciplines, setDisciplines] = React.useState(['Market strategy']);
  const [reportsTo, setReportsTo] = React.useState('MB');

  // Permissions (seeded from role preset; editable on step 3)
  const [perms, setPerms] = React.useState(() => ({ ...PERM_PRESETS.T2 }));
  const [mfa, setMfa] = React.useState(true);
  const [scope, setScope] = React.useState('assigned');

  // Notes & docs
  const [notes, setNotes] = React.useState('');
  const [docs, setDocs] = React.useState({ contract:true, ndaFirm:true, w9:false, super:false, idVerify:false });

  // Auto-derive initials
  React.useEffect(()=>{
    if (!initials && (firstName || lastName)) {
      setInitials(((firstName[0]||'') + (lastName[0]||'')).toUpperCase());
    }
  }, [firstName, lastName]);

  // When role changes, seed engagement + permissions
  const applyRole = (id) => {
    setRoleId(id);
    const preset = ROLE_PRESETS.find(r=>r.id===id);
    if (preset) {
      setEmp(preset.type);
      if (preset.levelCode) setLevelCode(preset.levelCode);
      // Seed rate from rate card — negotiable; user can edit
      const lvl = (window.FOUNDRY_LEVELS||[]).find(l=>l.code===preset.levelCode);
      if (lvl && lvl.rates[region] != null) {
        setRate(lvl.rates[region]);
        setRateUnit('/h');
      } else if (preset.defaultRate != null) {
        setRate(preset.defaultRate);
        setRateUnit(preset.unit);
      }
    }
    if (PERM_PRESETS[id]) setPerms({ ...PERM_PRESETS[id] });
    if (id==='mgpartner' || id==='office') setScope('firm');
    else if (['L4','L3','L2','L1'].includes(id)) setScope('team');
    else if (['E1','E2'].includes(id)) setScope('assigned');
    else setScope('assigned');
  };

  const applyLevel = (code) => {
    setLevelCode(code);
    const lvl = (window.FOUNDRY_LEVELS||[]).find(l=>l.code===code);
    if (lvl && lvl.rates[region] != null) {
      setRate(lvl.rates[region]);
      setRateUnit('/h');
    }
  };

  const roleLabel = ROLE_PRESETS.find(r=>r.id===roleId)?.label || 'Person';
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || 'New person';

  const next = () => setStep(Math.min(step+1, steps.length-1));
  const back = () => setStep(Math.max(step-1, 0));

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(30,28,24,0.55)', zIndex:60, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'var(--bg)', borderRadius:10, width:'min(1040px,100%)', maxHeight:'94vh', overflow:'hidden', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>

        {/* Header */}
        <div style={{ padding:'14px 22px', borderBottom:'1px solid var(--divider)' }}>
          <div className="row-spread">
            <div>
              <div className="txt-sm txt-muted">Add person · step {step+1} of {steps.length} · {steps[step]}</div>
              <h3 style={{ margin:'2px 0 0', fontFamily:'var(--font-serif)', fontSize:20, fontWeight:400 }}>
                {displayName} <span className="txt-muted" style={{ fontSize:13 }}>· {roleLabel}</span>
              </h3>
            </div>
            <Btn sm ghost onClick={onClose}>✕</Btn>
          </div>
          <div className="row" style={{ gap:4, marginTop:12 }}>
            {steps.map((s,i)=>(
              <div key={i} onClick={()=>i<=step && setStep(i)} style={{ flex:1, cursor: i<=step?'pointer':'default' }}>
                <div style={{ height:4, borderRadius:2, background: i<=step?'var(--brand)':'var(--bg-subtle)' }}/>
                <div className="txt-sm" style={{ fontSize:10, marginTop:4, textAlign:'center', color: i===step?'var(--text)':'var(--text-4)', fontWeight: i===step?600:400, letterSpacing:'.04em', textTransform:'uppercase' }}>{s}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding:'22px 24px', overflow:'auto', flex:1, background:'var(--bg-subtle)' }}>

          {step===0 && (
            <div className="card" style={{ background:'var(--bg)' }}>
              <div className="card-body">
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
                  <PFieldRow label="First name"><PInput v={firstName} set={setFirstName} placeholder="Elena"/></PFieldRow>
                  <PFieldRow label="Last name"><PInput v={lastName} set={setLastName} placeholder="Kowalski"/></PFieldRow>
                  <PFieldRow label="Initials" hint="Used across timesheets, BD cards, approvals. Must be unique.">
                    <PInput v={initials} set={v=>setInitials(v.toUpperCase().slice(0,3))} placeholder="EK" mono/>
                  </PFieldRow>
                  <PFieldRow label="Work email" full={false}><PInput v={email} set={setEmail} placeholder="elena@foundry.health"/></PFieldRow>
                  <PFieldRow label="Phone"><PInput v={phone} set={setPhone} placeholder="+61 …"/></PFieldRow>
                  <PFieldRow label="Location"><PSelect v={location} set={setLocation} options={['Sydney, AU','Melbourne, AU','Brisbane, AU','Singapore','London','New York','Remote · other']}/></PFieldRow>

                  <PFieldRow label="Start date"><PInput v={startDate} set={setStartDate}/></PFieldRow>
                  <PFieldRow label="Reports to"><PSelect v={reportsTo} set={setReportsTo} options={[['TT','TT · Managing partner'],['MB','MB · Partner'],['SR','SR · Assoc partner'],['JS','JS · Office mgr']]}/></PFieldRow>
                  <PFieldRow label="Home office"><PSelect v={'Foundry Health Pty Ltd'} set={()=>{}} options={['Foundry Health Pty Ltd','Foundry Health Partners']}/></PFieldRow>
                </div>

                <div style={{ marginTop:18 }}>
                  <Callout tone="info">
                    <span className="txt-sm">A Microsoft 365 account will be provisioned on finish · <b>{email || 'first.last'}@foundry.health</b> · invite sent after managing partner approval.</span>
                  </Callout>
                </div>
              </div>
            </div>
          )}

          {step===1 && (
            <div className="card" style={{ background:'var(--bg)' }}>
              <div className="card-header">
                <h3>Personal details</h3>
                <div className="txt-sm txt-muted">HR record · home address, personal contact, emergency, CV. Not visible to the project team.</div>
              </div>
              <div className="card-body">
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                  <PFieldRow label="Personal email" hint="For offer letters, payslips, off-boarding.">
                    <PInput v={personalEmail} set={setPersonalEmail} placeholder="elena.k@gmail.com"/>
                  </PFieldRow>
                  <PFieldRow label="Personal mobile" hint="Out-of-hours contact.">
                    <PInput v={personalPhone} set={setPersonalPhone} placeholder="+61 …"/>
                  </PFieldRow>

                  <PFieldRow label="Home address" hint="Used on contracts, payroll, tax forms." full>
                    <PTextarea v={homeAddress} set={setHomeAddress} rows={2} placeholder="Unit 12 / 88 Queen St, Surry Hills NSW 2010, Australia"/>
                  </PFieldRow>

                  <PFieldRow label="Date of birth" hint="Super / tax compliance.">
                    <PInput v={dob} set={setDob} placeholder="YYYY-MM-DD"/>
                  </PFieldRow>
                  <PFieldRow label="Preferred pronouns">
                    <PSelect v={'she/her'} set={()=>{}} options={['she/her','he/him','they/them','ask me','not specified']}/>
                  </PFieldRow>
                </div>

                <div style={{ marginTop:20 }}>
                  <div className="txt-sm" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--text-3)', marginBottom:8, fontWeight:600 }}>Emergency contact</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1.3fr 1fr 1fr', gap:16 }}>
                    <PFieldRow label="Full name"><PInput v={emergencyName} set={setEmergencyName} placeholder="Alex Kowalski"/></PFieldRow>
                    <PFieldRow label="Relationship">
                      <PSelect v={emergencyRelation} set={setEmergencyRelation} options={['Partner','Spouse','Parent','Sibling','Child','Friend','Other']}/>
                    </PFieldRow>
                    <PFieldRow label="Mobile"><PInput v={emergencyPhone} set={setEmergencyPhone} placeholder="+61 …"/></PFieldRow>
                  </div>
                </div>

                <div style={{ marginTop:20 }}>
                  <div className="txt-sm" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--text-3)', marginBottom:8, fontWeight:600 }}>CV / resume</div>
                  <label style={{ display:'block', border:'1.5px dashed var(--border)', borderRadius:8, padding:'20px 16px', textAlign:'center', cursor:'pointer', background: cvFile?'color-mix(in oklab, var(--green) 5%, var(--bg))':'var(--bg)' }}>
                    <input type="file" accept=".pdf,.doc,.docx" onChange={e=>setCvFile(e.target.files?.[0]||null)} style={{ display:'none' }}/>
                    {cvFile ? (
                      <div>
                        <div style={{ fontWeight:600, fontSize:13, color:'var(--green)' }}>✓ {cvFile.name}</div>
                        <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:4 }}>{(cvFile.size/1024).toFixed(0)}kb · click to replace</div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize:22, color:'var(--text-4)' }}>⤒</div>
                        <div style={{ fontWeight:600, fontSize:13, marginTop:4 }}>Upload CV or resume</div>
                        <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:2 }}>PDF, DOC, DOCX · stored in SharePoint / People / {initials||'XX'} / HR</div>
                      </div>
                    )}
                  </label>
                </div>

                <div style={{ marginTop:18 }}>
                  <Callout tone="amber">
                    <span className="txt-sm"><b>Privacy:</b> personal details are visible only to the Managing Partner, Office Manager and the person themselves. All PII is encrypted at rest in SharePoint.</span>
                  </Callout>
                </div>
              </div>
            </div>
          )}

          {step===2 && (
            <div className="stack" style={{ gap:14 }}>
              <div className="card" style={{ background:'var(--bg)' }}>
                <div className="card-header">
                  <h3>Role &amp; level</h3>
                  <Badge tone="green" dot>Rate Card FY26</Badge>
                </div>
                <div className="card-body" style={{ padding:0 }}>
                  <div className="row-spread" style={{ padding:'10px 14px', borderBottom:'1px solid var(--divider)', background:'var(--bg-subtle)' }}>
                    <div className="txt-sm txt-muted">Role determines level, default permissions and seeded rate. <b>Rate is negotiable per-person</b> and editable below.</div>
                    <div className="role-switcher">
                      {(window.FOUNDRY_RATE_CARD_META?.regions||[]).map(r=>(
                        <button key={r.id} className={region===r.id?'active':''} onClick={()=>{ setRegion(r.id); const lvl=(window.FOUNDRY_LEVELS||[]).find(l=>l.code===levelCode); if(lvl && lvl.rates[r.id]!=null){ setRate(lvl.rates[r.id]); setRateUnit('/h'); } }}>{r.flag} {r.label}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{ maxHeight:340, overflow:'auto' }}>
                    {ROLE_PRESETS.map((r,i)=>{
                      const active = roleId===r.id;
                      const lvl = (window.FOUNDRY_LEVELS||[]).find(l=>l.code===r.levelCode);
                      const seeded = lvl && lvl.rates[region] != null ? lvl.rates[region] : r.defaultRate;
                      return (
                        <div key={r.id} onClick={()=>applyRole(r.id)} style={{
                          display:'grid', gridTemplateColumns:'56px 1.5fr 90px 1.5fr 130px 40px', gap:14, alignItems:'center',
                          padding:'12px 14px', borderBottom: i<ROLE_PRESETS.length-1?'1px solid var(--divider)':'none',
                          cursor:'pointer',
                          background: active?'color-mix(in oklab, var(--brand) 6%, var(--bg))':'var(--bg)',
                          borderLeft: active?'3px solid var(--brand)':'3px solid transparent',
                        }}>
                          <span className="mono" style={{ fontSize:12, fontWeight:700, color: active?'var(--brand)':'var(--text-3)' }}>{r.levelCode || '—'}</span>
                          <div>
                            <div style={{ fontWeight:600, fontSize:13 }}>{r.label}</div>
                            <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:2 }}>{r.sub}</div>
                          </div>
                          <Badge tone={r.band==='Partner'?'amber':r.band==='Leadership'?'blue':r.band==='Expert'?'accent':r.band==='Fellow'?'teal':r.band==='Consultant'?'green':''}>{r.band}</Badge>
                          <div className="txt-sm" style={{ fontSize:11, color:'var(--text-3)' }}>{r.type}</div>
                          <div className="mono" style={{ fontSize:12, textAlign:'right', color: active?'var(--brand)':'var(--text-3)' }}>
                            {seeded==null ? <span className="txt-muted" style={{ fontSize:11, fontStyle:'italic' }}>partner / nego.</span> : `$${seeded}${r.unit||'/h'}${r.unit==='/h'?` · $${(seeded*8).toLocaleString()}/d`:''}`}
                          </div>
                          <div style={{ textAlign:'center', color:'var(--brand)', fontSize:14, opacity: active?1:0 }}>●</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="card" style={{ background:'var(--bg)' }}>
                <div className="card-header">
                  <h3>Engagement &amp; negotiated rate</h3>
                  <div className="txt-sm txt-muted">Rate card is a starting point — override to match what was agreed.</div>
                </div>
                <div className="card-body">
                  <div style={{ display:'grid', gridTemplateColumns:'1.3fr 1fr 1fr', gap:16 }}>
                    <PFieldRow label="Job title" hint="Shown on profile + external signatures.">
                      <PInput v={customTitle} set={setTitle} placeholder={`e.g. Senior consultant · Market access`}/>
                    </PFieldRow>
                    <PFieldRow label="Employment type">
                      <PSelect v={employment} set={setEmp} options={['FT Partner','PT Partner','FT','PT','Contractor','Intern']}/>
                    </PFieldRow>
                    <PFieldRow label="FTE">
                      <PSelect v={String(fte)} set={v=>setFte(parseFloat(v))} options={['1.0','0.8','0.6','0.5','0.4','0.2']}/>
                    </PFieldRow>

                    <PFieldRow label="Negotiated rate" hint={`Rate card seeds $${rate} ${rateUnit} for ${levelCode} in ${region}. Edit to match the agreed number.`}>
                      <div className="row" style={{ gap:6 }}>
                        <div style={{ flex:1 }}><PInput v={rate} set={v=>setRate(Number(v)||0)} mono/></div>
                        <div style={{ width:120 }}>
                          <PSelect v={rateUnit} set={setRateUnit} options={[['/d','AUD / day'],['/h','AUD / hour'],['/mo','AUD / month'],['salary','salary']]}/>
                        </div>
                      </div>
                    </PFieldRow>
                    <PFieldRow label="Contract end">
                      <PInput v={contractEnd} set={setContractEnd} placeholder="YYYY-MM-DD · blank = indefinite"/>
                    </PFieldRow>
                    <PFieldRow label="Payroll / billing entity">
                      <PSelect v={'foundry'} set={()=>{}} options={[['foundry','Foundry Health Pty Ltd (PAYG)'],['self','Self-invoice · ABN'],['ext','External firm']]}/>
                    </PFieldRow>

                    <PFieldRow label="Disciplines" hint="Used for resource matching on new projects." full>
                      <PChipGroup v={disciplines} set={setDisciplines} multi options={['Market strategy','Market access','Commercial','Diligence','Regulatory','HEOR','Medical affairs','Digital health','Data & analytics','Project mgmt']}/>
                    </PFieldRow>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step===3 && (
            <PermissionsEditor
              roleId={roleId}
              perms={perms}
              setPerms={setPerms}
              mfa={mfa} setMfa={setMfa}
              scope={scope} setScope={setScope}
            />
          )}

          {step===4 && (
            <div className="stack" style={{ gap:14 }}>
              <div className="card" style={{ background:'var(--bg)' }}>
                <div className="card-header"><h3>Internal notes</h3><div className="txt-sm txt-muted">Seen by partners + office manager only · not shared externally.</div></div>
                <div className="card-body">
                  <PTextarea v={notes} set={setNotes} rows={6} placeholder={`e.g. Intro via MB at ISPOR 2025. Strong market-access background, ex-Novartis. Available from Jun — 6 month trial as contractor with option to convert.`}/>                </div>
              </div>

              <div className="card" style={{ background:'var(--bg)' }}>
                <div className="card-header"><h3>Onboarding documents</h3><div className="txt-sm txt-muted">Mark what's already captured · office mgr will chase the rest.</div></div>
                <div className="card-body">
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:10 }}>
                    {[
                      ['contract', employment==='Contractor'?'Consulting agreement signed':'Employment contract signed', 'Legal template · Herbert Smith'],
                      ['ndaFirm', 'Firm NDA signed', 'Mutual · v3.2'],
                      ['w9', employment==='Contractor'?'ABN / W-8BEN captured':'TFN declaration', 'For PAYG / invoicing'],
                      ['super', 'Super + bank details', 'Not req. for contractors'],
                      ['idVerify', 'ID verification', '100 points · AML check'],
                      ['par', 'PAR cycle assigned', 'Jun / Dec'],
                    ].map(([k,l,sub])=>{
                      const checked = k==='par' ? true : !!docs[k];
                      return (
                        <label key={k} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:12, border:'1px solid var(--border)', borderRadius:8, cursor: k==='par'?'default':'pointer', background: checked?'color-mix(in oklab, var(--green) 6%, var(--bg))':'var(--bg)' }}>
                          <input type="checkbox" checked={checked} onChange={e=>k!=='par' && setDocs({...docs, [k]: e.target.checked})} style={{ marginTop:2 }}/>
                          <div>
                            <div style={{ fontSize:13, fontWeight:600 }}>{l}</div>
                            <div className="txt-sm txt-muted" style={{ fontSize:11 }}>{sub}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step===5 && (
            <div className="card" style={{ background:'var(--bg)' }}>
              <div className="card-header"><h3>Review &amp; invite</h3></div>
              <div className="card-body">
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
                  <div className="stack" style={{ gap:10 }}>
                    <ReviewBlock title="Basics">
                      <ReviewRow k="Name" v={`${displayName} (${initials||'—'})`}/>
                      <ReviewRow k="Email" v={email || '—'}/>
                      <ReviewRow k="Phone" v={phone || '—'}/>
                      <ReviewRow k="Location" v={location}/>
                      <ReviewRow k="Start" v={startDate}/>
                      <ReviewRow k="Reports to" v={reportsTo}/>
                    </ReviewBlock>
                    <ReviewBlock title="Personal · HR only">
                      <ReviewRow k="Personal email" v={personalEmail || '—'}/>
                      <ReviewRow k="Personal mobile" v={personalPhone || '—'}/>
                      <ReviewRow k="Home address" v={homeAddress ? homeAddress.split('\n')[0].slice(0,48)+(homeAddress.length>48?'…':'') : '—'}/>
                      <ReviewRow k="Date of birth" v={dob || '—'}/>
                      <ReviewRow k="Emergency" v={emergencyName ? `${emergencyName} · ${emergencyRelation}` : '—'}/>
                      <ReviewRow k="CV" v={cvFile ? cvFile.name : 'pending'} tone={cvFile?'green':'amber'}/>
                    </ReviewBlock>
                    <ReviewBlock title="Engagement">
                      <ReviewRow k="Role" v={roleLabel}/>
                      <ReviewRow k="Level" v={`${levelCode} · ${(window.FOUNDRY_LEVELS||[]).find(l=>l.code===levelCode)?.label||'—'}`}/>
                      <ReviewRow k="Region" v={region}/>
                      <ReviewRow k="Title" v={customTitle || '—'}/>
                      <ReviewRow k="Employment" v={`${employment} · FTE ${fte}`}/>
                      <ReviewRow k="Negotiated rate" v={`${rate?`$${Number(rate).toLocaleString()}`:'—'} ${rateUnit}`}/>
                      <ReviewRow k="Contract end" v={contractEnd || 'indefinite'}/>
                      <ReviewRow k="Disciplines" v={disciplines.join(', ') || '—'}/>
                    </ReviewBlock>
                  </div>
                  <div className="stack" style={{ gap:10 }}>
                    <ReviewBlock title="Platform access">
                      <ReviewRow k="MFA" v={mfa?'required':'off'}/>
                      <ReviewRow k="Scope" v={scope==='firm'?'Firm-wide':scope==='team'?'Team + own':'Assigned projects only'}/>
                      <ReviewRow k="Permissions" v={`${Object.values(perms).filter(v=>v!=='none').length} of ${PERM_MODULES.length} modules`}/>
                      {['admin','edit'].map(lv=>{
                        const n = Object.values(perms).filter(v=>v===lv).length;
                        if (!n) return null;
                        return <ReviewRow key={lv} k={`· ${lv}`} v={`${n} module${n>1?'s':''}`}/>;
                      })}
                    </ReviewBlock>
                    <ReviewBlock title="Docs">
                      {Object.entries({
                        contract: 'Contract',
                        ndaFirm: 'NDA',
                        w9: 'Tax form',
                        super: 'Super / bank',
                        idVerify: 'ID',
                      }).map(([k,l])=>(
                        <ReviewRow key={k} k={l} v={docs[k]?'captured':'pending'} tone={docs[k]?'green':'amber'}/>
                      ))}
                    </ReviewBlock>
                  </div>
                </div>

                <div style={{ marginTop:16 }}>
                  <Callout tone="info" title="On finish">
                    <div className="txt-sm">Creates <b>{initials||'??'}</b> in personnel master · provisions M365 + platform login · sends invite email · books PAR reviews · adds to <b>{reportsTo}</b>'s direct reports · generates contract from template ready for signature.</div>
                  </Callout>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 22px', borderTop:'1px solid var(--divider)', display:'flex', gap:8, justifyContent:'space-between', alignItems:'center' }}>
          <div className="txt-sm txt-muted">Draft saved automatically · you can finish later from <b>Master admin › Personnel</b></div>
          <div className="row gap-sm">
            {step>0 && <Btn ghost onClick={back}>← Back</Btn>}
            {step<steps.length-1 && <Btn primary onClick={next}>Continue →</Btn>}
            {step===steps.length-1 && <><Btn ghost onClick={onClose}>Save as draft</Btn><Btn primary onClick={()=>{ onFinish && onFinish({firstName,lastName,initials,email,roleId,roleLabel,perms,scope,mfa}); onClose && onClose(); }}>Send invite &amp; create</Btn></>}
          </div>
        </div>
      </div>
    </div>
  );
};

const ReviewBlock = ({ title, children }) => (
  <div style={{ border:'1px solid var(--border)', borderRadius:8, padding:14 }}>
    <div className="txt-sm" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--text-3)', marginBottom:8 }}>{title}</div>
    <div className="stack" style={{ gap:4 }}>{children}</div>
  </div>
);

const ReviewRow = ({ k, v, tone }) => (
  <div className="row-spread" style={{ fontSize:13 }}>
    <span className="txt-muted">{k}</span>
    {tone ? <Badge tone={tone} dot>{v}</Badge> : <span style={{ fontWeight:500 }}>{v}</span>}
  </div>
);

// ============ PERMISSIONS EDITOR (shared between wizard + profile) ============
const PermissionsEditor = ({ roleId, perms, setPerms, mfa, setMfa, scope, setScope, compact }) => {
  const [touched, setTouched] = React.useState(false);
  const countDiff = roleId && PERM_PRESETS[roleId]
    ? Object.keys(PERM_PRESETS[roleId]).filter(k => PERM_PRESETS[roleId][k] !== perms[k]).length
    : 0;

  return (
    <div className="stack" style={{ gap:14 }}>
      <div className="card" style={{ background:'var(--bg)' }}>
        <div className="card-header">
          <h3>Platform access</h3>
          <div className="row gap-sm">
            {roleId && PERM_PRESETS[roleId] && (
              <Btn sm ghost onClick={()=>{ setPerms({...PERM_PRESETS[roleId]}); setTouched(false); }}>Reset to {roleId} preset</Btn>
            )}
          </div>
        </div>
        <div className="card-body">
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <PFieldRow label="Login scope" hint="Controls which projects + reports this user can list.">
              <PSelect v={scope} set={setScope} options={[
                ['firm','Firm-wide · all projects + admin'],
                ['team','Own team · direct reports + assigned'],
                ['assigned','Assigned projects only'],
                ['portal','External portal · one client'],
              ]}/>
            </PFieldRow>
            <PFieldRow label="Authentication">
              <div className="row" style={{ gap:10 }}>
                <label className="row gap-sm" style={{ fontSize:13 }}>
                  <input type="checkbox" checked={mfa} onChange={e=>setMfa && setMfa(e.target.checked)}/> MFA required
                </label>
                <label className="row gap-sm" style={{ fontSize:13 }}>
                  <input type="checkbox" defaultChecked/> SSO via M365
                </label>
                <label className="row gap-sm" style={{ fontSize:13 }}>
                  <input type="checkbox"/> IP allow-list
                </label>
              </div>
            </PFieldRow>
          </div>
        </div>
      </div>

      <div className="card" style={{ background:'var(--bg)' }}>
        <div className="card-header">
          <h3>Module permissions {countDiff>0 && <Badge tone="amber" dot>{countDiff} overridden</Badge>}</h3>
          <div className="txt-sm txt-muted">Click a level to change · presets match the selected role.</div>
        </div>
        <table className="tbl" style={{ fontSize:13 }}>
          <thead>
            <tr>
              <th style={{ width:'42%' }}>Module</th>
              <th>Access</th>
              <th style={{ width:110 }}>Preset</th>
            </tr>
          </thead>
          <tbody>
            {PERM_MODULES.map(mod => {
              const current = perms[mod.id] || 'none';
              const levels = levelsForModule(mod.id);
              const preset = (roleId && PERM_PRESETS[roleId]) ? PERM_PRESETS[roleId][mod.id] : null;
              const overridden = preset && preset !== current;
              return (
                <tr key={mod.id}>
                  <td>
                    <div style={{ fontWeight:500 }}>{mod.label}</div>
                    <div className="txt-sm txt-muted" style={{ fontSize:11 }}>{mod.desc}</div>
                  </td>
                  <td>
                    <div className="row" style={{ gap:4, flexWrap:'wrap' }}>
                      {levels.map(lv=>{
                        const active = current === lv;
                        const meta = LEVEL_META[lv];
                        return (
                          <button key={lv} onClick={()=>{ setPerms({...perms, [mod.id]: lv}); setTouched(true); }} style={{
                            padding:'4px 10px', borderRadius:6, fontSize:11, cursor:'pointer',
                            fontWeight: active?600:400,
                            border: active?`1px solid ${meta.color}`:'1px solid var(--border)',
                            background: active?`color-mix(in oklab, ${meta.color} 12%, var(--bg))`:'var(--bg)',
                            color: active?meta.color:'var(--text-3)',
                          }}>{meta.label}</button>
                        );
                      })}
                    </div>
                  </td>
                  <td className="txt-sm">
                    {preset
                      ? <span style={{ color: overridden?'var(--amber)':'var(--text-4)', fontStyle:'italic', fontSize:11 }}>
                          {overridden ? `was ${LEVEL_META[preset].label}` : 'default'}
                        </span>
                      : <span className="txt-muted" style={{ fontSize:11 }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!compact && (
        <Callout tone="info">
          <span className="txt-sm"><b>How these map:</b> <b>none</b> — module hidden from sidebar · <b>own</b> — sees only own rows · <b>team</b> — sees direct reports · <b>read</b> — view without edit · <b>edit</b> — create + modify · <b>admin</b> — including approve, delete and settings. Audit log captures every change.</span>
        </Callout>
      )}
    </div>
  );
};

// ============ PERSON PROFILE (expanded detail page) ============
// Full-page (fills content area) profile with editable fields, permissions, notes.
const PERSON_DB = {
  TT: { first:'Trung', last:'Truong', initials:'TT', title:'Managing partner', roleId:'mgpartner', levelCode:'L4', region:'AU', email:'trung@foundry.health', phone:'+61 400 111 222', location:'Sydney, AU', start:'2022-01-10', reportsTo:'—', employment:'FT Partner', fte:1.0, rate:2000, rateUnit:'/d', contractEnd:'—', disciplines:['Commercial','Market strategy','Diligence'], utilisation:48, ytd:248000, bdRef:42000, projectShare:94000, mfa:true, scope:'firm', active:true, tone:'green', avatar:'TT' },
  MB: { first:'Marco',  last:'B.',      initials:'MB', title:'Partner · Strategy', roleId:'L4',        levelCode:'L4', region:'AU', email:'marco@foundry.health', phone:'+61 400 111 310', location:'Sydney, AU', start:'2022-04-02', reportsTo:'TT', employment:'FT Partner', fte:1.0, rate:2000, rateUnit:'/d', contractEnd:'—', disciplines:['Market strategy','Diligence','Commercial'], utilisation:71, ytd:186400, bdRef:6000, projectShare:42000, mfa:true, scope:'team', active:true, tone:'green', avatar:'MB' },
  SR: { first:'Sofia',  last:'R.',      initials:'SR', title:'Associate partner',  roleId:'L3',        levelCode:'L3', region:'AU', email:'sofia@foundry.health', phone:'+61 400 111 405', location:'Melbourne, AU', start:'2023-07-01', reportsTo:'TT', employment:'PT Partner', fte:0.6, rate:2000, rateUnit:'/d', contractEnd:'2026-07-01', disciplines:['Regulatory','Market access'], utilisation:58, ytd:124000, bdRef:0, projectShare:18000, mfa:true, scope:'team', active:true, tone:'amber', avatar:'SR' },
  CC: { first:'Chen',   last:'C.',      initials:'CC', title:'Consultant · T3',    roleId:'T3',        levelCode:'T3', region:'AU', email:'chen@foundry.health', phone:'+61 400 111 523', location:'Sydney, AU', start:'2025-01-15', reportsTo:'MB', employment:'FT', fte:1.0, rate:1200, rateUnit:'/d', contractEnd:'—', disciplines:['Market strategy','Commercial'], utilisation:84, ytd:74000, bdRef:0, projectShare:0, mfa:true, scope:'assigned', active:true, tone:'green', avatar:'CC' },
  JB: { first:'Jordan', last:'B.',      initials:'JB', title:'Analyst · A3',        roleId:'A3',        levelCode:'A3', region:'AU', email:'jordan@foundry.health', phone:'+61 400 111 612', location:'Sydney, AU', start:'2025-03-03', reportsTo:'MB', employment:'FT', fte:1.0, rate:520, rateUnit:'/d', contractEnd:'—', disciplines:['Diligence','Data & analytics'], utilisation:92, ytd:38000, bdRef:0, projectShare:0, mfa:true, scope:'assigned', active:true, tone:'amber', avatar:'JB' },
  AP: { first:'Alex',   last:'Park',    initials:'AP', title:'Expert (E1)',         roleId:'E1',        levelCode:'E1', region:'AU', email:'alex@alexparkconsulting.com', phone:'+61 400 222 001', location:'Remote · other', start:'2026-02-01', reportsTo:'TT', employment:'Contractor', fte:0.4, rate:1600, rateUnit:'/d', contractEnd:'2026-07-31', disciplines:['Market strategy'], utilisation:33, ytd:62000, bdRef:0, projectShare:0, mfa:true, scope:'portal', active:true, tone:'amber', avatar:'AP' },
  JS: { first:'Jas',    last:'S.',      initials:'JS', title:'Office manager',     roleId:'office',    levelCode:'L1', region:'AU', email:'jas@foundry.health', phone:'+61 400 111 888', location:'Sydney, AU', start:'2022-01-10', reportsTo:'TT', employment:'FT', fte:1.0, rate:0, rateUnit:'salary', contractEnd:'—', disciplines:['Project mgmt'], utilisation:100, ytd:92000, bdRef:0, projectShare:0, mfa:true, scope:'firm', active:true, tone:'green', avatar:'JS' },
};

const PersonProfile = ({ personId, onBack }) => {
  // Resolve person: prefer local PERSON_DB (rich/editable), else adapt a FOUNDRY_TEAM record.
  const resolveFromTeam = (id) => {
    const t = (window.FT_BY_ID || {})[id];
    if (!t) return null;
    const m = window.synthMetrics ? window.synthMetrics(t) : { util:70, ytd:120000 };
    return {
      first: t.first, last: t.last, initials: t.initials, title: t.title,
      roleId: t.roleId || t.level || 'T2', levelCode: t.level || 'T2',
      region: t.region, email: t.email, phone: '—', location: t.location,
      start: '2024-01-01', reportsTo: t.band==='Partner' ? '—' : 'TT',
      employment: t.employment || 'FT', fte: t.fte ?? 1.0,
      rate: t.rate || 0, rateUnit: t.rateUnit || '/h',
      contractEnd: '—', disciplines: [t.band || 'Consultant'],
      utilisation: m.util, ytd: m.ytd, bdRef: 0, projectShare: 0,
      mfa: true, scope: t.band==='Partner' ? 'firm' : 'team', active: true,
      tone: 'green', avatar: t.initials,
      bio: t.bio, degrees: t.degrees,
    };
  };
  const seed = PERSON_DB[personId] || resolveFromTeam(personId) || PERSON_DB.MB;
  const [p, setP] = React.useState(seed);
  const [tab, setTab] = React.useState('overview');
  const [dirty, setDirty] = React.useState(false);
  const [perms, setPerms] = React.useState({ ...PERM_PRESETS[seed.roleId] });
  const [notes, setNotes] = React.useState([
    { id:1, date:'14 Apr 2026', by:'TT', kind:'review', text:`${seed.first} is tracking ahead on ${seed.disciplines?.[0] || 'key work'}. Discussed stretching into BD in Q3 — strong fit.` },
    { id:2, date:'02 Mar 2026', by:'MB', kind:'feedback', text:`Client feedback from Panacea: "clear, no-fluff thinking; our team loved her." Captured for PAR.` },
    { id:3, date:'11 Feb 2026', by:'JS', kind:'admin',    text:`Super details updated · new fund effective 1 Mar.` },
  ]);
  const [newNote, setNewNote] = React.useState('');
  const [newKind, setNewKind] = React.useState('note');

  const update = (patch) => { setP({...p, ...patch}); setDirty(true); };

  const tabs = [
    ['overview','Overview'],
    ['engagement','Engagement'],
    ['permissions','Permissions'],
    ['notes','Notes & docs'],
    ['activity','Activity'],
  ];

  return (
    <div className="stack" style={{ gap:16 }}>
      {/* Breadcrumb + header */}
      <div className="row-spread" style={{ alignItems:'flex-start' }}>
        <div>
          <div className="txt-sm txt-muted" style={{ marginBottom:4 }}>
            <span onClick={onBack} style={{ cursor:'pointer' }}>Directory</span> › <span>{p.roleId==='mgpartner'||p.roleId==='partner'?'Partners':p.roleId==='contractor'?'Contractors':'Consultants'}</span> › <b style={{ color:'var(--text-2)' }}>{p.first} {p.last}</b>
          </div>
          <div className="row" style={{ gap:16, alignItems:'center' }}>
            <Avatar size={56}>{p.initials}</Avatar>
            <div>
              <h2 style={{ fontFamily:'var(--font-serif)', fontSize:28, fontWeight:400, margin:0 }}>{p.first} {p.last} <span className="txt-muted" style={{ fontSize:14 }}>· {p.initials}</span></h2>
              <div className="row gap-sm" style={{ marginTop:6 }}>
                <Badge tone={p.tone} dot>{p.active?'active':'inactive'}</Badge>
                {p.levelCode && <Badge tone="blue"><span className="mono" style={{ fontWeight:700 }}>{p.levelCode}</span> · {(window.FOUNDRY_LEVELS||[]).find(l=>l.code===p.levelCode)?.label}</Badge>}
                <span className="txt-sm txt-muted">{p.title} · {p.employment}</span>
                <span className="txt-sm txt-muted">· reports to <b>{p.reportsTo}</b></span>
              </div>
            </div>
          </div>
        </div>
        <div className="row gap-sm">
          <Btn ghost onClick={onBack}>← Back</Btn>
          <Btn ghost icon="doc">Export profile</Btn>
          <Btn ghost>Deactivate</Btn>
          <Btn primary icon="check" onClick={()=>setDirty(false)}>{dirty?'Save changes':'Saved'}</Btn>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid g4">
        <div className="kpi"><div className="label">Utilisation</div><div className="value" style={{ color: p.utilisation>80?'var(--amber)':p.utilisation>30?'var(--green)':'var(--text-3)' }}>{p.utilisation}%</div><div className="sub">target {p.roleId==='partner'||p.roleId==='mgpartner'?'50–70%':'70–85%'}</div></div>
        <div className="kpi"><div className="label">YTD earnings</div><div className="value">${(p.ytd/1000).toFixed(0)}k</div><div className="sub">fees + project share + BD</div></div>
        <div className="kpi"><div className="label">Rate</div><div className="value">{p.rate?`$${p.rate.toLocaleString()}`:'—'}</div><div className="sub">{p.rateUnit} · since {p.start}</div></div>
        <div className="kpi"><div className="label">Contract</div><div className="value" style={{ fontSize:22 }}>{p.contractEnd==='—'?'indefinite':p.contractEnd}</div><div className="sub">{p.contractEnd==='—'?'evergreen':'review 60d prior'}</div></div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {tabs.map(([k,l])=>(<div key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</div>))}
      </div>

      {tab==='overview' && (
        <div className="grid g-main-side" style={{ gap:16 }}>
          <div className="stack" style={{ gap:14 }}>
            <div className="card">
              <div className="card-header"><h3>Contact &amp; basics</h3><div className="txt-sm txt-muted">Click any field to edit</div></div>
              <div className="card-body">
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                  <PFieldRow label="First name"><PInput v={p.first} set={v=>update({first:v})}/></PFieldRow>
                  <PFieldRow label="Last name"><PInput v={p.last} set={v=>update({last:v})}/></PFieldRow>
                  <PFieldRow label="Initials" readonly><PInput v={p.initials} set={()=>{}} disabled mono/></PFieldRow>
                  <PFieldRow label="Job title"><PInput v={p.title} set={v=>update({title:v})}/></PFieldRow>
                  <PFieldRow label="Work email"><PInput v={p.email} set={v=>update({email:v})}/></PFieldRow>
                  <PFieldRow label="Phone"><PInput v={p.phone} set={v=>update({phone:v})}/></PFieldRow>
                  <PFieldRow label="Location"><PSelect v={p.location} set={v=>update({location:v})} options={['Sydney, AU','Melbourne, AU','Brisbane, AU','Singapore','London','New York','Remote · other']}/></PFieldRow>
                  <PFieldRow label="Reports to"><PSelect v={p.reportsTo} set={v=>update({reportsTo:v})} options={['—','TT','MB','SR','JS']}/></PFieldRow>
                  <PFieldRow label="Start date"><PInput v={p.start} set={v=>update({start:v})}/></PFieldRow>
                  <PFieldRow label="Disciplines" full>
                    <PChipGroup v={p.disciplines} set={v=>update({disciplines:v})} multi
                      options={['Market strategy','Market access','Commercial','Diligence','Regulatory','HEOR','Medical affairs','Digital health','Data & analytics','Project mgmt']}/>
                  </PFieldRow>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3>Active projects</h3><Btn sm ghost icon="plus">Assign</Btn></div>
              <table className="tbl">
                <thead><tr><th>Code</th><th>Project</th><th>Role</th><th className="num">Allocation</th><th className="num">Hours WTD</th><th>Status</th></tr></thead>
                <tbody>
                  {(personId==='MB'?[['IFM001','IFM · Diligence','Lead','40%','14h','green'],['PNC001','Panacea · Market entry','Support','20%','6h','green']]:
                    personId==='CC'?[['IFM001','IFM · Diligence','Consultant','60%','22h','green'],['PNC001','Panacea · Market entry','Consultant','40%','14h','green']]:
                    personId==='AP'?[['PNC001','Panacea · Market entry','Expert','30%','4h','blue']]:
                    [['IFM001','IFM · Diligence','Lead','40%','14h','green'],['PNC001','Panacea · Market entry','Support','20%','6h','green']]
                  ).map((r,i)=>(
                    <tr key={i}><td className="code-cell">{r[0]}</td><td>{r[1]}</td><td className="txt-sm">{r[2]}</td><td className="num">{r[3]}</td><td className="num">{r[4]}</td><td><Badge tone={r[5]} dot>on track</Badge></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="stack" style={{ gap:14 }}>
            {(p.bio || p.degrees) && (
              <div className="card">
                <div className="card-header"><h3>Bio &amp; credentials</h3><Badge tone="info">from foundry.health</Badge></div>
                <div className="card-body">
                  {p.degrees && <div className="txt-sm" style={{ marginBottom:10, color:'var(--text-2)', fontWeight:500 }}>{p.degrees}</div>}
                  {p.bio && <div className="txt-sm" style={{ lineHeight:1.55, color:'var(--text-2)' }}>{p.bio}</div>}
                </div>
              </div>
            )}
            <div className="card">
              <div className="card-header"><h3>Earnings this FY</h3></div>
              <div className="card-body">
                <div className="stack" style={{ gap:6 }}>
                  <BarRow label="Project fees" pct={Math.min(100, Math.round((p.ytd-(p.bdRef||0)-(p.projectShare||0))/2000))} val={`$${(Math.max(0,p.ytd-(p.bdRef||0)-(p.projectShare||0))/1000).toFixed(0)}k`}/>
                  {p.projectShare>0 && <BarRow label="Project share" pct={Math.min(100, Math.round(p.projectShare/1500))} val={`$${(p.projectShare/1000).toFixed(0)}k`} tone="blue"/>}
                  {p.bdRef>0      && <BarRow label="BD referrals"  pct={Math.min(100, Math.round(p.bdRef/500))} val={`$${(p.bdRef/1000).toFixed(0)}k`} tone="accent"/>}
                </div>
                <div className="hdiv"/>
                <div className="row-spread">
                  <span className="txt-sm txt-muted">Total YTD</span>
                  <span style={{ fontFamily:'var(--font-serif)', fontSize:24, color:'var(--brand)' }}>${(p.ytd/1000).toFixed(0)}k</span>
                </div>
                <Callout tone="info"><span className="txt-sm">Next true-up: <b>June</b> · figures auto-flow to Partner true-up report.</span></Callout>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3>Links</h3></div>
              <div className="list">
                {[['OneDrive folder','/Foundry/People/'+p.initials],['M365 mailbox',p.email],['Xero contact','#'+p.initials],['ClickUp profile','@'+p.initials.toLowerCase()],['Consulting agreement','v'+(p.roleId==='contractor'?'2.1':'3.0')+'.pdf']].map((l,i)=>(
                  <div key={i} className="list-item"><div className="main txt-sm">{l[0]}</div><div className="right txt-sm mono" style={{ color:'var(--brand)' }}>{l[1]}</div></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab==='engagement' && (
        <div className="card">
          <div className="card-header"><h3>Engagement &amp; commercials</h3><div className="txt-sm txt-muted">All rate changes go through managing-partner approval.</div></div>
          <div className="card-body">
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:18 }}>
              <PFieldRow label="Role preset">
                <PSelect v={p.roleId} set={v=>{ update({roleId:v}); setPerms({...PERM_PRESETS[v]}); }} options={ROLE_PRESETS.map(r=>[r.id,r.label])}/>
              </PFieldRow>
              <PFieldRow label="Level">
                <PSelect v={p.levelCode||'T2'} set={v=>{ const lvl=(window.FOUNDRY_LEVELS||[]).find(l=>l.code===v); const r=lvl?.rates[p.region||'AU']; update({ levelCode:v, title: p.title.includes('·')?p.title:`${lvl?.label||p.title}`, rate: r!=null?r:p.rate, rateUnit: r!=null?'/h':p.rateUnit }); }} options={(window.FOUNDRY_LEVELS||[]).map(l=>[l.code, `${l.code} · ${l.label}`])}/>
              </PFieldRow>
              <PFieldRow label="Region">
                <PSelect v={p.region||'AU'} set={v=>{ const lvl=(window.FOUNDRY_LEVELS||[]).find(l=>l.code===p.levelCode); const r=lvl?.rates[v]; update({ region:v, rate: r!=null?r:p.rate, rateUnit: r!=null?'/h':p.rateUnit }); }} options={[['AU','AU · AUD'],['NZ','NZ · AUD'],['US','US · USD'],['UK','UK · GBP']]}/>
              </PFieldRow>
              <PFieldRow label="Employment type">
                <PSelect v={p.employment} set={v=>update({employment:v})} options={['FT Partner','PT Partner','FT','PT','Contractor','Intern']}/>
              </PFieldRow>
              <PFieldRow label="FTE">
                <PSelect v={String(p.fte)} set={v=>update({fte:parseFloat(v)})} options={['1.0','0.8','0.6','0.5','0.4','0.2']}/>
              </PFieldRow>
              <PFieldRow label="Rate" hint="Change requires managing-partner sign-off.">
                <div className="row" style={{ gap:6 }}>
                  <div style={{ flex:1 }}><PInput v={p.rate} set={v=>update({rate:Number(v)||0})} mono/></div>
                  <div style={{ width:130 }}>
                    <PSelect v={p.rateUnit} set={v=>update({rateUnit:v})} options={[['/d','AUD / day'],['/h','AUD / hour'],['/mo','AUD / month'],['salary','salary']]}/>
                  </div>
                </div>
              </PFieldRow>
              <PFieldRow label="Effective from"><PInput v={p.start} set={v=>update({start:v})}/></PFieldRow>
              <PFieldRow label="Contract end"><PInput v={p.contractEnd==='—'?'':p.contractEnd} set={v=>update({contractEnd:v||'—'})} placeholder="blank = indefinite"/></PFieldRow>

              <PFieldRow label="Project share eligible">
                <PSelect v={p.projectShare>0?'yes':'no'} set={v=>update({projectShare: v==='yes'?Math.max(p.projectShare,20000):0})} options={['yes','no']}/>
              </PFieldRow>
              <PFieldRow label="BD referral eligible">
                <PSelect v={p.bdRef>0?'yes':'no'} set={v=>update({bdRef: v==='yes'?Math.max(p.bdRef,5000):0})} options={['yes','no']}/>
              </PFieldRow>
              <PFieldRow label="Billing entity">
                <PSelect v={'foundry'} set={()=>{}} options={[['foundry','Foundry Health Pty Ltd (PAYG)'],['self','Self-invoice · ABN'],['ext','External firm']]}/>
              </PFieldRow>

              <PFieldRow label="Disciplines" full>
                <PChipGroup v={p.disciplines} set={v=>update({disciplines:v})} multi
                  options={['Market strategy','Market access','Commercial','Diligence','Regulatory','HEOR','Medical affairs','Digital health','Data & analytics','Project mgmt']}/>
              </PFieldRow>
            </div>

            <div className="hdiv"/>

            <h3 style={{ fontSize:13, margin:'4px 0 10px' }}>Rate history</h3>
            <table className="tbl">
              <thead><tr><th>Date</th><th>Rate</th><th className="num">Δ</th><th>Approved by</th><th>Reason</th></tr></thead>
              <tbody>
                {[['2026-01-15', '$'+p.rate+p.rateUnit, '—', 'TT','Annual review'],
                  ['2025-01-15', '$'+Math.round(p.rate*0.88)+p.rateUnit, '+12%','TT','Promotion'],
                  [p.start, '$'+Math.round(p.rate*0.8)+p.rateUnit, 'initial','TT','Hire']].map((r,i)=>(
                  <tr key={i}><td className="mono txt-sm">{r[0]}</td><td className="mono">{r[1]}</td><td className="num txt-sm" style={{ color:'var(--green)' }}>{r[2]}</td><td><Avatar size={22}>{r[3]}</Avatar></td><td className="txt-sm">{r[4]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab==='permissions' && (
        <PermissionsEditor
          roleId={p.roleId}
          perms={perms}
          setPerms={(v)=>{ setPerms(v); setDirty(true); }}
          mfa={p.mfa} setMfa={v=>update({mfa:v})}
          scope={p.scope} setScope={v=>update({scope:v})}
        />
      )}

      {tab==='notes' && (
        <div className="grid g-main-side" style={{ gap:16 }}>
          <div className="card">
            <div className="card-header"><h3>Internal notes</h3><div className="txt-sm txt-muted">{notes.length} entries · partners + office mgr only</div></div>
            <div className="card-body">
              <div style={{ border:'1px solid var(--border)', borderRadius:8, padding:12, background:'var(--bg-subtle)' }}>
                <div className="row" style={{ gap:8, marginBottom:8 }}>
                  {[['note','Note'],['review','Review'],['feedback','Feedback'],['admin','Admin'],['kudos','Kudos']].map(([k,l])=>(
                    <button key={k} onClick={()=>setNewKind(k)} style={{
                      padding:'4px 10px', borderRadius:6, fontSize:11, cursor:'pointer',
                      border: newKind===k?'1px solid var(--brand)':'1px solid var(--border)',
                      background: newKind===k?'color-mix(in oklab, var(--brand) 10%, var(--bg))':'var(--bg)',
                      color: newKind===k?'var(--brand)':'var(--text-3)',
                      fontWeight: newKind===k?600:400,
                    }}>{l}</button>
                  ))}
                </div>
                <PTextarea v={newNote} set={setNewNote} rows={3} placeholder="Add a note · will timestamp + credit you automatically…"/>
                <div className="row-spread" style={{ marginTop:8 }}>
                  <div className="txt-sm txt-muted">Visible to: partners + office manager. Toggle per note if needed.</div>
                  <div className="row gap-sm">
                    <Btn sm ghost>Attach file</Btn>
                    <Btn sm primary onClick={()=>{ if(!newNote.trim()) return; setNotes([{id:Date.now(), date:'just now', by:'you', kind:newKind, text:newNote}, ...notes]); setNewNote(''); }}>Post note</Btn>
                  </div>
                </div>
              </div>

              <div className="stack" style={{ gap:10, marginTop:14 }}>
                {notes.map(n=>(
                  <div key={n.id} style={{ display:'grid', gridTemplateColumns:'auto 1fr auto', gap:12, padding:'12px 0', borderTop:'1px solid var(--divider)' }}>
                    <Avatar size={28}>{n.by.slice(0,2).toUpperCase()}</Avatar>
                    <div>
                      <div className="row gap-sm" style={{ alignItems:'baseline', marginBottom:4 }}>
                        <b style={{ fontSize:13 }}>{n.by}</b>
                        <Badge tone={n.kind==='kudos'?'green':n.kind==='review'?'blue':n.kind==='feedback'?'accent':n.kind==='admin'?'amber':''}>{n.kind}</Badge>
                        <span className="txt-sm txt-muted">{n.date}</span>
                      </div>
                      <div style={{ fontSize:13, lineHeight:1.5 }}>{n.text}</div>
                    </div>
                    <div className="row gap-sm" style={{ alignSelf:'flex-start' }}>
                      <Btn sm ghost>Edit</Btn>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="stack" style={{ gap:14 }}>
            <div className="card">
              <div className="card-header"><h3>Documents</h3><Btn sm ghost icon="plus">Upload</Btn></div>
              <div className="list">
                {[
                  ['Employment / consulting agreement','signed · '+p.start,'green'],
                  ['Firm NDA','v3.2 · signed','green'],
                  [p.employment==='Contractor'?'ABN + insurance cert':'TFN declaration','on file','green'],
                  ['ID · 100 points','verified','green'],
                  ['Super / bank details','current', p.roleId==='contractor'?'':'green'],
                  ['PAR · Jun 2025','on file','green'],
                  ['PAR · Dec 2025','on file','green'],
                  ['PAR · Jun 2026','due','amber'],
                ].filter(r=>r[2]!=='' || true).map((r,i)=>(
                  <div key={i} className="list-item">
                    <div className="main">
                      <div style={{ fontSize:13 }}>{r[0]}</div>
                      <div className="txt-sm txt-muted" style={{ fontSize:11 }}>{r[1]}</div>
                    </div>
                    <div className="right"><Badge tone={r[2]||''} dot>{r[2]==='green'?'ok':r[2]==='amber'?'due':'—'}</Badge></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3>PAR · cadence</h3></div>
              <div className="card-body">
                <div className="txt-sm txt-muted" style={{ marginBottom:6 }}>Performance & annual review schedule</div>
                <div className="row-spread"><span className="txt-sm">Cycle</span><b className="txt-sm">Jun / Dec</b></div>
                <div className="row-spread"><span className="txt-sm">Last review</span><span className="txt-sm">Dec 2025 · MB</span></div>
                <div className="row-spread"><span className="txt-sm">Next review</span><span className="txt-sm" style={{ color:'var(--amber)' }}>Jun 2026 · scheduled</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab==='activity' && (
        <div className="card">
          <div className="card-header"><h3>Activity · last 30 days</h3><div className="txt-sm txt-muted">Pulled from audit log · scoped to {p.initials}</div></div>
          <div className="list">
            {[
              ['14:22 today',   'submitted timesheet',  'week of 14 Apr · 38h'],
              ['yesterday',     'approved expense',     'PNC001 · $182 · dinner'],
              ['2d ago',        'rate updated',         `$${p.rate-50} → $${p.rate}${p.rateUnit} · approved by TT`],
              ['3d ago',        'logged on',            'MFA · Sydney IP'],
              ['1wk ago',       'completed PAR',        'Dec 2025 · 4.6 / 5'],
              ['2wk ago',       'assigned to',          'PNC001 · 20% allocation'],
            ].map((r,i)=>(
              <div key={i} className="list-item">
                <div className="main"><span className="mono txt-sm">{r[0]}</span> · <b>{r[1]}</b></div>
                <div className="right txt-sm txt-muted">{r[2]}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

Object.assign(window, { AddPersonWizard, PersonProfile, PERSON_DB, PERM_MODULES, PERM_PRESETS, LEVEL_META, ROLE_PRESETS, PermissionsEditor });
