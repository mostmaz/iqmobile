import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const r = Router();

r.get('/', requireAuth(), (req, res) => {
  const rows = db.prepare(
    'SELECT id, kind, payload_json, read, created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100',
  ).all(req.user.id);
  res.json(rows.map((row) => ({ ...row, payload: JSON.parse(row.payload_json || '{}'), read: !!row.read })));
});

r.post('/read-all', requireAuth(), (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE user_id=? AND read=0').run(req.user.id);
  res.json({ ok: true });
});

r.post('/:id(\\d+)/read', requireAuth(), (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

export default r;
