import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth } from '../auth.js';

const r = Router();

const REASONS = ['fake_listing','wrong_specs','scam_attempt','inappropriate_chat','bypass_attempt','other'];
const TARGETS = ['listing','user','chat'];

r.post('/', requireAuth(), (req, res) => {
  const { target_kind, target_id, reason, detail } = req.body || {};
  if (!TARGETS.includes(target_kind)) return res.status(400).json({ error: 'bad_target' });
  if (!REASONS.includes(reason)) return res.status(400).json({ error: 'bad_reason' });
  const tid = Number(target_id);
  if (!Number.isInteger(tid) || tid <= 0) return res.status(400).json({ error: 'bad_target_id' });

  db.prepare(
    `INSERT INTO reports(reporter_id, target_kind, target_id, reason, detail, status, created_at)
     VALUES(?,?,?,?,?, 'open', ?)`,
  ).run(req.user.id, target_kind, tid, reason, detail ? String(detail).slice(0, 500) : null, now());
  res.json({ ok: true });
});

export default r;
