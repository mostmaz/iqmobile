// Finding the links in a message body.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkify } from '../src/lib/linkify.ts';

const urls = (s: string) => linkify(s).filter((x) => x.url).map((x) => x.url);
const joined = (s: string) => linkify(s).map((x) => x.text).join('');

test('the panel address becomes a link', () => {
  assert.deepEqual(urls('افتحها من iqmobile.org/dashboard/store — وبعدها'),
    ['https://iqmobile.org/dashboard/store']);
});

test('the segments always rebuild the original text exactly', () => {
  // The renderer concatenates these; dropping or duplicating a character
  // would silently corrupt every message that contains a link.
  for (const s of [
    'افتحها من iqmobile.org/dashboard/store — وبعدها',
    'https://example.com',
    'لا روابط هنا إطلاقاً',
    '',
    'أول example.com ثم another.org آخر',
  ]) assert.equal(joined(s), s, JSON.stringify(s));
});

test('Arabic punctuation after a URL is not swallowed', () => {
  // «iqmobile.org،» 404s, and the merchant concludes the address is wrong —
  // worse than no link at all.
  assert.deepEqual(urls('الرابط: iqmobile.org، افتحه'), ['https://iqmobile.org']);
  assert.deepEqual(urls('افتح iqmobile.org؛ ثم'), ['https://iqmobile.org']);
  assert.ok(joined('الرابط: iqmobile.org، افتحه').includes('، افتحه'));
});

test('a bare domain gets https, a full URL is left alone', () => {
  assert.deepEqual(urls('iqmobile.org'), ['https://iqmobile.org']);
  assert.deepEqual(urls('http://iqmobile.org'), ['http://iqmobile.org']);
});

test('a dot is not a link', () => {
  // Message bodies are written by people talking about phones.
  assert.deepEqual(urls('السعر 1.5 مليون'), []);
  assert.deepEqual(urls('iPhone 13.pro max'), []);
  assert.deepEqual(urls('الجهاز ممتاز.شكراً'), []);
});

test('several links in one body all come back', () => {
  assert.deepEqual(urls('زر example.com و iqmobile.org/shop/5'),
    ['https://example.com', 'https://iqmobile.org/shop/5']);
});

test('a body with no link is one plain segment', () => {
  const out = linkify('مرحباً');
  assert.equal(out.length, 1);
  assert.equal(out[0].url, null);
});

test('junk input does not throw', () => {
  for (const v of [undefined, null, 123 as any]) {
    assert.ok(Array.isArray(linkify(v as any)));
  }
});
