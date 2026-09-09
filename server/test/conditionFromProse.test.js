import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferConditionDetails, clauses, fold } from '../src/conditionFromProse.js';
import { parseConditionDetails } from '../src/conditionDetails.js';

// Every string below is taken from a real listing on production. Inventing
// Arabic test data here would repeat the OTP mistake: fixtures written from
// the same guess as the code prove only that the guess is self-consistent.

test('the plain declarations it exists for', () => {
  assert.deepEqual(inferConditionDetails('جهاز نضيف بس بي شخوط بالشاشة'), { screen: 'scratches' });
  assert.deepEqual(inferConditionDetails('فقط الضهر مفطر'), { body: 'cracked_back' });
  assert.deepEqual(inferConditionDetails('مستبدل شاشه فقط'), { repairs: 'screen_replaced' });
  assert.deepEqual(inferConditionDetails('مبدل بطاريه اصليه'), { repairs: 'battery_replaced' });
  assert.deepEqual(inferConditionDetails('الشاصي بي شخوط بصيطه كلش'), { body: 'scratches' });
});

test('water resistance is not water damage', () => {
  // Every «ماء» in a thousand live listings was an IP rating. A keyword rule
  // declares water damage on phones advertised as water RESISTANT.
  for (const t of [
    'مقاوم للماء والغبار بمعيار IP69',
    'سماعتين ستيريو ضد الماء كامرة خلفية 108 ميكا بكسل',
    'تصميم فخم مقاوم للغبار ورذاذ الماء',
  ]) assert.equal(inferConditionDetails(t).water, undefined, t);
});

test('«كسر» about the price is not a crack', () => {
  assert.deepEqual(inferConditionDetails('لا تكسر بالسعر الجهاز نضيف بشاشه'), {});
  assert.equal(inferConditionDetails('رجاء لحد يكسر بسعر الشاشه نضيفه').screen, undefined);
});

test('a break that has not happened is not a break', () => {
  // A warranty offer, read as a cracked screen, inverts the seller.
  assert.equal(inferConditionDetails('ضمان التاب 200يوم اذا ينكسر الشاشه تصليح ابلاش').screen, undefined);
  // A repair the phone NEEDS is not a repair that happened.
  assert.equal(inferConditionDetails('يحتاج تاخذه تبدله شاشه').repairs, undefined);
  assert.equal(inferConditionDetails('معوز تصليح بطارية فقط').repairs, undefined);
});

test('the scratched thing is often the protector, not the glass', () => {
  assert.equal(inferConditionDetails('اخو الجديد فقط لاسق الشاشة مخدوش لأن جلاتين').screen, undefined);
});

test('negation is read, which JavaScript word boundaries cannot do', () => {
  // /\bما\b/ matches nothing in Arabic: \b is defined against [A-Za-z0-9_],
  // so there is no boundary between a space and an Arabic letter. With that
  // bug every negation passed and this phone was recorded as repaired.
  assert.deepEqual(inferConditionDetails('الجهاز بلادي ما مبدل بي أي شي ابد'), { repairs: 'none' });
  assert.equal(inferConditionDetails('مامبدل بي شي').repairs, 'none', 'glued negation');
  assert.equal(inferConditionDetails('بدون تصليح او تبديل').repairs, 'none');
  assert.equal(inferConditionDetails('لا مفتوح ولا مصلح').repairs, 'none');
  assert.equal(inferConditionDetails('يوجد فطور بل ضهر الجهاز غير داخل صيانه').repairs, 'none');
});

test('a negator does not reach past its own clause', () => {
  // «فقط» marks the exception. Within one window «بدون» sat close enough to
  // «خدش» to turn a declared scratch into a clean phone.
  const out = inferConditionDetails('نظيف بدون خلل فقط خدش بقاعدة سيم كارت');
  assert.equal(out.screen, undefined);
  assert.equal(out.body, undefined);
  assert.ok(clauses(fold('نظيف بدون خلل فقط خدش بقاعدة سيم كارت')).length >= 2);
});

test('words that contain a negator but negate nothing', () => {
  // «مثل ما واضح بالصور» is "as shown in the photos"; «شخط ما يبين» is a
  // scratch you can barely see. Both describe a defect that EXISTS.
  assert.equal(inferConditionDetails('شخط بشاشه واحد ما بين قليل').screen, 'scratches');
  assert.notEqual(inferConditionDetails('بي شخوط بالشاشه مثل ما واظح بالصور').screen, 'clean');
});

test('a blanket no-scratch claim covers both surfaces, a specific one does not', () => {
  assert.deepEqual(inferConditionDetails('نضيف جدا شخط مابي'), { screen: 'clean', body: 'clean' });
  // …but only while nothing contradicts it.
  assert.equal(inferConditionDetails('شخط مابي بس بي فطر بالظهر').body, 'cracked_back');
});

test('a clause naming both surfaces cannot say which one is scratched', () => {
  // Scratches on the back, in a sentence that also mentions the screen.
  const out = inferConditionDetails('مبدل شاشه وكاله بي شخوط بلضهر');
  assert.equal(out.screen, undefined, 'the screen was not the thing scratched');
});

test('two different answers cancel rather than compete', () => {
  const out = inferConditionDetails('الشاشه نضيفه ماكو شخط. بي شخوط بالشاشه');
  assert.equal(out.screen, undefined);
});

test('it never invents «unknown» — that is a seller answering', () => {
  const seen = new Set();
  for (const t of ['نضيف', 'جهاز مستعمل', '', null, undefined, 12345]) {
    for (const v of Object.values(inferConditionDetails(t))) seen.add(v);
  }
  assert.ok(!seen.has('unknown'));
  assert.deepEqual(inferConditionDetails(''), {});
});

test('everything it emits survives the storage validator', () => {
  // A value this module invents that conditionDetails.js drops would be a
  // backfill that writes nothing while reporting success.
  const corpus = [
    'جهاز نضيف بس بي شخوط بالشاشة', 'فقط الضهر مفطر', 'مستبدل شاشه فقط',
    'مبدل بطاريه اصليه', 'الشاصي بي شخوط بصيطه كلش', 'نضيف جدا شخط مابي',
    'لا مفتوح ولا مصلح', 'الجهاز واقع صاير شاشه خطوط', 'نضيف ومداخل صيانه',
    'بي كدمه بل شاصي',
  ];
  for (const t of corpus) {
    const inferred = inferConditionDetails(t);
    assert.deepEqual(parseConditionDetails(inferred), inferred, t);
  }
});
