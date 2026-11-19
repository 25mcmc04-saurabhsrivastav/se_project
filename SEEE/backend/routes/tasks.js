import { Router } from 'express';
import { notifyUsers, recordActivity } from '../activityLog.js';

const router = Router();
const priorities = new Set(['low', 'medium', 'high', 'urgent']);
const taskStatuses = new Set(['not_started', 'in_progress', 'in_review', 'completed', 'blocked']);
const subtaskStatuses = new Set(['not_started', 'in_progress', 'completed', 'blocked']);

function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function handleError(error, res, next, duplicateMessage) {
  if (error.status) return res.status(error.status).json({ error: error.message });
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: duplicateMessage || 'An assignment conflict occurred. Refresh and try again.' });
  if (error.code === 'ER_CHECK_CONSTRAINT_VIOLATED') return res.status(400).json({ error: 'Check the date range, progress, and estimated hours.' });
  return next(error);
}

async function requireUser(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Sign in to continue.' });
  try {
    const [[account]] = await req.app.locals.db.execute(
      'SELECT user_id, name, email, role, status FROM users WHERE user_id = ?',
      [req.session.user.id],
    );
    if (!account || account.status !== 'active') {
      return req.session.destroy(() => {
        res.clearCookie('iptms.sid');
        res.status(401).json({ error: 'This account is inactive. Sign in with an active account.' });
      });
    }
    req.currentUser = {
      id: Number(account.user_id),
      name: account.name,
      email: account.email,
      role: account.role,
    };
    req.session.user = { ...req.session.user, ...req.currentUser };
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireProjectManager(req, res, next) {
  if (!['admin', 'project_lead'].includes(req.currentUser.role)) {
    return res.status(403).json({ error: 'Project lead or administrator access is required.' });
  }
  return next();
}

function parseId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw apiError(400, 'Choose a valid ' + label + '.');
  return id;
}

function parseIdList(value, label) {
  if (!Array.isArray(value) || value.length > 500) throw apiError(400, 'Choose a valid ' + label + ' list.');
  return [...new Set(value.map((id) => parseId(id, label)))];
}

function optionalText(body, key, maxLength, label) {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return undefined;
  const value = body[key];
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw apiError(400, label + ' must be text.');
  const normalized = value.trim();
  if (normalized.length > maxLength) throw apiError(400, label + ' must be ' + maxLength + ' characters or fewer.');
  return normalized || null;
}

function parseDate(body, key, label) {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return undefined;
  const value = body[key];
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw apiError(400, 'Enter a valid ' + label + '.');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw apiError(400, 'Enter a valid ' + label + '.');
  }
  return value;
}

function parseHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 999999.99) throw apiError(400, 'Estimated hours must be greater than 0 and at most 999999.99.');
  return Math.round(hours * 100) / 100;
}

function parseProgress(value) {
  const progress = Number(value);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw apiError(400, 'Progress must be between 0 and 100.');
  return Math.round(progress * 100) / 100;
}

function readTaskInput(body, isCreate) {
  const title = Object.prototype.hasOwnProperty.call(body, 'title')
    ? (typeof body.title === 'string' ? body.title.trim() : '')
    : undefined;
  if ((isCreate || title !== undefined) && (!title || title.length > 200)) {
    throw apiError(400, 'Task title is required and must be 200 characters or fewer.');
  }

  const description = optionalText(body, 'description', 5000, 'Description');
  let projectId;
  if (Object.prototype.hasOwnProperty.call(body, 'project_id')) projectId = parseId(body.project_id, 'project');
  if (!isCreate && projectId !== undefined) throw apiError(400, 'Tasks cannot be moved to another project here.');

  let priority;
  if (Object.prototype.hasOwnProperty.call(body, 'priority')) {
    priority = body.priority;
    if (!priorities.has(priority)) throw apiError(400, 'Choose a valid task priority.');
  }
  let status;
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    status = body.status;
    if (!taskStatuses.has(status)) throw apiError(400, 'Choose a valid task status.');
  }
  const estimatedHours = Object.prototype.hasOwnProperty.call(body, 'estimated_hours')
    ? parseHours(body.estimated_hours)
    : undefined;
  const progressPercent = Object.prototype.hasOwnProperty.call(body, 'progress_percent')
    ? parseProgress(body.progress_percent)
    : undefined;
  const startDate = parseDate(body, 'start_date', 'start date');
  const dueDate = parseDate(body, 'due_date', 'due date');
  const ownerId = Object.prototype.hasOwnProperty.call(body, 'owner_id')
    ? parseId(body.owner_id, 'task owner')
    : undefined;
  const contributorIds = Object.prototype.hasOwnProperty.call(body, 'contributor_ids')
    ? parseIdList(body.contributor_ids, 'contributor')
    : (isCreate ? [] : undefined);

  if (isCreate && ownerId === undefined) throw apiError(400, 'Choose a task owner.');
  if (!isCreate && title === undefined && description === undefined && projectId === undefined &&
      priority === undefined && status === undefined && estimatedHours === undefined && progressPercent === undefined &&
      startDate === undefined && dueDate === undefined && ownerId === undefined && contributorIds === undefined) {
    throw apiError(400, 'There are no task changes to save.');
  }
  return { title, description, projectId, priority, status, estimatedHours, progressPercent, startDate, dueDate, ownerId, contributorIds };
}

async function loadProject(connection, projectId) {
  const [[project]] = await connection.execute(
    'SELECT project_id, project_name, lead_id, status FROM projects WHERE project_id = ?',
    [projectId],
  );
  if (!project) throw apiError(404, 'That project was not found.');
  return { ...project, project_id: Number(project.project_id), lead_id: Number(project.lead_id) };
}

function canManageProject(actor, project) {
  return actor.role === 'admin' || (actor.role === 'project_lead' && project.lead_id === actor.id);
}

async function requireEditableProject(connection, actor, projectId, creating = false) {
  const project = await loadProject(connection, projectId);
  if (!canManageProject(actor, project)) throw apiError(403, 'Only the project lead or an administrator can manage its tasks.');
  if (creating && ['completed', 'cancelled'].includes(project.status)) {
    throw apiError(409, 'Move the project out of its final status before adding tasks.');
  }
  return project;
}

async function validateProjectPeople(connection, project, userIds) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  const [people] = await connection.query(
    'SELECT u.user_id FROM users u WHERE u.status = \"active\" AND u.user_id IN (?) ' +
    'AND (u.user_id = ? OR EXISTS (' +
    'SELECT 1 FROM project_members pm WHERE pm.project_id = ? AND pm.user_id = u.user_id AND pm.status = \"active\"))',
    [ids, project.lead_id, project.project_id],
  );
  if (people.length !== ids.length) throw apiError(400, 'Assign only active members of this project.');
}

async function currentAssignments(connection, taskId) {
  const [rows] = await connection.execute(
    'SELECT user_id, assignment_role FROM task_assignments ' +
    'WHERE task_id = ? AND removed_at IS NULL AND active_user_id IS NOT NULL FOR UPDATE',
    [taskId],
  );
  return rows.map((row) => ({ user_id: Number(row.user_id), assignment_role: row.assignment_role }));
}

async function syncAssignments(connection, taskId, project, ownerId, contributorIds, assignedBy) {
  const cleanContributors = [...new Set(contributorIds)].filter((id) => id !== ownerId);
  const desired = new Map([[ownerId, 'owner']]);
  for (const contributorId of cleanContributors) desired.set(contributorId, 'contributor');
  await validateProjectPeople(connection, project, [...desired.keys()]);

  const existing = await currentAssignments(connection, taskId);
  const currentByUser = new Map(existing.map((assignment) => [assignment.user_id, assignment]));
  for (const assignment of existing) {
    if (desired.get(assignment.user_id) !== assignment.assignment_role) {
      await connection.execute(
        'UPDATE task_assignments SET removed_at = CURRENT_TIMESTAMP, active_user_id = NULL, active_owner_task_id = NULL ' +
        'WHERE task_id = ? AND user_id = ? AND removed_at IS NULL AND active_user_id IS NOT NULL',
        [taskId, assignment.user_id],
      );
    }
  }

  for (const [userId, role] of desired) {
    const current = currentByUser.get(userId);
    if (current && current.assignment_role === role) continue;
    await connection.execute(
      'INSERT INTO task_assignments (task_id, user_id, assignment_role, assigned_by, active_user_id, active_owner_task_id) ' +
      'VALUES (?, ?, ?, ?, ?, ?)',
      [taskId, userId, role, assignedBy, userId, role === 'owner' ? taskId : null],
    );
  }
}

async function currentUserIsAssigned(connection, taskId, userId) {
  const [rows] = await connection.execute(
    'SELECT assignment_id FROM task_assignments WHERE task_id = ? AND user_id = ? ' +
    'AND removed_at IS NULL AND active_user_id = ? LIMIT 1',
    [taskId, userId, userId],
  );
  return rows.length > 0;
}

router.use(requireUser);

router.get('/options', requireProjectManager, async (req, res, next) => {
  let connection;
  try {
    const projectId = parseId(req.query.project_id, 'project');
    connection = await req.app.locals.db.getConnection();
    const project = await loadProject(connection, projectId);
    if (!canManageProject(req.currentUser, project)) throw apiError(403, 'You can only assign tasks in projects you manage.');
    const [users] = await connection.query(
      'SELECT u.user_id, u.name, u.email, u.role, u.department FROM users u ' +
      'WHERE u.status = \"active\" AND (u.user_id = ? OR EXISTS (' +
      'SELECT 1 FROM project_members pm WHERE pm.project_id = ? AND pm.user_id = u.user_id AND pm.status = \"active\")) ' +
      'ORDER BY u.name ASC',
      [project.lead_id, project.project_id],
    );
    return res.json({
      users: users.map((person) => ({ ...person, user_id: Number(person.user_id) })),
      project: { project_id: project.project_id, project_name: project.project_name },
    });
  } catch (error) {
    return handleError(error, res, next);
  } finally {
    if (connection) connection.release();
  }
});

router.get('/', async (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const conditions = [];
    const parameters = [];
    if (req.currentUser.role !== 'admin') {
      // Employees see only tasks assigned to them (directly or via a subtask).
      // Project leads additionally see every task in the projects they lead.
      const assignedToMe =
        'EXISTS (SELECT 1 FROM task_assignments visible_assignment ' +
        'WHERE visible_assignment.task_id = t.task_id AND visible_assignment.user_id = ? ' +
        'AND visible_assignment.removed_at IS NULL AND visible_assignment.active_user_id = ?) OR EXISTS (' +
        'SELECT 1 FROM subtasks visible_subtask ' +
        'WHERE visible_subtask.task_id = t.task_id AND visible_subtask.assignee_id = ?)';
      if (req.currentUser.role === 'project_lead') {
        conditions.push('(p.lead_id = ? OR ' + assignedToMe + ')');
        parameters.push(req.currentUser.id);
      } else {
        conditions.push('(' + assignedToMe + ')');
      }
      parameters.push(req.currentUser.id, req.currentUser.id, req.currentUser.id);
    }
    if (req.query.project_id !== undefined) {
      const projectId = parseId(req.query.project_id, 'project');
      conditions.push('p.project_id = ?');
      parameters.push(projectId);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const [tasks] = await db.execute(
      'SELECT t.task_id, t.project_id, p.project_name, p.lead_id, t.title, t.description, t.priority, t.status, ' +
      't.estimated_hours, t.progress_percent, DATE_FORMAT(t.start_date, \"%Y-%m-%d\") AS start_date, ' +
      'DATE_FORMAT(t.due_date, \"%Y-%m-%d\") AS due_date, t.created_by, t.created_at, t.updated_at, ' +
      'COALESCE(progress.effective_progress_percent, t.progress_percent) AS effective_progress_percent, ' +
      'COALESCE(progress.subtask_count, 0) AS subtask_count ' +
      'FROM tasks t INNER JOIN projects p ON p.project_id = t.project_id ' +
      'LEFT JOIN v_task_progress progress ON progress.task_id = t.task_id ' +
      where +
      ' ORDER BY FIELD(t.status, \"in_progress\", \"in_review\", \"blocked\", \"not_started\", \"completed\"), ' +
      '(t.due_date IS NULL) ASC, t.due_date ASC, t.updated_at DESC',
      parameters,
    );
    if (tasks.length === 0) return res.json({ tasks: [] });

    const taskIds = tasks.map((task) => Number(task.task_id));
    const [assignmentRows] = await db.query(
      'SELECT ta.task_id, ta.user_id, ta.assignment_role, u.name, u.email, u.role ' +
      'FROM task_assignments ta INNER JOIN users u ON u.user_id = ta.user_id ' +
      'WHERE ta.task_id IN (?) AND ta.removed_at IS NULL AND ta.active_user_id = ta.user_id AND u.status = \"active\" ' +
      'ORDER BY (ta.assignment_role = \"owner\") DESC, u.name ASC',
      [taskIds],
    );
    const [subtaskRows] = await db.query(
      'SELECT s.subtask_id, s.task_id, s.title, s.description, s.assignee_id, assignee.name AS assignee_name, ' +
      's.estimated_hours, s.progress_percent, s.status, s.created_at, s.updated_at ' +
      'FROM subtasks s LEFT JOIN users assignee ON assignee.user_id = s.assignee_id ' +
      'WHERE s.task_id IN (?) ORDER BY s.subtask_id ASC',
      [taskIds],
    );
    const assignmentsByTask = new Map();
    for (const assignment of assignmentRows) {
      const taskId = Number(assignment.task_id);
      if (!assignmentsByTask.has(taskId)) assignmentsByTask.set(taskId, []);
      assignmentsByTask.get(taskId).push({
        user_id: Number(assignment.user_id),
        assignment_role: assignment.assignment_role,
        name: assignment.name,
        email: assignment.email,
        role: assignment.role,
      });
    }
    const subtasksByTask = new Map();
    for (const subtask of subtaskRows) {
      const taskId = Number(subtask.task_id);
      if (!subtasksByTask.has(taskId)) subtasksByTask.set(taskId, []);
      subtasksByTask.get(taskId).push({
        ...subtask,
        subtask_id: Number(subtask.subtask_id),
        task_id: taskId,
        assignee_id: subtask.assignee_id === null ? null : Number(subtask.assignee_id),
        estimated_hours: Number(subtask.estimated_hours),
        progress_percent: Number(subtask.progress_percent),
      });
    }
    const [requestRows] = await db.query(
      'SELECT mr.request_id, mr.task_id, mr.requested_by, requester.name AS requested_by_name, mr.reason, mr.status, ' +
      'mr.handled_by, handler.name AS handled_by_name, mr.handled_at, mr.created_at ' +
      'FROM member_requests mr INNER JOIN users requester ON requester.user_id = mr.requested_by ' +
      'LEFT JOIN users handler ON handler.user_id = mr.handled_by ' +
      'WHERE mr.task_id IN (?) ORDER BY (mr.status = \"pending\") DESC, mr.created_at DESC',
      [taskIds],
    );
    const requestsByTask = new Map();
    for (const row of requestRows) {
      const taskId = Number(row.task_id);
      if (!requestsByTask.has(taskId)) requestsByTask.set(taskId, []);
      requestsByTask.get(taskId).push({
        ...row,
        request_id: Number(row.request_id),
        task_id: taskId,
        requested_by: Number(row.requested_by),
        handled_by: row.handled_by === null ? null : Number(row.handled_by),
      });
    }
    const [projectLeads] = await db.query(
      'SELECT project_id, lead_id FROM projects WHERE project_id IN (?)',
      [tasks.map((task) => Number(task.project_id))],
    );
    const leadsByProject = new Map(projectLeads.map((project) => [Number(project.project_id), Number(project.lead_id)]));

    return res.json({
      tasks: tasks.map((task) => {
        const taskId = Number(task.task_id);
        const assignmentList = assignmentsByTask.get(taskId) || [];
        const projectLeadId = leadsByProject.get(Number(task.project_id));
        const canEdit = req.currentUser.role === 'admin' ||
          (req.currentUser.role === 'project_lead' && projectLeadId === req.currentUser.id);
        const taskAssignee = assignmentList.some((assignment) => assignment.user_id === req.currentUser.id);
        const taskSubtasks = subtasksByTask.get(taskId) || [];
        return {
          ...task,
          task_id: taskId,
          project_id: Number(task.project_id),
          project_lead_id: projectLeadId,
          estimated_hours: Number(task.estimated_hours),
          progress_percent: Number(task.progress_percent),
          effective_progress_percent: Number(task.effective_progress_percent),
          subtask_count: Number(task.subtask_count),
          assignments: assignmentList,
          subtasks: taskSubtasks.map((subtask) => ({
            ...subtask,
            can_update: canEdit || taskAssignee || subtask.assignee_id === req.currentUser.id,
          })),
          // Leads see every request on their tasks; others see only their own.
          member_requests: (requestsByTask.get(taskId) || [])
            .filter((item) => canEdit || item.requested_by === req.currentUser.id),
          can_request_member: !canEdit && (taskAssignee || taskSubtasks.some((subtask) => subtask.assignee_id === req.currentUser.id)),
          can_edit: canEdit,
          can_update: canEdit || taskAssignee,
        };
      }),
    });
  } catch (error) {
    return handleError(error, res, next);
  }
});

router.post('/', requireProjectManager, async (req, res, next) => {
  let connection;
  try {
    const input = readTaskInput(req.body || {}, true);
    if (input.projectId === undefined) throw apiError(400, 'Choose a project.');
    if (input.startDate && input.dueDate && input.dueDate < input.startDate) {
      throw apiError(400, 'Due date must be on or after the start date.');
    }
    connection = await req.app.locals.db.getConnection();
    await connection.beginTransaction();
    const project = await requireEditableProject(connection, req.currentUser, input.projectId, true);
    const contributors = input.contributorIds || [];
    await validateProjectPeople(connection, project, [input.ownerId, ...contributors]);
    const progress = input.status === 'completed' ? 100 : (input.progressPercent ?? 0);
    const [result] = await connection.execute(
      'INSERT INTO tasks (project_id, title, description, priority, status, estimated_hours, progress_percent, start_date, due_date, created_by) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        project.project_id,
        input.title,
        input.description ?? null,
        input.priority || 'medium',
        input.status || 'not_started',
        input.estimatedHours ?? 1,
        progress,
        input.startDate ?? null,
        input.dueDate ?? null,
        req.currentUser.id,
      ],
    );
    await syncAssignments(connection, result.insertId, project, input.ownerId, contributors, req.currentUser.id);
    await recordActivity(connection, req.currentUser.id, 'task_created', 'task', result.insertId, 'Created task “' + input.title + '”.');
    const assignees = await currentAssignments(connection, result.insertId);
    await notifyUsers(
      connection,
      assignees.map((assignment) => assignment.user_id),
      'You were assigned to task “' + input.title + '”.',
      'task',
      result.insertId,
      req.currentUser.id,
    );
    await connection.commit();
    return res.status(201).json({ task_id: Number(result.insertId), message: 'Task created.' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return handleError(error, res, next);
  } finally {
    if (connection) connection.release();
  }
});

router.patch('/:taskId', async (req, res, next) => {
  let connection;
  try {
    const taskId = parseId(req.params.taskId, 'task');
    const body = req.body || {};
    const input = readTaskInput(body, false);
    connection = await req.app.locals.db.getConnection();
    await connection.beginTransaction();
    const [[task]] = await connection.execute(
      'SELECT t.task_id, t.project_id, p.lead_id, t.title, t.status, t.progress_percent, ' +
      'DATE_FORMAT(t.start_date, \"%Y-%m-%d\") AS start_date, DATE_FORMAT(t.due_date, \"%Y-%m-%d\") AS due_date ' +
      'FROM tasks t INNER JOIN projects p ON p.project_id = t.project_id WHERE t.task_id = ? FOR UPDATE',
      [taskId],
    );
    if (!task) throw apiError(404, 'That task was not found.');
    const project = {
      project_id: Number(task.project_id),
      lead_id: Number(task.lead_id),
    };
    const manager = canManageProject(req.currentUser, project);
    const assigned = await currentUserIsAssigned(connection, taskId, req.currentUser.id);
    if (!manager && !assigned) throw apiError(403, 'Only the project team and assigned task users can update this task.');
    if (!manager && Object.keys(body).some((key) => !['status', 'progress_percent'].includes(key))) {
      throw apiError(403, 'Assigned users can update task status and progress only.');
    }

    const nextStartDate = input.startDate === undefined ? task.start_date : input.startDate;
    const nextDueDate = input.dueDate === undefined ? task.due_date : input.dueDate;
    if (nextStartDate && nextDueDate && nextDueDate < nextStartDate) {
      throw apiError(400, 'Due date must be on or after the start date.');
    }
    const currentAssignmentList = await currentAssignments(connection, taskId);
    const existing = {
      ownerId: currentAssignmentList.find((assignment) => assignment.assignment_role === 'owner')?.user_id,
      contributorIds: currentAssignmentList.filter((assignment) => assignment.assignment_role === 'contributor').map((assignment) => assignment.user_id),
    };
    const nextStatus = input.status === undefined ? task.status : input.status;
    // Review flow: assignees send work for review; only the project lead or an admin completes or reopens it.
    if (!manager && input.status !== undefined && input.status !== task.status) {
      if (input.status === 'completed') {
        throw apiError(403, 'Move the task to In review. The project lead will mark it completed.');
      }
      if (task.status === 'completed') {
        throw apiError(403, 'This task is completed. Ask the project lead to reopen it.');
      }
    }
    if (!manager && task.status === 'completed' && input.progressPercent !== undefined) {
      throw apiError(403, 'This task is completed. Ask the project lead to reopen it.');
    }
    const reopened = task.status === 'completed' && nextStatus !== 'completed';
    const nextProgress = nextStatus === 'completed'
      ? 100
      : (input.progressPercent === undefined
        ? (reopened ? 0 : Number(task.progress_percent))
        : input.progressPercent);
    const updates = [];
    const values = [];
    if (manager) {
      if (input.title !== undefined) { updates.push('title = ?'); values.push(input.title); }
      if (input.description !== undefined) { updates.push('description = ?'); values.push(input.description); }
      if (input.priority !== undefined) { updates.push('priority = ?'); values.push(input.priority); }
      if (input.estimatedHours !== undefined) { updates.push('estimated_hours = ?'); values.push(input.estimatedHours); }
      if (input.startDate !== undefined) { updates.push('start_date = ?'); values.push(input.startDate); }
      if (input.dueDate !== undefined) { updates.push('due_date = ?'); values.push(input.dueDate); }
    }
    if (input.status !== undefined) { updates.push('status = ?'); values.push(nextStatus); }
    if (input.progressPercent !== undefined || (input.status === 'completed' && task.status !== 'completed') || reopened) {
      updates.push('progress_percent = ?');
      values.push(nextProgress);
    }
    const taskFieldsChanged = updates.length > 0;
    if (taskFieldsChanged) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(taskId);
      await connection.execute('UPDATE tasks SET ' + updates.join(', ') + ' WHERE task_id = ?', values);
    }

    const assignmentFieldsChanged = manager && (input.ownerId !== undefined || input.contributorIds !== undefined);
    let newlyAssignedIds = [];
    if (assignmentFieldsChanged) {
      const ownerId = input.ownerId === undefined ? existing.ownerId : input.ownerId;
      const contributorIds = input.contributorIds === undefined ? existing.contributorIds : input.contributorIds;
      if (ownerId === undefined) throw apiError(400, 'Choose a task owner.');
      const existingIds = new Set(currentAssignmentList.map((assignment) => assignment.user_id));
      newlyAssignedIds = [ownerId, ...contributorIds].filter((userId) => !existingIds.has(userId));
      await syncAssignments(connection, taskId, project, ownerId, contributorIds, req.currentUser.id);
    }
    const statusChanged = input.status !== undefined && nextStatus !== task.status;
    if (statusChanged) {
      const reviewTitle = input.title ?? task.title;
      if (nextStatus === 'in_review') {
        await recordActivity(connection, req.currentUser.id, 'task_submitted_for_review', 'task', taskId, 'Sent task “' + reviewTitle + '” for review.');
        await notifyUsers(connection, [project.lead_id], 'Task “' + reviewTitle + '” is ready for your review.', 'task', taskId, req.currentUser.id);
      } else if (task.status === 'in_review' && nextStatus === 'completed') {
        await recordActivity(connection, req.currentUser.id, 'task_review_approved', 'task', taskId, 'Approved and completed task “' + reviewTitle + '”.');
        await notifyUsers(connection, currentAssignmentList.map((a) => a.user_id), 'Task “' + reviewTitle + '” was approved and marked completed.', 'task', taskId, req.currentUser.id);
      } else if (task.status === 'in_review' && manager) {
        await recordActivity(connection, req.currentUser.id, 'task_review_returned', 'task', taskId, 'Sent task “' + reviewTitle + '” back for changes.');
        await notifyUsers(connection, currentAssignmentList.map((a) => a.user_id), 'Task “' + reviewTitle + '” needs changes and was sent back.', 'task', taskId, req.currentUser.id);
      }
    }
    if (taskFieldsChanged || assignmentFieldsChanged) {
      const nextTitle = input.title ?? task.title;
      await recordActivity(connection, req.currentUser.id, 'task_updated', 'task', taskId, 'Updated task “' + nextTitle + '”.');
      await notifyUsers(
        connection,
        newlyAssignedIds,
        'You were assigned to task “' + nextTitle + '”.',
        'task',
        taskId,
        req.currentUser.id,
      );
    }
    await connection.commit();
    return res.json({ message: 'Task updated.' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return handleError(error, res, next);
  } finally {
    if (connection) connection.release();
  }
});

async function requireTaskManager(connection, actor, taskId) {
  const [[task]] = await connection.execute(
    'SELECT t.task_id, t.project_id, p.lead_id, p.status FROM tasks t INNER JOIN projects p ON p.project_id = t.project_id WHERE t.task_id = ?',
    [taskId],
  );
  if (!task) throw apiError(404, 'That task was not found.');
  const project = { project_id: Number(task.project_id), lead_id: Number(task.lead_id), status: task.status };
  if (!canManageProject(actor, project)) throw apiError(403, 'Only the project lead or an administrator can manage subtasks.');
  return project;
}

router.post('/:taskId/subtasks', requireProjectManager, async (req, res, next) => {
  let connection;
  try {
    const taskId = parseId(req.params.taskId, 'task');
    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 200) throw apiError(400, 'Subtask title is required and must be 200 characters or fewer.');
    const description = optionalText(body, 'description', 5000, 'Description');
    const assigneeId = body.assignee_id === null || body.assignee_id === '' || body.assignee_id === undefined
      ? null
      : parseId(body.assignee_id, 'subtask assignee');
    const estimatedHours = body.estimated_hours === undefined ? 1 : parseHours(body.estimated_hours);
    let status = body.status || 'not_started';
    if (!subtaskStatuses.has(status)) throw apiError(400, 'Choose a valid subtask status.');
    const progress = status === 'completed' ? 100 : (body.progress_percent === undefined ? 0 : parseProgress(body.progress_percent));
    connection = await req.app.locals.db.getConnection();
    await connection.beginTransaction();
    const project = await requireTaskManager(connection, req.currentUser, taskId);
    if (['completed', 'cancelled'].includes(project.status)) {
      throw apiError(409, 'Move the project out of its final status before adding subtasks.');
    }
    if (assigneeId !== null) await validateProjectPeople(connection, project, [assigneeId]);
    const [result] = await connection.execute(
      'INSERT INTO subtasks (task_id, title, description, assignee_id, estimated_hours, progress_percent, status) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
      [taskId, title, description ?? null, assigneeId, estimatedHours, progress, status],
    );
    await recordActivity(connection, req.currentUser.id, 'subtask_created', 'task', taskId, 'Added subtask “' + title + '”.');
    if (assigneeId !== null) {
      await notifyUsers(
        connection,
        [assigneeId],
        'A subtask was assigned to you: “' + title + '”.',
        'task',
        taskId,
        req.currentUser.id,
      );
    }
    await connection.commit();
    return res.status(201).json({ subtask_id: Number(result.insertId), message: 'Subtask added.' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return handleError(error, res, next);
  } finally {
    if (connection) connection.release();
  }
});

router.patch('/:taskId/subtasks/:subtaskId', async (req, res, next) => {
  let connection;
  try {
    const taskId = parseId(req.params.taskId, 'task');
    const subtaskId = parseId(req.params.subtaskId, 'subtask');
    const body = req.body || {};
    const updates = [];
    const values = [];
    if (Object.prototype.hasOwnProperty.call(body, 'title')) {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title || title.length > 200) throw apiError(400, 'Subtask title is required and must be 200 characters or fewer.');
      updates.push('title = ?'); values.push(title);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'description')) {
      updates.push('description = ?'); values.push(optionalText(body, 'description', 5000, 'Description'));
    }
    let status;
    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
      status = body.status;
      if (!subtaskStatuses.has(status)) throw apiError(400, 'Choose a valid subtask status.');
      updates.push('status = ?'); values.push(status);
    }
    let progress;
    if (Object.prototype.hasOwnProperty.call(body, 'progress_percent')) {
      progress = parseProgress(body.progress_percent);
      updates.push('progress_percent = ?'); values.push(progress);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'estimated_hours')) {
      updates.push('estimated_hours = ?'); values.push(parseHours(body.estimated_hours));
    }
    let assigneeId;
    if (Object.prototype.hasOwnProperty.call(body, 'assignee_id')) {
      assigneeId = body.assignee_id === null || body.assignee_id === '' ? null : parseId(body.assignee_id, 'subtask assignee');
      updates.push('assignee_id = ?'); values.push(assigneeId);
    }
    if (updates.length === 0) throw apiError(400, 'There are no subtask changes to save.');

    connection = await req.app.locals.db.getConnection();
    await connection.beginTransaction();
    const project = await loadProjectForTask(connection, taskId);
    const [[subtask]] = await connection.execute(
      'SELECT subtask_id, task_id, title, assignee_id, status, progress_percent FROM subtasks WHERE subtask_id = ? AND task_id = ? FOR UPDATE',
      [subtaskId, taskId],
    );
    if (!subtask) throw apiError(404, 'That subtask was not found.');
    const manager = canManageProject(req.currentUser, project);
    const assignedToTask = await currentUserIsAssigned(connection, taskId, req.currentUser.id);
    const isSubtaskAssignee = Number(subtask.assignee_id) === req.currentUser.id;
    if (!manager && !assignedToTask && !isSubtaskAssignee) {
      throw apiError(403, 'Only the project team and assigned task users can update this subtask.');
    }
    if (!manager && Object.keys(body).some((key) => !['status', 'progress_percent'].includes(key))) {
      throw apiError(403, 'Assigned users can update subtask status and progress only.');
    }
    if (assigneeId !== undefined && assigneeId !== null) await validateProjectPeople(connection, project, [assigneeId]);
    if (status === 'completed' && progress !== 100) {
      const progressIndex = updates.findIndex((item) => item === 'progress_percent = ?');
      if (progressIndex >= 0) values[progressIndex] = 100;
      else { updates.push('progress_percent = ?'); values.push(100); }
    } else if (subtask.status === 'completed' && status && status !== 'completed' && progress === undefined) {
      updates.push('progress_percent = ?');
      values.push(0);
    }
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(subtaskId);
    await connection.execute('UPDATE subtasks SET ' + updates.join(', ') + ' WHERE subtask_id = ?', values);
    await recordActivity(connection, req.currentUser.id, 'subtask_updated', 'task', taskId, 'Updated subtask “' + subtask.title + '”.');
    if (assigneeId !== undefined && assigneeId !== null && assigneeId !== Number(subtask.assignee_id)) {
      await notifyUsers(
        connection,
        [assigneeId],
        'A subtask was assigned to you: “' + subtask.title + '”.',
        'task',
        taskId,
        req.currentUser.id,
      );
    }
    await connection.commit();
    return res.json({ message: 'Subtask updated.' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return handleError(error, res, next);
  } finally {
    if (connection) connection.release();
  }
});

async function loadProjectForTask(connection, taskId) {
  const [[task]] = await connection.execute(
    'SELECT p.project_id, p.lead_id FROM tasks t INNER JOIN projects p ON p.project_id = t.project_id WHERE t.task_id = ?',
    [taskId],
  );
  if (!task) throw apiError(404, 'That task was not found.');
  return { project_id: Number(task.project_id), lead_id: Number(task.lead_id) };
}

export default router;
