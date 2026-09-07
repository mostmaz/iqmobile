// What a price on a listing actually means.
//
// Three states, and until now the app could only render one of them.
//
//   fixed        — this is the price.
//   negotiable   — there is room, come and talk.
//   on request   — no public price; contact the seller.
//
// `price_on_request` already existed as a SUPPLIER-IMPORT concept, set only
// by storeImport.js, the shop panel and admin. It was never in the mobile
// wizard, was not in the route's EDITABLE list, and — the live bug this
// module exists to kill — neither ListingDetailScreen nor ListingCard had a
// branch for it. Both read the sentinel `asking_price = 1` straight through
// `fmtIQD` and rendered «١ د.ع». A call-for-price phone advertised at one
// dinar. Only the similar-devices rail ever got it right.
//
// `negotiable` is new. It is the single most common thing said in the chat
// thread's first message, and putting it on the card saves both sides the
// exchange.
//
// One vocabulary. The app had three phrasings for the same state — «اتصل
// للسعر» on the compare screen and the home hub, «السعر عند الطلب» on the
// storefront and the similar rail, «اتصل بالمتجر» in the cart — which reads
// as three different rules rather than one.

export type PriceMode = 'fixed' | 'negotiable';

/** The one phrase for "no public price". Do not write a fourth. */
export const ON_REQUEST_LABEL = 'السعر عند الطلب';

/** Shown next to a price the seller is willing to move on. */
export const NEGOTIABLE_LABEL = 'قابل للتفاوض';

export interface PricedLike {
  asking_price?: number | null;
  price_on_request?: number | boolean | null;
  price_mode?: string | null;
}

/**
 * `true` when there is no public price.
 *
 * Accepts a number or a boolean because the column is INTEGER and different
 * paths hand it over as 0/1 or as a real boolean — a plain truthiness check
 * on the raw column is exactly what the three broken call sites were missing.
 */
export function isOnRequest(l: PricedLike | null | undefined): boolean {
  return !!l?.price_on_request;
}

export function isNegotiable(l: PricedLike | null | undefined): boolean {
  return !isOnRequest(l) && l?.price_mode === 'negotiable';
}

/**
 * The price as a buyer should read it, or null when there is no number.
 *
 * Returning null rather than a formatted sentinel is deliberate: a caller
 * that forgets to handle it renders nothing, which is survivable. The old
 * shape let it render «١ د.ع», which is worse than blank because it is
 * confidently wrong.
 */
export function priceText(l: PricedLike | null | undefined, fmt: (n: number) => string): string | null {
  if (isOnRequest(l)) return null;
  const n = Number(l?.asking_price);
  if (!Number.isFinite(n) || n <= 0) return null;
  return fmt(n);
}
