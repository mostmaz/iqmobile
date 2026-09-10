# Free boost: watch one ad, come back to the top

A seller with an active listing can watch one rewarded video and have that
listing float back to the top of «الأحدث». Free, capped, and deliberately a
different mechanism from paid featuring.

|  | paid featuring | free boost |
|---|---|---|
| what it buys | 2 rotating **pinned** slots, page 1 | a place in the ordinary recency stream |
| badge | «مميّز» | «مروّج» |
| costs | 2,000–10,000 IQD | one video |
| limit | by tier, in days | 2 per account per rolling 24h, 4h apart |

They never share a shelf. That was the owner's call, and it keeps the paid
product worth paying for.

## The one thing that did not exist before

**Nothing bumped a listing.** `created_at` was written once at insert and
never rewritten, and `boosted_at` — despite the name — belongs to featuring,
is re-stamped by the expirer every few hours, and is inert on a listing that
is not featured.

So there is a new column, `bumped_at`, and one shared expression in
`listingRank.js` that all five marketplace queries use:

```js
export const RANK_TS = 'COALESCE(l.bumped_at, l.created_at)';
```

Written out five times, a bump some of them honoured would put the same
listing at the top of the app's feed and halfway down the website's, with no
way to tell which was the bug.

**`created_at` is never written by this feature.** It means "posted", the
listing page shows it as such, and the request funnel's 60- and 365-day
windows filter on it. A bump moves a listing's place, not its age. Age
filters and `/listings/top-models` were deliberately left on `created_at`.

## Why the client cannot grant itself a boost

Three routes, and the split between them is the security design:

- **`POST /listings/:id/boost/start`** — the seller asks. Checks ownership and
  the allowance, mints a nonce, **spends nothing**.
- **`GET /admob/ssv`** — Google calls this server-to-server. It verifies an
  ECDSA signature over the raw query string against Google's own rotating
  keys. **The only path that grants.**
- **`GET /listings/:id/boost`** — what the app polls afterwards.

The app's own `onUserEarnedReward` callback is a hint to start polling, never
a grant: a rooted phone can fire it at will and cannot forge the signature.
The signature is checked against `req.originalUrl`, because `req.query` has
already lost the ordering and escaping and re-serialising it produces a
different byte string.

**Replays are handled at the storage layer.** `UNIQUE(ad_transaction_id)`
makes a duplicated callback a no-op — the same trick `wallet.js` uses for
idempotent credits — rather than something application code has to notice.
The allowance is re-checked *inside* the granting transaction, because
minutes passed while the video played and two ads watched in parallel both
passed the check at `/start`.

## Rules that look like details and are not

- **A failed ad costs nothing.** No load, no fill, closed early, network gone:
  the attempt row stays `pending` and no boost is spent. The seller is told so
  in as many words.
- **Rolling 24 hours, not a midnight reset.** A midnight reset makes the two
  boosts worth more at 23:59 than at 00:01, teaches sellers to wait rather
  than post, and hands the ad network a spike at midnight. It is also the only
  rule a device clock cannot game.
- **The countdown reports the later of the gap and the window.** Telling a
  seller who has used both boosts that they can go again in four hours is
  simply false.
- **Smart Boost.** A seller who posts a phone and immediately boosts it would
  spend the reward moving from rank 2 to rank 1. A listing inside the top 20
  gets its highlight now and its bump four hours later. Rank is one COUNT
  against an expression index and counts only what a buyer can actually buy —
  treating sold rows as "above you" would inflate every rank and quietly turn
  Smart Boost off.
- **The delayed bump runs server-side**, in the expirer's existing 30s tick.
  The seller closed the app hours ago. A listing sold before its scheduled
  bump is stamped done *without* being bumped.
- **Streaks count Baghdad days**, not rolling windows — a habit is measured in
  the calendar days someone lives in. A streak survives a today with nothing
  in it yet: telling someone at 09:00 that their streak is zero, with fourteen
  hours left to save it, is wrong and is the fastest way to make them stop
  caring.

## Where the design was overruled

The Claude Design mock (`Free Boost - Rewarded Video.dc.html`) describes 2
boosts **per listing**, resetting at Baghdad midnight, with no badge and no
Smart Boost. The owner's written spec said per account, rolling, with both. The
owner confirmed the spec wins on all four points. **The mock's explainer copy
therefore describes rules this does not implement and was rewritten** — the
layout, colours and component shapes are the mock's; the sentences are not.

## Configuration

Everything is an `app_settings` row, **off by default**, editable from the
dashboard: `rewarded_boost_enabled`, `_max_per_24h`, `_min_interval_hours`,
`_highlight_hours`, `_top_threshold`, and `admob_rewarded_unit_android` /
`_ios`. Empty ad units mean the app watches Google's official test ads. The
app reads them from `/app-config`, which returns `rewarded_boost: null` when
the feature is off — the same shape the overlay uses, so an old build sees
nothing rather than a flag it must interpret.

## The Android build has a Kotlin pin

`react-native-google-mobile-ads` 16.x needs play-services-ads 25.x, whose
Kotlin metadata is 2.3.0, and React Native 0.81 pins Kotlin 2.1.20. The three
obvious fixes all fail: forcing an older ads SDK breaks the library, which
calls 25.x-only APIs; downgrading the library to 15.x breaks against RN 0.81's
ReactContext; raising the whole project to Kotlin 2.3 fights React Native's
own gradle plugin. So `android/build.gradle` passes
`-Xskip-metadata-version-check` **to that one module**. Delete it when React
Native's pinned Kotlin catches up.

Also note the AdMob app id lives in a **top-level `react-native-google-mobile-ads`
key in app.json**, not in the expo plugin entry — the library's own
`app-json.gradle` reads that key, and writing the same meta-data by hand into
the committed manifest as well fails the merge.

## What this deliberately does not do

- **Any other ad format.** One rewarded placement, user-initiated only. No
  interstitials, no banners.
- **Touch paid featuring.** Its slots, tiers, pricing and copy are unchanged.
- **Ship a consent (UMP) flow.** Iraq is outside the EEA and the SDK requests
  non-personalised ads. Revisit before shipping to Europe.
- **Raise a second ATT prompt on iOS.** `analytics/meta.ts` already owns that
  one-shot prompt; AdMob reads the status it left behind.
