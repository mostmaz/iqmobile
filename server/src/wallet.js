// The seller wallet: balance in IQD, held as a signed ledger.
//
// There is no balance column. balanceOf() sums the ledger, which for the
// handful of entries a seller accumulates is cheap and, more importantly,
// cannot drift from the rows that explain it.
import { db, now } from './db.js';

export function balanceOf(userId) {
  return db.prepare(
    'SELECT COALESCE(SUM(delta), 0) AS b FROM wallet_entries WHERE user_id=?',
  ).get(userId).b;
}

export function entriesFor(userId, limit = 50) {
  return db.prepare(
    `SELECT id, delta, reason, ref_type, ref_id, note, created_at
       FROM wallet_entries WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).all(userId, limit);
}

// Post one entry. Returns false when the unique (ref_type, ref_id, reason)
// index rejects it — i.e. this exact credit/debit already happened — so
// callers can be re-run safely instead of guarding at every call site.
export function post({ userId, delta, reason, refType = null, refId = null, note = null, actor = 'system' }) {
  try {
    db.prepare(
      `INSERT INTO wallet_entries(user_id, delta, reason, ref_type, ref_id, note, actor, created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
    ).run(userId, delta, reason, refType, refId, note, actor, now());
    return true;
  } catch (e) {
    if (String(e?.code) === 'SQLITE_CONSTRAINT_UNIQUE') return false;
    throw e;
  }
}

// Debit, refusing to go negative. Caller must already be inside a
// transaction when the debit has to be atomic with what it pays for.
export function spend({ userId, amount, reason, refType, refId, note }) {
  if (!(amount > 0)) throw new Error('bad_amount');
  if (balanceOf(userId) < amount) return false;
  return post({ userId, delta: -amount, reason, refType, refId, note });
}
