import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-promotion-payment-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.JWT_SECRET = 'promotion-test-only';
const { default: express } = await import('express');
const { db } = await import('../src/db.js');
const { createLimiter } = await import('../src/limits.js');
beforeEach(() => createLimiter.resetKey('127.0.0.1'));
const { issueToken } = await import('../src/auth.js');
const { default: features } = await import('../src/routes/features.js');
const { default: admin } = await import('../src/routes/admin/index.js');
const { TRANSFER_NUMBERS, QI_CARD } = await import('../src/featureTiers.js');
const { nudgeStalePromotions } = await import('../src/featureNudge.js');
const app=express();app.use(express.json());app.use(features);app.use('/admin',admin);
const server=app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
after(async()=>{ await new Promise(resolve=>server.close(resolve)); db.close();fs.rmSync(dir,{recursive:true,force:true}); });
const base='http://127.0.0.1:'+server.address().port;
for (const id of [1,2]) db.prepare("INSERT INTO users(id,phone,password_hash,display_name,governorate,created_at) VALUES(?,?,'test','Seller','Baghdad',?)").run(id,'0770000000'+id,Date.now());
const seller=issueToken({id:1}), stranger=issueToken({id:2}), adminToken=issueToken({id:1,kind:'admin'});
async function call(method,url,body,token=seller) {
 const response=await fetch(base+url,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 return {status:response.status,data:await response.json()};
}
function listing(status='active') {
 return Number(db.prepare("INSERT INTO phone_listings(seller_id,brand,model,condition,asking_price,governorate,status,created_at,expires_at,updated_at) VALUES(1,'Apple','iPhone 16','used',500000,'Baghdad',?,?,?,?)").run(status,Date.now(),Date.now()+86400000,Date.now()).lastInsertRowid);
}
const request=(id,body={})=>call('POST',`/listings/${id}/feature-request`,{tier:'promo',carrier:'asiacell',sender_phone:'07700000001',...body});
const row=id=>db.prepare('SELECT * FROM feature_requests WHERE id=?').get(id);
const promoted=id=>db.prepare('SELECT featured_until FROM phone_listings WHERE id=?').get(id).featured_until;

test('unpaid request resumes unchanged; payment report is authorized, idempotent and never activates',async()=>{
 const id=listing(), r=await request(id);assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(r.data.payment_state,'awaiting_payment');assert.equal(promoted(id),null);
 const fr=r.data.id, snapshot=JSON.parse(r.data.payment_destination_json);
 assert.equal(snapshot.number,TRANSFER_NUMBERS.asiacell);assert.ok(snapshot.code.includes('5000'));
 assert.equal((await request(id)).status,409);
 const mine=await call('GET','/features/mine');assert.equal(mine.data[0].id,fr);assert.equal(mine.data[0].listing_status,'active');assert.equal(mine.data[0].payment_destination_json,r.data.payment_destination_json);
 assert.equal((await call('POST',`/feature-requests/${fr}/report-payment`,{},null)).status,401);
 assert.equal((await call('POST',`/feature-requests/${fr}/report-payment`,{},stranger)).status,404);
 assert.equal((await call('POST',`/feature-requests/${fr}/report-payment`,{reference:'x'.repeat(121)})).status,400);
 const reported=await call('POST',`/feature-requests/${fr}/report-payment`,{reference:'TX-123'});
 assert.equal(reported.data.payment_state,'reported');assert.equal(reported.data.status,'pending');assert.equal(promoted(id),null);
 const repeat=await call('POST',`/feature-requests/${fr}/report-payment`,{reference:'changed'});
 assert.equal(repeat.data.payment_reported_at,reported.data.payment_reported_at);assert.equal(repeat.data.payment_reference,'TX-123');
 assert.equal((await call('DELETE',`/listings/${id}/feature-request`)).status,409);
 assert.equal((await call('POST',`/admin/feature-requests/${fr}/approve`,{payment_verified:true},seller)).status,401);
 assert.equal((await call('POST',`/admin/feature-requests/${fr}/approve`,{},adminToken)).status,400);
 assert.equal(promoted(id),null);
 // Force a failure after activation: transaction must roll back both writes.
 db.exec("CREATE TRIGGER fail_bonus BEFORE INSERT ON wallet_entries WHEN NEW.reason='promo_bonus' BEGIN SELECT RAISE(ABORT,'test rollback'); END");
 const failed=await fetch(base+`/admin/feature-requests/${fr}/approve`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+adminToken},body:JSON.stringify({payment_verified:true})});
 assert.equal(failed.status,500);assert.equal(row(fr).status,'pending');assert.equal(promoted(id),null);
 db.exec('DROP TRIGGER fail_bonus');
 const before=Date.now();
 assert.equal((await call('POST',`/admin/feature-requests/${fr}/approve`,{payment_verified:true},adminToken)).status,200);
 assert.equal(row(fr).payment_state,'verified');assert.equal(row(fr).payment_verified_by,'admin:1');
 assert.ok(promoted(id)>=before+10*86400000);
 const until=promoted(id);
 assert.equal((await call('POST',`/admin/feature-requests/${fr}/approve`,{payment_verified:true},adminToken)).status,400);
 assert.equal(promoted(id),until);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM wallet_entries WHERE ref_id=? AND reason='promo_bonus'").get(fr).n,1);
 assert.equal((await call('POST',`/feature-requests/${fr}/report-payment`,{})).status,409);
});

test('Qi instructions persist, legacy payments remain unknown, reminders only target unpaid requests',async()=>{
 const id=listing(), r=await request(id,{carrier:'qicard',sender_name:'Test sender'});
 assert.equal(r.status,200);
 assert.deepEqual(JSON.parse(r.data.payment_destination_json),{number:QI_CARD.account,name:QI_CARD.name});
 const old=await request(listing());
 db.prepare("UPDATE feature_requests SET payment_state='legacy_unconfirmed',payment_destination_json=NULL WHERE id=?").run(old.data.id);
 const reported=await request(listing());await call('POST',`/feature-requests/${reported.data.id}/report-payment`,{});
 db.prepare('UPDATE feature_requests SET created_at=? WHERE status=?').run(Date.now()-2*86400000,'pending');
 await nudgeStalePromotions();
 assert.ok(row(r.data.id).nudged_at);assert.equal(row(old.data.id).nudged_at,null);assert.equal(row(reported.data.id).nudged_at,null);
 assert.equal(row(old.data.id).payment_state,'legacy_unconfirmed');
 assert.equal((await call('POST',`/feature-requests/${old.data.id}/report-payment`,{})).data.payment_state,'reported');
});

test('wallet payment verifies and activates atomically; insufficient funds and unavailable listings do not charge',async()=>{
 const id=listing();const before=db.prepare('SELECT COALESCE(SUM(delta),0) n FROM wallet_entries WHERE user_id=1').get().n;
 const r=await request(id,{carrier:'balance',tier:'bronze'});
 assert.equal(r.status,200);assert.equal(r.data.payment_state,'verified');assert.equal(r.data.paid_from_balance,true);assert.ok(promoted(id));
 assert.equal(db.prepare('SELECT SUM(delta) n FROM wallet_entries WHERE user_id=1').get().n,before-2000);
 db.prepare("INSERT INTO wallet_entries(user_id,delta,reason,actor,created_at) VALUES(1,?,'admin_adjust','test',?)").run(-(before-2000),Date.now());
 const poor=listing();
 assert.equal((await request(poor,{carrier:'balance'})).data.error,'insufficient_balance');
 assert.equal(promoted(poor),null);assert.equal(db.prepare('SELECT COUNT(*) n FROM feature_requests WHERE listing_id=?').get(poor).n,0);
 assert.equal((await request(listing('sold'))).status,404);
 const waiting=await request(listing());assert.equal(waiting.status,200,JSON.stringify(waiting.data));db.prepare("UPDATE phone_listings SET status='sold' WHERE id=?").run(waiting.data.listing_id);
 assert.equal((await call('POST',`/admin/feature-requests/${waiting.data.id}/approve`,{payment_verified:true},adminToken)).status,409);
 assert.equal(row(waiting.data.id).status,'pending');
 const mine = await call('GET','/features/mine');
 assert.equal(mine.data.find(f=>f.id===waiting.data.id).listing_status,'sold');
});

test('activation honors purchased snapshot duration after the live tier changes', async()=>{
 const id=listing(), r=await request(id);
 assert.equal(r.status,200);
 db.prepare('UPDATE feature_requests SET days=7,boosts_per_day=3 WHERE id=?').run(r.data.id);
 const before=Date.now();
 const approved=await call('POST',`/admin/feature-requests/${r.data.id}/approve`,{payment_verified:true},adminToken);
 assert.equal(approved.status,200);
 assert.ok(promoted(id)>=before+7*86400000 && promoted(id)<before+7*86400000+5000);
 assert.equal(db.prepare('SELECT boost_interval_ms FROM phone_listings WHERE id=?').get(id).boost_interval_ms,86400000/3);
});
