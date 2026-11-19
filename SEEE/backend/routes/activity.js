import { Router } from 'express';
import { readDetailsText } from '../activityLog.js';

const router = Router();

function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
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

router.use(requireUser);

router.get('/', async (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const actor = req.currentUser;
    const [activity] = await db.execute(
      'SELECT feed.activity_id, feed.actor_id, COALESCE(actor.name, "A team member") AS actor_name, ' +
      'feed.action, feed.entity_type, feed.entity_id, feed.details, feed.created_at, feed.project_id, ' +
      'feed.project_name, feed.task_id, feed.task_title FROM (' +
      'SELECT a.activity_id, a.user_id AS actor_id, a.`action` AS action, a.entity_type, a.entity_id, a.details, a.created_at, ' +
      'p.project_id, p.project_name, NULL AS task_id, NULL AS task_title ' +
      'FROM activity_logs a INNER JOIN projects p ON a.entity_type = "project" AND a.entity_id = p.project_id ' +
      'UNION ALL ' +
      'SELECT a.activity_id, a.user_id AS actor_id, a.`action` AS action, a.entity_type, a.entity_id, a.details, a.created_at, ' +
      'p.project_id, p.project_name, t.task_id, t.title AS task_title ' +
      'FROM activity_logs a INNER JOIN tasks t ON a.entity_type = "task" AND a.entity_id = t.task_id ' +
      'INNER JOIN projects p ON p.project_id = t.project_id' +
      ') feed LEFT JOIN users actor ON actor.user_id = feed.actor_id ' +
      'WHERE (? = "admin" OR EXISTS (SELECT 1 FROM projects visible_project WHERE visible_project.project_id = feed.project_id ' +
      'AND visible_project.lead_id = ?) OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = feed.project_id ' +
      'AND pm.user_id = ? AND pm.status = "active") OR (feed.task_id IS NOT NULL AND (' +
      'EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_id = feed.task_id AND ta.user_id = ? ' +
      'AND ta.removed_at IS NULL AND ta.active_user_id = ?) OR ' +
      'EXISTS (SELECT 1 FROM subtasks s WHERE s.task_id = feed.task_id AND s.assignee_id = ?)))) ' +
      'ORDER BY feed.created_at DESC, feed.activity_id DESC LIMIT 60',
      [actor.role, actor.id, actor.id, actor.id, actor.id, actor.id],
    );
    const [notifications] = await db.execute(
      'SELECT n.notification_id, n.message, n.related_type, n.related_id, n.is_read, n.created_at, ' +
      'CASE WHEN n.related_type = "task" THEN task.title WHEN n.related_type = "project" THEN project.project_name ELSE NULL END AS related_title ' +
      'FROM notifications n LEFT JOIN tasks task ON n.related_type = "task" AND task.task_id = n.related_id ' +
      'LEFT JOIN projects project ON n.related_type = "project" AND project.project_id = n.related_id ' +
      'WHERE n.user_id = ? ORDER BY n.created_at DESC, n.notification_id DESC LIMIT 60',
      [actor.id],
    );
    const [[unread]] = await db.execute(
      'SELECT COUNT(*) AS unread_count FROM notifications WHERE user_id = ? AND is_read = 0',
      [actor.id],
    );
    return res.json({
      activity: activity.map((entry) => ({
        ...entry,
        details: readDetailsText(entry.details),
        activity_id: Number(entry.activity_id),
        entity_id: Number(entry.entity_id),
        project_id: Number(entry.project_id),
        task_id: entry.task_id === null ? null : Number(entry.task_id),
      })),
      notifications: notifications.map((notification) => ({
        ...notification,
        notification_id: Number(notification.notification_id),
        related_id: notification.related_id === null ? null : Number(notification.related_id),
        is_read: Boolean(notification.is_read),
      })),
      unread_count: Number(unread.unread_count),
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/notifications/:notificationId/read', async (req, res, next) => {
  try {
    const notificationId = Number(req.params.notificationId);
    if (!Number.isSafeInteger(notificationId) || notificationId < 1) throw apiError(400, 'Choose a valid notification.');
    const [result] = await req.app.locals.db.execute(
      'UPDATE notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?',
      [notificationId, req.currentUser.id],
    );
    if (result.affectedRows === 0) {
      const [[existing]] = await req.app.locals.db.execute(
        'SELECT notification_id FROM notifications WHERE notification_id = ? AND user_id = ?',
        [notificationId, req.currentUser.id],
      );
      if (!existing) throw apiError(404, 'That notification was not found.');
    }
    return res.json({ message: 'Notification marked as read.' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
});

router.post('/notifications/read-all', async (req, res, next) => {
  try {
    await req.app.locals.db.execute(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
      [req.currentUser.id],
    );
    return res.json({ message: 'All notifications marked as read.' });
  } catch (error) {
    return next(error);
  }
});

export default router;
