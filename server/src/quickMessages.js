// The quick-reply chips under the chat composer, in one place because two
// things need the list: the route that serves it to the app, and the
// WhatsApp reminder, which must recognise a chip tap that was never a
// question.
//
// Measured on production, 1 Oct 2026: of 892 threads whose first message
// was the first chip, 368 sent it within three seconds of the thread being
// opened — faster than the screen can be read. The chip row renders where
// the thumb already is after tapping «مراسلة» on the listing page.
export const QUICK_MESSAGES = [
  'هل المنتج متوفر؟',
  'ما هو سعرك النهائي؟',
  'هل يمكنني فحص الجهاز؟',
  'أين الموقع؟',
];

/** Milliseconds after a thread opens within which a chip tap is a slip. */
export const ACCIDENTAL_TAP_MS = 5000;

export function isQuickMessage(body) {
  return QUICK_MESSAGES.includes(String(body || '').trim());
}
