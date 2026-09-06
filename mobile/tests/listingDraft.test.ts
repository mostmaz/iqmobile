// Draft recovery: the pure decisions, without AsyncStorage or the filesystem.
//
// The two behaviours worth pinning are the ones that were bugs in the code
// this replaces: a brand-only form used to read as clean (so it was thrown
// away), and the idempotency key must survive a restore or a retried publish
// posts the phone twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftIsSubstantial, newClientKey, setWizardDirty, isWizardDirty } from '../src/lib/listingDraftCore.ts';

const blank = {
  step: 0, brand: '', model: '', condition: 'used', storage: '128GB', color: '',
  batteryHealth: '', warranty: 'بدون ضمان', accessories: [] as string[],
  askingPrice: '', govAr: 'بغداد', city: '', description: '', images: [] as string[],
  contactPhone: '', contactWhatsapp: '', waSameAsPhone: false,
  clientKey: 'k', savedAt: 0,
};

test('an untouched form is not worth restoring', () => {
  assert.equal(draftIsSubstantial(blank), false);
  assert.equal(draftIsSubstantial(null), false);
  assert.equal(draftIsSubstantial(undefined), false);
});

test('a brand-only draft counts — the old isDirty missed exactly this', () => {
  // The wizard's isDirty omitted `brand`, so picking a brand and nothing else
  // left a form that reported itself clean: no exit confirm, and under the
  // new draft code it would have been dropped on the floor.
  assert.equal(draftIsSubstantial({ ...blank, brand: 'Apple' }), true);
});

test('defaults alone never count as work', () => {
  // condition/storage/warranty/governorate all start pre-filled. If any of
  // them counted, every seller who opened the tab would be offered a restore.
  assert.equal(draftIsSubstantial({ ...blank, condition: 'used', storage: '128GB', warranty: 'بدون ضمان' }), false);
  assert.equal(draftIsSubstantial({ ...blank, step: 3 }), false);
});

test('any real field makes a draft substantial', () => {
  for (const patch of [
    { model: 'iPhone 13' }, { color: 'أسود' }, { batteryHealth: '89' },
    { askingPrice: '500000' }, { city: 'الكرادة' }, { description: 'نظيف' },
    { contactPhone: '07701234567' }, { contactWhatsapp: '07701234567' },
    { accessories: ['الشاحن'] }, { images: ['file:///a.jpg'] },
  ]) {
    assert.equal(draftIsSubstantial({ ...blank, ...patch }), true, JSON.stringify(patch));
  }
});

test('client keys are unique per call', () => {
  const keys = new Set(Array.from({ length: 200 }, () => newClientKey()));
  assert.equal(keys.size, 200, 'a collision would make one create silently return another listing');
  assert.match(newClientKey(), /^[a-z0-9]+-[a-z0-9]+$/);
});

test('the wizard-dirty flag is readable synchronously', () => {
  // navigation/index.tsx reads this inside a tabPress handler, which cannot
  // await. If it ever became async the Sell tab would resume wiping forms.
  setWizardDirty(false);
  assert.equal(isWizardDirty(), false);
  setWizardDirty(true);
  assert.equal(isWizardDirty(), true);
  setWizardDirty(false);
});
