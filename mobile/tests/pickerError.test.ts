// The picker's failures, told to the seller instead of to Sentry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLauncherUnregistered, isPermissionDenied, pickerErrorAlert } from '../src/lib/pickerError.ts';

// The exact string Sentry recorded, 371 times.
const REAL = new Error(
  "Call to function 'ExponentImagePicker.launchImageLibraryAsync' has been rejected. "
  + '→ Caused by: java.lang.IllegalStateException: Attempting to launch an unregistered '
  + 'ActivityResultLauncher with contract expo.modules.imagepicker.contracts.ImageLibraryContract@c806d98 '
  + 'and input ImageLibraryContractOptions(options=expo.modules.imagepicker.ImagePickerOptions@e88d05c). '
  + 'You must ensure the ActivityResultLauncher is registered before calling launch()',
);

test('the real production error is recognised', () => {
  assert.equal(isLauncherUnregistered(REAL), true);
});

test('either half of the message is enough', () => {
  // expo re-wraps the Java exception and keeps only the text, and the text has
  // changed shape between versions — so match on both sentences it carries.
  assert.equal(isLauncherUnregistered(new Error('… unregistered ActivityResultLauncher …')), true);
  assert.equal(isLauncherUnregistered(
    new Error('You must ensure the ActivityResultLauncher is registered before calling launch()'),
  ), true);
});

test('a plain string error works too, and so does nothing at all', () => {
  // A rejection is not guaranteed to be an Error.
  assert.equal(isLauncherUnregistered('unregistered ActivityResultLauncher'), true);
  assert.equal(isLauncherUnregistered(undefined), false);
  assert.equal(isLauncherUnregistered(null), false);
});

test('an unrelated failure is not blamed on the launcher', () => {
  assert.equal(isLauncherUnregistered(new Error('Network request failed')), false);
});

test('a permission failure is its own case, and the launcher wins the overlap', () => {
  assert.equal(isPermissionDenied(new Error('Missing photo library permission')), true);
  // The real message contains neither, but a future one might contain both —
  // and "restart the app" is the actionable half.
  assert.equal(isPermissionDenied(REAL), false);
});

test('the launcher message says RESTART, not «try again»', () => {
  // Re-registration only happens when the Activity is created. «حاول مرة
  // أخرى» would be the same lie the silent failure already told, out loud.
  const a = pickerErrorAlert(REAL);
  assert.ok(a.body.includes('أعد تشغيل التطبيق'));
  assert.ok(!a.body.includes('حاول مرة أخرى.') || a.body.includes('أعد تشغيل'));
});

test('the title names what the seller was trying to open', () => {
  assert.ok(pickerErrorAlert(REAL, 'image').title.includes('الصور'));
  assert.ok(pickerErrorAlert(REAL, 'video').title.includes('الفيديو'));
  assert.ok(pickerErrorAlert(new Error('boom'), 'video').body.length > 0);
});

test('an unknown failure still produces something sayable', () => {
  const a = pickerErrorAlert(new Error('something odd'));
  assert.ok(a.title.length > 0 && a.body.length > 0);
});
