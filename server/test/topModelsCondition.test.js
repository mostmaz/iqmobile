// The condition filter on GET /listings/top-models — the request funnel's
// device grid.
//
// This is an HTTP test rather than a unit test of groupTopModels, because
// the property worth pinning is not the grouping (that has its own file) but
// WHERE the filter is applied. Filtering the finished cards instead of the
// rows would still produce a correct-looking list while every card carried
// the unfiltered count and price range, and no assertion on the pure
// function could tell the two apart.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-topmodels-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { default: express } = await import('express');
const { db } = await import('../src/db.js');
const { default: listingsRoutes } = await import('../src/routes/listings.js');

const app = express();
app.use(express.json());
app.use('/listings', listingsRoutes);
const server = http.createServer(app);
await new Promise((res) => server.listen(0, res));
const BASE = `http://127.0.0.1:${server.address().port}`;

const NOW = Date.now();

// Rows that satisfy the NOT NULLs. Omitting password_hash or governorate on
// the user, or updated_at/expires_at on the listing, fails the INSERT rather
// than the assertion — the same trap the boost fixtures hit.
// A plain INSERT on purpose: `INSERT OR IGNORE` swallows a NOT NULL failure
// too, and the seller then silently does not exist — which surfaces later as
// a FOREIGN KEY error on the listings, three steps from the cause.
db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, created_at)
            VALUES(1, '07700000001', 'x', 'Seller', 'Baghdad', ?)`).run(Date.now());

let nextId = 1;
function listing({ model, condition, price, brand = 'Apple', createdAt = NOW - 86400000 }) {
  const id = nextId++;
  db.prepare(`INSERT INTO phone_listings
    (id, seller_id, brand, model, condition, asking_price, governorate, status,
     created_at, updated_at, expires_at)
    VALUES(?, 1, ?, ?, ?, ?, 'Baghdad', 'active', ?, ?, ?)`)
    .run(id, brand, model, condition, price, createdAt, createdAt, NOW + 30 * 86400000);
  return id;
}

// Two devices. The iPhone 13 has one used listing among three; the iPhone 14
// has none at all, so it must disappear entirely under `condition=used`.
listing({ model: 'iPhone 13', condition: 'new', price: 900000 });
listing({ model: 'iPhone 13', condition: 'new', price: 950000 });
listing({ model: 'iPhone 13', condition: 'used', price: 400000 });
listing({ model: 'iPhone 14', condition: 'new', price: 1200000 });
listing({ model: 'iPhone 12', condition: 'refurbished', price: 300000 });

const get = async (q) => {
  const res = await fetch(`${BASE}/listings/top-models?${q}`);
  return { status: res.status, data: await res.json() };
};
const find = (rows, model) => rows.find((r) => r.model === model) || null;

test('no condition is every condition', async () => {
  const { status, data } = await get('brand=Apple&days=365');
  assert.equal(status, 200);
  assert.equal(find(data, 'iPhone 13').count, 3);
  assert.ok(find(data, 'iPhone 14'), 'the unfiltered grid shows every device');
});

test('a device with no stock in that condition leaves the grid', async () => {
  const { data } = await get('brand=Apple&days=365&condition=used');
  assert.equal(find(data, 'iPhone 14'), null,
    'a card that opens onto an empty list is the bug the whole funnel exists to avoid');
  assert.equal(find(data, 'iPhone 13').count, 1);
});

test('the count and the price range describe the FILTERED set', async () => {
  // The reason the filter runs before grouping. An «١ جهاز» card quoting
  // 900,000 would be describing the two new phones it just excluded.
  const { data } = await get('brand=Apple&days=365&condition=used');
  const row = find(data, 'iPhone 13');
  assert.equal(row.count, 1);
  assert.equal(row.min_price, 400000);
  assert.equal(row.max_price, 400000);
});

test('«مجدد» still filters, though the sell form no longer offers it', async () => {
  // refurbished is a valid stored value with live listings behind it. It is
  // unoffered, not retired — see src/conditions.js.
  const { data } = await get('brand=Apple&days=365&condition=refurbished');
  assert.equal(data.length, 1);
  assert.equal(data[0].model, 'iPhone 12');
});

test('an unknown condition is ignored, exactly as GET /listings ignores it', async () => {
  // Not a 400. The two routes back one screen; a value that silently passes
  // on one and rejects on the other is worse than either rule alone.
  const { status, data } = await get('brand=Apple&days=365&condition=' + encodeURIComponent("' OR 1=1 --"));
  assert.equal(status, 200);
  assert.equal(find(data, 'iPhone 13').count, 3, 'the unfiltered answer, not an error and not a leak');
});

test.after(() => server.close());
