import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

function ask(question) {
  const prompt = createInterface({ input: stdin, output: stdout });
  return prompt.question(question).finally(() => prompt.close());
}

function askHidden(question) {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(new Error('Run this command in an interactive terminal so the password can be entered safely.'));
      return;
    }

    let value = '';
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();

    const finish = (error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };

    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          finish(new Error('Cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u0008' || character === '\u007f') {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= ' ') value += character;
      }
    };

    stdin.on('data', onData);
  });
}

const db = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'iptms_db',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 2,
});

try {
  const [[{ userCount }]] = await db.query('SELECT COUNT(*) AS userCount FROM users');
  if (Number(userCount) > 0) {
    throw new Error('The users table already has an account. Use an existing administrator instead.');
  }

  const name = (await ask('Administrator name: ')).trim();
  const email = (await ask('Administrator email: ')).trim().toLowerCase();
  const password = await askHidden('Administrator password (hidden): ');

  if (!name || name.length > 100) throw new Error('Name is required and must be 100 characters or fewer.');
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 150) throw new Error('Enter a valid email address of 150 characters or fewer.');
  if (password.length < 10 || bcrypt.truncates(password)) throw new Error('Use a password of at least 10 characters and no more than 72 bytes.');

  const passwordHash = await bcrypt.hash(password, 12);
  await db.execute(
    `INSERT INTO users (name, email, password, role, status)
     VALUES (?, ?, ?, 'admin', 'active')`,
    [name, email, passwordHash],
  );

  console.log(`Administrator account created for ${email}.`);
} catch (error) {
  console.error(`Could not create the administrator: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
