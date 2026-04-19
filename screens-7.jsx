// ============ SELF-INVOICE (contractor → Foundry) ============
// Contractor/staff generates an invoice to Foundry Health from their approved timesheet.

const SelfInvoice = () => {
  const [period, setPeriod] = React.useState('apr2');  // half-month
  const [includeExpenses, setIncludeExpenses] = React.useState(true);
  const [stage, setStage] = React.useState('compose'); // compose | preview | submitted

  // Mock: person context (AP contractor)
  const me = {
    code:'AP', name:'Alex Park', entity:'Alex Park Consulting Pty Ltd',
    abn:'22 456 789 012', gst:true,
    bank:{ bsb:'062-000', acct:'1234 5678', name:'Alex Park Consulting' },
    rate: 145, // AUD/hr
    address:'Level 3 / 88 Liverpool St, Sydney NSW 2000',
  };

  // Approved timesheet lines for selected period (half-month: 14–25 Apr)
  const lines = [
    { date:'Mon 14 Apr', project:'IFM001', desc:'Diligence · market sizing',  hours:8, approved:true },
    { date:'Tue 15 Apr', project:'IFM001', desc:'Expert call synthesis',       hours:7, approved:true },
    { date:'Wed 16 Apr', project:'PNC001', desc:'Panacea · interview guide',   hours:4, approved:true },
    { date:'Wed 16 Apr', project:'IFM001', desc:'Model build',                 hours:4, approved:true },
    { date:'Thu 17 Apr', project:'IFM001', desc:'Slide review prep',           hours:8, approved:true },
    { date:'Fri 18 Apr', project:'PNC001', desc:'Expert call · reimbursement', hours:4, approved:true },
    { date:'Fri 18 Apr', project:'FHO003', desc:'Firm · learning (non-bill)',  hours:2, approved:true, internal:true },
    { date:'Mon 21 Apr', project:'IFM001', desc:'Kickoff II attendance',       hours:6, approved:true },
    { date:'Tue 22 Apr', project:'PNC001', desc:'Expert call',                 hours:5, approved:true },
    { date:'Wed 23 Apr', project:'IFM001', desc:'Slide review',                hours:7, approved:true },
    { date:'Thu 24 Apr', project:'IFM001', desc:'Workshop facilitation',       hours:8, approved:true },
    { date:'Fri 25 Apr', project:'PNC001', desc:'Market entry synthesis',      hours:6, approved:false }, // not yet approved
  ];

  // Approved expenses for period
  const expenses = [
    { date:'14 Apr', merchant:'Qantas SYD→MEL',   project:'IFM001', cat:'Travel',     amt:418, receipt:true, approved:true },
    { date:'15 Apr', merchant:'Ovolo Hotel',       project:'IFM001', cat:'Accom',      amt:240, receipt:true, approved:true },
    { date:'16 Apr', merchant:'Client dinner 4pax',project:'PNC001', cat:'M&E',        amt:318, receipt:false, approved:false }, // blocker
    { date:'23 Apr', merchant:'Cabcharge · Sydney',project:'IFM001', cat:'Travel',     amt: 52, receipt:true, approved:true },
  ];

  const [selectedLines, setSelectedLines] = React.useState(() => lines.map((l,i)=>l.approved && !l.internal));
  const [selectedExp, setSelectedExp] = React.useState(() => expenses.map(e=>e.approved));

  const includedLines = lines.map((l,i)=>({...l, _sel:selectedLines[i]})).filter(l=>l._sel);
  const includedExp = expenses.map((e,i)=>({...e, _sel:selectedExp[i]})).filter(e=>e._sel);

  // Group lines by project for invoice display
  const byProject = {};
  includedLines.forEach(l => {
    byProject[l.project] = byProject[l.project] || { project:l.project, hours:0, items:[] };
    byProject[l.project].hours += l.hours;
    byProject[l.project].items.push(l);
  });

  const totalHours = includedLines.reduce((a,l)=>a+l.hours, 0);
  const feesSubtotal = totalHours * me.rate;
  const expSubtotal = includeExpenses ? includedExp.reduce((a,e)=>a+e.amt, 0) : 0;
  const subtotal = feesSubtotal + expSubtotal;
  const gst = me.gst ? subtotal * 0.10 : 0;
  const total = subtotal + gst;

  const invNum = 'APC-2026-018';
  const issueDate = '25 Apr 2026';
  const dueDate = '9 May 2026';

  const pendingLines = lines.filter(l => !l.approved && !l.internal).length;
  const pendingExp = expenses.filter(e => !e.approved).length;

  if (stage === 'submitted') return <SubmittedView invNum={invNum} total={total} onReset={()=>setStage('compose')} />;

  return (<>
    <div className="row" style={{ marginBottom:14, flexWrap:'wrap', gap:10 }}>
      <div>
        <div className="txt-sm txt-muted">{me.name} · {me.entity} · ABN {me.abn}</div>
        <h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, margin:'2px 0 0' }}>Generate invoice to Foundry</h2>
      </div>
      <div className="ml-auto row gap-sm">
        <div className="role-switcher">
          {[['apr1','1–13 Apr'],['apr2','14–25 Apr'],['may1','26 Apr–10 May']].map(([k,l])=>(<button key={k} className={period===k?'active':''} onClick={()=>setPeriod(k)}>{l}</button>))}
        </div>
        <Btn sm ghost icon="settings">My billing profile</Btn>
      </div>
    </div>

    {(pendingLines>0 || (pendingExp>0 && includeExpenses)) && (
      <Callout tone="amber">
        <div className="row-spread">
          <span className="txt-sm"><b>{pendingLines}</b> timesheet line{pendingLines!==1?'s':''} and <b>{pendingExp}</b> expense{pendingExp!==1?'s':''} are still pending approval — they're excluded. Chase approvers or invoice now and roll unapproved items into next period.</span>
          <div className="row gap-sm"><Btn sm>Nudge approvers</Btn></div>
        </div>
      </Callout>
    )}

    <div className="grid g-main-side">
      <div className="stack">
        {/* Step 1: fees from timesheet */}
        <div className="card">
          <div className="card-header">
            <h3>① Fees · approved timesheet lines</h3>
            <div className="txt-sm txt-muted">auto-pulled · rate <b className="mono">${me.rate}/hr</b> · toggle to exclude</div>
          </div>
          <table className="tbl">
            <thead><tr><th style={{ width:32 }}></th><th>Date</th><th>Project</th><th>Description</th><th className="num">Hours</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {lines.map((l,i)=>{
                const disabled = !l.approved || l.internal;
                return (
                  <tr key={i} style={{ opacity: disabled ? 0.45 : 1 }}>
                    <td><input type="checkbox" disabled={disabled} checked={selectedLines[i]} onChange={e=>{const n=[...selectedLines];n[i]=e.target.checked;setSelectedLines(n);}}/></td>
                    <td className="txt-sm">{l.date}</td>
                    <td className="code-cell"><b>{l.project}</b></td>
                    <td className="txt-sm">{l.desc}</td>
                    <td className="num mono">{l.hours}</td>
                    <td className="num mono">${(l.hours*me.rate).toLocaleString()}</td>
                    <td>
                      {l.internal ? <Badge tone="">non-billable</Badge>
                        : l.approved ? <Badge tone="green" dot>approved</Badge>
                        : <Badge tone="amber" dot>pending</Badge>}
                    </td>
                  </tr>
                );
              })}
              <tr className="total-row">
                <td colSpan={4}>Fees subtotal · {totalHours}h @ ${me.rate}</td>
                <td className="num mono">{totalHours}h</td>
                <td className="num mono"><b>${feesSubtotal.toLocaleString()}</b></td>
                <td/>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Step 2: expenses */}
        <div className="card">
          <div className="card-header">
            <h3>② Reimbursable expenses</h3>
            <label className="row gap-sm" style={{ fontSize:12, cursor:'pointer' }}>
              <input type="checkbox" checked={includeExpenses} onChange={e=>setIncludeExpenses(e.target.checked)}/>
              <span>Include approved expenses on this invoice</span>
            </label>
          </div>
          {includeExpenses ? (
            <table className="tbl">
              <thead><tr><th style={{ width:32 }}></th><th>Date</th><th>Merchant</th><th>Project</th><th>Category</th><th className="num">Amount</th><th>Receipt</th><th>Status</th></tr></thead>
              <tbody>
                {expenses.map((e,i)=>{
                  const disabled = !e.approved;
                  return (
                    <tr key={i} style={{ opacity: disabled ? 0.45 : 1 }}>
                      <td><input type="checkbox" disabled={disabled} checked={selectedExp[i]} onChange={ev=>{const n=[...selectedExp];n[i]=ev.target.checked;setSelectedExp(n);}}/></td>
                      <td className="txt-sm">{e.date}</td>
                      <td>{e.merchant}</td>
                      <td className="code-cell"><b>{e.project}</b></td>
                      <td><Badge>{e.cat}</Badge></td>
                      <td className="num mono">${e.amt.toLocaleString()}</td>
                      <td>{e.receipt ? '✓' : <span style={{ color:'var(--red)' }}>—</span>}</td>
                      <td>{e.approved ? <Badge tone="green" dot>approved</Badge> : <Badge tone="red" dot>blocked</Badge>}</td>
                    </tr>
                  );
                })}
                <tr className="total-row">
                  <td colSpan={5}>Expenses subtotal</td>
                  <td className="num mono"><b>${expSubtotal.toLocaleString()}</b></td>
                  <td colSpan={2}/>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="card-body"><div className="txt-sm txt-muted">Expenses will be claimed separately via expense report.</div></div>
          )}
        </div>

        {/* Step 3: invoice details */}
        <div className="card">
          <div className="card-header"><h3>③ Invoice details</h3><div className="txt-sm txt-muted">review before generating PDF</div></div>
          <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <div>
              <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em' }}>Invoice #</div>
              <div className="mono" style={{ fontSize:15, fontWeight:600 }}>{invNum}</div>
              <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:2 }}>auto-generated, sequential</div>
            </div>
            <div>
              <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em' }}>Issue date</div>
              <div style={{ fontWeight:600 }}>{issueDate}</div>
            </div>
            <div>
              <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em' }}>Payment terms</div>
              <div style={{ fontWeight:600 }}>Net 14 · due {dueDate}</div>
            </div>
            <div>
              <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em' }}>Billing to</div>
              <div style={{ fontWeight:600 }}>Foundry Health Pty Ltd</div>
              <div className="txt-sm txt-muted" style={{ fontSize:11 }}>accounts@foundry.health · ABN 44 123 456 789</div>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4 }}>Memo (optional)</div>
              <input defaultValue="Professional services · 14–25 Apr 2026" style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontFamily:'inherit', fontSize:13 }}/>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky summary + actions */}
      <div className="stack">
        <div className="card">
          <div className="card-header"><h3>Summary</h3></div>
          <div className="card-body">
            <div className="row-spread" style={{ marginBottom:4 }}><span className="txt-sm">Fees · {totalHours}h</span><b className="mono">${feesSubtotal.toLocaleString()}</b></div>
            {Object.values(byProject).map(p=>(
              <div key={p.project} className="row-spread" style={{ fontSize:11, color:'var(--text-3)', paddingLeft:10 }}>
                <span className="mono">{p.project}</span><span>{p.hours}h · ${(p.hours*me.rate).toLocaleString()}</span>
              </div>
            ))}
            {includeExpenses && (<div className="row-spread" style={{ marginTop:6 }}><span className="txt-sm">Expenses · {includedExp.length} item{includedExp.length!==1?'s':''}</span><b className="mono">${expSubtotal.toLocaleString()}</b></div>)}
            <div className="hdiv"/>
            <div className="row-spread"><span className="txt-sm">Subtotal</span><b className="mono">${subtotal.toLocaleString()}</b></div>
            {me.gst && <div className="row-spread"><span className="txt-sm">GST · 10%</span><b className="mono">${gst.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</b></div>}
            <div className="hdiv"/>
            <div className="row-spread" style={{ alignItems:'baseline' }}>
              <span style={{ fontFamily:'var(--font-serif)', fontSize:17 }}>Total</span>
              <b className="mono" style={{ fontSize:22 }}>${total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</b>
            </div>
            <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:2, textAlign:'right' }}>AUD · inc. GST</div>
            <div className="hdiv"/>
            <Btn primary lg onClick={()=>setStage('preview')}>Preview invoice PDF</Btn>
            <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:8 }}>Generates a PDF invoice from your billing profile and attaches the timesheet & receipts.</div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>Pay to</h3></div>
          <div className="card-body">
            <div className="txt-sm"><b>{me.bank.name}</b></div>
            <div className="txt-sm txt-muted" style={{ fontSize:11 }}>BSB <span className="mono">{me.bank.bsb}</span> · Acct <span className="mono">{me.bank.acct}</span></div>
            <div className="hdiv"/>
            <Btn sm ghost>Edit billing profile</Btn>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>Recent invoices</h3></div>
          <div className="list">
            {[
              ['APC-2026-017','1–13 Apr 2026','$10,730','paid','green','paid 22 Apr'],
              ['APC-2026-016','Mar 2026',     '$18,420','paid','green','paid 8 Apr'],
              ['APC-2026-015','Feb 2026',     '$16,960','paid','green','paid 10 Mar'],
            ].map((r,i)=>(
              <div key={i} className="list-item">
                <div className="main">
                  <div><span className="mono txt-sm" style={{ fontWeight:600 }}>{r[0]}</span></div>
                  <div className="txt-sm txt-muted" style={{ fontSize:11 }}>{r[1]} · {r[5]}</div>
                </div>
                <div className="right row gap-sm"><b className="mono">{r[2]}</b><Badge tone={r[4]} dot>{r[3]}</Badge></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>

    {stage === 'preview' && <InvoicePreviewModal
      me={me}
      invNum={invNum} issueDate={issueDate} dueDate={dueDate}
      byProject={byProject} includedExp={includedExp} includeExpenses={includeExpenses}
      feesSubtotal={feesSubtotal} expSubtotal={expSubtotal} gst={gst} subtotal={subtotal} total={total}
      totalHours={totalHours}
      onCancel={()=>setStage('compose')}
      onSubmit={()=>setStage('submitted')}
    />}
  </>);
};

// ---------- Invoice PDF preview modal ----------
const InvoicePreviewModal = (props) => {
  const { me, invNum, issueDate, dueDate, byProject, includedExp, includeExpenses, feesSubtotal, expSubtotal, gst, subtotal, total, totalHours, onCancel, onSubmit } = props;

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(30,28,24,0.55)', zIndex:50, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }} onClick={onCancel}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'var(--bg)', borderRadius:10, width:'min(920px, 100%)', maxHeight:'92vh', overflow:'hidden', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--divider)', display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ flex:1 }}>
            <div className="txt-sm txt-muted" style={{ fontSize:11 }}>preview · ready to submit</div>
            <h3 style={{ margin:0, fontFamily:'var(--font-serif)', fontSize:18, fontWeight:400 }}>Invoice {invNum}</h3>
          </div>
          <Btn sm ghost icon="doc">Download PDF</Btn>
          <Btn sm ghost onClick={onCancel}>Back to edit</Btn>
          <Btn sm primary onClick={onSubmit}>Submit to Foundry</Btn>
        </div>

        {/* PDF-ish page */}
        <div style={{ overflow:'auto', background:'var(--bg-subtle)', padding:20 }}>
          <div style={{ background:'#fff', padding:'40px 44px', width:'100%', maxWidth:720, margin:'0 auto', boxShadow:'0 2px 12px rgba(0,0,0,0.08)', fontSize:12, color:'var(--text)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:28 }}>
              <div>
                <div style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, letterSpacing:'-0.01em' }}>Tax invoice</div>
                <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--text-3)', marginTop:4 }}>{invNum}</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontWeight:600, fontSize:13 }}>{me.entity}</div>
                <div style={{ fontSize:11, color:'var(--text-3)', marginTop:2 }}>{me.address}</div>
                <div style={{ fontSize:11, color:'var(--text-3)' }}>ABN {me.abn}</div>
              </div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24, marginBottom:24, paddingBottom:20, borderBottom:'1px solid #e8e2d6' }}>
              <div>
                <div style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--text-3)', marginBottom:4 }}>Billed to</div>
                <div style={{ fontWeight:600 }}>Foundry Health Pty Ltd</div>
                <div style={{ fontSize:11, color:'var(--text-3)' }}>accounts@foundry.health</div>
                <div style={{ fontSize:11, color:'var(--text-3)' }}>ABN 44 123 456 789</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ display:'grid', gridTemplateColumns:'auto auto', gap:'4px 14px', justifyContent:'flex-end', fontSize:11 }}>
                  <span style={{ color:'var(--text-3)' }}>Issue date</span><b>{issueDate}</b>
                  <span style={{ color:'var(--text-3)' }}>Due date</span><b>{dueDate}</b>
                  <span style={{ color:'var(--text-3)' }}>Terms</span><span>Net 14</span>
                  <span style={{ color:'var(--text-3)' }}>Period</span><span>14–25 Apr 2026</span>
                </div>
              </div>
            </div>

            {/* Fees by project */}
            <div style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--text-3)', marginBottom:8 }}>Professional fees</div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead>
                <tr style={{ borderBottom:'1px solid #e8e2d6' }}>
                  <th style={{ textAlign:'left', padding:'6px 0', color:'var(--text-3)', fontWeight:500 }}>Project</th>
                  <th style={{ textAlign:'left', padding:'6px 0', color:'var(--text-3)', fontWeight:500 }}>Description</th>
                  <th style={{ textAlign:'right', padding:'6px 0', color:'var(--text-3)', fontWeight:500 }}>Hours</th>
                  <th style={{ textAlign:'right', padding:'6px 0', color:'var(--text-3)', fontWeight:500 }}>Rate</th>
                  <th style={{ textAlign:'right', padding:'6px 0', color:'var(--text-3)', fontWeight:500 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(byProject).map(p=>(
                  <tr key={p.project} style={{ borderBottom:'1px solid #f2ede1' }}>
                    <td style={{ padding:'10px 0', verticalAlign:'top' }}><b className="mono" style={{ fontSize:11 }}>{p.project}</b></td>
                    <td style={{ padding:'10px 0', verticalAlign:'top', paddingRight:10 }}>
                      {p.items.map((it,ii)=>(<div key={ii} style={{ fontSize:11, color:'var(--text-2)' }}>{it.date.replace(/^[A-Za-z]{3} /,'')} · {it.desc}</div>))}
                    </td>
                    <td style={{ padding:'10px 0', textAlign:'right', fontFamily:'var(--font-mono)', verticalAlign:'top' }}>{p.hours}</td>
                    <td style={{ padding:'10px 0', textAlign:'right', fontFamily:'var(--font-mono)', verticalAlign:'top' }}>${me.rate}</td>
                    <td style={{ padding:'10px 0', textAlign:'right', fontFamily:'var(--font-mono)', verticalAlign:'top' }}>${(p.hours*me.rate).toLocaleString()}</td>
                  </tr>
                ))}
                <tr><td colSpan={2} style={{ padding:'8px 0', textAlign:'right', color:'var(--text-3)' }}>Fees subtotal</td><td style={{ padding:'8px 0', textAlign:'right', fontFamily:'var(--font-mono)' }}>{totalHours}</td><td/><td style={{ padding:'8px 0', textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:600 }}>${feesSubtotal.toLocaleString()}</td></tr>
              </tbody>
            </table>

            {includeExpenses && includedExp.length>0 && (<>
              <div style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--text-3)', margin:'20px 0 8px' }}>Reimbursable expenses</div>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                <thead><tr style={{ borderBottom:'1px solid #e8e2d6' }}>
                  <th style={{ textAlign:'left', padding:'6px 0', color:'var(--text-3)', fontWeight:500 }}>Date</th>
                  <th style={{ textAlign:'left', padding:'6px 0', color:'var(--text-3)', fontWeight:500 }}>Merchant</th>
                  <th style={{ textAlign:'left', padding:'6px 0', color:'var(--text-3)', fontWeight:500 }}>Project</th>
                  <th style={{ textAlign:'left', padding:'6px 0', color:'var(--text-3)', fontWeight:500 }}>Category</th>
                  <th style={{ textAlign:'right', padding:'6px 0', color:'var(--text-3)', fontWeight:500 }}>Amount</th>
                </tr></thead>
                <tbody>
                  {includedExp.map((e,i)=>(
                    <tr key={i} style={{ borderBottom:'1px solid #f2ede1' }}>
                      <td style={{ padding:'8px 0' }}>{e.date}</td>
                      <td style={{ padding:'8px 0' }}>{e.merchant}</td>
                      <td style={{ padding:'8px 0', fontFamily:'var(--font-mono)' }}>{e.project}</td>
                      <td style={{ padding:'8px 0' }}>{e.cat}</td>
                      <td style={{ padding:'8px 0', textAlign:'right', fontFamily:'var(--font-mono)' }}>${e.amt.toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr><td colSpan={4} style={{ padding:'8px 0', textAlign:'right', color:'var(--text-3)' }}>Expenses subtotal</td><td style={{ padding:'8px 0', textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:600 }}>${expSubtotal.toLocaleString()}</td></tr>
                </tbody>
              </table>
            </>)}

            {/* Totals */}
            <div style={{ marginTop:24, paddingTop:12, borderTop:'2px solid var(--text)', display:'flex', justifyContent:'flex-end' }}>
              <div style={{ width:260 }}>
                <div style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', fontSize:11 }}><span style={{ color:'var(--text-3)' }}>Subtotal</span><span className="mono">${subtotal.toLocaleString()}</span></div>
                {me.gst && <div style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', fontSize:11 }}><span style={{ color:'var(--text-3)' }}>GST · 10%</span><span className="mono">${gst.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>}
                <div style={{ display:'flex', justifyContent:'space-between', padding:'10px 0 0', borderTop:'1px solid #e8e2d6', marginTop:6, alignItems:'baseline' }}>
                  <span style={{ fontFamily:'var(--font-serif)', fontSize:16 }}>Total due</span>
                  <b className="mono" style={{ fontSize:20 }}>${total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</b>
                </div>
                <div style={{ textAlign:'right', fontSize:10, color:'var(--text-3)', marginTop:2 }}>AUD · inc. GST</div>
              </div>
            </div>

            {/* Pay to */}
            <div style={{ marginTop:28, paddingTop:14, borderTop:'1px solid #e8e2d6' }}>
              <div style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--text-3)', marginBottom:6 }}>Payment details</div>
              <div style={{ fontSize:11 }}><b>{me.bank.name}</b> · BSB <span className="mono">{me.bank.bsb}</span> · Acct <span className="mono">{me.bank.acct}</span></div>
              <div style={{ fontSize:11, color:'var(--text-3)', marginTop:2 }}>Please reference invoice number on payment · Net 14 · due {dueDate}</div>
            </div>

            <div style={{ marginTop:28, fontSize:10, color:'var(--text-3)', textAlign:'center' }}>Generated via Foundry Ops · attaches: approved timesheet (12 lines) · {includedExp.length} receipt{includedExp.length!==1?'s':''}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

const SubmittedView = ({ invNum, total, onReset }) => (
  <div style={{ maxWidth:620, margin:'80px auto', textAlign:'center' }}>
    <div style={{ width:64, height:64, borderRadius:'50%', background:'rgba(107,140,62,0.15)', color:'var(--green)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', fontSize:32 }}>✓</div>
    <h2 style={{ fontFamily:'var(--font-serif)', fontSize:28, fontWeight:400, margin:'0 0 6px' }}>Invoice submitted</h2>
    <div className="txt-sm txt-muted" style={{ marginBottom:20 }}><b className="mono">{invNum}</b> · ${total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} AUD · sent to Foundry accounts</div>
    <div className="card" style={{ textAlign:'left', marginBottom:18 }}>
      <div className="card-body">
        <div className="row-spread" style={{ padding:'6px 0' }}><span className="txt-sm"><Badge tone="green" dot>sent</Badge> Emailed to <span className="mono">accounts@foundry.health</span></span><span className="txt-sm txt-muted">just now</span></div>
        <div className="row-spread" style={{ padding:'6px 0' }}><span className="txt-sm"><Badge dot>queued</Badge> Awaiting office manager match against timesheet</span><span className="txt-sm txt-muted">est. 1 biz day</span></div>
        <div className="row-spread" style={{ padding:'6px 0' }}><span className="txt-sm"><Badge dot>queued</Badge> Partner approval (auto · timesheet pre-approved)</span><span className="txt-sm txt-muted">est. 2 biz days</span></div>
        <div className="row-spread" style={{ padding:'6px 0' }}><span className="txt-sm"><Badge dot>scheduled</Badge> Payment run</span><span className="txt-sm txt-muted">Net 14 · 9 May</span></div>
      </div>
    </div>
    <div className="row gap-sm" style={{ justifyContent:'center' }}>
      <Btn ghost icon="doc">Download PDF</Btn>
      <Btn onClick={onReset}>Back to invoices</Btn>
    </div>
  </div>
);

Object.assign(window, { SelfInvoice });
