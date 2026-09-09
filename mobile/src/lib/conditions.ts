// The one condition taxonomy, shared by selling and by buying.
//
// The sell form offered four conditions and the buyer filter offered three,
// so a device listed as مصلح (repaired) could be posted but never found —
// it was invisible to every filtered search on the marketplace. Two lists
// in two files is how that happens; there is now one, mirroring
// `server/src/conditions.js`.
//
// TWO exports, and the difference is the point:
//
//   SELLABLE_CONDITIONS  what a seller may choose today.
//   CONDITIONS           every value a listing may already carry.
//
// «مجدد» was removed from the sell form and is in the second list only.
// Dropping it from the filter as well would have made the listings that
// already carry it unfindable — the identical bug, one release later. A
// value leaves the sell form the day it stops being offered; it leaves the
// filter only when no listing uses it.

import type { Condition } from '../api/endpoints';

/** Offered in the sell form, in the order shown. «كالجديد» sits after «جديد». */
export const SELLABLE_CONDITIONS: Condition[] = ['new', 'like_new', 'used', 'repaired'];

/** Offered in buyer filters — everything a listing may be. */
export const CONDITIONS: Condition[] = ['new', 'like_new', 'used', 'repaired', 'refurbished'];
