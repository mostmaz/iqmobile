import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { reportLimiter } from '../limits.js';

const r = Router();

const REASONS = ['fake_listing','wrong_specs','scam_attempt','inappropriate_chat','bypass_attempt','other'];
const TARGETS = ['listing','user','chat'];

r.post('/', requireAuth(), reportLimiter, (req, res) => {
  const { target_kind, target_id, reason, detail } = req.body || {};
  if (!TARGETS.includes(target_kind)) return res.status(400).json({ error: 'bad_target' });
  if (!REASONS.includes(reason)) return res.status(400).json({ error: 'bad_reason' });
  const tid = Number(target_id);
  if (!Number.isInteger(tid) || tid <= 0) return res.status(400).json({ error: 'bad_target_id' });

  // A duplicate is not an error, and it is not a second report either.
  // People tap إبلاغ twice when the first tap gave no visible answer (which
  // it did not, until now), and a second row for the same complaint just
  // makes the queue look busier than it is. Return the existing one.
  const existing = db.prepare(
    `SELECT id, created_at FROM reports
      WHERE reporter_id=? AND target_kind=? AND target_id=? AND reason=? AND status='open'`,
  ).get(req.user.id, target_kind, tid, reason);
  if (existing) return res.json({ ok: true, id: existing.id, duplicate: true });

  const info = db.prepare(
    `INSERT INTO reports(reporter_id, target_kind, target_id, reason, detail, status, created_at)
     VALUES(?,?,?,?,?, 'open', ?)`,
  ).run(req.user.id, target_kind, tid, reason, detail ? String(detail).slice(0, 500) : null, now());

  // A real id, so the app can acknowledge from the RESPONSE rather than
  // optimistically. The old `{ok:true}` gave the client nothing to key on,
  // so ListingDetailScreen fired «تم إرسال البلاغ» after any 200 — including
  // one it had no way to distinguish from a no-op — and the user had no
  // reference to quote if they ever followed up.
  res.json({ ok: true, id: info.lastInsertRowid });
});

// What this deliberately does NOT do: report an outcome. `reports` has no
// resolved_at, no resolution and no handled_by, and PATCH /admin/reports/:id
// only writes `status`. There is nothing to notify anyone about, and
// promising a resolution we cannot deliver is worse than acknowledging
// receipt honestly. See docs/reporting.md.

export default r;
