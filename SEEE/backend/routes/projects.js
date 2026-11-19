import { Router } from 'express';
import { notifyUsers, recordActivity } from '../activityLog.js';

const router = Router();
const projectStatuses = new Set(['planning', 'active', 'on_hold', 'completed', 'cancelled']);

function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function handleError(error, res, next, duplicateMessage) {
  if (error.status) return res.status(error.status).json({ error: error.message });
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: duplicateMessage });
  if (error.code === 'ER_CHECK_CONSTRAINT_VIOLATED') return res.status(400).json({ error: 'The project date range is invalid.' });
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

function requireAdmin(req, res, next) {
  if (req.currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Only an administrator can create projects.' });
  }
  return next();
}

function parseId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw apiError(400, 'Choose a valid ' + label + '.');
  return id;
}

function parseMemberIds(value) {
  if (!Array.isArray(value) || value.length > 500) throw apiError(400, 'Choose a valid project member list.');
  return [...new Set(value.map((id) => parseId(id, 'project member')))];
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
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw apiError(400, 'Enter a valid ' + label + '.');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw apiError(400, 'Enter a valid ' + label + '.');
  }
  return value;
}

function readProjectInput(body, actor, isCreate) {
  const projectName = Object.prototype.hasOwnProperty.call(body, 'project_name')
    ? (typeof body.project_name === 'string' ? body.project_name.trim() : '')
    : undefined;
  if ((isCreate || projectName !== undefined) && (!projectName || projectName.length > 150)) {
    throw apiError(400, 'Project name is required and must be 150 characters or fewer.');
  }

  const description = optionalText(body, 'description', 5000, 'Description');
  let leadId;
  if (Object.prototype.hasOwnProperty.call(body, 'lead_id')) {
    leadId = body.lead_id === null || body.lead_id === ''
      ? null
      : parseId(body.lead_id, 'project lead');
  }
  if (actor.role === 'project_lead' && leadId !== undefined && leadId !== actor.id) {
    throw apiError(403, 'Only an administrator can change the project lead.');
  }

  const startDate = parseDate(body, 'start_date', 'start date');
  const endDate = parseDate(body, 'end_date', 'end date');
  let status;
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    status = body.status;
    if (!projectStatuses.has(status)) throw apiError(400, 'Choose a valid project status.');
  }
  const memberIds = Object.prototype.hasOwnProperty.call(body, 'member_ids')
    ? parseMemberIds(body.member_ids)
    : (isCreate ? [] : undefined);

  if (!isCreate && projectName === undefined && description === undefined && leadId === undefined &&
      startDate === undefined && endDate === undefined && status === undefined && memberIds === undefined) {
    throw apiError(400, 'There are no project changes to save.');
  }
  return { projectName, description, leadId, startDate, endDate, status, memberIds };
}

async function validateLead(connection, leadId) {
  if (leadId === null || leadId === undefined) throw apiError(400, 'Choose an active project lead.');
  const [leads] = await connection.execute(
    'SELECT user_id FROM users WHERE user_id = ? AND status = \"active\" AND role IN (\"admin\", \"project_lead\")',
    [leadId],
  );
  if (leads.length === 0) throw apiError(400, 'A project lead must be an active admin or project lead.');
}

async function validateMembers(connection, memberIds) {
  if (!memberIds.length) return;
  const [users] = await connection.query(
    'SELECT user_id FROM users WHERE status = \"active\" AND user_id IN (?)',
    [memberIds],
  );
  if (users.length !== memberIds.length) throw apiError(400, 'Only active accounts can be assigned to a project.');
}

async function syncProjectMembers(connection, projectId, memberIds) {
  await validateMembers(connection, memberIds);
  const [existingRows] = await connection.execute(
    'SELECT project_member_id, user_id FROM project_members WHERE project_id = ? FOR UPDATE',
    [projectId],
  );
  const desired = new Set(memberIds);
  const rowsByUser = new Map();
  for (const row of existingRows) {
    const userId = Number(row.user_id);
    if (!rowsByUser.has(userId)) rowsByUser.set(userId, []);
    rowsByUser.get(userId).push(row);
    if (!desired.has(userId)) {
      await connection.execute(
        'UPDATE project_members SET status = \"inactive\", active_user_id = NULL WHERE project_member_id = ?',
        [row.project_member_id],
      );
    }
  }

  for (const userId of memberIds) {
    const rows = rowsByUser.get(userId) || [];
    if (rows.length === 0) {
      await connection.execute(
        'INSERT INTO project_members (project_id, user_id, status, active_user_id) VALUES (?, ?, \"active\", ?)',
        [projectId, userId, userId],
      );
      continue;
    }

    for (const row of rows) {
      await connection.execute(
        'UPDATE project_members SET status = \"inactive\", active_user_id = NULL WHERE project_member_id = ?',
        [row.project_member_id],
      );
    }
    await connection.execute(
      'UPDATE project_members SET status = \"active\", active_user_id = ? WHERE project_member_id = ?',
      [userId, rows[0].project_member_id],
    );
  }
}

function addLeadToMembers(memberIds, leadId) {
  return [...new Set([...memberIds, leadId])];
}

router.use(requireUser);

router.get('/options', requireProjectManager, async (req, res, next) => {
  try {
    const [users] = await req.app.locals.db.execute(
      'SELECT user_id, name, email, role, department FROM users WHERE status = \"active\" ORDER BY name ASC',
    );
    const [teams] = await req.app.locals.db.execute('SELECT team_id, team_name FROM teams ORDER BY team_name ASC');
    const [teamMembers] = await req.app.locals.db.execute(
      'SELECT tm.team_id, tm.user_id FROM team_members tm INNER JOIN users u ON u.user_id = tm.user_id ' +
      'WHERE tm.status = \"active\" AND u.status = \"active\"',
    );
    const membersByTeam = new Map();
    for (const row of teamMembers) {
      const teamId = Number(row.team_id);
      if (!membersByTeam.has(teamId)) membersByTeam.set(teamId, []);
      membersByTeam.get(teamId).push(Number(row.user_id));
    }
    return res.json({
      teams: teams.map((team) => ({
        team_id: Number(team.team_id),
        team_name: team.team_name,
        member_ids: membersByTeam.get(Number(team.team_id)) || [],
      })),
      users: users.map((user) => ({ ...user, user_id: Number(user.user_id) })),
      leads: users
        .filter((user) => ['admin', 'project_lead'].includes(user.role))
        .map((user) => ({ user_id: Number(user.user_id), name: user.name, email: user.email, role: user.role })),
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const admin = req.currentUser.role === 'admin';
    // Employees get no project data (they only work with their own tasks);
    // project leads see only the projects they lead; admins see everything.
    if (req.currentUser.role === 'employee') return res.json({ projects: [] });
    const scope = admin ? '' : 'WHERE p.lead_id = ?';
    const parameters = admin ? [] : [req.currentUser.id];
    const [projects] = await db.execute(
      'SELECT p.project_id, p.project_name, p.description, p.lead_id, lead.name AS lead_name, ' +
      'lead.email AS lead_email, DATE_FORMAT(p.start_date, \"%Y-%m-%d\") AS start_date, ' +
      'DATE_FORMAT(p.end_date, \"%Y-%m-%d\") AS end_date, p.status, p.created_at, p.updated_at, ' +
      'COALESCE(progress.project_progress_percent, 0) AS project_progress_percent, ' +
      'COALESCE(progress.total_tasks, 0) AS total_tasks, COALESCE(progress.completed_tasks, 0) AS completed_tasks ' +
      'FROM projects p INNER JOIN users lead ON lead.user_id = p.lead_id ' +
      // Project progress = simple average of each task's progress percent.
      'LEFT JOIN (SELECT project_id, ROUND(AVG(effective_progress_percent), 2) AS project_progress_percent, ' +
      'COUNT(*) AS total_tasks, SUM(CASE WHEN status = \"completed\" THEN 1 ELSE 0 END) AS completed_tasks ' +
      'FROM v_task_progress GROUP BY project_id) progress ON progress.project_id = p.project_id ' +
      scope +
      ' ORDER BY FIELD(p.status, \"active\", \"planning\", \"on_hold\", \"completed\", \"cancelled\"), ' +
      'p.updated_at DESC, p.project_name ASC',
      parameters,
    );
    if (projects.length === 0) return res.json({ projects: [] });

    const projectIds = projects.map((project) => Number(project.project_id));
    const [members] = await db.query(
      'SELECT pm.project_id, u.user_id, u.name, u.email, u.role ' +
      'FROM project_members pm INNER JOIN users u ON u.user_id = pm.user_id ' +
      'WHERE pm.status = \"active\" AND u.status = \"active\" AND pm.project_id IN (?) ORDER BY u.name ASC',
      [projectIds],
    );
    const membersByProject = new Map();
    for (const member of members) {
      const projectId = Number(member.project_id);
      if (!membersByProject.has(projectId)) membersByProject.set(projectId, []);
      membersByProject.get(projectId).push({
        user_id: Number(member.user_id),
        name: member.name,
        email: member.email,
        role: member.role,
      });
    }
    return res.json({
      projects: projects.map((project) => ({
        ...project,
        project_id: Number(project.project_id),
        lead_id: Number(project.lead_id),
        project_progress_percent: Number(project.project_progress_percent),
        total_tasks: Number(project.total_tasks),
        completed_tasks: Number(project.completed_tasks),
        members: membersByProject.get(Number(project.project_id)) || [],
        can_edit: req.currentUser.role === 'admin' || Number(project.lead_id) === req.currentUser.id,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/', requireAdmin, async (req, res, next) => {
  let connection;
  try {
    const input = readProjectInput(req.body || {}, req.currentUser, true);
    if (input.startDate && input.endDate && input.endDate < input.startDate) {
      throw apiError(400, 'End date must be on or after the start date.');
    }
    if (input.leadId === undefined || input.leadId === null) throw apiError(400, 'Choose a project lead.');
    const leadId = input.leadId;
    const memberIds = addLeadToMembers(input.memberIds, leadId);
    connection = await req.app.locals.db.getConnection();
    await connection.beginTransaction();
    await validateLead(connection, leadId);
    await validateMembers(connection, memberIds);
    const [result] = await connection.execute(
      'INSERT INTO projects (project_name, description, lead_id, start_date, end_date, status) ' +
      'VALUES (?, ?, ?, ?, ?, ?)',
      [
        input.projectName,
        input.description ?? null,
        leadId,
        input.startDate ?? null,
        input.endDate ?? null,
        input.status || 'planning',
      ],
    );
    await syncProjectMembers(connection, result.insertId, memberIds);
    await recordActivity(connection, req.currentUser.id, 'project_created', 'project', result.insertId, 'Created project “' + input.projectName + '”.');
    await notifyUsers(connection, memberIds, 'You were added to project “' + input.projectName + '”.', 'project', result.insertId, req.currentUser.id);
    await connection.commit();
    return res.status(201).json({ project_id: Number(result.insertId), message: 'Project created.' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return handleError(error, res, next, 'A project with that name could not be created.');
  } finally {
    if (connection) connection.release();
  }
});

router.patch('/:projectId', requireProjectManager, async (req, res, next) => {
  let connection;
  try {
    const projectId = parseId(req.params.projectId, 'project');
    const input = readProjectInput(req.body || {}, req.currentUser, false);
    connection = await req.app.locals.db.getConnection();
    await connection.beginTransaction();
    const [[current]] = await connection.execute(
      'SELECT project_id, project_name, lead_id, DATE_FORMAT(start_date, \"%Y-%m-%d\") AS start_date, ' +
      'DATE_FORMAT(end_date, \"%Y-%m-%d\") AS end_date, status FROM projects WHERE project_id = ? FOR UPDATE',
      [projectId],
    );
    if (!current) throw apiError(404, 'That project was not found.');
    if (req.currentUser.role !== 'admin' && Number(current.lead_id) !== req.currentUser.id) {
      throw apiError(403, 'Only the project lead or an administrator can edit this project.');
    }

    const nextLeadId = input.leadId === undefined ? Number(current.lead_id) : input.leadId;
    if (req.currentUser.role === 'project_lead' && nextLeadId !== req.currentUser.id) {
      throw apiError(403, 'Project leads cannot transfer project ownership.');
    }
    await validateLead(connection, nextLeadId);
    const nextStartDate = input.startDate === undefined ? current.start_date : input.startDate;
    const nextEndDate = input.endDate === undefined ? current.end_date : input.endDate;
    if (nextStartDate && nextEndDate && nextEndDate < nextStartDate) {
      throw apiError(400, 'End date must be on or after the start date.');
    }

    const updates = [];
    const values = [];
    if (input.projectName !== undefined) {
      updates.push('project_name = ?');
      values.push(input.projectName);
    }
    if (input.description !== undefined) {
      updates.push('description = ?');
      values.push(input.description);
    }
    if (input.leadId !== undefined) {
      updates.push('lead_id = ?');
      values.push(nextLeadId);
    }
    if (input.startDate !== undefined) {
      updates.push('start_date = ?');
      values.push(input.startDate);
    }
    if (input.endDate !== undefined) {
      updates.push('end_date = ?');
      values.push(input.endDate);
    }
    if (input.status !== undefined) {
      updates.push('status = ?');
      values.push(input.status);
    }
    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(projectId);
      await connection.execute('UPDATE projects SET ' + updates.join(', ') + ' WHERE project_id = ?', values);
    }

    let newlyAddedMembers = [];
    if (input.memberIds !== undefined || input.leadId !== undefined) {
      const [existingMembers] = await connection.execute(
        'SELECT user_id FROM project_members WHERE project_id = ? AND status = \"active\"',
        [projectId],
      );
      const currentMemberIds = new Set(existingMembers.map((member) => Number(member.user_id)));
      const suppliedMembers = input.memberIds === undefined
        ? existingMembers.map((member) => Number(member.user_id))
        : input.memberIds;
      const membersWithLead = addLeadToMembers(suppliedMembers, nextLeadId);
      newlyAddedMembers = membersWithLead.filter((userId) => !currentMemberIds.has(userId));
      await syncProjectMembers(connection, projectId, membersWithLead);
    }
    const nextProjectName = input.projectName ?? current.project_name;
    await recordActivity(connection, req.currentUser.id, 'project_updated', 'project', projectId, 'Updated project “' + nextProjectName + '”.');
    await notifyUsers(connection, newlyAddedMembers, 'You were added to project “' + nextProjectName + '”.', 'project', projectId, req.currentUser.id);
    await connection.commit();
    return res.json({ message: 'Project updated.' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return handleError(error, res, next, 'A project with that name could not be saved.');
  } finally {
    if (connection) connection.release();
  }
});

export default router;
