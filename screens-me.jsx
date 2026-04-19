// screens-me.jsx
// Self-service "My Profile" for the signed-in user.
// Scope:
//   - Editable by self: display name, pronouns, photo/initials, phone, emergency contact,
//     timezone, signature block, notification prefs, 2FA, password, integrations.
//   - Read-only (admin-owned, shown for transparency): title, level, rate, start date,
//     contract, permissions summary, reporting line, leave balance, FY26 pay & tax.
//   - Pay & tax: AU FY26 YTD earnings, PAYG withheld, super paid/owing, payslips,
//     end-of-FY income statement (single-touch payroll).

const MeFieldRow = ({ label, hint, children, full }) => (
  <div style={{ gridColumn: full ? '1/-1' : 'auto', minWidth:0 }}>
    <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4, display:'flex', justifyContent:'space-between', gap:8 }}>
      <span>{label}</span>
      {hint && <span style={{ textTransform:'none', letterSpacing:0, fontStyle:'italic', color:'var(--text-4)' }}>{hint}</span>}
    </div>
    {children}
  </div>
);

const MeInput = ({ v, set, placeholder, mono, disabled }) => (
  <input value={v||''} onChange={e=>set && set(e.target.value)} placeholder={placeholder} disabled={disabled}
    style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13,
             fontFamily: mono?'var(--font-mono)':'inherit', background: disabled?'var(--bg-subtle)':'var(--bg)',
             color: disabled?'var(--text-3)':'var(--text)' }} />
);

const MeTextarea = ({ v, set, rows=3, placeholder }) => (
  <textarea value={v||''} onChange={e=>set && set(e.target.value)} rows={rows} placeholder={placeholder}
    style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, resize:'vertical', background:'var(--bg)', fontFamily:'inherit' }} />
);

const MeSelect = ({ v, set, options }) => (
  <select value={v} onChange={e=>set && set(e.target.value)}
    style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--bg)' }}>
    {options.map(o=>{
      const val = typeof o==='string'?o:o.value;
      const lab = typeof o==='string'?o:o.label;
      return <option key={val} value={val}>{lab}</option>;
    })}
  </select>
);

const MeToggle = ({ v, set, label, sub }) => (
  <label style={{ display:'grid', gridTemplateColumns:'1fr auto', alignItems:'center', gap:12, padding:'12px 0', borderTop:'1px solid var(--divider)', cursor:'pointer' }}>
    <div>
      <div style={{ fontWeight:500, fontSize:13 }}>{label}</div>
      {sub && <div className="txt-sm txt-muted" style={{ marginTop:2 }}>{sub}</div>}
    </div>
    <div onClick={()=>set(!v)} style={{
      width:38, height:22, borderRadius:12, background: v?'var(--brand)':'var(--border)',
      position:'relative', transition:'background .15s', flexShrink:0,
    }}>
      <div style={{ position:'absolute', top:2, left: v?18:2, width:18, height:18, borderRadius:'50%', background:'#fff', transition:'left .15s', boxShadow:'0 1px 3px rgba(0,0,0,.2)' }}/>
    </div>
  </label>
);

const LockedValue = ({ children, hint }) => (
  <div style={{ padding:'8px 10px', background:'var(--bg-subtle)', border:'1px solid var(--border)', borderRadius:6, fontSize:13, color:'var(--text-2)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
    <span>{children}</span>
    {hint && <span className="txt-sm txt-muted" style={{ fontSize:11 }}>🔒 {hint}</span>}
  </div>
);

// ---------- Main page ----------
const MyProfile = ({ role }) => {
  // Map current role → signed-in identity. Real impl would pull from auth.
  const identityByRole = {
    mgpartner: 'TT', partner:'MB', manager:'MB', office:'JS', consultant:'CC',
  };
  const meId = identityByRole[role] || 'TT';
  const db = (window.PERSON_DB || {})[meId] || { first:'You', last:'', initials:meId, title:'—', levelCode:'', email:'—', phone:'—' };

  const [tab, setTab] = React.useState('personal');
  const [draft, setDraft] = React.useState(() => ({
    displayName: `${db.first} ${db.last}`.trim(),
    pronouns: '',
    phone: db.phone,
    personalEmail: '',
    emergencyName: '',
    emergencyRelation: 'Partner',
    emergencyPhone: '',
    timezone: 'Australia/Sydney (AEST)',
    signature: `${db.first} ${db.last}\n${db.title}\nFoundry Health · ${db.email}`,
    // notifications
    notifyInvoicePaid: true,
    notifyApprovalRequired: true,
    notifyTimesheetReminder: true,
    notifyTrueupOpen: true,
    notifyWeeklyDigest: true,
    notifyBDWon: db.roleId==='mgpartner'||db.roleId==='L4'||db.roleId==='L3',
    digestChannel: 'email',
    quietStart: '18:00',
    quietEnd: '08:00',
    // security
    twoFA: true,
    // integrations
    m365: true, xero: db.roleId==='mgpartner'||role==='office'||role==='mgpartner', clickup: true, slack: false, calendly: true,
  }));
  const [dirty, setDirty] = React.useState(false);
  const update = (patch) => { setDraft(d=>({...d, ...patch})); setDirty(true); };
  const save = () => { setDirty(false); };

  // Pay & tax numbers — FY26 YTD to today (Apr 19 2026). Read-only, comes from payroll.
  const fyLabel = (window.fyLabel && window.fyLabel()) || 'FY26';
  const fyHuman = (window.fyHuman && window.fyHuman()) || 'Jul 2025 – Jun 2026';
  const payByRole = {
    TT: { salary: 240, ytdGross: 198, ytdPAYG: 62, ytdSuper: 22.5, leaveBal: 18.2, rate: null, rateUnit: '/d' },
    MB: { salary: 220, ytdGross: 181, ytdPAYG: 56, ytdSuper: 20.6, leaveBal: 14.5, rate: null, rateUnit: '/d' },
    SR: { salary: 200, ytdGross: 164, ytdPAYG: 49, ytdSuper: 18.7, leaveBal: 16.0, rate: null, rateUnit: '/d' },
    CC: { salary: 145, ytdGross: 118, ytdPAYG: 33, ytdSuper: 13.5, leaveBal: 12.3, rate: 150, rateUnit: '/h' },
    JB: { salary:  78, ytdGross:  64, ytdPAYG: 14, ytdSuper:  7.3, leaveBal: 18.8, rate:  65, rateUnit: '/h' },
    AP: { salary:   0, ytdGross:  88, ytdPAYG:  0, ytdSuper:  0.0, leaveBal:  0.0, rate: 200, rateUnit: '/h', contractor:true },
    JS: { salary: 115, ytdGross:  94, ytdPAYG: 20, ytdSuper: 10.8, leaveBal: 11.5, rate: null, rateUnit: 'salary' },
  };
  const pay = payByRole[meId] || payByRole.CC;

  const tabs = [
    ['personal',      'Personal'],
    ['notifications', 'Notifications'],
    ['security',      'Security'],
    ['integrations',  'Integrations'],
    ['paytax',        `Pay & tax · ${fyLabel}`],
  ];

  return (
    <div>
      {/* Header */}
      <div className="row-spread" style={{ alignItems:'flex-start', marginBottom:18 }}>
        <div>
          <div className="txt-sm txt-muted" style={{ marginBottom:4 }}>Settings › <b style={{ color:'var(--text-2)' }}>My profile</b></div>
          <div className="row" style={{ gap:16, alignItems:'center' }}>
            <Avatar size={56}>{db.initials}</Avatar>
            <div>
              <h2 style={{ fontFamily:'var(--font-serif)', fontSize:28, fontWeight:400, margin:0 }}>
                {db.first} {db.last} <span className="txt-muted" style={{ fontSize:14 }}>· {db.initials}</span>
              </h2>
              <div className="row gap-sm" style={{ marginTop:6, alignItems:'center' }}>
                {db.levelCode && <Badge tone="blue"><span className="mono" style={{ fontWeight:700 }}>{db.levelCode}</span></Badge>}
                <span className="txt-sm txt-muted">{db.title}</span>
                <span className="txt-sm txt-muted">· {db.email}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="row gap-sm">
          <Btn ghost onClick={()=>window.__nav && window.__nav('directory', { directoryTab:'people', personId: meId })}>View full profile →</Btn>
          <Btn primary icon="check" onClick={save}>{dirty?'Save changes':'Saved'}</Btn>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {tabs.map(([k,l])=>(<div key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</div>))}
      </div>

      {/* PERSONAL ---------------------------------------------------------- */}
      {tab==='personal' && (
        <div className="grid g-main-side" style={{ gap:16 }}>
          <div className="stack" style={{ gap:14 }}>
            <div className="card">
              <div className="card-header"><h3>How you appear</h3><div className="txt-sm txt-muted">Shown across timesheets, approvals, comments</div></div>
              <div className="card-body">
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                  <MeFieldRow label="Display name">
                    <MeInput v={draft.displayName} set={v=>update({displayName:v})}/>
                  </MeFieldRow>
                  <MeFieldRow label="Pronouns">
                    <MeSelect v={draft.pronouns} set={v=>update({pronouns:v})} options={['','she/her','he/him','they/them','custom…']}/>
                  </MeFieldRow>
                  <MeFieldRow label="Initials" hint="Set by admin — used as unique firm ID">
                    <LockedValue hint="admin-owned">{db.initials}</LockedValue>
                  </MeFieldRow>
                  <MeFieldRow label="Avatar photo">
                    <div className="row gap-sm" style={{ alignItems:'center' }}>
                      <Avatar size={40}>{db.initials}</Avatar>
                      <Btn sm ghost icon="upload">Upload</Btn>
                      <Btn sm ghost>Remove</Btn>
                    </div>
                  </MeFieldRow>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3>Contact</h3></div>
              <div className="card-body">
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                  <MeFieldRow label="Work email" hint="admin-owned">
                    <LockedValue hint="change requires admin">{db.email}</LockedValue>
                  </MeFieldRow>
                  <MeFieldRow label="Personal email" hint="used for payslips & EOFY docs">
                    <MeInput v={draft.personalEmail} set={v=>update({personalEmail:v})} placeholder="you@gmail.com"/>
                  </MeFieldRow>
                  <MeFieldRow label="Mobile">
                    <MeInput v={draft.phone} set={v=>update({phone:v})}/>
                  </MeFieldRow>
                  <MeFieldRow label="Timezone">
                    <MeSelect v={draft.timezone} set={v=>update({timezone:v})} options={['Australia/Sydney (AEST)','Australia/Melbourne','Australia/Brisbane','Australia/Perth','Asia/Singapore','Europe/London','America/New_York']}/>
                  </MeFieldRow>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3>Emergency contact</h3><div className="txt-sm txt-muted">Only visible to you + HR admin</div></div>
              <div className="card-body">
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
                  <MeFieldRow label="Name"><MeInput v={draft.emergencyName} set={v=>update({emergencyName:v})} placeholder="Jane Doe"/></MeFieldRow>
                  <MeFieldRow label="Relationship"><MeSelect v={draft.emergencyRelation} set={v=>update({emergencyRelation:v})} options={['Partner','Parent','Sibling','Friend','Other']}/></MeFieldRow>
                  <MeFieldRow label="Phone"><MeInput v={draft.emergencyPhone} set={v=>update({emergencyPhone:v})} placeholder="+61 …"/></MeFieldRow>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3>Email signature</h3><div className="txt-sm txt-muted">Appended to invoices you send via Foundry</div></div>
              <div className="card-body">
                <MeTextarea v={draft.signature} set={v=>update({signature:v})} rows={5}/>
              </div>
            </div>
          </div>

          {/* Side column — admin-owned facts, shown for transparency */}
          <div className="stack" style={{ gap:14 }}>
            <div className="card">
              <div className="card-header"><h3>Firm record</h3><Badge tone="" dot>read-only</Badge></div>
              <div className="list">
                <div className="list-item"><div className="main txt-sm">Title</div><div className="right txt-sm">{db.title}</div></div>
                {db.levelCode && <div className="list-item"><div className="main txt-sm">Level</div><div className="right mono txt-sm">{db.levelCode}</div></div>}
                <div className="list-item"><div className="main txt-sm">Reports to</div><div className="right"><Avatar size={20}>{db.reportsTo||'—'}</Avatar></div></div>
                <div className="list-item"><div className="main txt-sm">Start date</div><div className="right txt-sm">{db.start||'—'}</div></div>
                <div className="list-item"><div className="main txt-sm">Contract</div><div className="right txt-sm">{db.contractEnd==='—'?'indefinite':(db.contractEnd||'—')}</div></div>
                <div className="list-item"><div className="main txt-sm">Location</div><div className="right txt-sm">{db.location||'—'}</div></div>
                <div className="list-item"><div className="main txt-sm">Rate</div><div className="right mono txt-sm">{pay.rate?`$${pay.rate}${pay.rateUnit}`:'—'}</div></div>
              </div>
              <div className="card-body" style={{ paddingTop:0 }}>
                <Btn sm ghost>Request change from HR</Btn>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3>Permissions summary</h3></div>
              <div className="list">
                {((role==='mgpartner'||role==='office') ? [
                  ['Finance','admin'],['Projects','admin'],['People','admin'],['Approvals','admin'],['Governance','admin'],
                ] : role==='partner' ? [
                  ['Finance','read + partner views'],['Projects','admin on owned'],['People','read'],['Approvals','partner'],
                ] : role==='manager' ? [
                  ['Projects','edit on owned'],['Timesheet','team approval'],['Expenses','team approval'],['BD','read + edit'],
                ] : [
                  ['Timesheet','own only'],['Expenses','own only'],['Projects','read assigned'],
                ]).map((r,i)=>(
                  <div key={i} className="list-item"><div className="main txt-sm">{r[0]}</div><div className="right txt-sm txt-muted">{r[1]}</div></div>
                ))}
              </div>
              {(role==='mgpartner'||role==='office') && <div className="card-body" style={{ paddingTop:8 }}>
                <Callout tone="info" title="Admin-equivalent access">Office manager has the same permissions as the managing partner for operational continuity.</Callout>
              </div>}
            </div>
          </div>
        </div>
      )}

      {/* NOTIFICATIONS ----------------------------------------------------- */}
      {tab==='notifications' && (
        <div className="grid g-main-side" style={{ gap:16 }}>
          <div className="stack" style={{ gap:14 }}>
            <div className="card">
              <div className="card-header"><h3>What to notify me about</h3></div>
              <div className="card-body" style={{ paddingTop:0 }}>
                <MeToggle v={draft.notifyApprovalRequired} set={v=>update({notifyApprovalRequired:v})} label="Approval required" sub="Timesheets, expenses, invoices awaiting your sign-off"/>
                <MeToggle v={draft.notifyInvoicePaid}      set={v=>update({notifyInvoicePaid:v})}      label="Invoice paid / overdue" sub="Clients you own · AR crosses 30d"/>
                <MeToggle v={draft.notifyTimesheetReminder} set={v=>update({notifyTimesheetReminder:v})} label="Timesheet reminder" sub="Friday 5pm if hours not submitted"/>
                <MeToggle v={draft.notifyTrueupOpen}       set={v=>update({notifyTrueupOpen:v})}       label="Quarterly true-up opens" sub="Partners only · AU FY quarterly cycle"/>
                <MeToggle v={draft.notifyBDWon}            set={v=>update({notifyBDWon:v})}            label="BD milestone" sub="Deals move stage · verbal / signed / lost"/>
                <MeToggle v={draft.notifyWeeklyDigest}     set={v=>update({notifyWeeklyDigest:v})}     label="Weekly Monday digest" sub="AR, utilisation, approvals, BD moves"/>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3>Delivery & quiet hours</h3></div>
              <div className="card-body">
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
                  <MeFieldRow label="Digest channel">
                    <MeSelect v={draft.digestChannel} set={v=>update({digestChannel:v})} options={[
                      {value:'email', label:'Email'},
                      {value:'teams', label:'Teams'},
                      {value:'both',  label:'Both'},
                    ]}/>
                  </MeFieldRow>
                  <MeFieldRow label="Quiet from" hint="local · no pings">
                    <MeInput v={draft.quietStart} set={v=>update({quietStart:v})} mono/>
                  </MeFieldRow>
                  <MeFieldRow label="Quiet until">
                    <MeInput v={draft.quietEnd} set={v=>update({quietEnd:v})} mono/>
                  </MeFieldRow>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3>Recent · last 7 days</h3></div>
            <div className="list">
              {[
                ['approval','14:22 today','IFM001 invoice #14 needs your sign-off','—'],
                ['digest',  'Mon 07:00','Weekly digest · 3 deals moved, $142k AR outstanding','opened'],
                ['reminder','Fri 17:00','Submit your timesheet for week 15','done'],
                ['trueup',  'Tue 09:00','Q3 true-up window opens today','reviewing'],
                ['paid',    'Mon 11:40','GNC001 paid invoice INV-2026-010 · $84k',''],
              ].map((r,i)=>(
                <div key={i} className="list-item">
                  <div className="main">
                    <div style={{ fontWeight:500, fontSize:13 }}>{r[2]}</div>
                    <div className="txt-sm txt-muted">{r[1]}</div>
                  </div>
                  {r[3] && <div className="right"><Badge>{r[3]}</Badge></div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SECURITY ---------------------------------------------------------- */}
      {tab==='security' && (
        <div className="grid g2">
          <div className="stack" style={{ gap:14 }}>
            <div className="card">
              <div className="card-header"><h3>Password</h3></div>
              <div className="card-body">
                <div className="txt-sm txt-muted" style={{ marginBottom:10 }}>Last changed 22 Jan 2026 · 89 days ago</div>
                <Btn ghost>Change password</Btn>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3>Two-factor authentication</h3></div>
              <div className="card-body" style={{ paddingTop:0 }}>
                <MeToggle v={draft.twoFA} set={v=>update({twoFA:v})} label="TOTP authenticator" sub="Microsoft Authenticator · enrolled 12 Sep 2025"/>
                <div className="txt-sm txt-muted" style={{ marginTop:10 }}>Required for partners and office manager. Consultants optional.</div>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3>Active sessions</h3></div>
              <div className="list">
                {[
                  ['MacBook Pro · Sydney','Chrome 122','now','current'],
                  ['iPhone 15 · Sydney','Safari','2h ago',''],
                  ['Windows · Melbourne','Edge','yesterday',''],
                ].map((r,i)=>(
                  <div key={i} className="list-item">
                    <div className="main"><div style={{ fontWeight:500, fontSize:13 }}>{r[0]}</div><div className="txt-sm txt-muted">{r[1]} · {r[2]}</div></div>
                    <div className="right">{r[3]?<Badge tone="green" dot>{r[3]}</Badge>:<Btn sm ghost>Sign out</Btn>}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="stack" style={{ gap:14 }}>
            <div className="card">
              <div className="card-header"><h3>Recent activity</h3><div className="txt-sm txt-muted">Your sign-ins · 14d</div></div>
              <div className="list">
                {[
                  ['today 08:14','Sydney, AU','Chrome · Mac','ok'],
                  ['yesterday','Sydney, AU','Safari · iOS','ok'],
                  ['17 Apr','Singapore','Chrome · Mac','ok · travel'],
                  ['12 Apr','Sydney, AU','Edge · Win','ok'],
                ].map((r,i)=>(
                  <div key={i} className="list-item"><div className="main txt-sm">{r[0]} · {r[1]}</div><div className="right txt-sm txt-muted">{r[2]}</div></div>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3>Backup codes</h3></div>
              <div className="card-body">
                <div className="txt-sm txt-muted" style={{ marginBottom:10 }}>8 codes remaining · last generated 22 Jan 2026</div>
                <Btn ghost icon="download">Download codes</Btn>
                <Btn ghost style={{ marginLeft:8 }}>Regenerate</Btn>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* INTEGRATIONS ------------------------------------------------------ */}
      {tab==='integrations' && (
        <div className="card">
          <div className="card-header"><h3>Your personal integrations</h3><div className="txt-sm txt-muted">Firm-wide integrations are managed in Admin</div></div>
          <div className="list">
            {[
              ['M365',    'Mail, calendar, OneDrive · SSO sign-in','m365', true],
              ['Xero',    'Read your expense reimbursements & payslips','xero', (role==='mgpartner'||role==='office'||role==='partner')],
              ['ClickUp', 'Your tasks + time sync with Foundry timesheets','clickup', true],
              ['Slack',   'Private notifications to your DMs (optional)','slack', true],
              ['Calendly','BD call scheduling tied to your calendar','calendly', role!=='consultant'],
            ].filter(r=>r[3]).map((r,i)=>(
              <div key={i} className="list-item">
                <div className="main">
                  <div style={{ fontWeight:600, fontSize:13 }}>{r[0]}</div>
                  <div className="txt-sm txt-muted">{r[1]}</div>
                </div>
                <div className="right">
                  <MeToggle v={draft[r[2]]} set={v=>update({[r[2]]:v})} label="" sub=""/>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PAY & TAX --------------------------------------------------------- */}
      {tab==='paytax' && (
        <div className="stack" style={{ gap:16 }}>
          <Callout tone="info" title={`Australian FY reporting · ${fyLabel} (${fyHuman})`}>
            All figures below are YTD to today. Your end-of-FY Income Statement becomes available via ATO myGov from 14 July, auto-finalised by Foundry's single-touch payroll.
          </Callout>

          <div className="grid g4">
            <div className="kpi"><div className="label">{fyLabel} gross earnings</div><div className="value mono">${pay.ytdGross}k</div><div className="sub">of ~${pay.salary}k full-year</div></div>
            <div className="kpi"><div className="label">PAYG tax withheld</div><div className="value mono">${pay.ytdPAYG}k</div><div className="sub">{pay.ytdGross?`${Math.round(pay.ytdPAYG/pay.ytdGross*100)}% effective`:'—'}</div></div>
            <div className="kpi"><div className="label">Super (SG 11.5%)</div><div className="value mono">${pay.ytdSuper.toFixed(1)}k</div><div className="sub">{pay.contractor?'contractor — self-managed':'paid quarterly to your fund'}</div></div>
            <div className="kpi"><div className="label">Annual leave</div><div className="value">{pay.leaveBal.toFixed(1)}d</div><div className="sub">accrues 1.67d/mo</div></div>
          </div>

          <div className="grid g-main-side" style={{ gap:16 }}>
            <div className="card">
              <div className="card-header">
                <h3>Payslips · {fyLabel}</h3>
                <div className="row gap-sm"><Btn sm ghost icon="download">Download all ZIP</Btn></div>
              </div>
              <table className="tbl">
                <thead><tr><th>Period</th><th>Paid</th><th className="num">Gross</th><th className="num">PAYG</th><th className="num">Super</th><th className="num">Net</th><th></th></tr></thead>
                <tbody>
                  {[
                    ['Apr 2026 (part)','—','—','—','—','—','pending'],
                    ['Mar 2026','28 Mar',20.0, 5.5, 2.3, 14.5, 'pdf'],
                    ['Feb 2026','28 Feb',20.0, 5.5, 2.3, 14.5, 'pdf'],
                    ['Jan 2026','31 Jan',20.0, 5.5, 2.3, 14.5, 'pdf'],
                    ['Dec 2025','22 Dec',18.3, 5.0, 2.1, 13.3, 'pdf'],
                    ['Nov 2025','28 Nov',20.0, 5.5, 2.3, 14.5, 'pdf'],
                    ['Oct 2025','31 Oct',20.0, 5.5, 2.3, 14.5, 'pdf'],
                    ['Sep 2025','30 Sep',20.0, 5.5, 2.3, 14.5, 'pdf'],
                    ['Aug 2025','29 Aug',20.0, 5.5, 2.3, 14.5, 'pdf'],
                    ['Jul 2025','31 Jul',20.0, 5.5, 2.3, 14.5, 'pdf'],
                  ].map((r,i)=>(
                    <tr key={i}>
                      <td>{r[0]}</td><td className="txt-sm">{r[1]}</td>
                      <td className="num mono">{typeof r[2]==='number'?`$${r[2].toFixed(1)}k`:r[2]}</td>
                      <td className="num mono">{typeof r[3]==='number'?`$${r[3].toFixed(1)}k`:r[3]}</td>
                      <td className="num mono">{typeof r[4]==='number'?`$${r[4].toFixed(1)}k`:r[4]}</td>
                      <td className="num mono">{typeof r[5]==='number'?`$${r[5].toFixed(1)}k`:r[5]}</td>
                      <td>{r[6]==='pdf'?<Btn sm ghost icon="download">PDF</Btn>:r[6]==='pending'?<Badge tone="amber" dot>pending</Badge>:''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="stack" style={{ gap:14 }}>
              <div className="card">
                <div className="card-header"><h3>Tax details</h3><Badge tone="" dot>admin-owned</Badge></div>
                <div className="list">
                  <div className="list-item"><div className="main txt-sm">TFN</div><div className="right mono txt-sm">•••• •••• 842</div></div>
                  <div className="list-item"><div className="main txt-sm">Tax residency</div><div className="right txt-sm">Australian resident</div></div>
                  <div className="list-item"><div className="main txt-sm">Tax-free threshold</div><div className="right txt-sm">Claimed</div></div>
                  <div className="list-item"><div className="main txt-sm">HELP / HECS</div><div className="right txt-sm">{meId==='JB'||meId==='CC'?'Yes':'No'}</div></div>
                  <div className="list-item"><div className="main txt-sm">Medicare levy</div><div className="right txt-sm">Standard 2%</div></div>
                </div>
                <div className="card-body" style={{ paddingTop:6 }}>
                  <Btn sm ghost>Update TFN declaration</Btn>
                </div>
              </div>

              <div className="card">
                <div className="card-header"><h3>Super fund</h3></div>
                <div className="list">
                  <div className="list-item"><div className="main txt-sm">Fund</div><div className="right txt-sm">AustralianSuper</div></div>
                  <div className="list-item"><div className="main txt-sm">Member number</div><div className="right mono txt-sm">4829 ••• 17</div></div>
                  <div className="list-item"><div className="main txt-sm">USI / ABN</div><div className="right mono txt-sm">STA0100AU</div></div>
                  <div className="list-item"><div className="main txt-sm">SG rate</div><div className="right txt-sm">11.5% ({fyLabel})</div></div>
                  <div className="list-item"><div className="main txt-sm">Next contribution</div><div className="right txt-sm">28 Apr 2026 · Q3</div></div>
                </div>
                <div className="card-body" style={{ paddingTop:6 }}>
                  <Btn sm ghost>Change super fund</Btn>
                </div>
              </div>

              <div className="card">
                <div className="card-header"><h3>End-of-FY documents</h3></div>
                <div className="list">
                  <div className="list-item"><div className="main txt-sm">Income statement {fyLabel}</div><div className="right txt-sm txt-muted">ATO myGov · 14 Jul</div></div>
                  <div className="list-item"><div className="main txt-sm">Income statement FY25</div><div className="right"><Btn sm ghost icon="download">PDF</Btn></div></div>
                  <div className="list-item"><div className="main txt-sm">PAYG summary FY24</div><div className="right"><Btn sm ghost icon="download">PDF</Btn></div></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

window.MyProfile = MyProfile;
