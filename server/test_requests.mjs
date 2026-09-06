// End-to-end test for phone requests. Runs against the :4700 test server
// on a COPY of the dev DB — never prod.
const BASE = 'http://127.0.0.1:4700';
let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`); }
}
async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}
const rnd = () => String(Math.floor(Math.random() * 90000000) + 10000000);
async function mkUser(name, gov = 'Baghdad', seller_type = 'individual') {
  const phone = '077' + rnd();
  const r = await call('/auth/register', { method: 'POST', body: { phone, password: 'test1234', display_name: name, governorate: gov, seller_type } });
  if (!r.body?.token) throw new Error('register failed: ' + JSON.stringify(r));
  return { token: r.body.token, id: r.body.user.id, phone, name };
}
async function notifs(token) { return (await call('/notifications', { token })).body || []; }

console.log('\n=== phone requests: end to end ===\n');

// ── actors ──────────────────────────────────────────────────────────
const buyer  = await mkUser('مشتري تجريبي', 'Baghdad');
const holder = await mkUser('بائع عنده الجهاز', 'Baghdad');   // will hold a matching listing
const other  = await mkUser('بائع بعيد', 'Basra');            // no match, different gov
console.log(`buyer=${buyer.id} holder=${holder.id} other=${other.id}`);

// holder posts a matching listing
const listing = await call('/listings', { method: 'POST', token: holder.token, body: {
  brand: 'Apple', model: 'iPhone 13', condition: 'used', asking_price: 700000,
  governorate: 'Baghdad', description: 'test', contact_phone: holder.phone,
} });
ok(listing.status === 200 && listing.body?.id, 'holder posted a matching listing', listing.body);
const listingId = listing.body?.id;

console.log('\n— create —');
const created = await call('/phone-requests', { method: 'POST', token: buyer.token, body: {
  brand: 'Apple', model: 'iPhone 13', condition: 'used', max_price: 800000, governorate: 'Baghdad', note: 'أريده بحالة ممتازة',
} });
ok(created.status === 200, 'request created', created.body);
const reqId = created.body?.id;
ok(created.body?.status === 'open', 'starts open');
ok(created.body?.offer_count === 0, 'starts with zero offers');
ok(created.body?.is_mine === true, 'buyer sees it as his');
ok(Array.isArray(created.body?.offers), 'buyer gets an offers array');

await new Promise((r) => setTimeout(r, 400)); // fan-out runs in setImmediate

console.log('\n— fan-out —');
const holderN = await notifs(holder.token);
const match = holderN.find((n) => n.kind === 'request.match');
ok(!!match, 'seller HOLDING a match was notified', holderN.map((n) => n.kind));
ok(match?.payload?.listing_id === listingId, 'the notification names WHICH of his listings fits', match?.payload);
ok(match?.payload?.request_id === reqId, 'and which request');
const buyerN = await notifs(buyer.token);
ok(!buyerN.some((n) => n.kind === 'request.match' || n.kind === 'request.new'), 'buyer was not notified about his own request');

console.log('\n— privacy on the public board —');
const board = await call('/phone-requests');
ok(board.status === 200, 'board is public (no auth)');
const onBoard = (board.body || []).find((x) => x.id === reqId);
ok(!!onBoard, 'the request is on the board');
ok(onBoard?.buyer && !('phone' in onBoard.buyer), 'buyer block carries no phone');
ok(!JSON.stringify(onBoard || {}).includes(buyer.phone), "buyer's phone appears NOWHERE in the public row");
ok(onBoard?.offers === undefined, 'anonymous viewer gets no offers array');
ok(onBoard?.is_mine === false, 'anonymous viewer is not the owner');

console.log('\n— offers —');
const own = await call(`/phone-requests/${reqId}/offers`, { method: 'POST', token: buyer.token, body: { price: 100 } });
ok(own.status === 400 && own.body?.error === 'own_request', 'buyer cannot offer on his own request', own.body);

const stolen = await call(`/phone-requests/${reqId}/offers`, { method: 'POST', token: other.token, body: { price: 690000, listing_id: listingId } });
ok(stolen.status === 400 && stolen.body?.error === 'bad_listing', "a seller cannot attach someone else's listing", stolen.body);

const offer = await call(`/phone-requests/${reqId}/offers`, { method: 'POST', token: holder.token, body: { price: 690000, listing_id: listingId, note: 'متوفر أزرق 128' } });
ok(offer.status === 200, 'holder sent an offer', offer.body);
ok(offer.body?.listing?.id === listingId, 'offer carries the attached listing');
ok(offer.body?.seller?.id === holder.id, 'offer carries a seller card');

const offer2 = await call(`/phone-requests/${reqId}/offers`, { method: 'POST', token: other.token, body: { price: 730000 } });
ok(offer2.status === 200, 'a second seller offered without a listing');
ok(offer2.body?.listing === null, 'listing-less offer is allowed');

console.log('\n— what each side sees —');
const asBuyer = await call(`/phone-requests/${reqId}`, { token: buyer.token });
ok(asBuyer.body?.offers?.length === 2, 'buyer sees BOTH offers', asBuyer.body?.offers?.length);
ok(asBuyer.body?.offers?.[0]?.price === 690000, 'offers are sorted cheapest first', asBuyer.body?.offers?.map((o) => o.price));
ok(asBuyer.body?.offer_count === 2, 'offer_count kept in step', asBuyer.body?.offer_count);
ok(!!asBuyer.body?.offers?.[0]?.seller?.phone, "buyer can reach the seller (phone present)");

const asSeller = await call(`/phone-requests/${reqId}`, { token: other.token });
ok(asSeller.body?.offers === undefined, 'a seller does NOT get the offers array');
ok(asSeller.body?.my_offer?.price === 730000, 'a seller sees his own offer');
ok(!JSON.stringify(asSeller.body).includes('690000'), "a seller cannot see a RIVAL's price");

console.log('\n— edit, withdraw —');
const edited = await call(`/phone-requests/${reqId}/offers`, { method: 'POST', token: other.token, body: { price: 680000 } });
ok(edited.status === 200 && edited.body.price === 680000, 're-offering edits in place');
const afterEdit = await call(`/phone-requests/${reqId}`, { token: buyer.token });
ok(afterEdit.body?.offers?.length === 2, 'an edit does NOT create a second row', afterEdit.body?.offers?.length);
ok(afterEdit.body?.offer_count === 2, 'offer_count unchanged by an edit');

const withdrawn = await call(`/phone-requests/${reqId}/offers/mine`, { method: 'DELETE', token: other.token });
ok(withdrawn.status === 200, 'seller withdrew');
const afterWithdraw = await call(`/phone-requests/${reqId}`, { token: buyer.token });
ok(afterWithdraw.body?.offers?.length === 1, 'withdrawn offer disappears', afterWithdraw.body?.offers?.length);
ok(afterWithdraw.body?.offer_count === 1, 'offer_count dropped to 1', afterWithdraw.body?.offer_count);

console.log('\n— buyer notified of offers —');
const buyerN2 = await notifs(buyer.token);
ok(buyerN2.filter((n) => n.kind === 'request.offer').length >= 2, 'buyer got a notification per offer', buyerN2.filter((n) => n.kind === 'request.offer').length);

console.log('\n— duplicate + caps —');
const dup = await call('/phone-requests', { method: 'POST', token: buyer.token, body: { brand: 'Apple', model: 'iPhone 13', max_price: 800000, governorate: 'Baghdad' } });
ok(dup.status === 409 && dup.body?.error === 'already_open', 'a duplicate open request is refused, not re-broadcast', dup.body?.error);
ok(dup.body?.request?.id === reqId, 'and it hands back the existing one');

const badBrand = await call('/phone-requests', { method: 'POST', token: buyer.token, body: { brand: 'NotABrand', model: 'X', max_price: 100000 } });
ok(badBrand.status === 400, 'unknown brand refused');
const badPrice = await call('/phone-requests', { method: 'POST', token: buyer.token, body: { brand: 'Apple', model: 'iPhone 14', max_price: 0 } });
ok(badPrice.status === 400, 'zero price refused');

console.log('\n— reciprocal: listing posted AFTER the request —');
const laterReq = await call('/phone-requests', { method: 'POST', token: buyer.token, body: { brand: 'Samsung', model: 'Galaxy S23', max_price: 900000, governorate: 'Baghdad' } });
ok(laterReq.status === 200, 'second request created', laterReq.body?.error);
await new Promise((r) => setTimeout(r, 300));
const before = (await notifs(other.token)).filter((n) => n.kind === 'request.match').length;
const laterListing = await call('/listings', { method: 'POST', token: other.token, body: {
  brand: 'Samsung', model: 'Galaxy S23', condition: 'used', asking_price: 850000,
  governorate: 'Basra', description: 'test', contact_phone: other.phone,
} });
ok(laterListing.status === 200, 'seller posted a listing that answers it');
await new Promise((r) => setTimeout(r, 400));
const after = (await notifs(other.token)).filter((n) => n.kind === 'request.match').length;
ok(after > before, 'seller was told a buyer is already looking for it', { before, after });

console.log('\n— close —');
const closed = await call(`/phone-requests/${reqId}`, { method: 'PATCH', token: buyer.token, body: { status: 'fulfilled' } });
ok(closed.status === 200 && closed.body?.status === 'fulfilled', 'buyer marked it fulfilled');
const boardAfter = await call('/phone-requests');
ok(!(boardAfter.body || []).some((x) => x.id === reqId), 'a fulfilled request leaves the board');
const lateOffer = await call(`/phone-requests/${reqId}/offers`, { method: 'POST', token: holder.token, body: { price: 600000 } });
ok(lateOffer.status === 400 && lateOffer.body?.error === 'request_closed', 'no offers on a closed request', lateOffer.body);

const notMine = await call(`/phone-requests/${reqId}`, { method: 'PATCH', token: other.token, body: { status: 'open' } });
ok(notMine.status === 404, 'a stranger cannot reopen someone else’s request');

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail ? 1 : 0);
