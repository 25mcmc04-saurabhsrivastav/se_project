import { useEffect, useMemo, useState } from 'react';

const emptyUser = {
  name: '',
  email: '',
  password: '',
  role: 'employee',
  department: '',
  designation: '',
  status: 'active',
};

const emptyTeam = {
  team_name: '',
  description: '',
  team_lead_id: '',
  member_ids: [],
};

const roleLabels = {
  admin: 'Admin',
  project_lead: 'Project lead',
  employee: 'Employee',
};

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}

function UserForm({ value, saving, error, onChange, onCancel, onSubmit }) {
  const isEditing = Boolean(value.user_id);
  return (
    <section className="admin-form-card" aria-labelledby="user-form-title">
      <div className="admin-form-heading">
        <div>
          <p className="eyebrow eyebrow-light">{isEditing ? 'ACCOUNT SETTINGS' : 'NEW ACCOUNT'}</p>
          <h2 id="user-form-title">{isEditing ? 'Edit account' : 'Create an account'}</h2>
        </div>
        <button className="text-button" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
      {error && <div className="inline-alert" role="alert">{error}</div>}
      <form className="admin-form-grid" onSubmit={onSubmit}>
        <label className="admin-field">
          <span>Full name</span>
          <input maxLength="100" value={value.name} onChange={(event) => onChange('name', event.target.value)} required />
        </label>
        <label className="admin-field">
          <span>Work email</span>
          <input type="email" maxLength="150" value={value.email} onChange={(event) => onChange('email', event.target.value)} required />
        </label>
        <label className="admin-field">
          <span>{isEditing ? 'Set a new password (optional)' : 'Initial password'}</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength="10"
            maxLength="72"
            placeholder={isEditing ? 'Leave blank to keep current password' : 'At least 10 characters'}
            value={value.password}
            onChange={(event) => onChange('password', event.target.value)}
            required={!isEditing}
          />
        </label>
        <label className="admin-field">
          <span>Role</span>
          <select value={value.role} onChange={(event) => onChange('role', event.target.value)}>
            <option value="employee">Employee</option>
            <option value="project_lead">Project lead</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="admin-field">
          <span>Department</span>
          <input maxLength="100" value={value.department || ''} onChange={(event) => onChange('department', event.target.value)} />
        </label>
        <label className="admin-field">
          <span>Designation</span>
          <input maxLength="100" value={value.designation || ''} onChange={(event) => onChange('designation', event.target.value)} />
        </label>
        {isEditing && (
          <label className="admin-field">
            <span>Account status</span>
            <select value={value.status} onChange={(event) => onChange('status', event.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        )}
        <div className="admin-form-actions">
          <p className="form-hint">
            {isEditing
              ? 'Inactive accounts cannot sign in and are removed from team, project, and task assignments. Reassign any owned projects before deactivation.'
              : 'Share the initial password securely. You can reset it from Edit account.'}
          </p>
          <button className="primary-action" type="submit" disabled={saving}>
            {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create account'}
          </button>
        </div>
      </form>
    </section>
  );
}

function TeamForm({ value, users, saving, error, onChange, onCancel, onSubmit }) {
  const eligibleLeads = users.filter((user) => user.status === 'active' && ['admin', 'project_lead'].includes(user.role));
  const activeUsers = users.filter((user) => user.status === 'active');
  const selectedMembers = new Set((value.member_ids || []).map(Number));

  function toggleMember(userId) {
    const next = new Set(selectedMembers);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    onChange('member_ids', [...next]);
  }

  return (
    <section className="admin-form-card" aria-labelledby="team-form-title">
      <div className="admin-form-heading">
        <div>
          <p className="eyebrow eyebrow-light">{value.team_id ? 'TEAM SETTINGS' : 'NEW TEAM'}</p>
          <h2 id="team-form-title">{value.team_id ? 'Edit team' : 'Create a team'}</h2>
        </div>
        <button className="text-button" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
      {error && <div className="inline-alert" role="alert">{error}</div>}
      <form className="admin-form-grid" onSubmit={onSubmit}>
        <label className="admin-field">
          <span>Team name</span>
          <input maxLength="100" value={value.team_name} onChange={(event) => onChange('team_name', event.target.value)} required />
        </label>
        <label className="admin-field">
          <span>Team lead</span>
          <select value={value.team_lead_id || ''} onChange={(event) => onChange('team_lead_id', event.target.value)}>
            <option value="">No team lead</option>
            {eligibleLeads.map((user) => (
              <option key={user.user_id} value={user.user_id}>{user.name} · {roleLabels[user.role]}</option>
            ))}
          </select>
        </label>
        <label className="admin-field admin-field-wide">
          <span>Description</span>
          <textarea rows="3" maxLength="5000" value={value.description || ''} onChange={(event) => onChange('description', event.target.value)} />
        </label>
        <fieldset className="member-picker">
          <legend>Team members <span>{selectedMembers.size} selected</span></legend>
          {activeUsers.length === 0 ? (
            <p className="empty-note">Create an active account before adding team members.</p>
          ) : (
            <div className="member-picker-list">
              {activeUsers.map((user) => (
                <label className="member-option" key={user.user_id}>
                  <input
                    type="checkbox"
                    checked={selectedMembers.has(Number(user.user_id))}
                    onChange={() => toggleMember(Number(user.user_id))}
                  />
                  <span className="member-option-copy">
                    <strong>{user.name}</strong>
                    <small>{user.email} · {roleLabels[user.role]}</small>
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <div className="admin-form-actions">
          <p className="form-hint">Only active accounts can be added to a team.</p>
          <button className="primary-action" type="submit" disabled={saving}>
            {saving ? 'Saving…' : value.team_id ? 'Save team' : 'Create team'}
          </button>
        </div>
      </form>
    </section>
  );
}

export default function AdminPanel({ onBack }) {
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [userDraft, setUserDraft] = useState(null);
  const [teamDraft, setTeamDraft] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  async function loadData(showSpinner = true) {
    if (showSpinner) setLoading(true);
    setPageError('');
    try {
      const [userData, teamData] = await Promise.all([
        request('/api/admin/users'),
        request('/api/admin/teams'),
      ]);
      setUsers(userData.users || []);
      setTeams(teamData.teams || []);
    } catch (error) {
      setPageError(error.message);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const visibleUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      const matchesQuery = !query || [
        user.name,
        user.email,
        user.department,
        user.designation,
        ...(user.teams || []),
      ].some((value) => String(value || '').toLowerCase().includes(query));
      const matchesRole = roleFilter === 'all' || user.role === roleFilter;
      const matchesStatus = statusFilter === 'all' || user.status === statusFilter;
      return matchesQuery && matchesRole && matchesStatus;
    });
  }, [users, search, roleFilter, statusFilter]);

  function openNewUser() {
    setNotice('');
    setFormError('');
    setUserDraft({ ...emptyUser });
    setTeamDraft(null);
  }

  function openEditUser(user) {
    setNotice('');
    setFormError('');
    setUserDraft({ ...user, password: '' });
    setTeamDraft(null);
  }

  function openNewTeam() {
    setNotice('');
    setFormError('');
    setTeamDraft({ ...emptyTeam });
    setUserDraft(null);
  }

  function openEditTeam(team) {
    setNotice('');
    setFormError('');
    setTeamDraft({
      team_id: team.team_id,
      team_name: team.team_name,
      description: team.description || '',
      team_lead_id: team.team_lead_id || '',
      member_ids: (team.members || []).map((member) => Number(member.user_id)),
    });
    setUserDraft(null);
  }

  function updateUserField(field, value) {
    setUserDraft((draft) => ({ ...draft, [field]: value }));
  }

  function updateTeamField(field, value) {
    setTeamDraft((draft) => ({ ...draft, [field]: value }));
  }

  async function saveUser(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    setNotice('');
    try {
      const payload = {
        name: userDraft.name,
        email: userDraft.email,
        role: userDraft.role,
        department: userDraft.department,
        designation: userDraft.designation,
      };
      if (userDraft.user_id) {
        payload.status = userDraft.status;
        if (userDraft.password) payload.password = userDraft.password;
        await request('/api/admin/users/' + userDraft.user_id, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        payload.password = userDraft.password;
        await request('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
      }
      setUserDraft(null);
      setNotice(userDraft.user_id ? 'Account updated.' : 'Account created.');
      await loadData(false);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveTeam(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    setNotice('');
    const isEditing = Boolean(teamDraft.team_id);
    const payload = {
      team_name: teamDraft.team_name,
      description: teamDraft.description,
      team_lead_id: teamDraft.team_lead_id ? Number(teamDraft.team_lead_id) : null,
      member_ids: teamDraft.member_ids.map(Number),
    };
    try {
      if (teamDraft.team_id) {
        await request('/api/admin/teams/' + teamDraft.team_id, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await request('/api/admin/teams', { method: 'POST', body: JSON.stringify(payload) });
      }
      setTeamDraft(null);
      setNotice(isEditing ? 'Team updated.' : 'Team created.');
      await loadData(false);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  const activeUserCount = users.filter((user) => user.status === 'active').length;
  const activeTeamCount = teams.length;

  return (
    <main className="admin-main">
      <div className="admin-intro">
        <div>
          <p className="eyebrow eyebrow-light">PEOPLE &amp; TEAMS</p>
          <h1>Manage your workspace</h1>
          <p>Create accounts, set roles, and organize people into teams.</p>
        </div>
        <div className="admin-stats" aria-label="Workspace totals">
          <div><strong>{activeUserCount}</strong><span>Active accounts</span></div>
          <div><strong>{activeTeamCount}</strong><span>Teams</span></div>
        </div>
        <button className="secondary-action admin-back-action" type="button" onClick={onBack}>Back to overview</button>
      </div>

      <div className="admin-toolbar">
        <div className="admin-tabs" role="tablist" aria-label="People and teams">
          <button className={activeTab === 'users' ? 'admin-tab active' : 'admin-tab'} type="button" role="tab" aria-selected={activeTab === 'users'} onClick={() => { setActiveTab('users'); setUserDraft(null); setTeamDraft(null); setFormError(''); }}>
            Users <span>{users.length}</span>
          </button>
          <button className={activeTab === 'teams' ? 'admin-tab active' : 'admin-tab'} type="button" role="tab" aria-selected={activeTab === 'teams'} onClick={() => { setActiveTab('teams'); setUserDraft(null); setTeamDraft(null); setFormError(''); }}>
            Teams <span>{teams.length}</span>
          </button>
        </div>
        <button className="primary-action" type="button" onClick={activeTab === 'users' ? openNewUser : openNewTeam}>
          <span aria-hidden="true">+</span> {activeTab === 'users' ? 'Add user' : 'Add team'}
        </button>
      </div>

      {notice && <div className="success-notice" role="status">{notice}</div>}
      {pageError && <div className="inline-alert page-alert" role="alert">{pageError}</div>}

      {activeTab === 'users' && userDraft && (
        <UserForm
          value={userDraft}
          saving={saving}
          error={formError}
          onChange={updateUserField}
          onCancel={() => { setUserDraft(null); setFormError(''); }}
          onSubmit={saveUser}
        />
      )}
      {activeTab === 'teams' && teamDraft && (
        <TeamForm
          value={teamDraft}
          users={users}
          saving={saving}
          error={formError}
          onChange={updateTeamField}
          onCancel={() => { setTeamDraft(null); setFormError(''); }}
          onSubmit={saveTeam}
        />
      )}

      {activeTab === 'users' && (
        <section className="admin-list-card" aria-labelledby="users-list-title">
          <div className="list-card-heading">
            <div>
              <h2 id="users-list-title">User accounts</h2>
              <p>Manage access, roles, and team membership.</p>
            </div>
            <div className="list-filters">
              <label className="visually-hidden" htmlFor="user-search">Search users</label>
              <input id="user-search" type="search" placeholder="Search people…" value={search} onChange={(event) => setSearch(event.target.value)} />
              <label className="visually-hidden" htmlFor="role-filter">Filter by role</label>
              <select id="role-filter" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                <option value="all">All roles</option>
                <option value="admin">Admin</option>
                <option value="project_lead">Project lead</option>
                <option value="employee">Employee</option>
              </select>
              <label className="visually-hidden" htmlFor="status-filter">Filter by status</label>
              <select id="status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          {loading ? (
            <div className="admin-loading"><span className="loading-spinner" />Loading accounts…</div>
          ) : visibleUsers.length === 0 ? (
            <div className="admin-empty"><strong>No accounts found</strong><span>Try another search or add a user.</span></div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr><th>Person</th><th>Role</th><th>Department</th><th>Teams</th><th>Status</th><th><span className="visually-hidden">Actions</span></th></tr>
                </thead>
                <tbody>
                  {visibleUsers.map((user) => (
                    <tr key={user.user_id}>
                      <td>
                        <div className="person-cell">
                          <span className="person-avatar" aria-hidden="true">{user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
                          <span><strong>{user.name}</strong><small>{user.email}{user.designation ? ' · ' + user.designation : ''}</small></span>
                        </div>
                      </td>
                      <td><span className={'role-pill role-' + user.role}>{roleLabels[user.role] || user.role}</span></td>
                      <td>{user.department || <span className="muted-cell">—</span>}</td>
                      <td>
                        {(user.teams || []).length
                          ? <div className="team-chip-list">{user.teams.map((team) => <span className="team-chip" key={team}>{team}</span>)}</div>
                          : <span className="muted-cell">No team</span>}
                      </td>
                      <td><span className={'status-pill status-' + user.status}>{user.status}</span></td>
                      <td className="table-action-cell"><button className="text-button" type="button" onClick={() => openEditUser(user)}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === 'teams' && (
        <section className="admin-list-card" aria-labelledby="teams-list-title">
          <div className="list-card-heading">
            <div>
              <h2 id="teams-list-title">Teams</h2>
              <p>Assign an active lead and bring members together.</p>
            </div>
          </div>
          {loading ? (
            <div className="admin-loading"><span className="loading-spinner" />Loading teams…</div>
          ) : teams.length === 0 ? (
            <div className="admin-empty"><strong>No teams yet</strong><span>Create a team and add active accounts as members.</span></div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table team-table">
                <thead><tr><th>Team</th><th>Team lead</th><th>Members</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
                <tbody>
                  {teams.map((team) => (
                    <tr key={team.team_id}>
                      <td><div className="team-name-cell"><strong>{team.team_name}</strong><small>{team.description || 'No description'}</small></div></td>
                      <td>{team.team_lead_name || <span className="muted-cell">Not assigned</span>}</td>
                      <td><span className="member-count">{team.member_count} {team.member_count === 1 ? 'member' : 'members'}</span></td>
                      <td className="table-action-cell"><button className="text-button" type="button" onClick={() => openEditTeam(team)}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
