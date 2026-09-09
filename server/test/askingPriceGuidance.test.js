import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { askingPriceGuidance } from '../src/askingPriceGuidance.js';
const now=1800000000000;
const filters={brand:'Apple',model:'iPhone 16 Pro',storage:'1TB',condition:'used',governorate:'Baghdad'};
function fixture() {
 const db=new Database(':memory:');
 db.exec('CREATE TABLE users(id INTEGER,shop_hidden INTEGER); INSERT INTO users VALUES(1,0),(2,0),(3,1); CREATE TABLE phone_listings(seller_id INTEGER,brand TEXT,model TEXT,storage TEXT,condition TEXT,governorate TEXT,status TEXT,created_at INTEGER,expires_at INTEGER,stock_qty INTEGER,price_on_request INTEGER,asking_price INTEGER)');
 const add=(overrides={})=>{
  const row={seller_id:2,...filters,status:'active',created_at:now,expires_at:now+1000,stock_qty:1,price_on_request:0,asking_price:500000,...overrides};
  const keys=Object.keys(row);
  db.prepare(`INSERT INTO phone_listings(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(row));
 };
 return {db,add};
}
test('exact comparison, normalized storage, even median and asking-price labeling',()=>{
 const {db,add}=fixture();[400000,500000,600000,900000].forEach(asking_price=>add({asking_price,storage:'1024 GB'}));
 const r=askingPriceGuidance(db,filters,1,now);
 assert.equal(r.count,4);assert.equal(r.median,550000);assert.equal(r.low,400000);assert.equal(r.high,900000);assert.equal(r.basis,'asking_prices');db.close();
});
test('excludes mismatches, unavailable inventory, own ads, hidden shops and stale rows',()=>{
 const {db,add}=fixture();
 // Neither condition NOR governorate is in this list any more, and the stale
 // row is 91 days old rather than 31 — all three deliberate, and pinned by
 // their own tests below.
 for(const overrides of [{model:'iPhone 16 Pro Max'},{storage:'256GB'},{status:'sold'},{status:'reserved'},{seller_id:1},{seller_id:3},{stock_qty:0},{price_on_request:1},{asking_price:1},{created_at:now-91*86400000},{created_at:now+1}])add(overrides);
 add();add();
 const r=askingPriceGuidance(db,filters,1,now);assert.equal(r.count,2);assert.equal(r.median,null);assert.equal(r.low,null);db.close();
});
test('every governorate counts toward the sample, not just the seller\'s own',()=>{
 // Iraq is one market for phones: the same Galaxy in Basra and in Erbil is
 // not two products, and splitting eighteen governorates was the biggest
 // single reason a seller hit the 3-listing floor in Baghdad and nowhere
 // else. `location_scope` is what the client renders its wording from, so
 // the two can never drift.
 const {db,add}=fixture();
 add({governorate:'Basra'});add({governorate:'Erbil'});add({governorate:'Baghdad'});
 const r=askingPriceGuidance(db,filters,1,now);
 assert.equal(r.count,3);
 assert.equal(r.median,500000);
 assert.equal(r.location_scope,'country');
 db.close();
});

test('honors expiration setting and validates required comparison fields',()=>{
 const {db,add}=fixture();for(let i=0;i<3;i++)add({expires_at:now-1});
 assert.equal(askingPriceGuidance(db,filters,1,now,false).count,0);
 assert.equal(askingPriceGuidance(db,filters,1,now,true).count,3);
 assert.equal(askingPriceGuidance(db,{...filters,model:''},1,now),null);
 assert.equal(askingPriceGuidance(db,{...filters,condition:'excellent'},1,now),null);
 db.close();
});

test('every condition counts toward the sample, not just the seller\'s own',()=>{
 // Deliberate trade: the condition-matched sample was empty for most sellers,
 // and no guidance helps nobody. The cost — a new phone priced against
 // repaired ones — is stated in the client copy, not hidden here.
 const {db,add}=fixture();
 add({condition:'new'});add({condition:'used'});add({condition:'repaired'});add({condition:'refurbished'});
 const r=askingPriceGuidance(db,filters,1,now);
 assert.equal(r.count,4);
 assert.equal(r.conditions_pooled,true,'the client must be told the sample is mixed');
 db.close();
});

test('the window is 90 days, and 91 is still out',()=>{
 const {db,add}=fixture();
 add({created_at:now-89*86400000});add({created_at:now-90*86400000+1000});add({created_at:now-30*86400000});
 add({created_at:now-91*86400000});
 const r=askingPriceGuidance(db,filters,1,now);
 assert.equal(r.count,3);
 assert.equal(r.window_days,90);
 db.close();
});
