// ============ NEW PROJECT WIZARD (full 6-step flow) ============
// Client & code → Contract → Team & rates → Financial model → Referrals → Review & sync

const NewProjectWizard = () => {
  const [step, setStep] = React.useState(0);
  const steps = ['Client & code','Contract','Team & rates','Financial model','Referrals','Review & sync'];

  // ---- State across all steps ----
  const [data, setData] = React.useState({
    // step 1
    clientMode:'existing',   // existing | new
    clientCode:'IFM',
    clientName:'Integrated Market (IFM Pharma)',
    projectName:'Diligence Strategy · Phase II',
    codeName:'Project GEM',
    projectCode:'IFM002',
    projectType:'Due diligence',
    startDate:'2026-05-04',
    durationWeeks:12,
    leadPartner:'MB',
    // step 2
    contractType:'fixed',    // fixed | t&m | retainer
    grossFee: 620000,
    currency:'AUD',
    paymentSchedule:'upfront-interim-final',
    ndaSigned:true,
    msaSigned:true,
    // step 3
    leadership:[
      { code:'MB', role:'Lead partner',      fte:0.5, rate:2000, weight:1.0 },
      { code:'TT', role:'Expert partner',    fte:0.3, rate:2000, weight:1.5 },
      { code:'SR', role:'Associate partner', fte:0.3, rate:2000, weight:1.0 },
    ],
    delivery:[
      { code:'CC', role:'Consultant',        alloc:'1.0 FTE', rate:800, unit:'/d' },
      { code:'JB', role:'Analyst',           alloc:'1.0 FTE', rate:400, unit:'/d' },
      { code:'AP', role:'External expert',   alloc:'4h/wk',   rate:250, unit:'/h' },
    ],
    // step 4
    opexPct: 20,
    profitPoolPct: 15,
    bdReferralPct: 3,
    expenseBudget: 18000,
    // step 5
    referrals:[ { name:'AP · Alex Park', type:'BD · introducer', pct:3, notes:'Intro at BIO Asia' } ],
  });
  const patch = (p) => setData(d => ({...d, ...p}));

  // Derived
  const contractValue = data.grossFee;
  const deliveryWeeks = data.durationWeeks;
  const projectExpenses = Math.round(
    data.leadership.reduce((a,p)=>a + p.fte * p.rate * 5 * deliveryWeeks, 0) +
    data.delivery.reduce((a,p)=>{
      if (p.unit==='/d') {
        const fte = parseFloat((p.alloc||'').split(' ')[0]) || 0.5;
        return a + fte * p.rate * 5 * deliveryWeeks;
      } else {
        const hrs = parseFloat((p.alloc||'').split('h')[0]) || 4;
        return a + hrs * p.rate * deliveryWeeks;
      }
    }, 0) + data.expenseBudget
  );
  const opexDollars = Math.round(contractValue * data.opexPct/100);
  const profitPoolDollars = Math.round(contractValue * data.profitPoolPct/100);
  const bdDollars = Math.round(contractValue * data.bdReferralPct/100);
  const ltResidual = contractValue - projectExpenses - opexDollars - profitPoolDollars - bdDollars;
  const expPct = Math.round(projectExpenses/contractValue*100);
  const marginPct = Math.round((contractValue - projectExpenses)/contractValue*100);

  const next = () => setStep(s => Math.min(steps.length-1, s+1));
  const back = () => setStep(s => Math.max(0, s-1));

  return (<>
    <div className="row" style={{ marginBottom:14, flexWrap:'wrap', gap:10 }}>
      <div>
        <div className="txt-sm txt-muted">Step {step+1} of {steps.length} · propagates code across all systems</div>
        <h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, margin:'2px 0 0' }}>New project · {steps[step]}</h2>
      </div>
      <div className="ml-auto row gap-sm">
        <Btn sm ghost>Cancel</Btn>
        <Btn sm>Save draft</Btn>
      </div>
    </div>

    <div className="stepper" style={{ marginBottom:14 }}>
      {steps.map((l,i)=>(
        <div key={i} className={`step ${i<step?'done':i===step?'active':''}`} onClick={()=>i<step && setStep(i)} style={{ cursor: i<step?'pointer':'default' }}>
          <div className="num">{i<step?'✓':String(i+1).padStart(2,'0')}</div>{l}
        </div>
      ))}
    </div>

    <div className="grid g-main-side">
      <div className="stack">
        {step===0 && <Step1ClientCode data={data} patch={patch}/>}
        {step===1 && <Step2Contract data={data} patch={patch}/>}
        {step===2 && <Step3Team data={data} patch={patch}/>}
        {step===3 && <Step4Financial data={data} patch={patch} calc={{projectExpenses, opexDollars, profitPoolDollars, bdDollars, ltResidual, expPct, marginPct}}/>}
        {step===4 && <Step5Referrals data={data} patch={patch}/>}
        {step===5 && <Step6Review data={data} calc={{projectExpenses, opexDollars, profitPoolDollars, bdDollars, ltResidual, expPct, marginPct}}/>}
      </div>

      <div className="stack" style={{ position:'sticky', top:0 }}>
        <WizardLiveSummary data={data} calc={{contractValue, projectExpenses, opexDollars, profitPoolDollars, bdDollars, ltResidual, expPct, marginPct}}/>
        <WizardPropagationPanel code={data.projectCode} step={step}/>
      </div>
    </div>

    <div className="card" style={{ marginTop:14, position:'sticky', bottom:0, zIndex:5 }}>
      <div className="card-body row" style={{ alignItems:'center' }}>
        <div className="txt-sm txt-muted">Code <b className="mono" style={{ color:'var(--text)' }}>{data.projectCode}</b> · will propagate to 6 workbooks on finish</div>
        <div className="ml-auto row gap-sm">
          {step>0 && <Btn ghost onClick={back}>← Back</Btn>}
          {step<steps.length-1 && <Btn primary onClick={next}>Continue →</Btn>}
          {step===steps.length-1 && <Btn primary icon="check">Create project &amp; sync</Btn>}
        </div>
      </div>
    </div>
  </>);
};

// ========== STEPS ==========
const Step1ClientCode = ({ data, patch }) => (
  <>
    <div className="card">
      <div className="card-header"><h3>Client</h3><div className="txt-sm txt-muted">search existing or onboard new</div></div>
      <div className="card-body">
        <div className="role-switcher" style={{ marginBottom:12 }}>
          <button className={data.clientMode==='existing'?'active':''} onClick={()=>patch({clientMode:'existing'})}>Existing client</button>
          <button className={data.clientMode==='new'?'active':''} onClick={()=>patch({clientMode:'new'})}>+ New client</button>
        </div>
        {data.clientMode==='existing' ? (
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:12 }}>
            <WField label="Client" v={data.clientName} asSelect options={['Integrated Market (IFM Pharma)','Panacea','Genica','Biomax','Adexa','Nexus Health','Klix Therapeutics']} set={v=>patch({clientName:v, clientCode:v.slice(0,3).toUpperCase()})}/>
            <WField label="Client code" v={data.clientCode} set={v=>patch({clientCode:v.toUpperCase().slice(0,3)})} mono/>
          </div>
        ) : (
          <Callout tone="info"><span className="txt-sm">Onboarding a new client routes through <b>Master admin → Client onboarding</b> (NDA, MSA, KYC) first. <Btn sm>Open onboarding →</Btn></span></Callout>
        )}
        <div className="hdiv"/>
        <div className="row-spread txt-sm"><span className="txt-muted">NDA on file</span>{data.ndaSigned ? <Badge tone="green" dot>signed</Badge> : <Badge tone="amber" dot>missing</Badge>}</div>
        <div className="row-spread txt-sm"><span className="txt-muted">MSA on file</span>{data.msaSigned ? <Badge tone="green" dot>signed</Badge> : <Badge tone="amber" dot>missing</Badge>}</div>
      </div>
    </div>

    <div className="card">
      <div className="card-header"><h3>Project code &amp; naming</h3><div className="txt-sm txt-muted">codes are the single source of truth · propagate to all workbooks</div></div>
      <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <WField label="Project name" v={data.projectName} set={v=>patch({projectName:v})} placeholder="Diligence Strategy · Phase II"/>
        <WField label="Code name (internal)" v={data.codeName} set={v=>patch({codeName:v})} placeholder="Project GEM"/>
        <div>
          <div className="wl">Project code</div>
          <div className="row gap-sm" style={{ alignItems:'center' }}>
            <input className="wi mono" value={data.projectCode} onChange={e=>patch({projectCode:e.target.value.toUpperCase()})} style={{ width:120 }}/>
            <Btn sm ghost onClick={()=>patch({projectCode:data.clientCode+String(Math.floor(Math.random()*900+100))})}>Suggest</Btn>
            <Badge tone="green" dot>available</Badge>
          </div>
          <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:4 }}>format: <span className="mono">{data.clientCode}001</span> · reserved across all trackers on save</div>
        </div>
        <WField label="Project type" v={data.projectType} set={v=>patch({projectType:v})} asSelect options={['Strategy','Due diligence','Market entry','Portfolio review','Commercial advisory','Retainer','Other']}/>
        <WField label="Start date" v={data.startDate} set={v=>patch({startDate:v})} type="date"/>
        <div>
          <div className="wl">Duration (weeks)</div>
          <input className="wi mono" type="number" value={data.durationWeeks} onChange={e=>patch({durationWeeks:+e.target.value||0})} style={{ width:120 }}/>
          <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:4 }}>used for pro-rata revenue recognition</div>
        </div>
        <WField label="Lead partner" v={data.leadPartner} set={v=>patch({leadPartner:v})} asSelect options={[['TT','TT · Trung (managing)'],['MB','MB · non-op partner'],['SR','SR · associate partner']]}/>
      </div>
    </div>
  </>
);

const Step2Contract = ({ data, patch }) => (
  <>
    <div className="card">
      <div className="card-header"><h3>Contract structure</h3></div>
      <div className="card-body">
        <div className="grid g3" style={{ gap:10 }}>
          {[['fixed','Fixed fee','One total fee · scope-locked'],['t&m','Time & materials','Rate card × hours · cap optional'],['retainer','Retainer','Monthly recurring · rolling']].map(([k,l,d])=>(
            <div key={k} onClick={()=>patch({contractType:k})} style={{ border:`1.5px solid ${data.contractType===k?'var(--brand)':'var(--border)'}`, borderRadius:8, padding:14, cursor:'pointer', background:data.contractType===k?'rgba(30,58,52,0.04)':'transparent' }}>
              <div style={{ fontWeight:600 }}>{l}</div>
              <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:2 }}>{d}</div>
            </div>
          ))}
        </div>
        <div className="hdiv"/>
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 2fr', gap:12 }}>
          <div>
            <div className="wl">Gross fee (contract value)</div>
            <div className="row gap-sm" style={{ alignItems:'center' }}>
              <span className="mono" style={{ color:'var(--text-3)' }}>$</span>
              <input className="wi mono" type="number" value={data.grossFee} onChange={e=>patch({grossFee:+e.target.value||0})}/>
            </div>
          </div>
          <WField label="Currency" v={data.currency} set={v=>patch({currency:v})} asSelect options={['AUD','USD','SGD','EUR','GBP']}/>
          <WField label="Payment schedule" v={data.paymentSchedule} set={v=>patch({paymentSchedule:v})} asSelect options={[
            ['upfront-interim-final','33% upfront · 33% interim · 34% final'],
            ['upfront-final','50% upfront · 50% final'],
            ['monthly','Monthly pro-rata'],
            ['milestone','Milestone-linked'],
          ]}/>
        </div>
      </div>
    </div>

    <div className="card">
      <div className="card-header"><h3>Payment milestones</h3><div className="txt-sm txt-muted">invoices auto-scheduled against these</div></div>
      <table className="tbl">
        <thead><tr><th>#</th><th>Milestone</th><th>Trigger</th><th className="num">% of fee</th><th className="num">Amount</th></tr></thead>
        <tbody>
          <tr><td className="mono">01</td><td>Upfront / kickoff</td><td className="txt-sm">On signature</td><td className="num mono">33%</td><td className="num mono">${Math.round(data.grossFee*0.33).toLocaleString()}</td></tr>
          <tr><td className="mono">02</td><td>Interim report</td><td className="txt-sm">Week 6 · mid-project review</td><td className="num mono">33%</td><td className="num mono">${Math.round(data.grossFee*0.33).toLocaleString()}</td></tr>
          <tr><td className="mono">03</td><td>Final deliverable</td><td className="txt-sm">Sign-off by client</td><td className="num mono">34%</td><td className="num mono">${Math.round(data.grossFee*0.34).toLocaleString()}</td></tr>
        </tbody>
      </table>
    </div>

    <div className="card">
      <div className="card-header"><h3>Legal &amp; tax</h3></div>
      <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <div className="row-spread"><span className="txt-sm">NDA</span>{data.ndaSigned?<Badge tone="green" dot>on file</Badge>:<Btn sm>Generate</Btn>}</div>
        <div className="row-spread"><span className="txt-sm">MSA</span>{data.msaSigned?<Badge tone="green" dot>on file</Badge>:<Btn sm>Generate</Btn>}</div>
        <div className="row-spread"><span className="txt-sm">SOW / engagement letter</span><Btn sm icon="doc">Generate from template</Btn></div>
        <div className="row-spread"><span className="txt-sm">GST treatment</span><Badge dot>10% inc.</Badge></div>
      </div>
    </div>
  </>
);

const Step3Team = ({ data, patch }) => {
  const addLead = () => patch({ leadership:[...data.leadership, { code:'', role:'Partner', fte:0.3, rate:2000, weight:1.0 }] });
  const addDel  = () => patch({ delivery:[...data.delivery, { code:'', role:'Consultant', alloc:'1.0 FTE', rate:800, unit:'/d' }] });
  const rmLead  = (i) => patch({ leadership:data.leadership.filter((_,ii)=>ii!==i) });
  const rmDel   = (i) => patch({ delivery:data.delivery.filter((_,ii)=>ii!==i) });
  const editLead = (i,p) => patch({ leadership:data.leadership.map((r,ii)=>ii===i?{...r,...p}:r) });
  const editDel  = (i,p) => patch({ delivery:data.delivery.map((r,ii)=>ii===i?{...r,...p}:r) });

  return (<>
    <Callout tone="info"><span className="txt-sm">Availability checked against <b>Resource planning</b> over {data.durationWeeks} weeks. <b>JB</b> is already 90% allocated in wks 18–19 — soft conflict.</span></Callout>
    <div className="card">
      <div className="card-header"><h3>Leadership team</h3><div className="txt-sm txt-muted">per-diem model · weighted LT allocation</div></div>
      <div style={{ padding:'4px 18px 16px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'40px 1fr 100px 130px 100px 80px 40px', gap:10, fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-3)', padding:'6px 0', borderBottom:'1px solid var(--divider)' }}>
          <div/><div>Person · role</div><div>FTE</div><div>Day rate</div><div>Weight</div><div className="num">Fees</div><div/>
        </div>
        {data.leadership.map((r,i)=>{
          const fees = Math.round(r.fte*r.rate*5*data.durationWeeks);
          return (
            <div key={i} style={{ display:'grid', gridTemplateColumns:'40px 1fr 100px 130px 100px 80px 40px', gap:10, alignItems:'center', padding:'8px 0', borderBottom:'1px solid var(--divider)' }}>
              <Avatar>{r.code||'??'}</Avatar>
              <div>
                <input className="wi" value={r.code} onChange={e=>editLead(i,{code:e.target.value.toUpperCase()})} style={{ width:60, marginRight:8 }} placeholder="Code"/>
                <input className="wi" value={r.role} onChange={e=>editLead(i,{role:e.target.value})} style={{ width:'calc(100% - 70px)' }}/>
              </div>
              <input className="wi mono" type="number" step="0.1" value={r.fte} onChange={e=>editLead(i,{fte:+e.target.value||0})}/>
              <input className="wi mono" type="number" value={r.rate} onChange={e=>editLead(i,{rate:+e.target.value||0})}/>
              <input className="wi mono" type="number" step="0.1" value={r.weight} onChange={e=>editLead(i,{weight:+e.target.value||0})}/>
              <div className="num mono" style={{ fontWeight:600 }}>${fees.toLocaleString()}</div>
              <Btn sm ghost onClick={()=>rmLead(i)}>✕</Btn>
            </div>
          );
        })}
        <div style={{ marginTop:10 }}><Btn sm icon="plus" ghost onClick={addLead}>Add partner</Btn></div>
      </div>
    </div>

    <div className="card">
      <div className="card-header"><h3>Delivery team</h3></div>
      <div style={{ padding:'4px 18px 16px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'40px 1fr 130px 130px 90px 40px', gap:10, fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-3)', padding:'6px 0', borderBottom:'1px solid var(--divider)' }}>
          <div/><div>Person · role</div><div>Allocation</div><div>Rate</div><div className="num">Fees</div><div/>
        </div>
        {data.delivery.map((r,i)=>{
          const fte = parseFloat((r.alloc||'').split(' ')[0]) || 0.5;
          const hrs = parseFloat((r.alloc||'').split('h')[0]) || 4;
          const fees = r.unit==='/d' ? Math.round(fte*r.rate*5*data.durationWeeks) : Math.round(hrs*r.rate*data.durationWeeks);
          return (
            <div key={i} style={{ display:'grid', gridTemplateColumns:'40px 1fr 130px 130px 90px 40px', gap:10, alignItems:'center', padding:'8px 0', borderBottom:'1px solid var(--divider)' }}>
              <Avatar>{r.code||'??'}</Avatar>
              <div>
                <input className="wi" value={r.code} onChange={e=>editDel(i,{code:e.target.value.toUpperCase()})} style={{ width:60, marginRight:8 }}/>
                <input className="wi" value={r.role} onChange={e=>editDel(i,{role:e.target.value})} style={{ width:'calc(100% - 70px)' }}/>
              </div>
              <input className="wi" value={r.alloc} onChange={e=>editDel(i,{alloc:e.target.value})}/>
              <div className="row gap-sm">
                <input className="wi mono" type="number" value={r.rate} onChange={e=>editDel(i,{rate:+e.target.value||0})} style={{ width:80 }}/>
                <select className="wi mono" value={r.unit} onChange={e=>editDel(i,{unit:e.target.value})} style={{ width:44 }}><option value="/d">/d</option><option value="/h">/h</option></select>
              </div>
              <div className="num mono" style={{ fontWeight:600 }}>${fees.toLocaleString()}</div>
              <Btn sm ghost onClick={()=>rmDel(i)}>✕</Btn>
            </div>
          );
        })}
        <div style={{ marginTop:10 }}><Btn sm icon="plus" ghost onClick={addDel}>Add team member</Btn></div>
      </div>
    </div>
  </>);
};

const Step4Financial = ({ data, patch, calc }) => (<>
  <div className="card">
    <div className="card-header"><h3>Margin model</h3><div className="txt-sm txt-muted">firm defaults · override per project</div></div>
    <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
      <Slider label="OPEX %"         value={data.opexPct}        onChange={v=>patch({opexPct:v})}  min={10} max={30} hint={`$${calc.opexDollars.toLocaleString()}`} />
      <Slider label="Profit pool %"  value={data.profitPoolPct}  onChange={v=>patch({profitPoolPct:v})} min={5} max={30} hint={`$${calc.profitPoolDollars.toLocaleString()}`}/>
      <Slider label="BD referral %"  value={data.bdReferralPct}  onChange={v=>patch({bdReferralPct:v})} min={0} max={10} hint={`$${calc.bdDollars.toLocaleString()}`}/>
    </div>
  </div>

  <div className="card">
    <div className="card-header"><h3>Project expenses budget</h3><div className="txt-sm txt-muted">travel, experts, subs, subscriptions</div></div>
    <div className="card-body">
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <WField label="Travel &amp; accom" v={12000} mono/>
        <WField label="External experts" v={4000} mono/>
        <WField label="Data / subscriptions" v={1500} mono/>
        <WField label="Misc / contingency" v={500} mono/>
      </div>
      <div className="hdiv"/>
      <div className="row-spread"><span className="txt-sm">Total expense budget</span><b className="mono">${data.expenseBudget.toLocaleString()}</b></div>
    </div>
  </div>

  <div className="card">
    <div className="card-header"><h3>Revenue recognition schedule</h3><div className="txt-sm txt-muted">pro-rata over {data.durationWeeks} weeks · smooths dashboard</div></div>
    <div style={{ padding:'12px 18px 18px' }}>
      <div style={{ display:'grid', gridTemplateColumns:`repeat(${Math.min(data.durationWeeks,12)}, 1fr)`, gap:3, alignItems:'end', height:100 }}>
        {Array.from({length:Math.min(data.durationWeeks,12)}).map((_,i)=>(
          <div key={i} style={{ background:'var(--brand)', opacity:0.7, borderRadius:'3px 3px 0 0', height:`${60+Math.sin(i)*10}%`, position:'relative' }} title={`Week ${i+1}: $${Math.round(data.grossFee/data.durationWeeks).toLocaleString()}`}/>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:`repeat(${Math.min(data.durationWeeks,12)}, 1fr)`, gap:3, fontSize:10, fontFamily:'var(--font-mono)', color:'var(--text-3)', textAlign:'center', marginTop:4 }}>
        {Array.from({length:Math.min(data.durationWeeks,12)}).map((_,i)=>(<div key={i}>wk{i+1}</div>))}
      </div>
      <div className="hdiv"/>
      <div className="row-spread txt-sm"><span>Revenue per week (smoothed)</span><b className="mono">${Math.round(data.grossFee/data.durationWeeks).toLocaleString()}/wk</b></div>
    </div>
  </div>
</>);

const Step5Referrals = ({ data, patch }) => {
  const add = () => patch({ referrals:[...data.referrals, { name:'', type:'BD · introducer', pct:3, notes:'' }]});
  const rm = (i) => patch({ referrals:data.referrals.filter((_,ii)=>ii!==i) });
  const edit = (i,p) => patch({ referrals:data.referrals.map((r,ii)=>ii===i?{...r,...p}:r) });
  const totalPct = data.referrals.reduce((a,r)=>a+(+r.pct||0), 0);
  const totalDollars = Math.round(data.grossFee * totalPct/100);

  return (<>
    <div className="card">
      <div className="card-header"><h3>Referrals &amp; attribution</h3><div className="txt-sm txt-muted">internal · external · capped at firm BD %</div></div>
      <div style={{ padding:'4px 18px 16px' }}>
        {data.referrals.map((r,i)=>(
          <div key={i} style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr 100px 2fr 40px', gap:10, alignItems:'center', padding:'10px 0', borderBottom:'1px solid var(--divider)' }}>
            <input className="wi" value={r.name} onChange={e=>edit(i,{name:e.target.value})} placeholder="Person / firm"/>
            <select className="wi" value={r.type} onChange={e=>edit(i,{type:e.target.value})}>
              <option>BD · introducer</option><option>BD · closer</option><option>External referral partner</option><option>Client referral</option>
            </select>
            <div className="row gap-sm">
              <input className="wi mono" type="number" step="0.5" value={r.pct} onChange={e=>edit(i,{pct:+e.target.value||0})} style={{ width:60 }}/>
              <span className="txt-sm txt-muted">%</span>
            </div>
            <input className="wi" value={r.notes} onChange={e=>edit(i,{notes:e.target.value})} placeholder="Context · where introduced · rationale"/>
            <Btn sm ghost onClick={()=>rm(i)}>✕</Btn>
          </div>
        ))}
        <div style={{ marginTop:10 }}><Btn sm icon="plus" ghost onClick={add}>Add referral</Btn></div>
      </div>
      <div className="card-body" style={{ paddingTop:0 }}>
        <div className="row-spread"><span className="txt-sm">Total attribution</span><b className="mono">{totalPct.toFixed(1)}% · ${totalDollars.toLocaleString()}</b></div>
        {totalPct > 5 && <Callout tone="amber"><span className="txt-sm">Total referral attribution exceeds firm cap of 5% · needs Managing Partner sign-off.</span></Callout>}
      </div>
    </div>

    <div className="card">
      <div className="card-header"><h3>LT allocation preview</h3><div className="txt-sm txt-muted">residual to LT pool after project expenses, OPEX, profit pool, referrals</div></div>
      <div className="card-body">
        {data.leadership.map((p,i)=>{
          const totalWeight = data.leadership.reduce((a,r)=>a+r.weight*r.fte, 0);
          const share = (p.weight*p.fte) / totalWeight;
          return (
            <div key={i} className="row-spread" style={{ padding:'6px 0' }}>
              <div className="row gap-sm"><Avatar>{p.code}</Avatar><span className="txt-sm"><b>{p.code}</b> · {p.role} · weight {p.weight}× at {p.fte} FTE</span></div>
              <div className="row gap-sm"><span className="txt-sm mono">{(share*100).toFixed(1)}%</span></div>
            </div>
          );
        })}
      </div>
    </div>
  </>);
};

const Step6Review = ({ data, calc }) => (<>
  <div className="card">
    <div className="card-header"><h3>Review · ready to create</h3><Badge tone="green" dot>validated</Badge></div>
    <div className="card-body">
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
        <div>
          <div className="wl">Client</div><div style={{ fontWeight:600 }}>{data.clientName}</div>
          <div className="hdiv"/>
          <div className="wl">Project</div><div style={{ fontWeight:600 }}>{data.projectName}</div>
          <div className="txt-sm txt-muted">{data.codeName} · {data.projectType}</div>
          <div className="hdiv"/>
          <div className="wl">Code</div><div className="mono" style={{ fontSize:18, fontWeight:600 }}>{data.projectCode}</div>
          <div className="hdiv"/>
          <div className="wl">Timeline</div><div>{data.durationWeeks} weeks · start {data.startDate} · lead <b>{data.leadPartner}</b></div>
        </div>
        <div>
          <div className="wl">Contract</div><div style={{ fontWeight:600 }}>${data.grossFee.toLocaleString()} {data.currency} · {data.contractType}</div>
          <div className="hdiv"/>
          <div className="wl">Team</div><div>{data.leadership.length} partners · {data.delivery.length} delivery</div>
          <div className="hdiv"/>
          <div className="wl">Margin</div><div><b>{calc.marginPct}%</b> · exp {calc.expPct}% · LT residual <b>${calc.ltResidual.toLocaleString()}</b></div>
          <div className="hdiv"/>
          <div className="wl">Referrals</div><div>{data.referrals.length} attributions · {data.referrals.reduce((a,r)=>a+(+r.pct||0),0)}%</div>
        </div>
      </div>
    </div>
  </div>

  <div className="card">
    <div className="card-header"><h3>Pre-flight checks</h3></div>
    <table className="tbl">
      <tbody>
        {[
          ['NDA on file',            data.ndaSigned, 'green','signed'],
          ['MSA on file',            data.msaSigned, 'green','signed'],
          ['Project code available', true, 'green','IFM002 reserved'],
          ['Team availability',      true, 'amber','JB soft-conflict wk 18–19'],
          ['Margin > 30%',           calc.marginPct>=30, calc.marginPct>=30?'green':'amber', `${calc.marginPct}%`],
          ['Referral cap ≤ 5%',      data.referrals.reduce((a,r)=>a+r.pct,0)<=5, 'green','within cap'],
          ['Budget has contingency', true, 'green','≥ 3%'],
        ].map((r,i)=>(
          <tr key={i}>
            <td className="txt-sm" style={{ width:'55%' }}>{r[0]}</td>
            <td><Badge tone={r[2]} dot>{r[3]}</Badge></td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>

  <div className="card">
    <div className="card-header"><h3>Auto-generated on finish</h3></div>
    <div className="card-body">
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
        {[
          ['SOW / engagement letter','from MSA template · v5.0'],
          ['Project folder','/Clients/IFM/IFM002/'],
          ['Financial tracker','IFM002 Financial Tracker.xlsx'],
          ['ClickUp space','IFM002 · 52-task checklist seeded'],
          ['WhatsApp group','IFM002 · team invited'],
          ['Kickoff materials','brief + problem statement draft'],
          ['Timesheet column','new column in Timesheet.xlsx'],
          ['Invoice schedule','3 invoices queued per milestones'],
        ].map((r,i)=>(
          <div key={i} className="row gap-sm" style={{ fontSize:12, padding:'6px 0' }}>
            <Icon name="check" size={14}/>
            <div><b>{r[0]}</b> <span className="txt-muted" style={{ fontSize:11 }}>· {r[1]}</span></div>
          </div>
        ))}
      </div>
    </div>
  </div>
</>);

// ========== RIGHT RAIL ==========
const WizardLiveSummary = ({ data, calc }) => (
  <div className="card">
    <div className="card-header"><h3>Live budget</h3><XlsxPill state="synced">preview</XlsxPill></div>
    <div className="card-body">
      <div style={{ fontFamily:'var(--font-serif)', fontSize:34, fontWeight:400, letterSpacing:'-0.01em' }}>${calc.contractValue.toLocaleString()}</div>
      <div className="txt-sm txt-muted">gross fee · {data.durationWeeks} weeks · ${Math.round(calc.contractValue/data.durationWeeks).toLocaleString()}/wk recognised</div>
      <div className="hdiv"/>
      <div className="list">
        <div className="list-item"><div className="main">Project expenses</div><div className="right"><b className="mono">${calc.projectExpenses.toLocaleString()}</b> · {calc.expPct}%</div></div>
        <div className="list-item"><div className="main">– OPEX ({data.opexPct}%)</div><div className="right mono">${calc.opexDollars.toLocaleString()}</div></div>
        <div className="list-item"><div className="main">– Profit pool ({data.profitPoolPct}%)</div><div className="right mono">${calc.profitPoolDollars.toLocaleString()}</div></div>
        <div className="list-item"><div className="main">– BD referral ({data.bdReferralPct}%)</div><div className="right mono">${calc.bdDollars.toLocaleString()}</div></div>
        <div className="list-item"><div className="main"><b>LT residual share</b></div><div className="right"><b className="mono">${calc.ltResidual.toLocaleString()}</b></div></div>
      </div>
      <div className="hdiv"/>
      <div className="row-spread"><span className="txt-sm">Contribution margin</span><b className="mono" style={{ color: calc.marginPct>=30?'var(--green)':'var(--amber)' }}>{calc.marginPct}%</b></div>
      {calc.expPct > 55 && <Callout tone="warn"><span className="txt-sm">Expenses {calc.expPct}% &gt; 55% · reduce rates or re-weight.</span></Callout>}
    </div>
  </div>
);

const WizardPropagationPanel = ({ code, step }) => (
  <div className="card">
    <div className="card-header"><h3>On save, <span className="mono">{code}</span> propagates to</h3></div>
    <div className="card-body">
      <div className="stack" style={{ gap:6 }}>
        {[
          ['Finance.xlsx', step>=1],
          ['Timesheet.xlsx (new column)', step>=2],
          ['Invoices register', step>=1],
          ['Pipeline.xlsx → Won', step>=0],
          ['Resource planning grid', step>=2],
          ['ClickUp + folder structure', step>=3],
        ].map(([t,live],i)=>(
          <div key={i} className="row gap-sm txt-sm" style={{ opacity: live?1:0.4 }}>
            <span style={{ width:14, height:14, borderRadius:3, border:'1px solid var(--border)', background:live?'var(--brand)':'transparent', display:'inline-flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:9 }}>{live?'✓':''}</span>
            <span>{t}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// Tiny field + slider primitives (scoped)
const WField = ({ label, v, set, placeholder, mono, multi, asSelect, options, type }) => (
  <div>
    <div className="wl">{label}</div>
    {asSelect ? (
      <select className={`wi ${mono?'mono':''}`} value={v} onChange={e=>set && set(e.target.value)}>
        {(options||[]).map((o,i)=> Array.isArray(o) ? <option key={i} value={o[0]}>{o[1]}</option> : <option key={i} value={o}>{o}</option>)}
      </select>
    ) : multi ? (
      <textarea className="wi" value={v} onChange={e=>set && set(e.target.value)} placeholder={placeholder} rows={3}/>
    ) : (
      <input className={`wi ${mono?'mono':''}`} value={v} type={type||'text'} onChange={e=>set && set(e.target.value)} placeholder={placeholder}/>
    )}
  </div>
);

const Slider = ({ label, value, onChange, min, max, hint }) => (
  <div>
    <div className="row-spread"><span className="wl" style={{ margin:0 }}>{label}</span><b className="mono">{value}%</b></div>
    <input type="range" min={min} max={max} value={value} onChange={e=>onChange(+e.target.value)} style={{ width:'100%', marginTop:6 }}/>
    <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:2 }}>{hint}</div>
  </div>
);

// Styles for wizard inputs (inject once)
if (!document.getElementById('wiz-styles')) {
  const s = document.createElement('style');
  s.id = 'wiz-styles';
  s.textContent = `
    .wl { font-size: 10px; text-transform: uppercase; letter-spacing:.06em; color: var(--text-3); margin-bottom: 4px; font-weight: 600; }
    .wi { width: 100%; padding: 7px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; font-family: inherit; background: var(--bg); }
    .wi.mono { font-family: var(--font-mono); }
    .wi:focus { outline: none; border-color: var(--brand); }
    textarea.wi { resize: vertical; }
  `;
  document.head.appendChild(s);
}

Object.assign(window, { NewProjectWizard });
