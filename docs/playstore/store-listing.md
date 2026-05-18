# Play Store — Listing copy

Drop-in text for Google Play Console → Main store listing.

---

## App name (max 30 chars)

```
iQ Mobile — سوق الهواتف العراقي
```

(28 chars — fits.)

**Alt if too tight**: `iQ Mobile — سوق الهواتف` (24 chars).

---

## Short description (max 80 chars) — Arabic, primary

```
سوق الهواتف الأول في العراق — بيع وشراء موبايلات جديدة ومستعملة بثقة.
```

(74 chars.)

---

## Full description (max 4000 chars) — Arabic, primary

```
iQ Mobile هو سوق الهواتف الذكية الأكبر في العراق — بيع وشراء الموبايلات
الجديدة والمستعملة من جميع المحافظات في مكان واحد.

✦ تصفّح بلا حساب — افتح التطبيق وابدأ الاطلاع على آلاف الإعلانات فوراً.

✦ تواصل مباشر — اتصل بالبائع أو افتح واتساب من صفحة الإعلان بدون عمولة
أو وسطاء.

✦ نشر إعلانك بثلاث دقائق — اختر الموديل والحالة والسعر، أضف صوراً،
ونشر.

✦ كل المحافظات — بغداد، البصرة، الموصل، أربيل، السليمانية، النجف،
كربلاء، وكل مدن العراق.

✦ كل العلامات — Apple، Samsung، Xiaomi، Realme، Tecno، Huawei، OPPO،
Vivo، OnePlus، Google، Nokia.

✦ مرشحات ذكية — ابحث بالعلامة، الحالة، السعة، المحافظة، وحدود السعر
بخطوات 100,000 د.ع.

✦ ضمان واضح — كل إعلان يوضح إن كان عليه ضمان رسمي، ضمان محل، أو بدون
ضمان.

✦ حسابات للمحلات — المتاجر تعرض صورة لافتة المحل وموقعها على الخريطة
لزيادة الثقة.

✦ بدون كلمة مرور — تسجيل الدخول برقم هاتفك فقط.

✦ بدون عمولة — التواصل مباشر بين البائع والمشتري. لا نأخذ نسبة من
الصفقات.

✦ خصوصية — رقم هاتفك يظهر فقط على إعلاناتك أنت. لا نبيع بيانات
المستخدمين.

افتح التطبيق الآن وانضم لأكبر سوق هواتف في العراق.

---

سياسة الخصوصية: https://iqmobile.org/privacy
الدعم: support@iqmobile.org
```

(~1750 chars — well under the 4000 cap, leaves room to expand.)

---

## Full description — English (optional secondary; Play Console lets
## you add localizations later)

```
iQ Mobile is Iraq's largest phone marketplace — buy and sell new and
used smartphones across all governorates in one place.

✦ Browse without an account — open the app and explore thousands of
listings instantly.

✦ Direct contact — call the seller or open WhatsApp from the listing
page. No commission, no middlemen.

✦ Post a listing in 3 minutes — pick model, condition, price, add
photos, publish.

✦ All governorates — Baghdad, Basra, Mosul, Erbil, Sulaymaniyah,
Najaf, Karbala, and every Iraqi city.

✦ All brands — Apple, Samsung, Xiaomi, Realme, Tecno, Huawei, OPPO,
Vivo, OnePlus, Google, Nokia.

✦ Smart filters — search by brand, condition, storage, governorate,
and price range in 100,000 IQD steps.

✦ Clear warranty info — every listing shows whether it carries an
official warranty, shop warranty, or no warranty.

✦ Shop accounts — stores display their sign image and map location
to build buyer trust.

✦ No password — sign in with your phone number only.

✦ No commission — direct buyer-seller communication. We take no cut
of any sale.

✦ Privacy first — your phone number shows only on your own listings.
We never sell user data.

Download now and join Iraq's biggest phone marketplace.

---

Privacy Policy: https://iqmobile.org/privacy
Support: support@iqmobile.org
```

---

## Categorization

| Field | Value |
|---|---|
| Application type | **App** |
| Category | **Shopping** |
| Tags (up to 5) | Marketplace, Classifieds, Phones, Mobile devices, Iraq |
| Email | support@iqmobile.org *(set up a Gmail or use a forwarder)* |
| Website | https://iqmobile.org |
| Phone | (optional, leave blank for v1) |

---

## Content rating

When you fill the IARC questionnaire in Play Console, the honest answers
for this app are all **No**:

- No violence
- No nudity / sexual content
- No profanity
- No controlled substances
- No gambling
- No location sharing **other than what users opt into when posting a
  shop listing** — disclose this as user-controlled, not automatic
- Users-can-communicate? **Yes** — phone calls + WhatsApp links, but no
  in-app chat. Mention this honestly; Google will rate accordingly.

Expected rating: **Everyone** (3+).

---

## Target audience and content

- **Target age**: 18+ (the app deals with financial transactions
  between private parties; not aimed at minors).
- **Appeals to children?**: No.
- **Ads**: None.
- **In-app purchases**: None (for now — no monetization).

---

## Pricing & distribution

| Field | Value |
|---|---|
| App pricing | **Free** |
| Contains ads | **No** |
| In-app purchases | **No** |
| Countries | **All countries** (or restrict to Iraq + neighbors if you'd
  rather start narrow: Iraq, Jordan, Saudi Arabia, UAE, Kuwait,
  Qatar, Bahrain, Oman, Lebanon, Syria, Egypt, Turkey) |
| Targeting kids? | **No** |
| Government app? | **No** |
| News app? | **No** |
| Covid-19? | **No** |

---

## App access (Play asks: "Can a reviewer log in?")

The app is fully accessible without login for browsing.
For login, our auth is phone-number based with no password — Google
reviewers can't trivially test that. Provide them this answer:

> "Login uses Iraqi phone numbers (07XXXXXXXXX) with no password. For
> review testing, please use the demo number: 07700001234. The app
> issues a JWT immediately without SMS verification (SMS OTP is a
> Phase 2 feature scheduled for after launch)."

Make sure that demo number exists in your prod DB before submitting.

---

## Screenshot ideas (you take these on the phone)

Bundle 4–6 screenshots from the running app. Suggested set:

1. **Browse grid** — full of Apple iPhones, brand rail visible, search bar at top.
2. **Listing detail (Apple iPhone)** — gallery + price + condition chips + the call/whatsapp CTAs prominent.
3. **Post wizard step 0** — brand picker + model field + warranty chips.
4. **Post wizard step 4** — photo upload state with 3+ images already added.
5. **Filter sheet open** — governorate pills + price stepper visible.
6. **Profile screen** — name, stats tiles, menu items (optional).

Each PNG should be 1080×1920 (portrait phone). Take them on your phone,
status bar clean (full battery, no notifications). EAS / Android
auto-fits to other phone dimensions.

If you want, take and AirDrop them to your Mac; I can crop/resize and
add a subtle device frame using Pillow.
