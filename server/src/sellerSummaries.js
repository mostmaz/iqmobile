import { db } from './db.js';
import { notify } from './notify.js';
const WEEK=7*86400000;
export function sellerSummary(db,userId,timestamp) {
 const since=timestamp-WEEK;
 const active=db.prepare("SELECT COUNT(*) AS n FROM phone_listings WHERE seller_id=? AND status='active'").get(userId).n;
 const views=db.prepare(`SELECT COUNT(*) AS n FROM events e JOIN phone_listings l ON l.id=e.listing_id
  WHERE l.seller_id=? AND l.status='active' AND e.type='view' AND e.created_at>=? AND (e.user_id IS NULL OR e.user_id<>?)`).get(userId,since,userId).n;
 const contacted=db.prepare(`SELECT COUNT(*) AS n FROM (
  SELECT l.id FROM events e JOIN phone_listings l ON l.id=e.listing_id WHERE l.seller_id=@id AND l.status='active'
   AND e.type IN ('contact_call','contact_whatsapp') AND e.created_at>=@since AND (e.user_id IS NULL OR e.user_id<>@id)
  UNION SELECT l.id FROM chat_messages m JOIN chats c ON c.id=m.chat_id JOIN phone_listings l ON l.id=c.listing_id
   WHERE l.seller_id=@id AND l.status='active' AND m.sender_id=c.buyer_id AND m.sender_id<>@id AND m.created_at>=@since
 )`).get({id:userId,since}).n;
 return {active,views,contacted,without_contact:active-contacted};
}
export function sendSellerSummaries(timestamp=Date.now()) {
 const hour=new Date(timestamp+10800000).getUTCHours();
 if(hour<9 || hour>=21)return;
 const eligible=db.prepare(`SELECT p.user_id FROM notification_preferences p WHERE p.seller_summary=1
  AND p.summary_since<=? AND NOT(p.experiment=1 AND p.experiment_group='control')
  AND EXISTS(SELECT 1 FROM phone_listings l WHERE l.seller_id=p.user_id AND l.status='active')
  AND NOT EXISTS(SELECT 1 FROM retention_deliveries d WHERE d.user_id=p.user_id AND d.kind='seller.weekly' AND d.created_at>?)
  ORDER BY p.user_id LIMIT 100`).all(timestamp-WEEK,timestamp-WEEK);
 for(const {user_id} of eligible) {
  const stats=sellerSummary(db,user_id,timestamp);
  const body=`إعلاناتك النشطة: ${stats.active} · مشاهدات آخر ٧ أيام: ${stats.views} · إعلانات وصلها تواصل: ${stats.contacted}. راجع إعلاناتك لتحديث السعر والصور عند الحاجة.`;
  notify(user_id,'seller.weekly',{...stats,week:Math.floor(timestamp/WEEK),body},{title:'ملخص أداء إعلاناتك الأسبوعي',body});
 }
}
