import { Router } from 'express';
import { notifyUsers, recordActivity } from '../activityLog.js';

// Member requests (SRS process 4.0):
// an employee assigned to a task asks for an extra member with a reason,
// the project lead (or an admin) approves or declines, and on approval
// the chosen person is added to the project and to the task as a contributor.
const router = Router();

function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function handleError(error, res, next) {
  if (error.status) return res.status(error.status).json({ error: error.message });
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That person is already on this task. Refresh and try again.' });
  return next(error);
}

function parseId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw apiError(400, 'Choose a valid ' + label + '.');
  return id;
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
    req.currentUser = { id: Number(account.user_id), name: account.name, email: account.email, role: account.role };
    return next();
  } catch (error) {
    return next(error);
  }
}

async function loadTask(connection, taskId, lock = false) {
  const [[task]] = await connection.execute(
    'SELECT t.task_id, t.title, t.status, t.project_id, p.lead_id, p.status AS project_status ' +
    'FROM tasks t INNER JOIN projects p ON p.project_id = t.project_id WHERE t.task_id = ?' + (lock ? ' FOR UPDATE' : ''),
    [taskId],
  );
  if (!task) throw apiError(404, 'That task was not found.');
  return {
    ...task,
    task_id: Number(task.task_id),
    project_id: Number(task.project_id),
    lead_id: Number(task.lead_id),
  };
}

function canManage(actor, task) {
  return actor.role === 'admin' || (actor.role === 'project_lead' && task.lead_id === actor.id);
}

async function isTaskParticipant(connection, taskId, userId) {
  const [rows] = await connection.execute(
    'SELECT 1 FROM task_assignments WHERE task_id = ? AND user_id = ? AND removed_at IS NULL AND active_user_id = ? ' +
    'UNION SELECT 1 FROM subtasks WHERE task_id = ? AND assignee_id = ? LIMIT 1',
    [taskId, userId, userId, taskId, userId],
  );
  return rows.length > 0;
}

async function ensureProjectMember(connection, projectId, userId) {
  const [rows] = await connection.execute(
    'SELECT project_member_id, status FROM project_members WHERE project_id = ? AND user_id = ? ORDER BY project_member_id ASC FOR UPDATE',
    [projectId, userId],
  );
  if (rows.some((row) => row.status === 'active')) return false;
  if (rows.length > 0) {
    await connection.execute(
      'UPDATE project_members SET status = "active", active_user_id = ? WHERE project_member_id = ?',
      [userId, rows[0].project_member_id],
    );
  } else {
    await connection.execute(
      'INSERT INTO project_members (project_id, user_id, status, active_user_id) VALUES (?, ?, "active", ?)',
      [projectId, userId, userId],
    );
  }
  return true;
}

router.use(requireUser);

// Employee: request an extra member for a task.
router.post('/:taskId/member-requests', async (req, res, next) => {
  let connection;
  try {
    const taskId = parseId(req.params.taskId, 'task');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length < 5 || reason.length > 2000) {
      throw apiError(400, 'Explain why you need another member (5 to 2000 characters), for example the skill required.');
    }
    connection = await req.app.locals.db.getConnection();
    await connection.beginTransaction();
    const task = await loadTask(connection, taskId);
    if (canManage(req.currentUser, task)) {
      throw apiError(400, 'You manage this project, so you can add members to the task directly.');
    }
    if (!(await isTaskParticipant(connection, taskId, req.currentUser.id))) {
      throw apiError(403, 'Only people assigned to this task can request another member.');
    }
    if (task.status === 'completed') throw apiError(409, 'This task is already completed.');
    const [pending] = await connection.execute(
      'SELECT request_id FROM member_requests WHERE task_id = ? AND requested_by = ? AND status = "pending" LIMIT 1',
      [taskId, req.currentUser.id],
    );
    if (pending.length) throw apiError(409, 'You already have a pending request for this task.');
    const [result] = await connection.execute(
      'INSERT INTO member_requests (task_id, requested_by, reason, status) VALUES (?, ?, ?, "pending")',
      [taskId, req.currentUser.id, reason],
    );
    await recordActivity(connection, req.currentUser.id, 'member_requested', 'task', taskId, 'Requested another member for task “' + task.title + '”.');
    await notifyUsers(
      connection,
      [task.lead_id],
      req.currentUser.name + ' requested another member for task “' + task.title + '”.',
      'task',
      taskId,
      req.currentUser.id,
    );
    await connection.commit();
    return res.status(201).json({ request_id: Number(result.insertId), message: 'Request sent to the project lead.' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return handleError(error, res, next);
  } finally {
    if (connection) connection.release();
  }
});

// Project lead / admin: approve (choosing who to add) or decline a request.
router.patch('/:taskId/member-requests/:requestId', async (req, res, next) => {
  let connection;
  try {
    const taskId = parseId(req.params.taskId, 'task');
    const requestId = parseId(req.params.requestId, 'request');
    const decision = req.body?.decision;
    if (!['approved', 'rejected'].includes(decision)) throw apiError(400, 'Choose approve or decline.');
    const userId = decision === 'approved' ? parseId(req.body?.user_id, 'person to add') : null;

    connection = await req.app.locals.db.getConnection();
    await connection.beginTransaction();
    const task = await loadTask(connection, taskId, true);
    if (!canManage(req.currentUser, task)) {
      throw apiError(403, 'Only the project lead or an administrator can review member requests.');
    }
    const [[memberRequest]] = await connection.execute(
      'SELECT request_id, requested_by, status FROM member_requests WHERE request_id = ? AND task_id = ? FOR UPDATE',
      [requestId, taskId],
    );
    if (!memberRequest) throw apiError(404, 'That request was not found.');
    if (memberRequest.status !== 'pending') throw apiError(409, 'This request has already been ' + memberRequest.status + '.');

    let addedName = null;
    if (decision === 'approved') {
      const [[person]] = await connection.execute(
        'SELECT user_id, name FROM users WHERE user_id = ? AND status = "active"',
        [userId],
      );
      if (!person) throw apiError(400, 'Choose an active account to add.');
      if (await isTaskParticipant(connection, taskId, userId)) {
        const [assigned] = await connection.execute(
          'SELECT 1 FROM task_assignments WHERE task_id = ? AND user_id = ? AND removed_at IS NULL AND active_user_id = ?',
          [taskId, userId, userId],
        );
        if (assigned.length) throw apiError(409, person.name + ' is already assigned to this task.');
      }
      const joinedProject = await ensureProjectMember(connection, task.project_id, userId);
      await connection.execute(
        'INSERT INTO task_assignments (task_id, user_id, assignment_role, assigned_by, active_user_id, active_owner_task_id) ' +
        'VALUES (?, ?, "contributor", ?, ?, NULL)',
        [taskId, userId, req.currentUser.id, userId],
      );
      addedName = person.name;
      await notifyUsers(
        connection,
        [userId],
        'You were added to task “' + task.title + '”' + (joinedProject ? ' and its project' : '') + '.',
        'task',
        taskId,
        req.currentUser.id,
      );
    }

    await connection.execute(
      'UPDATE member_requests SET status = ?, handled_by = ?, handled_at = CURRENT_TIMESTAMP WHERE request_id = ?',
      [decision, req.currentUser.id, requestId],
    );
    await recordActivity(
      connection,
      req.currentUser.id,
      decision === 'approved' ? 'member_request_approved' : 'member_request_rejected',
      'task',
      taskId,
      decision === 'approved'
        ? 'Approved a member request and added ' + addedName + ' to task “' + task.title + '”.'
        : 'Declined a member request for task “' + task.title + '”.',
    );
    await notifyUsers(
      connection,
      [Number(memberRequest.requested_by)],
      decision === 'approved'
        ? 'Your member request for task “' + task.title + '” was approved. ' + addedName + ' was added.'
        : 'Your member request for task “' + task.title + '” was declined.',
      'task',
      taskId,
      req.currentUser.id,
    );
    await connection.commit();
    return res.json({ message: decision === 'approved' ? addedName + ' was added to the task.' : 'Request declined.' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return handleError(error, res, next);
  } finally {
    if (connection) connection.release();
  }
});

export default router;
