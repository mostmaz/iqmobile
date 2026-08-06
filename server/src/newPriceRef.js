// "New costs this much" reference for a second-hand listing.
//
// Shown under the asking price on any listing that isn't new, when the
// aggregator price shop stocks the SAME device at the SAME capacity. Storage
// is part of the key, not a detail: the shop prices each capacity separately
// (iPhone 17 Pro Max — 1TB 2,550,000 / 512GB 2,245,000 / 256GB 1,960,000), so
// matching on model alone would quote a number that is simply wrong.
//
// Matching is the whole problem. The shop's rows are machine-generated and
// clean ("Apple | iPhone 17 Pro Max | 256GB"); seller-typed models are free
// text, usually Arabic, usually noisy:
//
//   Apple  | ايفون 11 للبيع            | 64GB
//   Realme | ريلمي نوت 50 ذاكره 128    | 128GB
//
// A direct comparison matches 5.7% of used listings. So both sides go through
// the same pipeline the smart search already uses — Arabic transliterated to
// the Latin catalogue (ايفون → iphone), digits folded, seller noise dropped —
// and are compared space-free.
//
// It stays deliberately strict. A missing reference is invisible; a WRONG one
// tells a buyer a used phone is a bargain against a price that was never for
// this device. Every ambiguity resolves to showing nothing.

import { db } from './db.js';
import { expandQuery } from './searchNormalize.js';

// The hidden aggregator shop. Looked up by flag rather than hardcoded id so
// the reference follows whichever shop is acting as the price book.
function priceShopIds() {
  return db.prepare(
    "SELECT id FROM users WHERE seller_type='shop' AND COALESCE(shop_hidden,0)=1",
  ).all().map((r) => r.id);
}

// Words sellers add that carry no model information. Stripped from both sides
// so "ايفون 11 للبيع" and "iPhone 11" converge.
const NOISE = [
  'للبيع', 'مستعمل', 'نظيف', 'بحالة', 'بحاله', 'ممتاز', 'ممتازه', 'ممتازة',
  'ذاكره', 'ذاكرة', 'رام', 'جديد', 'جديده', 'جديدة', 'وارد', 'اصلي', 'أصلي',
  'كفاله', 'كفالة', 'بسعر', 'سعر', 'موبايل', 'جهاز', 'هاتف',
  'used', 'new', 'sale', 'clean', 'original',
];

/**
 * Canonical comparison key for a model string: transliterate Arabic to the
 * Latin catalogue, drop noise words and any embedded capacity, then remove
 * all separators. "ريلمي نوت 50 ذاكره 128" and "Realme Note 50" both land on
 * "realmenote50".
 */
export function modelKey(brand, model) {
  const cands = expandQuery(String(model || ''));
  let s = (cands.length ? cands[cands.length - 1] : String(model || '')).toLowerCase();

  // Capacity written into the model line, in the two forms sellers use:
  // a number carrying a unit ("128gb"), and a number introduced by a memory
  // word ("ذاكره 128", "رام 8").
  //
  // Nothing beyond those two patterns is treated as capacity. An earlier
  // version stripped any 16/32/64/128/256/512, which silently deleted the
  // model number from "iPhone 16 Pro Max" and made it indistinguishable from
  // other Pro Max models — precisely the wrong-price failure this whole
  // module exists to avoid.
  s = s.replace(/\d+\s*(gb|tb|جيجا|تيرا)\b/g, ' ');
  // No \b around the Arabic alternatives: JavaScript word boundaries are
  // ASCII-only and never fire beside an Arabic letter, so \bذاكره silently
  // matched nothing and the capacity survived into the key.
  s = s.replace(/(ذاكره|ذاكرة|جيجا|تيرا)\s*\d+/g, ' ');
  s = s.replace(/\b(ram|memory|رام)\s*\d+/g, ' ');

  for (const w of NOISE) s = s.split(w).join(' ');
  let key = s.replace(/[^a-z0-9؀-ۿ]+/g, '');

  // Prefix the brand, but only when the model doesn't already carry it —
  // sellers write "Samsung Galaxy S24" while the catalogue says "Galaxy S24",
  // and blindly prefixing would leave those two as different keys.
  const b = (expandQuery(String(brand || '')).pop() || '')
    .toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '');
  if (b && !key.startsWith(b)) key = b + key;
  return key;
}

/** Normalise a capacity so "128 GB" and "128gb" compare equal. */
export function storageKey(storage) {
  const s = String(storage || '').toLowerCase().replace(/\s+/g, '');
  if (!s) return '';
  // Treat 1024GB and 1TB as the same capacity.
  if (s === '1024gb') return '1tb';
  return s;
}

/**
 * Look up what this device costs new. Returns null unless there is a
 * confident, same-capacity match — see the note above on why.
 *
 * @param {{id:number, brand:string, model:string, storage:string, condition:string, asking_price:number, seller_id:number}} listing
 */
export function newPriceFor(listing) {
  if (!listing) return null;
  // Only second-hand listings get the comparison. A new listing compared
  // against new is noise, and the price shop must not annotate itself.
  if (!listing.condition || listing.condition === 'new') return null;
  // No capacity on the used listing means no safe comparison: quoting the
  // 256GB price under a 128GB phone is worse than showing nothing.
  const wantStorage = storageKey(listing.storage);
  if (!wantStorage) return null;

  const shops = priceShopIds();
  if (!shops.length || shops.includes(listing.seller_id)) return null;

  const ph = shops.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, brand, model, storage, asking_price FROM phone_listings
      WHERE seller_id IN (${ph}) AND condition='new' AND status IN ('active','reserved')
        AND brand = ?`,
  ).all(...shops, listing.brand);
  if (!rows.length) return null;

  const wantModel = modelKey(listing.brand, listing.model);
  if (!wantModel) return null;

  const hit = rows.find(
    (r) => storageKey(r.storage) === wantStorage && modelKey(r.brand, r.model) === wantModel,
  );
  if (!hit) return null;

  const newPrice = Number(hit.asking_price) || 0;
  const used = Number(listing.asking_price) || 0;
  if (!newPrice) return null;

  // A used listing priced at or above new is a real thing (rare models,
  // optimistic sellers). Report the reference but omit the saving rather than
  // rendering a negative "discount".
  const saving = newPrice - used;
  return {
    new_price: newPrice,
    storage: hit.storage,
    listing_id: hit.id,
    shop_id: shops[0],
    saving: saving > 0 ? saving : null,
    saving_pct: saving > 0 ? Math.round((saving / newPrice) * 100) : null,
  };
}
