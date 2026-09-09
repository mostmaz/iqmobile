// The one condition taxonomy, for selling, buying, importing and rendering.
//
// It lived as a literal array in eleven files — listings, saved searches,
// phone requests, shop admin (twice), the store importer, price guidance and
// three web renderers — and the mobile app kept two more. That duplication
// already caused the bug `mobile/src/lib/conditions.ts` documents: the sell
// form offered four conditions and the buyer filter offered three, so a مصلح
// device could be posted and never found.
//
// TWO lists, and the difference is the point:
//
//   SELLABLE     what a seller may choose today.
//   CONDITIONS   every value the database may legitimately contain.
//
// `refurbished` is in the second and not the first. The owner removed «مجدد»
// from the sell form, and dropping it from validation too would have made the
// listings that already carry it unfilterable — the same failure, by the same
// route, one release later. A value leaves SELLABLE the day it stops being
// offered; it leaves CONDITIONS only when no row uses it.

/** Offered in the sell form, in the order they are shown. */
export const SELLABLE = ['new', 'like_new', 'used', 'repaired'];

/** Everything valid. Retired values keep their place so old rows stay findable. */
export const CONDITIONS = ['new', 'like_new', 'used', 'repaired', 'refurbished'];

export const CONDITION_AR = {
  new: 'جديد',
  like_new: 'كالجديد',
  used: 'مستعمل',
  repaired: 'مصلّح',
  refurbished: 'مجدّد',
};

export function isCondition(c) {
  return CONDITIONS.includes(String(c));
}

/** Falls back rather than throwing — importers feed this untrusted rows. */
export function toCondition(c, fallback = 'new') {
  return isCondition(c) ? String(c) : fallback;
}
