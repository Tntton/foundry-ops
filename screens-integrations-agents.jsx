// screens-integrations-agents.jsx — Integrations & Agents dashboard
// One place to see every system Foundry talks to, and every agent that sits between.

const INTEGRATIONS = [
  { id:'m365', name:'Microsoft 365', color:'#0078D4', letter:'M', status:'connected', authMethod:'OAuth2 · Entra tenant', lastSync:'2m',
    surfaces:[
      ['Users & Groups','Read','Nightly + on login','Resolves Entra ID → role mapping'],
      ['Users (provisioning)','Write','New-person wizard','Creates mailbox, adds to FoundryStaff group'],
      ['OneDrive / SharePoint','Two-way','On file attach','Stores files; app holds pointers'],
      ['Excel Online','Export only','Nightly + on-demand','Snapshots: Finance/Timesheet/Invoices/Expenses/Pipeline/Partner-pool'],
      ['Calendar','Two-way','Project kickoff / PAR','Events + invites'],
      ['Mail','Read','Agent-driven','Monitors bills@ and receipts@ inboxes'],
      ['Teams','Write','Approvals','Adaptive cards to #ops channel + DMs'],
    ]},
  { id:'xero', name:'Xero', color:'#13B5EA', letter:'X', status:'connected', authMethod:'OAuth2 · Xero marketplace', lastSync:'5m',
    surfaces:[
      ['Contacts','Two-way','Client/contractor create','Maintains xero_contact_id'],
      ['Tracking Categories','Write','Project create','Each active project = tracking category value'],
      ['Invoices (AR)','Push + webhook','Invoice approval','App origin; Xero status syncs back'],
      ['Bills (AP)','Push + webhook','Bill approval / pay run','Supplier invoices pushed as Bills'],
      ['Bank feed','Read','Nightly','Powers Xero Reconciler agent'],
      ['Chart of accounts','Read (cached)','Nightly','Maps bill category → Xero GL code'],
      ['Payroll','Xero-side','—','Xero runs payroll; we push batch records for GL'],
    ]},
  { id:'payau', name:'pay.com.au', color:'#111', letter:'P', status:'configuring', authMethod:'API key / manual upload', lastSync:'—',
    surfaces:[
      ['ABA upload','Write','Approved pay run','Payroll + bills mixed batch'],
      ['Payment status','Read','Webhook / poll','Marks pay run paid; ripples to bills/payroll'],
    ]},
  { id:'whatsapp', name:'WhatsApp Business', color:'#25D366', letter:'W', status:'pending_approval', authMethod:'Meta Business Cloud API', lastSync:'—',
    surfaces:[
      ['Approval requests','Out + In','>threshold events','YES / NO / REVIEW reply, MFA for >$20k'],
      ['Timesheet reminders','Out only','Fri 3pm','Per-person deeplink'],
      ['AR overdue alerts','Out only','Daily','To responsible partner'],
      ['Receipt photo intake','Out + In','Photo sent to chat','Triggers Receipt Parser agent'],
      ['Kickoff announcements','Out only','Phase 2','Client-facing — compliance review pending'],
    ]},
  { id:'docusign', name:'DocuSign', color:'#FFCC22', letter:'D', status:'connected', authMethod:'OAuth2 · DocuSign marketplace', lastSync:'1h',
    surfaces:[
      ['Client contracts','Write + webhook','Contract drafter agent','Envelope created, sent on Super Admin approval'],
      ['Consulting agreements','Write + webhook','New hire wizard','Same flow for staff/contractor'],
    ]},
];

const AGENTS = [
  { id:'receipt_parser', name:'Receipt parser', icon:'📸', trigger:'Email to receipts@ / WhatsApp photo / in-app upload',
    input:'Image or PDF receipt', output:'Draft Expense (vendor, amount, date, GST, category)',
    approval:'Staff confirms draft before submit', model:'claude-sonnet',
    status:'live', runsThisMonth:142, successRate:94, avgCost:0.012 },
  { id:'ap_intake', name:'AP intake', icon:'📬', trigger:'Email to bills@foundry.health',
    input:'Inbound email + attachments', output:'Draft Bill + attachment filed to SharePoint /AP/YYYY/MM/',
    approval:'Admin reviews → Super Admin approves', model:'claude-sonnet',
    status:'live', runsThisMonth:38, successRate:91, avgCost:0.018 },
  { id:'invoice_drafter', name:'Invoice drafter', icon:'📄', trigger:'Manual or month-end scheduled',
    input:'Project milestones + approved timesheets + rate card', output:'Draft Invoice + rendered .docx',
    approval:'Partner reviews → Super Admin if >$20k', model:'claude-sonnet',
    status:'live', runsThisMonth:24, successRate:98, avgCost:0.025 },
  { id:'contract_drafter', name:'Contract drafter', icon:'✍️', trigger:'Deal won → "Draft SOW"',
    input:'Deal + client + rate card + similar past work', output:'Draft .docx + DocuSign envelope (not sent)',
    approval:'Super Admin reviews + routes to DocuSign', model:'claude-sonnet',
    status:'beta', runsThisMonth:6, successRate:83, avgCost:0.041 },
  { id:'ar_chaser', name:'AR chaser', icon:'🔔', trigger:'Daily scan',
    input:'Xero AR aging report', output:'Drafted per-invoice follow-up emails',
    approval:'Partner reviews & sends via Outlook', model:'claude-haiku',
    status:'live', runsThisMonth:58, successRate:96, avgCost:0.004 },
  { id:'timesheet_reconciler', name:'Timesheet reconciler', icon:'⏱', trigger:'Friday 3pm',
    input:'Person M365 calendar + logged hours', output:'Nudge to person with gaps',
    approval:'Advisory only — no approval', model:'claude-haiku',
    status:'live', runsThisMonth:12, successRate:100, avgCost:0.002 },
  { id:'xero_reconciler', name:'Xero reconciler', icon:'🔀', trigger:'Nightly',
    input:'Xero bank feed transactions', output:'Proposed matches to Expense/Invoice/Bill',
    approval:'Admin confirms matches', model:'claude-haiku',
    status:'live', runsThisMonth:420, successRate:88, avgCost:0.003 },
];

const IntegrationsAgents = () => {
  const [tab, setTab] = React.useState('integrations');
  const [openInteg, setOpenInteg] = React.useState(null);
  const [openAgent, setOpenAgent] = React.useState(null);

  const statusBadge = (status) => {
    const map = {
      connected: { tone:'green', label:'● connected' },
      configuring: { tone:'amber', label:'◐ configuring' },
      pending_approval: { tone:'amber', label:'◐ awaiting Meta' },
      live: { tone:'green', label:'● live' },
      beta: { tone:'amber', label:'◐ beta' },
      paused: { tone:'', label:'○ paused' },
    };
    const v = map[status] || { tone:'', label:status };
    return <Badge tone={v.tone}>{v.label}</Badge>;
  };

  return (
    <>
      <div className="row" style={{ marginBottom:16, gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:22 }}>Integrations &amp; Agents</h2>
          <div className="txt-sm txt-muted" style={{ marginTop:4 }}>5 external systems · 7 human-in-the-loop agents · all LLM calls use Claude</div>
        </div>
        <div className="ml-auto row gap-sm">
          <Btn sm icon="download">Audit export</Btn>
          <Btn sm primary icon="plus">Connect integration</Btn>
        </div>
      </div>

      <div className="grid g4" style={{ marginBottom:16 }}>
        <KPI label="Integrations live" value="3 / 5" sub="2 in setup" />
        <KPI label="Agents active" value="6 / 7" sub="1 in beta · 0 paused" />
        <KPI label="Agent runs · 30d" value="700" sub="↑ 18% vs prior" subTone="green" />
        <KPI label="LLM spend · 30d" value="$14.20" sub="of $350 cap · healthy" subTone="green" />
      </div>

      <div className="tabs" style={{ marginBottom:16 }}>
        {[['integrations','Integrations'],['agents','Agents'],['policies','Approval policies']].map(([k,l])=>(
          <div key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</div>
        ))}
      </div>

      {tab==='integrations' && (
        <div className="card">
          <table className="tbl">
            <thead><tr><th style={{width:44}}></th><th>System</th><th>Auth</th><th>Status</th><th>Surfaces</th><th>Last sync</th><th></th></tr></thead>
            <tbody>
              {INTEGRATIONS.map(i => (
                <React.Fragment key={i.id}>
                  <tr style={{ cursor:'pointer' }} onClick={()=>setOpenInteg(openInteg===i.id?null:i.id)}>
                    <td><span className="integ-sq" style={{ background:i.color, width:28, height:28, borderRadius:6 }}>{i.letter}</span></td>
                    <td style={{ fontWeight:600 }}>{i.name}</td>
                    <td className="txt-sm txt-muted">{i.authMethod}</td>
                    <td>{statusBadge(i.status)}</td>
                    <td className="txt-sm">{i.surfaces.length} surfaces</td>
                    <td className="mono txt-sm">{i.lastSync}</td>
                    <td className="txt-sm" style={{ color:'var(--brand)' }}>{openInteg===i.id?'▾':'▸'}</td>
                  </tr>
                  {openInteg===i.id && (
                    <tr><td colSpan={7} style={{ background:'var(--bg-subtle)', padding:0 }}>
                      <table className="tbl" style={{ margin:0, background:'transparent' }}>
                        <thead><tr><th style={{paddingLeft:56}}>Surface</th><th>Direction</th><th>Trigger</th><th>Use</th></tr></thead>
                        <tbody>
                          {i.surfaces.map((s,idx)=>(
                            <tr key={idx}><td style={{paddingLeft:56, fontWeight:500}}>{s[0]}</td><td><Badge tone="">{s[1]}</Badge></td><td className="txt-sm">{s[2]}</td><td className="txt-sm txt-muted">{s[3]}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab==='agents' && (
        <div className="grid" style={{ gridTemplateColumns:'repeat(auto-fill,minmax(360px,1fr))', gap:12 }}>
          {AGENTS.map(a=>(
            <div key={a.id} className="card" style={{ padding:16, cursor:'pointer' }} onClick={()=>setOpenAgent(openAgent===a.id?null:a.id)}>
              <div className="row" style={{ gap:10, alignItems:'flex-start' }}>
                <div style={{ fontSize:28, lineHeight:1, marginTop:2 }}>{a.icon}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:600, fontSize:14 }}>{a.name}</div>
                  <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:2 }}>{a.trigger}</div>
                </div>
                {statusBadge(a.status)}
              </div>
              <div style={{ marginTop:12, display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, fontSize:11 }}>
                <div><div className="txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.05em' }}>Runs · 30d</div><div style={{ fontWeight:600, marginTop:2, fontSize:14 }}>{a.runsThisMonth}</div></div>
                <div><div className="txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.05em' }}>Success</div><div style={{ fontWeight:600, marginTop:2, fontSize:14, color: a.successRate>=95?'var(--green)':a.successRate>=85?'var(--amber)':'var(--red)' }}>{a.successRate}%</div></div>
                <div><div className="txt-muted" style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.05em' }}>$/run</div><div style={{ fontWeight:600, marginTop:2, fontSize:14 }} className="mono">${a.avgCost.toFixed(3)}</div></div>
              </div>
              {openAgent===a.id && (
                <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid var(--divider)', fontSize:12 }}>
                  <div style={{ marginBottom:8 }}><span className="txt-muted">Input:</span> {a.input}</div>
                  <div style={{ marginBottom:8 }}><span className="txt-muted">Output:</span> {a.output}</div>
                  <div style={{ marginBottom:8 }}><span className="txt-muted">Approval gate:</span> {a.approval}</div>
                  <div><span className="txt-muted">Model:</span> <span className="mono">{a.model}</span></div>
                  <div className="row gap-sm" style={{ marginTop:10 }}>
                    <Btn sm ghost>View runs</Btn>
                    <Btn sm ghost>Edit prompt</Btn>
                    <Btn sm primary>Run now</Btn>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab==='policies' && (
        <div className="card">
          <div className="card-header"><h3>Approval thresholds</h3><div className="txt-sm txt-muted">All configurable per firm · defaults shown</div></div>
          <table className="tbl">
            <thead><tr><th>Action</th><th className="num">Threshold</th><th>Required approver</th><th>Channel</th></tr></thead>
            <tbody>
              {[
                ['Invoice send','>$20,000','Super Admin','App or WhatsApp + MFA'],
                ['Invoice send','≤$20,000','Admin or owning Partner','App or WhatsApp'],
                ['Expense reimbursement','>$2,000','Super Admin','App'],
                ['Expense reimbursement','≤$2,000','Admin / owning Manager','App or WhatsApp'],
                ['Supplier bill (AP)','any','Super Admin','App'],
                ['Pay run (ABA)','any','Super Admin','App only'],
                ['New hire','any','Super Admin','App'],
                ['Contract send','any','Super Admin','App → DocuSign'],
                ['Rate card change','any','Super Admin','App only'],
              ].map((r,i)=>(
                <tr key={i}><td>{r[0]}</td><td className="num">{r[1]}</td><td><Badge tone="blue">{r[2]}</Badge></td><td className="txt-sm">{r[3]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

Object.assign(window, { IntegrationsAgents });
