// Conservative matching: never mix model variants or conditions to fill a sample.
export function askingPriceGuidance(db, filters, sellerId, now = Date.now(), neverExpire = true) {
  const fields = ['brand', 'model', 'storage', 'condition', 'governorate'];
  if (fields.some(key => typeof filters[key] !== 'string' || !filters[key].trim() || filters[key].length > 120))
    return null;
  if (!['new', 'used', 'repaired', 'refurbished'].includes(filters.condition)) return null;
  const normalize = value => value.trim().toLowerCase().replace(/\s+/g, '');
  const capacity = value => normalize(value).replace(/^1024gb$/, '1tb');
  const rows = db.prepare(`
    SELECT l.model, l.storage, l.asking_price
    FROM phone_listings l JOIN users u ON u.id=l.seller_id
    WHERE lower(trim(l.brand))=lower(trim(?)) AND l.condition=? AND l.governorate=?
      AND l.status='active' AND l.created_at>=? AND l.created_at<=?
      AND (? OR l.expires_at>?) AND l.seller_id!=?
      AND COALESCE(u.shop_hidden,0)=0 AND COALESCE(l.stock_qty,1)>0
      AND COALESCE(l.price_on_request,0)=0 AND l.asking_price>=100000
  `).all(filters.brand, filters.condition, filters.governorate, now - 30*86400000,
    now, neverExpire ? 1 : 0, now, sellerId);
  const prices = rows.filter(row => normalize(row.model) === normalize(filters.model) &&
    capacity(row.storage || '') === capacity(filters.storage))
    .map(row => row.asking_price).filter(Number.isFinite).sort((a,b)=>a-b);
  const count = prices.length;
  const enough = count >= 3;
  return {
    basis: 'asking_prices', window_days: 30, location_scope: 'governorate',
    count, minimum_sample: 3,
    median: enough ? (prices[Math.floor((count-1)/2)] + prices[Math.floor(count/2)]) / 2 : null,
    low: enough ? prices[0] : null, high: enough ? prices[count-1] : null,
  };
}
