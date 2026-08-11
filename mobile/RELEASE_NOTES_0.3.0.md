# iQ Mobile 0.3.0 — release notes

Android `versionCode` 44 · iOS `buildNumber` 26

Copy the blocks below straight into the stores. Play Store "What's new" has a
**500-character limit per language** and the Arabic block is written to fit it;
App Store release notes have no practical limit, so the longer Arabic block is
for there.

---

## Play Store — Arabic (ar) · "ما الجديد"

```
تحسينات كبيرة على التطبيق:

• السعر: إذا كتبت 500 نفهم أنك تقصد 500,000 دينار
• البحث: اكتب السعر مباشرة بدل الضغط عليه، وفلتر «المتوفر للبيع فقط»
• المحادثات: آخر رسالة، وقتها، وعدد الرسائل غير المقروءة
• الإشعارات: تواريخ أوضح، وتخبرك عن أي طلب بالضبط
• المتجر: وقت التوصيل، السلة تصلها من أي صفحة، وأزرار أوضح
• إصلاح ظهور بعض الكلمات العربية ناقصة
• أسماء الأجهزة لم تعد تُقطع في القائمة
• إصلاح مشكلة كانت تمنع الرجوع بين الصفحات
```

*(478 characters — fits.)*

## Play Store — English (en-US) · "What's new"

```
A big round of fixes and polish:

• Prices: type 500 and we understand 500,000 IQD
• Filters: type a price bound directly, and show only what's available
• Chats: last message, time, and unread counts
• Notifications: readable dates, and they name the order
• Store: delivery time, cart reachable from anywhere, clearer buttons
• Fixed Arabic words rendering with letters missing
• Device names no longer cut off in the feed
• Fixed a bug that could block back navigation
```

---

## App Store — Arabic · "الجديد في هذا الإصدار"

```
هذا التحديث يركز على إصلاح ما كان يزعجك أثناء الاستخدام.

الأسعار
• إذا كتبت 500 للجهاز نفهم أنك تقصد 500,000 دينار — ما عاد يظهر جهاز بسعر خطأ في أعلى نتائج البحث.

البحث والفلاتر
• اكتب السعر الذي تريده مباشرة بدل الضغط على + و − عشرات المرات.
• فلتر جديد: «المتوفر للبيع فقط» يخفي المباع والمنتهي.
• حالة «مصلّح» صارت موجودة في الفلتر مثل بقية الحالات.

المحادثات
• كل محادثة تعرض آخر رسالة ووقتها وعدد الرسائل غير المقروءة.

الإشعارات
• التواريخ صارت مفهومة («قبل ساعتين» بدل تاريخ طويل)، والإشعار يخبرك عن أي طلب بالضبط.

متجر iQ
• وقت التوصيل صار مكتوباً، مو السعر فقط.
• السلة تصلها من الصفحة الرئيسية مباشرة.
• «اشترِ الآن» و«إضافة للسلة» صار الفرق بينهما واضح.

إضافة إعلان
• اللون صار اختيارات جاهزة بدل الكتابة الحرة.
• صحة البطارية تقبل من 1 إلى 100 فقط.
• رقم هاتفك يُملأ تلقائياً.
• رسائل الخطأ صارت تقول أي حقل ناقص بالضبط.

إصلاحات
• بعض الكلمات العربية كانت تظهر ناقصة حرفاً أو كلمة — تم إصلاحها.
• أسماء الأجهزة ما عادت تُقطع في القائمة.
• مشكلة كانت تمنع الرجوع بين الصفحات وتضطرك لإغلاق التطبيق.
• تكبير الخط من إعدادات الهاتف ما عاد يقص النصوص.
• أحجام الأزرار والتباين صارت أوضح لمن يحتاجها.
```

## App Store — English · "What's New"

```
This update is about fixing what got in your way.

Prices
• Type 500 for a phone and we read it as 500,000 IQD, so mispriced listings stop landing at the top of every price search.

Search and filters
• Type a price bound directly instead of tapping + and − dozens of times.
• New filter: show only what's actually for sale, hiding sold and expired.
• "Repaired" condition is now filterable like every other condition.

Chats
• Every conversation shows its last message, when it arrived, and how many are unread.

Notifications
• Readable dates, and each one names the order it's about.

iQ Store
• Delivery time is stated, not just delivery cost.
• The cart is reachable from the home screen, not only from inside the store.
• "Buy now" and "Add to cart" are no longer identical in weight.

Posting a listing
• Colour is now a set of choices instead of free text.
• Battery health accepts 1-100 only.
• Your phone number is filled in automatically.
• Errors name the field that's actually missing.

Fixes
• Some Arabic words rendered with a letter or word missing. Fixed.
• Device names are no longer truncated in the feed.
• Fixed a bug that could block back navigation until the app was force-stopped.
• Large system font sizes no longer clip text.
• Larger touch targets and better contrast.
```

---

## Submission checklist

1. **Android** — `versionCode` must be **44** (43 is already on Play).
   Build: `cd mobile/android && SENTRY_DISABLE_AUTO_UPLOAD=true ./gradlew :app:bundleRelease`
   Output: `mobile/android/app/build/outputs/bundle/release/app-release.aab`
   ⚠️ Upload will be rejected until the Play **upload key reset** is finished —
   check the Play Console for the pending request before uploading.
2. **iOS** — `buildNumber` must be **26**.
   Build: `cd mobile && npx eas-cli build --platform ios --profile production`
   Then submit: `npx eas-cli submit --platform ios --latest`
   (Requires signing in to App Store Connect — do this yourself; the API key
   is not configured in this repo.)
3. Set the release notes above per-language in both consoles.
4. Screenshots do **not** need updating — no screen changed shape enough to
   invalidate the current set.
