// The one condition taxonomy, shared by selling and by buying.
//
// The sell form offered four conditions and the buyer filter offered three,
// so a device listed as مصلح (repaired) could be posted but never found —
// it was invisible to every filtered search on the marketplace. Two lists
// in two files is how that happens; there is now one.

import type { Condition } from '../api/endpoints';

export const CONDITIONS: Condition[] = ['new', 'used', 'refurbished', 'repaired'];
