import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import projectsRouter from './routes/projects.js';
import tasksRouter from './routes/tasks.js';
import activityRouter from './routes/activity.js';
import collaborationRouter from './routes/collaboration.js';
import memberRequestsRouter from './routes/memberRequests.js';
import db from './db.js';

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.startsWith('replace-')) {
  throw new Error('Set SESSION_SECRET in your .env file before starting IPTMS.');
}

const app = express();
const port = Number(process.env.PORT || 3001);
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendBuild = path.resolve(currentDirectory, '../frontend/dist');

app.disable('x-powered-by');
app.locals.db = db;
app.use(express.json({ limit: '20kb' }));
app.use(session({
  name: 'iptms.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

app.get('/api/health', async (_req, res, next) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    next(error);
  }
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/tasks', collaborationRouter);
app.use('/api/tasks', memberRequestsRouter);
app.use('/api/activity', activityRouter);
app.use(express.static(frontendBuild));
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(frontendBuild, 'index.html'), (error) => error && next(error));
  }
  return next();
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  res.status(status).json({ error: status === 500 ? 'The server could not complete the request.' : 'The request could not be processed.' });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`IPTMS API listening at http://127.0.0.1:${port}`);
});
