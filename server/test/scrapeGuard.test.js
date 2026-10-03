// The scraping defences of 3 Oct 2026, through HTTP.
//
// Before them a script could copy every seller's phone number in about
// sixty requests: numbers rode in every feed row, the offset walked the
// whole table, and nothing limited reads. Pinned here: list responses carry
// no numbers, paging stops at a floor, the detail page hands numbers out
// inside a daily budget per viewer (and per network for guests), views and
// sticker scans count once a day, pending shops have no public page, and a
// tokenless caller is throttled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-scrape-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { default: express } = await import('express');
const { db, setSettingValue } = await import('../src/db.js');
const { issueToken } = await import('../src/auth.js');
const { readLimits } = await import('../src/limits.js');
const { default: listingsRoutes } = await import('../src/routes/listings.js');
const { default: shopsRoutes } = await import('../src/routes/shops.js');
const { default: webShopRoutes } = await import('../src/routes/webShop.js');
const { MAX_LIST_OFFSET } = await import('../src/scrapeGuard.js');

const app = express();
app.use(express.json());
app.use(['/listings', '/shops'], readLimits);
app.use('/listings', listingsRoutes);
app.use('/', shopsRoutes);
app.use('/', webShopRoutes);
const server = http.createServer(app);
await new Promise((res) => server.listen(0, res));
const BASE = `http://127.0.0.1:${server.address().port}`;

const NOW = Date.now();
const DAY = 86400000;
let uid = 0, lid = 0;
function user({ guest = false, shop = false, status = 'approved', phone } = {}) {
  const id = ++uid;
  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, seller_type, shop_status,
                                shop_name, is_guest, created_at)
              VALUES(?,?,'x','مستخدم','Baghdad',?,?,?,?,?)`)
    .run(id, phone || (guest ? `guest:${id}` : `0770200${String(id).padStart(4, '0')}`),
      shop ? 'shop' : 'individual', shop ? status : 'approved', shop ? `متجر ${id}` : null, guest ? 1 : 0, NOW);
  return { id, token: issueToken({ id }) };
}
function listing(sellerId, extra = {}) {
  const id = ++lid;
  db.prepare(`INSERT INTO phone_listings(id, seller_id, brand, model, condition, asking_price, governorate,
      status, is_draft, created_at, updated_at, expires_at, contact_phone, contact_whatsapp, sale_price, client_key,
      video_path, video_status)
    VALUES(?,?,'Apple','iPhone 13','used',500000,'Baghdad',?,0,?,?,?,?,?,?,?,?,?)`)
    .run(id, sellerId, extra.status || 'active', NOW - id * 1000, NOW, NOW + 30 * DAY,
      `0780300${String(id).padStart(4, '0')}`, `0780300${String(id).padStart(4, '0')}`,
      extra.sale_price ?? null, `ck-${id}`, extra.video_path ?? null, extra.video_status ?? null);
  return id;
}
async function get(p, u, headers = {}) {
  const res = await fetch(BASE + p, { headers: { ...(u ? { authorization: `Bearer ${u.token}` } : {}), ...headers } });
  const text = await res.text();
  let data = text; try { data = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, data, headers: res.headers };
}
const reset = () => db.exec('DELETE FROM viewer_marks');

const seller = user();
const ids = [];
for (let i = 0; i < 8; i++) ids.push(listing(seller.id, { sale_price: 450000 }));

// ── lists carry no numbers ─────────────────────────────────────────────

test('feed rows carry no phone, WhatsApp, sale price or client key', async () => {
  const buyer = user();
  const r = await get('/listings?limit=50', buyer);
  assert.equal(r.status, 200);
  assert.ok(r.data.length >= 8);
  for (const row of r.data) {
    for (const k of ['contact_phone', 'contact_whatsapp', 'seller_phone', 'phone_visible', 'sale_price', 'client_key']) {
      assert.ok(!(k in row), `${k} leaked in the feed`);
    }
  }
});

test('the similar-listings rail carries no numbers either', async () => {
  const buyer = user();
  const r = await get(`/listings/${ids[0]}/similar`, buyer);
  assert.equal(r.status, 200);
  assert.ok(r.data.length > 0);
  assert.ok(r.data.every((row) => !('contact_phone' in row) && !('contact_whatsapp' in row)));
});

test('paging stops at the floor instead of walking the table', async () => {
  const buyer = user();
  const r = await get(`/listings?limit=50&offset=${MAX_LIST_OFFSET}`, buyer);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, []);
});

// ── the detail page's daily budget ─────────────────────────────────────

test('a registered account sees numbers up to its budget, then the page loads without them', async () => {
  reset();
  setSettingValue('contact_budget_user', '3');
  const buyer = user();
  for (const id of ids.slice(0, 3)) {
    const r = await get(`/listings/${id}`, buyer);
    assert.equal(r.status, 200);
    assert.ok(r.data.contact_phone, `listing ${id} should show its number`);
  }
  const over = await get(`/listings/${ids[3]}`, buyer);
  assert.equal(over.status, 200);
  assert.equal(over.data.contact_phone, null);
  assert.equal(over.data.contact_whatsapp, null);
  assert.equal(over.data.brand, 'Apple', 'the page itself still loads');
  // A listing already shown today keeps its number.
  assert.ok((await get(`/listings/${ids[0]}`, buyer)).data.contact_phone);
  // The seller always sees their own.
  assert.ok((await get(`/listings/${ids[3]}`, seller)).data.contact_phone);
  setSettingValue('contact_budget_user', '150');
});

test('guests on one network share a network budget; rotating guests does not reset it', async () => {
  reset();
  setSettingValue('contact_budget_network', '3');
  const g1 = user({ guest: true }), g2 = user({ guest: true });
  assert.ok((await get(`/listings/${ids[0]}`, g1)).data.contact_phone);
  assert.ok((await get(`/listings/${ids[1]}`, g1)).data.contact_phone);
  assert.ok((await get(`/listings/${ids[2]}`, g2)).data.contact_phone);
  assert.equal((await get(`/listings/${ids[3]}`, g2)).data.contact_phone, null);
  // A registered account on the same network is not held to it.
  const member = user();
  assert.ok((await get(`/listings/${ids[4]}`, member)).data.contact_phone);
  setSettingValue('contact_budget_network', '400');
});

test('a call with no token gets the small budget', async () => {
  reset();
  setSettingValue('contact_budget_tokenless', '2');
  assert.ok((await get(`/listings/${ids[0]}`)).data.contact_phone);
  assert.ok((await get(`/listings/${ids[1]}`)).data.contact_phone);
  assert.equal((await get(`/listings/${ids[2]}`)).data.contact_phone, null);
  setSettingValue('contact_budget_tokenless', '30');
});

test('the budget can be switched off from settings', async () => {
  reset();
  setSettingValue('contact_budget_enabled', '0');
  setSettingValue('contact_budget_tokenless', '1');
  assert.ok((await get(`/listings/${ids[0]}`)).data.contact_phone);
  assert.ok((await get(`/listings/${ids[1]}`)).data.contact_phone);
  setSettingValue('contact_budget_enabled', '1');
  setSettingValue('contact_budget_tokenless', '30');
});

test('the sale price is the seller\'s alone', async () => {
  reset();
  const buyer = user();
  assert.ok(!('sale_price' in (await get(`/listings/${ids[5]}`, buyer)).data));
  assert.equal((await get(`/listings/${ids[5]}`, seller)).data.sale_price, 450000);
});

// ── views ──────────────────────────────────────────────────────────────

test('a view counts once per viewer per day, however often the page is opened', async () => {
  reset();
  const buyer = user();
  const views = () => db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='view' AND listing_id=?").get(ids[6]).n;
  const before = views();
  for (let i = 0; i < 5; i++) await get(`/listings/${ids[6]}`, buyer);
  assert.equal(views() - before, 1);
  await get(`/listings/${ids[6]}`, user());
  assert.equal(views() - before, 2, 'a second person is a second view');
});

// ── shops ──────────────────────────────────────────────────────────────

test('the shop directory carries no numbers; the shop page does, within the budget', async () => {
  reset();
  const shop = user({ shop: true });
  db.prepare("UPDATE users SET shop_phone='07501112222', shop_whatsapp='07501112222' WHERE id=?").run(shop.id);
  const lst = listing(shop.id, { video_path: '/uploads/vid_secret.mp4', video_status: 'pending' });
  const buyer = user();

  const dir = await get('/shops', buyer);
  const card = dir.data.find((s) => s.id === shop.id);
  assert.ok(card);
  assert.equal(card.shop_phone, null);
  assert.deepEqual(card.shop_phones, []);
  assert.equal(card.shop_whatsapp, null);

  const page = await get(`/shops/${shop.id}`, buyer);
  assert.equal(page.data.shop_phone, '07501112222');
  const row = page.data.listings.find((l) => l.id === lst);
  assert.ok(!('contact_phone' in row), 'shop page cards carry no numbers');
  assert.ok(!('video_path' in row), 'an unapproved video path never leaves through a list');
  assert.equal(row.has_video, false);

  setSettingValue('contact_budget_user', '1');
  const other = user({ shop: true });
  db.prepare("UPDATE users SET shop_phone='07503334444' WHERE id=?").run(other.id);
  assert.equal((await get(`/shops/${other.id}`, buyer)).data.shop_phone, null, 'over budget: no number');
  setSettingValue('contact_budget_user', '150');
});

test('a shop waiting for review has no public web page or sticker page', async () => {
  const pending = user({ shop: true, status: 'pending' });
  assert.equal((await get(`/shop/${pending.id}`)).status, 404);
  assert.equal((await get(`/shop/${pending.id}/sticker`)).status, 404);
  const live = user({ shop: true });
  assert.equal((await get(`/shop/${live.id}`)).status, 200);
});

test('a sticker scan counts once per phone per day', async () => {
  reset();
  const live = user({ shop: true });
  const scans = () => db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='shop.sticker_scan' AND shop_id=?").get(live.id).n;
  const ua = { 'user-agent': 'Mozilla/5.0 (iPhone)' };
  for (let i = 0; i < 4; i++) await get(`/shop/${live.id}?src=sticker`, null, ua);
  assert.equal(scans(), 1);
  await get(`/shop/${live.id}?src=sticker`, null, { 'user-agent': 'Mozilla/5.0 (Android)' });
  assert.equal(scans(), 2, 'another phone on the same network is another scan');
});

// ── read rate limit ────────────────────────────────────────────────────

test('a caller with no token is throttled on reads; an app account is not at that rate', async () => {
  let limited = 0;
  for (let i = 0; i < 45; i++) if ((await get('/listings?limit=1')).status === 429) limited += 1;
  assert.ok(limited > 0, 'tokenless reads past 40 a minute are refused');
  const buyer = user();
  for (let i = 0; i < 45; i++) assert.equal((await get('/listings?limit=1', buyer)).status, 200);
});

test.after(() => { server.close(); db.close(); });
