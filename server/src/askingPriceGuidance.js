// What comparable devices are being ASKED for, to price against.
//
// Model and storage still have to match exactly — an S25 is not an S25 Ultra
// and 128GB is not 512GB, and blurring those would make the median
// meaningless. CONDITION deliberately does not: pooling new, like-new, used,
// repaired and refurbished is a decision to trade precision for a sample that exists
// at all. The strict version returned nothing for most sellers, and no
// guidance helps nobody, while a wide median at least anchors the decision.
//
// The cost is real and must stay visible in the copy: a brand-new phone is
// being compared against repaired ones. AskingPriceGuidance.tsx says so in
// as many words — if this filter ever changes back, that sentence changes
// with it.
// 90 days, not 30. Thirty was too short to reach the 3-listing floor for
// anything but the most common phones, so most sellers saw no guidance at all.
import { isCondition } from './conditions.js';

const WINDOW_DAYS = 90;

export function askingPriceGuidance(db, filters, sellerId, now = Date.now(), neverExpire = true) {
  // `condition` is still required from the caller (the route validates it and
  // the seller has already chosen it) — it just no longer narrows the sample.
  const fields = ['brand', 'model', 'storage', 'condition', 'governorate'];
  if (fields.some(key => typeof filters[key] !== 'string' || !filters[key].trim() || filters[key].length > 120))
    return null;
  if (!isCondition(filters.condition)) return null;
  const normalize = value => value.trim().toLowerCase().replace(/\s+/g, '');
  const capacity = value => normalize(value).replace(/^1024gb$/, '1tb');
  const rows = db.prepare(`
    SELECT l.model, l.storage, l.asking_price
    FROM phone_listings l JOIN users u ON u.id=l.seller_id
    WHERE lower(trim(l.brand))=lower(trim(?)) AND l.governorate=?
      AND l.status='active' AND l.created_at>=? AND l.created_at<=?
      AND (? OR l.expires_at>?) AND l.seller_id!=?
      AND COALESCE(u.shop_hidden,0)=0 AND COALESCE(l.stock_qty,1)>0
      AND COALESCE(l.price_on_request,0)=0 AND l.asking_price>=100000
  `).all(filters.brand, filters.governorate, now - WINDOW_DAYS*86400000,
    now, neverExpire ? 1 : 0, now, sellerId);
  const prices = rows.filter(row => normalize(row.model) === normalize(filters.model) &&
    capacity(row.storage || '') === capacity(filters.storage))
    .map(row => row.asking_price).filter(Number.isFinite).sort((a,b)=>a-b);
  const count = prices.length;
  const enough = count >= 3;
  return {
    basis: 'asking_prices', window_days: WINDOW_DAYS, location_scope: 'governorate',
    // The client renders different copy depending on this — it must never
    // claim the sample is condition-matched when it is not.
    conditions_pooled: true,
    count, minimum_sample: 3,
    median: enough ? (prices[Math.floor((count-1)/2)] + prices[Math.floor(count/2)]) / 2 : null,
    low: enough ? prices[0] : null, high: enough ? prices[count-1] : null,
  };
}
