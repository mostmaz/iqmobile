import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db, now } from '../db.js';

const username = process.env.ADMIN_SEED_USERNAME || 'admin';
const password = process.env.ADMIN_SEED_PASSWORD || 'admin';
const exists = db.prepare('SELECT id FROM admins WHERE username=?').get(username);
if (exists) {
  console.log(`admin "${username}" already exists`);
  process.exit(0);
}
const hash = bcrypt.hashSync(password, 10);
db.prepare('INSERT INTO admins(username, password_hash, created_at) VALUES(?,?,?)').run(username, hash, now());
console.log(`seeded admin "${username}" / "${password}"`);
