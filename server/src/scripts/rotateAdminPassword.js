// Idempotent admin password rotation.
//
// Reads ADMIN_SEED_USERNAME + ADMIN_SEED_PASSWORD from the environment
// (typically server/.env), bcrypts the password, and either UPDATEs the
// existing admin row or INSERTs a new one. Safe to re-run; running with
// the same env values is a no-op.
//
// Usage (on the droplet, after editing server/.env):
//   node src/scripts/rotateAdminPassword.js
//
// Unlike seedAdmin.js, this overwrites an existing password — it's the
// way to ROTATE credentials after the initial default seed.

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db, now } from '../db.js';

const username = process.env.ADMIN_SEED_USERNAME || 'admin';
const password = process.env.ADMIN_SEED_PASSWORD;
if (!password) {
  console.error('FATAL: ADMIN_SEED_PASSWORD env var is required');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
const existing = db.prepare('SELECT id FROM admins WHERE username=?').get(username);

if (existing) {
  db.prepare('UPDATE admins SET password_hash=? WHERE username=?').run(hash, username);
  console.log(`rotated password for admin "${username}"`);
} else {
  db.prepare(
    'INSERT INTO admins(username, password_hash, created_at) VALUES(?,?,?)',
  ).run(username, hash, now());
  console.log(`created admin "${username}"`);
}
