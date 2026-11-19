import { useEffect, useMemo, useState } from 'react';

const taskStatusLabels = {
  not_started: 'Not started',
  in_progress: 'In progress',
  in_review: 'In review',
  completed: 'Completed',
  blocked: 'Blocked',
};

const taskStatusOrder = ['not_started', 'in_progress', 'in_review', 'blocked', 'completed'];

async function request(path) {
  const response = await fetch(path, { credentials: 'include' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The workspace overview could not be loaded.');
  return data;
}

function localToday() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}

function formatDate(value) {
  if (!value) return 'No due date';
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function taskDateLabel(task) {
  if (!task.due_date) return 'No due date';
  if (task.due_date < localToday() && task.status !== 'completed') return 'Overdue · ' + formatDate(task.due_date);
  return 'Due ' + formatDate(task.due_date);
}

function ActivityIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 18V9m5 9V5m5 13v-6m5 6V7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M2.5 20.5h19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ProjectsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 4V2.8h8V4m-12 5h16M8 13h3m-3 3h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function TasksIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 5h12M8 12h12M8 19h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="m3.5 5 1.3 1.3L7 4m-3.5 8 1.3 1.3L7 11m-3.5 8 1.3 1.3L7 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function initial(name) {
  return String(name || '?').trim().charAt(0).toUpperCase();
}

export default function OverviewPanel({ user, onNavigate }) {
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isEmployee = user.role === 'employee';

  async function loadOverview() {
    setLoading(true);
    setError('');
    try {
      const [projectData, taskData] = await Promise.all([
        request('/api/projects'),
        request('/api/tasks'),
      ]);
      setProjects(projectData.projects || []);
      setTasks(taskData.tasks || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOverview();
  }, []);

  const summary = useMemo(() => {
    const today = localToday();
    const completedTasks = tasks.filter((task) => task.status === 'completed');
    const overdueTasks = tasks.filter((task) => task.due_date && task.due_date < today && task.status !== 'completed');
    const openTasks = tasks.filter((task) => task.status !== 'completed');
    const projectMap = new Map(projects.map((project) => [Number(project.project_id), {
      ...project,
      project_id: Number(project.project_id),
      project_progress_percent: Number(project.project_progress_percent) || 0,
    }]));

    const tasksByProject = new Map();
    for (const task of tasks) {
      const projectId = Number(task.project_id);
      if (!tasksByProject.has(projectId)) tasksByProject.set(projectId, []);
      tasksByProject.get(projectId).push(task);
    }
    for (const [projectId, projectTasks] of tasksByProject) {
      if (projectMap.has(projectId)) continue;
      const completedCount = projectTasks.filter((task) => task.status === 'completed').length;
      const averageProgress = projectTasks.reduce((total, task) => total + (Number(task.effective_progress_percent) || 0), 0) / projectTasks.length;
      projectMap.set(projectId, {
        project_id: projectId,
        project_name: projectTasks[0].project_name,
        project_progress_percent: averageProgress,
        total_tasks: projectTasks.length,
        completed_tasks: completedCount,
        status: 'active',
      });
    }

    const projectRows = [...projectMap.values()]
      .sort((first, second) => {
        const statusRank = (status) => status === 'active' ? 0 : status === 'planning' ? 1 : status === 'on_hold' ? 2 : 3;
        return statusRank(first.status) - statusRank(second.status) ||
          Number(second.project_progress_percent) - Number(first.project_progress_percent) ||
          String(first.project_name).localeCompare(String(second.project_name));
      })
      .slice(0, 5);

    const taskRows = [...openTasks]
      .sort((first, second) => {
        if (!first.due_date) return second.due_date ? 1 : 0;
        if (!second.due_date) return -1;
        return first.due_date.localeCompare(second.due_date);
      })
      .slice(0, 6);

    const statusCounts = taskStatusOrder.map((status) => ({
      status,
      count: tasks.filter((task) => task.status === status).length,
    }));
    const maxStatusCount = Math.max(1, ...statusCounts.map((row) => row.count));

    return {
      projectRows,
      projectCount: projectMap.size,
      openTasks,
      overdueTasks,
      completedTasks,
      taskRows,
      statusCounts: statusCounts.map((row) => ({ ...row, width: Math.max(row.count ? 8 : 0, (row.count / maxStatusCount) * 100) })),
    };
  }, [projects, tasks]);

  return (
    <main className="overview-main">
      <div className="overview-hero">
        <div>
          <p className="eyebrow eyebrow-light">YOUR WORKSPACE</p>
          <h1>Welcome back, {user.name}.</h1>
          <p>A current snapshot of the projects and tasks you can access.</p>
        </div>
        {user.role === 'admin' && (
          <button className="primary-action" type="button" onClick={() => onNavigate('people')}>Manage people</button>
        )}
      </div>

      {error && (
        <div className="inline-alert overview-alert" role="alert">
          <span>{error}</span>
          <button className="text-button" type="button" onClick={loadOverview}>Try again</button>
        </div>
      )}

      {loading ? (
        <div className="tasks-loading"><span className="loading-spinner" aria-hidden="true" />Loading your overview…</div>
      ) : (
        <>
          <section className="overview-metrics" aria-label="Workspace summary">
            {!isEmployee && (
            <article className="overview-metric">
              <span className="overview-metric-icon overview-project-icon"><ProjectsIcon /></span>
              <span className="overview-metric-label">Projects</span>
              <strong>{summary.projectCount}</strong>
              <small>{user.role === 'admin' ? 'All projects' : 'Projects you lead'}</small>
            </article>
            )}
            <article className="overview-metric">
              <span className="overview-metric-icon overview-task-icon"><TasksIcon /></span>
              <span className="overview-metric-label">Open tasks</span>
              <strong>{summary.openTasks.length}</strong>
              <small>Tasks not marked complete</small>
            </article>
            <article className="overview-metric overview-metric-alert">
              <span className="overview-metric-icon overview-overdue-icon">!</span>
              <span className="overview-metric-label">Overdue</span>
              <strong>{summary.overdueTasks.length}</strong>
              <small>Open tasks past their due date</small>
            </article>
            <article className="overview-metric">
              <span className="overview-metric-icon overview-done-icon">✓</span>
              <span className="overview-metric-label">Completed tasks</span>
              <strong>{summary.completedTasks.length}</strong>
              <small>Tasks marked complete</small>
            </article>
          </section>

          <section className="overview-report-grid" aria-label="Project and task reports">
            {!isEmployee && (
            <article className="overview-panel">
              <div className="overview-panel-heading">
                <div><h2>Project progress</h2><p>Projects with the most current work.</p></div>
                <button className="text-button" type="button" onClick={() => onNavigate('projects')}>View projects</button>
              </div>
              {summary.projectRows.length === 0 ? (
                <p className="overview-empty">No projects are available yet.</p>
              ) : (
                <div className="overview-project-list">
                  {summary.projectRows.map((project) => {
                    const progress = Math.max(0, Math.min(100, Number(project.project_progress_percent) || 0));
                    return (
                      <div className="overview-project-row" key={project.project_id}>
                        <div className="overview-project-top">
                          <div className="overview-project-identity">
                            <span className="overview-project-avatar" aria-hidden="true">{initial(project.project_name)}</span>
                            <div><strong>{project.project_name}</strong><small>{project.status?.replace('_', ' ') || 'Active'} · {Number(project.completed_tasks) || 0} of {Number(project.total_tasks) || 0} tasks done</small></div>
                          </div>
                          <strong className="overview-progress-value">{Math.round(progress)}%</strong>
                        </div>
                        <div className="project-progress-track" role="progressbar" aria-label={project.project_name + ' progress'} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress)}>
                          <span style={{ width: progress + '%' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
            )}

            <article className="overview-panel">
              <div className="overview-panel-heading">
                <div><h2>Task status</h2><p>Progress across the tasks in your workspace.</p></div>
                <button className="text-button" type="button" onClick={() => onNavigate('tasks')}>View tasks</button>
              </div>
              {tasks.length === 0 ? (
                <p className="overview-empty">Tasks will appear here when they’re added to your projects.</p>
              ) : (
                <div className="overview-status-list">
                  {summary.statusCounts.map((row) => (
                    <div className="overview-status-row" key={row.status}>
                      <div className="overview-status-label"><span>{taskStatusLabels[row.status]}</span><strong>{row.count}</strong></div>
                      <div className={'overview-status-track status-track-' + row.status} aria-hidden="true">
                        <span style={{ width: row.width + '%' }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="overview-due-summary">
                <span><strong>{summary.taskRows.length}</strong> upcoming or open tasks shown below</span>
                <span><strong>{summary.overdueTasks.length}</strong> overdue</span>
              </div>
            </article>
          </section>

          <section className="overview-panel overview-work-queue">
            <div className="overview-panel-heading">
              <div><h2>Work to follow up</h2><p>Your open tasks, ordered by due date.</p></div>
              <button className="text-button" type="button" onClick={() => onNavigate('tasks')}>Open task list</button>
            </div>
            {summary.taskRows.length === 0 ? (
              <p className="overview-empty">You have no open tasks right now.</p>
            ) : (
              <div className="overview-task-list">
                {summary.taskRows.map((task) => {
                  const overdue = task.due_date && task.due_date < localToday();
                  return (
                    <div className="overview-task-row" key={task.task_id}>
                      <div className="overview-task-copy">
                        <strong>{task.title}</strong>
                        <small>{task.project_name} · {taskStatusLabels[task.status] || task.status}</small>
                      </div>
                      <span className={'overview-task-priority priority-' + task.priority}>{task.priority}</span>
                      <time className={overdue ? 'overview-overdue-date' : ''}>{taskDateLabel(task)}</time>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="overview-shortcuts" aria-label="Workspace modules">
            {!isEmployee && (
            <button className="module-card module-card-button" type="button" onClick={() => onNavigate('projects')}>
              <span className="module-icon module-icon-projects"><ProjectsIcon /></span>
              <h2>Projects</h2><p>Project spaces, members and progress.</p>
            </button>
            )}
            <button className="module-card module-card-button" type="button" onClick={() => onNavigate('tasks')}>
              <span className="module-icon module-icon-tasks"><TasksIcon /></span>
              <h2>Tasks</h2><p>Assignments, priorities and due dates.</p>
            </button>
            <button className="module-card module-card-button activity-module-card" type="button" onClick={() => onNavigate('activity')}>
              <span className="module-icon module-icon-activity"><ActivityIcon /></span>
              <h2>Team activity</h2><p>Recent updates and your notifications.</p>
            </button>
          </section>
        </>
      )}
    </main>
  );
}
