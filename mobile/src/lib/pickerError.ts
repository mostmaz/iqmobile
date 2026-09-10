// Why the photo picker refused to open, in words a seller can act on.
//
// Pure and dependency-free so `node --test` can import it directly; the
// RN-touching half lives in lib/imagePicker.ts.
//
// The failure this exists for: expo-image-picker registers its
// ActivityResultLauncher when the Activity is CREATED. Android destroys and
// recreates the Activity behind a backgrounded app — routinely on low-memory
// devices, always with the "don't keep activities" developer option — and the
// JS side survives that while the registration does not. Every later call
// rejects with «Attempting to launch an unregistered ActivityResultLauncher».
//
// Nothing caught it, so the promise rejection went to Sentry (371 events
// across 10 users) and the seller saw the button do NOTHING — which is why
// the events arrive five to a second: with no dialog and no error, people
// tap again. Twice more. Then four more times.

/**
 * The Activity was recreated and the picker's launcher went with it.
 *
 * Matched on the Android exception text rather than an error code because
 * expo re-wraps the Java exception in a JS Error and keeps only the message.
 */
export function isLauncherUnregistered(err: unknown): boolean {
  const m = String((err as any)?.message ?? err ?? '');
  return m.includes('unregistered ActivityResultLauncher')
    || m.includes('ActivityResultLauncher is registered before calling launch');
}

/** The user revoked photo access between the permission check and the launch. */
export function isPermissionDenied(err: unknown): boolean {
  const m = String((err as any)?.message ?? err ?? '');
  return /permission/i.test(m) && !isLauncherUnregistered(err);
}

export type PickerAlert = { title: string; body: string };

/**
 * What to tell the seller.
 *
 * The launcher case says RESTART, because that is the only thing that fixes
 * it — re-registration happens when the Activity is created, and no amount of
 * tapping gets there. Telling them to "try again" would be the same lie the
 * silent failure already told, just out loud.
 *
 * @param kind what the picker was being opened for, so the title matches the
 *   button that was pressed.
 */
export function pickerErrorAlert(err: unknown, kind: 'image' | 'video' = 'image'): PickerAlert {
  const noun = kind === 'video' ? 'الفيديو' : 'الصور';
  if (isLauncherUnregistered(err)) {
    return {
      title: `تعذّر فتح ${noun}`,
      body: 'أعد تشغيل التطبيق ثم حاول مرة أخرى. أغلقه من قائمة التطبيقات المفتوحة وافتحه من جديد.',
    };
  }
  if (isPermissionDenied(err)) {
    return {
      title: `تعذّر فتح ${noun}`,
      body: `فعّل إذن ${noun} من إعدادات الجهاز.`,
    };
  }
  return {
    title: `تعذّر فتح ${noun}`,
    body: 'حاول مرة أخرى.',
  };
}
