import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { notify } from '../notify.js';

const r = Router();

// Submit a rating tied to a confirmed deal. Either party can rate the other.
r.post('/deals/:id(\\d+)/rating', requireAuth(), (req, res) => {
  const { stars, comment } = req.body || {};
  const n = Number(stars);
  if (!Number.isInteger(n) || n < 1 || n > 5) return res.status(400).json({ error: 'bad_stars' });
  const deal = db.prepare('SELECT * FROM deals WHERE id=?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'not_found' });
  if (deal.buyer_id !== req.user.id && deal.seller_id !== req.user.id)
    return res.status(403).json({ error: 'forbidden' });
  if (deal.status !== 'seller_confirmed') return res.status(409).json({ error: 'not_confirmed' });

  const reviewedId = req.user.id === deal.buyer_id ? deal.seller_id : deal.buyer_id;

  const dup = db.prepare('SELECT id FROM ratings WHERE deal_id=? AND reviewer_id=?').get(deal.id, req.user.id);
  if (dup) return res.status(409).json({ error: 'already_rated' });

  db.prepare(
    `INSERT INTO ratings(deal_id, reviewer_id, reviewed_user_id, stars, comment, created_at)
     VALUES(?,?,?,?,?,?)`,
  ).run(deal.id, req.user.id, reviewedId, n, comment ? String(comment).slice(0, 500) : null, now());

  // recompute the reviewed user's aggregate
  const agg = db
    .prepare('SELECT AVG(stars) AS avg, COUNT(*) AS n FROM ratings WHERE reviewed_user_id=?')
    .get(reviewedId);
  db.prepare('UPDATE users SET rating_avg=?, rating_count=? WHERE id=?').run(
    agg.avg || 0, agg.n || 0, reviewedId,
  );

  notify(reviewedId, 'rating.received', { deal_id: deal.id, stars: n });
  res.json({ ok: true, rating_avg: agg.avg, rating_count: agg.n });
});

// Get ratings for a user (public).
r.get('/users/:id(\\d+)/ratings', requireAuth(), (req, res) => {
  const rows = db.prepare(
    `SELECT r.id, r.stars, r.comment, r.created_at, r.reviewer_id,
            u.display_name AS reviewer_name, u.profile_image_path AS reviewer_image
     FROM ratings r JOIN users u ON u.id = r.reviewer_id
     WHERE r.reviewed_user_id=? ORDER BY r.created_at DESC LIMIT 50`,
  ).all(req.params.id);
  res.json(rows);
});

export default r;
