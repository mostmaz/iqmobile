// ضمان iQ Mobile — the escrow-style guarantee service for USED listings.
//
// One module owns the whole vocabulary: the fee tiers, the status machine,
// and the eligibility check. Both the public listing endpoint (which quotes
// the fee under the price) and the order-creation endpoint (which charges
// it) import from here, so the two can never disagree — the client's numbers
// are display-only and the server always recomputes.

import { db } from './db.js';

// Pipeline stages, in the order a healthy order walks them. Every stage is
// one real-world operator action (a phone call, a pickup, an inspection),
// and each forward transition fires its own buyer notification.
export const GUARANTEE_STATUSES = [
  'new', // buyer tapped the button; nobody called anyone yet
  'buyer_confirmed', // we called the buyer, they mean it
  'seller_confirmed', // we called the seller, agreed to buy the device
  'picked_up', // device is physically with us
  'inspected', // report written + deposit amount set, buyer notified
  'front_paid', // buyer paid the deposit (العربون)
  'shipped', // on its way to the buyer
  'delivered', // done — terminal
  'cancelled', // terminal, reachable from every non-terminal stage
];

export const GUARANTEE_NEXT = {
  new: ['buyer_confirmed', 'cancelled'],
  buyer_confirmed: ['seller_confirmed', 'cancelled'],
  seller_confirmed: ['picked_up', 'cancelled'],
  picked_up: ['inspected', 'cancelled'],
  inspected: ['front_paid', 'cancelled'],
  front_paid: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

// Service fee tiers on the ASKING price. The buyer pays price + fee; the
// percentages are the published rate card, so change them here only in
// lockstep with the marketing material.
export function feePctFor(price) {
  if (price <= 500_000) return 10;
  if (price <= 900_000) return 7;
  return 5;
}

// Rounded to the nearest 1,000 IQD — nobody quotes 38,850 over the phone —
// with a 1,000 floor so a token-priced listing still carries a real fee.
export function feeFor(price) {
  return Math.max(1000, Math.round((price * feePctFor(price)) / 100 / 1000) * 1000);
}

// Which sellers are NOT part of the service: the orderable storefront (it
// sells new stock with its own buy button) and the hidden price-book
// aggregator (its rows are references, not devices anyone can hand us).
// Cached briefly — this runs on every listing detail view.
let _excluded = null;
let _excludedAt = 0;
function excludedSellerIds() {
  const t = Date.now();
  if (!_excluded || t - _excludedAt > 30_000) {
    _excluded = new Set(
      db.prepare(
        `SELECT id FROM users
          WHERE seller_type='shop'
            AND (COALESCE(shop_orders_enabled,0)=1 OR COALESCE(shop_no_contact,0)=1
                 OR COALESCE(shop_hidden,0)=1)`,
      ).all().map((r) => r.id),
    );
    _excludedAt = t;
  }
  return _excluded;
}

/**
 * The guarantee quote for a listing, or null when the service does not
 * apply. Null is meaningful — the app hides the button entirely — so every
 * ambiguity resolves to null, mirroring newPriceRef's philosophy.
 *
 * @param {{seller_id:number, condition:string, status:string, asking_price:number,
 *          price_on_request?:number, iq_guarantee_optin?:number}} listing
 */
export function quoteFor(listing) {
  if (!listing) return null;
  if (listing.condition === 'new') return null; // the service is for USED devices
  if (listing.status !== 'active') return null;
  // A hidden price is a placeholder — a fee on top of a fake number would
  // quote the buyer nonsense.
  if (Number(listing.price_on_request || 0) === 1) return null;
  if (excludedSellerIds().has(listing.seller_id)) return null;

  const price = Number(listing.asking_price) || 0;
  if (price <= 0) return null;

  const fee = feeFor(price);
  return {
    pct: feePctFor(price),
    fee,
    total: price + fee,
    seller_opted_in: Number(listing.iq_guarantee_optin || 0) === 1,
  };
}
