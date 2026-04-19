// ============ FOUNDRY RATE CARD (FY2023-24) ============
// Ingested from "Foundry Health Contractor Rate Card.xlsx"
// Source of truth for role levels across wizard, profile, rate-card screen.

const FOUNDRY_LEVELS = [
  { code:'L4', label:'Partner',                         band:'Partner',   desc:'Key stakeholder, owner and decision-maker in equal partnership. Firm leadership.', quals:'MD MPH and/or PhD, or industry leadership', industry:'MBB/D consulting or peak industry experience — may have been a former Partner',
    rates:{ AU:null, NZ:null, US:null, UK:null }, tone:'amber' },
  { code:'L3', label:'Associate Partner',               band:'Partner',   desc:'Leads projects and initiatives in areas of expertise. On track to equity partnership.', quals:'MD MPH and/or PhD, or industry leadership', industry:'MBB EM experience or peak industry consulting experience',
    rates:{ AU:null, NZ:null, US:null, UK:null }, tone:'amber' },
  { code:'L2', label:'Project Director / Senior Manager', band:'Leadership', desc:'Leads projects and initiatives with little oversight. Owns client relationships.', quals:'16+ yrs experience', industry:'MBB EM / Senior ASC experience or peak industry consulting',
    rates:{ AU:180, NZ:180, US:130, UK:90 }, tone:'blue' },
  { code:'L1', label:'Project Manager / Manager',       band:'Leadership', desc:'Leads key workstreams for projects and initiatives.', quals:'MD MPH and/or PhD, or industry leadership', industry:'Significant specialist industry consulting experience',
    rates:{ AU:200, NZ:200, US:150, UK:100 }, tone:'blue' },
  { code:'E2', label:'Senior Expert',                    band:'Expert',    desc:'Senior industry leader, supporter of FH\u2019s mission. Firm-of-record expert.', quals:'Emeritus or nationally/internationally recognised expert', industry:'Highly experienced, high-profile individual',
    rates:{ AU:300, NZ:300, US:200, UK:150 }, tone:'accent' },
  { code:'E1', label:'Expert',                           band:'Expert',    desc:'Expert in chosen field, supports FH on workstreams.', quals:'Professor / senior academic', industry:'Clinical or scientific domain expert with previous experience',
    rates:{ AU:200, NZ:200, US:140, UK:100 }, tone:'accent' },
  { code:'T3', label:'Senior Consultant',                band:'Consultant',desc:'Very experienced consulting team member, leads workstreams.', quals:'MD / MBBS / PhD and relevant masters', industry:'Fellowed (eg RACGP), or at least PGY6 · may have MBB/Big4 experience',
    rates:{ AU:150, NZ:150, US:100, UK:75 }, tone:'green' },
  { code:'F2', label:'Fellow',                           band:'Fellow',    desc:'Recently fellowed in a clinical specialty without consulting experience, but with notable industry or peak body involvement. Supports with deep technical knowledge, with the intent of building exposure to consulting.', quals:'MD / MBBS / PhD and relevant masters', industry:'Fellowed (e.g. RANZCR) · no MBB experience',
    rates:{ AU:150, NZ:150, US:100, UK:75 }, tone:'teal' },
  { code:'F1', label:'Junior Fellow',                    band:'Fellow',    desc:'Nearing fellowship in a clinical specialty and without consulting experience, but with notable industry or peak body involvement.', quals:'MD / MBBS / PhD and relevant masters', industry:'Advanced trainee with significant relevant experience · no MBB experience',
    rates:{ AU:120, NZ:120, US:80, UK:60 }, tone:'teal' },
  { code:'T2', label:'Consultant',                       band:'Consultant',desc:'Experienced team member, capable of supporting & leading within workstreams.', quals:'MD / MBBS / PhD and relevant masters', industry:'Over 4 years of clinical experience · may have MBB Senior BA background',
    rates:{ AU:120, NZ:120, US:80, UK:60 }, tone:'green' },
  { code:'T1', label:'Consultant (junior)',              band:'Consultant',desc:'Experienced consultant, recently graduated from medical school.', quals:'MD / MBBS, or late-stage PhD candidate', industry:'Up to 4 yrs clinical/other relevant experience',
    rates:{ AU:80,  NZ:80,  US:50,  UK:40 }, tone:'green' },
  { code:'A3', label:'Senior Analyst',                   band:'Analyst',   desc:'Experienced analyst, recently graduated from medical school.', quals:'MD / MBBS', industry:'Senior undergraduate (final year) · may have several years at FH or other',
    rates:{ AU:65,  NZ:65,  US:40,  UK:30 }, tone:'' },
  { code:'A2', label:'Analyst',                          band:'Analyst',   desc:'Emerging consulting team member, capable of supporting across work.', quals:'Undergraduate degree, MD candidate', industry:'May have 180\u00b0 training and experience',
    rates:{ AU:50,  NZ:45,  US:30,  UK:25 }, tone:'' },
  { code:'A1', label:'Junior Analyst',                   band:'Analyst',   desc:'New team member \u2014 probationary rate (6\u201312 months).', quals:'Undergraduate degree, MD candidate', industry:'May have some experience or training',
    rates:{ AU:45,  NZ:27.5,US:null,UK:20 }, tone:'' },
  { code:'IO', label:'Intern',                           band:'Intern',    desc:'New team member \u2014 probationary rate.', quals:'MD or other relevant degree candidate', industry:'Non-clinical undergraduate',
    rates:{ AU:0,   NZ:0,   US:null,UK:0  }, tone:'' },
];

const FOUNDRY_RATE_CARD_META = {
  cardVersion: 'FY26',
  source: 'Foundry Health Contractor Rate Card.xlsx · SharePoint',
  lastIngested: new Date().toISOString().slice(0,10),
  bands: ['Partner','Leadership','Expert','Consultant','Fellow','Analyst','Intern'],
  regions: [
    { id:'AU', label:'AU', curr:'AUD', flag:'\ud83c\udde6\ud83c\uddfa' },
    { id:'NZ', label:'NZ', curr:'AUD', flag:'\ud83c\uddf3\ud83c\uddff' },
    { id:'US', label:'US', curr:'USD', flag:'\ud83c\uddfa\ud83c\uddf8' },
    { id:'UK', label:'UK', curr:'GBP', flag:'\ud83c\uddec\ud83c\udde7' },
  ],
};

const fmtRate = (v, curr) => v==null ? '\u2014' : `${curr==='USD'?'US$':curr==='GBP'?'\u00a3':'$'}${v}`;
const fmtDaily = (hourly) => hourly==null ? '\u2014' : `$${(hourly*8).toLocaleString()}`;

Object.assign(window, { FOUNDRY_LEVELS, FOUNDRY_RATE_CARD_META, fmtRate, fmtDaily });

// ============ RATE CARD SCREEN (full directory tab) ============
const RateCardScreen = () => {
  const [band, setBand] = React.useState('all');
  const [region, setRegion] = React.useState('AU');
  const rows = band==='all' ? FOUNDRY_LEVELS : FOUNDRY_LEVELS.filter(l=>l.band===band);
  const curr = FOUNDRY_RATE_CARD_META.regions.find(r=>r.id===region).curr;

  return (
    <>
      <div className="row" style={{ marginBottom:16, gap:12 }}>
        <div>
          <div className="txt-sm txt-muted">Ingested from {FOUNDRY_RATE_CARD_META.source}</div>
          <h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, margin:'2px 0 0' }}>Role levels &amp; rate card <span className="txt-muted" style={{ fontSize:14 }}>· {FOUNDRY_RATE_CARD_META.cardVersion}</span></h2>
        </div>
        <Badge tone="green" dot>in effect</Badge>
        <div className="ml-auto row gap-sm">
          <Btn sm ghost icon="doc">Export XLSX</Btn>
          <Btn sm ghost>Version history</Btn>
          <Btn sm primary icon="plus">New revision</Btn>
        </div>
      </div>

      {/* Band summary strip */}
      <div className="grid g4" style={{ marginBottom:16 }}>
        {FOUNDRY_RATE_CARD_META.bands.map(b => {
          const levels = FOUNDRY_LEVELS.filter(l=>l.band===b);
          const hourly = levels.map(l=>l.rates.AU).filter(v=>v!=null);
          const lo = hourly.length?Math.min(...hourly):null;
          const hi = hourly.length?Math.max(...hourly):null;
          return (
            <div key={b} className="kpi" onClick={()=>setBand(b===band?'all':b)} style={{ cursor:'pointer', outline: band===b?'2px solid var(--brand)':'none' }}>
              <div className="label">{b}</div>
              <div className="value" style={{ fontSize:22 }}>{levels.length} <span className="txt-muted" style={{ fontSize:13, fontWeight:400 }}>{levels.length===1?'level':'levels'}</span></div>
              <div className="sub">{lo==null?'partner / negotiated':`$${lo}\u2013$${hi}/h AU`}</div>
            </div>
          );
        })}
      </div>

      <div className="row-spread" style={{ marginBottom:10 }}>
        <div className="row gap-sm">
          <button onClick={()=>setBand('all')} style={{ padding:'4px 12px', borderRadius:999, fontSize:12, cursor:'pointer', border: band==='all'?'1px solid var(--brand)':'1px solid var(--border)', background: band==='all'?'color-mix(in oklab, var(--brand) 10%, var(--bg))':'var(--bg)', color: band==='all'?'var(--brand)':'var(--text-3)', fontWeight: band==='all'?600:400 }}>All bands</button>
          {FOUNDRY_RATE_CARD_META.bands.map(b=>(
            <button key={b} onClick={()=>setBand(b)} style={{ padding:'4px 12px', borderRadius:999, fontSize:12, cursor:'pointer', border: band===b?'1px solid var(--brand)':'1px solid var(--border)', background: band===b?'color-mix(in oklab, var(--brand) 10%, var(--bg))':'var(--bg)', color: band===b?'var(--brand)':'var(--text-3)', fontWeight: band===b?600:400 }}>{b}</button>
          ))}
        </div>
        <div className="role-switcher">
          {FOUNDRY_RATE_CARD_META.regions.map(r=>(
            <button key={r.id} className={region===r.id?'active':''} onClick={()=>setRegion(r.id)}>{r.flag} {r.label} <span className="txt-muted" style={{ fontSize:10, marginLeft:4 }}>{r.curr}</span></button>
          ))}
        </div>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width:72 }}>Code</th>
              <th>Level</th>
              <th>Band</th>
              <th>Qualifications</th>
              <th>Industry background</th>
              <th className="num">Hourly ({curr})</th>
              <th className="num">Daily (8h)</th>
              <th className="num">Active staff</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(l=>{
              const staffAtLevel = Object.values(PERSON_DB||{}).filter(p => (p.levelCode||'').toLowerCase()===l.code.toLowerCase()).length;
              const rate = l.rates[region];
              return (
                <tr key={l.code}>
                  <td><span className="mono" style={{ fontWeight:600 }}>{l.code}</span></td>
                  <td>
                    <div style={{ fontWeight:600, fontSize:13 }}>{l.label}</div>
                    <div className="txt-sm txt-muted" style={{ fontSize:11, lineHeight:1.4 }}>{l.desc}</div>
                  </td>
                  <td><Badge tone={l.tone}>{l.band}</Badge></td>
                  <td className="txt-sm" style={{ fontSize:11, color:'var(--text-3)' }}>{l.quals}</td>
                  <td className="txt-sm" style={{ fontSize:11, color:'var(--text-3)' }}>{l.industry}</td>
                  <td className="num mono" style={{ fontWeight:600 }}>{fmtRate(rate, curr)}</td>
                  <td className="num mono" style={{ color:'var(--text-3)' }}>{rate==null?'\u2014':fmtRate(rate*8, curr)}</td>
                  <td className="num">{staffAtLevel || '\u2014'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Callout tone="info" title="How this flows">
        <div className="txt-sm">Hourly rates \u2192 project budgets in wizard \u2192 self-invoices \u2192 client invoices. Changing a level on a person updates their default rate; per-project overrides preserved. Partner (L4) / Associate Partner (L3) rates are determined per-engagement and flow through partner true-up instead.</div>
      </Callout>
    </>
  );
};

Object.assign(window, { RateCardScreen });
