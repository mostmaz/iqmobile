import { queryTokens } from './searchNormalize.js';
// Deliberately limited: repair brand spelling, never guess model identifiers.
const SPELLINGS = { reaalme: 'realme', realmi: 'realme', relme: 'realme', samsng: 'samsung', samung: 'samsung', iphon: 'iphone', xiomi: 'xiaomi' };
export function canonicalSearch(raw) {
  return queryTokens(raw).map(t => SPELLINGS[t] || t).join(' ').replace(/\bg t(?=\d|\b)/g, 'gt').replace(/ريد (?:ماجيك|ماجك|magic)/g, 'redmagic').replace(/(?:ون|one) (?:بلس|plus)/g, 'oneplus');
}
function oneEdit(a,b) {
  if (Math.abs(a.length-b.length)>1) return false;
  let i=0,j=0,edits=0;
  while(i<a.length && j<b.length) {
    if(a[i]===b[j]) { i++;j++;continue; }
    if(++edits>1) return false;
    if(a.length>=b.length)i++; if(b.length>=a.length)j++;
  }
  return edits+(i<a.length || j<b.length ? 1:0)<=1;
}
export function suggestionsFor(raw, candidates) {
  const q = canonicalSearch(raw); const tokens = q.split(' ').filter(Boolean);
  if (q.length < 3) return [];
  const numbers = q.match(/\d+/g) || [];
  return candidates.filter(c => {
    const name = canonicalSearch(`${c.brand} ${c.model}`);
    const digits = name.match(/\d+/g) || [];
    if (numbers.some(n => !digits.includes(n))) return false;
    return tokens.every(t => name.replace(/\s/g,'').includes(t) || (/^[a-z]{4,}$/.test(t) && name.split(' ').some(w => oneEdit(t,w)))) && name !== q;
  }).slice(0,5).map(c => `${c.brand} ${c.model}`);
}
export function searchQuality(db, since, timestamp) {
  const summary=db.prepare(`SELECT COUNT(*) AS submitted, COUNT(result_count) AS measured,
    COALESCE(SUM(result_count=0),0) AS zero_results FROM events WHERE type='search_submit' AND created_at>=?`).get(since);
  const previews=db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='search_preview' AND created_at>=?").get(since).n;
  const legacy=db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='search' AND created_at>=?").get(since).n;
  // Subsequent activity is a temporal association, not proof of search attribution.
  const outcomes=db.prepare(`WITH searches AS (
    SELECT s.*, MIN(s.created_at+1800000, COALESCE((SELECT MIN(n.created_at) FROM events n
      WHERE n.type='search_submit' AND n.user_id=s.user_id AND n.created_at>s.created_at),s.created_at+1800000)) AS until_at
    FROM events s WHERE s.type='search_submit' AND s.user_id IS NOT NULL AND s.created_at>=? AND s.created_at<=?
  ) SELECT COUNT(*) AS eligible,
    COALESCE(SUM(EXISTS(SELECT 1 FROM events e WHERE e.user_id=s.user_id AND e.type='view' AND e.created_at>s.created_at AND e.created_at<s.until_at)),0) AS viewed,
    COALESCE(SUM(EXISTS(SELECT 1 FROM events e WHERE e.user_id=s.user_id AND e.type IN ('contact_call','contact_whatsapp') AND e.created_at>s.created_at AND e.created_at<s.until_at)
      OR EXISTS(SELECT 1 FROM chat_messages m JOIN chats c ON c.id=m.chat_id WHERE m.sender_id=s.user_id AND c.buyer_id=s.user_id AND c.seller_id<>s.user_id AND m.created_at>s.created_at AND m.created_at<s.until_at)),0) AS contacted
    FROM searches s`).get(since,timestamp-1800000);
  return {...summary, previews, legacy, zero_pct:summary.measured ? Math.round(summary.zero_results/summary.measured*1000)/10:null, outcomes};
}
