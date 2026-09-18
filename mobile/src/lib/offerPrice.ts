// The seller's price box: what it shows while they type, and whether the
// number is real.
//
// Mirrors server/src/offerValidation.js deliberately. The server is the
// authority — the app is the thing a seller can be running an old copy of —
// but a rejection that arrives as a round-trip error after they tapped
// «أرسل العرض» teaches nothing, and the failure this guards against is a
// typo the seller would fix instantly if they could see it.
//
// 16 of this marketplace's first 43 offers were under 20,000 IQD: prices
// typed the way they are spoken, «مائتين» as 200, reaching the buyer as 200
// dinars.
//
// Dependency-free so `node --test` can import it directly.

/** Below this, a price is a typo rather than an offer. */
export const MIN_OFFER_IQD = 20000;

/**
 * Digits only, grouped in threes.
 *
 * Western digits on purpose, matching fmtIQD and every other price in the
 * app: the numerals a price is READ in here are Western even where the prose
 * around them is Arabic. Arabic-Indic input is folded to them rather than
 * rejected, because a phone keyboard set to Arabic produces «٢٠٠٠٠٠» and the
 * seller should not have to notice.
 */
export function formatOfferPrice(raw: string): string {
  const digits = String(raw ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '');
  if (!digits) return '';
  return Number(digits).toLocaleString('en-US');
}

/** The number behind whatever the box currently shows. */
export function parseOfferPrice(text: string): number {
  const digits = String(text ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/\D/g, '');
  return digits ? Number(digits) : NaN;
}

export type OfferCheck =
  | { ok: true }
  | { ok: false; code: 'bad_price' | 'price_too_low'; title: string; message: string }
  | { ok: false; code: 'above_cap'; title: string; message: string; confirmable: true };

/**
 * @param price     what the box holds, already parsed
 * @param maxPrice  the buyer's stated ceiling, when the screen knows it
 *
 * The absurd-multiple rule is NOT mirrored here: it needs the median live
 * price for the device, which this screen has no reason to fetch. The server
 * enforces it and its message is shown as-is, which is the right trade for a
 * rule that fires on a handful of offers.
 */
export function checkOfferPrice(price: number, maxPrice?: number | null): OfferCheck {
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, code: 'bad_price', title: 'اكتب سعرك', message: 'السعر مطلوب لإرسال العرض.' };
  }
  if (price < MIN_OFFER_IQD) {
    return {
      ok: false,
      code: 'price_too_low',
      title: 'تحقق من السعر',
      message: 'السعر يبدو ناقصاً — اكتب السعر الكامل بالدينار.',
    };
  }
  const cap = Number(maxPrice);
  if (Number.isFinite(cap) && cap > 0 && price > cap) {
    return {
      ok: false,
      code: 'above_cap',
      confirmable: true,
      title: 'أعلى من سقف المشتري',
      message: `سعرك أعلى من سقف المشتري (${cap.toLocaleString('en-US')} د.ع). تريد إرساله؟`,
    };
  }
  return { ok: true };
}
