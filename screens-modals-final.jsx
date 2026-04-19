// screens-modals-final.jsx
// Final set of modal / drawer / inline flows to close out loops in the prototype.
// - AddSupplierWizard       (Directory · Suppliers)
// - AddExpenseModal         (reusable · quick expense from anywhere)
// - ApproveInvoiceDrawer    (click-through from Approvals)
// - ApproveTimesheetDrawer  (click-through from Approvals)
// - ApproveExpenseDrawer    (click-through from Approvals)
// - EditScopeModal          (Project · Contracts tab)
// - AddDeliverableModal     (Project · PL / Team tab)
// - AddTeamMemberModal      (Project · Team tab)

// ============ Modal shell ============
const ModalShell = ({ onClose, children, maxWidth=760, title, subtitle, right }) => (
  <div style={{ position:'fixed', inset:0, background:'rgba(14,12,10,.55)', zIndex:90, display:'flex', alignItems:'center', justifyContent:'center', padding:40 }} onClick={onClose}>
    <div className="card" style={{ maxWidth, width:'100%', maxHeight:'90vh', display:'flex', flexDirection:'column' }} onClick={e=>e.stopPropagation()}>
      {(title || subtitle) && (
        <div className="card-header">
          <div>
            {subtitle && <div className="txt-sm txt-muted">{subtitle}</div>}
            {title && <h3 style={{ margin:'2px 0 0' }}>{title}</h3>}
          </div>
          <div className="row gap-sm">
            {right}
            <Btn sm ghost onClick={onClose}>✕</Btn>
          </div>
        </div>
      )}
      <div style={{ overflow:'auto', flex:1 }}>
        {children}
      </div>
    </div>
  </div>
);

// ---- Drawer from right ----
const DrawerShell = ({ onClose, children, width=520, title, subtitle, right, footer }) => (
  <div style={{ position:'fixed', inset:0, background:'rgba(14,12,10,.45)', zIndex:90 }} onClick={onClose}>
    <div style={{ position:'absolute', top:0, right:0, bottom:0, width, maxWidth:'96vw', background:'var(--bg)', borderLeft:'1px solid var(--border)', display:'flex', flexDirection:'column', boxShadow:'-10px 0 30px rgba(0,0,0,.15)' }} onClick={e=>e.stopPropagation()}>
      {(title || subtitle) && (
        <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--divider)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
          <div>
            {subtitle && <div className="txt-sm txt-muted">{subtitle}</div>}
            {title && <div style={{ fontFamily:'var(--font-serif)', fontSize:18, fontWeight:500, marginTop:2 }}>{title}</div>}
          </div>
          <div className="row gap-sm">
            {right}
            <Btn sm ghost onClick={onClose}>✕</Btn>
          </div>
        </div>
      )}
      <div style={{ overflow:'auto', flex:1 }}>{children}</div>
      {footer && (
        <div style={{ padding:'12px 18px', borderTop:'1px solid var(--divider)', background:'var(--bg-subtle)' }}>
          {footer}
        </div>
      )}
    </div>
  </div>
);

// ============ 1. AddSupplierWizard ============
const AddSupplierWizard = ({ onClose, onFinish }) => {
  const [step, setStep] = React.useState(0);
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState('project');
  const [category, setCategory] = React.useState('Experts');
  const [abn, setAbn] = React.useState('');
  const [contact, setContact] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [terms, setTerms] = React.useState('Net 30');
  const [bankBsb, setBankBsb] = React.useState('');
  const [bankAcct, setBankAcct] = React.useState('');
  const [w9, setW9] = React.useState(false);
  const [wht, setWht] = React.useState('none');

  const steps = ['Identity', 'Contact & terms', 'Banking & compliance', 'Review'];

  const canNext =
    (step===0 && name.trim().length>1) ||
    (step===1 && contact && email) ||
    (step===2) ||
    step===3;

  return (
    <ModalShell
      onClose={onClose}
      maxWidth={820}
      subtitle={`Add supplier · step ${step+1} of ${steps.length}`}
      title={name.trim() || 'New supplier'}
    >
      {/* Progress */}
      <div style={{ padding:'0 22px 6px' }}>
        <div className="row" style={{ gap:6, marginBottom:14 }}>
          {steps.map((s,i)=>(
            <div key={s} style={{ flex:1, padding:'6px 10px', borderRadius:4, background: i<=step?'var(--brand)':'var(--bg-subtle)', color: i<=step?'#fff':'var(--text-3)', fontSize:11, fontWeight:600, letterSpacing:'.04em', textTransform:'uppercase' }}>
              <span className="mono" style={{ marginRight:6, opacity:.6 }}>{String(i+1).padStart(2,'0')}</span>{s}
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding:'10px 22px 18px' }}>
        {step===0 && (
          <div className="grid g2" style={{ gap:14 }}>
            <div style={{ gridColumn:'1 / -1' }}>
              <div className="txt-sm" style={{ fontWeight:600, marginBottom:4 }}>Supplier name</div>
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Hawksparks Expert Network" style={inputStyle}/>
              <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:3 }}>Will appear in Finance.xlsx · Suppliers sheet</div>
            </div>
            <div>
              <div className="txt-sm" style={{ fontWeight:600, marginBottom:4 }}>Supplier type</div>
              <div className="row" style={{ gap:6, flexWrap:'wrap' }}>
                {[['project','Project expense'],['opex','OPEX / recurring'],['contractor','Contractor / consultant']].map(([v,l])=>(
                  <button key={v} onClick={()=>setType(v)} style={chipBtn(type===v)}>{l}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="txt-sm" style={{ fontWeight:600, marginBottom:4 }}>Category</div>
              <select value={category} onChange={e=>setCategory(e.target.value)} style={inputStyle}>
                {['Experts','Legal','Accounting','Tooling & software','Office & facilities','Travel','Meals','Marketing','Other'].map(o=><option key={o}>{o}</option>)}
              </select>
            </div>
            <div style={{ gridColumn:'1 / -1' }}>
              <div className="txt-sm" style={{ fontWeight:600, marginBottom:4 }}>ABN / Tax ID</div>
              <input value={abn} onChange={e=>setAbn(e.target.value)} placeholder="11 digits · lookup triggers on complete" style={{ ...inputStyle, fontFamily:'var(--font-mono)' }}/>
              {abn.replace(/\s/g,'').length===11 && (
                <Callout tone="info" title="Entity verified">
                  <div className="txt-sm">Hawksparks Pty Ltd · active · GST registered · NSW · <Badge tone="green" dot>clean</Badge></div>
                </Callout>
              )}
            </div>
          </div>
        )}

        {step===1 && (
          <div className="grid g2" style={{ gap:14 }}>
            <div>
              <div className="txt-sm" style={{ fontWeight:600, marginBottom:4 }}>Primary contact</div>
              <input value={contact} onChange={e=>setContact(e.target.value)} placeholder="e.g. Sara Nolan" style={inputStyle}/>
            </div>
            <div>
              <div className="txt-sm" style={{ fontWeight:600, marginBottom:4 }}>Contact email</div>
              <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="billing@…" style={inputStyle}/>
            </div>
            <div>
              <div className="txt-sm" style={{ fontWeight:600, marginBottom:4 }}>Payment terms</div>
              <select value={terms} onChange={e=>setTerms(e.target.value)} style={inputStyle}>
                {['Net 7','Net 14','Net 30','Net 60','Retainer monthly','Retainer annual','On receipt'].map(o=><option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <div className="txt-sm" style={{ fontWeight:600, marginBottom:4 }}>Invoice currency</div>
              <select style={inputStyle}>
                {['AUD','USD','EUR','GBP','SGD'].map(o=><option key={o}>{o}</option>)}
              </select>
            </div>
            <div style={{ gridColumn:'1 / -1' }}>
              <div className="txt-sm" style={{ fontWeight:600, marginBottom:4 }}>Billing address</div>
              <textarea rows={3} placeholder="optional · pulled from ABR when available" style={{ ...inputStyle, resize:'vertical', fontFamily:'inherit' }}/>
            </div>
          </div>
        )}

        {step===2 && (
          <div className="stack" style={{ gap:14 }}>
            <div>
              <div className="txt-sm" style={{ fontWeight:600, marginBottom:6 }}>Banking · for AP</div>
              <div className="grid g2" style={{ gap:10 }}>
                <div>
                  <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:3 }}>BSB</div>
                  <input value={bankBsb} onChange={e=>setBankBsb(e.target.value)} placeholder="xxx-xxx" style={{ ...inputStyle, fontFamily:'var(--font-mono)' }}/>
                </div>
                <div>
                  <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:3 }}>Account</div>
                  <input value={bankAcct} onChange={e=>setBankAcct(e.target.value)} placeholder="xxxxxxxx" style={{ ...inputStyle, fontFamily:'var(--font-mono)' }}/>
                </div>
              </div>
              <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:4 }}>Bank details are encrypted & only visible to Office Mgr + Mgn Partner.</div>
            </div>

            <div>
              <div className="txt-sm" style={{ fontWeight:600, marginBottom:6 }}>Compliance documents</div>
              <div className="stack" style={{ gap:6 }}>
                <DocToggle label="W-9 / W-8BEN" checked={w9} onChange={setW9} hint="required for non-AU entities"/>
                <DocToggle label="Public liability insurance" hint="optional for low-risk services"/>
                <DocToggle label="Professional indemnity" hint="required for consultants & legal"/>
                <DocToggle label="NDA (mutual)" checked hint="auto-generated on finish"/>
              </div>
            </div>

            <div>
              <div className="txt-sm" style={{ fontWeight:600, marginBottom:6 }}>Tax treatment</div>
              <div className="row" style={{ gap:6, flexWrap:'wrap' }}>
                {[['none','No withholding'],['abn','Missing ABN · 47%'],['dta','DTA · treaty rate']].map(([v,l])=>(
                  <button key={v} onClick={()=>setWht(v)} style={chipBtn(wht===v)}>{l}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step===3 && (
          <div className="stack" style={{ gap:10 }}>
            <Callout tone="info" title="On confirm">
              <div className="txt-sm" style={{ lineHeight:1.6 }}>
                → Row added to <span className="mono">Finance.xlsx · Suppliers</span><br/>
                → NDA drafted to <span className="mono">/Suppliers/{(name||'NEW').split(' ')[0].toUpperCase()}/Legal/</span><br/>
                → Visible in project expense pickers + OCR invoice matcher<br/>
                → First payment requires secondary approval
              </div>
            </Callout>
            <div className="grid g2" style={{ gap:10 }}>
              <Review label="Name" v={name||'—'}/>
              <Review label="Type" v={type}/>
              <Review label="Category" v={category}/>
              <Review label="ABN" v={abn || '—'} mono/>
              <Review label="Contact" v={contact || '—'}/>
              <Review label="Email" v={email || '—'}/>
              <Review label="Terms" v={terms}/>
              <Review label="Bank" v={bankBsb && bankAcct ? `${bankBsb} · ${bankAcct}` : 'pending'} mono/>
              <Review label="W-9 on file" v={w9 ? 'yes' : 'not yet'}/>
              <Review label="Withholding" v={wht}/>
            </div>
          </div>
        )}
      </div>

      <div style={{ padding:'12px 22px', borderTop:'1px solid var(--divider)', background:'var(--bg-subtle)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div className="txt-sm txt-muted">Draft saved automatically · resume from Directory › Suppliers</div>
        <div className="row gap-sm">
          {step>0 && <Btn sm onClick={()=>setStep(step-1)}>← Back</Btn>}
          {step<steps.length-1 && <Btn sm primary onClick={()=>canNext && setStep(step+1)}>Continue →</Btn>}
          {step===steps.length-1 && <Btn sm primary onClick={()=>{ onFinish && onFinish({ name, type, category, abn, contact, email, terms }); onClose(); }}>Confirm & add supplier</Btn>}
        </div>
      </div>
    </ModalShell>
  );
};

const DocToggle = ({ label, checked, onChange, hint }) => {
  const [on, setOn] = React.useState(!!checked);
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', background:'var(--bg-subtle)', borderRadius:6 }}>
      <span onClick={()=>{ setOn(!on); onChange && onChange(!on); }} style={{ width:18, height:18, borderRadius:3, border:'1px solid var(--border)', background: on?'var(--brand)':'transparent', display:'inline-flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:11, cursor:'pointer' }}>{on?'✓':''}</span>
      <div style={{ flex:1 }}>
        <div className="txt-sm" style={{ fontWeight:500 }}>{label}</div>
        {hint && <div className="txt-sm txt-muted" style={{ fontSize:11 }}>{hint}</div>}
      </div>
      <Btn sm ghost>Upload</Btn>
    </div>
  );
};

const Review = ({ label, v, mono }) => (
  <div style={{ background:'var(--bg-subtle)', padding:'8px 10px', borderRadius:6 }}>
    <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em' }}>{label}</div>
    <div className="txt-sm" style={{ fontWeight:500, marginTop:2, fontFamily: mono?'var(--font-mono)':'inherit' }}>{v}</div>
  </div>
);

const inputStyle = { width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--bg)' };
const chipBtn = (active) => ({ padding:'6px 12px', border:`1px solid ${active?'var(--brand)':'var(--border)'}`, background: active?'var(--brand)':'var(--bg)', color: active?'#fff':'var(--text)', borderRadius:6, fontSize:12, fontWeight:500, cursor:'pointer' });

// ============ 2. AddExpenseModal ============
const AddExpenseModal = ({ onClose, onFinish, defaultProject='IFM001' }) => {
  const [merchant, setMerchant] = React.useState('');
  const [amt, setAmt] = React.useState('');
  const [date, setDate] = React.useState('18 Apr 2026');
  const [cat, setCat] = React.useState('Travel');
  const [project, setProject] = React.useState(defaultProject);
  const [billable, setBillable] = React.useState(true);
  const [note, setNote] = React.useState('');
  const [hasReceipt, setHasReceipt] = React.useState(false);

  const over150 = parseFloat(amt.replace(/[^0-9.]/g,'')) > 150 && cat === 'Meals';
  const over500 = parseFloat(amt.replace(/[^0-9.]/g,'')) > 500;

  return (
    <ModalShell onClose={onClose} maxWidth={720} subtitle="Log expense" title={merchant || 'New expense'}>
      <div style={{ padding:'6px 22px 18px' }}>
        {/* Receipt dropzone */}
        {!hasReceipt && (
          <div onClick={()=>{ setHasReceipt(true); setMerchant('Qantas Airways'); setAmt('$418.00'); setCat('Travel'); }}
               style={{ border:'1.5px dashed var(--border)', borderRadius:8, padding:22, textAlign:'center', background:'var(--bg-subtle)', cursor:'pointer', marginBottom:16 }}>
            <Icon name="upload" size={22}/>
            <div className="txt-sm" style={{ fontWeight:600, marginTop:6 }}>Drop receipt or snap a photo</div>
            <div className="txt-sm txt-muted" style={{ fontSize:11 }}>OCR will auto-fill merchant, amount, date · click to simulate</div>
          </div>
        )}
        {hasReceipt && (
          <div className="row" style={{ gap:10, padding:10, background:'var(--bg-subtle)', borderRadius:6, marginBottom:14, alignItems:'center' }}>
            <div style={{ width:44, height:54, background:'#fff', border:'1px solid var(--border)', borderRadius:4, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>📄</div>
            <div style={{ flex:1 }}>
              <div className="txt-sm" style={{ fontWeight:500 }}>qantas-syd-mel.pdf · 218 kb</div>
              <div className="txt-sm txt-muted" style={{ fontSize:11 }}>uploaded 2s ago</div>
            </div>
            <Badge tone="accent" dot>OCR 94%</Badge>
            <Btn sm ghost onClick={()=>setHasReceipt(false)}>Remove</Btn>
          </div>
        )}

        <div className="grid g2" style={{ gap:12 }}>
          <Cell label="Merchant"><input value={merchant} onChange={e=>setMerchant(e.target.value)} style={inputStyle}/></Cell>
          <Cell label="Amount (AUD)"><input value={amt} onChange={e=>setAmt(e.target.value)} style={{ ...inputStyle, fontFamily:'var(--font-mono)' }} placeholder="$0.00"/></Cell>
          <Cell label="Date"><input value={date} onChange={e=>setDate(e.target.value)} style={inputStyle}/></Cell>
          <Cell label="Category">
            <select value={cat} onChange={e=>setCat(e.target.value)} style={inputStyle}>
              {['Travel','Meals','Accom','Experts','Tooling','Office','Other'].map(o=><option key={o}>{o}</option>)}
            </select>
          </Cell>
          <Cell label="Project / OPEX">
            <select value={project} onChange={e=>setProject(e.target.value)} style={inputStyle}>
              {['IFM001','PNC001','GNC001','BMX001','OPEX (firm)'].map(o=><option key={o}>{o}</option>)}
            </select>
          </Cell>
          <Cell label="Billable to client">
            <div className="row gap-sm">
              <button onClick={()=>setBillable(true)}  style={chipBtn(billable)}>Billable</button>
              <button onClick={()=>setBillable(false)} style={chipBtn(!billable)}>Absorbed</button>
            </div>
          </Cell>
          {cat==='Meals' && (
            <Cell label="Attendees"><input placeholder="MB, SR, client×2 · total 4 pax" style={inputStyle}/></Cell>
          )}
          <Cell label="Payment method">
            <select style={inputStyle}>
              {['Amex ••4211 (TT)','Amex ••7833 (MB)','Personal · reimburse','Firm Amex ••9024'].map(o=><option key={o}>{o}</option>)}
            </select>
          </Cell>
          <div style={{ gridColumn:'1 / -1' }}>
            <Cell label="Notes · optional">
              <textarea rows={2} value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. Client site visit · Melbourne" style={{ ...inputStyle, resize:'vertical', fontFamily:'inherit' }}/>
            </Cell>
          </div>
        </div>

        {/* Policy flags */}
        {(over150 || over500) && (
          <div style={{ marginTop:14 }}>
            {over150 && <Callout tone="warn" title="Meals > $150/head"><span className="txt-sm">Requires partner approval per policy · will route to MB on submit.</span></Callout>}
            {over500 && !over150 && <Callout tone="warn" title="Expense > $500"><span className="txt-sm">Project lead approval required before reimbursement.</span></Callout>}
          </div>
        )}
        {!hasReceipt && amt && (
          <Callout tone="warn" title="No receipt attached"><span className="txt-sm">Expense will be flagged for manual review if over $75.</span></Callout>
        )}
      </div>

      <div style={{ padding:'12px 22px', borderTop:'1px solid var(--divider)', background:'var(--bg-subtle)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div className="txt-sm txt-muted">Saves to <span className="mono">Expenses.xlsx</span> · submitter {project.startsWith('OPEX')?'OPEX':project}</div>
        <div className="row gap-sm">
          <Btn sm onClick={onClose}>Cancel</Btn>
          <Btn sm>Save draft</Btn>
          <Btn sm primary icon="arrow" onClick={()=>{ onFinish && onFinish({ merchant, amt, project }); onClose(); }}>Submit</Btn>
        </div>
      </div>
    </ModalShell>
  );
};

const Cell = ({ label, children }) => (
  <div>
    <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4, fontWeight:600 }}>{label}</div>
    {children}
  </div>
);

// ============ 3. ApproveInvoiceDrawer ============
const ApproveInvoiceDrawer = ({ item, onClose, onApprove, onReject }) => {
  if (!item) return null;
  return (
    <DrawerShell
      onClose={onClose}
      width={560}
      subtitle="Approve invoice out"
      title={item.title || 'Invoice #14 · GNC001'}
      right={<Badge tone="red" dot>urgent · 2d overdue</Badge>}
      footer={
        <div className="row gap-sm" style={{ justifyContent:'flex-end' }}>
          <Btn sm ghost onClick={()=>{ onReject && onReject(item); onClose(); }}>Request changes</Btn>
          <Btn sm onClick={onClose}>Cancel</Btn>
          <Btn sm primary icon="check" onClick={()=>{ onApprove && onApprove(item); onClose(); }}>Approve & send</Btn>
        </div>
      }
    >
      <div style={{ padding:'14px 18px' }}>
        <div className="grid g2" style={{ gap:10, marginBottom:14 }}>
          <Review label="Project" v="GNC001 · Genica — Portfolio Review" mono/>
          <Review label="Milestone" v="M4 · Final readout"/>
          <Review label="Amount" v="$48,000" mono/>
          <Review label="Terms" v="Net 30"/>
          <Review label="Prepared by" v="TT · 16 Apr"/>
          <Review label="Threshold triggered" v=">$20k · Mgn Partner"/>
        </div>

        <div className="card-header" style={{ padding:'10px 0' }}><h3>Invoice preview</h3></div>
        <div style={{ border:'1px solid var(--border)', borderRadius:6, padding:14, background:'#fdfcf8', fontSize:12 }}>
          <div className="row-spread" style={{ marginBottom:8 }}>
            <div>
              <div style={{ fontFamily:'var(--font-serif)', fontSize:18 }}>Foundry Health Pty Ltd</div>
              <div className="txt-sm txt-muted">ABN 44 123 456 789 · Sydney, NSW</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div className="txt-sm txt-muted" style={{ fontSize:10, textTransform:'uppercase' }}>Invoice</div>
              <div className="mono" style={{ fontWeight:600 }}>INV-014</div>
              <div className="txt-sm">Issued 18 Apr · Due 18 May</div>
            </div>
          </div>
          <div className="hdiv"/>
          <div className="row-spread"><span>Genica Pharma · Portfolio Review (GNC001)</span><b>$48,000.00</b></div>
          <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:3 }}>Milestone 4 — Final readout · per SOW dated 14 Jan 2026</div>
          <div className="hdiv"/>
          <div className="row-spread"><span>Subtotal</span><span>$48,000.00</span></div>
          <div className="row-spread"><span>GST 10%</span><span>$4,800.00</span></div>
          <div className="row-spread" style={{ fontWeight:600, fontSize:14, marginTop:6 }}><span>Total AUD</span><span>$52,800.00</span></div>
        </div>

        <div className="card-header" style={{ padding:'14px 0 8px' }}><h3>Routing</h3></div>
        <div className="list">
          {[
            ['Drafted','TT','Mgn Partner','15 Apr · 09:14','green'],
            ['PM review','SR','Project lead','15 Apr · 14:02','green'],
            ['Finance check','JS','Office mgr','16 Apr · 11:30','green'],
            ['Mgn Partner approve','TT','you','pending','amber'],
            ['Auto-send to client','system','—','on approval','']
          ].map((r,i)=>(
            <div key={i} className="list-item"><div className="main"><b className="txt-sm">{r[0]}</b><div className="txt-sm txt-muted">{r[1]} · {r[2]}</div></div><Badge tone={r[4]} dot>{r[3]}</Badge></div>
          ))}
        </div>

        <Callout tone="info" title="On approve">
          <div className="txt-sm" style={{ lineHeight:1.6 }}>
            → Invoice PDF emailed to <span className="mono">accounts@genica.com</span><br/>
            → Row written to <span className="mono">Finance.xlsx · Invoices out</span><br/>
            → M4 milestone marked <i>invoiced</i> · reminder sched. T+25
          </div>
        </Callout>
      </div>
    </DrawerShell>
  );
};

// ============ 4. ApproveTimesheetDrawer ============
const ApproveTimesheetDrawer = ({ item, onClose, onApprove }) => {
  if (!item) return null;
  const rows = [
    ['IFM001','Diligence Strategy',[10,8,9,8,8,0,0],43],
    ['PNC001','Market Entry',     [0,1,1,1,1,0,0], 4],
    ['OPEX',  'Firm building',    [0,1,1,1,2,0,0], 5],
  ];
  const days = ['Mon 14','Tue 15','Wed 16','Thu 17','Fri 18','Sat','Sun'];
  const dayTotals = [10,10,11,10,11,0,0];
  return (
    <DrawerShell
      onClose={onClose}
      width={640}
      subtitle={`Approve timesheet · ${item.who || 'JB'} · wk16`}
      title={item.who ? `${item.who}'s timesheet` : "JB's timesheet · 52h"}
      right={<Badge tone="amber" dot>&gt; 50h soft cap</Badge>}
      footer={
        <div className="row gap-sm" style={{ justifyContent:'flex-end' }}>
          <Btn sm ghost>Request fixes</Btn>
          <Btn sm onClick={onClose}>Cancel</Btn>
          <Btn sm primary icon="check" onClick={()=>{ onApprove && onApprove(item); onClose(); }}>Approve week</Btn>
        </div>
      }
    >
      <div style={{ padding:'14px 18px' }}>
        <div className="grid g4" style={{ marginBottom:14 }}>
          <div className="kpi"><div className="label">Total hrs</div><div className="value">52</div><div className="sub" style={{ color:'var(--amber)' }}>+4 over cap</div></div>
          <div className="kpi"><div className="label">Billable</div><div className="value">47</div><div className="sub">90% billable</div></div>
          <div className="kpi"><div className="label">Projects</div><div className="value">2</div><div className="sub">+ 1 OPEX</div></div>
          <div className="kpi"><div className="label">Variance vs plan</div><div className="value" style={{ color:'var(--amber)' }}>+8%</div><div className="sub">wk16 plan 48h</div></div>
        </div>

        <table className="ts-grid" style={{ marginBottom:14 }}>
          <thead><tr><th className="proj-cell" style={{ textAlign:'left' }}>Project</th>{days.map((d,i)=>(<th key={i} className="day-col">{d}</th>))}<th>Tot</th></tr></thead>
          <tbody>
            {rows.map((r,i)=>(
              <tr key={i}>
                <td className="proj-cell"><div className="nm"><span className="tag">{r[0]}</span>{r[1]}</div></td>
                {r[2].map((h,j)=>(<td key={j} className={j>=5?'weekend':''}>{h||''}</td>))}
                <td className="total-cell">{r[3]}</td>
              </tr>
            ))}
            <tr className="total-row"><td className="proj-cell">Day total</td>{dayTotals.map((h,j)=>(<td key={j}>{h}</td>))}<td>52</td></tr>
          </tbody>
        </table>

        <Callout tone="warn" title="Over 50h cap">
          <div className="txt-sm" style={{ lineHeight:1.6 }}>JB is +4h over the soft cap this week. Project lead MB can approve anyway, but it triggers a wellbeing check-in note to JS.</div>
        </Callout>

        <div className="card-header" style={{ padding:'14px 0 8px' }}><h3>Notes from JB</h3></div>
        <div style={{ padding:10, background:'var(--bg-subtle)', borderRadius:6, fontSize:12 }}>
          "Heavier week covering for SR while on leave. Will drop back to 40h next week once synthesis is locked."
        </div>
      </div>
    </DrawerShell>
  );
};

// ============ 5. ApproveExpenseDrawer ============
const ApproveExpenseDrawer = ({ item, onClose, onApprove, onReject }) => {
  if (!item) return null;
  return (
    <DrawerShell
      onClose={onClose}
      width={520}
      subtitle="Approve expense"
      title={item.title || 'CC · Qantas $420'}
      footer={
        <div className="row gap-sm" style={{ justifyContent:'flex-end' }}>
          <Btn sm ghost onClick={()=>{ onReject && onReject(item); onClose(); }}>Reject</Btn>
          <Btn sm onClick={onClose}>Cancel</Btn>
          <Btn sm primary icon="check" onClick={()=>{ onApprove && onApprove(item); onClose(); }}>Approve</Btn>
        </div>
      }
    >
      <div style={{ padding:'14px 18px' }}>
        <div style={{ background:'#fdfcf8', border:'1px solid var(--border)', borderRadius:6, padding:14, marginBottom:14, textAlign:'center' }}>
          <div style={{ fontSize:44 }}>📄</div>
          <div className="txt-sm" style={{ fontWeight:500, marginTop:4 }}>qantas-syd-mel.pdf</div>
          <div className="txt-sm txt-muted" style={{ fontSize:11 }}>uploaded 16 Apr · OCR 96%</div>
        </div>
        <div className="grid g2" style={{ gap:10, marginBottom:14 }}>
          <Review label="Merchant" v="Qantas Airways"/>
          <Review label="Amount" v="$420.00" mono/>
          <Review label="Date" v="12 Apr 2026"/>
          <Review label="Category" v="Travel"/>
          <Review label="Project" v="IFM001" mono/>
          <Review label="Billable" v="Yes · client site"/>
          <Review label="Submitter" v="CC"/>
          <Review label="Payment" v="Amex ••4211"/>
        </div>
        <Callout tone="info" title="Policy check">
          <div className="txt-sm">✓ Under $500 · single approver<br/>✓ Valid receipt attached<br/>✓ Within project travel budget (47%)</div>
        </Callout>
      </div>
    </DrawerShell>
  );
};

// ============ 6. EditScopeModal ============
const EditScopeModal = ({ onClose, onFinish, code='IFM001' }) => {
  const [summary, setSummary] = React.useState('+2 weeks timeline · +$45k scope · adds international expert interviews');
  const [timeDelta, setTimeDelta] = React.useState('+2 weeks');
  const [feeDelta, setFeeDelta] = React.useState('+$45,000');
  const [reason, setReason] = React.useState('client-requested');

  return (
    <ModalShell
      onClose={onClose}
      maxWidth={720}
      subtitle={`${code} · Change order v2`}
      title="Edit scope"
    >
      <div style={{ padding:'6px 22px 18px' }}>
        <Callout tone="info" title="Change orders flow">
          <div className="txt-sm" style={{ lineHeight:1.6 }}>Saving this generates a Word draft CO, routes to Lead partner for review, and queues a client signature request via DocuSign. No P&L changes are committed until signed.</div>
        </Callout>

        <div className="grid g2" style={{ gap:12, marginTop:14 }}>
          <Cell label="Timeline delta">
            <select value={timeDelta} onChange={e=>setTimeDelta(e.target.value)} style={inputStyle}>
              {['No change','+1 week','+2 weeks','+4 weeks','+8 weeks','Early finish'].map(o=><option key={o}>{o}</option>)}
            </select>
          </Cell>
          <Cell label="Fee delta (AUD)">
            <input value={feeDelta} onChange={e=>setFeeDelta(e.target.value)} style={{ ...inputStyle, fontFamily:'var(--font-mono)' }}/>
          </Cell>
          <Cell label="Reason">
            <select value={reason} onChange={e=>setReason(e.target.value)} style={inputStyle}>
              {[['client-requested','Client requested · scope add'],['scope-clarify','Scope clarification · no fee'],['late-data','Late data from client'],['internal','Internal re-plan']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </Cell>
          <Cell label="Margin impact">
            <div className="txt-sm" style={{ padding:'8px 10px', background:'var(--bg-subtle)', borderRadius:6, fontFamily:'var(--font-mono)', fontSize:13, fontWeight:600, color:'var(--green)' }}>31% → 33% (+2pt)</div>
          </Cell>
          <div style={{ gridColumn:'1 / -1' }}>
            <Cell label="Change summary (shown to client)">
              <textarea rows={3} value={summary} onChange={e=>setSummary(e.target.value)} style={{ ...inputStyle, resize:'vertical', fontFamily:'inherit' }}/>
            </Cell>
          </div>
        </div>

        <div className="card-header" style={{ padding:'14px 0 6px' }}><h3>Approval routing</h3></div>
        <div className="list">
          {[['Lead partner','MB','required','amber'],['Mgn Partner','TT','required · >$25k','amber'],['Client sign','IFM Legal','auto-sent via DocuSign','']].map((r,i)=>(
            <div key={i} className="list-item"><div className="main"><b className="txt-sm">{r[0]}</b> · <span className="txt-sm txt-muted">{r[1]}</span></div><Badge tone={r[3]} dot>{r[2]}</Badge></div>
          ))}
        </div>
      </div>

      <div style={{ padding:'12px 22px', borderTop:'1px solid var(--divider)', background:'var(--bg-subtle)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div className="txt-sm txt-muted">Draft saved · resume from Contracts tab</div>
        <div className="row gap-sm">
          <Btn sm onClick={onClose}>Cancel</Btn>
          <Btn sm>Save draft</Btn>
          <Btn sm primary onClick={()=>{ onFinish && onFinish({ timeDelta, feeDelta }); onClose(); }}>Generate CO v2 →</Btn>
        </div>
      </div>
    </ModalShell>
  );
};

// ============ 7. AddDeliverableModal ============
const AddDeliverableModal = ({ onClose, onFinish, code='IFM001' }) => {
  const [name, setName] = React.useState('');
  const [owner, setOwner] = React.useState('MB');
  const [due, setDue] = React.useState('09 May 2026');
  const [fee, setFee] = React.useState('');
  const [triggersInvoice, setTriggersInvoice] = React.useState(true);

  return (
    <ModalShell
      onClose={onClose}
      maxWidth={620}
      subtitle={`${code} · Add milestone / deliverable`}
      title={name || 'New deliverable'}
    >
      <div style={{ padding:'6px 22px 18px' }}>
        <div className="grid g2" style={{ gap:12 }}>
          <div style={{ gridColumn:'1 / -1' }}>
            <Cell label="Deliverable name"><input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Expert interview synthesis" style={inputStyle}/></Cell>
          </div>
          <Cell label="Owner">
            <select value={owner} onChange={e=>setOwner(e.target.value)} style={inputStyle}>
              {['MB','TT','SR','CC','JB'].map(o=><option key={o}>{o}</option>)}
            </select>
          </Cell>
          <Cell label="Due">
            <input value={due} onChange={e=>setDue(e.target.value)} style={inputStyle}/>
          </Cell>
          <Cell label="Associated fee">
            <input value={fee} onChange={e=>setFee(e.target.value)} placeholder="$0 if internal" style={{ ...inputStyle, fontFamily:'var(--font-mono)' }}/>
          </Cell>
          <Cell label="Type">
            <select style={inputStyle}>
              {['Client deliverable','Internal gate','Billing milestone','Dependency'].map(o=><option key={o}>{o}</option>)}
            </select>
          </Cell>
          <div style={{ gridColumn:'1 / -1' }}>
            <label className="row gap-sm" style={{ padding:10, background:'var(--bg-subtle)', borderRadius:6, cursor:'pointer', fontSize:12 }}>
              <input type="checkbox" checked={triggersInvoice} onChange={e=>setTriggersInvoice(e.target.checked)}/>
              Triggers invoice on completion (adds to schedule)
            </label>
          </div>
        </div>
      </div>

      <div style={{ padding:'12px 22px', borderTop:'1px solid var(--divider)', background:'var(--bg-subtle)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div className="txt-sm txt-muted">Adds row to Milestones · updates Gantt</div>
        <div className="row gap-sm">
          <Btn sm onClick={onClose}>Cancel</Btn>
          <Btn sm primary icon="plus" onClick={()=>{ onFinish && onFinish({ name, owner, due, fee }); onClose(); }}>Add deliverable</Btn>
        </div>
      </div>
    </ModalShell>
  );
};

// ============ 8. AddTeamMemberModal ============
const AddTeamMemberModal = ({ onClose, onFinish, code='IFM001' }) => {
  const [picked, setPicked] = React.useState(null);
  const [fte, setFte] = React.useState('1.0');
  const [start, setStart] = React.useState('21 Apr 2026');
  const [end, setEnd] = React.useState('end of project');

  const candidates = [
    { code:'SR', name:'SR', role:'Assoc partner', rate:'$2,000/d', avail:'+8h wk18',  util:58, fit:'high' },
    { code:'AP', name:'AP', role:'Contractor',    rate:'$2,000/d', avail:'+32h wk17', util:33, fit:'high' },
    { code:'CC', name:'CC', role:'Consultant',    rate:'$800/d',   avail:'+12h wk18', util:84, fit:'med',  warn:'over-utilised' },
    { code:'JB', name:'JB', role:'Analyst',       rate:'$400/d',   avail:'−4h wk17',  util:92, fit:'low',  warn:'at capacity' },
    { code:'KR', name:'K. Roberts', role:'Contractor · expert', rate:'$250/h', avail:'unknown', util:0, fit:'med', warn:'external · NDA required' },
  ];

  return (
    <ModalShell
      onClose={onClose}
      maxWidth={780}
      subtitle={`${code} · Assign team`}
      title={picked ? `Assign ${picked.name}` : 'Pick from capacity'}
    >
      <div style={{ padding:'6px 22px 18px' }}>
        {!picked && (
          <>
            <div className="txt-sm txt-muted" style={{ marginBottom:10 }}>People sorted by best fit to this project's remaining scope · pulled from capacity planner.</div>
            <div className="stack" style={{ gap:8 }}>
              {candidates.map(c=>(
                <div key={c.code} onClick={()=>setPicked(c)} style={{ border:'1px solid var(--border)', borderRadius:8, padding:12, display:'grid', gridTemplateColumns:'auto 1fr auto auto auto', gap:12, alignItems:'center', cursor:'pointer', background:'var(--bg)' }}>
                  <Avatar>{c.code}</Avatar>
                  <div>
                    <b>{c.name}</b> · <span className="txt-sm">{c.role}</span>
                    {c.warn && <div className="txt-sm" style={{ color:'var(--amber)', fontSize:11 }}>⚠ {c.warn}</div>}
                  </div>
                  <div className="txt-sm mono">{c.rate}</div>
                  <div style={{ width:80, textAlign:'right' }}>
                    <div className="txt-sm txt-muted" style={{ fontSize:10 }}>utilisation</div>
                    <div className="mono" style={{ color: c.util>85?'var(--red)':c.util>70?'var(--amber)':'var(--green)' }}>{c.util}%</div>
                  </div>
                  <Badge tone={c.fit==='high'?'green':c.fit==='med'?'amber':''} dot>{c.fit} fit</Badge>
                </div>
              ))}
            </div>
          </>
        )}

        {picked && (
          <>
            <div className="row gap-sm" style={{ padding:10, background:'var(--bg-subtle)', borderRadius:6, marginBottom:14 }}>
              <Avatar>{picked.code}</Avatar>
              <div style={{ flex:1 }}>
                <b>{picked.name}</b> · {picked.role}
                <div className="txt-sm txt-muted" style={{ fontSize:11 }}>{picked.rate} · avail {picked.avail}</div>
              </div>
              <Btn sm ghost onClick={()=>setPicked(null)}>Change person</Btn>
            </div>

            <div className="grid g2" style={{ gap:12 }}>
              <Cell label="FTE on this project">
                <select value={fte} onChange={e=>setFte(e.target.value)} style={inputStyle}>
                  {['0.25','0.5','0.75','1.0','Hourly'].map(o=><option key={o}>{o}</option>)}
                </select>
              </Cell>
              <Cell label="Rate override">
                <input placeholder={picked.rate + ' (default)'} style={{ ...inputStyle, fontFamily:'var(--font-mono)' }}/>
              </Cell>
              <Cell label="Start"><input value={start} onChange={e=>setStart(e.target.value)} style={inputStyle}/></Cell>
              <Cell label="End / rolloff"><input value={end} onChange={e=>setEnd(e.target.value)} style={inputStyle}/></Cell>
              <div style={{ gridColumn:'1 / -1' }}>
                <Cell label="Workstream">
                  <select style={inputStyle}>
                    {['Expert interviews','Market model','Synthesis','Deck production','QA'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </Cell>
              </div>
            </div>

            {picked.warn && (
              <Callout tone="warn" title={`Heads up · ${picked.warn}`}>
                <div className="txt-sm">{picked.warn.includes('NDA') ? 'NDA will auto-generate & queue for signature before project access is granted.' : 'Consider reducing FTE or pulling in alternate. Lead partner MB will be notified.'}</div>
              </Callout>
            )}
            <Callout tone="info" title="On confirm">
              <div className="txt-sm" style={{ lineHeight:1.6 }}>
                → Added to <span className="mono">IFM001 · Team</span><br/>
                → Capacity planner updated (−{fte==='1.0'?'40':fte==='0.5'?'20':'~'}h/wk)<br/>
                → Access granted: project folder, WhatsApp group, ClickUp space
              </div>
            </Callout>
          </>
        )}
      </div>

      <div style={{ padding:'12px 22px', borderTop:'1px solid var(--divider)', background:'var(--bg-subtle)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div className="txt-sm txt-muted">{picked ? 'assignment saves to Resource planner' : 'pick a person to continue'}</div>
        <div className="row gap-sm">
          <Btn sm onClick={onClose}>Cancel</Btn>
          {picked && <Btn sm primary icon="check" onClick={()=>{ onFinish && onFinish({ person: picked.code, fte, start, end }); onClose(); }}>Assign {picked.name}</Btn>}
        </div>
      </div>
    </ModalShell>
  );
};

Object.assign(window, {
  ModalShell, DrawerShell,
  AddSupplierWizard, AddExpenseModal,
  ApproveInvoiceDrawer, ApproveTimesheetDrawer, ApproveExpenseDrawer,
  EditScopeModal, AddDeliverableModal, AddTeamMemberModal,
});
