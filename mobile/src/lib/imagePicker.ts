// One way into expo-image-picker, because nine ways meant nine unguarded
// promises.
//
// Every call site had the same shape — check permission, launch, check
// `canceled` — and none of them caught a REJECTION. So when the picker failed
// (see lib/pickerError.ts for the failure that matters), the promise went
// unhandled: Sentry logged it 371 times across 10 users, and the seller saw
// the button do nothing at all.
//
// This wrapper turns that into an Alert they can act on, and returns null so
// the caller's existing early-return keeps working:
//
//     const r = await launchLibrary({ ... });
//     if (!r || r.canceled) return;

import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { pickerErrorAlert } from './pickerError';

/**
 * Only one picker can be open at a time — Android will not show two — so a
 * module-level flag is the honest scope for this, not a per-screen ref.
 *
 * It exists because of how the events arrived: five inside 0.35 seconds, from
 * one person. A dead launcher rejects INSTANTLY and changes nothing on
 * screen, so people tap again, and each tap was another unhandled rejection.
 * The alert below fixes the confusion; this stops the pile-up in the gap
 * before it appears, and on the slow path where the real picker takes a
 * moment to open.
 */
let inFlight = false;

export type LaunchKind = 'image' | 'video';

/**
 * Open the photo/video library.
 *
 * @returns the picker result, or `null` if it could not open — in which case
 *   the seller has already been told why. Callers still handle `canceled`
 *   themselves: choosing nothing is not a failure and must not raise an alert.
 */
export async function launchLibrary(
  options: ImagePicker.ImagePickerOptions,
  kind: LaunchKind = 'image',
): Promise<ImagePicker.ImagePickerResult | null> {
  if (inFlight) return null;
  inFlight = true;
  try {
    return await ImagePicker.launchImageLibraryAsync(options);
  } catch (err) {
    const { title, body } = pickerErrorAlert(err, kind);
    Alert.alert(title, body);
    return null;
  } finally {
    inFlight = false;
  }
}

/**
 * Ask for library permission.
 *
 * Wrapped for the same reason: on a recreated Activity the PERMISSION request
 * uses a launcher too, so it can reject exactly the same way — and a throw
 * here skipped the launch entirely, which looked identical to the user.
 * Returns false rather than throwing; the caller shows its own copy for a
 * plain denial, which is a choice and not a fault.
 */
export async function ensureLibraryPermission(kind: LaunchKind = 'image'): Promise<boolean> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return !!perm.granted;
  } catch (err) {
    const { title, body } = pickerErrorAlert(err, kind);
    Alert.alert(title, body);
    return false;
  }
}
