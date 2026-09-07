// Which photo to take next.
//
// `ar.post.front / back2 / side / box` have existed in the dictionary since
// the wizard was written and are referenced NOWHERE — an abandoned slot
// design. The grid shipped as ten identical 100×100 squares, so "3 photos"
// was a number to satisfy rather than a shot list, and the commonest bad
// listing is three near-identical photos of the same front face.
//
// Slots SUGGEST. They never gate. A seller with four photos of the back
// still publishes, because the alternative — refusing a listing over which
// angle a photo shows — is both unenforceable (we cannot tell) and hostile.
// What the labels buy is a seller who knows what is missing.

export interface PhotoSlot { id: string; label: string; hint: string }

export const PHOTO_SLOTS: PhotoSlot[] = [
  { id: 'front', label: 'أمامية', hint: 'الشاشة كاملة ومضاءة' },
  { id: 'back2', label: 'خلفية', hint: 'الظهر والكاميرا' },
  { id: 'side', label: 'جانبية', hint: 'الحواف والأزرار' },
  { id: 'box', label: 'علبة / ملحقات', hint: 'العلبة والشاحن إن وجدت' },
];

/** The suggested slot for the nth photo, or null once past the shot list. */
export function slotAt(index: number): PhotoSlot | null {
  return PHOTO_SLOTS[index] ?? null;
}

/**
 * What to ask for next.
 *
 * Position-based rather than a real assignment, because we cannot verify what
 * a photo actually shows and pretending otherwise would put a confident wrong
 * label under the picture. The honest framing is "photo three is usually the
 * side" — a prompt, not a claim.
 */
export function nextSlot(count: number): PhotoSlot | null {
  return slotAt(count);
}

/** The slot id stored alongside the nth upload; null past the shot list. */
export function slotIdAt(index: number): string | null {
  return PHOTO_SLOTS[index]?.id ?? null;
}
