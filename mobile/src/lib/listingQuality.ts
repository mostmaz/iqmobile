export type ListingQualityDraft = {
  brand: string; model: string; condition: string; description: string; images: string[];
  /**
   * The structured answers, if the wizard collected any. A field answered
   * here silences its prose rule below — asking someone to describe the
   * screen in words after they have just picked an answer about the screen
   * is the app not listening, and it is the reason those three nags were the
   * most ignored things on the form.
   */
  conditionDetails?: Record<string, string>;
};
export type ListingQualityIssue = { id: string; step: number; title: string; advice: string };
const normalize = (value: string) => value.trim().toLowerCase().replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[ـً-ْ]/g,'').replace(/\s+/g,' ');
// Completeness hints only. Do not infer defects or factual truth from prose.
//
// screen/body/repairs point at step 1, not step 2. They used to send the
// seller to the DESCRIPTION, because prose was the only way to answer them;
// since #7 there are fixed answers on step 1 and that is where the fix now
// lives. A "تعديل" that lands on the wrong screen is worse than none.
export function listingQuality(draft: ListingQualityDraft): ListingQualityIssue[] {
 const issues: ListingQualityIssue[]=[];
 const photoCount=new Set(draft.images.filter(Boolean)).size;
 if(photoCount<3)issues.push({id:'photos',step:4,title:`أضف ${3-photoCount} صور مختلفة لإكمال الحد الأدنى`,advice:'صوّر واجهة الجهاز وظهره والجوانب بإضاءة واضحة. أظهر الخدوش أو الكسور إن وجدت، وأخفِ الأرقام التسلسلية والمعلومات الشخصية.'});
 if(photoCount<draft.images.length)issues.push({id:'duplicate-selection',step:4,title:'اخترت الصورة نفسها أكثر من مرة',advice:'استبدل النسخة المكررة بصورة من زاوية أخرى. هذا الفحص يكتشف تكرار الملف المختار فقط، وليس تشابه محتوى الصور.'});
 const model=normalize(draft.model),brand=normalize(draft.brand);
 if(!model || model===brand || /^(?:جهاز|هاتف|موبايل|تلفون|تليفون|ايفون|سامسونج|هونر|ريلمي|iphone|samsung|honor|realme|phone|mobile|other|جديد|نظيف|مستعمل)$/.test(model)) {
  issues.push({id:'model',step:0,title:'اكتب اسم الموديل كاملاً',advice:'اختر الموديل من القائمة أو انسخه من «حول الجهاز» في الإعدادات، مثل iPhone 13 Pro أو Galaxy A55. لا تضع رقم الهاتف أو عبارة «جهاز نظيف» مكان الموديل.'});
 }
 const answered=new Set(Object.keys(draft.conditionDetails||{}));
 const description=normalize(draft.description);
 if(!description || /^(?:نظيف|مثل الجديد|جديد|ممتاز|مستعمل|used|new|clean|excellent)[.!،\s]*$/.test(description)) {
  issues.push({id:'description',step:2,title:'أضف وصفاً محدداً لحالة الجهاز',advice:draft.condition==='new'?'اذكر هل العلبة مختومة أم مفتوحة، وهل الجهاز فُعّل أو استُخدم.':'عبارة «نظيف» وحدها لا تكفي للمشتري. اذكر حالة الشاشة والهيكل، وهل أُصلح الجهاز أو بُدلت أجزاء منه. إذا لم تعرف، اذكر أن المعلومة غير معروفة.'});
 }
 if(draft.condition==='new') {
  if(!/(مختوم|مفتوح|علب|كارتون|تفعيل|مفعل|sealed|unopened|opened|box|activat)/.test(description))issues.push({id:'new-condition',step:2,title:'وضّح حالة العلبة والتفعيل',advice:'اذكر إن كانت العلبة مختومة أو مفتوحة، وهل الجهاز مفعّل. لا تصفه بأنه مختوم إذا لم تتأكد.'});
 } else {
  if(!/(شاش|زجاج|عرض|لمس|screen|display|touch|glass)/.test(description))answered.has('screen')||issues.push({id:'screen',step:1,title:'وضّح حالة الشاشة',advice:'اذكر الخدوش أو الكسور وأي مشكلة في اللمس أو العرض، أو اكتب أنها بلا عيوب ظاهرة إذا كان ذلك صحيحاً.'});
  if(!/(هيكل|ظهر|حاف|جوانب|اطار|خدش|خدوش|شخط|شخوط|body|back|frame|scratch|dent)/.test(description))answered.has('body')||issues.push({id:'body',step:1,title:'وضّح حالة الهيكل',advice:'اذكر حالة الظهر والحواف وأماكن الخدوش أو الضربات، وأرفق صورة واضحة لها.'});
  if(!/(تصليح|صلح|اصلاح|صيانه|تبديل|تبدل|مبدل|مغير|تغيير|repair|replac|refurb)/.test(description))answered.has('repairs')||issues.push({id:'repairs',step:1,title:'اذكر تاريخ الإصلاح أو تبديل الأجزاء',advice:draft.condition==='repaired'||draft.condition==='refurbished'?'اخترت جهازاً مصلحاً أو مجدداً: اذكر الجزء المصلح أو المبدل وأي عيب باقٍ. إن لم تعرف التفاصيل، قل ذلك بوضوح.':'اذكر إن أُصلح الجهاز أو بُدلت الشاشة أو البطارية. إذا لم تعرف تاريخه، اكتب «تاريخ الإصلاح غير معروف».'});
 }
 return issues;
}
