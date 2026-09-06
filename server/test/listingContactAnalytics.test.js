import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { listingContactAnalytics } from '../src/listingContactAnalytics.js';
const DAY=86400000, now=Date.parse('2026-09-10T12:00:00+03:00');
function fixture() {
 const db=new Database(':memory:');
 db.exec(`CREATE TABLE users(id INTEGER,seller_type TEXT);
 CREATE TABLE phone_listings(id INTEGER,seller_id INTEGER,brand TEXT,model TEXT,governorate TEXT,city TEXT,asking_price INTEGER,status TEXT,created_at INTEGER);
 CREATE TABLE events(listing_id INTEGER,type TEXT,user_id INTEGER,created_at INTEGER);
 CREATE TABLE chats(id INTEGER,listing_id INTEGER,buyer_id INTEGER);
 CREATE TABLE chat_messages(chat_id INTEGER,sender_id INTEGER,created_at INTEGER);
 INSERT INTO users VALUES(1,'individual'),(2,'shop');`);
 const listing=(id,age,status='active',seller=1,gov='Baghdad',price=500000)=>db.prepare('INSERT INTO phone_listings VALUES(?,?,?,?,?,?,?,?,?)').run(id,seller,'Apple','14',gov,'',price,status,now-age*DAY);
 const event=(id,type,age,user=9)=>db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(id,type,user,now-age*DAY);
 return {db,listing,event};
}
test('cohort excludes immature and old listings; counts first-week contact only including removed/sold listings',()=>{
 const {db,listing,event}=fixture();
 listing(1,10);listing(2,10,'sold');listing(3,10,'removed');listing(4,3);listing(5,20);listing(6,14);listing(7,7);
 event(1,'contact_call',5);event(2,'contact_whatsapp',3); // exactly 7 days after creation is outside
 event(3,'contact_call',9);event(6,'contact_call',15); // before creation is outside
 const r=listingContactAnalytics(db,now);
 assert.equal(r.summary.eligible,4);assert.equal(r.summary.contacted,2);assert.equal(r.summary.pct,50);
 assert.deepEqual(r.diagnoses.map(r=>r.id),[2,6]); db.close();
});
test('counts buyer messages, not empty chats, seller replies or self contact',()=>{
 const {db,listing,event}=fixture(); for(let i=1;i<=4;i++)listing(i,10);
 db.exec('INSERT INTO chats VALUES(1,1,9),(2,2,9),(3,3,9)');
 const msg=db.prepare('INSERT INTO chat_messages VALUES(?,?,?)');msg.run(1,9,now-9*DAY);msg.run(2,1,now-9*DAY);
 event(4,'contact_call',9,1);
 assert.equal(listingContactAnalytics(db,now).summary.contacted,1);db.close();
});
test('diagnosis uses only first-week non-seller views and respects threshold and segment totals',()=>{
 const {db,listing,event}=fixture();listing(1,10);listing(2,10,'active',2,'Basra',200000);
 for(let i=0;i<25;i++)event(1,'view',5);
 event(2,'view',5,1);event(2,'view',1);event(2,'view',11);
 let r=listingContactAnalytics(db,now);
 assert.equal(r.summary.views_without_contact,1);assert.equal(r.summary.low_views,1);
 assert.equal(r.breakdowns.price.length,2);assert.equal(r.breakdowns.seller_type.length,2);
 assert.equal(r.breakdowns.city.reduce((n,x)=>n+x.eligible,0),r.summary.eligible);
 r=listingContactAnalytics(db,now,{governorate:'Basra',brand:'Apple'});assert.equal(r.summary.eligible,1);
 assert.equal(listingContactAnalytics(db,now,{threshold:50}).summary.views_without_contact,0);
 assert.equal(listingContactAnalytics(db,now,{brand:'Samsung'}).summary.pct,null);db.close();
});
