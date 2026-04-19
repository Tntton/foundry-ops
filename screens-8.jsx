// ============ MASTER ADMIN (Managing Partner + Office Mgr) ============
// Client onboarding (NDAs, MSAs), personnel master (consulting agreements),
// firm-level SOPs & controls that non-operational partners don't see.

const MasterAdmin = () => {
  const [tab, setTab] = React.useState('onboarding');
  const tabs = [
    ['onboarding', 'Client onboarding'],
    ['personnel',  'Personnel master'],
    ['contracts',  'Contracts & agreements'],
    ['entities',   'Entities & tax'],
    ['controls',   'Financial controls'],
    ['users',      'Users & roles'],
    ['audit',      'Audit log'],
  ];

  return (<>
    <div className="row" style={{ marginBottom:14, flexWrap:'wrap', gap:10 }}>
      <div>
        <div className="txt-sm txt-muted">Managing partner + office manager only · firm-level controls</div>
        <h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, margin:'2px 0 0' }}>Master admin</h2>
      </div>
      <div className="ml-auto row gap-sm">
        <Badge tone="amber" dot>restricted scope</Badge>
        <Btn sm icon="settings">Firm settings</Btn>
      </div>
    </div>

    <div className="role-switcher" style={{ marginBottom:14, flexWrap:'wrap' }}>
      {tabs.map(([k,l])=>(<button key={k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{l}</button>))}
    </div>

    {tab==='onboarding' && <ClientOnboarding/>}
    {tab==='personnel'  && <PersonnelMaster/>}
    {tab==='contracts'  && <ContractsAdmin/>}
    {tab==='entities'   && <EntitiesTab/>}
    {tab==='controls'   && <ControlsTab/>}
    {tab==='users'      && <UsersRolesTab/>}
    {tab==='audit'      && <AuditTab/>}
  </>);
};

// ---------- Client onboarding (NDA generation etc.) ----------
const ClientOnboarding = () => {
  const [selected, setSelected] = React.useState(null);
  const clients = [
    { id:'NXS', name:'Nexus Health', stage:'nda-draft',     docs:['NDA · drafted'],  contact:'Dr Emily Chen',  logged:'2d ago' },
    { id:'KLX', name:'Klix Therapeutics', stage:'msa-review', docs:['NDA · signed','MSA · under review'], contact:'P. Moreno', logged:'5d ago' },
    { id:'BMX', name:'Biomax', stage:'active',              docs:['NDA','MSA','SOW-2'], contact:'J. Henning', logged:'live' },
    { id:'GNC', name:'Genica', stage:'active',              docs:['NDA','MSA'], contact:'R. Patel', logged:'live' },
    { id:'ACL', name:'Acella Bio', stage:'new',             docs:[], contact:'S. Wu', logged:'just added' },
  ];
  const stageTone = { 'new':'', 'nda-draft':'amber', 'msa-review':'amber', 'active':'green' };
  const stageLabel = { 'new':'New', 'nda-draft':'NDA drafting', 'msa-review':'MSA review', 'active':'Active' };

  return (<div className="grid g-main-side">
    <div className="stack">
      <div className="card">
        <div className="card-header">
          <h3>Client pipeline · onboarding</h3>
          <Btn sm primary icon="plus" onClick={()=>setSelected({ id:'', name:'', stage:'new', fresh:true })}>Onboard new client</Btn>
        </div>
        <table className="tbl">
          <thead><tr><th>Code</th><th>Client</th><th>Primary contact</th><th>Stage</th><th>Docs</th><th>Last action</th><th/></tr></thead>
          <tbody>
            {clients.map(c=>(
              <tr key={c.id}>
                <td className="code-cell"><b>{c.id}</b></td>
                <td><b>{c.name}</b></td>
                <td className="txt-sm">{c.contact}</td>
                <td><Badge tone={stageTone[c.stage]} dot>{stageLabel[c.stage]}</Badge></td>
                <td className="txt-sm">{c.docs.length ? c.docs.map((d,i)=>(<div key={i} style={{ fontSize:11 }}>{d}</div>)) : <span className="txt-muted">—</span>}</td>
                <td className="txt-sm txt-muted">{c.logged}</td>
                <td><Btn sm onClick={()=>setSelected(c)}>Open</Btn></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-header"><h3>Onboarding checklist · standard</h3><div className="txt-sm txt-muted">applied to every new client</div></div>
        <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          {[
            ['Legal entity check (ABN/ACN lookup)', true],
            ['KYC / sanctions screen', true],
            ['Primary contact + billing contact', true],
            ['NDA draft + send for signature', true],
            ['MSA template selection + draft', false],
            ['Fee schedule + rate card attached', false],
            ['Payment terms + banking details', false],
            ['Client folder provisioned (Drive + SharePoint)', false],
            ['ClickUp client space created', false],
            ['Billing profile set in Xero / MYOB', false],
          ].map(([l,done],i)=>(
            <div key={i} className="row gap-sm" style={{ padding:'6px 0', fontSize:12 }}>
              <span style={{ width:14, height:14, borderRadius:3, border:'1px solid var(--border)', background: done?'var(--brand)':'transparent', display:'inline-flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:10 }}>{done?'✓':''}</span>
              <span style={{ color: done?'var(--text-3)':'var(--text)', textDecoration: done?'line-through':'none' }}>{l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>

    <div className="stack">
      <div className="card">
        <div className="card-header"><h3>Quick actions</h3></div>
        <div className="card-body" style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <Btn icon="plus">+ New client</Btn>
          <Btn icon="doc">Generate NDA (mutual)</Btn>
          <Btn icon="doc">Generate NDA (one-way)</Btn>
          <Btn icon="doc">Generate MSA from template</Btn>
          <Btn icon="doc">Generate SOW / engagement letter</Btn>
          <div className="hdiv"/>
          <Btn ghost icon="settings">Manage templates</Btn>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>NDAs this quarter</h3></div>
        <div className="card-body">
          <div className="row-spread"><span className="txt-sm">Generated</span><b className="mono">14</b></div>
          <div className="row-spread"><span className="txt-sm">Awaiting signature</span><b className="mono" style={{ color:'var(--amber)' }}>3</b></div>
          <div className="row-spread"><span className="txt-sm">Signed</span><b className="mono" style={{ color:'var(--green)' }}>11</b></div>
          <div className="hdiv"/>
          <div className="txt-sm txt-muted" style={{ fontSize:11 }}>Using DocuSign · auto-filed to <span className="mono">/Clients/&lt;code&gt;/Legal/</span></div>
        </div>
      </div>
    </div>

    {selected && <ClientOnboardingModal client={selected} onClose={()=>setSelected(null)}/>}
  </div>);
};

// ---------- Onboarding wizard modal ----------
const ClientOnboardingModal = ({ client, onClose }) => {
  const [step, setStep] = React.useState(client.fresh ? 0 : 2);
  const [clientName, setClientName] = React.useState(client.name || '');
  const [clientCode, setClientCode] = React.useState(client.id || '');
  const [entity, setEntity] = React.useState('');
  const [abn, setAbn] = React.useState('');
  const [contactName, setContactName] = React.useState(client.contact || '');
  const [contactEmail, setContactEmail] = React.useState('');
  const [ndaType, setNdaType] = React.useState('mutual');
  const [ndaTerm, setNdaTerm] = React.useState('24');
  const [jurisdiction, setJurisdiction] = React.useState('NSW');
  const [purpose, setPurpose] = React.useState('evaluation of potential engagement in pharmaceutical commercialisation strategy services');

  const steps = ['Client details','Legal + tax','Generate NDA','Next docs'];

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(30,28,24,0.55)', zIndex:50, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'var(--bg)', borderRadius:10, width:'min(920px,100%)', maxHeight:'92vh', overflow:'hidden', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--divider)' }}>
          <div className="row-spread">
            <div>
              <div className="txt-sm txt-muted">Client onboarding · step {step+1} of {steps.length}</div>
              <h3 style={{ margin:0, fontFamily:'var(--font-serif)', fontSize:18, fontWeight:400 }}>{clientName || 'New client'}</h3>
            </div>
            <Btn sm ghost onClick={onClose}>✕</Btn>
          </div>
          <div className="row" style={{ gap:4, marginTop:10 }}>
            {steps.map((s,i)=>(<div key={i} style={{ flex:1, height:4, borderRadius:2, background: i<=step?'var(--brand)':'var(--bg-subtle)' }}/>))}
          </div>
        </div>

        <div style={{ padding:20, overflow:'auto' }}>
          {step===0 && (<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            <Field label="Client name" v={clientName} set={setClientName} placeholder="Nexus Health"/>
            <Field label="Client code (3 letters)" v={clientCode} set={setClientCode} placeholder="NXS" mono/>
            <Field label="Primary contact" v={contactName} set={setContactName} placeholder="Dr Emily Chen"/>
            <Field label="Primary contact email" v={contactEmail} set={setContactEmail} placeholder="emily@nexushealth.com"/>
            <Field label="Industry" v="Pharmaceuticals" set={()=>{}} asSelect options={['Pharmaceuticals','MedTech','Digital health','Biotech','Healthcare services','Other']}/>
            <Field label="Region" v="AU · ANZ" set={()=>{}} asSelect options={['AU · ANZ','APAC','US','EMEA','Global']}/>
            <div style={{ gridColumn:'1/-1' }}>
              <Field label="Brief description / how they found us" v="" set={()=>{}} multi placeholder="Intro via MB at conference · potential strategy engagement"/>
            </div>
          </div>)}
          {step===1 && (<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            <Field label="Legal entity name" v={entity} set={setEntity} placeholder="Nexus Health Pty Ltd"/>
            <Field label="ABN / ACN" v={abn} set={setAbn} placeholder="12 345 678 901" mono/>
            <Field label="Registered address" v="" set={()=>{}} placeholder="Level 2 / 40 George St, Sydney NSW 2000"/>
            <Field label="Billing contact (if different)" v="" set={()=>{}} placeholder="accounts@…"/>
            <Field label="GST registered" v="Yes" set={()=>{}} asSelect options={['Yes','No','Unknown']}/>
            <Field label="Default payment terms" v="Net 14" set={()=>{}} asSelect options={['Net 7','Net 14','Net 30','Net 45']}/>
            <div style={{ gridColumn:'1/-1' }}>
              <Callout tone="info"><span className="txt-sm">ABN auto-verified against ABR · KYC / sanctions screen runs on save.</span></Callout>
            </div>
          </div>)}
          {step===2 && (<div>
            <div className="txt-sm txt-muted" style={{ marginBottom:10 }}>NDA fields auto-fill from steps 1–2. Preview updates live on the right.</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1.3fr', gap:16 }}>
              <div className="stack" style={{ gap:12 }}>
                <Field label="NDA type" v={ndaType} set={setNdaType} asSelect options={[['mutual','Mutual NDA'],['oneway','One-way · Foundry discloses'],['oneway-in','One-way · Client discloses']]}/>
                <Field label="Term (months)" v={ndaTerm} set={setNdaTerm} asSelect options={['12','18','24','36','60']}/>
                <Field label="Governing law" v={jurisdiction} set={setJurisdiction} asSelect options={['NSW','VIC','QLD','SG · Singapore','US · Delaware','UK · England & Wales']}/>
                <Field label="Purpose of disclosure" v={purpose} set={setPurpose} multi/>
                <div className="row gap-sm">
                  <label className="row gap-sm" style={{ fontSize:12 }}><input type="checkbox" defaultChecked/>Include IP carve-out</label>
                </div>
                <div className="row gap-sm">
                  <label className="row gap-sm" style={{ fontSize:12 }}><input type="checkbox" defaultChecked/>Include non-solicitation (12mo)</label>
                </div>
                <div className="row gap-sm">
                  <label className="row gap-sm" style={{ fontSize:12 }}><input type="checkbox"/>Add residuals clause</label>
                </div>
                <div className="hdiv"/>
                <Btn primary icon="doc">Generate NDA &amp; send via DocuSign</Btn>
                <Btn ghost icon="doc">Download .docx</Btn>
              </div>

              <div style={{ background:'var(--bg-subtle)', borderRadius:8, padding:18, fontSize:11, lineHeight:1.6, fontFamily:'Georgia, serif', maxHeight:380, overflow:'auto', border:'1px solid var(--border)' }}>
                <div style={{ textAlign:'center', fontWeight:600, fontSize:13, letterSpacing:'.05em', textTransform:'uppercase', marginBottom:12 }}>{ndaType==='mutual'?'Mutual Non-Disclosure Agreement':'Non-Disclosure Agreement'}</div>
                <p>This Agreement is made on <b>{new Date().toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'})}</b> between:</p>
                <p><b>Foundry Health Pty Ltd</b> (ABN 44 123 456 789), of Level 3 / 88 Liverpool St, Sydney NSW 2000 (<b>"Foundry"</b>); and</p>
                <p><b>{entity || '[Client legal entity]'}</b>{abn && <> (ABN {abn})</>}, of [address] (<b>"{clientName || '[Client]'}"</b>).</p>
                <p><b>1. Purpose.</b> The parties wish to discuss and share Confidential Information in connection with <i>{purpose}</i> (the "<b>Purpose</b>").</p>
                <p><b>2. Confidential Information.</b> {ndaType==='mutual'?'Each party ("Discloser") may disclose to the other ("Recipient")':'The Discloser may disclose to the Recipient'} information that is marked confidential or would reasonably be understood to be confidential…</p>
                <p><b>3. Term.</b> This Agreement commences on the date above and continues for <b>{ndaTerm} months</b>, unless terminated earlier by written notice.</p>
                <p><b>4. Governing law.</b> This Agreement is governed by the laws of <b>{jurisdiction}</b> and each party submits to the exclusive jurisdiction of its courts.</p>
                <p style={{ color:'var(--text-3)' }}>[Clauses 5–12 · IP, non-solicit, remedies, notices, signatures — standard Foundry template]</p>
              </div>
            </div>
          </div>)}
          {step===3 && (<div>
            <div className="txt-sm txt-muted" style={{ marginBottom:12 }}>Once NDA is signed, generate follow-on documents as required.</div>
            <div className="grid g3">
              {[
                ['MSA · master services','Governs all future SOWs','draft'],
                ['SOW · engagement letter','Scope, fee, team, deliverables','template'],
                ['Consulting agreement','For subcontractors on this engagement','template'],
                ['Rate card','Attach to MSA as Schedule A','standard'],
                ['Data processing agreement','If handling client PHI/PII','conditional'],
                ['W-8BEN / residency form','US-based clients only','conditional'],
              ].map((d,i)=>(
                <div key={i} style={{ border:'1px solid var(--border)', borderRadius:8, padding:14 }}>
                  <div style={{ fontWeight:600, fontSize:13 }}>{d[0]}</div>
                  <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:2, marginBottom:10 }}>{d[1]}</div>
                  <div className="row-spread"><Badge dot>{d[2]}</Badge><Btn sm>Generate</Btn></div>
                </div>
              ))}
            </div>
            <Callout tone="info" title="Auto-provisioned on finish">
              <div className="txt-sm">Client folder structure · billing profile in Xero · ClickUp space · initial project code reserved · welcome email (templated, reviewed by managing partner before send)</div>
            </Callout>
          </div>)}
        </div>

        <div style={{ padding:'12px 20px', borderTop:'1px solid var(--divider)', display:'flex', gap:8, justifyContent:'flex-end' }}>
          {step>0 && <Btn ghost onClick={()=>setStep(step-1)}>Back</Btn>}
          {step<steps.length-1 && <Btn primary onClick={()=>setStep(step+1)}>Continue →</Btn>}
          {step===steps.length-1 && <Btn primary onClick={onClose}>Finish onboarding</Btn>}
        </div>
      </div>
    </div>
  );
};

const Field = ({ label, v, set, placeholder, mono, multi, asSelect, options }) => (
  <div>
    <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4 }}>{label}</div>
    {asSelect ? (
      <select value={v} onChange={e=>set(e.target.value)} style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--bg)', fontFamily: mono?'var(--font-mono)':'inherit' }}>
        {(options||[]).map((o,i)=> Array.isArray(o) ? <option key={i} value={o[0]}>{o[1]}</option> : <option key={i} value={o}>{o}</option>)}
      </select>
    ) : multi ? (
      <textarea value={v} onChange={e=>set(e.target.value)} placeholder={placeholder} rows={3} style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, fontFamily:'inherit', resize:'vertical' }}/>
    ) : (
      <input value={v} onChange={e=>set(e.target.value)} placeholder={placeholder} style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, fontFamily: mono?'var(--font-mono)':'inherit' }}/>
    )}
  </div>
);

// ---------- Personnel master (consulting agreement expiry tracker) ----------
const PersonnelMaster = () => {
  const people = [
    ['TT','Trung','Managing partner','Partner agreement','—','indefinite','green'],
    ['MB','MB','Partner','Partner agreement','—','indefinite','green'],
    ['SR','SR','Associate partner','Partner agreement','1 Jul 2024','1 Jul 2026','amber'],
    ['CC','CC','Consultant · FT','Employment','15 Jan 2025','indefinite','green'],
    ['JB','JB','Analyst · FT','Employment','3 Mar 2025','indefinite','green'],
    ['AP','Alex Park','Contractor','Consulting · 6 mo','1 Feb 2026','31 Jul 2026','amber'],
    ['KR','K. Roberts','Contractor','Consulting · 3 mo','1 Mar 2026','31 May 2026','red'],
    ['JS','Jas','Office manager','Employment','2022','indefinite','green'],
  ];
  return (<>
    <div className="row-spread" style={{ marginBottom:14 }}>
      <div className="txt-sm txt-muted">Master tracker · consulting agreements, expiries, PAR cycle</div>
      <div className="row gap-sm"><Btn sm icon="plus">Add person</Btn><Btn sm ghost icon="doc">Export to Excel</Btn></div>
    </div>
    <div className="grid g4" style={{ marginBottom:12 }}>
      <div className="kpi"><div className="label">Active people</div><div className="value">8</div><div className="sub">5 staff · 3 contractors</div></div>
      <div className="kpi"><div className="label">Expiring in 60 days</div><div className="value" style={{ color:'var(--red)' }}>1</div><div className="sub">KR · 31 May</div></div>
      <div className="kpi"><div className="label">Expiring in 180 days</div><div className="value" style={{ color:'var(--amber)' }}>2</div><div className="sub">SR, AP</div></div>
      <div className="kpi"><div className="label">PAR cycle</div><div className="value">Jun</div><div className="sub">6 reviews due</div></div>
    </div>
    <div className="card">
      <div className="card-header"><h3>All personnel</h3></div>
      <table className="tbl">
        <thead><tr><th>Code</th><th>Name</th><th>Role</th><th>Agreement type</th><th>Start / renewal</th><th>Expiry</th><th>Status</th><th/></tr></thead>
        <tbody>
          {people.map(p=>(
            <tr key={p[0]}>
              <td><Avatar>{p[0]}</Avatar></td>
              <td><b>{p[1]}</b></td>
              <td className="txt-sm">{p[2]}</td>
              <td className="txt-sm">{p[3]}</td>
              <td className="txt-sm">{p[4]}</td>
              <td className="txt-sm mono">{p[5]}</td>
              <td><Badge tone={p[6]} dot>{p[6]==='red'?'expiring soon':p[6]==='amber'?'renew window':'active'}</Badge></td>
              <td className="row gap-sm"><Btn sm>Open</Btn>{p[6]!=='green' && <Btn sm icon="doc">Renew</Btn>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
};

const ContractsAdmin = () => (
  <div className="card"><div className="card-header"><h3>Contract templates</h3><Btn sm icon="plus">New template</Btn></div>
    <table className="tbl">
      <thead><tr><th>Template</th><th>Type</th><th>Version</th><th>Last reviewed</th><th>Owner</th><th/></tr></thead>
      <tbody>
        {[
          ['NDA · mutual','NDA','v3.2','Jan 2026','Legal (Herbert Smith)'],
          ['NDA · one-way','NDA','v3.1','Jan 2026','Legal'],
          ['MSA · standard','MSA','v5.0','Mar 2026','TT + Legal'],
          ['SOW · fixed-fee','SOW','v2.4','Feb 2026','TT'],
          ['Consulting agreement','Subcontractor','v2.1','Dec 2025','JS'],
          ['DPA · PHI','DPA','v1.2','Nov 2025','Legal'],
        ].map((r,i)=>(
          <tr key={i}><td><b>{r[0]}</b></td><td><Badge>{r[1]}</Badge></td><td className="mono">{r[2]}</td><td className="txt-sm">{r[3]}</td><td className="txt-sm">{r[4]}</td><td className="row gap-sm"><Btn sm>Open</Btn><Btn sm ghost>Edit</Btn></td></tr>
        ))}
      </tbody>
    </table>
  </div>
);

const EntitiesTab = () => (
  <div className="grid g2">
    <div className="card"><div className="card-header"><h3>Legal entities</h3></div>
      <table className="tbl"><tbody>
        <tr><td><b>Foundry Health Pty Ltd</b></td><td className="txt-sm">ABN 44 123 456 789</td><td><Badge tone="green" dot>active</Badge></td></tr>
        <tr><td><b>Foundry Health Partners</b></td><td className="txt-sm">(true-up vehicle)</td><td><Badge tone="green" dot>active</Badge></td></tr>
      </tbody></table>
    </div>
    <div className="card"><div className="card-header"><h3>Tax &amp; compliance</h3></div>
      <div className="card-body">
        <div className="row-spread"><span className="txt-sm">BAS</span><Badge tone="green" dot>Q3 filed</Badge></div>
        <div className="row-spread"><span className="txt-sm">PAYG</span><Badge tone="green" dot>current</Badge></div>
        <div className="row-spread"><span className="txt-sm">Super</span><Badge tone="green" dot>up-to-date</Badge></div>
        <div className="row-spread"><span className="txt-sm">Workers comp</span><Badge tone="amber" dot>renewal Jun</Badge></div>
        <div className="row-spread"><span className="txt-sm">PI insurance</span><Badge tone="green" dot>to Nov 2026</Badge></div>
      </div>
    </div>
  </div>
);

const ControlsTab = () => (
  <div className="card"><div className="card-header"><h3>Financial controls · approval thresholds</h3></div>
    <table className="tbl">
      <thead><tr><th>Action</th><th>Threshold</th><th>Approver</th><th>Override</th></tr></thead>
      <tbody>
        <tr><td>Expense auto-approve</td><td className="num mono">&lt; $200</td><td>System</td><td>—</td></tr>
        <tr><td>Expense single-approver</td><td className="num mono">$200–$2,000</td><td>Project lead</td><td>Managing partner</td></tr>
        <tr><td>Expense dual-approver</td><td className="num mono">&gt; $2,000</td><td>Lead + Managing partner</td><td>—</td></tr>
        <tr><td>Invoice to client auto-send</td><td className="num mono">Matches SOW schedule</td><td>Office manager</td><td>Project lead</td></tr>
        <tr><td>New SOW</td><td className="num mono">Any</td><td>Managing partner</td><td>—</td></tr>
        <tr><td>Rate override</td><td className="num mono">Any</td><td>Managing partner</td><td>—</td></tr>
      </tbody>
    </table>
  </div>
);

const UsersRolesTab = () => (
  <div className="card"><div className="card-header"><h3>Users &amp; permissions</h3><Btn sm icon="plus">Invite user</Btn></div>
    <table className="tbl">
      <thead><tr><th>Name</th><th>Role</th><th>Access scope</th><th>MFA</th><th>Last login</th></tr></thead>
      <tbody>
        <tr><td><b>TT</b> · Trung</td><td><Badge tone="amber" dot>Managing partner</Badge></td><td className="txt-sm">Full · all projects + firm admin</td><td><Badge tone="green" dot>on</Badge></td><td className="txt-sm mono">2m ago</td></tr>
        <tr><td><b>MB</b></td><td><Badge dot>Partner</Badge></td><td className="txt-sm">Own projects + partner true-up view</td><td><Badge tone="green" dot>on</Badge></td><td className="txt-sm mono">14m ago</td></tr>
        <tr><td><b>SR</b></td><td><Badge dot>Partner (PT)</Badge></td><td className="txt-sm">Own projects only</td><td><Badge tone="green" dot>on</Badge></td><td className="txt-sm mono">3h ago</td></tr>
        <tr><td><b>MB</b> · ops hat</td><td><Badge dot>Manager</Badge></td><td className="txt-sm">Assigned projects only</td><td><Badge tone="green" dot>on</Badge></td><td className="txt-sm mono">—</td></tr>
        <tr><td><b>JS</b></td><td><Badge dot>Office manager</Badge></td><td className="txt-sm">Full admin · no partner true-up</td><td><Badge tone="green" dot>on</Badge></td><td className="txt-sm mono">6m ago</td></tr>
        <tr><td><b>CC, JB, AP</b></td><td><Badge dot>Consultant / Contractor</Badge></td><td className="txt-sm">Own timesheet + assigned projects</td><td><Badge tone="green" dot>on</Badge></td><td className="txt-sm mono">—</td></tr>
      </tbody>
    </table>
  </div>
);

const AuditTab = () => (
  <div className="card"><div className="card-header"><h3>Audit log</h3><div className="txt-sm txt-muted">last 30 days</div></div>
    <div className="list">
      {[
        ['14:22 today','TT','generated NDA · NXS','nda.mutual.v3.2'],
        ['12:04 today','JS','approved expense · $318 · PNC001','override · receipt missing'],
        ['09:15 today','MB','created SOW draft · KLX001','—'],
        ['yesterday','TT','changed rate · AP · $135 → $145','effective 1 May'],
        ['yesterday','JS','sent invoice · IFM001-INV-004','$48,000'],
        ['3d ago','TT','onboarded client · Acella Bio','code ACL'],
      ].map((r,i)=>(
        <div key={i} className="list-item">
          <div className="main"><span className="mono txt-sm">{r[0]}</span> · <b>{r[1]}</b> · {r[2]}</div>
          <div className="right txt-sm txt-muted">{r[3]}</div>
        </div>
      ))}
    </div>
  </div>
);

// ============ PROJECT CHECKLIST ============
// Source of truth: Foundry's Project Checklist Template (39 tasks, 6 phases, 4 activity types, 3 owner roles)
const PROJECT_CHECKLIST = [
  // phase, activity, task, responsible
  ['Pre kick-off','Proposal Phase','Confirm project code and code name (i.e. Project GEM) and generate in trackers','Lead partner'],
  ['Pre kick-off','Contracts','Confirm NDA (file in project admin folder)','Lead partner'],
  ['Pre kick-off','Contracts','Confirm executed consulting agreement (file in admin folder)','Lead partner'],
  ['Pre kick-off','Resourcing','Confirm team availability and forecast capacity','Project lead'],
  ['Pre kick-off','Resourcing','Confirm initial workstream allocation','Project lead'],
  ['Pre kick-off','Project Administration','Generate project folder from template in all-access','Office Manager'],
  ['Pre kick-off','Project Administration','Provide team access to Clickup','Office Manager'],
  ['Pre kick-off','Project Administration','Update Clickup and generate project tracker','Project lead'],
  ['Pre kick-off','Financial','Generate project financial tracker in financial folder','Office Manager'],
  ['Pre kick-off','Financial','Generate admin folders (financial) in admin access','Office Manager'],
  ['Pre kick-off','Financial','Generate invoice (up-front payment)','Office Manager'],
  ['Pre kick-off','Communication','Set up project whatsapp group','Project lead'],
  ['Pre kick-off','Communication','WNGO to team (by email or message, templated)','Project lead'],

  ['Team kick-off','Project Administration','Set team kick-off meeting (minimum 2 hours)','Project lead'],
  ['Team kick-off','Project Administration','Prepare kick-off briefing materials and day-one answer/problem statement sheet','Project lead'],
  ['Team kick-off','Project Administration','Confirm workplan','Project lead'],
  ['Team kick-off','Project Administration','Complete risk assessment matrix','Project lead'],
  ['Team kick-off','Communication','Set up weekly leadership team check-in','Lead partner'],
  ['Team kick-off','Communication','Set up team standing check-ins (minimum weekly)','Project lead'],
  ['Team kick-off','Communication','Set up team calendar/cadence for deadlines and team check-ins','Project lead'],

  ['Project Management','Project Administration','Confirm scope with client/LT','Lead partner'],
  ['Project Management','Project Administration','Set up ghost deliverable','Project lead'],
  ['Project Management','Project Administration','Confirm access for all team members to folders etc (including client folders)','Office Manager'],
  ['Project Management','Project Administration','Set up and maintain working folders ','Project lead'],
  ['Project Management','Project Administration','Generate project meeting notes document','Project lead'],
  ['Project Management','Financial','Set up expenses folder','Office Manager'],
  ['Project Management','Financial','Track expenses via virtual office manager','Office Manager'],
  ['Project Management','Financial','Weekly request to update timesheets and expenses','Office Manager'],
  ['Project Management','Financial','Send interim invoice (if applicable)','Office Manager'],

  ['Admin Management','Operations','Ensure Jas added into all groups','Project lead'],
  ['Admin Management','Operations','Admin/ops SOP spot check','Office Manager'],

  ['Project completion','Project Administration','Confirm final sign-off by client (i.e. via email)','Lead partner'],
  ['Project completion','Project Administration','Place copy of final deliverables in master folders','Project lead'],
  ['Project completion','Project Administration','Conduct final project leadership check out meeting','Lead partner'],
  ['Project completion','Financial','Send final invoice','Office Manager'],
  ['Project completion','Financial','Request payment (reminder if required)','Office Manager'],
  ['Project completion','Financial','Finalise and approve consultant hours and expenses','Lead partner'],
  ['Project completion','Financial','Consultants to generate invoice for FH','Project lead'],

  ['Post project admin','Financial','Disburse recievables into FH accounts','Office Manager'],
  ['Post project admin','Financial','Disburse payables (in order of vendor, expenses, consultant, OPEX, partners)','Office Manager'],
  ['Post project admin','Financial','Acquit final tracker account and sign off','Lead partner'],
  ['Post project admin','Project Administration','Clean up working folders','Project lead'],
  ['Post project admin','Project Administration','Close Clickup (no outstanding tasks)','Project lead'],
  ['Post project admin','Project Administration','Archive project folders','Office Manager'],
  ['Post project admin','Project Administration','Update master project tracker','Office Manager'],
  ['Post project admin','Organisation','Complete project lessons learned','Project lead'],
  ['Post project admin','Organisation','Request client feedback and testimonial','Lead partner'],
  ['Post project admin','Organisation','Conduct post-project team survey','Project lead'],
  ['Post project admin','Organisation','Individual team member follow ups and discuss PAR','Lead partner'],
  ['Post project admin','Organisation','Set up grand rounds discussion','Lead partner'],
  ['Post project admin','Organisation','Set up internal outcomes tracking','Lead partner'],
  ['Post project admin','Organisation','Audit all team consulting agreements (ensure no one out of date)','Office Manager'],
];

const ProjectChecklist = ({ code='IFM001' }) => {
  // simulated state: earlier phases mostly done, project-mgmt in-flight, later phases pending
  const initialState = PROJECT_CHECKLIST.map((t, i) => {
    const phase = t[0];
    if (phase === 'Pre kick-off' || phase === 'Team kick-off') return i % 11 === 3 ? 'na' : 'done';
    if (phase === 'Project Management') return i % 4 === 0 ? 'doing' : i % 4 === 1 ? 'done' : 'todo';
    if (phase === 'Admin Management') return 'doing';
    return 'todo';
  });
  const [state, setState] = React.useState(initialState);
  const [filter, setFilter] = React.useState('all');
  const [ownerFilter, setOwnerFilter] = React.useState('all');

  const phases = ['Pre kick-off','Team kick-off','Project Management','Admin Management','Project completion','Post project admin'];
  const tone = { done:'green', doing:'amber', todo:'', na:'' };
  const icon = { done:'✓', doing:'●', todo:'○', na:'–' };

  const counts = phases.map(ph => {
    const idxs = PROJECT_CHECKLIST.map((t,i)=>[t,i]).filter(([t])=>t[0]===ph).map(([,i])=>i);
    const done = idxs.filter(i=>state[i]==='done' || state[i]==='na').length;
    return { ph, done, total: idxs.length };
  });
  const totalDone = state.filter(s => s==='done' || s==='na').length;
  const totalPct = Math.round(totalDone / state.length * 100);

  const toggle = (i) => {
    const next = [...state];
    next[i] = next[i]==='todo' ? 'doing' : next[i]==='doing' ? 'done' : next[i]==='done' ? 'na' : 'todo';
    setState(next);
  };

  const owners = ['all','Lead partner','Project lead','Office Manager'];

  return (<div className="stack">
    <div className="card">
      <div className="card-header">
        <h3>Project checklist · <span className="mono">{code}</span></h3>
        <div className="row gap-sm">
          <Badge tone={totalPct>80?'green':totalPct>40?'amber':''} dot>{totalDone}/{state.length} complete · {totalPct}%</Badge>
          <Btn sm ghost icon="doc">Export to Excel</Btn>
        </div>
      </div>
      <div className="card-body" style={{ paddingBottom:0 }}>
        <div style={{ display:'grid', gridTemplateColumns:`repeat(${phases.length}, 1fr)`, gap:6, marginBottom:8 }}>
          {counts.map(c=>(
            <div key={c.ph} style={{ padding:'8px 10px', borderRadius:6, background:'var(--bg-subtle)' }}>
              <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em' }}>{c.ph}</div>
              <div className="row-spread" style={{ marginTop:2 }}>
                <b className="mono" style={{ fontSize:13 }}>{c.done}/{c.total}</b>
                <div style={{ flex:1, height:4, background:'rgba(0,0,0,0.05)', borderRadius:2, margin:'0 8px', overflow:'hidden' }}>
                  <div style={{ width:`${c.done/c.total*100}%`, height:'100%', background: c.done===c.total?'var(--green)':'var(--brand)' }}/>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="row gap-sm" style={{ flexWrap:'wrap', padding:'10px 0' }}>
          <div className="role-switcher">
            {[['all','All'],['todo','To do'],['doing','In progress'],['done','Done']].map(([k,l])=>(<button key={k} className={filter===k?'active':''} onClick={()=>setFilter(k)}>{l}</button>))}
          </div>
          <div className="role-switcher">
            {owners.map(o=>(<button key={o} className={ownerFilter===o?'active':''} onClick={()=>setOwnerFilter(o)}>{o==='all'?'All owners':o}</button>))}
          </div>
          <div className="ml-auto txt-sm txt-muted">click status pill to cycle: ○ todo → ● doing → ✓ done → – N/A</div>
        </div>
      </div>

      {phases.map(ph => {
        const rows = PROJECT_CHECKLIST.map((t,i)=>({t,i})).filter(({t,i})=>t[0]===ph)
          .filter(({i})=>filter==='all'?true:state[i]===filter)
          .filter(({t})=>ownerFilter==='all'?true:t[3]===ownerFilter);
        if (rows.length===0) return null;
        return (
          <div key={ph}>
            <div style={{ padding:'10px 18px 4px', fontFamily:'var(--font-serif)', fontSize:14, fontWeight:500, color:'var(--text-2)', borderTop:'1px solid var(--divider)' }}>{ph}</div>
            <table className="tbl">
              <thead><tr><th style={{ width:80 }}>Status</th><th>Task</th><th>Activity</th><th>Responsible</th><th>Doc / folder link</th><th>Comments</th></tr></thead>
              <tbody>
                {rows.map(({t,i})=>(
                  <tr key={i}>
                    <td><span onClick={()=>toggle(i)} style={{ cursor:'pointer', display:'inline-flex', alignItems:'center', gap:5, padding:'2px 8px', borderRadius:12, background: state[i]==='done'?'rgba(107,140,62,0.15)':state[i]==='doing'?'rgba(180,124,63,0.15)':state[i]==='na'?'var(--bg-subtle)':'transparent', border:'1px solid var(--border)', fontSize:11, color: state[i]==='done'?'var(--green)':state[i]==='doing'?'var(--amber)':'var(--text-3)' }}>
                      <span style={{ fontSize:10 }}>{icon[state[i]]}</span>
                      <span style={{ textTransform:'capitalize' }}>{state[i]==='na'?'N/A':state[i]==='doing'?'doing':state[i]}</span>
                    </span></td>
                    <td className="txt-sm" style={{ textDecoration: state[i]==='done'?'line-through':'none', color: state[i]==='done'?'var(--text-3)':'var(--text)' }}>{t[2].trim()}</td>
                    <td><Badge>{t[1]}</Badge></td>
                    <td className="txt-sm">{t[3]}</td>
                    <td className="txt-sm"><span style={{ color:'var(--text-3)' }}>— link —</span></td>
                    <td className="txt-sm txt-muted">{state[i]==='doing'?'in flight':''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  </div>);
};

Object.assign(window, { MasterAdmin, ProjectChecklist, PROJECT_CHECKLIST });
