// Turning an approved request into a featured listing.
//
// Two paths reach here — an admin approving a transfer, and a seller paying
// from their wallet, which needs no review — and they must agree on what
// "featured" means, so the write lives in one place.
import { db, now } from './db.js';
import { tierFor, tierTiming } from './featureTiers.js';

export function applyFeature(fr) {
  // Snapshot fields are on the request; fall back to the live tier only for
  // what the row does not carry.
  const tier = tierFor(fr.tier) || { days: fr.days, boosts_per_day: fr.boosts_per_day };
  const { durationMs, boostIntervalMs } = tierTiming(tier);
  const t = now();

  const listing = db.prepare('SELECT featured_until FROM phone_listings WHERE id=?').get(fr.listing_id);
  if (!listing) return null;

  // Extend, never truncate, any featured time the listing still has left.
  const base = listing.featured_until && listing.featured_until > t ? listing.featured_until : t;
  const featured_until = base + durationMs;

  db.prepare(
    `UPDATE phone_listings
     SET featured_until=?, feature_tier=?, boosted_at=?, next_boost_at=?, boost_interval_ms=?
     WHERE id=?`,
  ).run(featured_until, fr.tier, t, t + boostIntervalMs, boostIntervalMs, fr.listing_id);

  return { featured_until, at: t };
}
