import { Router } from 'express';
import bcrypt from 'bcryptjs';

const router = Router();
const allowedRoles = new Set(['admin', 'project_lead', 'employee']);
const allowedStatuses = new Set(['active', 'inactive']);

function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function handleError(error, res, next, duplicateMessage) {
  if (error.status) return res.status(error.status).json({ error: error.message });
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: duplicateMessage });
  return next(error);
}

async function requireAdmin(req, res, next) {
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
    req.session.user = {
      ...req.session.user,
      id: Number(account.user_id),
      name: account.name,
      email: account.email,
      role: account.role,
    };
    if (account.role !== 'admin') return res.status(403).json({ error: 'Administrator access is required.' });
    return next();
  } catch (error) {
    return next(error);
  }
}

function safeUser(user, teams = []) {
  return {
    user_id: Number(user.user_id),
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    designation: user.designation,
    status: user.status,
    created_at: user.created_at,
    updated_at: user.updated_at,
    teams,
  };
}

function readOptionalText(body, key, maxLength, label) {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return undefined;
  const value = body[key];
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw apiError(400, label + ' must be text.');
  const normalized = value.trim();
  if (normalized.length > maxLength) throw apiError(400, label + ' must be ' + maxLength + ' characters or fewer.');
  return normalized || null;
}

function parseId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw apiError(400, 'Choose a valid ' + label + '.');
  return id;
}

function parseMemberIds(value) {
  if (!Array.isArray(value) || value.length > 500) throw apiError(400, 'Choose a valid team member list.');
  const ids = value.map((id) => parseId(id, 'team member'));
  return [...new Set(ids)];
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10 || bcrypt.truncates(password)) {
    throw apiError(400, 'Use a password of at least 10 characters and no more than 72 bytes.');
  }
}

function validateEmail(email) {
  if (typeof email !== 'string') throw apiError(400, 'Enter a valid work email address.');
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 150 || !/^\S+@\S+\.\S+$/.test(normalized)) {
    throw apiError(400, 'Enter a valid work email address of 150 characters or fewer.');
  }
  return normalized;
}

function validateRole(role) {
  if (!allowedRoles.has(role)) throw apiError(400, 'Choose a valid role.');
  return role;
}

function validateStatus(status) {
  if (!allowedStatuses.has(status)) throw apiError(400, 'Choose a valid account status.');
  return status;
}

router.use(requireAdmin);

router.get('/users', async (_req, res, next) => {
  try {
    const [users] = await reqDb(_req).execute(
      'SELECT user_id, name, email, role, department, designation, status, created_at, updated_at ' +
      'FROM users ORDER BY (status = \"active\") DESC, name ASC',
    );
    const [memberships] = await reqDb(_req).execute(
      'SELECT tm.user_id, t.team_name FROM team_members tm ' +
      'INNER JOIN teams t ON t.team_id = tm.team_id ' +
      'WHERE tm.status = \"active\" ORDER BY t.team_name ASC',
    );
    const teamNames = new Map();
    for (const membership of memberships) {
      const userId = Number(membership.user_id);
      if (!teamNames.has(userId)) teamNames.set(userId, []);
      teamNames.get(userId).push(membership.team_name);
    }
    return res.json({ users: users.map((user) => safeUser(user, teamNames.get(Number(user.user_id)) || [])) });
  } catch (error) {
    return next(error);
  }
});

router.post('/users', async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100) throw apiError(400, 'Name is required and must be 100 characters or fewer.');
    const email = validateEmail(body.email);
    const role = validateRole(body.role || 'employee');
    const department = readOptionalText(body, 'department', 100, 'Department') ?? null;
    const designation = readOptionalText(body, 'designation', 100, 'Designation') ?? null;
    const password = body.password;
    validatePassword(password);
    const passwordHash = await bcrypt.hash(password, 12);

    const [result] = await reqDb(req).execute(
      'INSERT INTO users (name, email, password, role, department, designation, status) ' +
      'VALUES (?, ?, ?, ?, ?, ?, \"active\")',
      [name, email, passwordHash, role, department, designation],
    );
    const [[user]] = await reqDb(req).execute(
      'SELECT user_id, name, email, role, department, designation, status, created_at, updated_at ' +
      'FROM users WHERE user_id = ?',
      [result.insertId],
    );
    return res.status(201).json({ user: safeUser(user) });
  } catch (error) {
    return handleError(error, res, next, 'An account with that email already exists.');
  }
});

router.patch('/users/:userId', async (req, res, next) => {
  let connection;
  try {
    const userId = parseId(req.params.userId, 'user');
    const body = req.body || {};
    const updates = [];
    const values = [];
    let passwordHash;

    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 100) throw apiError(400, 'Name is required and must be 100 characters or fewer.');
      updates.push('name = ?');
      values.push(name);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'email')) {
      updates.push('email = ?');
      values.push(validateEmail(body.email));
    }
    if (Object.prototype.hasOwnProperty.call(body, 'role')) {
      updates.push('role = ?');
      values.push(validateRole(body.role));
    }
    if (Object.prototype.hasOwnProperty.call(body, 'department')) {
      updates.push('department = ?');
      values.push(readOptionalText(body, 'department', 100, 'Department'));
    }
    if (Object.prototype.hasOwnProperty.call(body, 'designation')) {
      updates.push('designation = ?');
      values.push(readOptionalText(body, 'designation', 100, 'Designation'));
    }
    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
      updates.push('status = ?');
      values.push(validateStatus(body.status));
    }
    if (Object.prototype.hasOwnProperty.call(body, 'password') && body.password !== '') {
      validatePassword(body.password);
      passwordHash = await bcrypt.hash(body.password, 12);
      updates.push('password = ?');
      values.push(passwordHash);
    }
    if (updates.length === 0) throw apiError(400, 'There are no account changes to save.');

    connection = await reqDb(req).getConnection();
    await connection.beginTransaction();
    const [[current]] = await connection.execute(
      'SELECT user_id, name, email, role, status FROM users WHERE user_id = ? FOR UPDATE',
      [userId],
    );
    if (!current) throw apiError(404, 'That account was not found.');

    const nextRole = Object.prototype.hasOwnProperty.call(body, 'role') ? validateRole(body.role) : current.role;
    const nextStatus = Object.prototype.hasOwnProperty.call(body, 'status') ? validateStatus(body.status) : current.status;
    const isSelf = Number(req.session.user.id) === userId;
    if (isSelf && (nextRole !== 'admin' || nextStatus !== 'active')) {
      throw apiError(400, 'You cannot remove your own active administrator access.');
    }

    if (nextStatus === 'inactive' || !['admin', 'project_lead'].includes(nextRole)) {
      const [ledProjects] = await connection.execute(
        'SELECT project_id FROM projects WHERE lead_id = ? FOR UPDATE',
        [userId],
      );
      if (ledProjects.length > 0) {
        throw apiError(409, 'Reassign this account’s projects before deactivating it or changing its role.');
      }
    }

    if (current.role === 'admin' && current.status === 'active' && (nextRole !== 'admin' || nextStatus !== 'active')) {
      const [activeAdmins] = await connection.execute(
        'SELECT user_id FROM users WHERE role = \"admin\" AND status = \"active\" FOR UPDATE',
      );
      if (activeAdmins.length <= 1) throw apiError(409, 'Keep at least one active administrator account.');
    }

    if (nextStatus === 'inactive' && current.status !== 'inactive') {
      await connection.execute(
        'UPDATE team_members SET status = \"inactive\", active_user_id = NULL WHERE user_id = ?',
        [userId],
      );
      await connection.execute(
        'UPDATE project_members SET status = \"inactive\", active_user_id = NULL WHERE user_id = ?',
        [userId],
      );
      await connection.execute(
        'UPDATE task_assignments SET removed_at = CURRENT_TIMESTAMP, active_user_id = NULL, active_owner_task_id = NULL ' +
        'WHERE user_id = ? AND removed_at IS NULL',
        [userId],
      );
      await connection.execute('UPDATE subtasks SET assignee_id = NULL WHERE assignee_id = ?', [userId]);
    }
    if (nextStatus === 'inactive' || !['admin', 'project_lead'].includes(nextRole)) {
      await connection.execute('UPDATE teams SET team_lead_id = NULL WHERE team_lead_id = ?', [userId]);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(userId);
    await connection.execute('UPDATE users SET ' + updates.join(', ') + ' WHERE user_id = ?', values);
    const [[updated]] = await connection.execute(
      'SELECT user_id, name, email, role, department, designation, status, created_at, updated_at ' +
      'FROM users WHERE user_id = ?',
      [userId],
    );
    await connection.commit();
    if (isSelf) {
      req.session.user = { ...req.session.user, name: updated.name, email: updated.email, role: updated.role };
    }
    return res.json({ user: safeUser(updated) });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return handleError(error, res, next, 'An account with that email already exists.');
  } finally {
    if (connection) connection.release();
  }
});

async function validateTeamLead(connection, teamLeadId) {
  if (teamLeadId === null) return;
  const [leads] = await connection.execute(
    'SELECT user_id FROM users WHERE user_id = ? AND status = \"active\" AND role IN (\"admin\", \"project_lead\")',
    [teamLeadId],
  );
  if (leads.length === 0) throw apiError(400, 'A team lead must be an active admin or project lead.');
}

async function syncTeamMembers(connection, teamId, memberIds) {
  if (memberIds.length > 0) {
    const [activeUsers] = await connection.query(
      'SELECT user_id FROM users WHERE status = \"active\" AND user_id IN (?)',
      [memberIds],
    );
    if (activeUsers.length !== memberIds.length) {
      throw apiError(400, 'Only active accounts can be added to a team.');
    }
  }

  const [existingRows] = await connection.execute(
    'SELECT team_member_id, user_id, status FROM team_members WHERE team_id = ? FOR UPDATE',
    [teamId],
  );
  const desired = new Set(memberIds);
  const rowsByUser = new Map();
  for (const row of existingRows) {
    const userId = Number(row.user_id);
    if (!rowsByUser.has(userId)) rowsByUser.set(userId, []);
    rowsByUser.get(userId).push(row);
    if (!desired.has(userId)) {
      await connection.execute(
        'UPDATE team_members SET status = \"inactive\", active_user_id = NULL WHERE team_member_id = ?',
        [row.team_member_id],
      );
    }
  }

  for (const userId of memberIds) {
    const rows = rowsByUser.get(userId) || [];
    if (rows.length === 0) {
      await connection.execute(
        'INSERT INTO team_members (team_id, user_id, status, active_user_id) VALUES (?, ?, \"active\", ?)',
        [teamId, userId, userId],
      );
      continue;
    }

    for (const row of rows) {
      await connection.execute(
        'UPDATE team_members SET status = \"inactive\", active_user_id = NULL WHERE team_member_id = ?',
        [row.team_member_id],
      );
    }
    await connection.execute(
      'UPDATE team_members SET status = \"active\", active_user_id = ? WHERE team_member_id = ?',
      [userId, rows[0].team_member_id],
    );
  }
}

function readTeamInput(body, isCreate) {
  const teamName = Object.prototype.hasOwnProperty.call(body, 'team_name')
    ? (typeof body.team_name === 'string' ? body.team_name.trim() : '')
    : undefined;
  if ((isCreate || teamName !== undefined) && (!teamName || teamName.length > 100)) {
    throw apiError(400, 'Team name is required and must be 100 characters or fewer.');
  }

  let teamLeadId;
  if (Object.prototype.hasOwnProperty.call(body, 'team_lead_id')) {
    teamLeadId = body.team_lead_id === null || body.team_lead_id === ''
      ? null
      : parseId(body.team_lead_id, 'team lead');
  }

  const description = readOptionalText(body, 'description', 5000, 'Description');
  const memberIds = Object.prototype.hasOwnProperty.call(body, 'member_ids')
    ? parseMemberIds(body.member_ids)
    : (isCreate ? [] : undefined);

  if (!isCreate && teamName === undefined && teamLeadId === undefined && description === undefined && memberIds === undefined) {
    throw apiError(400, 'There are no team changes to save.');
  }
  return { teamName, teamLeadId, description, memberIds };
}

router.get('/teams', async (_req, res, next) => {
  try {
    const db = reqDb(_req);
    const [teams] = await db.execute(
      'SELECT t.team_id, t.team_name, t.description, t.team_lead_id, t.created_at, t.updated_at, ' +
      'lead.name AS team_lead_name, COUNT(DISTINCT tm.user_id) AS member_count ' +
      'FROM teams t LEFT JOIN users lead ON lead.user_id = t.team_lead_id ' +
      'LEFT JOIN team_members tm ON tm.team_id = t.team_id AND tm.status = \"active\" ' +
      'GROUP BY t.team_id, t.team_name, t.description, t.team_lead_id, t.created_at, t.updated_at, lead.name ' +
      'ORDER BY t.team_name ASC',
    );
    const [members] = await db.execute(
      'SELECT tm.team_id, u.user_id, u.name, u.email, u.role ' +
      'FROM team_members tm INNER JOIN users u ON u.user_id = tm.user_id ' +
      'WHERE tm.status = \"active\" AND u.status = \"active\" ORDER BY u.name ASC',
    );
    const membersByTeam = new Map();
    for (const member of members) {
      const teamId = Number(member.team_id);
      if (!membersByTeam.has(teamId)) membersByTeam.set(teamId, []);
      membersByTeam.get(teamId).push({
        user_id: Number(member.user_id),
        name: member.name,
        email: member.email,
        role: member.role,
      });
    }
    return res.json({
      teams: teams.map((team) => ({
        ...team,
        team_id: Number(team.team_id),
        team_lead_id: team.team_lead_id === null ? null : Number(team.team_lead_id),
        member_count: Number(team.member_count),
        members: membersByTeam.get(Number(team.team_id)) || [],
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/teams', async (req, res, next) => {
  let connection;
  try {
    const input = readTeamInput(req.body || {}, true);
    connection = await reqDb(req).getConnection();
    await connection.beginTransaction();
    await validateTeamLead(connection, input.teamLeadId ?? null);
    const [result] = await connection.execute(
      'INSERT INTO teams (team_name, description, team_lead_id) VALUES (?, ?, ?)',
      [input.teamName, input.description ?? null, input.teamLeadId ?? null],
    );
    await syncTeamMembers(connection, result.insertId, input.memberIds);
    await connection.commit();
    return res.status(201).json({ team_id: Number(result.insertId), message: 'Team created.' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return handleError(error, res, next, 'A team with that name already exists.');
  } finally {
    if (connection) connection.release();
  }
});

router.patch('/teams/:teamId', async (req, res, next) => {
  let connection;
  try {
    const teamId = parseId(req.params.teamId, 'team');
    const input = readTeamInput(req.body || {}, false);
    connection = await reqDb(req).getConnection();
    await connection.beginTransaction();
    const [[team]] = await connection.execute('SELECT team_id FROM teams WHERE team_id = ? FOR UPDATE', [teamId]);
    if (!team) throw apiError(404, 'That team was not found.');
    if (input.teamLeadId !== undefined) await validateTeamLead(connection, input.teamLeadId);

    const updates = [];
    const values = [];
    if (input.teamName !== undefined) {
      updates.push('team_name = ?');
      values.push(input.teamName);
    }
    if (input.description !== undefined) {
      updates.push('description = ?');
      values.push(input.description);
    }
    if (input.teamLeadId !== undefined) {
      updates.push('team_lead_id = ?');
      values.push(input.teamLeadId);
    }
    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(teamId);
      await connection.execute('UPDATE teams SET ' + updates.join(', ') + ' WHERE team_id = ?', values);
    }
    if (input.memberIds !== undefined) await syncTeamMembers(connection, teamId, input.memberIds);
    await connection.commit();
    return res.json({ message: 'Team updated.' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return handleError(error, res, next, 'A team with that name already exists.');
  } finally {
    if (connection) connection.release();
  }
});

function reqDb(req) {
  return req.app.locals.db;
}

export default router;
