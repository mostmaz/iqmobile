// Structured condition answers.
//
// The rule this file protects: a value we cannot interpret is never stored as
// if we could, and an unknown QUESTION never costs the seller their listing.
// Those pull in opposite directions — strict about values, forgiving about
// shape — and getting the balance wrong breaks either old apps or new ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONDITION_FIELDS, parseConditionDetails, serializeConditionDetails,
  answeredFields, declaredDefects, undeclaredDefects, annotateDisclosure,
} from '../src/conditionDetails.js';

// The vocabulary the AI inspector speaks. Kept literal here on purpose: if
// someone edits listingInspect.js's enum, this test should fail rather than
// the two quietly drifting apart.
const INSPECTOR_KINDS = new Set([
  'cracked_screen', 'cracked_back', 'dent_or_bend', 'deep_scratches',
  'screen_defect', 'water_damage', 'missing_part',
  'not_powering_on', 'battery_fault', 'locked_account', 'repaired_before',
]);

test('every declarable defect is a word the inspector also knows', () => {
  // This is the whole design: the seller's answer and the photo verdict have
  // to be the same vocabulary or they can never be compared.
  for (const f of CONDITION_FIELDS) {
    for (const o of f.options) {
      if (o.defect) {
        assert.ok(INSPECTOR_KINDS.has(o.defect),
          `${f.id}=${o.value} declares "${o.defect}", which listingInspect does not know`);
      }
    }
  }
});

test('every field offers an explicit "I do not know"', () => {
  // A seller who bought the phone second-hand genuinely does not know if the
  // screen was replaced. Forcing a guess produces a listing that is
  // confidently wrong, so this option must stay cheap to pick.
  for (const f of CONDITION_FIELDS) {
    const has = f.options.some((o) => o.value === 'unknown' || o.value === 'none' || o.value === 'no');
    assert.ok(has, `${f.id} has no way to decline`);
  }
});

test('an unknown value is dropped, not stored', () => {
  assert.deepEqual(parseConditionDetails({ screen: 'shattered' }), {});
  assert.deepEqual(parseConditionDetails({ screen: 'cracked' }), { screen: 'cracked' });
});

test('an unknown question is dropped, not an error', () => {
  // A newer app asking one more question must not make the listing fail to
  // save — the seller loses their whole form over a field we ignore anyway.
  assert.deepEqual(
    parseConditionDetails({ screen: 'clean', esim_locked: 'yes' }),
    { screen: 'clean' },
  );
});

test('junk of any shape parses to nothing rather than throwing', () => {
  for (const junk of [null, undefined, '', 'not json', '[]', [], 42, '{"a":', true]) {
    assert.deepEqual(parseConditionDetails(junk), {}, `${JSON.stringify(junk)}`);
  }
});

test('a JSON string round-trips through the column', () => {
  const stored = serializeConditionDetails({ screen: 'cracked', water: 'no' });
  assert.deepEqual(parseConditionDetails(stored), { screen: 'cracked', water: 'no' });
});

test('"unknown" counts as answered — the seller was asked and told us', () => {
  // This is what lets the prose nag stand down. Treating «غير معروف» as
  // unanswered would keep demanding a paragraph about the screen from
  // someone who has already said they do not know.
  const a = answeredFields({ screen: 'unknown' });
  assert.equal(a.has('screen'), true);
  assert.equal(a.has('body'), false);
});

test('declared defects come out in the inspector vocabulary', () => {
  assert.deepEqual(
    [...declaredDefects({ screen: 'cracked', water: 'yes', body: 'clean' })].sort(),
    ['cracked_screen', 'water_damage'],
  );
});

test('a clean answer declares nothing, and is not the same as silence', () => {
  assert.equal(declaredDefects({ screen: 'clean' }).size, 0);
  assert.equal(answeredFields({ screen: 'clean' }).has('screen'), true);
});

test('only the defects the seller did NOT own up to are discrepancies', () => {
  // A seller who declared the crack is being honest; showing that to a
  // reviewer as a flag teaches them to ignore flags.
  assert.deepEqual(
    undeclaredDefects({ screen: 'cracked' }, ['cracked_screen', 'water_damage']),
    ['water_damage'],
  );
  assert.deepEqual(undeclaredDefects({ screen: 'cracked' }, ['cracked_screen']), []);
});

test('a confession and a contradiction do not look the same to an operator', () => {
  const review = { term: 'كسر', kind: 'cracked_screen', defects: [{ kind: 'cracked_screen', term: 'كسر' }] };

  const honest = annotateDisclosure(review, { screen: 'cracked' });
  assert.equal(honest.defects[0].declared, true);
  assert.equal(honest.contradicts, false, 'they said it in both places');

  const hiding = annotateDisclosure(review, { screen: 'clean' });
  assert.equal(hiding.defects[0].declared, false);
  assert.equal(hiding.contradicts, true, 'ticked clean, wrote about a crack');
});

test('nothing is suppressed — a disclosed defect still reaches the queue', () => {
  const review = { term: 'كسر', kind: 'cracked_screen', defects: [{ kind: 'cracked_screen', term: 'كسر' }] };
  const out = annotateDisclosure(review, { screen: 'cracked' });
  assert.equal(out.defects.length, 1, 'annotated, not filtered');
});

test('a listing with no answers at all is unchanged by annotation', () => {
  const review = { term: 'كسر', kind: 'cracked_screen', defects: [{ kind: 'cracked_screen', term: 'كسر' }] };
  const out = annotateDisclosure(review, {});
  assert.equal(out.defects[0].declared, false);
  assert.equal(out.contradicts, false, 'saying nothing is not contradicting anything');
  assert.equal(annotateDisclosure(null, {}), null);
});
