import { useEffect, useState } from 'react';
import ActivityPanel from './ActivityPanel.jsx';
import AdminPanel from './AdminPanel.jsx';
import OverviewPanel from './OverviewPanel.jsx';
import ProjectsPanel from './ProjectsPanel.jsx';
import TasksPanel from './TasksPanel.jsx';

function Brand({ onDark = false, mobile = false }) {
  const classes = ['brand', onDark ? 'brand-on-dark' : '', mobile ? 'mobile-brand' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path d="M7 8.5h11a7 7 0 0 1 0 14H7v-5h11a2 2 0 1 0 0-4H7v-5Z" fill="currentColor" />
          <path d="M7 8.5v14" stroke={onDark ? '#A5F3D0' : '#0E9F6E'} strokeWidth="3" strokeLinecap="round" />
        </svg>
      </span>
      <span className="brand-name">IPTMS</span>
    </div>
  );
}

function WelcomePanel() {
  return (
    <section className="welcome-panel" aria-labelledby="welcome-title">
      <Brand onDark />

      <div className="welcome-copy">
        <p className="eyebrow">One place for your team's work</p>
        <h1 id="welcome-title">Make good work<br />move forward.</h1>
        <p className="welcome-description">
          Bring projects, people and progress together in a workspace built for your team.
        </p>
      </div>

      <div className="preview-card" aria-label="Illustrative project progress preview">
        <div className="preview-heading">
          <div>
            <span className="preview-label">PROJECT OVERVIEW</span>
            <strong>Website redesign</strong>
          </div>
          <span className="preview-dots" aria-hidden="true">•••</span>
        </div>
        <div className="preview-progress-row">
          <span>Project progress</span>
          <strong>68%</strong>
        </div>
        <div className="progress-track" aria-hidden="true"><span /></div>
        <div className="preview-footer">
          <div className="avatar-stack" aria-label="Project team">
            <span className="avatar avatar-one">AR</span>
            <span className="avatar avatar-two">MK</span>
            <span className="avatar avatar-three">JD</span>
            <span className="avatar avatar-more">+3</span>
          </div>
          <span className="preview-task-count"><span className="check-icon" aria-hidden="true">✓</span> 12 of 18 tasks</span>
        </div>
      </div>

      <div className="welcome-bottom">
        <span className="status-dot" aria-hidden="true" />
        <span>Projects stay clear. Teams stay in sync.</span>
      </div>
    </section>
  );
}

function EmailIcon() {
  return (
    <svg className="field-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="m5 7 7 5.5L19 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="field-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.5" y="10" width="15" height="10.5" rx="2.3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="15" r="1.2" fill="currentColor" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2.5 12s3.3-6 9.5-6 9.5 6 9.5 6-3.3 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function SignIn({ onSubmit, error, busy }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({ email, password });
  }

  return (
    <section className="form-panel" aria-labelledby="signin-title">
      <Brand mobile />

      <div className="signin-card">
        <div className="signin-heading">
          <p className="eyebrow eyebrow-light">WELCOME BACK</p>
          <h2 id="signin-title">Sign in to your account</h2>
          <p>Enter your work email and password to continue.</p>
        </div>

        {error && (
          <div className="form-alert" role="alert">
            <span className="alert-icon" aria-hidden="true">!</span>
            {error}
          </div>
        )}

        <form className="signin-form" onSubmit={handleSubmit}>
          <div className="field-group">
            <label htmlFor="email">Work email</label>
            <div className="input-wrap">
              <EmailIcon />
              <input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                placeholder="you@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoFocus
                disabled={busy}
              />
            </div>
          </div>

          <div className="field-group">
            <label htmlFor="password">Password</label>
            <div className="input-wrap">
              <LockIcon />
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={busy}
              />
              <button
                className="password-toggle"
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                disabled={busy}
              >
                <EyeIcon />
              </button>
            </div>
          </div>

          <button className="submit-button" type="submit" disabled={busy}>
            <span>{busy ? 'Signing in…' : 'Sign in'}</span>
            {!busy && (
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M4 10h11m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </form>

        <p className="access-note">Need an account? Contact your system administrator.</p>
      </div>

      <footer className="form-footer">
        <span>© {new Date().getFullYear()} IPTMS</span>
        <span className="footer-divider" aria-hidden="true" />
        <span>Internal Project &amp; Task Management System</span>
      </footer>
    </section>
  );
}

function formatRole(role) {
  return ({ admin: 'Admin', project_lead: 'Project Lead', employee: 'Employee' })[role] || role;
}

function Workspace({ user, onLogout, busy, view, onNavigate }) {
  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <Brand />
        <div className="workspace-user">
          <div className="user-summary">
            <span className="user-name">{user.name}</span>
            <span className="user-role">{formatRole(user.role)}</span>
          </div>
          <button className="signout-link" type="button" onClick={onLogout} disabled={busy}>Sign out</button>
        </div>
      </header>

      {view === 'people' && user.role === 'admin' ? (
        <AdminPanel onBack={() => onNavigate('overview')} />
      ) : view === 'projects' && user.role !== 'employee' ? (
        <ProjectsPanel user={user} onBack={() => onNavigate('overview')} />
      ) : view === 'tasks' ? (
        <TasksPanel user={user} onBack={() => onNavigate('overview')} />
      ) : view === 'activity' ? (
        <ActivityPanel onBack={() => onNavigate('overview')} />
      ) : (
        <OverviewPanel user={user} onNavigate={onNavigate} />
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [workspaceView, setWorkspaceView] = useState('overview');

  useEffect(() => {
    let active = true;

    fetch('/api/auth/me', { credentials: 'include' })
      .then(async (response) => {
        if (response.status === 401) return null;
        if (!response.ok) throw new Error('The sign-in service returned an error.');
        const data = await response.json();
        return data.user;
      })
      .then((currentUser) => {
        if (active && currentUser) setUser(currentUser);
      })
      .catch(() => {
        if (active) setError('The sign-in service is unavailable. Start the Node app and try again.');
      })
      .finally(() => {
        if (active) setCheckingSession(false);
      });

    return () => { active = false; };
  }, []);

  async function handleLogin(credentials) {
    setBusy(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to sign in. Please try again.');
      setUser(data.user);
    } catch (requestError) {
      setError(requestError.message || 'The sign-in service is unavailable. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      setUser(null);
      setWorkspaceView('overview');
      setError('');
      setBusy(false);
    }
  }

  if (checkingSession) {
    return (
      <div className="loading-screen" role="status">
        <span className="loading-spinner" aria-hidden="true" />
        <span>Opening your workspace…</span>
      </div>
    );
  }

  if (user) {
    return (
      <Workspace
        user={user}
        onLogout={handleLogout}
        busy={busy}
        view={workspaceView}
        onNavigate={setWorkspaceView}
      />
    );
  }

  return (
    <main className="auth-layout auth-page">
      <WelcomePanel />
      <SignIn onSubmit={handleLogin} error={error} busy={busy} />
    </main>
  );
}
