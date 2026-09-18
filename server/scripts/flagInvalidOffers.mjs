// Offers typed in thousands: "200" meant 200,000.
//
// The sibling of fixThousandPrices.js, for request_offers rather than
// listings — and deliberately NOT the same remedy. That script multiplies,
// because an asking price is the seller talking to the market and 1,050 is
// unambiguously 1,050,000. An OFFER is a commitment to one named buyer who
// may already have read it, so this only marks the row and asks the seller
// to resend. Choosing a price on someone's behalf and sending it under their
// name is not a fix.
//
// Measured 18 Sep 2026: 16 of the 43 offers ever sent were under 20,000 IQD.
//
//   node scripts/flagInvalidOffers.mjs                    # dry run
//   node scripts/flagInvalidOffers.mjs --apply            # flag + backup
//   node scripts/flagInvalidOffers.mjs --apply --notify    # …and tell them
//
// Flagging and notifying are separate switches because they undo differently:
// the flag is bookkeeping (reverse with the UPDATE below), a push is an
// interruption to a real person that cannot be taken back.
//
// Reverse:  UPDATE request_offers SET invalid_reason=NULL WHERE invalid_reason='price_too_low';
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db.js';
import { MIN_OFFER_IQD } from '../src/offerValidation.js';

const apply = process.argv.includes('--apply');
const notifySellers = process.argv.includes('--notify');

const bad = db.prepare(
  `SELECT o.id, o.request_id, o.seller_id, o.price, o.created_at,
          u.display_name AS seller, r.brand, r.model, r.status AS request_status,
          r.expires_at
     FROM request_offers o
     JOIN users u ON u.id = o.seller_id
     JOIN phone_requests r ON r.id = o.request_id
    WHERE o.status='sent' AND o.price < ? AND o.invalid_reason IS NULL
    ORDER BY o.created_at DESC`,
).all(MIN_OFFER_IQD);

console.log(`offers below ${MIN_OFFER_IQD.toLocaleString('en-US')} IQD, not yet flagged: ${bad.length}\n`);
for (const o of bad) {
  console.log(`  offer ${String(o.id).padStart(4)}  ${String(o.price).padStart(7)} IQD`
    + `  ${o.brand} ${o.model}`.padEnd(32)
    + `  seller ${o.seller || o.seller_id}  request #${o.request_id} (${o.request_status})`);
}

const sellers = new Set(bad.map((o) => o.seller_id));
const live = bad.filter((o) => o.request_status === 'open' && o.expires_at > Date.now());
console.log(`\ndistinct sellers: ${sellers.size} · offers on requests still open: ${live.length}`);

if (!bad.length) process.exit(0);
if (!apply) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply.');
  process.exit(0);
}

// Journalled before the write, same as fixThousandPrices.js: a bad run is
// one file away from being undone.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(process.env.HOME || '.', `offer-invalid-backup-${stamp}.json`);
fs.writeFileSync(backup, JSON.stringify(bad, null, 2));
console.log(`\nbackup written: ${backup}`);

const flag = db.prepare("UPDATE request_offers SET invalid_reason='price_too_low' WHERE id=? AND invalid_reason IS NULL");
db.transaction((rows) => { for (const o of rows) flag.run(o.id); })(bad);
console.log(`flagged ${bad.length} offers.`);

if (!notifySellers) {
  console.log('No notifications sent. Add --notify to ask the sellers to resend.');
  process.exit(0);
}

const { notify } = await import('../src/notify.js');
// One message per seller, not per offer: someone who mistyped three prices
// made one mistake. And only for requests still open — asking someone to
// resend into a closed request is a chore with no outcome.
const bySeller = new Map();
for (const o of live) {
  if (!bySeller.has(o.seller_id)) bySeller.set(o.seller_id, []);
  bySeller.get(o.seller_id).push(o);
}
let sent = 0;
for (const [sellerId, offers] of bySeller) {
  notify(sellerId, 'offer.invalid', { offer_ids: offers.map((o) => o.id), request_id: offers[0].request_id }, {
    title: 'راجع سعر عرضك',
    body: offers.length === 1
      ? `عرضك على ${offers[0].brand} ${offers[0].model} وصل بسعر ${offers[0].price} د.ع — أعد إرساله بالسعر الكامل بالدينار.`
      : `${offers.length} من عروضك وصلت بأسعار ناقصة — أعد إرسالها بالسعر الكامل بالدينار.`,
  });
  sent++;
}
console.log(`notified ${sent} sellers.`);
