import { Router } from 'express';
import bcrypt from 'bcryptjs';

const router = Router();

function safeUser(user) {
  return {
    id: Number(user.user_id),
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

function supportsStoredHash(hash) {
  if (typeof hash !== 'string') return '';
  // PHP's bcrypt hashes use the $2y$ prefix; bcrypt.js uses the equivalent $2b$ marker.
  return hash.startsWith('$2y$') ? `$2b$${hash.slice(4)}` : hash;
}

router.get('/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not signed in.' });
  }
  return res.json({ user: req.session.user });
});

router.post('/login', async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password || email.length > 150 || bcrypt.truncates(password)) {
      return res.status(400).json({ error: 'Enter a valid email address and password.' });
    }

    const [users] = await req.app.locals.db.execute(
      `SELECT user_id, name, email, password, role, status
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [email],
    );
    const user = users[0];
    const isActive = user && String(user.status).trim().toLowerCase() === 'active';
    let passwordMatches = false;

    if (user && typeof user.password === 'string') {
      try {
        passwordMatches = await bcrypt.compare(password, supportsStoredHash(user.password));
      } catch {
        passwordMatches = false;
      }
    }

    if (!isActive || !passwordMatches) {
      return res.status(401).json({ error: 'The email or password is incorrect.' });
    }

    await new Promise((resolve, reject) => {
      req.session.regenerate((error) => error ? reject(error) : resolve());
    });
    req.session.user = safeUser(user);
    return res.json({ user: req.session.user });
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', (req, res, next) => {
  if (!req.session) return res.sendStatus(204);

  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('iptms.sid');
    return res.sendStatus(204);
  });
});

export default router;
