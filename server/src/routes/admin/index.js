import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, now, getSetting, setSettingValue } from '../../db.js';
import { issueToken, requireAdmin } from '../../auth.js';

const r = Router();

r.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });
  const row = db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  if (!row || !bcrypt.compareSync(password, row.password_hash))
    return res.status(401).json({ error: 'bad_credentials' });
  const token = issueToken({ id: row.id, kind: 'admin', username: row.username });
  res.json({ token, admin: { id: row.id, username: row.username } });
});

// ─── settings ────────────────────────────────────────────────────────
r.get('/settings', requireAdmin, (_req, res) => {
  res.json({
    listing_ttl_days: Number(getSetting('listing_ttl_days')) || 30,
    reserve_on_confirm: getSetting('reserve_on_confirm') === '1',
  });
});

r.patch('/settings', requireAdmin, (req, res) => {
  const { listing_ttl_days, reserve_on_confirm } = req.body || {};
  if (listing_ttl_days != null) {
    const n = Number(listing_ttl_days);
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'bad_ttl' });
    setSettingValue('listing_ttl_days', n);
  }
  if (reserve_on_confirm != null) {
    setSettingValue('reserve_on_confirm', reserve_on_confirm ? '1' : '0');
  }
  res.json({ ok: true });
});

// ─── users ────────────────────────────────────────────────────────────
r.get('/users', requireAdmin, (req, res) => {
  const q = req.query.q;
  let sql = 'SELECT id, phone, display_name, governorate, city, rating_avg, rating_count, verified, created_at FROM users';
  const params = [];
  if (q) {
    sql += ' WHERE phone LIKE ? OR display_name LIKE ?';
    const like = '%' + String(q) + '%';
    params.push(like, like);
  }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  const rows = db.prepare(sql).all(...params).map((u) => ({ ...u, verified: !!u.verified }));
  res.json(rows);
});

r.patch('/users/:id(\\d+)/verify', requireAdmin, (req, res) => {
  const verified = req.body?.verified ? 1 : 0;
  const r2 = db.prepare('UPDATE users SET verified=? WHERE id=?').run(verified, req.params.id);
  if (r2.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// ─── listings ─────────────────────────────────────────────────────────
r.get('/listings', requireAdmin, (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT l.*, u.display_name AS seller_name, u.phone AS seller_phone
    FROM phone_listings l JOIN users u ON u.id = l.seller_id
  `;
  const params = [];
  if (status) { sql += ' WHERE l.status=?'; params.push(status); }
  sql += ' ORDER BY l.created_at DESC LIMIT 200';
  res.json(db.prepare(sql).all(...params));
});

r.patch('/listings/:id(\\d+)/remove', requireAdmin, (req, res) => {
  db.prepare("UPDATE phone_listings SET status='removed', updated_at=? WHERE id=?").run(now(), req.params.id);
  res.json({ ok: true });
});

// ─── reports ──────────────────────────────────────────────────────────
r.get('/reports', requireAdmin, (req, res) => {
  const status = req.query.status || 'open';
  const rows = db.prepare(
    `SELECT r.*, u.display_name AS reporter_name, u.phone AS reporter_phone
     FROM reports r JOIN users u ON u.id = r.reporter_id
     WHERE r.status=? ORDER BY r.created_at DESC LIMIT 200`,
  ).all(status);
  res.json(rows);
});

r.patch('/reports/:id(\\d+)', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['reviewed','dismissed','open'].includes(status)) return res.status(400).json({ error: 'bad_status' });
  db.prepare('UPDATE reports SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ ok: true });
});

// ─── deals ────────────────────────────────────────────────────────────
r.get('/deals', requireAdmin, (req, res) => {
  const status = req.query.status || 'seller_confirmed';
  const rows = db.prepare(
    `SELECT d.*, l.brand, l.model,
            b.display_name AS buyer_name, s.display_name AS seller_name
     FROM deals d
     JOIN phone_listings l ON l.id = d.listing_id
     JOIN users b ON b.id = d.buyer_id
     JOIN users s ON s.id = d.seller_id
     WHERE d.status=? ORDER BY d.updated_at DESC LIMIT 200`,
  ).all(status);
  res.json(rows);
});

// ─── bypass attempts ─────────────────────────────────────────────────
r.get('/bypass-attempts', requireAdmin, (_req, res) => {
  const rows = db.prepare(
    `SELECT b.id, b.chat_id, b.user_id, b.raw_text, b.matched_pattern, b.created_at,
            u.display_name AS user_name, u.phone AS user_phone
     FROM bypass_attempts b JOIN users u ON u.id = b.user_id
     ORDER BY b.created_at DESC LIMIT 200`,
  ).all();
  res.json(rows);
});

export default r;
