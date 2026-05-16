# IQ Mobile — Single-City Launch Marketing Roadmap

**Launch city:** Baghdad (default — Iraq's largest second-hand-phone market, anchored by Sinak / Karrada electronics streets).
**Today:** Saturday, 2026-05-16.
**Public launch day:** Saturday, 2026-07-11 (8 weeks out, weekend in Iraq, ahead of Eid Al-Adha season buying).
**Anchor message (Arabic / English):**
- AR: «بيع و اشتري موبايل بأمان. ما تنطي رقمك إلا بعد ما تتفق على السعر.»
- EN: "Buy and sell phones safely in Baghdad. Your number stays private until both sides agree on a price."

---

## Why one city first

- Tight feedback loop with sellers in one physical market (Sinak, Karrada, Bab Al-Sharqi).
- Liquidity matters more than reach: 200 listings in Baghdad beats 2,000 listings spread across Iraq.
- Influencers, ad spend, field team and support all stay in one timezone and one dialect.
- Cheaper to repeat the playbook in Basra / Erbil / Mosul once Baghdad is proven.

---

## Phase calendar (anchored to 2026-07-11 launch)

| Phase                    | Window                       | Outcome                                                       |
|--------------------------|------------------------------|---------------------------------------------------------------|
| 0. Foundations           | **May 16 – May 30** (W-8/W-7)| Brand kit, landing page, analytics, legal, support handles    |
| 1. Content production    | **May 31 – Jun 13** (W-6/W-5)| All photo & video assets shot and edited                      |
| 2. Seeding & beta        | **Jun 14 – Jun 27** (W-4/W-3)| 150+ seeded listings, 50 closed-beta users, bugs hammered     |
| 3. Hype                  | **Jun 28 – Jul 10** (W-2/W-1)| Teasers, influencers, waitlist, shop partnerships             |
| 4. Launch week           | **Jul 11 – Jul 17**          | Public release, paid push, PR, launch event                   |
| 5. Activation            | **Jul 18 – Aug 14** (W+1/W+4)| First 1,000 deals, retention loops, referral program          |
| 6. Scale-in-city         | **Aug 15 – Oct 10**          | Category expansion, paid scaling, prep for second city        |

---

## Phase 0 — Foundations (May 16 – May 30)

| Date        | Owner         | Deliverable                                                                 |
|-------------|---------------|------------------------------------------------------------------------------|
| Mon May 18  | Founder       | Lock launch city + final positioning line (AR + EN)                          |
| Tue May 19  | Designer      | Logo lockup, color palette, Arabic & Latin type pairing, app icon variants   |
| Wed May 20  | Designer      | Story / post / reel templates (9:16, 1:1, 4:5) in Figma                      |
| Thu May 21  | Dev           | Landing page `iqmobile.iq` with waitlist email + WhatsApp opt-in             |
| Fri May 22  | Dev           | Pixel / GA4 / TikTok Pixel / Meta CAPI installed; UTM scheme documented      |
| Sat May 23  | Ops           | Register social handles: `@iqmobile.iq` on Instagram, TikTok, Facebook, X, YouTube, Telegram channel, Snapchat |
| Sun May 24  | Ops           | WhatsApp Business number + auto-reply; support inbox `salam@iqmobile.iq`     |
| Mon May 25  | Legal         | Terms, privacy, prohibited-items policy (Arabic primary)                     |
| Wed May 27  | Founder       | Sign 2 photographers / 1 videographer in Baghdad for Phase 1 shoot           |
| Fri May 29  | Marketing     | Influencer long-list (30 names) across tech, lifestyle, comedy               |
| Sat May 30  | Team          | Phase 0 review — go/no-go for content shoot                                  |

---

## Phase 1 — Content production (May 31 – Jun 13)

All assets are shot in Baghdad with local talent and local landmarks so the audience instantly recognises the city.

### Photo shoot plan (3 shoot days)

**Shoot Day 1 — Sun May 31 — Sinak phone market (morning, golden hour)**
- Wide shots of Sinak phone alleys.
- Seller portraits holding phones at their shop (signed releases).
- Phone-in-hand product shots on real shop tables (used iPhones, Samsung, Xiaomi).
- Hands-exchanging-phone composition (the moment the deal closes).
- Asset count: 60 raw → 25 finals.

**Shoot Day 2 — Tue Jun 2 — Karrada cafés + Abu Nuwas street**
- Lifestyle: young couple browsing the app, student selling old phone.
- App-on-screen mockups against Baghdad backgrounds (Al-Mutanabbi, Karrada lights at dusk).
- Female-buyer angle (important and under-represented in Iraqi phone-sale ads): woman safely chatting in-app without exposing her number.
- Asset count: 40 raw → 18 finals.

**Shoot Day 3 — Thu Jun 4 — Studio**
- Pure product: clean phone-on-color-block shots for category tiles.
- Founder portrait + team shot for PR kit.
- "How it works" step icons re-photographed in real hands.
- Asset count: 50 raw → 20 finals.

**Total photo library:** ~63 final, organised in `marketing/assets/photos/` by use case (hero, story, ad-1x1, ad-9x16, PR, web).

### Video shoot plan (2 shoot days + animation)

**Video Day 1 — Wed Jun 3 — Documentary unit**
- Three 60-sec seller stories: a Sinak shop owner, a university student, a mother selling her old phone. Real voices, Iraqi Arabic, subtitled.
- B-roll bank: 4K Baghdad city, market sounds, app screen recordings.

**Video Day 2 — Sat Jun 6 — Scripted unit**
- Hero film, 45 sec, AR voiceover: shows the privacy promise — buyer sees price agreement, *then* phone number reveals. Two cutdowns (30s, 15s) and a 9:16 vertical edit for Reels / TikTok / Shorts.
- "Don't get scammed" social-issue spot, 30 sec: dramatises common phone-sale scams in Baghdad and how the in-app deal flow + masked number + final-price handshake protects both sides.

**Animation — delivered Jun 10**
- 20-sec animated explainer of the 6-step flow (post → chat → propose → accept → confirm → number unlocks) for app stores and onboarding.
- 6 looping micro-animations (3 sec each) for paid social.

**Edits & deliverables — Jun 11 to Jun 13**
- Master cuts + platform aspect ratios (9:16, 1:1, 16:9).
- AR subtitles burned-in (most Iraqi viewers watch muted on mobile data).
- All raw files backed up to cloud + on-disk.

### Asset folder layout

```
marketing/
  assets/
    photos/
      hero/          # landing page, app store, billboards
      story-9x16/    # IG/TikTok story, WhatsApp status
      square-1x1/    # IG feed, FB feed
      pr-kit/        # press download bundle
    video/
      hero-45s/      # master, 30s, 15s, 9x16
      seller-stories/
      anti-scam-30s/
      explainer-anim-20s/
      micro-loops/
    captions/        # AR + EN copy per asset
```

---

## Phase 2 — Seeding & closed beta (Jun 14 – Jun 27)

Liquidity first. A marketplace with nothing to buy kills word-of-mouth on day one.

| Date         | Action                                                                                       |
|--------------|----------------------------------------------------------------------------------------------|
| Sun Jun 14   | Field team walks Sinak with 1-pager + QR code. Goal: 30 shops signed.                        |
| Mon Jun 15   | Onboarding crew helps the first 30 shops post 5 listings each → **150 seeded listings**.     |
| Tue Jun 16   | Closed-beta TestFlight / internal Play track to 50 power users (recruited from waitlist).    |
| Daily        | Bug triage at 19:00 Baghdad time; ship a build every 48h.                                    |
| Fri Jun 19   | Run 10 real deals end-to-end (propose → accept → confirm → number reveal → rating).          |
| Sun Jun 21   | Buyer-side beta opens to 200 waitlisted users.                                                |
| Wed Jun 24   | "Founding seller" badge minted for the first 100 listing creators.                            |
| Sat Jun 27   | Phase 2 review — checklist: ≥150 live listings, ≥30 completed deals, crash-free ≥99.5%.     |

---

## Phase 3 — Hype (Jun 28 – Jul 10)

Goal: every smartphone user in Baghdad has heard the name twice before launch.

| Date         | Channel        | Action                                                                                   |
|--------------|----------------|------------------------------------------------------------------------------------------|
| Sun Jun 28   | TikTok / Reels | Drop teaser #1: the 15-sec hero cutdown. No app link yet — just the question.            |
| Mon Jun 29   | Instagram      | Carousel of 5 Sinak portraits + caption: "Sell here. Safer."                             |
| Tue Jun 30   | Facebook       | Boosted post: anti-scam 30s video, targeted Baghdad governorate, 18–45.                  |
| Wed Jul 1    | Influencer 1   | Iraqi tech reviewer unboxes "how it works" — uses the closed beta on camera.             |
| Thu Jul 2    | WhatsApp       | First broadcast to waitlist: "We open in 9 days. Reply 1 to get the link first."          |
| Fri Jul 3    | TikTok         | Seller-story video #1 (Sinak shop owner) goes live. Pin to profile.                      |
| Sat Jul 4    | Telegram       | Channel post: photo carousel + invite link for early access build.                       |
| Sun Jul 5    | Influencer 2   | Lifestyle creator: "I sold my iPhone in 3 hours" — scripted but real flow.               |
| Mon Jul 6    | Out-of-home    | 6 billboards live: Karrada, Mansour, Al-Jadriya, Palestine St, Sinak entrance, Airport Rd. Photo asset = hero shot + QR. |
| Tue Jul 7    | PR             | Embargoed briefing to: Al-Sumaria, NRT, Shafaq News tech desks, Niqash, 964 Media.       |
| Wed Jul 8    | Influencer 3   | Comedian sketch: classic scam vs in-app safe flow.                                       |
| Thu Jul 9    | Email + push   | "Tomorrow night" reminder to waitlist (12k target).                                      |
| Fri Jul 10   | Stories blitz  | Every team member + influencer posts countdown story.                                    |

---

## Phase 4 — Launch week (Jul 11 – Jul 17)

**Launch day = Saturday Jul 11.** Saturday is family / shopping day in Baghdad.

| Date         | Action                                                                                              |
|--------------|-----------------------------------------------------------------------------------------------------|
| Sat Jul 11 09:00 | Public release on Play Store + App Store. Landing page flips from waitlist to download.        |
| Sat Jul 11 10:00 | Hero 45-sec film posted simultaneously on TikTok, Reels, YouTube, Facebook, X.                 |
| Sat Jul 11 11:00 | Press embargo lifts. Send PR kit (photos/PR-kit + founder quotes) to media list.               |
| Sat Jul 11 13:00 | Paid ads switch on — Meta + TikTok + Google App Campaigns geo-fenced to Baghdad. Budget: $1,500/day for the week. |
| Sat Jul 11 17:00 | **Launch event** at a Karrada café: 60 invited sellers + influencers + press. Photographer + videographer on site. Live demo. Free shawarma. |
| Sun Jul 12   | Drop launch-event recap reel by 12:00.                                                              |
| Mon Jul 13   | Influencer wave 2 — 4 mid-tier creators post their own listings (real phones, real deals).          |
| Tue Jul 14   | First "deal-of-the-day" feature: real closed deal with seller/buyer permission, photo + short clip. |
| Wed Jul 15   | Launch-week dashboard public post: "X listings, Y deals, Z neighbourhoods" — transparency = trust.   |
| Thu Jul 16   | Founder live Q&A on Instagram + TikTok, 21:00 Baghdad time.                                         |
| Fri Jul 17   | Retro internal: cut what isn't working, double what is.                                             |

**Launch-week success bar:**
- 25,000 app installs in Baghdad governorate.
- 3,000 listings live.
- 500 deals confirmed (propose → seller-confirm → phone unlocked).
- D1 retention ≥ 35%, D7 ≥ 18%.

---

## Phase 5 — Activation (Jul 18 – Aug 14)

| Week         | Theme              | Headline action                                                                       |
|--------------|--------------------|----------------------------------------------------------------------------------------|
| Jul 18 – 24  | Habit              | Daily fresh-listings push notification at 18:00. Re-engagement video ads to installers who didn't list. |
| Jul 25 – 31  | Trust              | Publish first 100 verified-seller badges. Run anti-scam video #2 (case-study format).  |
| Aug 1 – 7    | Referral           | Launch invite program: invite a seller → both get featured listing for 7 days.         |
| Aug 8 – 14   | Loyalty            | First IQ Mobile sellers' meetup at a Karrada venue. Photo + video coverage = content for September. |

---

## Phase 6 — Scale-in-city & prep next (Aug 15 – Oct 10)

- Add adjacent categories quietly (tablets, accessories) if sellers are asking.
- Negotiate co-marketing with one Baghdad carrier for top-up offers on first deal.
- Repeat shoot day in Adhamiya + Bayaa to broaden neighbourhood representation.
- Begin pre-production of the Basra launch using this exact playbook.

---

## Photo & video asset checklist (final tally)

| # | Asset                                  | Format            | Used in                              | Due       |
|---|----------------------------------------|-------------------|---------------------------------------|-----------|
| 1 | Hero film 45s                          | 16:9 + 9:16 + 1:1 | Launch day across all channels        | Jun 13    |
| 2 | Hero film cutdowns 30s / 15s           | 9:16, 1:1         | Paid social                           | Jun 13    |
| 3 | Anti-scam spot 30s                     | 9:16, 16:9        | Awareness phase, Facebook in-feed     | Jun 13    |
| 4 | Seller story films × 3 (60s each)      | 9:16              | Hype phase TikTok / Reels             | Jun 13    |
| 5 | Animated 6-step explainer 20s          | 1:1, 9:16         | App stores, onboarding, web hero      | Jun 10    |
| 6 | Micro-loop animations × 6 (3s)         | 9:16, 1:1         | Paid retargeting                      | Jun 10    |
| 7 | Hero photo set (Sinak, golden hour)    | 4:5 + 16:9        | Billboards, landing, PR               | Jun 6     |
| 8 | Lifestyle photo set (Karrada)          | 4:5 + 1:1         | IG feed, FB carousel                  | Jun 6     |
| 9 | Product-on-color studio set            | 1:1               | Category tiles, paid creatives        | Jun 6     |
|10 | Founder & team portraits               | 4:5               | PR kit, About page                    | Jun 6     |
|11 | App-screen mockups                     | 9:16, 1:1         | All performance ads                   | Jun 13    |
|12 | Launch-event coverage (live)           | mixed             | Day 2 recap reel + ongoing            | Jul 11    |

---

## Budget snapshot (USD, single-city)

| Bucket                         | Range            |
|--------------------------------|------------------|
| Content production (photo+video) | $9k – $14k     |
| Influencer fees (10 creators)    | $6k – $10k     |
| Paid digital (8-week window)     | $18k – $25k    |
| Out-of-home (6 boards × 1 month) | $7k – $11k     |
| Launch event                     | $3k – $5k      |
| PR + creative contingency        | $3k            |
| **Total**                        | **$46k – $68k**|

---

## Tracking — one dashboard, reviewed every Monday 10:00 Baghdad

- Installs (Baghdad-only, by source).
- Listings created / live.
- Deals confirmed (propose → seller-confirm).
- Phone-unlock events (north-star metric — equals "real transactions").
- D1 / D7 / D30 retention.
- Reports filed and bypass attempts logged (trust health).
- CAC by channel and CAC per *deal*, not per install.

---

## Risks & responses

| Risk                                          | Response                                                                |
|-----------------------------------------------|-------------------------------------------------------------------------|
| Sellers post 3 photos but quality is poor     | Onboarding crew offers free photo help in Sinak for first 2 weeks.      |
| Scammers try to push numbers through chat     | Server already masks phone numbers; surface bypass-attempt logs to admin daily and ban repeat offenders publicly. |
| Buyers churn after first browse, no deal      | Trigger re-engagement notif at H+24 with 3 listings near their last view.|
| One influencer no-shows                       | Keep one paid backup per wave; never depend on a single creator.        |
| Eid / Muharram religious calendar overlap     | Jul 11 is clear of Eid Al-Adha (late May 2026) and Ashura (mid-July).   |

---

## Open decisions for the founder

1. Confirm Baghdad as launch city (or swap to Basra / Erbil — playbook is identical, dates slide by 0).
2. Approve $46k–$68k budget envelope.
3. Pick the launch-event venue in Karrada by **May 30**.
4. Sign off the hero-film script before **May 31** shoot.
