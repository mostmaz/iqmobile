// The parts of the public pages that exist for crawlers.
//
// Audited on the live site 24 Sep 2026. Three of these tests pin bugs that
// were costing traffic, not opportunities missed:
//   - every page canonicalised to https://api.iqmobile.org, telling Google
//     the brand domain was a duplicate of the API subdomain;
//   - robots.txt and sitemap.xml were both 404;
//   - no structured data anywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-seo-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { default: express } = await import('express');
const { db } = await import('../src/db.js');
const { default: seoFiles } = await import('../src/routes/seoFiles.js');
const {
  SITE_URL, MEDIA_URL, hostIsIndexable, listingJsonLd, shopJsonLd, jsonLd,
} = await import('../src/seo.js');

const app = express();
app.use('/', seoFiles);
const server = http.createServer(app);
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}`;
// Raw http, not fetch: `Host` is a forbidden header name in fetch, which
// drops it silently — so a fetch-based test of per-host robots rules would
// always exercise the same host and pass for the wrong reason.
const get = (p, host) => new Promise((resolve, reject) => {
  const req = http.request(
    { host: '127.0.0.1', port: server.address().port, path: p, method: 'GET',
      headers: host ? { Host: host } : {} },
    (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
    },
  );
  req.on('error', reject);
  req.end();
});

const NOW = Date.now();
db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, seller_type, created_at)
            VALUES(1,'07700000001','x','متجر','Baghdad','shop',?)`).run(NOW);
db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, seller_type, shop_hidden, created_at)
            VALUES(2,'07700000002','x','مخفي','Baghdad','shop',1,?)`).run(NOW);
let lid = 0;
const listing = (status = 'active', draft = 0) => {
  const id = ++lid;
  db.prepare(`INSERT INTO phone_listings(id, seller_id, brand, model, condition, asking_price,
      governorate, status, is_draft, created_at, updated_at, expires_at)
    VALUES(?,1,'Apple','iPhone 13','used',500000,'Baghdad',?,?,?,?,?)`)
    .run(id, status, draft, NOW, NOW, NOW + 8.64e7);
  return id;
};

// ── the canonical host ─────────────────────────────────────────────────

test('the site canonicalises to the BRAND domain, not the API', () => {
  // This is the bug. PUBLIC_BASE_URL is unset in production, so the default
  // is what every page used — and it pointed at api.iqmobile.org.
  assert.ok(!SITE_URL.includes('api.'), `SITE_URL is ${SITE_URL}`);
  assert.equal(SITE_URL, 'https://iqmobile.org');
});

test('images still come from the host that has them', () => {
  // Moving the pages must not move the <img> src to a host with no files.
  assert.ok(MEDIA_URL.includes('api.'), `MEDIA_URL is ${MEDIA_URL}`);
});

test('the API host is never indexable', () => {
  // Same Express app, two names: without this it is a complete duplicate of
  // the site under a second hostname.
  assert.equal(hostIsIndexable('iqmobile.org'), true);
  assert.equal(hostIsIndexable('api.iqmobile.org'), false);
  assert.equal(hostIsIndexable('API.IQMobile.ORG'), false, 'host matching is case-insensitive');
});

// ── robots ─────────────────────────────────────────────────────────────

test('robots.txt exists and points at the sitemap', async () => {
  const r = await get('/robots.txt', 'iqmobile.org');
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/plain/);
  assert.match(r.body, /^User-agent: \*/m);
  assert.match(r.body, new RegExp(`Sitemap: ${SITE_URL}/sitemap\\.xml`));
});

test('robots.txt shuts the API host out entirely', async () => {
  const r = await get('/robots.txt', 'api.iqmobile.org');
  assert.match(r.body, /Disallow: \/\s*$/m);
  assert.ok(!r.body.includes('Allow: /'), 'no allow rule on the duplicate host');
});

// ── sitemaps ───────────────────────────────────────────────────────────

test('the sitemap index lists a shops file and at least one listings file', async () => {
  listing();
  const r = await get('/sitemap.xml', 'iqmobile.org');
  assert.equal(r.status, 200);
  assert.match(r.type, /xml/);
  assert.ok(r.body.includes(`${SITE_URL}/sitemap-shops.xml`));
  assert.ok(r.body.includes(`${SITE_URL}/sitemap-listings-1.xml`));
});

test('only listings a buyer can still act on are submitted', async () => {
  const live = listing('active');
  const sold = listing('sold');
  const reserved = listing('reserved');
  const draft = listing('active', 1);
  const r = await get('/sitemap-listings-1.xml', 'iqmobile.org');
  assert.ok(r.body.includes(`/l/${live}<`), 'the live one is there');
  for (const [id, what] of [[sold, 'sold'], [reserved, 'reserved'], [draft, 'draft']]) {
    assert.ok(!r.body.includes(`/l/${id}<`), `${what} listing must stay out`);
  }
});

test('sitemap URLs are on the brand domain', async () => {
  listing();
  const r = await get('/sitemap-listings-1.xml', 'iqmobile.org');
  assert.ok(!r.body.includes('api.iqmobile.org'),
    'a sitemap is a canonical signal — the wrong host here undoes the tag');
});

test('hidden shops stay out of the shops sitemap', async () => {
  const r = await get('/sitemap-shops.xml', 'iqmobile.org');
  assert.ok(r.body.includes('/shop/1'));
  assert.ok(!r.body.includes('/shop/2'), 'the aggregator and storefront are not public shops');
  assert.ok(r.body.includes(`<loc>${SITE_URL}/</loc>`), 'the home page is in there');
});

// ── structured data ────────────────────────────────────────────────────

const L = {
  id: 7, brand: 'Apple', model: 'iPhone 13', storage: '128GB', color: 'أسود',
  condition: 'used', asking_price: 500000, status: 'active', description: null,
};

test('a listing carries Product and a priced Offer', () => {
  const d = listingJsonLd(L, { images: ['https://x/1.jpg'] });
  assert.equal(d['@type'], 'Product');
  assert.equal(d.offers.price, 500000);
  assert.equal(d.offers.priceCurrency, 'IQD');
  assert.equal(d.offers.availability, 'https://schema.org/InStock');
  assert.equal(d.brand.name, 'Apple');
  assert.ok(d.url.startsWith(SITE_URL));
});

test('a used phone is declared used', () => {
  // Almost everything here is second-hand. Presenting it as new is both
  // wrong and a policy problem.
  assert.equal(listingJsonLd(L).offers.itemCondition, 'https://schema.org/UsedCondition');
  assert.equal(listingJsonLd({ ...L, condition: 'new' }).offers.itemCondition, 'https://schema.org/NewCondition');
  assert.equal(listingJsonLd({ ...L, condition: 'refurbished' }).offers.itemCondition, 'https://schema.org/RefurbishedCondition');
});

test('sold and reserved say so rather than claiming stock', () => {
  assert.equal(listingJsonLd({ ...L, status: 'sold' }).offers.availability, 'https://schema.org/SoldOut');
  assert.equal(listingJsonLd({ ...L, status: 'reserved' }).offers.availability, 'https://schema.org/LimitedAvailability');
});

test('a call-for-price listing gets NO offer, not an offer of one dinar', () => {
  // asking_price <= 1 is the sentinel. Publishing it as a price is a false
  // claim in a machine-readable field.
  assert.equal(listingJsonLd({ ...L, asking_price: 1 }).offers, undefined);
  assert.equal(listingJsonLd({ ...L, price_on_request: 1 }).offers, undefined);
});

test('a shop is a Store, with its rating only when it has one', () => {
  const plain = shopJsonLd({ id: 3, shop_name: 'متجر', governorate: 'Baghdad', rating_count: 0 });
  assert.equal(plain['@type'], 'Store');
  assert.equal(plain.aggregateRating, undefined, 'no invented rating');
  const rated = shopJsonLd({ id: 3, shop_name: 'متجر', rating_avg: 4.7, rating_count: 12 });
  assert.equal(rated.aggregateRating.reviewCount, 12);
});

test('JSON-LD cannot break out of its script block', () => {
  const out = jsonLd({ name: '</script><img src=x onerror=alert(1)>' });
  assert.ok(!out.includes('</script><img'), 'the closing tag must be escaped');
  assert.ok(out.includes('\\u003c'));
});

test.after(() => server.close());
