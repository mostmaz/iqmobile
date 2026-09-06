import React, { useState } from 'react';
import { listingUrl, listingLinkStyle } from '../api';
type Summary = { eligible: number; contacted: number; pct: number | null; low_views: number; views_without_contact: number };
export type FirstContactData = {
  cohort_start: number; cohort_end: number; threshold: number; summary: Summary;
  breakdowns: Record<'city' | 'model' | 'price' | 'seller_type', (Summary & { name: string })[]>;
  diagnoses_total: number;
  diagnoses: { id: number; brand: string; model: string; governorate: string; status: string; views: number; diagnosis: string }[];
};
const date = (t: number) => new Date(t).toLocaleString('en-GB', { timeZone: 'Asia/Baghdad' });
const pct = (n: number | null) => n === null ? 'غير متاح' : `${n}%`;
export function FirstContactPanel({ data }: { data: FirstContactData }) {
  const [dimension, setDimension] = useState<keyof FirstContactData['breakdowns']>('city');
  const s = data.summary;
  return <section className="card">
    <h3>أول تواصل خلال ٧ أيام من إنشاء الإعلان</h3>
    <p className="muted">مجموعة الإنشاء: {date(data.cohort_start)} إلى ما قبل {date(data.cohort_end)} — بتوقيت بغداد. تنتهي المجموعة قبل ٧ أيام لتكتمل فرصة كل إعلان؛ مدة المجموعة تتبع زر الفترة أعلاه.</p>
    <div className="kpi-row">
      <Metric label="نسبة وصول أول تواصل" value={pct(s.pct)} />
      <Metric label="إعلانات مكتملة المدة" value={s.eligible} />
      <Metric label="وصلها تواصل خلال ٧ أيام" value={s.contacted} />
      <Metric label={`بلا تواصل وأقل من ${data.threshold} مشاهدة`} value={s.low_views} />
      <Metric label={`بلا تواصل و${data.threshold} مشاهدة فأكثر`} value={s.views_without_contact} />
    </div>
    <p>المشاهدة القليلة: راجع الظهور ومدى الطلب. المشاهدات الأعلى بلا تواصل: راجع السعر والصور والثقة وملاءمة العرض. هذه احتمالات للفحص وليست أسباباً مثبتة؛ الحد المختار قاعدة تشخيصية وليس معياراً للسوق.</p>
    <p className="muted">التواصل = ضغطة اتصال/واتساب مسجّلة أو رسالة من المشتري؛ فتح محادثة فارغة وردود البائع لا تُحسب. المشاهدات أحداث وليست أشخاصاً فريدين، وقد يتكرر الزائر. نستبعد نشاط البائع المعروف. ضعف التتبّع في الإصدارات القديمة قد يظهر كضعف طلب.</p>
    <p className="muted">نعتمد تاريخ إنشاء السجل المتاح، وليس تاريخ نشر مستقلاً؛ الاستيراد وتأخر الموافقة قد يؤثران على المقارنة. تشمل المجموعة الحالات الحالية المباعة والمنتهية والمحذوفة لتجنب انتقاء الإعلانات الباقية فقط. المدينة والسعر ونوع البائع هي القيم الحالية. التواصل ليس بيعاً.</p>
    <label>تقسيم النتائج <select value={dimension} onChange={e => setDimension(e.target.value as typeof dimension)}>
      <option value="city">المحافظة والمدينة</option><option value="model">موديل الهاتف</option><option value="price">نطاق السعر</option><option value="seller_type">نوع البائع</option>
    </select></label>
    {s.eligible === 0 ? <p className="empty">لا توجد إعلانات مكتملة المدة ضمن هذه المجموعة والفلاتر.</p> : <div style={{ overflowX: 'auto', maxHeight: 420 }}>
      <table className="data-table"><thead><tr><th>الفئة</th><th>المؤهلة</th><th>وصلها تواصل</th><th>النسبة</th><th>مشاهدات قليلة بلا تواصل</th><th>مشاهدات أعلى بلا تواصل</th></tr></thead>
        <tbody>{data.breakdowns[dimension].map(r => <tr key={r.name}><td>{r.name}</td><td>{r.eligible}</td><td>{r.contacted}</td><td>{pct(r.pct)}</td><td>{r.low_views}</td><td>{r.views_without_contact}</td></tr>)}</tbody>
      </table></div>}
    <h4>إعلانات لم يصلها تواصل خلال أيامها السبعة الأولى ({data.diagnoses.length} من {data.diagnoses_total})</h4>
    <p className="muted">الأعلى مشاهدة أولاً؛ قد يكون وصلها تواصل بعد اليوم السابع. راجع الحالة الحالية قبل اتخاذ إجراء.</p>
    <div style={{ overflowX: 'auto', maxHeight: 420 }}><table className="data-table">
      <thead><tr><th>الإعلان</th><th>المحافظة</th><th>الحالة الحالية</th><th>مشاهدات أول ٧ أيام</th><th>ما يستحق الفحص</th></tr></thead>
      <tbody>{data.diagnoses.map(r => <tr key={r.id}><td><a href={listingUrl(r.id)} target="_blank" rel="noreferrer" style={listingLinkStyle}>{r.brand} {r.model} #{r.id}</a></td><td>{r.governorate}</td><td>{r.status}</td><td>{r.views}</td><td>{r.diagnosis === 'low_views' ? 'الظهور والطلب والتتبّع' : 'السعر والصور والثقة والتتبّع'}</td></tr>)}</tbody>
    </table></div>
  </section>;
}
function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="card kpi"><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div></div>;
}
