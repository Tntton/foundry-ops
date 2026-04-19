// ============ RESOURCE PLANNING ============
// People × project × week heatmap · utilisation · underutilised/overbooked flags
// Incl. FHO*** internal codes for BD + firm-building time

const ResourcePlanning = () => {
  const [view, setView] = React.useState('heatmap');
  const [period, setPeriod] = React.useState('6w');
  const [openRow, setOpenRow] = React.useState(null);

  // People roster with FTE and target utilisation
  const people = [
    // [code, name, role, fte, type, targetUtil]
    ['TT','Managing partner','FT Partner',1.0,'partner',50],
    ['MB','Partner · Strategy','FT Partner',1.0,'partner',60],
    ['SR','Assoc partner','PT Partner',0.6,'partner',50],
    ['CC','Consultant','FT Consultant',1.0,'consultant',75],
    ['JB','Analyst','FT',1.0,'analyst',80],
    ['AP','Associate','Contractor',null,'contractor',50],
    ['JS','Office manager','FT OPEX',1.0,'opex',0], // 100% OPEX, not billable
  ];

  // Projects & internal codes (FHO for BD / firm-building)
  const projectCodes = {
    'IFM001': { client:'IFM', color:'var(--brand)' },
    'PNC001': { client:'Panacea', color:'#7a8e4a' },
    'GNC001': { client:'Genica', color:'#4a8e7a' },
    'BMX001': { client:'Biomax', color:'#8e7a4a' },
    'IFM002': { client:'IFM', color:'var(--brand-2)' },
    'FHO001': { client:'BD · pitching', color:'var(--accent)', internal:true },
    'FHO002': { client:'BD · proposals', color:'var(--accent-2)', internal:true },
    'FHO003': { client:'Firm-building', color:'#8a6a8a', internal:true },
    'FHO004': { client:'Hiring · recruiting', color:'#6a8a8a', internal:true },
    'OPEX':   { client:'Office / admin', color:'var(--text-3)', internal:true },
  };

  // Allocation matrix: person × week × project → hours
  // weeks: 6 upcoming (this wk + 5)
  const weeks = ['wk 16','wk 17','wk 18','wk 19','wk 20','wk 21'];

  // Per-person per-week allocations, by project code → hours
  const alloc = {
    TT: [
      { 'PNC001':8,  'BMX001':6,  'FHO001':10, 'FHO003':6  }, // wk16
      { 'PNC001':10, 'BMX001':6,  'FHO001':8,  'FHO003':4  },
      { 'PNC001':10, 'BMX001':4,  'FHO001':12, 'FHO002':4  },
      { 'PNC001':8,  'FHO001':10, 'FHO002':6,  'FHO003':4  },
      { 'FHO001':12, 'FHO002':8,  'FHO003':6                }, // underutilised wk20
      { 'FHO001':8,  'FHO002':6,  'FHO003':4                }, // underutilised wk21
    ],
    MB: [
      { 'IFM001':20, 'PNC001':14, 'FHO002':4,  'FHO003':4  },
      { 'IFM001':22, 'PNC001':14, 'FHO002':4                },
      { 'IFM001':22, 'PNC001':16, 'FHO002':6                }, // overbooked
      { 'IFM001':18, 'PNC001':14, 'FHO001':6,  'FHO002':6  },
      { 'IFM001':12, 'PNC001':14, 'FHO001':8,  'FHO003':4  },
      { 'PNC001':14, 'FHO001':10, 'FHO002':8,  'FHO003':4  },
    ],
    SR: [
      { 'GNC001':14, 'FHO001':4                          },
      { 'GNC001':14, 'FHO001':4                          },
      { 'GNC001':12, 'FHO001':6                          },
      { 'GNC001':10, 'FHO001':4                          }, // tapering
      { 'FHO001':6                                       }, // underutilised
      { 'FHO001':4                                       }, // underutilised
    ],
    CC: [
      { 'IFM001':18, 'PNC001':14                         },
      { 'IFM001':20, 'PNC001':14                         },
      { 'IFM001':20, 'PNC001':16                         }, // overbooked
      { 'IFM001':18, 'PNC001':14                         },
      { 'IFM001':12, 'PNC001':10                         },
      { 'PNC001':8,  'FHO003':4                          }, // underutilised wk21
    ],
    JB: [
      { 'IFM001':24, 'GNC001':8                          },
      { 'IFM001':28, 'GNC001':8                          }, // overbooked
      { 'IFM001':24, 'GNC001':8                          },
      { 'IFM001':18, 'GNC001':4                          },
      { 'IFM001':12, 'FHO004':4                          },
      { 'IFM001':8, 'FHO004':4                           }, // underutilised
    ],
    AP: [
      { 'PNC001':16                                      },
      { 'PNC001':16                                      },
      { 'PNC001':16                                      },
      { 'PNC001':12                                      },
      { 'PNC001':8                                       },
      {                                                  }, // fully available
    ],
    JS: [
      { 'OPEX':38                                        },
      { 'OPEX':38                                        },
      { 'OPEX':38                                        },
      { 'OPEX':38                                        },
      { 'OPEX':38                                        },
      { 'OPEX':38                                        },
    ],
  };

  const WEEK_HOURS = 40;
  const sum = (obj) => Object.values(obj).reduce((a,b)=>a+b,0);

  // compute per-person stats
  const stats = people.map(p => {
    const rows = alloc[p[0]] || [];
    const hoursByWeek = rows.map(r => sum(r));
    const avgHours = hoursByWeek.reduce((a,b)=>a+b,0) / Math.max(weeks.length, 1);
    const fteHours = (p[3] || 1) * WEEK_HOURS;
    const util = fteHours > 0 ? Math.round(avgHours / fteHours * 100) : 0;
    const billable = rows.reduce((acc,r)=>acc + Object.entries(r).filter(([k])=>!projectCodes[k]?.internal).reduce((a,[,v])=>a+v,0), 0);
    const bd = rows.reduce((acc,r)=>acc + Object.entries(r).filter(([k])=>k.startsWith('FHO00') && ['FHO001','FHO002'].includes(k)).reduce((a,[,v])=>a+v,0), 0);
    const firm = rows.reduce((acc,r)=>acc + Object.entries(r).filter(([k])=>k==='FHO003'||k==='FHO004').reduce((a,[,v])=>a+v,0), 0);
    const opex = rows.reduce((acc,r)=>acc + (r.OPEX||0), 0);
    const overbookedWeeks = hoursByWeek.filter(h => h > fteHours).length;
    const underWeeks = hoursByWeek.filter(h => fteHours>0 && h < fteHours*0.5).length;
    return { p, hoursByWeek, avgHours, fteHours, util, billable, bd, firm, opex, overbookedWeeks, underWeeks };
  });

  // flags
  const underutilised = stats.filter(s => s.p[5]>0 && s.util < s.p[5] - 10);
  const overbooked = stats.filter(s => s.overbookedWeeks > 0);

  // Heatmap cell color from util %
  const heatColor = (hours, fte) => {
    if (fte<=0) return 'var(--bg-subtle)';
    const pct = hours / fte * 100;
    if (pct===0) return 'var(--bg-subtle)';
    if (pct < 40) return 'rgba(68,132,189,0.18)';
    if (pct < 70) return 'rgba(68,132,189,0.45)';
    if (pct < 95) return 'rgba(107,140,62,0.55)';
    if (pct <= 105) return 'rgba(180,124,63,0.55)';
    return 'rgba(180,63,63,0.6)';
  };

  return (<>
    <div className="row" style={{ marginBottom:14, gap:12, flexWrap:'wrap' }}>
      <div>
        <div className="txt-sm txt-muted">All people · all projects · incl. FHO internal codes</div>
        <h2 style={{ fontFamily:'var(--font-serif)', fontSize:26, fontWeight:400, margin:'2px 0 0' }}>Resource planning</h2>
      </div>
      <div className="ml-auto row gap-sm">
        <div className="role-switcher">
          {[['4w','4 wks'],['6w','6 wks'],['12w','12 wks']].map(([k,l])=>(<button key={k} className={period===k?'active':''} onClick={()=>setPeriod(k)}>{l}</button>))}
        </div>
        <div className="role-switcher">
          {[['heatmap','Heatmap'],['table','Table'],['chart','Chart']].map(([k,l])=>(<button key={k} className={view===k?'active':''} onClick={()=>setView(k)}>{l}</button>))}
        </div>
        <Btn sm icon="filter">Filter people</Btn>
        <Btn sm icon="calendar" onClick={()=>window.__nav && window.__nav('projects')}>Assign</Btn>
      </div>
    </div>

    <div className="grid g4" style={{ marginBottom:14 }}>
      <div className="kpi"><div className="label">Firm utilisation · 6wk avg</div><div className="value">74%</div><div className="sub" style={{ color:'var(--amber)' }}>target 75%+</div></div>
      <div className="kpi"><div className="label">Underutilised people</div><div className="value" style={{ color:'var(--amber)' }}>{underutilised.length}</div><div className="sub">below role target −10pt</div></div>
      <div className="kpi"><div className="label">Overbooked weeks</div><div className="value" style={{ color:'var(--red)' }}>{stats.reduce((a,s)=>a+s.overbookedWeeks,0)}</div><div className="sub">person-weeks &gt; 100% FTE</div></div>
      <div className="kpi"><div className="label">BD hours next 6wks</div><div className="value">{stats.reduce((a,s)=>a+s.bd,0)}h</div><div className="sub">FHO001 + FHO002</div></div>
    </div>

    {view==='heatmap' && (
      <div className="card">
        <div className="card-header"><h3>Bandwidth heatmap</h3><div className="txt-sm txt-muted">hours per week · green 70–95% · amber &gt;100% · blue &lt; 70%</div></div>
        <div style={{ padding:'12px 18px 18px', overflowX:'auto' }}>
          <div style={{ display:'grid', gridTemplateColumns:`240px repeat(${weeks.length}, 1fr) 110px`, gap:4, fontSize:12 }}>
            <div/>
            {weeks.map(w=>(<div key={w} style={{ fontFamily:'var(--font-mono)', fontSize:11, fontWeight:600, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'.06em', textAlign:'center', padding:'4px 0' }}>{w}</div>))}
            <div style={{ fontFamily:'var(--font-mono)', fontSize:11, fontWeight:600, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'.06em', textAlign:'right', padding:'4px 6px' }}>avg util</div>

            {stats.map(s => {
              const [code, name, role, fte, type, target] = s.p;
              return (
                <React.Fragment key={code}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 8px', cursor:'pointer' }} onClick={()=>setOpenRow(s)}>
                    <Avatar size={22}>{code}</Avatar>
                    <div style={{ minWidth:0, flex:1 }}>
                      <div style={{ fontWeight:600, fontSize:12 }}>{code} <span style={{ color:'var(--text-3)', fontWeight:400, fontSize:11 }}>· {role}</span></div>
                      <div style={{ fontSize:11, color:'var(--text-3)' }}>FTE {fte ?? '—'} · target {target}%</div>
                    </div>
                  </div>
                  {s.hoursByWeek.map((h,wi) => {
                    const bg = heatColor(h, s.fteHours);
                    const over = s.fteHours>0 && h > s.fteHours;
                    const under = s.fteHours>0 && h < s.fteHours*0.5 && target>0;
                    return (
                      <div key={wi} style={{ background:bg, borderRadius:4, padding:'8px 6px', textAlign:'center', position:'relative', cursor:'pointer' }} title={`${code} · ${weeks[wi]}\n${Object.entries(alloc[code][wi]||{}).map(([p,v])=>`${p}: ${v}h`).join('\n')}`}>
                        <div style={{ fontFamily:'var(--font-mono)', fontWeight:600, fontSize:12 }}>{h || ''}</div>
                        {s.fteHours>0 && h>0 && <div style={{ fontSize:10, color:'var(--text-3)' }}>{Math.round(h/s.fteHours*100)}%</div>}
                        {over && <div style={{ position:'absolute', top:2, right:3, fontSize:10, color:'var(--red)' }}>●</div>}
                        {under && <div style={{ position:'absolute', top:2, right:3, fontSize:10, color:'var(--amber)' }}>○</div>}
                      </div>
                    );
                  })}
                  <div style={{ textAlign:'right', padding:'6px 10px', fontFamily:'var(--font-mono)', fontWeight:600, color: s.util>(target+5)?'var(--green)':s.util<(target-10)?'var(--amber)':'var(--text)' }}>{s.util}%</div>
                </React.Fragment>
              );
            })}
          </div>

          <div className="hdiv"/>
          <div className="row gap-sm" style={{ fontSize:11, color:'var(--text-3)' }}>
            <span>Legend:</span>
            <div style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:14, height:14, borderRadius:3, background:'rgba(68,132,189,0.18)' }}/><span>&lt;40%</span></div>
            <div style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:14, height:14, borderRadius:3, background:'rgba(68,132,189,0.45)' }}/><span>40-70%</span></div>
            <div style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:14, height:14, borderRadius:3, background:'rgba(107,140,62,0.55)' }}/><span>70-95%</span></div>
            <div style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:14, height:14, borderRadius:3, background:'rgba(180,124,63,0.55)' }}/><span>95-105%</span></div>
            <div style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:14, height:14, borderRadius:3, background:'rgba(180,63,63,0.6)' }}/><span>&gt;105% overbooked</span></div>
            <span style={{ marginLeft:12 }}>● over · ○ under</span>
          </div>
        </div>
      </div>
    )}

    {view==='table' && (
      <div className="card">
        <div className="card-header"><h3>Utilisation breakdown · by category</h3><div className="txt-sm txt-muted">avg across next {weeks.length} weeks · billable vs BD vs firm-building vs OPEX</div></div>
        <table className="tbl">
          <thead><tr><th>Person</th><th>Role</th><th className="num">FTE</th><th className="num">Target</th><th className="num">Actual</th><th className="num">Billable</th><th className="num">BD (FHO001/2)</th><th className="num">Firm (FHO003/4)</th><th className="num">OPEX</th><th>Flag</th></tr></thead>
          <tbody>
            {stats.map(s => {
              const [code, name, role, fte, type, target] = s.p;
              const flag = s.util < target-10 ? 'underutilised' : s.overbookedWeeks>0 ? 'overbooked' : 'balanced';
              const flagTone = flag==='underutilised'?'amber':flag==='overbooked'?'red':'green';
              const totalH = s.hoursByWeek.reduce((a,b)=>a+b,0);
              const pct = (h) => totalH>0 ? Math.round(h/totalH*100) : 0;
              return (
                <tr key={code} style={{ cursor:'pointer' }} onClick={()=>setOpenRow(s)}>
                  <td><div className="row gap-sm"><Avatar>{code}</Avatar><b>{code}</b></div></td>
                  <td className="txt-sm">{role}</td>
                  <td className="num">{fte ?? '—'}</td>
                  <td className="num">{target}%</td>
                  <td className="num"><b style={{ color: s.util<target-10?'var(--amber)':s.util>target+10?'var(--green)':'var(--text)' }}>{s.util}%</b></td>
                  <td className="num">{s.billable}h <span className="txt-sm txt-muted">· {pct(s.billable)}%</span></td>
                  <td className="num">{s.bd}h <span className="txt-sm txt-muted">· {pct(s.bd)}%</span></td>
                  <td className="num">{s.firm}h <span className="txt-sm txt-muted">· {pct(s.firm)}%</span></td>
                  <td className="num">{s.opex}h</td>
                  <td><Badge tone={flagTone} dot>{flag}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}

    {view==='chart' && (
      <div className="grid g2">
        <div className="card">
          <div className="card-header"><h3>Hours by category · next 6 weeks</h3></div>
          <div className="card-body">
            {stats.map(s => {
              const total = s.hoursByWeek.reduce((a,b)=>a+b,0) || 1;
              const seg = [
                { l:'Billable',  v:s.billable, c:'var(--brand)' },
                { l:'BD',        v:s.bd,       c:'var(--accent)' },
                { l:'Firm-build',v:s.firm,     c:'var(--blue)' },
                { l:'OPEX',      v:s.opex,     c:'var(--text-3)' },
              ];
              return (
                <div key={s.p[0]} style={{ marginBottom:10 }}>
                  <div className="row-spread" style={{ fontSize:12, marginBottom:4 }}>
                    <span><b>{s.p[0]}</b> <span className="txt-muted">· {s.p[2]}</span></span>
                    <span className="mono">{total}h</span>
                  </div>
                  <div style={{ display:'flex', height:14, borderRadius:3, overflow:'hidden', background:'var(--bg-subtle)' }}>
                    {seg.map((x,i)=>x.v>0 && <div key={i} style={{ width:`${x.v/total*100}%`, background:x.c }} title={`${x.l}: ${x.v}h`}/>)}
                  </div>
                </div>
              );
            })}
            <div className="hdiv"/>
            <div className="row gap-sm" style={{ fontSize:11 }}>
              <div className="row gap-sm"><span style={{ width:12, height:12, background:'var(--brand)', borderRadius:2 }}/>Billable</div>
              <div className="row gap-sm"><span style={{ width:12, height:12, background:'var(--accent)', borderRadius:2 }}/>BD</div>
              <div className="row gap-sm"><span style={{ width:12, height:12, background:'var(--blue)', borderRadius:2 }}/>Firm-build</div>
              <div className="row gap-sm"><span style={{ width:12, height:12, background:'var(--text-3)', borderRadius:2 }}/>OPEX</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>Firm hours by project · next 6 wks</h3></div>
          <div className="card-body">
            {Object.entries(projectCodes).map(([code, meta]) => {
              const hrs = stats.reduce((acc,s)=>acc + s.hoursByWeek.reduce((a,_,wi)=>a+((alloc[s.p[0]]?.[wi]||{})[code]||0),0), 0);
              if (hrs===0) return null;
              const maxAny = Math.max(...Object.keys(projectCodes).map(c => stats.reduce((acc,s)=>acc + s.hoursByWeek.reduce((a,_,wi)=>a+((alloc[s.p[0]]?.[wi]||{})[c]||0),0), 0)));
              return (
                <div key={code} style={{ display:'grid', gridTemplateColumns:'100px 1fr 60px', gap:10, padding:'6px 0', alignItems:'center', fontSize:12 }}>
                  <div className="row gap-sm"><span style={{ width:8, height:8, borderRadius:2, background:meta.color }}/><b style={{ fontFamily:'var(--font-mono)' }}>{code}</b></div>
                  <div style={{ background:'var(--bg-subtle)', height:8, borderRadius:2, overflow:'hidden' }}>
                    <div style={{ width:`${hrs/maxAny*100}%`, height:'100%', background:meta.color }}/>
                  </div>
                  <div className="num mono"><b>{hrs}h</b></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    )}

    {view==='heatmap' && (
      <div className="grid g2" style={{ marginTop:14 }}>
        <div className="card">
          <div className="card-header"><h3>⚠ Underutilised — people with bandwidth</h3><Badge tone="amber">{underutilised.length}</Badge></div>
          <div className="card-body">
            <div className="txt-sm txt-muted" style={{ marginBottom:10 }}>Below role target by 10+ points over the next {weeks.length} weeks. Consider re-staffing onto active projects or assigning to BD/FHO work.</div>
            {underutilised.length===0 && <div className="txt-sm txt-muted">Nobody flagged · firm is well-utilised 👌</div>}
            {underutilised.map(s => (
              <div key={s.p[0]} style={{ display:'grid', gridTemplateColumns:'auto 1fr auto auto', gap:12, padding:'10px 0', borderBottom:'1px solid var(--divider)', alignItems:'center' }}>
                <Avatar>{s.p[0]}</Avatar>
                <div>
                  <div><b>{s.p[0]}</b> <span className="txt-sm txt-muted">· {s.p[2]}</span></div>
                  <div className="txt-sm" style={{ color:'var(--amber)' }}>{s.util}% util · target {s.p[5]}% · {s.underWeeks} weeks below 50% FTE</div>
                </div>
                <div className="txt-sm txt-muted" style={{ fontSize:11 }}>avail<br/><b className="mono" style={{ color:'var(--text)' }}>{Math.max(0, s.fteHours - Math.max(...s.hoursByWeek))}h/wk</b></div>
                <div className="row gap-sm"><Btn sm onClick={()=>window.__nav && window.__nav('projects')}>Assign</Btn><Btn sm ghost onClick={()=>window.__nav && window.__nav('bd')}>→ BD</Btn></div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>⚠ Overbooked — bandwidth at risk</h3><Badge tone="red">{overbooked.length}</Badge></div>
          <div className="card-body">
            <div className="txt-sm txt-muted" style={{ marginBottom:10 }}>Weeks where allocation exceeds FTE capacity. Risk: quality, burnout, timesheet-reality gap.</div>
            {overbooked.length===0 && <div className="txt-sm txt-muted">No overbooked weeks · good.</div>}
            {overbooked.map(s => {
              const maxH = Math.max(...s.hoursByWeek);
              const worstWeek = weeks[s.hoursByWeek.indexOf(maxH)];
              return (
                <div key={s.p[0]} style={{ display:'grid', gridTemplateColumns:'auto 1fr auto auto', gap:12, padding:'10px 0', borderBottom:'1px solid var(--divider)', alignItems:'center' }}>
                  <Avatar>{s.p[0]}</Avatar>
                  <div>
                    <div><b>{s.p[0]}</b> <span className="txt-sm txt-muted">· {s.p[2]}</span></div>
                    <div className="txt-sm" style={{ color:'var(--red)' }}>{s.overbookedWeeks} overbooked wk(s) · peak {maxH}h ({worstWeek}) vs {s.fteHours}h FTE</div>
                  </div>
                  <div className="txt-sm txt-muted" style={{ fontSize:11 }}>overflow<br/><b className="mono" style={{ color:'var(--red)' }}>+{maxH - s.fteHours}h</b></div>
                  <div className="row gap-sm"><Btn sm onClick={()=>window.__nav && window.__nav('projects')}>Re-staff</Btn><Btn sm ghost onClick={()=>window.__nav && window.__nav('projects')}>Extend</Btn></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    )}

    {view==='heatmap' && (
      <div className="card" style={{ marginTop:14 }}>
        <div className="card-header"><h3>Internal codes · FHO***</h3><div className="txt-sm txt-muted">BD and firm-building work that consumes real bandwidth</div></div>
        <table className="tbl">
          <thead><tr><th>Code</th><th>Category</th><th>Owner</th><th className="num">Hrs next 6wks</th><th className="num">People</th><th>Notes</th></tr></thead>
          <tbody>
            <tr><td className="code-cell"><b>FHO001</b></td><td>BD · pitching</td><td><Avatar size={22}>TT</Avatar></td><td className="num">74h</td><td className="num">5</td><td className="txt-sm">NXS001 pitch · BMX phase 2 intro</td></tr>
            <tr><td className="code-cell"><b>FHO002</b></td><td>BD · proposals</td><td><Avatar size={22}>MB</Avatar></td><td className="num">48h</td><td className="num">3</td><td className="txt-sm">PNC002 SOW · KLX001 redline</td></tr>
            <tr><td className="code-cell"><b>FHO003</b></td><td>Firm-building</td><td><Avatar size={22}>TT</Avatar></td><td className="num">30h</td><td className="num">4</td><td className="txt-sm">Partner true-up · culture · ops</td></tr>
            <tr><td className="code-cell"><b>FHO004</b></td><td>Hiring · recruiting</td><td><Avatar size={22}>JS</Avatar></td><td className="num">8h</td><td className="num">1</td><td className="txt-sm">2 FT roles open · screening</td></tr>
            <tr><td className="code-cell"><b>OPEX</b></td><td>Office / admin</td><td><Avatar size={22}>JS</Avatar></td><td className="num">228h</td><td className="num">1</td><td className="txt-sm">100% JS · bookkeeping, sync</td></tr>
          </tbody>
        </table>
        <div className="card-body"><Callout tone="info"><span className="txt-sm">FHO codes track real hours toward BD and firm work (non-billable). They count toward utilisation for <b>partners</b> but not junior billable staff. Surfaced in partner true-up as <b>firm-building</b> effort.</span></Callout></div>
      </div>
    )}
    {openRow && window.ResourceRowDrawer && <window.ResourceRowDrawer s={openRow} weeks={weeks} alloc={alloc} onClose={()=>setOpenRow(null)}/>}
  </>);
};

Object.assign(window, { ResourcePlanning });
