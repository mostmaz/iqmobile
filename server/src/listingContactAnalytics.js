const DAY = 86400000;
export function listingContactAnalytics(db, timestamp, { days = 7, governorate = null, brand = null, threshold = 25 } = {}) {
  const end = timestamp - 7 * DAY;
  const start = end - days * DAY;
  const rows = db.prepare(`SELECT l.id, l.brand, l.model, l.governorate, l.city, l.asking_price,
    l.status, l.created_at, u.seller_type,
    (SELECT COUNT(*) FROM events e WHERE e.listing_id=l.id AND e.type='view'
      AND (e.user_id IS NULL OR e.user_id<>l.seller_id)
      AND e.created_at>=l.created_at AND e.created_at<l.created_at+604800000) AS views,
    (SELECT MIN(e.created_at) FROM events e WHERE e.listing_id=l.id
      AND e.type IN ('contact_call','contact_whatsapp')
      AND (e.user_id IS NULL OR e.user_id<>l.seller_id)
      AND e.created_at>=l.created_at AND e.created_at<l.created_at+604800000) AS tap_at,
    (SELECT MIN(m.created_at) FROM chats c JOIN chat_messages m ON m.chat_id=c.id
      WHERE c.listing_id=l.id AND m.sender_id=c.buyer_id AND c.buyer_id<>l.seller_id
      AND m.created_at>=l.created_at AND m.created_at<l.created_at+604800000) AS message_at
    FROM phone_listings l JOIN users u ON u.id=l.seller_id
    WHERE l.created_at>=@start AND l.created_at<@end
      AND (@gov IS NULL OR l.governorate=@gov) AND (@brand IS NULL OR l.brand=@brand)
    ORDER BY l.created_at DESC, l.id DESC`).all({ start, end, gov: governorate, brand });
  const listings = rows.map(({ tap_at, message_at, ...row }) => {
    const contacts = [tap_at, message_at].filter(t => t !== null);
    const first_contact_at = contacts.length ? Math.min(...contacts) : null;
    return { ...row, first_contact_at, diagnosis: first_contact_at !== null ? 'contacted' : row.views < threshold ? 'low_views' : 'views_without_contact' };
  });
  const summarize = group => {
    const contacted = group.filter(r => r.first_contact_at !== null).length;
    return { eligible: group.length, contacted, pct: group.length ? Math.round(contacted / group.length * 1000) / 10 : null,
      low_views: group.filter(r => r.diagnosis === 'low_views').length,
      views_without_contact: group.filter(r => r.diagnosis === 'views_without_contact').length };
  };
  const groupBy = key => {
    const groups = new Map();
    for (const row of listings) { const name = key(row); if (!groups.has(name)) groups.set(name, []); groups.get(name).push(row); }
    return [...groups].map(([name, group]) => ({ name, ...summarize(group) })).sort((a,b) => b.eligible-a.eligible || a.name.localeCompare(b.name));
  };
  const priceBand = r => r.asking_price <= 1 ? 'سعر عند الطلب / غير معروف' : r.asking_price < 250000 ? 'أقل من 250,000 د.ع' : r.asking_price < 500000 ? '250,000–499,999 د.ع' : r.asking_price < 1000000 ? '500,000–999,999 د.ع' : '1,000,000 د.ع فأكثر';
  const noContact = listings.filter(r => r.first_contact_at === null).sort((a,b) => b.views-a.views || a.id-b.id);
  return { cohort_start: start, cohort_end: end, threshold, summary: summarize(listings),
    breakdowns: { city: groupBy(r => `${r.governorate} · ${r.city || 'مدينة غير محددة'}`),
      model: groupBy(r => `${r.brand} ${r.model}`), price: groupBy(priceBand), seller_type: groupBy(r => r.seller_type || 'unknown') },
    diagnoses: noContact.slice(0,100), diagnoses_total: noContact.length };
}
