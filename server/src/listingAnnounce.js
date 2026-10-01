// What happens the moment a listing becomes visible: the people who asked
// for it are told, and the operators see it land.
//
// One function because there are now two moments a listing can go live —
// at creation, as always, and after the AI quality check for an app that
// waits for the verdict (listingInspect.js, the ≥ 1.0.0 gate). A listing
// announced while still hidden would send a buyer to a 404.
import { alertOnNewListing } from './routes/savedSearches.js';
import { alertWishlistOnListing } from './routes/wishlist.js';
import { alertRequestsOnListing } from './routes/phoneRequests.js';
import { pushToAdmins } from './adminPush.js';

/** Fire-and-forget. `row` is the full phone_listings row, already active. */
export function announceNewListing(row) {
  if (!row || row.status !== 'active') return;
  // After the response is sent, so notification fan-out never adds latency
  // to (or can fail) the request that published the listing.
  setImmediate(() => {
    try { alertOnNewListing(row); } catch (e) { console.error('[announce] saved-search', e?.message); }
    try { alertWishlistOnListing(row); } catch (e) { console.error('[announce] wishlist', e?.message); }
    try { alertRequestsOnListing(row); } catch (e) { console.error('[announce] requests', e?.message); }
  });
  // Operators watch new listings for junk names, wrong prices and worse.
  setImmediate(() => {
    pushToAdmins(
      'listing.new',
      'إعلان جديد',
      `${row.brand} ${row.model} · ${Number(row.asking_price).toLocaleString('en-US')} د.ع · ${row.governorate}`,
      { listing_id: row.id },
    ).catch(() => {});
  });
}
