// Best-effort analytics event logger for the Contact & Demand dashboard.
//
// Every writer here is fire-and-forget: analytics must NEVER break or slow a
// user-facing request, so a failed insert is swallowed with a warning. Called
// synchronously (better-sqlite3 is sync + WAL, so a single INSERT is
// sub-millisecond at this scale) but wrapped so a schema hiccup can't 500 a
// listing view.

import { db, now } from './db.js';

const insEvent = db.prepare(
  `INSERT OR IGNORE INTO events(type, listing_id, user_id, brand, governorate, query, result_count, shop_id, banner_id, created_at, search_request_id)
   VALUES(@type, @listing_id, @user_id, @brand, @governorate, @query, @result_count, @shop_id, @banner_id, @created_at, @search_request_id)`,
);

export function logEvent(e) {
  try {
    insEvent.run({
      type: e.type,
      search_request_id: e.search_request_id ?? null,
      listing_id: e.listing_id ?? null,
      user_id: e.user_id ?? null,
      brand: e.brand ?? null,
      governorate: e.governorate ?? null,
      query: e.query ?? null,
      result_count: e.result_count ?? null,
      shop_id: e.shop_id ?? null,
      banner_id: e.banner_id ?? null,
      created_at: e.created_at ?? now(),
    });
  } catch (err) {
    console.warn('[events] log failed:', err?.message);
  }
}
