// Put a listing in front of a human, from the word gate rather than the AI.
//
// listingInspect.js reaches the same queue by reading the photos with a
// model; this is the free, instant, deterministic half. They share one
// table on purpose — an operator should have a single queue to work, not
// two that disagree about which listings are outstanding.
//
// Rows are only ever written for damage the SELLER disclosed, so the
// evidence is always a phrase from their own description. That matters at
// review time: the operator is judging whether a disclosed fault is
// acceptable, not whether a machine guessed right.
import { db, now } from './db.js';

/**
 * Queue `listingId` for review, or refresh an entry that was already
 * decided.
 *
 * An untouched pending row is left alone — re-flagging on every edit would
 * push the listing back to the top of the queue and let a seller churn it
 * out of an operator's view. A row that was already approved or removed IS
 * replaced, because a description that has changed since that decision is
 * new information.
 *
 * Never throws: a flag that fails must not cost a seller their listing.
 */
export function flagListingForReview(listingId, defectList) {
  try {
    const existing = db.prepare('SELECT id, status FROM listing_inspections WHERE listing_id=?')
      .get(listingId);
    if (existing && existing.status === 'pending') return;

    const defects = JSON.stringify(
      (Array.isArray(defectList) ? defectList : [defectList]).map((d) => ({
        kind: d.kind,
        source: 'description',
        evidence: d.evidence || `الوصف يذكر: «${d.term}»`,
      })),
    );
    const t = now();
    if (existing) {
      db.prepare(
        `UPDATE listing_inspections
            SET verdict='suspect', confidence='medium', defects_json=?,
                status='pending', reviewed_at=NULL, error=NULL, created_at=?
          WHERE id=?`,
      ).run(defects, t, existing.id);
    } else {
      db.prepare(
        `INSERT INTO listing_inspections
           (listing_id, verdict, confidence, defects_json, status, created_at)
         VALUES (?, 'suspect', 'medium', ?, 'pending', ?)`,
      ).run(listingId, defects, t);
    }
  } catch { /* the queue is a convenience, never a gate on publishing */ }
}
