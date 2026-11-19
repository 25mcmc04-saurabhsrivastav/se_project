import express, { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notifyUsers, recordActivity } from '../activityLog.js';

const router = Router();
const maxAttachmentBytes = 10 * 1024 * 1024;
const uploadsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');
const attachmentDirectory = path.join(uploadsRoot, 'task-attachments');
const fileTypes = new Map([
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.csv', 'text/csv'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.zip', 'application/zip'],
]);

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

function canManageProject(actor, project) {
  return actor.role === 'admin' || (actor.role === 'project_lead' && Number(project.lead_id) === actor.id);
}

async function loadTaskAccess(db, taskId, actor) {
  const [[task]] = await db.execute(
    'SELECT t.task_id, t.title, t.project_id, p.lead_id FROM tasks t ' +
    'INNER JOIN projects p ON p.project_id = t.project_id WHERE t.task_id = ?',
    [taskId],
  );
  if (!task) throw apiError(404, 'That task was not found.');
  const project = { project_id: Number(task.project_id), lead_id: Number(task.lead_id) };
  const manager = canManageProject(actor, project);
  if (manager) return { task_id: Number(task.task_id), title: task.title, project, manager };

  const [[access]] = await db.execute(
    'SELECT (' +
    'EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = ? AND pm.user_id = ? AND pm.status = \"active\") OR ' +
    'EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_id = ? AND ta.user_id = ? AND ta.removed_at IS NULL AND ta.active_user_id = ?) OR ' +
    'EXISTS (SELECT 1 FROM subtasks s WHERE s.task_id = ? AND s.assignee_id = ?)' +
    ') AS can_view',
    [project.project_id, actor.id, taskId, actor.id, actor.id, taskId, actor.id],
  );
  if (!Number(access.can_view)) throw apiError(403, 'You do not have access to this task.');
  return { task_id: Number(task.task_id), title: task.title, project, manager };
}

function validateComment(message) {
  if (typeof message !== 'string') throw apiError(400, 'Enter a comment.');
  const normalized = message.trim();
  if (!normalized || normalized.length > 5000) throw apiError(400, 'Comments must be between 1 and 5000 characters.');
  return normalized;
}

function safeOriginalName(input) {
  if (typeof input !== 'string') throw apiError(400, 'Choose a file with a name.');
  const basename = path.posix.basename(input.replace(/\\/g, '/'));
  const clean = basename.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
  if (!clean || clean === '.' || clean === '..') throw apiError(400, 'The file name is invalid.');
  return clean;
}

function hasExpectedSignature(extension, buffer) {
  if (extension === '.pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (extension === '.png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === '.jpg' || extension === '.jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (extension === '.gif') return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  if (extension === '.webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (['.zip', '.docx', '.xlsx', '.pptx'].includes(extension)) {
    return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(buffer[2]);
  }
  if (['.txt', '.md', '.csv'].includes(extension)) return !buffer.includes(0);
  return false;
}

function resolveStoredPath(filePath) {
  if (typeof filePath !== 'string' || !filePath) return null;
  const absolutePath = path.resolve(uploadsRoot, filePath);
  const relativePath = path.relative(uploadsRoot, absolutePath);
  if (!relativePath || relativePath === '..' || relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) return null;
  return absolutePath;
}

function handleError(error, res, next) {
  if (error.status) return res.status(error.status).json({ error: error.message });
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That comment could not be saved.' });
  return next(error);
}

router.use(requireUser);

router.get('/:taskId/collaboration', async (req, res, next) => {
  try {
    const taskId = Number(req.params.taskId);
    if (!Number.isSafeInteger(taskId) || taskId < 1) throw apiError(400, 'Choose a valid task.');
    const db = req.app.locals.db;
    const access = await loadTaskAccess(db, taskId, req.currentUser);
    const [comments] = await db.execute(
      'SELECT c.comment_id, c.task_id, c.user_id, u.name AS author_name, u.role AS author_role, ' +
      'c.message, c.created_at, c.updated_at FROM comments c ' +
      'INNER JOIN users u ON u.user_id = c.user_id WHERE c.task_id = ? ORDER BY c.created_at ASC, c.comment_id ASC',
      [taskId],
    );
    const [attachments] = await db.execute(
      'SELECT a.attachment_id, a.task_id, a.uploaded_by, u.name AS uploader_name, ' +
      'a.original_name, a.file_type, a.file_size, a.uploaded_at FROM attachments a ' +
      'INNER JOIN users u ON u.user_id = a.uploaded_by WHERE a.task_id = ? ORDER BY a.uploaded_at DESC, a.attachment_id DESC',
      [taskId],
    );
    return res.json({
      comments: comments.map((comment) => ({
        ...comment,
        comment_id: Number(comment.comment_id),
        user_id: Number(comment.user_id),
        can_edit: access.manager || Number(comment.user_id) === req.currentUser.id,
      })),
      attachments: attachments.map((attachment) => ({
        ...attachment,
        attachment_id: Number(attachment.attachment_id),
        file_size: Number(attachment.file_size),
        can_delete: access.manager || Number(attachment.uploaded_by) === req.currentUser.id,
        download_url: '/api/tasks/' + taskId + '/attachments/' + Number(attachment.attachment_id) + '/download',
      })),
    });
  } catch (error) {
    return handleError(error, res, next);
  }
});

router.post('/:taskId/comments', async (req, res, next) => {
  try {
    const taskId = Number(req.params.taskId);
    if (!Number.isSafeInteger(taskId) || taskId < 1) throw apiError(400, 'Choose a valid task.');
    const message = validateComment(req.body?.message);
    const db = req.app.locals.db;
    const access = await loadTaskAccess(db, taskId, req.currentUser);
    const [result] = await db.execute(
      'INSERT INTO comments (task_id, user_id, message) VALUES (?, ?, ?)',
      [taskId, req.currentUser.id, message],
    );
    await recordActivity(db, req.currentUser.id, 'comment_added', 'task', taskId, 'Commented on task “' + access.title + '”.');
    const [recipients] = await db.execute(
      'SELECT recipient_id FROM (' +
      'SELECT ta.user_id AS recipient_id FROM task_assignments ta WHERE ta.task_id = ? AND ta.removed_at IS NULL AND ta.active_user_id = ta.user_id ' +
      'UNION SELECT s.assignee_id AS recipient_id FROM subtasks s WHERE s.task_id = ? AND s.assignee_id IS NOT NULL ' +
      'UNION SELECT p.lead_id AS recipient_id FROM tasks t INNER JOIN projects p ON p.project_id = t.project_id WHERE t.task_id = ?' +
      ') related_users INNER JOIN users u ON u.user_id = related_users.recipient_id WHERE u.status = "active"',
      [taskId, taskId, taskId],
    );
    await notifyUsers(
      db,
      recipients.map((recipient) => Number(recipient.recipient_id)),
      req.currentUser.name + ' commented on task “' + access.title + '”.',
      'task',
      taskId,
      req.currentUser.id,
    );
    const [[comment]] = await db.execute(
      'SELECT c.comment_id, c.task_id, c.user_id, u.name AS author_name, u.role AS author_role, ' +
      'c.message, c.created_at, c.updated_at FROM comments c INNER JOIN users u ON u.user_id = c.user_id ' +
      'WHERE c.comment_id = ?',
      [result.insertId],
    );
    return res.status(201).json({
      comment: {
        ...comment,
        comment_id: Number(comment.comment_id),
        user_id: Number(comment.user_id),
        can_edit: true,
      },
    });
  } catch (error) {
    return handleError(error, res, next);
  }
});

router.patch('/:taskId/comments/:commentId', async (req, res, next) => {
  try {
    const taskId = Number(req.params.taskId);
    const commentId = Number(req.params.commentId);
    if (!Number.isSafeInteger(taskId) || taskId < 1 || !Number.isSafeInteger(commentId) || commentId < 1) {
      throw apiError(400, 'Choose a valid comment.');
    }
    const message = validateComment(req.body?.message);
    const db = req.app.locals.db;
    const access = await loadTaskAccess(db, taskId, req.currentUser);
    const [[comment]] = await db.execute(
      'SELECT comment_id, user_id FROM comments WHERE comment_id = ? AND task_id = ?',
      [commentId, taskId],
    );
    if (!comment) throw apiError(404, 'That comment was not found.');
    if (!access.manager && Number(comment.user_id) !== req.currentUser.id) {
      throw apiError(403, 'You can edit only your own comments.');
    }
    await db.execute('UPDATE comments SET message = ?, updated_at = CURRENT_TIMESTAMP WHERE comment_id = ?', [message, commentId]);
    await recordActivity(db, req.currentUser.id, 'comment_updated', 'task', taskId, 'Edited a comment on task “' + access.title + '”.');
    const [[updated]] = await db.execute(
      'SELECT c.comment_id, c.task_id, c.user_id, u.name AS author_name, u.role AS author_role, ' +
      'c.message, c.created_at, c.updated_at FROM comments c INNER JOIN users u ON u.user_id = c.user_id ' +
      'WHERE c.comment_id = ?',
      [commentId],
    );
    return res.json({
      comment: {
        ...updated,
        comment_id: Number(updated.comment_id),
        user_id: Number(updated.user_id),
        can_edit: access.manager || Number(updated.user_id) === req.currentUser.id,
      },
    });
  } catch (error) {
    return handleError(error, res, next);
  }
});

router.post(
  '/:taskId/attachments',
  express.raw({ type: 'application/octet-stream', limit: maxAttachmentBytes }),
  async (req, res, next) => {
    let absoluteFilePath;
    try {
      const taskId = Number(req.params.taskId);
      if (!Number.isSafeInteger(taskId) || taskId < 1) throw apiError(400, 'Choose a valid task.');
      const access = await loadTaskAccess(req.app.locals.db, taskId, req.currentUser);
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) throw apiError(400, 'Choose a file to upload.');
      if (body.length > maxAttachmentBytes) throw apiError(413, 'Files must be 10 MB or smaller.');

      const originalName = safeOriginalName(req.query.filename);
      const extension = path.posix.extname(originalName).toLowerCase();
      const fileType = fileTypes.get(extension);
      if (!fileType) throw apiError(415, 'This file type is not supported.');
      if (!hasExpectedSignature(extension, body)) throw apiError(415, 'The file content does not match its file type.');

      const storedName = randomUUID() + extension;
      const relativePath = path.posix.join('task-attachments', storedName);
      absoluteFilePath = path.join(attachmentDirectory, storedName);
      await fs.mkdir(attachmentDirectory, { recursive: true });
      await fs.writeFile(absoluteFilePath, body, { flag: 'wx' });

      let connection;
      try {
        connection = await req.app.locals.db.getConnection();
        await connection.beginTransaction();
        const [result] = await connection.execute(
          'INSERT INTO attachments (task_id, uploaded_by, original_name, stored_name, file_path, file_type, file_size) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?)',
          [taskId, req.currentUser.id, originalName, storedName, relativePath, fileType, body.length],
        );
        await recordActivity(connection, req.currentUser.id, 'attachment_added', 'task', taskId, 'Attached “' + originalName + '” to task “' + access.title + '”.');
        await connection.commit();
        return res.status(201).json({
          attachment: {
            attachment_id: Number(result.insertId),
            original_name: originalName,
            file_type: fileType,
            file_size: body.length,
            uploader_name: req.currentUser.name,
            uploaded_at: new Date(),
            can_delete: true,
            download_url: '/api/tasks/' + taskId + '/attachments/' + Number(result.insertId) + '/download',
          },
        });
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        throw error;
      } finally {
        if (connection) connection.release();
      }
    } catch (error) {
      if (absoluteFilePath) await fs.unlink(absoluteFilePath).catch(() => {});
      return handleError(error, res, next);
    }
  },
);

router.get('/:taskId/attachments/:attachmentId/download', async (req, res, next) => {
  try {
    const taskId = Number(req.params.taskId);
    const attachmentId = Number(req.params.attachmentId);
    if (!Number.isSafeInteger(taskId) || taskId < 1 || !Number.isSafeInteger(attachmentId) || attachmentId < 1) {
      throw apiError(400, 'Choose a valid attachment.');
    }
    await loadTaskAccess(req.app.locals.db, taskId, req.currentUser);
    const [[attachment]] = await req.app.locals.db.execute(
      'SELECT original_name, file_path FROM attachments WHERE attachment_id = ? AND task_id = ?',
      [attachmentId, taskId],
    );
    if (!attachment) throw apiError(404, 'That attachment was not found.');
    const absolutePath = resolveStoredPath(attachment.file_path);
    if (!absolutePath) throw apiError(404, 'That attachment was not found.');
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat || !stat.isFile()) throw apiError(404, 'That attachment file is missing.');
    return res.download(absolutePath, attachment.original_name, {
      headers: { 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' },
    }, (error) => {
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    return handleError(error, res, next);
  }
});

router.delete('/:taskId/attachments/:attachmentId', async (req, res, next) => {
  try {
    const taskId = Number(req.params.taskId);
    const attachmentId = Number(req.params.attachmentId);
    if (!Number.isSafeInteger(taskId) || taskId < 1 || !Number.isSafeInteger(attachmentId) || attachmentId < 1) {
      throw apiError(400, 'Choose a valid attachment.');
    }
    const db = req.app.locals.db;
    const access = await loadTaskAccess(db, taskId, req.currentUser);
    const [[attachment]] = await db.execute(
      'SELECT uploaded_by, file_path, original_name FROM attachments WHERE attachment_id = ? AND task_id = ?',
      [attachmentId, taskId],
    );
    if (!attachment) throw apiError(404, 'That attachment was not found.');
    if (!access.manager && Number(attachment.uploaded_by) !== req.currentUser.id) {
      throw apiError(403, 'You can remove only files you uploaded.');
    }
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('DELETE FROM attachments WHERE attachment_id = ?', [attachmentId]);
      await recordActivity(connection, req.currentUser.id, 'attachment_removed', 'task', taskId, 'Removed “' + attachment.original_name + '” from task “' + access.title + '”.');
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
    const absolutePath = resolveStoredPath(attachment.file_path);
    if (absolutePath) await fs.unlink(absolutePath).catch(() => {});
    return res.sendStatus(204);
  } catch (error) {
    return handleError(error, res, next);
  }
});

export default router;
