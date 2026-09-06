import { createHash } from 'node:crypto';
export function notificationPreferences(db,userId) {
 return db.prepare('SELECT * FROM notification_preferences WHERE user_id=?').get(userId) ||
  {user_id:userId,matches:1,prices:1,chat_push:1,seller_summary:0,daily_limit:3,experiment:0,summary_since:null,experiment_since:null,experiment_group:null};
}
export function saveNotificationPreferences(db,userId,input,timestamp) {
 const keys=['matches','prices','chat_push','seller_summary','experiment'];
 if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(k=>![...keys,'daily_limit'].includes(k))) throw new Error('invalid_preferences');
 for(const key of keys) if(key in input && typeof input[key]!=='boolean') throw new Error('invalid_preferences');
 if('daily_limit' in input && ![1,3,5].includes(input.daily_limit)) throw new Error('invalid_preferences');
 return db.transaction(()=>{
  const old=notificationPreferences(db,userId); const next={...old};
  for(const key of keys) if(key in input)next[key]=Number(input[key]);
  if('daily_limit' in input)next.daily_limit=input.daily_limit;
  if(next.seller_summary && !old.seller_summary)next.summary_since=timestamp;
  if(!next.seller_summary)next.summary_since=null;
  if(next.experiment && !next.seller_summary)throw new Error('summary_required');
  if(next.experiment && !old.experiment_since) {
   next.experiment_since=timestamp;
   next.experiment_group=createHash('sha256').update(`seller-summary-v1:${userId}`).digest()[0]%2 ? 'summary' : 'control';
  }
  // Keep assignment/enrollment after opting out for intention-to-treat reporting.
  db.prepare(`INSERT INTO notification_preferences(user_id,matches,prices,chat_push,seller_summary,daily_limit,experiment,summary_since,experiment_since,experiment_group,updated_at)
   VALUES(@user_id,@matches,@prices,@chat_push,@seller_summary,@daily_limit,@experiment,@summary_since,@experiment_since,@experiment_group,@updated_at)
   ON CONFLICT(user_id) DO UPDATE SET matches=excluded.matches,prices=excluded.prices,chat_push=excluded.chat_push,
   seller_summary=excluded.seller_summary,daily_limit=excluded.daily_limit,experiment=excluded.experiment,summary_since=excluded.summary_since,
   experiment_since=excluded.experiment_since,experiment_group=excluded.experiment_group,updated_at=excluded.updated_at`).run({...next,updated_at:timestamp});
  db.prepare('INSERT INTO notification_preference_events(user_id,created_at,preferences_json) VALUES(?,?,?)').run(userId,timestamp,JSON.stringify(input));
  return notificationPreferences(db,userId);
 })();
}
// Atomically reserve a single inbox notification and its push budget. Push
// requests are attempts, not provider-confirmed delivery. Quiet/capped alerts
// remain in the inbox and are not replayed as a burst later.
export function reserveRetention(db,userId,kind,payload,wantsPush,timestamp) {
 const pref=notificationPreferences(db,userId);
 if(kind==='chat.message')return {deliver:true,push:wantsPush && !!pref.chat_push};
 const category=kind==='saved_search.match'||kind==='wishlist.match'?'matches':kind==='price.drop'?'prices':kind==='seller.weekly'?'seller_summary':null;
 if(!category)return {deliver:true,push:wantsPush};
 if(!pref[category])return {deliver:false,push:false};
 if(kind==='seller.weekly' && pref.experiment && pref.experiment_group==='control')return {deliver:false,push:false};
 const key=kind==='seller.weekly'?`summary:${payload.week}`:`${category==='matches'?'match':kind}:${payload.listing_id}:${kind==='price.drop'?payload.new_price:''}`;
 return db.transaction(()=>{
  if(db.prepare('SELECT 1 FROM retention_deliveries WHERE user_id=? AND dedupe_key=?').get(userId,key))return {deliver:false,push:false};
  const day=new Date(timestamp+10800000).toISOString().slice(0,10);
  const dayStart=Date.parse(`${day}T00:00:00+03:00`);
  const stats=db.prepare('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM retention_deliveries WHERE user_id=? AND push_requested=1 AND created_at>=?').get(userId,dayStart);
  const hour=new Date(timestamp+10800000).getUTCHours();
  const push=!!wantsPush && hour>=9 && hour<21 && stats.n<pref.daily_limit && (!stats.last || timestamp-stats.last>=3600000);
  db.prepare('INSERT INTO retention_deliveries(user_id,dedupe_key,kind,created_at,push_requested) VALUES(?,?,?,?,?)').run(userId,key,kind,timestamp,Number(push));
  return {deliver:true,push};
 })();
}

export function retentionExperimentReport(db,timestamp) {
 const today=new Date(timestamp+10800000).toISOString().slice(0,10);
 return ['summary','control'].map(group=>{
  const participants=db.prepare(`SELECT user_id,experiment_since,experiment,seller_summary FROM notification_preferences
   WHERE experiment_since IS NOT NULL AND experiment_group=?`).all(group);
  const result={group,enrolled:participants.length,opted_out:participants.filter(p=>!p.experiment||!p.seller_summary).length,
   d7:{eligible:0,returned:0,pct:null},d30:{eligible:0,returned:0,pct:null},contacted_7d:0};
  for(const p of participants) {
   const day=new Date(p.experiment_since+10800000).toISOString().slice(0,10);
   for(const n of [7,30]) {
    const target=new Date(Date.parse(`${day}T00:00:00Z`)+n*86400000).toISOString().slice(0,10);
    if(target>=today)continue;
    const metric=result[`d${n}`];metric.eligible++;
    if(db.prepare('SELECT 1 FROM user_active_days WHERE user_id=? AND day=?').get(p.user_id,target))metric.returned++;
    if(n===7) {
     const contact=db.prepare(`SELECT 1 FROM events e JOIN phone_listings l ON l.id=e.listing_id
      WHERE l.seller_id=@id AND e.type IN ('contact_call','contact_whatsapp') AND (e.user_id IS NULL OR e.user_id<>@id)
       AND e.created_at>=@start AND e.created_at<@end
      UNION ALL SELECT 1 FROM chat_messages m JOIN chats c ON c.id=m.chat_id WHERE c.seller_id=@id AND m.sender_id=c.buyer_id AND m.sender_id<>@id
       AND m.created_at>=@start AND m.created_at<@end LIMIT 1`).get({id:p.user_id,start:p.experiment_since,end:p.experiment_since+7*86400000});
     if(contact)result.contacted_7d++;
    }
   }
  }
  for(const key of ['d7','d30']) { const m=result[key];m.pct=m.eligible?Math.round(m.returned/m.eligible*1000)/10:null; }
  return result;
 });
}
