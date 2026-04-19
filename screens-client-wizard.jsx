// ============ ADD CLIENT WIZARD ============
// 5 steps: Organisation · Primary contact · Billing · Commercial terms · Review
// Uses the same PFieldRow/PInput/PSelect/PTextarea/PChipGroup primitives
// as the person wizard (exposed on window from screens-directory-people.jsx).

const CLIENT_TYPES = [
  { id:'pharma',   label:'Pharma',         desc:'Large pharma, biotech · most common client type' },
  { id:'biotech',  label:'Biotech',        desc:'Emerging, clinical or pre-commercial biotech' },
  { id:'medtech',  label:'MedTech',        desc:'Device, diagnostics, digital therapeutics' },
  { id:'hospital', label:'Hospital / HCO', desc:'Hospital group, health service, primary care' },
  { id:'payer',    label:'Payer / Gov',    desc:'Government, insurer, HTA agency' },
  { id:'investor', label:'Investor',       desc:'VC / PE — usually for diligence work' },
  { id:'other',    label:'Other',          desc:'NGO, research, academic — note specifics below' },
];

const CLIENT_REGIONS = [
  { id:'AU',   label:'Australia',   curr:'AUD' },
  { id:'NZ',   label:'New Zealand', curr:'AUD' },
  { id:'APAC', label:'APAC',        curr:'USD' },
  { id:'US',   label:'United States', curr:'USD' },
  { id:'UK',   label:'United Kingdom', curr:'GBP' },
  { id:'EU',   label:'Europe',      curr:'EUR' },
  { id:'OTHER',label:'Other',       curr:'USD' },
];

const AddClientWizard = ({ onClose, onFinish }) => {
  const steps = ['Organisation','Primary contact','Billing','Commercial','Review'];
  const [step, setStep] = React.useState(0);

  // Organisation
  const [clientType, setClientType] = React.useState('pharma');
  const [name, setName]           = React.useState('');
  const [shortCode, setShortCode] = React.useState('');
  const [legalName, setLegalName] = React.useState('');
  const [website, setWebsite]     = React.useState('');
  const [region, setRegion]       = React.useState('AU');
  const [hqAddress, setHqAddress] = React.useState('');
  const [size, setSize]           = React.useState('mid');
  const [tags, setTags]           = React.useState([]);
  const [source, setSource]       = React.useState('');

  // Primary contact
  const [cFirst, setCFirst]       = React.useState('');
  const [cLast, setCLast]         = React.useState('');
  const [cTitle, setCTitle]       = React.useState('');
  const [cEmail, setCEmail]       = React.useState('');
  const [cPhone, setCPhone]       = React.useState('');
  const [cLinkedIn, setCLinkedIn] = React.useState('');
  const [secondaryName, setSecondaryName]   = React.useState('');
  const [secondaryEmail, setSecondaryEmail] = React.useState('');
  const [relationshipOwner, setRelationshipOwner] = React.useState('MB');

  // Billing
  const [billingEmail, setBillingEmail] = React.useState('');
  const [billingABN, setBillingABN]     = React.useState('');
  const [billingAddress, setBillingAddress] = React.useState('');
  const [po, setPo]                     = React.useState(false);
  const [paymentTerms, setPaymentTerms] = React.useState('30');
  const [taxTreatment, setTaxTreatment] = React.useState('gst');
  const [currency, setCurrency]         = React.useState('AUD');

  // Commercial
  const [masterMsa, setMasterMsa]   = React.useState(false);
  const [msaExpiry, setMsaExpiry]   = React.useState('');
  const [nda, setNda]               = React.useState(false);
  const [ndaExpiry, setNdaExpiry]   = React.useState('');
  const [rateCardRegion, setRateCardRegion] = React.useState('AU');
  const [rateDiscountPct, setRateDiscountPct] = React.useState(0);
  const [portalAccess, setPortalAccess] = React.useState(true);
  const [notes, setNotes]           = React.useState('');
  const [referralPartner, setReferralPartner] = React.useState('');
  const [referralFeePct, setReferralFeePct]   = React.useState(0);

  // Auto derive short code (e.g. "Panacea Therapeutics" -> "PNC")
  React.useEffect(()=>{
    if (!shortCode && name) {
      const vowels = 'aeiouAEIOU';
      const clean = name.replace(/[^a-zA-Z]/g,'');
      let code = '';
      for (const ch of clean) {
        if (code.length >= 3) break;
        if (!vowels.includes(ch) || code.length === 0) code += ch.toUpperCase();
      }
      if (code.length < 3) code = clean.slice(0,3).toUpperCase();
      setShortCode(code);
    }
  }, [name]);

  const next = () => setStep(Math.min(step+1, steps.length-1));
  const back = () => setStep(Math.max(step-1, 0));

  const regionCurr = CLIENT_REGIONS.find(r=>r.id===region)?.curr || 'AUD';
  React.useEffect(()=>{ setCurrency(regionCurr); }, [region]);

  const cTypeLabel = CLIENT_TYPES.find(t=>t.id===clientType)?.label || 'Client';

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(30,28,24,0.55)', zIndex:60, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'var(--bg)', borderRadius:10, width:'min(1040px,100%)', maxHeight:'94vh', overflow:'hidden', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>

        {/* Header */}
        <div style={{ padding:'14px 22px', borderBottom:'1px solid var(--divider)' }}>
          <div className="row-spread">
            <div>
              <div className="txt-sm txt-muted">Add client · step {step+1} of {steps.length} · {steps[step]}</div>
              <h3 style={{ margin:'2px 0 0', fontFamily:'var(--font-serif)', fontSize:20, fontWeight:400 }}>
                {name || 'New client'} <span className="txt-muted" style={{ fontSize:13 }}>· {cTypeLabel}{shortCode?` · ${shortCode}`:''}</span>
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
            <div className="stack" style={{ gap:14 }}>
              <div className="card" style={{ background:'var(--bg)' }}>
                <div className="card-header"><h3>Client type</h3><div className="txt-sm txt-muted">Used for pipeline reporting, concentration + client mix views.</div></div>
                <div className="card-body">
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
                    {CLIENT_TYPES.map(t=>{
                      const active = clientType===t.id;
                      return (
                        <div key={t.id} onClick={()=>setClientType(t.id)} style={{
                          padding:12, border: active?'2px solid var(--brand)':'1px solid var(--border)', borderRadius:8, cursor:'pointer',
                          background: active?'color-mix(in oklab, var(--brand) 6%, var(--bg))':'var(--bg)',
                        }}>
                          <div style={{ fontWeight:600, fontSize:13 }}>{t.label}</div>
                          <div className="txt-sm txt-muted" style={{ fontSize:11, marginTop:4, lineHeight:1.4 }}>{t.desc}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="card" style={{ background:'var(--bg)' }}>
                <div className="card-header"><h3>Organisation</h3></div>
                <div className="card-body">
                  <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr 1fr', gap:16 }}>
                    <PFieldRow label="Client name" hint="Preferred short name (what people call them).">
                      <PInput v={name} set={setName} placeholder="e.g. Panacea Therapeutics"/>
                    </PFieldRow>
                    <PFieldRow label="Code" hint="3-letter project code prefix. Must be unique.">
                      <PInput v={shortCode} set={v=>setShortCode(v.toUpperCase().slice(0,4))} placeholder="PNC" mono/>
                    </PFieldRow>
                    <PFieldRow label="Size">
                      <PSelect v={size} set={setSize} options={[['small','Small · <100 staff'],['mid','Mid · 100–1k'],['large','Large · 1k–10k'],['enterprise','Enterprise · 10k+']]}/>
                    </PFieldRow>

                    <PFieldRow label="Legal entity" hint="As it appears on contracts + invoices.">
                      <PInput v={legalName} set={setLegalName} placeholder="Panacea Therapeutics Pty Ltd"/>
                    </PFieldRow>
                    <PFieldRow label="Region">
                      <PSelect v={region} set={setRegion} options={CLIENT_REGIONS.map(r=>[r.id,r.label])}/>
                    </PFieldRow>
                    <PFieldRow label="Website">
                      <PInput v={website} set={setWebsite} placeholder="https://panacea.com"/>
                    </PFieldRow>

                    <PFieldRow label="HQ address" full>
                      <PTextarea v={hqAddress} set={setHqAddress} rows={2} placeholder="Level 12, 88 King St, Sydney NSW 2000, Australia"/>
                    </PFieldRow>

                    <PFieldRow label="Tags / focus areas" hint="Therapeutic areas, modalities, strategic themes." full>
                      <PChipGroup v={tags} set={setTags} multi options={['Oncology','Cardiology','Neurology','Rare disease','Immunology','Endocrinology','Infectious disease','Ophthalmology','Digital therapeutics','Diagnostics','Vaccines','Gene therapy']}/>
                    </PFieldRow>

                    <PFieldRow label="Source / how did we meet?" full>
                      <PInput v={source} set={setSource} placeholder="e.g. MB intro at ISPOR 2025 · referred by Jane at Brandeis"/>
                    </PFieldRow>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step===1 && (
            <div className="stack" style={{ gap:14 }}>
              <div className="card" style={{ background:'var(--bg)' }}>
                <div className="card-header"><h3>Primary contact</h3><div className="txt-sm txt-muted">Main point of contact for engagement · invoices go to billing contact on next step.</div></div>
                <div className="card-body">
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                    <PFieldRow label="First name"><PInput v={cFirst} set={setCFirst} placeholder="Julia"/></PFieldRow>
                    <PFieldRow label="Last name"><PInput v={cLast} set={setCLast} placeholder="Henderson"/></PFieldRow>

                    <PFieldRow label="Title" full><PInput v={cTitle} set={setCTitle} placeholder="VP Market Access, APAC"/></PFieldRow>

                    <PFieldRow label="Email"><PInput v={cEmail} set={setCEmail} placeholder="julia.henderson@panacea.com"/></PFieldRow>
                    <PFieldRow label="Phone"><PInput v={cPhone} set={setCPhone} placeholder="+61 …"/></PFieldRow>

                    <PFieldRow label="LinkedIn" full><PInput v={cLinkedIn} set={setCLinkedIn} placeholder="linkedin.com/in/…"/></PFieldRow>
                  </div>
                </div>
              </div>

              <div className="card" style={{ background:'var(--bg)' }}>
                <div className="card-header"><h3>Secondary contact &amp; relationship owner</h3></div>
                <div className="card-body">
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
                    <PFieldRow label="Name"><PInput v={secondaryName} set={setSecondaryName} placeholder="Opt."/></PFieldRow>
                    <PFieldRow label="Email"><PInput v={secondaryEmail} set={setSecondaryEmail}/></PFieldRow>
                    <PFieldRow label="Relationship owner" hint="Partner or consultant who owns the account.">
                      <PSelect v={relationshipOwner} set={setRelationshipOwner}
                        options={[['TT','TT · Managing partner'],['MB','MB · Partner'],['SR','SR · Associate partner'],['CC','CC · Senior consultant']]}/>
                    </PFieldRow>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step===2 && (
            <div className="stack" style={{ gap:14 }}>
              <div className="card" style={{ background:'var(--bg)' }}>
                <div className="card-header"><h3>Billing details</h3><div className="txt-sm txt-muted">Where invoices are sent · populated onto every invoice for this client.</div></div>
                <div className="card-body">
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                    <PFieldRow label="Billing email" hint="Accounts payable team inbox."><PInput v={billingEmail} set={setBillingEmail} placeholder="ap@panacea.com"/></PFieldRow>
                    <PFieldRow label="ABN / Tax ID"><PInput v={billingABN} set={setBillingABN} placeholder="12 345 678 901"/></PFieldRow>

                    <PFieldRow label="Billing address" full>
                      <PTextarea v={billingAddress} set={setBillingAddress} rows={2} placeholder="Same as HQ · or different invoicing entity"/>
                    </PFieldRow>

                    <PFieldRow label="Currency">
                      <PSelect v={currency} set={setCurrency} options={['AUD','USD','GBP','EUR','NZD']}/>
                    </PFieldRow>
                    <PFieldRow label="Tax">
                      <PSelect v={taxTreatment} set={setTaxTreatment} options={[['gst','GST 10% (AU/NZ domestic)'],['none','No tax (export)'],['reverse','Reverse charge'],['vat','VAT (UK/EU)']]}/>
                    </PFieldRow>

                    <PFieldRow label="Payment terms">
                      <PSelect v={paymentTerms} set={setPaymentTerms} options={[['7','7 days'],['14','14 days'],['30','30 days'],['45','45 days'],['60','60 days'],['90','90 days']]}/>
                    </PFieldRow>
                    <PFieldRow label="PO required">
                      <label className="row gap-sm" style={{ fontSize:13, marginTop:8 }}>
                        <input type="checkbox" checked={po} onChange={e=>setPo(e.target.checked)}/>
                        PO must be on file before invoicing
                      </label>
                    </PFieldRow>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step===3 && (
            <div className="stack" style={{ gap:14 }}>
              <div className="card" style={{ background:'var(--bg)' }}>
                <div className="card-header"><h3>Agreements</h3><div className="txt-sm txt-muted">MSA + NDA state · drives project set-up speed.</div></div>
                <div className="card-body">
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
                    <PFieldRow label="Master services agreement (MSA)">
                      <label className="row gap-sm" style={{ fontSize:13, marginTop:8 }}>
                        <input type="checkbox" checked={masterMsa} onChange={e=>setMasterMsa(e.target.checked)}/>
                        MSA executed
                      </label>
                    </PFieldRow>
                    {masterMsa && (
                      <PFieldRow label="MSA expiry"><PInput v={msaExpiry} set={setMsaExpiry} placeholder="YYYY-MM-DD"/></PFieldRow>
                    )}
                    <PFieldRow label="Non-disclosure (NDA)">
                      <label className="row gap-sm" style={{ fontSize:13, marginTop:8 }}>
                        <input type="checkbox" checked={nda} onChange={e=>setNda(e.target.checked)}/>
                        Mutual NDA in place
                      </label>
                    </PFieldRow>
                    {nda && (
                      <PFieldRow label="NDA expiry"><PInput v={ndaExpiry} set={setNdaExpiry} placeholder="YYYY-MM-DD"/></PFieldRow>
                    )}
                  </div>
                </div>
              </div>

              <div className="card" style={{ background:'var(--bg)' }}>
                <div className="card-header"><h3>Rate card &amp; discounts</h3><div className="txt-sm txt-muted">Applied across all projects for this client · can be overridden per project.</div></div>
                <div className="card-body">
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
                    <PFieldRow label="Rate card" hint="Picks which column of the Foundry rate card to use.">
                      <PSelect v={rateCardRegion} set={setRateCardRegion} options={(window.FOUNDRY_RATE_CARD_META?.regions||[]).map(r=>[r.id, `${r.label} · ${r.curr}`])}/>
                    </PFieldRow>
                    <PFieldRow label="Discount" hint="Applied to published hourly rate · 0 = list price.">
                      <div className="row" style={{ gap:6 }}>
                        <div style={{ flex:1 }}><PInput v={rateDiscountPct} set={v=>setRateDiscountPct(Number(v)||0)} mono/></div>
                        <div style={{ width:50, fontSize:13, color:'var(--text-3)', alignSelf:'center' }}>%</div>
                      </div>
                    </PFieldRow>
                    <PFieldRow label="Portal">
                      <label className="row gap-sm" style={{ fontSize:13, marginTop:8 }}>
                        <input type="checkbox" checked={portalAccess} onChange={e=>setPortalAccess(e.target.checked)}/>
                        Grant client portal access
                      </label>
                    </PFieldRow>
                  </div>
                </div>
              </div>

              <div className="card" style={{ background:'var(--bg)' }}>
                <div className="card-header"><h3>Referral / commission (if applicable)</h3></div>
                <div className="card-body">
                  <div style={{ display:'grid', gridTemplateColumns:'1.3fr 1fr 1fr', gap:16 }}>
                    <PFieldRow label="Referring partner" hint="External partner who introduced — split fees.">
                      <PInput v={referralPartner} set={setReferralPartner} placeholder="e.g. Brandeis Advisors"/>
                    </PFieldRow>
                    <PFieldRow label="Fee">
                      <div className="row" style={{ gap:6 }}>
                        <div style={{ flex:1 }}><PInput v={referralFeePct} set={v=>setReferralFeePct(Number(v)||0)} mono/></div>
                        <div style={{ width:50, fontSize:13, color:'var(--text-3)', alignSelf:'center' }}>%</div>
                      </div>
                    </PFieldRow>
                    <PFieldRow label="Cap">
                      <PSelect v={'project'} set={()=>{}} options={[['project','Per project'],['engagement','Per engagement'],['annual','Annual cap'],['none','No cap']]}/>
                    </PFieldRow>
                  </div>
                </div>
              </div>

              <div className="card" style={{ background:'var(--bg)' }}>
                <div className="card-header"><h3>Internal notes</h3></div>
                <div className="card-body">
                  <PTextarea v={notes} set={setNotes} rows={4} placeholder="Context for the account team · competitive landscape, sensitivities, known stakeholders."/>
                </div>
              </div>
            </div>
          )}

          {step===4 && (
            <div className="card" style={{ background:'var(--bg)' }}>
              <div className="card-header"><h3>Review &amp; create</h3></div>
              <div className="card-body">
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
                  <div className="stack" style={{ gap:10 }}>
                    <ReviewBlock title="Organisation">
                      <ReviewRow k="Name" v={name || '—'}/>
                      <ReviewRow k="Code" v={shortCode || '—'}/>
                      <ReviewRow k="Type" v={cTypeLabel}/>
                      <ReviewRow k="Legal entity" v={legalName || '—'}/>
                      <ReviewRow k="Region" v={region}/>
                      <ReviewRow k="Size" v={size}/>
                      <ReviewRow k="Focus areas" v={tags.join(', ') || '—'}/>
                      <ReviewRow k="Source" v={source || '—'}/>
                    </ReviewBlock>
                    <ReviewBlock title="Primary contact">
                      <ReviewRow k="Name" v={[cFirst,cLast].filter(Boolean).join(' ') || '—'}/>
                      <ReviewRow k="Title" v={cTitle || '—'}/>
                      <ReviewRow k="Email" v={cEmail || '—'}/>
                      <ReviewRow k="Phone" v={cPhone || '—'}/>
                      <ReviewRow k="Foundry owner" v={relationshipOwner}/>
                    </ReviewBlock>
                  </div>
                  <div className="stack" style={{ gap:10 }}>
                    <ReviewBlock title="Billing">
                      <ReviewRow k="Billing email" v={billingEmail || '—'}/>
                      <ReviewRow k="ABN / Tax ID" v={billingABN || '—'}/>
                      <ReviewRow k="Currency" v={currency}/>
                      <ReviewRow k="Payment terms" v={`${paymentTerms} days`}/>
                      <ReviewRow k="Tax" v={taxTreatment}/>
                      <ReviewRow k="PO required" v={po?'yes':'no'} tone={po?'amber':undefined}/>
                    </ReviewBlock>
                    <ReviewBlock title="Commercial">
                      <ReviewRow k="MSA" v={masterMsa?`yes · exp ${msaExpiry||'open'}`:'no'} tone={masterMsa?'green':'amber'}/>
                      <ReviewRow k="NDA" v={nda?`yes · exp ${ndaExpiry||'open'}`:'no'} tone={nda?'green':'amber'}/>
                      <ReviewRow k="Rate card" v={`${rateCardRegion}${rateDiscountPct?` · ${rateDiscountPct}% disc`:' · list'}`}/>
                      <ReviewRow k="Portal" v={portalAccess?'granted':'off'}/>
                      {referralPartner && <ReviewRow k="Referral" v={`${referralPartner} · ${referralFeePct}%`}/>}
                    </ReviewBlock>
                  </div>
                </div>

                <div style={{ marginTop:16 }}>
                  <Callout tone="info" title="On finish">
                    <div className="txt-sm">Creates <b>{shortCode||'???'}</b> in client master · adds to <b>{relationshipOwner}</b>'s book · {portalAccess?'provisions portal login and sends invite to primary contact · ':'no portal access · '}generates {masterMsa?'no':'MSA draft and '}onboarding email ready for send.</div>
                  </Callout>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={{ padding:'12px 22px', borderTop:'1px solid var(--divider)', display:'flex', gap:8, justifyContent:'space-between', alignItems:'center' }}>
          <div className="txt-sm txt-muted">Draft saved automatically · resume from <b>Directory › Clients</b></div>
          <div className="row gap-sm">
            {step>0 && <Btn ghost onClick={back}>← Back</Btn>}
            {step<steps.length-1 && <Btn primary onClick={next}>Continue →</Btn>}
            {step===steps.length-1 && <><Btn ghost onClick={onClose}>Save as draft</Btn><Btn primary onClick={()=>{ onFinish && onFinish({ name, shortCode, clientType, region, relationshipOwner }); onClose && onClose(); }}>Create client &amp; send invite</Btn></>}
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { AddClientWizard, CLIENT_TYPES, CLIENT_REGIONS });
