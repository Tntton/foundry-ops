// Resource planning + Trueup drawers

const ResourceRowDrawer = ({ s, weeks, alloc, onClose }) => {
  if (!s) return null;
  const [code, name, role, fte, type, target] = s.p;
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e=>e.stopPropagation()} style={{ width: 780 }}>
        <div className="drawer-header">
          <div>
            <div className="txt-sm txt-muted">Resource plan · {code}</div>
            <h2 style={{ margin:'4px 0 0', fontFamily:'var(--font-serif)', fontWeight:400, fontSize:24 }}>{code} — {name}</h2>
            <div className="row gap-sm" style={{ marginTop:6, alignItems:'center' }}>
              <Badge>{role}</Badge>
              <span className="txt-sm txt-muted">FTE {fte??'—'} · target {target}% · avg <b style={{ color: s.util<target-10?'var(--amber)':s.util>target+10?'var(--green)':'var(--text)' }}>{s.util}%</b></span>
            </div>
          </div>
          <div className="row gap-sm"><Btn sm icon="plus">Add allocation</Btn><Btn sm ghost onClick={onClose}>✕</Btn></div>
        </div>
        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          <div className="stack">
            <div className="grid g3">
              <div className="card kpi"><div className="label">Billable</div><div className="value">{s.billable}h</div><div className="sub">revenue-generating</div></div>
              <div className="card kpi"><div className="label">BD + firm-building</div><div className="value">{s.bd + s.firm}h</div><div className="sub">FHO codes</div></div>
              <div className="card kpi"><div className="label">Flags</div><div className="value" style={{ color: s.overbookedWeeks? 'var(--red)': s.underWeeks? 'var(--amber)':'var(--green)' }}>{s.overbookedWeeks? `${s.overbookedWeeks} over` : s.underWeeks? `${s.underWeeks} under` : 'balanced'}</div><div className="sub">weeks</div></div>
            </div>
            <div className="card">
              <div className="card-header"><h3>Week-by-week allocation</h3></div>
              <table className="tbl">
                <thead><tr><th>Week</th><th className="num">Hours</th><th className="num">% FTE</th><th>Projects</th></tr></thead>
                <tbody>
                  {s.hoursByWeek.map((h,wi)=>{
                    const items = Object.entries(alloc[code]?.[wi]||{});
                    const pct = s.fteHours>0 ? Math.round(h/s.fteHours*100) : 0;
                    const tone = pct>100 ? 'red' : pct<50 ? 'amber' : 'green';
                    return (
                      <tr key={wi}>
                        <td className="mono">{weeks[wi]}</td>
                        <td className="num"><b>{h}h</b></td>
                        <td className="num"><Badge tone={tone} dot>{pct}%</Badge></td>
                        <td className="txt-sm">{items.map(([p,v])=>`${p} ${v}h`).join(' · ') || <span className="txt-muted">no allocation</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="row gap-sm"><Btn sm onClick={()=>{ onClose&&onClose(); window.__nav && window.__nav('directory'); }}>Open full profile →</Btn><Btn sm onClick={()=>{ onClose&&onClose(); window.__nav && window.__nav('projects'); }}>View projects →</Btn></div>
          </div>
        </div>
        <div className="drawer-footer" style={{ borderTop:'1px solid var(--border)', padding:'12px 20px', display:'flex', gap:8, justifyContent:'flex-end' }}>
          <Btn sm>Rebalance</Btn>
          <Btn sm primary>Save</Btn>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { ResourceRowDrawer });
