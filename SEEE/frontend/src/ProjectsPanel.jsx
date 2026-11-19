import { useEffect, useMemo, useState } from 'react';

const statusLabels = {
  planning: 'Planning',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const emptyProject = {
  project_name: '',
  description: '',
  lead_id: '',
  start_date: '',
  end_date: '',
  status: 'planning',
  member_ids: [],
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

function ProjectForm({ value, user, users, leads, teams, saving, error, onChange, onCancel, onSubmit }) {
  const isEditing = Boolean(value.project_id);
  const isAdmin = user.role === 'admin';
  const selectedMembers = new Set((value.member_ids || []).map(Number));
  const [teamToAdd, setTeamToAdd] = useState('');
  const [teamNote, setTeamNote] = useState('');

  function addTeam() {
    const team = teams.find((item) => item.team_id === Number(teamToAdd));
    if (!team) return;
    const next = new Set(selectedMembers);
    const before = next.size;
    for (const memberId of team.member_ids) next.add(Number(memberId));
    onChange('member_ids', [...next]);
    const added = next.size - before;
    setTeamNote(added === 0
      ? 'Everyone in ' + team.team_name + ' is already a member.'
      : 'Added ' + added + ' member' + (added === 1 ? '' : 's') + ' from ' + team.team_name + '. Save to apply.');
    setTeamToAdd('');
  }

  function toggleMember(userId) {
    const next = new Set(selectedMembers);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    onChange('member_ids', [...next]);
  }

  return (
    <section className="project-form-card" aria-labelledby="project-form-title">
      <div className="admin-form-heading">
        <div>
          <p className="eyebrow eyebrow-light">{isEditing ? 'PROJECT SETTINGS' : 'NEW PROJECT'}</p>
          <h2 id="project-form-title">{isEditing ? 'Edit project' : 'Create a project'}</h2>
        </div>
        <button className="text-button" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
      {error && <div className="inline-alert" role="alert">{error}</div>}
      <form className="admin-form-grid" onSubmit={onSubmit}>
        <label className="admin-field">
          <span>Project name</span>
          <input maxLength="150" value={value.project_name} onChange={(event) => onChange('project_name', event.target.value)} required />
        </label>
        <label className="admin-field">
          <span>Project lead</span>
          {isAdmin ? (
            <select value={value.lead_id || ''} onChange={(event) => onChange('lead_id', event.target.value ? Number(event.target.value) : '')} required>
              <option value="">Choose a lead</option>
              {leads.map((lead) => (
                <option key={lead.user_id} value={lead.user_id}>{lead.name} · {lead.role === 'admin' ? 'Admin' : 'Project lead'}</option>
              ))}
            </select>
          ) : (
            <input value={(value.lead_name || user.name) + (Number(value.lead_id) === Number(user.id) ? ' (you)' : '')} readOnly />
          )}
        </label>
        <label className="admin-field admin-field-wide">
          <span>Description</span>
          <textarea rows="3" maxLength="5000" value={value.description || ''} onChange={(event) => onChange('description', event.target.value)} />
        </label>
        <label className="admin-field">
          <span>Start date</span>
          <input type="date" value={value.start_date || ''} onChange={(event) => onChange('start_date', event.target.value)} />
        </label>
        <label className="admin-field">
          <span>End date</span>
          <input type="date" min={value.start_date || undefined} value={value.end_date || ''} onChange={(event) => onChange('end_date', event.target.value)} />
        </label>
        <label className="admin-field">
          <span>Status</span>
          <select value={value.status} onChange={(event) => onChange('status', event.target.value)}>
            <option value="planning">Planning</option>
            <option value="active">Active</option>
            <option value="on_hold">On hold</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <fieldset className="member-picker project-member-picker">
          <legend>Project members <span>{selectedMembers.size} selected</span></legend>
          <div className="team-add-row">
            <label className="admin-field">
              <span>Add a whole team</span>
              <select value={teamToAdd} onChange={(event) => { setTeamToAdd(event.target.value); setTeamNote(''); }}>
                <option value="">{teams.length ? 'Choose a team' : 'No teams yet'}</option>
                {teams.map((team) => (
                  <option key={team.team_id} value={team.team_id}>{team.team_name} ({team.member_ids.length} members)</option>
                ))}
              </select>
            </label>
            <button className="secondary-action" type="button" onClick={addTeam} disabled={!teamToAdd}>Add team</button>
          </div>
          {teamNote && <p className="form-hint">{teamNote}</p>}
          <p className="form-hint">You can also tick individual people below, now or later.</p>
          {users.length === 0 ? (
            <p className="empty-note">Create an active account before adding project members.</p>
          ) : (
            <div className="member-picker-list">
              {users.map((person) => (
                <label className="member-option" key={person.user_id}>
                  <input
                    type="checkbox"
                    checked={selectedMembers.has(Number(person.user_id))}
                    onChange={() => toggleMember(Number(person.user_id))}
                  />
                  <span className="member-option-copy">
                    <strong>{person.name}</strong>
                    <small>{person.email} · {person.role.replace('_', ' ')}</small>
                  </span>
                </label>
              ))}
            </div>
          )}
          <p className="form-hint project-lead-hint">The project lead is included in the project membership automatically.</p>
        </fieldset>
        <div className="admin-form-actions">
          <p className="form-hint">Only active accounts can be assigned. Progress is calculated from project tasks.</p>
          <button className="primary-action" type="submit" disabled={saving}>
            {saving ? 'Saving…' : isEditing ? 'Save project' : 'Create project'}
          </button>
        </div>
      </form>
    </section>
  );
}

function formatProjectDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function initials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function ProjectCard({ project, onEdit }) {
  const progress = Math.max(0, Math.min(100, Number(project.project_progress_percent) || 0));
  const dates = project.start_date || project.end_date
    ? [formatProjectDate(project.start_date), formatProjectDate(project.end_date)].filter(Boolean).join(' – ')
    : 'Dates not set';

  return (
    <article className="project-card">
      <div className="project-card-top">
        <span className={'project-status project-status-' + project.status}>{statusLabels[project.status] || project.status}</span>
        {project.can_edit && <button className="text-button" type="button" onClick={() => onEdit(project)}>Edit</button>}
      </div>
      <h2>{project.project_name}</h2>
      <p className="project-description">{project.description || 'No description has been added.'}</p>
      <div className="project-meta">
        <span><small>Lead</small><strong>{project.lead_name}</strong></span>
        <span><small>Timeline</small><strong>{dates}</strong></span>
      </div>
      <div className="project-progress-heading">
        <span>Progress</span>
        <strong>{Math.round(progress)}%</strong>
      </div>
      <div className="project-progress-track" role="progressbar" aria-label={project.project_name + ' progress'} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress)}>
        <span style={{ width: progress + '%' }} />
      </div>
      <div className="project-card-bottom">
        <div className="project-avatars" aria-label="Project members">
          {project.members.slice(0, 5).map((member) => (
            <span className="project-avatar" key={member.user_id} title={member.name}>{initials(member.name)}</span>
          ))}
          {project.members.length > 5 && <span className="project-avatar project-avatar-more">+{project.members.length - 5}</span>}
          {project.members.length === 0 && <span className="muted-cell">No members assigned</span>}
        </div>
        <span className="project-task-summary">
          {project.total_tasks === 0
            ? 'No tasks yet'
            : project.completed_tasks + ' of ' + project.total_tasks + ' tasks complete'}
        </span>
      </div>
    </article>
  );
}

export default function ProjectsPanel({ user, onBack }) {
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const canManageProjects = ['admin', 'project_lead'].includes(user.role);
  const canCreateProjects = user.role === 'admin';

  async function loadData(showSpinner = true) {
    if (showSpinner) setLoading(true);
    setPageError('');
    try {
      const projectRequest = request('/api/projects');
      const optionsRequest = canManageProjects
        ? request('/api/projects/options')
        : Promise.resolve({ users: [], leads: [], teams: [] });
      const [projectData, options] = await Promise.all([projectRequest, optionsRequest]);
      setProjects(projectData.projects || []);
      setUsers(options.users || []);
      setLeads(options.leads || []);
      setTeams(options.teams || []);
    } catch (error) {
      setPageError(error.message);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const visibleProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
      const searchValues = [
        project.project_name,
        project.description,
        project.lead_name,
        ...(project.members || []).map((member) => member.name),
      ];
      const matchesSearch = !query || searchValues.some((value) => String(value || '').toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [projects, search, statusFilter]);

  function openCreateForm() {
    setFormError('');
    setNotice('');
    setDraft({ ...emptyProject, member_ids: [] });
  }

  function openEditForm(project) {
    setFormError('');
    setNotice('');
    let leadId = project.lead_id;
    if (user.role === 'admin' && !leads.some((lead) => lead.user_id === Number(leadId))) {
      leadId = leads[0]?.user_id || '';
    }
    setDraft({
      project_id: project.project_id,
      project_name: project.project_name,
      description: project.description || '',
      lead_id: leadId,
      lead_name: project.lead_name,
      start_date: project.start_date || '',
      end_date: project.end_date || '',
      status: project.status,
      member_ids: [...new Set([
        ...(project.members || []).map((member) => Number(member.user_id)),
        Number(leadId) || Number(project.lead_id),
      ])],
    });
  }

  function updateField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function saveProject(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    setNotice('');
    const isEditing = Boolean(draft.project_id);
    const payload = {
      project_name: draft.project_name,
      description: draft.description,
      ...(user.role === 'admin' ? { lead_id: draft.lead_id ? Number(draft.lead_id) : null } : {}),
      start_date: draft.start_date || null,
      end_date: draft.end_date || null,
      status: draft.status,
      member_ids: draft.member_ids.map(Number),
    };
    try {
      if (isEditing) {
        await request('/api/projects/' + draft.project_id, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await request('/api/projects', { method: 'POST', body: JSON.stringify(payload) });
      }
      setDraft(null);
      setNotice(isEditing ? 'Project updated.' : 'Project created.');
      await loadData(false);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  const activeCount = projects.filter((project) => project.status === 'active').length;
  const completedCount = projects.filter((project) => project.status === 'completed').length;

  return (
    <main className="projects-main">
      <div className="projects-intro">
        <div>
          <p className="eyebrow eyebrow-light">PROJECTS</p>
          <h1>Projects that move work forward</h1>
          <p>Track project ownership, timelines, people, and progress in one place.</p>
        </div>
        <div className="projects-summary" aria-label="Project totals">
          <div><strong>{projects.length}</strong><span>Projects</span></div>
          <div><strong>{activeCount}</strong><span>Active</span></div>
          <div><strong>{completedCount}</strong><span>Completed</span></div>
        </div>
        <button className="secondary-action project-back-action" type="button" onClick={onBack}>Back to overview</button>
      </div>

      <div className="projects-toolbar">
        <div className="project-filters">
          <label className="visually-hidden" htmlFor="project-search">Search projects</label>
          <input id="project-search" type="search" placeholder="Search projects or people…" value={search} onChange={(event) => setSearch(event.target.value)} />
          <label className="visually-hidden" htmlFor="project-status-filter">Filter by project status</label>
          <select id="project-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            {Object.entries(statusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
          </select>
        </div>
        <div className="project-toolbar-actions">
          {canCreateProjects && <button className="primary-action" type="button" onClick={openCreateForm}>+ New project</button>}
        </div>
      </div>

      {notice && <div className="success-notice" role="status">{notice}</div>}
      {pageError && <div className="inline-alert page-alert" role="alert">{pageError}</div>}
      {draft && (
        <ProjectForm
          value={draft}
          user={user}
          users={users}
          leads={leads}
          teams={teams}
          saving={saving}
          error={formError}
          onChange={updateField}
          onCancel={() => { setDraft(null); setFormError(''); }}
          onSubmit={saveProject}
        />
      )}

      {loading ? (
        <div className="projects-loading"><span className="loading-spinner" />Loading projects…</div>
      ) : visibleProjects.length === 0 ? (
        <div className="projects-empty">
          <span className="project-empty-icon" aria-hidden="true">▣</span>
          <h2>{projects.length === 0 ? 'No projects yet' : 'No matching projects'}</h2>
          <p>{projects.length === 0
            ? (canCreateProjects
              ? 'Create a project, assign its lead, and add a team or individual members.'
              : (canManageProjects ? 'An administrator will create projects and assign you as lead.' : 'Your account is not assigned to a project yet.'))
            : 'Try another search or status filter.'}</p>
          {canCreateProjects && projects.length === 0 && <button className="primary-action" type="button" onClick={openCreateForm}>Create your first project</button>}
        </div>
      ) : (
        <section className="projects-grid" aria-label="Projects">
          {visibleProjects.map((project) => <ProjectCard key={project.project_id} project={project} onEdit={openEditForm} />)}
        </section>
      )}
    </main>
  );
}
