// screens-auth.jsx — Login, SSO flow, Logout
// Wraps the app. If not authenticated, renders the login page.
// Exports: window.AuthGate, window.useAuth

const AUTH_LS_KEY = 'foundry.auth.v1';

const loadAuth = () => {
  try { return JSON.parse(localStorage.getItem(AUTH_LS_KEY) || 'null'); } catch(_) { return null; }
};
const saveAuth = (a) => {
  try { if (a) localStorage.setItem(AUTH_LS_KEY, JSON.stringify(a)); else localStorage.removeItem(AUTH_LS_KEY); } catch(_){}
};

// ---- Microsoft icon (6-square logo) ----
const MicrosoftLogo = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ display:'block' }}>
    <rect x="1"  y="1"  width="10" height="10" fill="#F25022"/>
    <rect x="13" y="1"  width="10" height="10" fill="#7FBA00"/>
    <rect x="1"  y="13" width="10" height="10" fill="#00A4EF"/>
    <rect x="13" y="13" width="10" height="10" fill="#FFB900"/>
  </svg>
);

// ---- Identity helper: pick a default person per role for the prototype ----
const ROLE_DEFAULT_IDENTITY = {
  mgpartner: 'TT',
  partner:   'MB',
  manager:   'MB',
  office:    'JS',
  consultant:'CC',
};
const ROLE_CHOICES = [
  { id:'mgpartner', label:'Super Admin',   initials:'TT' },
  { id:'office',    label:'Admin',         initials:'JS' },
  { id:'partner',   label:'Partner',       initials:'MB' },
  { id:'manager',   label:'Manager',       initials:'MB' },
  { id:'consultant',label:'Staff',         initials:'CC' },
];

// ---- SSO simulation ----
// Renders a modal that mimics the Microsoft login redirect.
const SSOModal = ({ onClose, onSuccess, initialEmail }) => {
  const [step, setStep] = React.useState('email'); // email → password → mfa → auth → done
  const [email, setEmail] = React.useState(initialEmail || '');
  const [pw, setPw] = React.useState('');
  const [err, setErr] = React.useState('');
  const [roleOverride, setRoleOverride] = React.useState(null);

  const tenantOk = email.toLowerCase().endsWith('@foundry.health');

  React.useEffect(()=>{
    if (step === 'auth') {
      const t = setTimeout(()=> setStep('picker'), 900);
      return ()=>clearTimeout(t);
    }
  },[step]);

  const submitEmail = (e) => {
    e.preventDefault(); setErr('');
    if (!email.includes('@')) { setErr('Enter a valid email'); return; }
    if (!tenantOk) { setErr('Your organisation is not set up for Foundry Ops.'); return; }
    setStep('password');
  };
  const submitPw = (e) => {
    e.preventDefault(); setErr('');
    if (pw.length < 1) { setErr('Enter your password'); return; }
    setStep('mfa');
  };
  const submitMfa = () => { setErr(''); setStep('auth'); };

  const finish = (roleId) => {
    const initials = ROLE_DEFAULT_IDENTITY[roleId] || 'TT';
    onSuccess({
      email: email || 'tony@foundry.health',
      role: roleId,
      initials,
      method: 'm365-sso',
      tenant: 'foundryhealth.onmicrosoft.com',
      signedInAt: new Date().toISOString(),
    });
  };

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="sso-card" onClick={e=>e.stopPropagation()}>
        <div className="sso-brandbar">
          <MicrosoftLogo size={22}/>
          <span className="sso-brandtxt">Microsoft</span>
        </div>

        {step==='email' && (
          <form onSubmit={submitEmail} className="sso-body">
            <div className="sso-title">Sign in</div>
            <input
              autoFocus
              className="sso-input"
              type="email"
              placeholder="Email, phone, or Skype"
              value={email}
              onChange={e=>setEmail(e.target.value)}
            />
            {err && <div className="sso-err">{err}</div>}
            <div className="sso-link-row">
              <a href="#" onClick={e=>e.preventDefault()}>No account? Create one!</a>
              <a href="#" onClick={e=>e.preventDefault()}>Can't access your account?</a>
            </div>
            <div className="sso-actions">
              <button type="button" className="sso-btn ghost" onClick={onClose}>Back</button>
              <button type="submit" className="sso-btn primary">Next</button>
            </div>
            <div className="sso-tenant-hint">
              Tenant-restricted · only <b>@foundry.health</b> accounts accepted
            </div>
          </form>
        )}

        {step==='password' && (
          <form onSubmit={submitPw} className="sso-body">
            <button type="button" className="sso-backlink" onClick={()=>setStep('email')}>← {email}</button>
            <div className="sso-title">Enter password</div>
            <input
              autoFocus
              className="sso-input"
              type="password"
              placeholder="Password"
              value={pw}
              onChange={e=>setPw(e.target.value)}
            />
            {err && <div className="sso-err">{err}</div>}
            <div className="sso-link-row">
              <a href="#" onClick={e=>e.preventDefault()}>Forgot password?</a>
            </div>
            <div className="sso-actions">
              <div style={{ flex:1 }}/>
              <button type="submit" className="sso-btn primary">Sign in</button>
            </div>
          </form>
        )}

        {step==='mfa' && (
          <div className="sso-body">
            <button type="button" className="sso-backlink" onClick={()=>setStep('password')}>← {email}</button>
            <div className="sso-title">Approve sign-in request</div>
            <div className="sso-mfa-card">
              <div className="sso-mfa-num">42</div>
              <div className="sso-mfa-txt">
                Open your <b>Microsoft Authenticator</b> app and enter the number shown to sign in.
              </div>
            </div>
            <label className="sso-checkbox">
              <input type="checkbox"/> Don't ask again for 30 days
            </label>
            <div className="sso-actions">
              <button type="button" className="sso-btn ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="sso-btn primary" onClick={submitMfa}>I approved</button>
            </div>
          </div>
        )}

        {step==='auth' && (
          <div className="sso-body">
            <div className="sso-title">Signing you in…</div>
            <div className="sso-spinner"/>
            <div className="sso-substep">Checking tenant foundryhealth.onmicrosoft.com</div>
            <div className="sso-substep">Verifying conditional access policy</div>
            <div className="sso-substep">Provisioning session token</div>
          </div>
        )}

        {step==='picker' && (
          <div className="sso-body">
            <div className="sso-title" style={{ fontSize:16 }}>Choose role to continue</div>
            <div className="sso-subtle">Prototype only — production uses role claim from Entra ID group</div>
            <div className="sso-roles">
              {ROLE_CHOICES.map(r => (
                <button key={r.id} className="sso-role" onClick={()=>finish(r.id)}>
                  <div className="sso-role-av">{r.initials}</div>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontWeight:600, fontSize:13 }}>{r.label}</div>
                    <div className="txt-sm txt-muted" style={{ fontSize:11 }}>
                      {r.id==='mgpartner' && 'Tony Tang'}
                      {r.id==='partner' && 'Matthew Brown'}
                      {r.id==='manager' && 'Matthew Brown'}
                      {r.id==='office' && 'Jordan Smith'}
                      {r.id==='consultant' && 'Caroline Chen'}
                    </div>
                  </div>
                  <span className="sso-role-arrow">→</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ---- Login Page ----
const LoginPage = ({ onSignedIn }) => {
  const [ssoOpen, setSsoOpen] = React.useState(false);
  const [magicOpen, setMagicOpen] = React.useState(false);
  const [magicEmail, setMagicEmail] = React.useState('');
  const [magicSent, setMagicSent] = React.useState(false);

  const sendMagic = (e) => {
    e.preventDefault();
    if (!magicEmail.includes('@')) return;
    setMagicSent(true);
    setTimeout(()=>{
      onSignedIn({
        email: magicEmail,
        role: 'consultant',
        initials: (magicEmail[0] || 'G').toUpperCase()+'?',
        method: 'magic-link',
        tenant: null,
        signedInAt: new Date().toISOString(),
      });
    }, 1400);
  };

  return (
    <div className="auth-shell">
      <div className="auth-bg" aria-hidden="true">
        <div className="auth-bg-grid"/>
        <div className="auth-bg-glow a"/>
        <div className="auth-bg-glow b"/>
      </div>

      <div className="auth-simple">
        <div className="auth-simple-brand">
          <div className="auth-brand-mark"><img src="assets/fh-mark.png" alt="FH"/></div>
          <div className="auth-simple-title">Foundry Health</div>
          <div className="auth-simple-sub">Operations &amp; Admin Platform</div>
        </div>

        <div className="auth-simple-card">
          <button className="sso-big-btn" onClick={()=>setSsoOpen(true)}>
            <MicrosoftLogo size={20}/>
            <span>Sign in with Microsoft 365</span>
          </button>

          <button className="auth-alt-link" onClick={()=>setMagicOpen(m=>!m)}>
            Contractor / supplier? Sign in with email →
          </button>

          {magicOpen && !magicSent && (
            <form onSubmit={sendMagic} className="auth-magic">
              <input
                type="email"
                className="auth-input"
                placeholder="you@company.com"
                value={magicEmail}
                onChange={e=>setMagicEmail(e.target.value)}
                autoFocus
              />
              <button type="submit" className="auth-magic-send">Send magic link →</button>
            </form>
          )}
          {magicOpen && magicSent && (
            <div className="auth-magic sent">
              <div className="magic-check">✓</div>
              <div style={{ fontWeight:600, marginTop:6 }}>Link sent to {magicEmail}</div>
              <div className="txt-sm txt-muted" style={{ fontSize:12, marginTop:4 }}>Signing you in…</div>
            </div>
          )}
        </div>

        <div className="auth-simple-foot">
          © 2026 Foundry Health Pty Ltd · tenant-restricted SSO
        </div>
      </div>

      {ssoOpen && (
        <SSOModal
          onClose={()=>setSsoOpen(false)}
          onSuccess={(s)=>{ setSsoOpen(false); onSignedIn(s); }}
        />
      )}
    </div>
  );
};

// ---- Logout page (shown briefly after sign-out) ----
const LogoutPage = ({ session, onDone }) => {
  const [stage, setStage] = React.useState('wrapping'); // wrapping → done
  React.useEffect(()=>{
    const t1 = setTimeout(()=>setStage('done'), 1400);
    return ()=>clearTimeout(t1);
  },[]);
  return (
    <div className="auth-shell">
      <div className="auth-bg" aria-hidden="true">
        <div className="auth-bg-grid"/>
        <div className="auth-bg-glow a"/>
        <div className="auth-bg-glow b"/>
      </div>
      <div className="logout-wrap">
        <div className="logout-card">
          <div className="logout-mark"><img src="assets/fh-mark.png" alt="FH"/></div>

          {stage==='wrapping' && (
            <>
              <div className="logout-spinner"/>
              <h2 className="logout-title">Signing out…</h2>
              <ul className="logout-steps">
                <li className="done">Closing session for {session?.email || 'you'}</li>
                <li className="done">Clearing local cache</li>
                <li className="doing">Revoking Microsoft 365 session token</li>
                <li>Flushing draft auto-saves to OneDrive</li>
              </ul>
            </>
          )}
          {stage==='done' && (
            <>
              <div className="logout-check">✓</div>
              <h2 className="logout-title">You've signed out</h2>
              <div className="logout-sub">
                Signed out of Foundry Ops for <b>{session?.email || 'your account'}</b>.
                Your Microsoft 365 session may still be active in other apps.
              </div>
              <div className="logout-actions">
                <button className="sso-big-btn" onClick={onDone}>
                  <MicrosoftLogo size={18}/>
                  <span>Sign back in</span>
                </button>
                <a href="https://login.microsoftonline.com/logout.srf" className="logout-full" onClick={e=>e.preventDefault()}>
                  Also sign out of Microsoft 365 →
                </a>
              </div>
              <div className="logout-tip txt-sm txt-muted">
                Tip: close this tab if you're on a shared computer.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ---- AuthGate wrapper ----
const AuthGate = ({ children }) => {
  const [session, setSession] = React.useState(loadAuth);
  const [loggingOut, setLoggingOut] = React.useState(false);

  const signIn = (s) => { saveAuth(s); setSession(s); setLoggingOut(false); };
  const signOut = () => {
    setLoggingOut(true);
    // keep session visible on logout page until user clicks back in
  };
  const confirmSignOut = () => {
    saveAuth(null);
    setSession(null);
    setLoggingOut(false);
  };

  // Expose globally so AvatarMenu (and anywhere else) can trigger sign-out
  React.useEffect(()=>{
    window.__auth = {
      session,
      signOut,
      signIn,
      isAuthed: !!session,
    };
    return ()=>{ delete window.__auth; };
  }, [session]);

  if (loggingOut) {
    return <LogoutPage session={session} onDone={confirmSignOut}/>;
  }
  if (!session) {
    return <LoginPage onSignedIn={signIn}/>;
  }
  // pass session down to children via render-prop OR global (use both, they're cheap)
  return typeof children === 'function' ? children(session) : children;
};

// Expose globally (since Babel scripts don't share scope)
Object.assign(window, { AuthGate, LoginPage, LogoutPage, SSOModal, MicrosoftLogo });
