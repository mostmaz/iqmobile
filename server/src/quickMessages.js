// The quick-reply chips under the chat composer.
//
// Measured on production, 1 Oct 2026: of 892 threads whose first message
// was the first chip, 368 sent it within three seconds of the thread being
// opened — the chip row renders where the thumb already is after tapping
// «مراسلة» on the listing page. The app now holds the row inert for the
// first moment; server-side, a chip is treated as the question it reads as.
export const QUICK_MESSAGES = [
  'هل المنتج متوفر؟',
  'ما هو سعرك النهائي؟',
  'هل يمكنني فحص الجهاز؟',
  'أين الموقع؟',
];
