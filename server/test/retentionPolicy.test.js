import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { notificationPreferences,saveNotificationPreferences,reserveRetention,retentionExperimentReport } from '../src/retentionPolicy.js';
const timestamp=Date.parse('2026-09-06T10:00:00+03:00');
function fixture() {
 const db=new Database(':memory:');
 db.exec(`CREATE TABLE notification_preferences(user_id INTEGER PRIMARY KEY,matches INTEGER,prices INTEGER,chat_push INTEGER,seller_summary INTEGER,daily_limit INTEGER,experiment INTEGER,summary_since INTEGER,experiment_since INTEGER,experiment_group TEXT,updated_at INTEGER);
 CREATE TABLE notification_preference_events(user_id INTEGER,created_at INTEGER,preferences_json TEXT);
 CREATE TABLE retention_deliveries(user_id INTEGER,dedupe_key TEXT,kind TEXT,created_at INTEGER,push_requested INTEGER,UNIQUE(user_id,dedupe_key));
 CREATE TABLE user_active_days(user_id INTEGER,day TEXT);
 CREATE TABLE phone_listings(id INTEGER,seller_id INTEGER);
 CREATE TABLE events(listing_id INTEGER,user_id INTEGER,type TEXT,created_at INTEGER);
 CREATE TABLE chats(id INTEGER,seller_id INTEGER,buyer_id INTEGER);
 CREATE TABLE chat_messages(chat_id INTEGER,sender_id INTEGER,created_at INTEGER);`);return db;
}
test('weekly summaries default off, opt-out is immediate, unrelated service notifications still work',()=>{
 const db=fixture();assert.equal(notificationPreferences(db,1).seller_summary,0);
 assert.equal(reserveRetention(db,1,'seller.weekly',{week:1},true,timestamp).deliver,false);
 saveNotificationPreferences(db,1,{matches:false,chat_push:false},timestamp);
 assert.equal(reserveRetention(db,1,'saved_search.match',{listing_id:1},true,timestamp).deliver,false);
 assert.deepEqual(reserveRetention(db,1,'chat.message',{},true,timestamp),{deliver:true,push:false});
 assert.deepEqual(reserveRetention(db,1,'order.shipped',{},true,timestamp),{deliver:true,push:true});db.close();
});
test('shared match deduplication persists across alert kinds and daily cap preserves inbox',()=>{
 const db=fixture();saveNotificationPreferences(db,1,{daily_limit:1},timestamp);
 assert.deepEqual(reserveRetention(db,1,'saved_search.match',{listing_id:1},true,timestamp),{deliver:true,push:true});
 assert.deepEqual(reserveRetention(db,1,'wishlist.match',{listing_id:1},true,timestamp),{deliver:false,push:false});
 assert.deepEqual(reserveRetention(db,1,'price.drop',{listing_id:2,new_price:200000},true,timestamp+7200000),{deliver:true,push:false});
 assert.equal(reserveRetention(db,1,'price.drop',{listing_id:2,new_price:200000},true,timestamp+86400000).deliver,false);db.close();
});
test('Baghdad quiet hours and hourly spacing suppress pushes only',()=>{
 const db=fixture();const night=Date.parse('2026-09-06T22:00:00+03:00');
 assert.deepEqual(reserveRetention(db,1,'price.drop',{listing_id:1,new_price:1},true,night),{deliver:true,push:false});
 assert.equal(reserveRetention(db,2,'price.drop',{listing_id:1,new_price:1},true,timestamp).push,true);
 assert.equal(reserveRetention(db,2,'price.drop',{listing_id:2,new_price:1},true,timestamp+1000).push,false);
 assert.equal(reserveRetention(db,2,'price.drop',{listing_id:3,new_price:1},true,timestamp+3600000).push,true);db.close();
});
test('preferences are validated; experimental assignment is sticky and control only suppresses summaries',()=>{
 const db=fixture();assert.throws(()=>saveNotificationPreferences(db,1,{daily_limit:99},timestamp));
 assert.throws(()=>saveNotificationPreferences(db,1,{matches:'true'},timestamp));
 assert.throws(()=>saveNotificationPreferences(db,1,{experiment:true},timestamp));
 const p=saveNotificationPreferences(db,1,{seller_summary:true,experiment:true},timestamp);
 saveNotificationPreferences(db,1,{experiment:false},timestamp+1);
 const again=saveNotificationPreferences(db,1,{experiment:true},timestamp+2);
 assert.equal(again.experiment_group,p.experiment_group);assert.equal(again.experiment_since,p.experiment_since);
 db.prepare("UPDATE notification_preferences SET experiment_group='control' WHERE user_id=1").run();
 assert.equal(reserveRetention(db,1,'seller.weekly',{week:1},true,timestamp).deliver,false);
 assert.equal(reserveRetention(db,1,'price.drop',{listing_id:1,new_price:1},true,timestamp).deliver,true);db.close();
});
test('cohort metrics exclude incomplete days and preserve opted-out participants',()=>{
 const db=fixture();saveNotificationPreferences(db,1,{seller_summary:true,experiment:true},timestamp);
 db.exec("UPDATE notification_preferences SET experiment_group='summary'; INSERT INTO user_active_days VALUES(1,'2026-09-13')");
 let report=retentionExperimentReport(db,Date.parse('2026-09-13T23:00:00+03:00'))[0];assert.equal(report.d7.eligible,0);
 saveNotificationPreferences(db,1,{seller_summary:false,experiment:false},timestamp+100);
 report=retentionExperimentReport(db,Date.parse('2026-09-14T01:00:00+03:00'))[0];
 assert.equal(report.enrolled,1);assert.equal(report.opted_out,1);assert.equal(report.d7.pct,100);assert.equal(report.d30.pct,null);db.close();
});
