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
  const commentTrimmed = comment ? String(comment).slice(0, 500) : null;

  // Wrap the duplicate-check, INSERT, and aggregate-UPDATE in one
  // transaction. Without this, two concurrent submissions on DIFFERENT
  // deals (same reviewed_user_id) could both compute `agg` before either
  // INSERT is visible to the other — racing rating_count to N-1 instead
  // of N. The dup check stays here so the 409 path doesn't open a tx.
  const dup = db.prepare('SELECT id FROM ratings WHERE deal_id=? AND reviewer_id=?').get(deal.id, req.user.id);
  if (dup) return res.status(409).json({ error: 'already_rated' });

  let agg;
  try {
    db.transaction(() => {
      db.prepare(
        `INSERT INTO ratings(deal_id, reviewer_id, reviewed_user_id, stars, comment, created_at)
         VALUES(?,?,?,?,?,?)`,
      ).run(deal.id, req.user.id, reviewedId, n, commentTrimmed, now());
      agg = db
        .prepare('SELECT AVG(stars) AS avg, COUNT(*) AS n FROM ratings WHERE reviewed_user_id=?')
        .get(reviewedId);
      db.prepare('UPDATE users SET rating_avg=?, rating_count=? WHERE id=?').run(
        agg.avg || 0, agg.n || 0, reviewedId,
      );
    })();
  } catch (e) {
    // UNIQUE(deal_id, reviewer_id) constraint failure means a parallel
    // submission won the race after our SELECT. Map to the same 409
    // the dup-check produces so the client sees consistent behaviour.
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'already_rated' });
    throw e;
  }

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
